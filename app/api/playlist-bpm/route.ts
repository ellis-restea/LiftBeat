import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const HIGH_BPM_CUTOFF = 120;
const BATCH_SIZE = 8;

// ── GetSongBPM fallback ────────────────────────────────────────────────────
// Used when Songstats has no tempo data for a track (poor coverage of niche/
// regional music). Searches by track name, requires confirmed artist match.

function artistsMatch(resultArtist: string, trackArtists: string[]): boolean {
  const ra = resultArtist.toLowerCase();
  return trackArtists.some((a) => {
    const al = a.toLowerCase();
    return ra.includes(al) || al.includes(ra);
  });
}

async function searchGetSongBpm(lookup: string, artistNames: string[], apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.getsong.co/search/?api_key=${apiKey}&type=song&lookup=${encodeURIComponent(lookup)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data?.search?.data ?? data?.data ?? [];
    for (const r of results) {
      const artistStr: string =
        r?.artist?.title ?? r?.artist?.name ?? r?.artist_name ??
        (typeof r?.artist === "string" ? r.artist : null) ?? "";
      if (artistStr && artistsMatch(artistStr, artistNames)) {
        const bpm = parseFloat(r?.tempo ?? r?.bpm ?? "");
        return isNaN(bpm) ? null : bpm;
      }
    }
  } catch { /* non-fatal */ }
  return null;
}

