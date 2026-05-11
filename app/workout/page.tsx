"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { supabase } from "@/lib/supabase";

interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  order_index: number;
  superset_with: number | null;
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

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastCommandRef = useRef<number>(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const bpmCacheRef = useRef<Map<string, number | null>>(new Map());
  const bpmSourceCacheRef = useRef<Map<string, string>>(new Map());
  const prevTrackIdRef = useRef<string | null>(null);
  // Timestamp until which all Spotify API calls are blocked (rate limit)
  const rateLimitUntilRef = useRef<number>(0);
  const workoutStateRef = useRef<WorkoutState>("idle");
  const fetchCurrentTrackRef = useRef<() => Promise<void>>(async () => {});

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

  // Global Spotify fetch wrapper — blocks all calls while rate-limited, sets the
  // global cooldown on any 429 response so every endpoint is paused together.
  const spotifyFetch = useCallback(async (url: string, options?: RequestInit): Promise<Response> => {
    if (Date.now() < rateLimitUntilRef.current) {
      const remaining = Math.ceil((rateLimitUntilRef.current - Date.now()) / 1000);
      console.log(`[Spotify] Blocked — rate limited for ${remaining}s more`);
      return new Response(null, { status: 429 });
    }
    const res = await fetch(url, options);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "10", 10);
      console.log(`[Spotify] Rate limited — blocking all API calls for ${retryAfter}s`);
      rateLimitUntilRef.current = Date.now() + retryAfter * 1000;
    }
    return res;
  }, []);

  // Look up BPM for a Spotify track ID. Priority: ReccoBeats → GetSongBPM → null.
  // Results cached in-memory to avoid redundant requests.
  const getTrackBpm = useCallback(async (
    spotifyId: string,
    trackName?: string,
    artistName?: string,
  ): Promise<number | null> => {
    if (bpmCacheRef.current.has(spotifyId)) {
      return bpmCacheRef.current.get(spotifyId) ?? null;
    }

    // Step 1: ReccoBeats (no auth required, not subject to Spotify rate limits)
    try {
      const lookupRes = await fetch(`https://api.reccobeats.com/v1/track?ids=${spotifyId}`);
      if (lookupRes.ok) {
        const lookupData = await lookupRes.json();
        const rbId = lookupData.content?.[0]?.id;
        console.log(`[BPM] ReccoBeats lookup for ${spotifyId} → rbId: ${rbId ?? 'NOT FOUND'} (content length: ${lookupData.content?.length ?? 0})`);
        if (rbId) {
          const featRes = await fetch(`https://api.reccobeats.com/v1/track/${rbId}/audio-features`);
          if (featRes.ok) {
            const feat = await featRes.json();
            console.log(`[BPM] ReccoBeats audio-features for rbId ${rbId} → tempo: ${feat.tempo ?? 'MISSING'}`);
            if (typeof feat.tempo === "number") {
              bpmCacheRef.current.set(spotifyId, feat.tempo);
              bpmSourceCacheRef.current.set(spotifyId, "ReccoBeats");
              return feat.tempo;
            }
          }
        }
      } else {
        console.log(`[BPM] ReccoBeats lookup HTTP ${lookupRes.status} for ${spotifyId}`);
      }
    } catch (err) {
      console.log(`[BPM] ReccoBeats threw for ${spotifyId}:`, err);
    }

    // Step 2: GetSongBPM fallback
    const gsbKey = process.env.NEXT_PUBLIC_GETSONGBPM_KEY;
    if (gsbKey && trackName) {
      try {
        const lookup = [artistName, trackName].filter(Boolean).map((s) => encodeURIComponent(s!).replace(/%20/g, '+')).join('+');
        const gsbRes = await fetch(
          `https://api.getsong.co/search/?api_key=${gsbKey}&type=both&lookup=${lookup}`
        );
        if (gsbRes.ok) {
          const gsbData = await gsbRes.json();
          const tempoRaw = gsbData.search?.[0]?.tempo;
          const bpm = tempoRaw ? parseFloat(String(tempoRaw)) : null;
          if (bpm !== null && !isNaN(bpm)) {
            console.log(`[GetSongBPM] Found ${trackName} → ${bpm} BPM`);
            bpmCacheRef.current.set(spotifyId, bpm);
            bpmSourceCacheRef.current.set(spotifyId, "GetSongBPM");
            return bpm;
          } else {
            console.log(`[GetSongBPM] NOT FOUND: ${trackName}`);
          }
        }
      } catch (err) {
        console.log(`[GetSongBPM] threw for "${trackName}":`, err);
      }
    }

    bpmCacheRef.current.set(spotifyId, null);
    bpmSourceCacheRef.current.set(spotifyId, "unknown");
    return null;
  }, [spotifyFetch]);

  // Skip tracks until one matches the desired energy level (or give up after 5 tries).
  const ensureTrackEnergy = useCallback(async (wantHigh: boolean) => {
    if (!session?.accessToken) return;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await spotifyFetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.status !== 200) break;
      const data = await res.json();
      const track = data?.item;
      if (!track?.id) break;

      const artist = track.artists?.[0]?.name;
      const bpm = await getTrackBpm(track.id, track.name, artist);
      console.log('[BPM] Current track:', track.name, 'by', artist, '| BPM:', bpm, '| Category:', bpm != null ? (bpm >= HIGH_BPM_CUTOFF ? 'HIGH' : 'LOW') : 'UNKNOWN');

      if (bpm === null) {
        console.log(`[BPM] BPM unknown for "${track.name}" — skipping`);
        lastCommandRef.current = Date.now() - 1200;
        await spotifyFetch("https://api.spotify.com/v1/me/player/next", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        await new Promise((resolve) => setTimeout(resolve, 700));
        continue;
      }

      const isHigh = bpm >= HIGH_BPM_CUTOFF;
      if (isHigh === wantHigh) {
        console.log('[BPM] Match found:', track.name, 'BPM:', bpm);
        break;
      }

      console.log('[BPM] Skipping — needed:', wantHigh ? 'HIGH' : 'LOW', 'got:', isHigh ? 'HIGH' : 'LOW');
      lastCommandRef.current = Date.now() - 1200;
      await spotifyFetch("https://api.spotify.com/v1/me/player/next", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    lastCommandRef.current = 0;
    fetchCurrentTrackRef.current();
  }, [session, getTrackBpm, spotifyFetch]);

  const ensureTrackEnergyRef = useRef(ensureTrackEnergy);
  useEffect(() => { ensureTrackEnergyRef.current = ensureTrackEnergy; }, [ensureTrackEnergy]);
  useEffect(() => { workoutStateRef.current = workoutState; }, [workoutState]);

  // Fetch current track and update UI. Only called explicitly — no interval polling.
  const fetchCurrentTrack = useCallback(async () => {
    if (!session?.accessToken) return;
    if (Date.now() - lastCommandRef.current < 1500) return;
    if (isDraggingRef.current) return;

    const res = await spotifyFetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.status === 204) { setNoDevice(true); return; }
    if (res.status === 200) {
      const data = await res.json();
      const newId = data?.item?.id;

      // New track — pre-warm BPM cache for the upcoming queue (fire and forget)
      if (newId && newId !== prevTrackIdRef.current) {
        prevTrackIdRef.current = newId;
        spotifyFetch("https://api.spotify.com/v1/me/player/queue", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((qData) => {
            if (!qData) return;
            const upcoming = [qData.currently_playing, ...(qData.queue || [])]
              .filter(Boolean)
              .slice(0, 6);
            console.log(`[Queue] Track changed — pre-loading BPM for ${upcoming.length} tracks`);
            Promise.all(
              upcoming.map(async (t: any) => {
                const bpm = t?.id ? await getTrackBpm(t.id, t.name, t.artists?.[0]?.name) : null;
                const api = t?.id ? (bpmSourceCacheRef.current.get(t.id) ?? 'unknown') : 'unknown';
                return { name: t?.name, bpm, api };
              })
            ).then((queueTracks) => {
              console.log('[BPM] Queue analysis:', queueTracks.map((t) => ({
                name: t.name,
                bpm: t.bpm,
                category: t.bpm != null ? (t.bpm >= HIGH_BPM_CUTOFF ? 'HIGH' : 'LOW') : 'UNKNOWN',
                api: t.api,
              })));
            });
          })
          .catch(() => {});
      }

      setNoDevice(false);
      setCurrentTrack(data?.item);
      setIsPlaying(data?.is_playing);
      setSongPosition(data?.progress_ms || 0);
      setSongDuration(data?.item?.duration_ms || 0);
      setSongProgress(
        data?.item?.duration_ms
          ? Math.round((data.progress_ms / data.item.duration_ms) * 100)
          : 0
      );
    }
  }, [session, getTrackBpm, spotifyFetch]);

  useEffect(() => { fetchCurrentTrackRef.current = fetchCurrentTrack; }, [fetchCurrentTrack]);

  // Single fetch on page load — show whatever is currently playing in Spotify.
  useEffect(() => {
    if (session?.accessToken) fetchCurrentTrack();
  }, [fetchCurrentTrack]);

  // Rest timer — counts down, switches to exercising and steers BPM when done.
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
        ensureTrackEnergyRef.current(true);
      }
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [workoutState, currentExercise]);

  // Check for an active Spotify device once. If none found, show banner and let
  // the user open Spotify and press Start again — no polling loop.
  const handleStart = async () => {
    if (!session?.accessToken) return;
    const devicesRes = await spotifyFetch("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (devicesRes.status === 403) { setPremiumRequired(true); return; }
    if (!devicesRes.ok) { setNoDevice(true); return; }
    const { devices } = await devicesRes.json();
    const device = devices?.find((d: any) => d.is_active) ?? devices?.[0];
    if (!device) { setNoDevice(true); return; }
    setNoDevice(false);
    await spotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${device.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setWorkoutState("warmup");
    ensureTrackEnergy(true);
  };

  const handleStartSet = () => setWorkoutState("exercising");

  const handleSetDone = () => {
    if (!currentExercise) return;
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
          setTimeout(() => ensureTrackEnergyRef.current(false), 500);
        } else if (currentExerciseIndex + 1 < exercises.length) {
          setCurrentExerciseIndex(currentExerciseIndex + 1);
          setCurrentSet(1);
          setWorkoutState("resting");
          setTimeout(() => ensureTrackEnergyRef.current(false), 500);
        } else {
          setWorkoutState("done");
        }
        return;
      }
    }

    if (currentSet < currentExercise.sets) {
      setCurrentSet(currentSet + 1);
      setWorkoutState("resting");
      setTimeout(() => ensureTrackEnergyRef.current(false), 500);
    } else if (currentExerciseIndex < exercises.length - 1) {
      setCurrentExerciseIndex(currentExerciseIndex + 1);
      setCurrentSet(1);
      setWorkoutState("resting");
      setTimeout(() => ensureTrackEnergyRef.current(false), 500);
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

  const skipTrack = async () => {
    if (!session?.accessToken) return;
    lastCommandRef.current = Date.now() - 1200;
    await spotifyFetch("https://api.spotify.com/v1/me/player/next", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (workoutState === "exercising" || workoutState === "warmup") {
      ensureTrackEnergyRef.current(true);
    } else if (workoutState === "resting") {
      ensureTrackEnergyRef.current(false);
    } else {
      lastCommandRef.current = 0;
      fetchCurrentTrack();
    }
  };

  const prevTrack = async () => {
    if (!session?.accessToken) return;
    lastCommandRef.current = Date.now();
    await spotifyFetch("https://api.spotify.com/v1/me/player/previous", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    await new Promise((r) => setTimeout(r, 800));
    lastCommandRef.current = 0;
    fetchCurrentTrack();
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

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white">
        Loading workout...
      </div>
    );

  if (exercises.length === 0)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-4 p-8 text-center">
        <p className="text-red-400 text-lg font-semibold">No exercises found</p>
        <p className="text-gray-500 text-sm max-w-xs">
          The exercises failed to save. Open the browser console for the exact error — you likely need to run:
        </p>
        <code className="bg-gray-900 text-green-400 text-xs px-4 py-3 rounded-xl">
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
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-6">
        <h1 className="text-5xl">💪</h1>
        <h1 className="text-4xl font-bold">Workout Complete!</h1>
        <p className="text-gray-400">{totalSets} sets crushed</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="bg-green-500 text-black font-bold px-8 py-4 rounded-xl text-lg mt-4"
        >
          Back to Dashboard
        </button>
      </div>
    );

  const bgColors: Record<WorkoutState, string> = {
    idle: "bg-gray-950",
    warmup: "bg-amber-950",
    exercising: "bg-red-950",
    resting: "bg-blue-950",
    done: "bg-black",
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
    <div
      className={`min-h-screen ${bgColors[workoutState]} text-white flex flex-col items-center justify-between p-8 transition-colors`}
      style={{ transitionDuration: workoutState === "exercising" ? "300ms" : "700ms" }}
    >
      {(noDevice || premiumRequired) && (
        <div
          className={`fixed top-0 left-0 right-0 z-50 backdrop-blur-sm text-sm text-center py-2.5 px-4 ${
            premiumRequired
              ? "bg-red-900/90 text-red-200"
              : "bg-amber-900/90 text-amber-200"
          }`}
        >
          {premiumRequired
            ? "LiftSync requires Spotify Premium"
            : "Open Spotify on your device, then tap Start Workout"}
        </div>
      )}

      {/* Top */}
      <div className={`text-center w-full ${(noDevice || premiumRequired) ? "mt-12" : "mt-4"}`}>
        <p className="text-gray-400 text-xs uppercase tracking-widest mb-2">
          Exercise {currentExerciseIndex + 1} of {exercises.length}
        </p>
        {isInSuperset && (
          <span className="inline-block bg-green-500/20 text-green-400 text-xs font-bold px-3 py-0.5 rounded-full uppercase tracking-widest border border-green-500/30 mb-2">
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

        {currentTrack?.album?.images?.[0] ? (
          <img
            src={currentTrack.album.images[0].url}
            className="w-52 h-52 rounded-2xl shadow-2xl"
          />
        ) : (
          <div className="w-52 h-52 rounded-2xl bg-gray-800 flex items-center justify-center text-5xl">
            ♪
          </div>
        )}

        <div className="text-center">
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
        {workoutState === "idle" && (
          <button
            onClick={handleStart}
            className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-5 rounded-2xl text-xl touch-manipulation"
          >
            Start Workout 🔥
          </button>
        )}
        {workoutState === "warmup" && (
          <button
            onClick={handleStartSet}
            className="w-full bg-red-500 hover:bg-red-400 text-white font-bold py-5 rounded-2xl text-xl touch-manipulation"
          >
            Start Set 💪
          </button>
        )}
        {workoutState === "exercising" && (
          <button
            onClick={handleSetDone}
            className="w-full bg-white text-black font-bold py-5 rounded-2xl text-xl touch-manipulation"
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
              className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${workoutProgress}%` }}
            />
          </div>
        </div>

        <p className="text-center text-gray-600 text-xs">
          BPM data provided by{" "}
          <a href="https://getsongbpm.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400 transition">
            GetSongBPM
          </a>
        </p>
      </div>
    </div>
  );
}
