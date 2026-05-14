"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { feedback } from "@/lib/feedback";
import LoadingScreen from "../components/LoadingScreen";

interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  order_index: number;
  superset_with: number | null;
}

interface TrackBpm {
  id: string;
  name: string;
  artists: string[];
  bpm: number | null;
  playlistId?: string;
}

type WorkoutState = "idle" | "warmup" | "exercising" | "resting" | "done";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatMs(ms: number) {
  return formatTime(Math.floor(ms / 1000));
}

const HIGH_BPM_CUTOFF = 120;

// Diagnostic timing — logs show ms elapsed since the module was first evaluated.
const _pageLoad = Date.now();
const ts = () => `+${Date.now() - _pageLoad}ms`;

async function fetchQueueAndEnrich(): Promise<TrackBpm[]> {
  try {
    const qRes = await fetch("/api/queue-tracks");
    if (!qRes.ok) {
      console.log("[Queue] /api/queue-tracks returned", qRes.status);
      return [];
    }
    const { tracks } = await qRes.json();
    if (!tracks?.length) return [];

    const bpmRes = await fetch("/api/playlist-bpm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracks }),
    });
    if (!bpmRes.ok) return [];

    const result = await bpmRes.json();
    console.log(
      `[Queue] Enriched from Spotify queue — HIGH: ${result.high?.length ?? 0}, LOW: ${result.low?.length ?? 0}, UNKNOWN: ${result.unknown?.length ?? 0}`,
    );
    return [
      ...(result.high ?? []).map((t: TrackBpm) => ({ ...t, playlistId: "queue" })),
      ...(result.low  ?? []).map((t: TrackBpm) => ({ ...t, playlistId: "queue" })),
    ];
  } catch {
    return [];
  }
}

// Shuffle eligible tracks and pick up to `count` URIs using round-robin across playlists.
function shuffleAndPickUris(eligible: TrackBpm[], count = 10): string[] {
  if (eligible.length === 0) return [];
  const byPlaylist = new Map<string, TrackBpm[]>();
  for (const t of eligible) {
    const pid = t.playlistId ?? "__unknown__";
    if (!byPlaylist.has(pid)) byPlaylist.set(pid, []);
    byPlaylist.get(pid)!.push(t);
  }
  const shuffled = [...byPlaylist.values()].map((arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  });
  const result: string[] = [];
  let i = 0;
  while (result.length < count) {
    let added = false;
    for (const arr of shuffled) {
      if (result.length >= count) break;
      if (i < arr.length) { result.push(`spotify:track:${arr[i].id}`); added = true; }
    }
    if (!added) break;
    i++;
  }
  return result;
}

// Build a queue for the given state using the BPM bucket and excludeIds.
// Falls back to the full bucket if all eligible tracks have been played.
// Use recomputeQueues() for the precomputed queues — this is only for ad-hoc builds.
function buildQueue(state: WorkoutState, pool: TrackBpm[], excludeIds: Set<string>, count = 10): string[] {
  if (state === "idle" || state === "done") return [];
  const wantHigh = state === "warmup" || state === "exercising";
  let eligible = pool.filter(t => t.bpm != null && (t.bpm >= HIGH_BPM_CUTOFF) === wantHigh && !excludeIds.has(t.id));
  if (eligible.length === 0) eligible = pool.filter(t => t.bpm != null && (t.bpm >= HIGH_BPM_CUTOFF) === wantHigh);
  return shuffleAndPickUris(eligible, count);
}

export default function Workout() {
  return <Suspense><WorkoutInner /></Suspense>;
}

