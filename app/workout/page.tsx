"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { feedback } from "@/lib/feedback";
import LoadingScreen from "../components/LoadingScreen";
import MetallicCanvas from "../components/MetallicCanvas";
import { HIGH_BPM_CUTOFF } from "@/lib/constants";
import { setNavDir } from "@/lib/nav";
import { loadDjMode, saveDjMode, type DjMode } from "@/lib/djMode";

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

function BpmBadge({ bpm }: { bpm: number | null }) {
  if (bpm === null)
    return <span className="text-xs font-medium text-gray-500 bg-gray-700/40 border border-gray-600/30 px-2.5 py-0.5 rounded-full whitespace-nowrap">—</span>;
  if (bpm >= HIGH_BPM_CUTOFF)
    return <span className="text-xs font-medium text-red-400 bg-red-500/15 border border-red-500/25 px-2.5 py-0.5 rounded-full whitespace-nowrap">High BPM</span>;
  return <span className="text-xs font-medium text-blue-400 bg-blue-500/15 border border-blue-500/25 px-2.5 py-0.5 rounded-full whitespace-nowrap">Low BPM</span>;
}

const _pageLoad = Date.now();
const ts = () => `+${Date.now() - _pageLoad}ms`;

export default function Workout() {
  return <Suspense><WorkoutInner /></Suspense>;
}