async function fetchGetSongBpm(name: string, artists: string[], apiKey: string): Promise<number | null> {
  // Step 1: full track name
  let bpm = await searchGetSongBpm(name, artists, apiKey);
  if (bpm !== null) return bpm;
  // Step 2: strip trailing "- suffix" / "(suffix)" and retry
  const stripped = name.replace(/\s*[\(\[].*$/, "").replace(/\s*-\s+.+$/, "").trim();
  if (stripped && stripped !== name) {
    bpm = await searchGetSongBpm(stripped, artists, apiKey);
  }
  return bpm;
}

export interface TrackBpm {
  id: string;
  name: string;
  artists: string[];
  bpm: number | null;
}

// All 13 keys Songstats returns in audio_analysis
const FEATURE_KEYS = [
  "acousticness", "danceability", "duration", "energy", "instrumentalness",
  "key", "liveness", "loudness", "mode", "speechiness", "tempo",
  "time_signature", "valence",
] as const;
type FeatureKey = typeof FEATURE_KEYS[number];
type AudioFeatures = { [K in FeatureKey]: number | null };

// ── Songstats ──────────────────────────────────────────────────────────────

function extractFeatures(data: any): AudioFeatures {
  // audio_analysis is an array of { key: string, value: string }
  const audioAnalysis: any[] =
    data?.track?.audio_analysis ??
    data?.stats?.audio_analysis ??
    data?.audio_analysis ??
    [];

  const result = {} as AudioFeatures;
  for (const k of FEATURE_KEYS) {
    const item = audioAnalysis.find((a: any) => a.key === k);
    // Values come back as strings ("109.028") — parse to float
    const val = item != null ? parseFloat(String(item.value)) : NaN;
    result[k] = isNaN(val) ? null : val;
  }
  return result;
}

async function fetchSongstatsFeatures(
  spotifyId: string,
  apiKey: string,
  logFull = false,
): Promise<AudioFeatures | null> {
  try {
    const res = await fetch(
      `https://api.songstats.com/enterprise/v1/tracks/info?spotify_track_id=${spotifyId}`,
      { headers: { apikey: apiKey } },
    );
    if (!res.ok) {
      console.log(`[Songstats] HTTP ${res.status} for ${spotifyId}`);
      return null;
    }
    const data = await res.json();
    if (logFull) console.log(`[Songstats] Full raw response for ${spotifyId}:`, JSON.stringify(data));

    const features = extractFeatures(data);
    if (features.tempo === null) {
      const topKeys = Object.keys(data ?? {}).join(", ");
      console.log(`[Songstats] tempo not found for ${spotifyId} — top-level keys: [${topKeys}]`);
      if (data?.track) console.log(`[Songstats] data.track keys: [${Object.keys(data.track).join(", ")}]`);
    } else {
      console.log(`[Songstats] ${spotifyId} → tempo: ${features.tempo}, energy: ${features.energy}`);
    }
    return features;
  } catch (err) {
    console.log(`[Songstats] threw for ${spotifyId}:`, err);
    return null;
  }
}

// ── Route handler ──────────────────────────────────────────────────────────
// Client fetches playlist tracks from Spotify (client already has the right scopes),
// then POSTs them here. This route only touches Songstats + Supabase.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const inputTracks: { id: string; name: string; artists: string[] }[] = body.tracks ?? [];

  if (!inputTracks.length) {
    return NextResponse.json({ high: [], low: [], unknown: [], total: 0, fromCache: 0, fromApi: 0 });
  }

  const songstatsKey = process.env.SONGSTATS_API_KEY;
  if (!songstatsKey) return NextResponse.json({ error: "SONGSTATS_API_KEY not set" }, { status: 500 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  // Deduplicate by Spotify ID
  const seen = new Set<string>();
  const uniqueTracks = inputTracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  const trackIds = uniqueTracks.map((t) => t.id);

  console.log(`[PlaylistBPM] POST: ${uniqueTracks.length} unique tracks`);

  // 1. Load cached BPMs from Supabase
  const { data: cachedRows, error: cacheErr } = await sb
    .from("track_bpm_cache")
    .select("spotify_track_id, bpm")
    .in("spotify_track_id", trackIds);

  if (cacheErr) console.log("[PlaylistBPM] Supabase cache read error:", cacheErr.message);

  const bpmMap = new Map<string, number | null>();
  // Only treat rows with non-null bpm as cached — null-bpm rows are stale/bad and should be retried
  for (const row of cachedRows ?? []) {
    if (row.bpm !== null) bpmMap.set(row.spotify_track_id, row.bpm);
  }

  const uncachedIds = trackIds.filter((id) => !bpmMap.has(id));
  console.log(
    `[PlaylistBPM] Cache hit: ${trackIds.length - uncachedIds.length}/${trackIds.length},`,
    `fetching ${uncachedIds.length} from Songstats`,
  );

  // 2. Fetch missing features from Songstats in parallel batches
  type CacheRow = { spotify_track_id: string; bpm: number | null } & AudioFeatures;
  const freshRows: CacheRow[] = [];

  for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
    const batch = uncachedIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (id, idx) => {
        const features = await fetchSongstatsFeatures(id, songstatsKey, i === 0 && idx === 0);
        return { id, features };
      }),
    );
    for (const { id, features } of results) {
      const bpm = features?.tempo ?? null;
      bpmMap.set(id, bpm);
      // Only cache rows where Songstats returned actual data — never cache failed lookups
      // (null features = HTTP error; caching them would permanently block re-fetching)
      if (features !== null) {
        freshRows.push({ spotify_track_id: id, bpm, ...features });
      }
    }
  }

  // 2b. Fallback to GetSongBPM for tracks Songstats couldn't find
  const getsongKey = process.env.NEXT_PUBLIC_GETSONGBPM_KEY;
  if (getsongKey) {
    const stillUnknown = uniqueTracks.filter((t) => bpmMap.get(t.id) === null || !bpmMap.has(t.id));
    if (stillUnknown.length > 0) {
      console.log(`[GetSongBPM] Trying fallback for ${stillUnknown.length} tracks`);
      for (const track of stillUnknown) {
        const bpm = await fetchGetSongBpm(track.name, track.artists, getsongKey);
        if (bpm !== null) {
          bpmMap.set(track.id, bpm);
          // Update existing freshRow if Songstats already added one (to avoid duplicate key in upsert)
          const existingIdx = freshRows.findIndex((r) => r.spotify_track_id === track.id);
          if (existingIdx >= 0) {
            freshRows[existingIdx] = { ...freshRows[existingIdx], bpm, tempo: bpm };
          } else {
            freshRows.push({
              spotify_track_id: track.id,
              bpm,
              acousticness: null, danceability: null, duration: null, energy: null,
              instrumentalness: null, key: null, liveness: null, loudness: null,
              mode: null, speechiness: null, tempo: bpm, time_signature: null, valence: null,
            });
          }
          console.log(`[GetSongBPM] "${track.name}" → ${bpm} BPM`);
        }
        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 80));
      }
    }
  }

  // 3. Persist all features to Supabase cache
  console.log(`[PlaylistBPM] Writing ${freshRows.length} rows to track_bpm_cache…`);
  if (process.env.NODE_ENV !== "production") {
    console.log(`[PlaylistBPM] freshRows sample (first 2):`, JSON.stringify(freshRows.slice(0, 2)));
  }
  if (freshRows.length > 0) {
    const { error: upsertErr, count } = await sb
      .from("track_bpm_cache")
      .upsert(freshRows, { onConflict: "spotify_track_id" })
      .select();
    if (upsertErr) {
      console.log("[PlaylistBPM] Supabase upsert ERROR:", upsertErr.message, upsertErr.details);
    } else {
      console.log(`[PlaylistBPM] Supabase upsert OK — rows affected: ${count ?? "unknown"}`);
    }
  } else {
    console.log("[PlaylistBPM] freshRows empty — nothing to write (all tracks already cached)");
  }

  // 4. Sort into energy buckets
  const high: TrackBpm[] = [];
  const low: TrackBpm[] = [];
  const unknown: TrackBpm[] = [];

  for (const track of uniqueTracks) {
    const bpm = bpmMap.get(track.id) ?? null;
    const entry: TrackBpm = { id: track.id, name: track.name, artists: track.artists, bpm };
    if (bpm === null) unknown.push(entry);
    else if (bpm >= HIGH_BPM_CUTOFF) high.push(entry);
    else low.push(entry);
  }

  const fromApi = freshRows.filter((r) => r.bpm !== null).length;
  console.log(
    `[PlaylistBPM] done — HIGH: ${high.length}, LOW: ${low.length}, UNKNOWN: ${unknown.length}`,
    `| fromCache: ${trackIds.length - uncachedIds.length}, fromSongstats: ${fromApi}`,
  );

  return NextResponse.json({
    high, low, unknown,
    total: uniqueTracks.length,
    fromCache: trackIds.length - uncachedIds.length,
    fromApi,
  });
}