function WorkoutInner() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const router = useRouter();

  const workoutId = searchParams.get("workout_id");

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [currentSet, setCurrentSet] = useState(1);
  const [workoutState, setWorkoutState] = useState<WorkoutState>("idle");
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [songProgress, setSongProgress] = useState(0);
  const [songPosition, setSongPosition] = useState(0);
  const [songDuration, setSongDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const [setsCompleted, setSetsCompleted] = useState(0);
  const [noDevice, setNoDevice] = useState(false);
  const [premiumRequired, setPremiumRequired] = useState(false);
  const [noQueue, setNoQueue] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [spotifyPlaying, setSpotifyPlaying] = useState<boolean | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastCommandRef = useRef<number>(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const prevTrackIdRef = useRef<string | null>(null);
  // App-side track history for the "previous" button — Spotify's native /previous
  // 403s when the app uses a custom uris queue (no playlist context).
  const trackHistoryRef = useRef<string[]>([]);
  const rateLimitUntilRef = useRef<number>(0);
  const workoutStateRef = useRef<WorkoutState>("idle");
  const fetchCurrentTrackRef = useRef<() => Promise<void>>(async () => {});

  // Flat pool of all tracks from all selected playlists, each tagged with playlistId + bpm
  const trackPoolRef = useRef<TrackBpm[]>([]);
  // Currently active queue of track URIs sent to Spotify via PUT /play
  const currentQueueRef = useRef<string[]>([]);
  // Track IDs that have already played this workout (for replay prevention)
  const playedIdsRef = useRef<Set<string>>(new Set());
  // Active Spotify device ID (set on Start Workout)
  const deviceIdRef = useRef<string | null>(null);
  const originalVolumeRef = useRef<number>(50);
  const isTransitioningRef = useRef(false);
  const preloadedRef = useRef(false);
  const currentTrackRef = useRef<any>(null);
  const withMuteTransitionRef = useRef<(fn: () => Promise<void>) => Promise<void>>(async (fn) => fn());
  // Pre-identified queues for the next HIGH and LOW state — rebuilt whenever pool or playedIds changes.
  const precomputedHighRef = useRef<string[]>([]);
  const precomputedLowRef  = useRef<string[]>([]);
  // True once we've confirmed (and optionally corrected) the BPM of the playing track in idle state.
  // Prevents repeated correction attempts and signals handleStart to skip the song switch.
  const correctionAppliedRef = useRef(false);

  const currentExercise = exercises[currentExerciseIndex];
  const totalSets = exercises.reduce((acc, ex) => acc + ex.sets, 0);
  const workoutProgress = totalSets > 0 ? Math.round((setsCompleted / totalSets) * 100) : 0;

  const nextEx = exercises[currentExerciseIndex + 1];
  const isInSuperset =
    currentExercise?.superset_with != null ||
    (nextEx?.superset_with != null && nextEx.superset_with === currentExercise?.order_index);

  const displayProgress = isDragging ? dragProgress * 100 : songProgress;
  const displayPosition = isDragging ? Math.floor(dragProgress * songDuration) : songPosition;

  useEffect(() => {
    if (!workoutId) return;
    supabase
      .from("exercises")
      .select("*")
      .eq("workout_id", workoutId)
      .order("order_index")
      .then(({ data, error }) => {
        if (error) console.error("[LiftSync] Exercise load error:", error);
        if (data) setExercises(data);
        setLoading(false);
      });
  }, [workoutId]);


  // Global Spotify fetch wrapper — respects rate-limit headers.
  const spotifyFetch = useCallback(async (url: string, options?: RequestInit): Promise<Response> => {
    if (Date.now() < rateLimitUntilRef.current) {
      const remaining = Math.ceil((rateLimitUntilRef.current - Date.now()) / 1000);
      console.log(`[Spotify] Rate limited for ${remaining}s more`);
      return new Response(null, { status: 429 });
    }
    const res = await fetch(url, options);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "10", 10);
      console.log(`[Spotify] Rate limited — blocking ${retryAfter}s`);
      rateLimitUntilRef.current = Date.now() + retryAfter * 1000;
    }
    return res;
  }, []);

  // Mute → run play command → wait for track start → fade volume back up.
  // Guarantees volume is always restored even if the transition errors.
  const withMuteTransition = useCallback(async (playFn: () => Promise<void>) => {
    if (!session?.accessToken) { await playFn(); return; }

    let vol = originalVolumeRef.current;
    let volumeRestored = false;
    setIsTransitioning(true);
    isTransitioningRef.current = true;

    try {
      // Snapshot current volume before muting
      const pRes = await fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (pRes.ok) {
        const pd = await pRes.json();
        const v = pd?.device?.volume_percent;
        if (typeof v === "number" && v > 0) { vol = v; originalVolumeRef.current = v; }
      }

      // Mute immediately
      await spotifyFetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=0`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });

      // Execute the play command
      await playFn();

      // Give Spotify time to start the new track
      await new Promise(r => setTimeout(r, 500));

      // Fade volume back up over 400ms (5 steps × 80ms)
      for (let i = 1; i <= 5; i++) {
        await spotifyFetch(
          `https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round((vol * i) / 5)}`,
          { method: "PUT", headers: { Authorization: `Bearer ${session.accessToken}` } },
        );
        if (i < 5) await new Promise(r => setTimeout(r, 80));
      }
      volumeRestored = true;
    } finally {
      if (!volumeRestored) {
        fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${vol}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${session!.accessToken!}` },
        }).catch(() => {});
      }
      setIsTransitioning(false);
      isTransitioningRef.current = false;
    }
  }, [session, spotifyFetch]);

  useEffect(() => { withMuteTransitionRef.current = withMuteTransition; }, [withMuteTransition]);

  // Rebuild both HIGH and LOW queues from the current pool and played-set.
  // Each bucket independently tracks exhaustion: when every track of that BPM type has played,
  // only that bucket's played IDs are cleared from the shared set — the other bucket is untouched.
  const recomputeQueues = useCallback(() => {
    const pool   = trackPoolRef.current;
    const played = playedIdsRef.current;

    const highPool = pool.filter(t => t.bpm != null && t.bpm >= HIGH_BPM_CUTOFF);
    let highEligible = highPool.filter(t => !played.has(t.id));
    if (highEligible.length === 0 && highPool.length > 0) {
      console.log("[Replay] HIGH bucket exhausted — resetting played history for HIGH tracks only");
      for (const t of highPool) played.delete(t.id);
      highEligible = highPool;
    }

    const lowPool = pool.filter(t => t.bpm != null && t.bpm < HIGH_BPM_CUTOFF);
    let lowEligible = lowPool.filter(t => !played.has(t.id));
    if (lowEligible.length === 0 && lowPool.length > 0) {
      console.log("[Replay] LOW bucket exhausted — resetting played history for LOW tracks only");
      for (const t of lowPool) played.delete(t.id);
      lowEligible = lowPool;
    }

    precomputedHighRef.current = shuffleAndPickUris(highEligible);
    precomputedLowRef.current  = shuffleAndPickUris(lowEligible);
    console.log(`[Precompute] HIGH: ${precomputedHighRef.current.length}, LOW: ${precomputedLowRef.current.length} URIs ready`);
  }, []);

  const recomputeQueuesRef = useRef(recomputeQueues);
  useEffect(() => { recomputeQueuesRef.current = recomputeQueues; }, [recomputeQueues]);

  // Play the correct BPM bucket for a given state.
  // 1. Uses precomputed queue if ready (instant).
  // 2. Retries up to 3× with a live Spotify queue refresh if the bucket is empty.
  // 3. Falls back to muting + scanning upcoming tracks one-by-one until a match is found.
  const playForState = useCallback(async (state: WorkoutState) => {
    if (!session?.accessToken) return;

    // Lazily resolve device
    if (!deviceIdRef.current) {
      try {
        const res = await spotifyFetch("https://api.spotify.com/v1/me/player/devices", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (res.ok) {
          const { devices } = await res.json();
          const d = devices?.find((d: any) => d.is_active) ?? devices?.[0];
          if (d) deviceIdRef.current = d.id;
        }
      } catch { /* non-fatal */ }
    }
    if (!deviceIdRef.current) { console.log("[Queue] No device available"); return; }

    const wantHigh = state === "warmup" || state === "exercising";
    const bucket = wantHigh ? "HIGH" : "LOW";

    // Step 1: use precomputed queue
    let queue = wantHigh ? precomputedHighRef.current : precomputedLowRef.current;
    let source = queue.length > 0 ? "precomputed" : "";

    // Step 2: retry up to 3× with a fresh Spotify queue pull
    for (let attempt = 1; attempt <= 3 && queue.length === 0; attempt++) {
      console.log(`[Queue] No ${bucket} tracks — refreshing Spotify queue (attempt ${attempt}/3)`);
      const fresh = await fetchQueueAndEnrich();
      const existingIds = new Set(trackPoolRef.current.map(t => t.id));
      const added = fresh.filter(t => !existingIds.has(t.id));
      if (added.length > 0) {
        trackPoolRef.current = [...trackPoolRef.current, ...added];
        console.log(`[Queue] Pool grew +${added.length} tracks from refresh`);
      }
      recomputeQueuesRef.current();
      queue = wantHigh ? precomputedHighRef.current : precomputedLowRef.current;
      if (queue.length > 0) source = `refresh-attempt-${attempt}`;
    }

    // Step 3: fallback — mute Spotify, skip forward one track at a time, unmute on BPM match
    if (queue.length === 0) {
      console.log(`[Fallback] No ${bucket} BPM tracks after retries — muting and scanning queue`);
      const vol = originalVolumeRef.current;
      setIsTransitioning(true);
      isTransitioningRef.current = true;

      try {
        await spotifyFetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=0`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });

        let found = false;
        for (let skip = 0; skip < 10 && !found; skip++) {
          await spotifyFetch("https://api.spotify.com/v1/me/player/next", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}` },
          });
          await new Promise(r => setTimeout(r, 900));

          const cpRes = await spotifyFetch("https://api.spotify.com/v1/me/player/currently-playing", {
            headers: { Authorization: `Bearer ${session.accessToken}` },
          });
          if (!cpRes.ok || cpRes.status === 204) continue;
          const cpData = await cpRes.json();
          const trackId = cpData?.item?.id;
          if (!trackId) continue;

          // Look up BPM from pool; fetch from API if not cached
          let trackBpm: number | null = null;
          const inPool = trackPoolRef.current.find(t => t.id === trackId);
          if (inPool?.bpm != null) {
            trackBpm = inPool.bpm;
          } else {
            const bpmRes = await fetch("/api/playlist-bpm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tracks: [{ id: trackId, name: cpData.item.name, artists: cpData.item.artists?.map((a: any) => a.name) ?? [] }] }),
            });
            if (bpmRes.ok) {
              const bpmData = await bpmRes.json();
              const enriched = [...(bpmData.high ?? []), ...(bpmData.low ?? [])].find((t: TrackBpm) => t.id === trackId);
              if (enriched) {
                trackPoolRef.current = [...trackPoolRef.current, { ...enriched, playlistId: "queue" }];
                trackBpm = enriched.bpm;
              }
            }
          }

          const isHigh = trackBpm != null && trackBpm >= HIGH_BPM_CUTOFF;
          if (isHigh === wantHigh) {
            console.log(`[Fallback] Found ${bucket} BPM track at skip ${skip + 1}: "${cpData.item.name}" (${trackBpm} BPM)`);
            found = true;
            recomputeQueuesRef.current();
            for (let i = 1; i <= 5; i++) {
              await spotifyFetch(
                `https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round((vol * i) / 5)}`,
                { method: "PUT", headers: { Authorization: `Bearer ${session.accessToken}` } },
              );
              if (i < 5) await new Promise(r => setTimeout(r, 80));
            }
          } else {
            console.log(`[Fallback] Skip ${skip + 1}: "${cpData.item?.name}" — ${trackBpm ?? "unknown"} BPM, want ${bucket}`);
          }
        }

        if (!found) {
          console.log("[Fallback] No matching track found after 10 skips — restoring volume");
          await spotifyFetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${vol}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${session.accessToken}` },
          });
        }
      } finally {
        setIsTransitioning(false);
        isTransitioningRef.current = false;
      }
      return;
    }

    currentQueueRef.current = queue;
    const queueDetails = queue.map((uri, i) => {
      const id = uri.replace("spotify:track:", "");
      const t = trackPoolRef.current.find((x) => x.id === id);
      return { "#": i + 1, name: t?.name ?? "?", artists: t?.artists?.join(", ") ?? "?", bpm: t?.bpm ?? "?", playlist: t?.playlistId ?? "?" };
    });
    console.log(`[Queue] ${state} (${queue.length} tracks, ${source}):`, queueDetails);

    await withMuteTransition(async () => {
      lastCommandRef.current = Date.now();
      await spotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: queue }),
      });
    });

    // Rebuild queues for the next state change
    recomputeQueuesRef.current();
  }, [session, spotifyFetch, withMuteTransition, recomputeQueues]);

  const playForStateRef = useRef(playForState);
  useEffect(() => { playForStateRef.current = playForState; }, [playForState]);
  useEffect(() => { workoutStateRef.current = workoutState; }, [workoutState]);

  // Fetch current track, update UI, and refill the queue when it drops below 5 tracks.
  const fetchCurrentTrack = useCallback(async () => {
    if (!session?.accessToken) return;
    if (Date.now() - lastCommandRef.current < 1500) return;
    if (isDraggingRef.current) return;

    console.log(`[⏱ fetchCurrentTrack] ${ts()} — state: ${workoutStateRef.current}, pool: ${trackPoolRef.current.length} tracks, corrected: ${correctionAppliedRef.current}`);

    const res = await spotifyFetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.status === 204) {
      setSpotifyPlaying(false);
      if (workoutStateRef.current === "idle") setNoDevice(true);
      return;
    }
    if (res.status !== 200) return;

    const data = await res.json();
    setSpotifyPlaying(data?.is_playing ?? false);

    // Idle-state correction: before the workout starts, ensure the playing track is HIGH BPM.
    // Runs every poll until correctionAppliedRef is set. Pool must be loaded first.
    if (
      workoutStateRef.current === "idle" &&
      !correctionAppliedRef.current &&
      data?.is_playing &&
      data?.item?.id
    ) {
      console.log(`[⏱ playback detected] ${ts()} — track: "${data.item.name}", pool ready: ${trackPoolRef.current.length > 0}`);
      const pool = trackPoolRef.current;
      if (pool.length > 0) {
        const inPool = pool.find(t => t.id === data.item.id);
        const isHighBpm = inPool?.bpm != null && inPool.bpm >= HIGH_BPM_CUTOFF;
        console.log(`[⏱ correction check] ${ts()} — bpm: ${inPool?.bpm ?? "unknown"}, isHigh: ${isHighBpm}`);

        if (isHighBpm) {
          correctionAppliedRef.current = true;
          console.log(`[Auto-switch] Already HIGH BPM (${inPool?.bpm}) — no switch needed`);
        } else {
          // Resolve device if needed
          if (!deviceIdRef.current) {
            try {
              const dr = await spotifyFetch("https://api.spotify.com/v1/me/player/devices", {
                headers: { Authorization: `Bearer ${session.accessToken}` },
              });
              if (dr.ok) {
                const { devices } = await dr.json();
                const d = devices?.find((d: any) => d.is_active) ?? devices?.[0];
                if (d) deviceIdRef.current = d.id;
              }
            } catch { /* non-fatal */ }
          }

          if (deviceIdRef.current) {
            const queue = buildQueue("warmup", pool, playedIdsRef.current);
            if (queue.length > 0) {
              currentQueueRef.current = queue;
              console.log("[Auto-switch] Switching to HIGH BPM before workout starts");
              await withMuteTransitionRef.current(async () => {
                lastCommandRef.current = Date.now();
                await spotifyFetch(
                  `https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`,
                  {
                    method: "PUT",
                    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ uris: queue }),
                  }
                );
              });
              // Optimistically update currentTrackRef so handleStart's BPM check
              // sees the switched-to HIGH BPM track, not the old LOW BPM one
              const firstId = queue[0]?.replace("spotify:track:", "");
              const switchedTo = pool.find(t => t.id === firstId);
              if (switchedTo) currentTrackRef.current = { id: switchedTo.id, name: switchedTo.name };
              correctionAppliedRef.current = true;
            }
          }
        }
        return; // let next poll refresh UI with the corrected track
      }
      // Pool not ready yet — fall through to update UI, retry correction on next poll
      console.log(`[⏱ correction deferred] ${ts()} — pool not loaded yet, will retry next poll`);
    }

    // Freeze all UI and queue logic while a mute transition is in progress
    if (isTransitioningRef.current) return;

    const newId = data?.item?.id;

    if (newId && newId !== prevTrackIdRef.current) {
      // Push outgoing track to history so the "previous" button can go back to it
      if (prevTrackIdRef.current) {
        trackHistoryRef.current.push(`spotify:track:${prevTrackIdRef.current}`);
        if (trackHistoryRef.current.length > 20) trackHistoryRef.current.shift();
      }
      // Mark previous track as played
      if (prevTrackIdRef.current) playedIdsRef.current.add(prevTrackIdRef.current);
      prevTrackIdRef.current = newId;

      const ws = workoutStateRef.current;
      console.log(
        `[Track] ♪ "${data?.item?.name}" by ${data?.item?.artists?.[0]?.name}`,
        `| state: ${ws} | pool: ${trackPoolRef.current.length} tracks`
      );

      // Passively expand pool by merging any new tracks from the live Spotify queue
      if (ws !== "idle" && ws !== "done") {
        fetchQueueAndEnrich().then((newTracks) => {
          const existingIds = new Set(trackPoolRef.current.map((t) => t.id));
          const added = newTracks.filter((t) => !existingIds.has(t.id));
          if (added.length > 0) {
            trackPoolRef.current = [...trackPoolRef.current, ...added];
            console.log(`[Queue] Pool expanded +${added.length} tracks (total: ${trackPoolRef.current.length})`);
            recomputeQueuesRef.current();
          }
        });
      }

      // Refill queue when fewer than 5 tracks remain ahead of the current position
      if (ws !== "idle" && ws !== "done" && deviceIdRef.current) {
        const currentUri = `spotify:track:${newId}`;
        const currentIdx = currentQueueRef.current.indexOf(currentUri);
        const remaining = currentIdx >= 0 ? currentQueueRef.current.length - currentIdx : 0;

        if (remaining < 5) {
          const futureUris = currentIdx >= 0 ? currentQueueRef.current.slice(currentIdx + 1) : [];
          const excludeIds = new Set<string>(playedIdsRef.current);
          excludeIds.add(newId);
          for (const uri of futureUris) excludeIds.add(uri.replace("spotify:track:", ""));

          const newTracks = buildQueue(ws, trackPoolRef.current, excludeIds, 10);
          if (newTracks.length > 0) {
            const newFullQueue = [currentUri, ...futureUris, ...newTracks];
            currentQueueRef.current = newFullQueue;
            const posMs = data?.progress_ms || 0;
            lastCommandRef.current = Date.now();
            await spotifyFetch(
              `https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`,
              {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${session.accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  uris: newFullQueue,
                  offset: { position: 0 },
                  position_ms: posMs,
                }),
              }
            );
            console.log(`[Queue] Refilled — ${remaining} → ${newFullQueue.length} tracks`);
          }
        }
      }
    }

    setNoDevice(false);
    currentTrackRef.current = data?.item;
    setCurrentTrack(data?.item);
    setIsPlaying(data?.is_playing);
    setSongPosition(data?.progress_ms || 0);
    setSongDuration(data?.item?.duration_ms || 0);
    setSongProgress(
      data?.item?.duration_ms
        ? Math.round((data.progress_ms / data.item.duration_ms) * 100)
        : 0
    );
  }, [session, spotifyFetch]);

  useEffect(() => { fetchCurrentTrackRef.current = fetchCurrentTrack; }, [fetchCurrentTrack]);

  // Single fetch on page load to show whatever is currently playing in Spotify.
  useEffect(() => {
    if (session?.accessToken) {
      console.log(`[⏱ initial fetch] ${ts()} — page-load fetchCurrentTrack`);
      fetchCurrentTrack();
    }
  }, [fetchCurrentTrack]);

  // Preload queue + BPM on page load so Start Workout is near-instant.
  // If either HIGH or LOW bucket is empty after the initial fetch, retries up to 2×
  // before triggering the correction check — catches queue snapshots with no BPM variance.
  useEffect(() => {
    if (!session?.accessToken || preloadedRef.current) return;
    preloadedRef.current = true;
    console.log(`[⏱ preload] ${ts()} — starting fetchQueueAndEnrich`);

    (async () => {
      const initial = await fetchQueueAndEnrich();
      if (initial.length === 0) { console.log(`[⏱ preload] ${ts()} — 0 tracks returned, aborting`); return; }
      trackPoolRef.current = initial;

      let high = initial.filter(t => t.bpm != null && t.bpm >= HIGH_BPM_CUTOFF);
      let low  = initial.filter(t => t.bpm != null && t.bpm  < HIGH_BPM_CUTOFF);
      console.log(`[⏱ preload] ${ts()} — initial pool: HIGH: ${high.length}, LOW: ${low.length}`);

      // If either bucket is zero, refresh the queue snapshot up to 2 more times
      for (let attempt = 1; attempt <= 2 && (high.length === 0 || low.length === 0); attempt++) {
        console.log(`[⏱ preload] ${ts()} — bucket imbalance — refresh attempt ${attempt}/2`);
        const fresh = await fetchQueueAndEnrich();
        const existingIds = new Set(trackPoolRef.current.map(t => t.id));
        const added = fresh.filter(t => !existingIds.has(t.id));
        if (added.length > 0) trackPoolRef.current = [...trackPoolRef.current, ...added];
        high = trackPoolRef.current.filter(t => t.bpm != null && t.bpm >= HIGH_BPM_CUTOFF);
        low  = trackPoolRef.current.filter(t => t.bpm != null && t.bpm  < HIGH_BPM_CUTOFF);
        console.log(`[⏱ preload] ${ts()} — after refresh ${attempt}: HIGH: ${high.length}, LOW: ${low.length}`);
      }

      recomputeQueuesRef.current();
      console.log(`[⏱ preload] ${ts()} — triggering immediate correction check`);
      fetchCurrentTrackRef.current();
    })();
  }, [session?.accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll every 5s to detect track changes, refill queue, and track Spotify playing state.
  useEffect(() => {
    if (!session?.accessToken || workoutState === "done") return;
    console.log(`[⏱ poll] ${ts()} — 5s interval started`);
    const id = setInterval(() => fetchCurrentTrackRef.current(), 5000);
    return () => clearInterval(id);
  }, [session?.accessToken, workoutState]);

  // Advance song position locally every second while playing so the scrub bar moves
  // smoothly between 5s Spotify polls. Pauses during drag or mute transitions.
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      if (isDraggingRef.current || isTransitioningRef.current) return;
      setSongPosition(prev => {
        const next = Math.min(prev + 1000, songDuration || prev);
        setSongProgress(songDuration > 0 ? Math.round((next / songDuration) * 100) : 0);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, songDuration]);

  // Rest timer — counts down, then switches to exercising and queues HIGH BPM tracks.
  useEffect(() => {
    if (workoutState !== "resting" || !currentExercise) return;
    const duration = currentExercise.rest_seconds;
    setTimeLeft(duration);
    let remaining = duration;
    timerRef.current = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        setWorkoutState("exercising");
        playForStateRef.current("exercising");
      }
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [workoutState, currentExercise]);

  const handleStart = async () => {
    if (!session?.accessToken) return;
    feedback("heavy");

    const devicesRes = await spotifyFetch("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (devicesRes.status === 403) { setPremiumRequired(true); return; }
    if (!devicesRes.ok) { setNoDevice(true); return; }
    const { devices } = await devicesRes.json();
    const device = devices?.find((d: any) => d.is_active) ?? devices?.[0];
    if (!device) { setNoDevice(true); return; }
    setNoDevice(false);
    deviceIdRef.current = device.id;

    // Pool should already be loaded from preload
    let pool = trackPoolRef.current;
    if (pool.length === 0) {
      pool = await fetchQueueAndEnrich();
      if (pool.length === 0) { setNoQueue(true); return; }
      trackPoolRef.current = pool;
    }
    setNoQueue(false);
    playedIdsRef.current = new Set();
    recomputeQueues(); // rebuild precomputed queues with fresh played set

    // Synchronous BPM check — no async gap, no race with the correction polling loop.
    // currentTrackRef is either the last polled track or the optimistically-set switched track.
    const currentId = currentTrackRef.current?.id;
    const inPool = currentId ? pool.find(t => t.id === currentId) : undefined;
    console.log(`[⏱ handleStart] ${ts()} — currentTrack: "${currentTrackRef.current?.name ?? "none"}", bpm: ${inPool?.bpm ?? "unknown"}, corrected: ${correctionAppliedRef.current}`);
    if (currentId && inPool?.bpm != null && inPool.bpm >= HIGH_BPM_CUTOFF) {
      console.log(`[Start] Playing HIGH BPM (${inPool.bpm}) — starting timer only`);
      setWorkoutState("warmup");
      return;
    }

    // Current track is LOW/unknown BPM or Spotify was paused — switch now
    const queue = buildQueue("warmup", pool, playedIdsRef.current);
    if (queue.length > 0) {
      currentQueueRef.current = queue;
      await withMuteTransition(async () => {
        lastCommandRef.current = Date.now();
        await spotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${device.id}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ uris: queue }),
        });
      });
      console.log(`[Start] Queue built on start — ${queue.length} HIGH tracks`);
    }
    setWorkoutState("warmup");
  };

  const handleStartSet = () => { feedback("heavy"); setWorkoutState("exercising"); };

  const handleSetDone = () => {
    if (!currentExercise) return;
    feedback("heavy");
    setSetsCompleted((c) => c + 1);

    const nextExercise = exercises[currentExerciseIndex + 1];
    const nextIsSuperset =
      nextExercise?.superset_with != null &&
      nextExercise.superset_with === currentExercise.order_index;
    const currentIsSupersetB = currentExercise.superset_with != null;

    if (nextIsSuperset) {
      setCurrentExerciseIndex(currentExerciseIndex + 1);
      return;
    }

    if (currentIsSupersetB) {
      const pairedAIdx = exercises.findIndex(
        (ex) => ex.order_index === currentExercise.superset_with
      );
      if (pairedAIdx !== -1) {
        const pairedA = exercises[pairedAIdx];
        if (currentSet < pairedA.sets) {
          setCurrentExerciseIndex(pairedAIdx);
          setCurrentSet(currentSet + 1);
          setWorkoutState("resting");
          setTimeout(() => playForStateRef.current("resting"), 500);
        } else if (currentExerciseIndex + 1 < exercises.length) {
          setCurrentExerciseIndex(currentExerciseIndex + 1);
          setCurrentSet(1);
          setWorkoutState("resting");
          setTimeout(() => playForStateRef.current("resting"), 500);
        } else {
          setWorkoutState("done");
        }
        return;
      }
    }

    if (currentSet < currentExercise.sets) {
      setCurrentSet(currentSet + 1);
      setWorkoutState("resting");
      setTimeout(() => playForStateRef.current("resting"), 500);
    } else if (currentExerciseIndex < exercises.length - 1) {
      setCurrentExerciseIndex(currentExerciseIndex + 1);
      setCurrentSet(1);
      setWorkoutState("resting");
      setTimeout(() => playForStateRef.current("resting"), 500);
    } else {
      setWorkoutState("done");
    }
  };

  const togglePlayPause = async () => {
    if (!session?.accessToken) return;
    const next = !isPlaying;
    setIsPlaying(next);
    lastCommandRef.current = Date.now();
    await spotifyFetch(`https://api.spotify.com/v1/me/player/${next ? "play" : "pause"}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
  };

  // After a skip/prev, check the incoming track's BPM against the current workout state.
  // If it's the wrong bucket, hand off to playForState (precomputed queue + retry + fallback)
  // which handles the switch and unmute. Returns true if a correction was made (caller skips fade-up).
  const verifyAndCorrectBpm = useCallback(async (vol: number): Promise<boolean> => {
    const ws = workoutStateRef.current;
    if (ws === "idle" || ws === "done") return false;

    const cpRes = await spotifyFetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${session?.accessToken ?? ""}` },
    });
    if (!cpRes.ok || cpRes.status === 204) return false;

    const cpData = await cpRes.json();
    const trackId = cpData?.item?.id;
    const inPool = trackId ? trackPoolRef.current.find(t => t.id === trackId) : undefined;
    if (!inPool?.bpm) return false; // unknown BPM — let it play

    const wantHigh = ws === "warmup" || ws === "exercising";
    const isHigh = inPool.bpm >= HIGH_BPM_CUTOFF;
    if (isHigh === wantHigh) return false; // correct bucket — no correction needed

    console.log(`[BPM check] "${cpData.item?.name}" is ${isHigh ? "HIGH" : "LOW"} (${inPool.bpm} BPM) but state is ${ws} — correcting`);
    // Already muted. playForState → withMuteTransition reads originalVolumeRef (not current 0) → restores correctly.
    await playForStateRef.current(ws);
    return true;
  }, [session, spotifyFetch]);

  const fadeUp = useCallback(async (vol: number) => {
    for (let i = 1; i <= 5; i++) {
      await spotifyFetch(
        `https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round((vol * i) / 5)}`,
        { method: "PUT", headers: { Authorization: `Bearer ${session?.accessToken ?? ""}` } },
      );
      if (i < 5) await new Promise(r => setTimeout(r, 80));
    }
  }, [session, spotifyFetch]);

  const skipTrack = async () => {
    if (!session?.accessToken) return;
    const vol = originalVolumeRef.current;
    setIsTransitioning(true);
    isTransitioningRef.current = true;
    lastCommandRef.current = Date.now() - 1200;

    try {
      // Mute + skip fire in the same tick — zero async gap before mute
      await Promise.all([
        spotifyFetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=0`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }),
        spotifyFetch("https://api.spotify.com/v1/me/player/next", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }),
      ]);

      await new Promise(r => setTimeout(r, 500));

      // Verify the incoming track's BPM matches the current state before unmuting
      const corrected = await verifyAndCorrectBpm(vol);
      if (!corrected) await fadeUp(vol);
    } finally {
      lastCommandRef.current = 0;
      setIsTransitioning(false);
      isTransitioningRef.current = false;
      fetchCurrentTrack();
    }
  };

  const prevTrack = async () => {
    if (!session?.accessToken) return;
    // Spotify's /me/player/previous 403s when the app uses a custom uris queue
    // (no playlist context). Use app-side history instead.
    const history = trackHistoryRef.current;
    if (history.length === 0) return;

    // Lazily resolve device if needed
    if (!deviceIdRef.current) {
      try {
        const dr = await spotifyFetch("https://api.spotify.com/v1/me/player/devices", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (dr.ok) {
          const { devices } = await dr.json();
          const d = devices?.find((d: any) => d.is_active) ?? devices?.[0];
          if (d) deviceIdRef.current = d.id;
        }
      } catch { /* non-fatal */ }
    }
    if (!deviceIdRef.current) return;

    const prevUri = history.pop()!;
    const vol = originalVolumeRef.current;
    setIsTransitioning(true);
    isTransitioningRef.current = true;
    lastCommandRef.current = Date.now();

    try {
      await Promise.all([
        spotifyFetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=0`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }),
        spotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ uris: [prevUri] }),
        }),
      ]);

      await new Promise(r => setTimeout(r, 500));

      // Verify the incoming track's BPM matches the current state before unmuting
      const corrected = await verifyAndCorrectBpm(vol);
      if (!corrected) await fadeUp(vol);
    } finally {
      lastCommandRef.current = 0;
      setIsTransitioning(false);
      isTransitioningRef.current = false;
      fetchCurrentTrack();
    }
  };

  const getProgressFromX = (clientX: number): number => {
    if (!progressBarRef.current) return 0;
    const rect = progressBarRef.current.getBoundingClientRect();
    return Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
  };

  const seekTo = async (fraction: number) => {
    const positionMs = Math.floor(fraction * songDuration);
    lastCommandRef.current = Date.now();
    setSongPosition(positionMs);
    setSongProgress(Math.round(fraction * 100));
    if (!session?.accessToken || !songDuration) return;
    await spotifyFetch(
      `https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`,
      { method: "PUT", headers: { Authorization: `Bearer ${session.accessToken}` } }
    );
  };

  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    setIsDragging(true);
    setDragProgress(getProgressFromX(e.clientX));
  };

  const handleProgressPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    setDragProgress(getProgressFromX(e.clientX));
  };

  const handleProgressPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    seekTo(getProgressFromX(e.clientX));
  };

  if (loading) return <LoadingScreen />;

  if (exercises.length === 0)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-4 p-8 text-center">
        <p className="text-red-400 text-lg font-semibold">No exercises found</p>
        <p className="text-gray-500 text-sm max-w-xs">
          The exercises failed to save. Open the browser console for the exact error — you likely need to run:
        </p>
        <code className="card-metallic text-blue-400 text-xs px-4 py-3 rounded-xl">
          ALTER TABLE exercises ADD COLUMN superset_with integer;
        </code>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-gray-400 hover:text-white underline text-sm mt-2"
        >
          Back to dashboard
        </button>
      </div>
    );

  if (workoutState === "done")
    return (
      <>
        <div className="fixed inset-0 bg-[#0a0a0f]" style={{ zIndex: -1 }} />
        <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0, background: 'radial-gradient(ellipse 55% 35% at 50% 0%, #10b98188 0%, transparent 100%), radial-gradient(ellipse 90% 55% at 50% 0%, #10b98144 0%, transparent 100%), radial-gradient(ellipse 120% 80% at 50% 0%, #10b98118 0%, transparent 100%)' }} />
        <div className="relative flex flex-col items-center justify-center min-h-screen text-white gap-6" style={{ zIndex: 1 }}>
          <h1 className="text-5xl">💪</h1>
          <h1 className="text-4xl font-bold tracking-wide">Workout Complete!</h1>
          <p className="text-[#64748b]">{totalSets} sets crushed</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-8 py-4 rounded-xl text-lg mt-4 active:scale-95 transition-transform btn-animated"
          >
            Back to Dashboard
          </button>
        </div>
      </>
    );

  const glowColors: Partial<Record<WorkoutState, string>> = {
    warmup: '#f59e0b',
    exercising: '#ef4444',
    resting: '#3b82f6',
    done: '#10b981',
  };

  const accentColors: Record<WorkoutState, string> = {
    idle: "text-gray-400",
    warmup: "text-amber-400",
    exercising: "text-red-400",
    resting: "text-blue-400",
    done: "text-white",
  };

  const badgeColors: Record<WorkoutState, string> = {
    idle: "bg-gray-700",
    warmup: "bg-amber-500",
    exercising: "bg-red-500",
    resting: "bg-blue-500",
    done: "bg-green-500",
  };

  const statusLabels: Record<WorkoutState, string> = {
    idle: "Ready",
    warmup: "Warmup",
    exercising: "Exercising",
    resting: "Resting",
    done: "Done",
  };

  return (
    <>
      <div className="fixed inset-0 bg-[#0a0a0f]" style={{ zIndex: -1 }} />
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        {(Object.entries(glowColors) as [WorkoutState, string][]).map(([state, color]) => (
          <div key={state} style={{
            position: 'absolute', inset: 0,
            background: [
              `radial-gradient(ellipse 55% 35% at 50% 0%, ${color}88 0%, transparent 100%)`,
              `radial-gradient(ellipse 90% 55% at 50% 0%, ${color}44 0%, transparent 100%)`,
              `radial-gradient(ellipse 120% 80% at 50% 0%, ${color}18 0%, transparent 100%)`,
            ].join(', '),
            opacity: workoutState === state ? 1 : 0,
            transition: 'opacity 700ms ease',
          }} />
        ))}
      </div>
      <div className="relative min-h-screen text-white flex flex-col items-center justify-between p-8" style={{ zIndex: 1 }}>
      {(noDevice || noQueue || premiumRequired) && (
        <div
          className={`fixed top-0 left-0 right-0 z-50 backdrop-blur-sm text-sm text-center py-2.5 px-4 ${
            premiumRequired
              ? "bg-red-900/90 text-red-200"
              : "bg-amber-900/90 text-amber-200"
          }`}
        >
          {premiumRequired
            ? "LiftSync requires Spotify Premium"
            : noQueue
            ? "Start playing a playlist in Spotify first, then tap Start Workout"
            : "Open Spotify on your device, then tap Start Workout"}
        </div>
      )}

      {/* Top */}
      <div className={`text-center w-full ${(noDevice || noQueue || premiumRequired) ? "mt-12" : "mt-4"}`}>
        <p className="text-gray-400 text-xs uppercase tracking-widest mb-2">
          Exercise {currentExerciseIndex + 1} of {exercises.length}
        </p>
        {isInSuperset && (
          <span className="inline-block bg-blue-500/20 text-blue-400 text-xs font-bold px-3 py-0.5 rounded-full uppercase tracking-widest border border-blue-500/30 mb-2">
            Superset
          </span>
        )}
        <h2 className="text-2xl font-bold">{currentExercise?.name || "—"}</h2>
        <p className="text-gray-400 mt-1 text-sm">
          {currentExercise?.reps} reps · Set {currentSet} of {currentExercise?.sets}
        </p>
      </div>

      {/* Middle */}
      <div className="flex flex-col items-center gap-5 w-full max-w-sm">
        <span
          className={`${badgeColors[workoutState]} text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-widest`}
        >
          {statusLabels[workoutState]}
        </span>

        {workoutState === "resting" && (
          <p className={`text-7xl font-bold ${accentColors[workoutState]}`}>
            {formatTime(timeLeft)}
          </p>
        )}

        <div className="relative">
          {currentTrack?.album?.images?.[0] ? (
            <img
              src={currentTrack.album.images[0].url}
              className={`w-52 h-52 rounded-2xl shadow-2xl transition-opacity duration-300 ${isTransitioning ? "opacity-30" : "opacity-100"}`}
            />
          ) : (
            <div className="w-52 h-52 rounded-2xl bg-gray-800 flex items-center justify-center text-5xl">
              ♪
            </div>
          )}
          {isTransitioning && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
              <p className="text-white/90 text-xs font-semibold tracking-wide text-center px-4">
                Getting your music ready…
              </p>
            </div>
          )}
        </div>

        <div className={`text-center transition-opacity duration-300 ${isTransitioning ? "opacity-30 animate-pulse" : ""}`}>
          <p className="font-semibold text-lg">{currentTrack?.name || "No track playing"}</p>
          <p className="text-gray-400 text-sm">{currentTrack?.artists?.[0]?.name}</p>
        </div>

        {/* Interactive progress bar */}
        <div className="w-full select-none">
          <div
            ref={progressBarRef}
            className="w-full bg-gray-700 rounded-full h-1.5 mb-2 cursor-pointer relative group"
            onPointerDown={handleProgressPointerDown}
            onPointerMove={handleProgressPointerMove}
            onPointerUp={handleProgressPointerUp}
            onPointerCancel={handleProgressPointerUp}
          >
            <div
              className="bg-white rounded-full h-1.5 pointer-events-none"
              style={{ width: `${displayProgress}%` }}
            />
            <div
              className={`absolute top-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md pointer-events-none transition-opacity ${isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              style={{ left: `${displayProgress}%`, transform: "translate(-50%, -50%)" }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>{formatMs(displayPosition)}</span>
            <span>-{formatMs(Math.max(0, songDuration - displayPosition))}</span>
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-8">
          <button
            onClick={prevTrack}
            className="text-gray-400 active:text-white transition-colors touch-manipulation"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>
          <button
            onClick={togglePlayPause}
            className="text-white active:scale-95 transition-transform touch-manipulation"
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-14 h-14">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-14 h-14">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button
            onClick={skipTrack}
            className="text-gray-400 active:text-white transition-colors touch-manipulation"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
              <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Bottom */}
      <div className="w-full max-w-sm mb-4 flex flex-col gap-4">
        {workoutState === "idle" && spotifyPlaying === false && (
          <div className="card-metallic rounded-2xl p-4 text-center flex flex-col gap-3">
            <p className="text-amber-400 text-sm font-medium">
              Open Spotify and play a playlist to begin
            </p>
            <a
              href="spotify://"
              className="inline-block bg-[#1DB954] text-white text-sm font-bold px-5 py-2.5 rounded-xl active:scale-95 transition-transform"
            >
              Open Spotify
            </a>
          </div>
        )}
        {workoutState === "idle" && (
          <button
            onClick={handleStart}
            disabled={spotifyPlaying !== true || isTransitioning}
            className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-5 rounded-2xl text-xl touch-manipulation active:scale-95 transition-all btn-animated"
          >
            Start Workout 🔥
          </button>
        )}
        {workoutState === "warmup" && (
          <button
            onClick={handleStartSet}
            className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-5 rounded-2xl text-xl touch-manipulation active:scale-95 transition-transform btn-animated"
          >
            Start Set 💪
          </button>
        )}
        {workoutState === "exercising" && (
          <button
            onClick={handleSetDone}
            className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-5 rounded-2xl text-xl touch-manipulation active:scale-95 transition-transform btn-animated"
          >
            Done with Set ✓
          </button>
        )}

        <div className="w-full">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Workout Progress</span>
            <span>{workoutProgress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${workoutProgress}%` }}
            />
          </div>
        </div>

        <p className="text-center text-gray-600 text-xs">
          BPM data provided by{" "}
          <a href="https://songstats.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400 transition">
            Songstats
          </a>
        </p>
      </div>
    </div>
    </>
  );
}
