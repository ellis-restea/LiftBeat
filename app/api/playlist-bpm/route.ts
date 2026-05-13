import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const HIGH_BPM_CUTOFF = 120;
// Process this many Songstats requests concurrently
const BATCH_SIZE = 8;

export interface TrackBpm {
  id: string;
  name: string;
  artists: string[];
  bpm: number | null;
}

// ── Songstats ──────────────────────────────────────────────────────────────

function extractBpm(data: any): number | null {
  const audioAnalysis: any[] =
    data?.track?.audio_analysis ??
    data?.stats?.audio_analysis ??
    data?.audio_analysis ??
    [];
  if (Array.isArray(audioAnalysis)) {
    const item = audioAnalysis.find((a: any) => a.key === "tempo");
    if (item && typeof item.value === "number") return item.value;
  }
  return null;
}

async function fetchSongstatsBpm(spotifyId: string, apiKey: string, logFull = false): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.songstats.com/enterprise/v1/tracks/info?spotify_track_id=${spotifyId}`,
      { headers: { apikey: apiKey } }
    );
    if (!res.ok) {
      console.log(`[Songstats] HTTP ${res.status} for ${spotifyId}`);
      return null;
    }
    const data = await res.json();
    // Log the full response once so we can verify the actual shape of the Songstats API
    if (logFull) {
      console.log(`[Songstats] Full raw response for ${spotifyId}:`, JSON.stringify(data));
    }
    const bpm = extractBpm(data);
    if (bpm === null) {
      const topKeys = Object.keys(data ?? {}).join(", ");
      console.log(`[Songstats] tempo not found for ${spotifyId} — top-level keys: [${topKeys}]`);
      if (data?.track) console.log(`[Songstats] data.track keys: [${Object.keys(data.track).join(", ")}]`);
    }
    return bpm;
  } catch (err) {
    console.log(`[Songstats] threw for ${spotifyId}:`, err);
    return null;
  }
}

// ── Spotify playlist fetch (with pagination) ───────────────────────────────

async function fetchAllPlaylistTracks(playlistId: string, accessToken: string): Promise<any[]> {
  const tracks: any[] = [];
  let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    console.log(`[PlaylistBPM] Spotify playlist page → HTTP ${res.status}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(`[PlaylistBPM] Spotify error body:`, body.slice(0, 300));
      break;
    }
    const data = await res.json();
    for (const item of data.items ?? []) {
      if (item?.track?.id) tracks.push(item.track);
    }
    url = data.next ?? null;
  }

  return tracks;
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const playlistId = req.nextUrl.searchParams.get("playlist_id");
  const authHeader = req.headers.get("authorization");

  if (!playlistId) return NextResponse.json({ error: "missing playlist_id" }, { status: 400 });
  if (!authHeader) return NextResponse.json({ error: "missing authorization" }, { status: 401 });
  const accessToken = authHeader.replace("Bearer ", "");

  const songstatsKey = process.env.SONGSTATS_API_KEY;
  if (!songstatsKey) return NextResponse.json({ error: "SONGSTATS_API_KEY not set" }, { status: 500 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 1. Fetch all tracks from the Spotify playlist
  const spotifyTracks = await fetchAllPlaylistTracks(playlistId, accessToken);
  if (!spotifyTracks.length) {
    console.log("[PlaylistBPM] No tracks returned from Spotify for playlist:", playlistId);
    return NextResponse.json({ high: [], low: [], unknown: [], total: 0, fromCache: 0, fromApi: 0 });
  }

  // Deduplicate by ID (same track can appear multiple times in a playlist)
  const seen = new Set<string>();
  const uniqueTracks = spotifyTracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  const trackIds = uniqueTracks.map((t) => t.id);

  console.log(`[PlaylistBPM] ${playlistId}: ${uniqueTracks.length} unique tracks`);

  // 2. Load cached BPMs from Supabase
  const { data: cachedRows, error: cacheErr } = await sb
    .from("track_bpm_cache")
    .select("spotify_track_id, bpm")
    .in("spotify_track_id", trackIds);

  if (cacheErr) console.log("[PlaylistBPM] Supabase cache read error:", cacheErr.message);

  const bpmMap = new Map<string, number | null>();
  for (const row of cachedRows ?? []) bpmMap.set(row.spotify_track_id, row.bpm);

  const uncachedIds = trackIds.filter((id) => !bpmMap.has(id));
  console.log(`[PlaylistBPM] Cache hit: ${trackIds.length - uncachedIds.length}/${trackIds.length}, fetching ${uncachedIds.length} from Songstats`);

  // 3. Fetch missing BPMs from Songstats in parallel batches
  const freshRows: { spotify_track_id: string; bpm: number | null }[] = [];

  for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
    const batch = uncachedIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (id, idx) => ({
        spotify_track_id: id,
        // Log full response for the very first track only — reveals the API shape
        bpm: await fetchSongstatsBpm(id, songstatsKey, i === 0 && idx === 0),
      }))
    );
    for (const r of results) {
      bpmMap.set(r.spotify_track_id, r.bpm);
      freshRows.push(r);
    }
  }

  // 4. Persist new BPM data to Supabase cache
  if (freshRows.length > 0) {
    const { error: upsertErr } = await sb
      .from("track_bpm_cache")
      .upsert(freshRows, { onConflict: "spotify_track_id" });
    if (upsertErr) console.log("[PlaylistBPM] Supabase cache write error:", upsertErr.message);
  }

  // 5. Sort into energy buckets
  const high: TrackBpm[] = [];
  const low: TrackBpm[] = [];
  const unknown: TrackBpm[] = [];

  for (const track of uniqueTracks) {
    const bpm = bpmMap.get(track.id) ?? null;
    const entry: TrackBpm = {
      id: track.id,
      name: track.name,
      artists: track.artists?.map((a: any) => a.name) ?? [],
      bpm,
    };
    if (bpm === null) unknown.push(entry);
    else if (bpm >= HIGH_BPM_CUTOFF) high.push(entry);
    else low.push(entry);
  }

  const fromApi = freshRows.filter((r) => r.bpm !== null).length;
  console.log(
    `[PlaylistBPM] ${playlistId} done — HIGH: ${high.length}, LOW: ${low.length}, UNKNOWN: ${unknown.length}`,
    `| fromCache: ${trackIds.length - uncachedIds.length}, fromSongstats: ${fromApi}`
  );

  return NextResponse.json({
    high,
    low,
    unknown,
    total: uniqueTracks.length,
    fromCache: trackIds.length - uncachedIds.length,
    fromApi,
  });
}