function WorkoutInner() {
  const searchParams = useSearchParams();
  const { data: session, update: updateSession } = useSession();
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
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [spotifyPlaying, setSpotifyPlaying] = useState<boolean | null>(null);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [restingDots, setRestingDots] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [queueTracks, setQueueTracks] = useState<TrackBpm[]>([]);
  const [queueLoaded, setQueueLoaded] = useState(false);

  useEffect(() => {
    if (!toastMessage) return;
    const id = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(id);
  }, [toastMessage]);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastCommandRef = useRef<number>(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const prevTrackIdRef = useRef<string | null>(null);
  const trackHistoryRef = useRef<string[]>([]);
  const rateLimitUntilRef = useRef<number>(0);
  const workoutStateRef = useRef<WorkoutState>("idle");
  const fetchCurrentTrackRef = useRef<() => Promise<void>>(async () => {});

  // BPM-enriched track cache — grows over the session as tracks are looked up
  const trackPoolRef = useRef<TrackBpm[]>([]);
  // Track IDs that have already played this workout
  const playedIdsRef = useRef<Set<string>>(new Set());
  // Active Spotify device ID
  const deviceIdRef = useRef<string | null>(null);
  const originalVolumeRef = useRef<number>(50);
  const captureVolumeRef = useRef<() => Promise<number>>(async () => originalVolumeRef.current);
  const isTransitioningRef = useRef(false);
  const currentTrackRef = useRef<any>(null);
  const withMuteTransitionRef = useRef<(fn: () => Promise<void>) => Promise<void>>(async (fn) => fn());
  // True once idle-state BPM correction has run (prevents re-entry)
  const correctionAppliedRef = useRef(false);
  // Stores the triggerRestingBpm setTimeout so prevTrack can cancel it before it fires
  const restingBpmTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fadeUpRef = useRef<(vol: number) => Promise<void>>(async () => {});
  const precomputedHighSkipsRef = useRef<number | null>(null);
  const precomputedLowSkipsRef = useRef<number | null>(null);
  const precomputeSkipCountsRef = useRef<() => Promise<void>>(async () => {});
  const skipToTargetBpmRef = useRef<(state: WorkoutState) => Promise<boolean>>(async () => false);
  const queueTracksRef = useRef<TrackBpm[]>([]);
  const [djMode, setDjMode] = useState<DjMode>("responsive");
  const djModeRef = useRef<DjMode>("responsive");
  // In Chill mode, state-change skips are deferred until the next natural track end.
  const pendingBpmStateRef = useRef<WorkoutState | null>(null);

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
    if (!session?.user?.name) return;
    loadDjMode(session.user.name).then(mode => {
      setDjMode(mode);
      djModeRef.current = mode;
    });
  }, [session?.user?.name]);

  useEffect(() => {
    if (!workoutId) return;
    supabase
      .from("exercises")
      .select("*")
      .eq("workout_id", workoutId)
      .order("order_index")
      .then(({ data, error }) => {
        if (error) console.error("[LiftBeat] Exercise load error:", error);
        if (data) setExercises(data);
        setLoading(false);
      });
  }, [workoutId]);

  // Global Spotify fetch wrapper — handles rate limits and transparent token refresh on 401.
  const spotifyFetch = useCallback(async (url: string, options?: RequestInit): Promise<Response> => {
    if (Date.now() < rateLimitUntilRef.current) {
      const remaining = Math.ceil((rateLimitUntilRef.current - Date.now()) / 1000);
      console.log(`[Spotify] Rate limited for ${remaining}s more`);
      return new Response(null, { status: 429 });
    }

    let res = await fetch(url, options);

    if (res.status === 401) {
      console.log("[Spotify] 401 — refreshing token and retrying");
      const updated = await updateSession();
      const newToken = updated?.accessToken;
      if (newToken) {
        res = await fetch(url, {
          ...options,
          headers: {
            ...(options?.headers as Record<string, string> ?? {}),
            Authorization: `Bearer ${newToken}`,
          },
        });
      }
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "10", 10);
      console.log(`[Spotify] Rate limited — blocking ${retryAfter}s`);
      rateLimitUntilRef.current = Date.now() + retryAfter * 1000;
    }
    return res;
  }, [updateSession]);

  // Reads device.volume_percent and stores it in originalVolumeRef before any mute.
  // Falls back to the last stored value (default 50) if the fetch fails or returns 0.
  const captureVolume = useCallback(async (): Promise<number> => {
    try {
      const res = await fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: `Bearer ${session?.accessToken ?? ""}` },
      });
      if (res.ok) {
        const data = await res.json();
        const v = data?.device?.volume_percent;
        if (typeof v === "number" && v > 0) {
          originalVolumeRef.current = v;
          return v;
        }
      }
    } catch { /* non-fatal */ }
    return originalVolumeRef.current;
  }, [session]);
  useEffect(() => { captureVolumeRef.current = captureVolume; }, [captureVolume]);

  // Mute → run play command → wait for track start → fade volume back up.
  // Guarantees volume is always restored even if the transition errors.
  const withMuteTransition = useCallback(async (playFn: () => Promise<void>) => {
    if (!session?.accessToken) { await playFn(); return; }

    const vol = await captureVolumeRef.current();
    let volumeRestored = false;
    setIsTransitioning(true);
    isTransitioningRef.current = true;

    try {
      await spotifyFetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=0`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });

      await playFn();

      await new Promise(r => setTimeout(r, 500));

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

  // Fetch queue snapshot, BPM-enrich unknowns, compute how many skips to the next HIGH and LOW track.
  const precomputeSkipCounts = useCallback(async () => {
    if (!session?.accessToken) return;
    let allTracks: { id: string; name: string; artists: string[] }[] = [];
    let currentlyPlayingId: string | null = null;
    try {
      const qRes = await fetch("/api/queue-tracks");
      if (qRes.ok) {
        const body = await qRes.json();
        allTracks = body.tracks ?? [];
        currentlyPlayingId = body.currentlyPlayingId ?? null;
      }
    } catch { /* non-fatal */ }

    const unknownTracks = allTracks.filter(t => !trackPoolRef.current.some(p => p.id === t.id));
    if (unknownTracks.length > 0) {
      try {
        const bpmRes = await fetch("/api/playlist-bpm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tracks: unknownTracks }),
        });
        if (bpmRes.ok) {
          const result = await bpmRes.json();
          const enriched: TrackBpm[] = [
            ...(result.high ?? []),
            ...(result.low ?? []),
            ...(result.unknown ?? []),
          ];
          const existingIds = new Set(trackPoolRef.current.map(t => t.id));
          const added = enriched.filter(t => !existingIds.has(t.id));
          if (added.length > 0) trackPoolRef.current = [...trackPoolRef.current, ...added];
        }
      } catch { /* non-fatal */ }
    }

    const upcoming = allTracks.filter(t => t.id !== currentlyPlayingId);
    let highSkips: number | null = null;
    let lowSkips: number | null = null;
    for (let i = 0; i < upcoming.length; i++) {
      const bpm = trackPoolRef.current.find(p => p.id === upcoming[i].id)?.bpm;
      if (bpm == null) continue;
      if (highSkips === null && bpm >= HIGH_BPM_CUTOFF) highSkips = i + 1;
      if (lowSkips === null && bpm < HIGH_BPM_CUTOFF) lowSkips = i + 1;
      if (highSkips !== null && lowSkips !== null) break;
    }
    precomputedHighSkipsRef.current = highSkips;
    precomputedLowSkipsRef.current = lowSkips;
    console.log(`[Precompute] HIGH in ${highSkips ?? "none"} skip(s), LOW in ${lowSkips ?? "none"} skip(s)`);
  }, [session]);

  useEffect(() => { precomputeSkipCountsRef.current = precomputeSkipCounts; }, [precomputeSkipCounts]);

  // Fire N skips to land on the correct BPM bucket. Never POSTs to queue.
  const skipToTargetBpm = useCallback(async (state: WorkoutState): Promise<boolean> => {
    if (!session?.accessToken) return false;
    if (state === "idle" || state === "done") return false;
    const wantHigh = state === "warmup" || state === "exercising";
    const skipCount = wantHigh ? precomputedHighSkipsRef.current : precomputedLowSkipsRef.current;
    const bucket = wantHigh ? "HIGH" : "LOW";
    if (skipCount === null) {
      console.log(`[Skip] No pre-computed ${bucket} target in queue — keeping current`);
      setToastMessage(`No ${wantHigh ? "high" : "low"} BPM track found nearby — keeping current`);
      return false;
    }
    console.log(`[Skip] state=${state} target=${bucket} — firing ${skipCount} skip(s)`);
    await withMuteTransition(async () => {
      lastCommandRef.current = Date.now();
      for (let i = 0; i < skipCount; i++) {
        await spotifyFetch("https://api.spotify.com/v1/me/player/next", {
          method: "POST",
          headers: { Authorization: `Bearer ${session!.accessToken!}` },
        });
      }
      await new Promise(r => setTimeout(r, 500));
      const cpRes = await spotifyFetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: `Bearer ${session!.accessToken!}` },
      });
      if (cpRes.ok && cpRes.status !== 204) {
        const cpData = await cpRes.json();
        const nowId = cpData?.item?.id;
        const nowBpm = nowId ? trackPoolRef.current.find(p => p.id === nowId)?.bpm : null;
        console.log(`[Skip] Landed on "${cpData?.item?.name}" (${nowBpm ?? "?"} BPM)`);
        if (nowId) playedIdsRef.current.add(nowId);
      }
    });
    precomputeSkipCountsRef.current();
    return true;
  }, [session, spotifyFetch, withMuteTransition]);

  useEffect(() => { skipToTargetBpmRef.current = skipToTargetBpm; }, [skipToTargetBpm]);

  useEffect(() => {
    workoutStateRef.current = workoutState;
    console.log(`[State] → ${workoutState}`);
  }, [workoutState]);

  // Fetch current track and update UI. Also handles idle-state BPM correction and track-change bookkeeping.
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

    // Log what Spotify returns on every poll before idle correction fires (new-session first-look)
    if (!correctionAppliedRef.current && data?.item?.id) {
      console.log(`[First-poll] Spotify currently-playing: "${data.item.name}" uri=spotify:track:${data.item.id} is_playing=${data.is_playing}`);
    }

    // Idle correction: mute is the very first action on any playback detection — before BPM
    // check or track identification. Volume only comes back once HIGH BPM is confirmed playing.
    if (workoutStateRef.current === "idle" && !correctionAppliedRef.current && data?.is_playing) {
      correctionAppliedRef.current = true;
      setIsTransitioning(true);
      isTransitioningRef.current = true;

      try {
        // Capture volume before muting so we can restore to the correct level later
        await captureVolumeRef.current();

        // Mute FIRST — before any BPM analysis or track identification
        await spotifyFetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=0`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${session!.accessToken!}` },
        });

        if (!data?.item?.id) {
          // No track info available — restore volume and bail
          await fadeUpRef.current(originalVolumeRef.current);
          return;
        }

        // Enrich BPM for the current track if not already cached
        let inPool = trackPoolRef.current.find(t => t.id === data.item.id);
        if (!inPool) {
          try {
            const bpmRes = await fetch("/api/playlist-bpm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tracks: [{
                  id: data.item.id,
                  name: data.item.name,
                  artists: data.item.artists?.map((a: { name: string }) => a.name) ?? [],
                }],
              }),
            });
            if (bpmRes.ok) {
              const result = await bpmRes.json();
              const enriched: TrackBpm[] = [
                ...(result.high ?? []),
                ...(result.low ?? []),
                ...(result.unknown ?? []),
              ];
              const found = enriched.find(t => t.id === data.item.id);
              if (found) {
                trackPoolRef.current = [...trackPoolRef.current, found];
                inPool = found;
              }
            }
          } catch { /* non-fatal */ }
        }

        const isConfirmedHigh = inPool?.bpm != null && inPool.bpm >= HIGH_BPM_CUTOFF;
        console.log(`[Idle correction] "${data.item.name}" — bpm: ${inPool?.bpm ?? "unknown"}, confirmed HIGH: ${isConfirmedHigh}`);

        if (isConfirmedHigh) {
          // Confirmed HIGH BPM — fade up, done
          await fadeUpRef.current(originalVolumeRef.current);
        } else {
          // LOW or unknown — precompute then skip to HIGH; withMuteTransition sees vol=0, restores correctly
          await precomputeSkipCountsRef.current();
          const switched = await skipToTargetBpmRef.current("warmup");
          if (!switched) await fadeUpRef.current(originalVolumeRef.current);
        }
      } finally {
        setIsTransitioning(false);
        isTransitioningRef.current = false;
      }
      return;
    }

    if (isTransitioningRef.current) return;

    const newId = data?.item?.id;

    if (newId && newId !== prevTrackIdRef.current) {
      if (prevTrackIdRef.current) {
        trackHistoryRef.current.push(`spotify:track:${prevTrackIdRef.current}`);
        if (trackHistoryRef.current.length > 20) trackHistoryRef.current.shift();
      }
      if (prevTrackIdRef.current) playedIdsRef.current.add(prevTrackIdRef.current);
      prevTrackIdRef.current = newId;

      const trackBpm = trackPoolRef.current.find(p => p.id === newId)?.bpm;
      console.log(
        `[Track] ♪ "${data?.item?.name}" by ${data?.item?.artists?.[0]?.name}`,
        `| bpm: ${trackBpm ?? "unknown"} | state: ${workoutStateRef.current} | pool: ${trackPoolRef.current.length} tracks`
      );

      // Chill mode: fire the deferred BPM transition now that a new track has started naturally
      if (djModeRef.current === "chill" && pendingBpmStateRef.current && workoutStateRef.current !== "done") {
        const pendingState = pendingBpmStateRef.current;
        pendingBpmStateRef.current = null;
        const wantHigh = pendingState === "warmup" || pendingState === "exercising";
        const requiredCat = wantHigh ? "HIGH" : "LOW";
        const landedBpm = newId ? trackPoolRef.current.find(p => p.id === newId)?.bpm : null;
        const landedCat = landedBpm == null ? "UNKNOWN" : landedBpm >= HIGH_BPM_CUTOFF ? "HIGH" : "LOW";
        console.log(`[Chill/natural] Song ended. state=${workoutStateRef.current} requires ${requiredCat} | landed bpm=${landedBpm ?? "?"} (${landedCat})`);
        if (landedBpm != null && landedCat === requiredCat) {
          console.log(`[Chill/natural] ✓ Already correct BPM — no skip needed`);
          precomputeSkipCountsRef.current();
        } else {
          console.log(`[Chill/natural] ✗ Wrong category — precomputing then skipping to ${requiredCat}`);
          precomputeSkipCountsRef.current().then(() => skipToTargetBpmRef.current(pendingState));
        }
      } else {
        precomputeSkipCountsRef.current();
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

  useEffect(() => {
    if (session?.accessToken) {
      console.log(`[⏱ initial fetch] ${ts()} — page-load fetchCurrentTrack`);
      fetchCurrentTrack();
    }
  }, [fetchCurrentTrack]);

  // Poll every 1s in idle state (fast BPM detection), 5s once the workout is running.
  useEffect(() => {
    if (!session?.accessToken || workoutState === "done") return;
    const interval = workoutState === "idle" ? 1000 : 5000;
    console.log(`[⏱ poll] ${ts()} — ${interval}ms interval started`);
    const id = setInterval(() => fetchCurrentTrackRef.current(), interval);
    return () => clearInterval(id);
  }, [session?.accessToken, workoutState]);

  // Advance song position locally every second so the scrub bar moves smoothly between polls.
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

  // Rest timer — counts down, then nudges HIGH BPM and switches to exercising.
  // NOTE: auto BPM switching does not work when the tab is backgrounded or the device screen
  // is locked — browsers throttle timers. Native wrapping is required to fix this properly.
  useEffect(() => {
    if (workoutState !== "resting" || !currentExercise) return;
    const duration = currentExercise.rest_seconds;
    setTimeLeft(duration);
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, duration - Math.floor((Date.now() - startTime) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        setWorkoutState("exercising");
        if (djModeRef.current === "responsive") {
          skipToTargetBpmRef.current("exercising");
        } else {
          pendingBpmStateRef.current = "exercising";
        }
      }
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [workoutState, currentExercise]);

  useEffect(() => {
    if (workoutState !== "resting") { setRestingDots(0); return; }
    const id = setInterval(() => setRestingDots(d => (d + 1) % 4), 500);
    return () => clearInterval(id);
  }, [workoutState]);

  // Keep queueTracksRef in sync so the polling closure always sees the latest value.
  useEffect(() => { queueTracksRef.current = queueTracks; }, [queueTracks]);

  // Fetch queue every 5s while the panel is open; stop when closed.
  useEffect(() => {
    if (!showQueuePanel) {
      setQueueTracks([]);
      setQueueLoaded(false);
      return;
    }
    if (!session?.accessToken) return;

    let cancelled = false;

    const fetchQueue = async () => {
      try {
        const res = await fetch("/api/queue-tracks");
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const currentlyPlayingId: string | null = body.currentlyPlayingId ?? currentTrack?.id ?? null;
        const rawTracks: { id: string; name: string; artists: string[] }[] =
          (body.tracks ?? []).filter((t: { id: string }) => t.id !== currentlyPlayingId);

        const merged: TrackBpm[] = rawTracks.map(t => ({
          ...t,
          bpm: trackPoolRef.current.find(p => p.id === t.id)?.bpm ?? null,
        }));

        // Only re-render if IDs or resolved BPMs changed.
        const newSig = merged.map(t => `${t.id}:${t.bpm}`).join("|");
        const curSig = queueTracksRef.current.map(t => `${t.id}:${t.bpm}`).join("|");
        if (newSig !== curSig && !cancelled) setQueueTracks(merged);
        if (!cancelled) setQueueLoaded(true);

        // Background BPM enrichment for tracks not yet in the pool.
        const unknown = rawTracks.filter(t =>
          trackPoolRef.current.find(p => p.id === t.id)?.bpm == null
        );
        if (unknown.length > 0 && !cancelled) {
          fetch("/api/playlist-bpm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tracks: unknown }),
          })
            .then(r => r.ok ? r.json() : null)
            .then(result => {
              if (!result || cancelled) return;
              const enriched: TrackBpm[] = [
                ...(result.high ?? []),
                ...(result.low ?? []),
                ...(result.unknown ?? []),
              ];
              const existingIds = new Set(trackPoolRef.current.map(t => t.id));
              const added = enriched.filter(t => !existingIds.has(t.id));
              if (added.length > 0) {
                trackPoolRef.current = [...trackPoolRef.current, ...added];
                if (!cancelled) {
                  setQueueTracks(prev => prev.map(t => ({
                    ...t,
                    bpm: trackPoolRef.current.find(p => p.id === t.id)?.bpm ?? t.bpm,
                  })));
                }
              }
            })
            .catch(() => {});
        }
      } catch { /* non-fatal */ }
    };

    fetchQueue();
    const id = setInterval(fetchQueue, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [showQueuePanel, session?.accessToken]);

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

    playedIdsRef.current = new Set();
    setWorkoutState("warmup");
  };

  const handleStartSet = () => { feedback("heavy"); setWorkoutState("exercising"); };

  const triggerRestingBpm = () => {
    if (djModeRef.current === "responsive") {
      if (restingBpmTimerRef.current) clearTimeout(restingBpmTimerRef.current);
      restingBpmTimerRef.current = setTimeout(() => {
        restingBpmTimerRef.current = null;
        skipToTargetBpmRef.current("resting");
      }, 500);
    } else {
      pendingBpmStateRef.current = "resting";
    }
  };

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
          triggerRestingBpm();
        } else if (currentExerciseIndex + 1 < exercises.length) {
          setCurrentExerciseIndex(currentExerciseIndex + 1);
          setCurrentSet(1);
          setWorkoutState("resting");
          triggerRestingBpm();
        } else {
          setWorkoutState("done");
        }
        return;
      }
    }

    if (currentSet < currentExercise.sets) {
      setCurrentSet(currentSet + 1);
      setWorkoutState("resting");
      triggerRestingBpm();
    } else if (currentExerciseIndex < exercises.length - 1) {
      setCurrentExerciseIndex(currentExerciseIndex + 1);
      setCurrentSet(1);
      setWorkoutState("resting");
      triggerRestingBpm();
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
    if (next && workoutStateRef.current === "idle" && !correctionAppliedRef.current) {
      await new Promise(r => setTimeout(r, 800));
      lastCommandRef.current = 0;
      fetchCurrentTrackRef.current();
    }
  };

  // After a skip/prev, verify the incoming track's BPM matches the current state.
  // If wrong bucket, nudge to correct BPM. Returns true if a correction was made.
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
    if (!inPool?.bpm) return false;

    const wantHigh = ws === "warmup" || ws === "exercising";
    const isHigh = inPool.bpm >= HIGH_BPM_CUTOFF;
    if (isHigh === wantHigh) return false;

    console.log(`[BPM check] "${cpData.item?.name}" is ${isHigh ? "HIGH" : "LOW"} (${inPool.bpm} BPM) but state is ${ws} — correcting`);
    await precomputeSkipCountsRef.current();
    return await skipToTargetBpmRef.current(ws);
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
  useEffect(() => { fadeUpRef.current = fadeUp; }, [fadeUp]);

  const skipTrack = async () => {
    if (!session?.accessToken) return;
    const vol = await captureVolumeRef.current();
    setIsTransitioning(true);
    isTransitioningRef.current = true;
    lastCommandRef.current = Date.now() - 1200;

    try {
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

      // Quick poll to display new track info while BPM verification/fade-up are still in progress
      let landedTrackId: string | null = null;
      const quickRes = await spotifyFetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (quickRes.ok && quickRes.status !== 204) {
        const quickData = await quickRes.json();
        if (quickData?.item) {
          landedTrackId = quickData.item.id ?? null;
          currentTrackRef.current = quickData.item;
          setCurrentTrack(quickData.item);
          setIsPlaying(quickData.is_playing ?? false);
        }
      }

      // Chill mode: manual skip acts as the trigger — clear the deferred state now so
      // fetchCurrentTrack won't fire it again. Log the decision before verifyAndCorrectBpm runs.
      if (djModeRef.current === "chill") {
        const ws = workoutStateRef.current;
        const wantHigh = ws === "warmup" || ws === "exercising";
        const requiredCat = wantHigh ? "HIGH" : "LOW";
        const landedBpm = landedTrackId ? trackPoolRef.current.find(p => p.id === landedTrackId)?.bpm : null;
        const landedCat = landedBpm == null ? "UNKNOWN" : landedBpm >= HIGH_BPM_CUTOFF ? "HIGH" : "LOW";
        console.log(`[Chill/skip] state=${ws} requires ${requiredCat} | landed bpm=${landedBpm ?? "?"} (${landedCat})`);
        if (landedBpm != null && landedCat === requiredCat) {
          console.log(`[Chill/skip] ✓ Already correct BPM — clearing pending, no additional skip`);
        } else {
          console.log(`[Chill/skip] ✗ Wrong category — verifyAndCorrectBpm will correct`);
        }
        pendingBpmStateRef.current = null;
      }

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
    const history = trackHistoryRef.current;
    if (history.length === 0) return;

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

    // Cancel any pending resting-BPM skip so it doesn't fire mid-transition and override prevTrack
    if (restingBpmTimerRef.current) {
      clearTimeout(restingBpmTimerRef.current);
      restingBpmTimerRef.current = null;
    }

    const prevUri = history.pop()!;
    const vol = await captureVolumeRef.current();
    setIsTransitioning(true);
    isTransitioningRef.current = true;
    lastCommandRef.current = Date.now();

    // Build uris: prevUri first, then current track, then upcoming queue so the
    // forward context survives after prevUri finishes playing naturally.
    // 300ms delay lets Spotify settle before we snapshot the queue.
    // If the first fetch returns 0 upcoming tracks, retry once after another 300ms.
    const fetchQueueUpcoming = async (): Promise<{ id: string }[]> => {
      const qRes = await fetch("/api/queue-tracks");
      if (!qRes.ok) return [];
      const body = await qRes.json();
      return (body.tracks ?? []).filter(
        (t: { id: string }) => t.id !== body.currentlyPlayingId && `spotify:track:${t.id}` !== prevUri
      );
    };

    let urisToPlay: string[] = [prevUri];
    try {
      await new Promise(r => setTimeout(r, 300));
      let upcoming = await fetchQueueUpcoming();
      if (upcoming.length === 0) {
        await new Promise(r => setTimeout(r, 300));
        upcoming = await fetchQueueUpcoming();
      }
      const currentId = prevTrackIdRef.current;
      const forwardUris = [
        ...(currentId ? [`spotify:track:${currentId}`] : []),
        ...upcoming.map((t: { id: string }) => `spotify:track:${t.id}`),
      ];
      if (forwardUris.length > 0) urisToPlay = [prevUri, ...forwardUris];
    } catch { /* non-fatal — fall back to single-track */ }

    try {
      console.log(`[prevTrack] PUT /play — device: ${deviceIdRef.current} — ${urisToPlay.length} uri(s):`, urisToPlay);
      const [, playRes] = await Promise.all([
        spotifyFetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=0`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }),
        spotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ uris: urisToPlay }),
        }),
      ]);

      console.log(`[prevTrack] PUT /play response: ${playRes.status} ${playRes.ok ? "OK" : "FAILED"}`);

      // PUT /play returns 204 on success. On failure re-fetch the active device and retry once.
      if (!playRes.ok && playRes.status !== 429) {
        console.log(`[prevTrack] PUT /play failed (${playRes.status}) — re-fetching device and retrying`);
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
        if (deviceIdRef.current) {
          await spotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ uris: [prevUri] }),
          });
        }
      }

      await new Promise(r => setTimeout(r, 500));

      // Quick poll to display new track info while BPM verification/fade-up are still in progress
      const quickRes = await spotifyFetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (quickRes.ok && quickRes.status !== 204) {
        const quickData = await quickRes.json();
        if (quickData?.item) {
          currentTrackRef.current = quickData.item;
          setCurrentTrack(quickData.item);
          setIsPlaying(quickData.is_playing ?? false);
        }
      }

      const corrected = await verifyAndCorrectBpm(vol);
      if (!corrected) await fadeUp(vol);
    } finally {
      lastCommandRef.current = 0;
      setIsTransitioning(false);
      isTransitioningRef.current = false;
      fetchCurrentTrack();
    }
  };

  const handleEndWorkout = async () => {
    if (session?.accessToken) {
      try {
        await spotifyFetch("https://api.spotify.com/v1/me/player/pause", {
          method: "PUT",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
      } catch { /* non-fatal */ }
    }

    // Stop any running rest timer
    if (timerRef.current) clearInterval(timerRef.current);

    // Reset all session state so the next workout always starts from a clean slate
    trackPoolRef.current = [];
    playedIdsRef.current = new Set();
    trackHistoryRef.current = [];
    prevTrackIdRef.current = null;
    correctionAppliedRef.current = false;
    if (restingBpmTimerRef.current) { clearTimeout(restingBpmTimerRef.current); restingBpmTimerRef.current = null; }
    deviceIdRef.current = null;
    lastCommandRef.current = 0;
    rateLimitUntilRef.current = 0;
    precomputedHighSkipsRef.current = null;
    precomputedLowSkipsRef.current = null;
    pendingBpmStateRef.current = null;

    console.log("[Session reset] handleEndWorkout called — all session state cleared");

    setNavDir("back");
    router.push("/dashboard");
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
          onClick={() => { setNavDir("back"); router.push("/dashboard"); }}
          className="text-gray-400 hover:text-white underline text-sm mt-2"
        >
          Back to dashboard
        </button>
      </div>
    );

  // RGB values match badgeColors (bg-gray-700 / amber-500 / red-500 / blue-500 / green-500)
  const stateColors: Record<WorkoutState, [number, number, number]> = {
    idle:       [ 55,  65,  81],
    warmup:     [245, 158,  11],
    exercising: [239,  68,  68],
    resting:    [ 59, 130, 246],
    done:       [ 34, 197,  94],
  };

  if (workoutState === "done")
    return (
      <>
        <MetallicCanvas r={16} g={185} b={129} />
        <div className="relative flex flex-col items-center justify-center min-h-screen text-white gap-6" style={{ zIndex: 1 }}>
          <h1 className="text-5xl">💪</h1>
          <h1 className="text-4xl font-bold tracking-wide">Workout Complete!</h1>
          <p className="text-[#64748b]">{totalSets} sets crushed</p>
          <button
            onClick={() => { setNavDir("back"); router.push("/dashboard"); }}
            className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-8 py-4 rounded-xl text-lg mt-4 active:scale-95 transition-transform btn-animated"
          >
            Back to Dashboard
          </button>
        </div>
      </>
    );

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

  const bannerVisible = premiumRequired;

  return (
    <>
      <MetallicCanvas r={stateColors[workoutState][0]} g={stateColors[workoutState][1]} b={stateColors[workoutState][2]} />

      <button
        onClick={() => setShowExitDialog(true)}
        className={`fixed left-4 z-20 text-gray-400 hover:text-white active:scale-95 transition-all touch-manipulation ${bannerVisible ? "top-[96px]" : "top-[56px]"}`}
        aria-label="Back"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>

      {/* DJ Type micro-toggle — top right, changes take effect on next state transition */}
      <div
        className={`fixed right-4 z-20 flex flex-col items-center gap-1 touch-manipulation w-20 ${bannerVisible ? "top-[96px]" : "top-[56px]"}`}
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-wide"
          style={{
            color: djMode === "responsive" ? "#4ade80" : "#fb923c",
            transition: "color 300ms ease",
          }}
        >
          {djMode === "responsive" ? "Responsive" : "Chill"}
        </span>
        <button
          onClick={() => {
            const next: DjMode = djMode === "responsive" ? "chill" : "responsive";
            setDjMode(next);
            djModeRef.current = next;
            if (session?.user?.name) saveDjMode(session.user.name, next).catch(() => {});
            feedback("light");
          }}
          role="switch"
          aria-checked={djMode === "responsive"}
          className="relative rounded-full focus:outline-none active:scale-95 transition-transform"
          style={{
            width: 32,
            height: 16,
            backgroundColor: djMode === "responsive" ? "#22c55e" : "#f97316",
            transition: "background-color 300ms ease",
          }}
        >
          <div
            className="absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm"
            style={{
              transform: djMode === "responsive" ? "translateX(17px)" : "translateX(1px)",
              transition: "transform 300ms ease",
            }}
          />
        </button>
      </div>

      {showExitDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.65)' }}
        >
          <div
            className="card-metallic rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
            style={{ animation: 'liftfade 200ms ease forwards' }}
          >
            <div>
              <h2 className="text-xl font-bold text-white">End workout?</h2>
              <p className="text-gray-400 text-sm mt-1">Your progress will be lost.</p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowExitDialog(false)}
                className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl text-base active:scale-95 transition-transform"
              >
                Keep Going
              </button>
              <button
                onClick={handleEndWorkout}
                className="w-full text-red-400 hover:text-red-300 font-semibold py-3 rounded-xl text-base active:scale-95 transition-colors border border-red-500/30 hover:border-red-500/50"
              >
                End Workout
              </button>
            </div>
          </div>
        </div>
      )}

      {showQueuePanel && (
        <div
          className="fixed inset-0 z-[60] flex items-end"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setShowQueuePanel(false)}
        >
          <div
            className="w-full bg-[#0f1117] border-t border-white/10 rounded-t-3xl max-h-[80vh] flex flex-col"
            style={{ animation: 'slideUpPanel 280ms cubic-bezier(0.32, 0.72, 0, 1) forwards' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex justify-between items-start px-6 py-3 shrink-0">
              <div>
                <h3 className="text-white font-bold text-lg leading-tight">Up Next</h3>
                <p className="text-[#64748b] text-xs mt-0.5">up to 20 songs</p>
              </div>
              <button
                onClick={() => setShowQueuePanel(false)}
                className="text-gray-400 hover:text-white transition-colors p-1 -mr-1"
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>

            {/* Track list */}
            <div className="overflow-y-auto flex-1 px-6 pb-8">
              {/* Now Playing row */}
              {currentTrack && (
                <div className="flex items-center gap-3 py-3 mb-1 bg-white/5 -mx-6 px-6">
                  <div className="flex-1 min-w-0">
                    <p className="text-[#94a3b8] text-[10px] font-bold uppercase tracking-widest mb-0.5">Now Playing</p>
                    <p className="font-semibold text-sm text-white truncate">{currentTrack.name}</p>
                    <p className="text-[#64748b] text-xs truncate">
                      {currentTrack.artists?.map((a: { name: string }) => a.name).join(", ")}
                    </p>
                  </div>
                  <BpmBadge bpm={trackPoolRef.current.find(p => p.id === currentTrack.id)?.bpm ?? null} />
                </div>
              )}

              {/* Divider */}
              {currentTrack && (queueLoaded || queueTracks.length > 0) && (
                <div className="border-t border-white/5 my-2" />
              )}

              {/* Queue rows */}
              {!queueLoaded ? (
                <p className="text-[#64748b] text-sm text-center py-8">Loading queue…</p>
              ) : queueTracks.length === 0 ? (
                <p className="text-[#64748b] text-sm text-center py-8">Queue is empty</p>
              ) : (
                queueTracks.map((track, i) => (
                  <div key={`${track.id}-${i}`} className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-white truncate">{track.name}</p>
                      <p className="text-[#64748b] text-xs truncate">{track.artists.join(", ")}</p>
                    </div>
                    <BpmBadge bpm={track.bpm} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="relative h-[100dvh] md:h-auto md:min-h-screen overflow-hidden md:overflow-visible text-white flex flex-col items-center justify-between p-4 md:p-8" style={{ zIndex: 1 }}>
        {premiumRequired && (
          <div className="fixed top-0 left-0 right-0 z-50 backdrop-blur-sm text-sm text-center py-2.5 px-4 bg-red-900/90 text-red-200">
            LiftBeat requires Spotify Premium
          </div>
        )}

        {/* Top */}
        <div className={`text-center w-full shrink-0 ${premiumRequired ? "mt-8" : "mt-1"}`}>
          <p className="text-gray-400 text-xs uppercase tracking-widest mb-2 mt-[40px]">
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
        <div className="flex-1 min-h-0 overflow-hidden md:flex-none md:overflow-visible flex flex-col items-center gap-4 md:gap-5 pt-4 md:pt-0 w-full max-w-sm">
          <span
            className={`${badgeColors[workoutState]} text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-widest`}
          >
            {statusLabels[workoutState]}
          </span>

          <p
            className={`text-5xl md:text-7xl font-bold ${accentColors.resting} transition-opacity duration-300${workoutState !== "resting" ? " timer-collapsed" : ""}`}
            style={{ opacity: workoutState === "resting" ? 1 : 0, pointerEvents: "none" }}
          >
            {formatTime(timeLeft)}
          </p>

          <div className="relative flex-1 min-h-0 flex items-center justify-center md:flex-none">
            {currentTrack?.album?.images?.[0] ? (
              <img
                src={currentTrack.album.images[0].url}
                className={`w-48 h-48 md:w-52 md:h-52 rounded-2xl shadow-2xl transition-opacity duration-300 ${isTransitioning ? "opacity-30" : "opacity-100"}`}
              />
            ) : (
              <div className="w-48 h-48 md:w-52 md:h-52 rounded-2xl bg-gray-800 flex items-center justify-center text-5xl">
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
            <p className="font-semibold text-base md:text-lg">{currentTrack?.name || "No track playing"}</p>
            <p className="text-gray-400 text-sm">{currentTrack?.artists?.[0]?.name}</p>
          </div>

          {/* Interactive progress bar */}
          <div className="w-full select-none">
            <div
              ref={progressBarRef}
              className="w-full bg-gray-700 rounded-full h-1 md:h-1.5 mb-2 cursor-pointer relative group"
              onPointerDown={handleProgressPointerDown}
              onPointerMove={handleProgressPointerMove}
              onPointerUp={handleProgressPointerUp}
              onPointerCancel={handleProgressPointerUp}
            >
              <div
                className="bg-white rounded-full h-1 md:h-1.5 pointer-events-none"
                style={{ width: `${displayProgress}%` }}
              />
              <div
                className={`absolute top-1/2 w-2.5 h-2.5 md:w-3.5 md:h-3.5 bg-white rounded-full shadow-md pointer-events-none transition-opacity ${isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                style={{ left: `${displayProgress}%`, transform: "translate(-50%, -50%)" }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>{formatMs(displayPosition)}</span>
              <span>-{formatMs(Math.max(0, songDuration - displayPosition))}</span>
            </div>
          </div>

          {/* Playback controls */}
          <div className="flex items-center w-full mb-[45px]">
            <div className="flex-1" />
            <div className="flex items-center gap-6 md:gap-8">
              <button
                onClick={prevTrack}
                className="text-gray-400 active:text-white transition-colors touch-manipulation"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 md:w-8 md:h-8">
                  <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
                </svg>
              </button>
              <button
                onClick={togglePlayPause}
                className="text-white active:scale-95 transition-transform touch-manipulation"
              >
                {isPlaying ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 md:w-14 md:h-14">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 md:w-14 md:h-14">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <button
                onClick={skipTrack}
                className="text-gray-400 active:text-white transition-colors touch-manipulation"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 md:w-8 md:h-8">
                  <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
                </svg>
              </button>
            </div>
            <div className="flex-1 flex justify-end">
              <button
                onClick={() => { feedback("light"); setShowQueuePanel(true); }}
                className="text-gray-400 active:text-white transition-colors touch-manipulation"
                aria-label="View queue"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="w-full max-w-sm mb-2 md:mb-4 pt-2.5 md:pt-0 flex flex-col gap-3 md:gap-4 shrink-0">
          {workoutState === "idle" && (
            <div className="grid w-full mb-[20px]">
              <a
                href="spotify://"
                style={{
                  gridArea: '1/1',
                  opacity: spotifyPlaying === true ? 0 : 1,
                  pointerEvents: spotifyPlaying === true ? 'none' : 'auto',
                  transition: 'opacity 400ms ease',
                }}
                className="w-full bg-[#1DB954] text-white font-bold py-4 md:py-5 rounded-2xl text-xl touch-manipulation active:scale-95 flex items-center justify-center gap-3 btn-spotify"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 shrink-0">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                Open Spotify
              </a>
              <button
                onClick={handleStart}
                disabled={isTransitioning}
                style={{
                  gridArea: '1/1',
                  opacity: spotifyPlaying === true ? 1 : 0,
                  pointerEvents: spotifyPlaying === true ? 'auto' : 'none',
                  transition: 'opacity 400ms ease',
                }}
                className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-40 text-white font-bold py-4 md:py-5 rounded-2xl text-xl touch-manipulation active:scale-95 btn-animated"
              >
                Start Workout 🔥
              </button>
            </div>
          )}
          {workoutState === "warmup" && (
            <button
              onClick={handleStartSet}
              className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 md:py-5 rounded-2xl text-xl touch-manipulation active:scale-95 transition-transform btn-animated mb-[20px]"
            >
              Start Set 💪
            </button>
          )}
          {workoutState === "exercising" && (
            <button
              onClick={handleSetDone}
              className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 md:py-5 rounded-2xl text-xl touch-manipulation active:scale-95 transition-transform btn-animated mb-[20px]"
            >
              Done with Set ✓
            </button>
          )}
          {workoutState === "resting" && (
            <button
              disabled
              className="w-full bg-gray-800 text-gray-400 font-bold py-4 md:py-5 rounded-2xl text-xl touch-manipulation cursor-not-allowed border border-white/5 mb-[20px]"
            >
              {"Resting" + ".".repeat(restingDots)}
            </button>
          )}

          <p
            style={{
              opacity: workoutState === "idle" && spotifyPlaying !== true ? 1 : 0,
              transition: 'opacity 400ms ease',
            }}
            className="text-center text-gray-500 text-xs pointer-events-none -mt-2"
          >
            Play any playlist in Spotify, then come back
          </p>

          <div className="flex justify-center">
            <div style={{ width: 300 }}>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Workout Progress</span>
                <span>{workoutProgress}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5 md:h-2">
                <div
                  className="bg-blue-500 h-1.5 md:h-2 rounded-full transition-all"
                  style={{ width: `${workoutProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {toastMessage && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-800/90 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50 pointer-events-none">
            {toastMessage}
          </div>
        )}
      </div>
    </>
  );
}
