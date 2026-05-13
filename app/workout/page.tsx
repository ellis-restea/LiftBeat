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

// Fetch all tracks from a Spotify playlist client-side.
// Returns { tracks, firstStatus } so callers can detect scope errors (403).
async function fetchClientPlaylistTracks(
  playlistId: string,
  accessToken: string
): Promise<{ tracks: { id: string; name: string; artists: string[] }[]; firstStatus: number }> {
  const tracks: { id: string; name: string; artists: string[] }[] = [];
  let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
  let firstStatus = 0;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (firstStatus === 0) firstStatus = res.status;
    console.log(`[PlaylistBPM] Client Spotify fetch → HTTP ${res.status}`);
    if (!res.ok) break;
    const data = await res.json();
    for (const item of data.items ?? []) {
      if (item?.track?.id) {
        tracks.push({
          id: item.track.id,
          name: item.track.name,
          artists: item.track.artists?.map((a: any) => a.name) ?? [],
        });
      }
    }
    url = data.next ?? null;
  }
  return { tracks, firstStatus };
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

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastCommandRef = useRef<number>(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const prevTrackIdRef = useRef<string | null>(null);
  // Timestamp until which all Spotify API calls are blocked (rate limit)
  const rateLimitUntilRef = useRef<number>(0);
  const workoutStateRef = useRef<WorkoutState>("idle");
  const fetchCurrentTrackRef = useRef<() => Promise<void>>(async () => {});
  // Playlist BPM buckets — populated in background on mount via Songstats
  const playlistBpmRef = useRef<{ high: TrackBpm[]; low: TrackBpm[] }>({ high: [], low: [] });
  const playlistBpmLoadedRef = useRef(false);
  // Playlist URI to switch to on Start Workout (null = context already correct)
  const pendingPlaylistContextRef = useRef<string | null>(null);

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

  // Pre-load BPM buckets from Songstats (via Supabase cache) for all saved playlists.
  // Runs once when session is available; results stored in playlistBpmRef for the queue system.
  useEffect(() => {
    if (!session?.accessToken || !session?.user?.name || playlistBpmLoadedRef.current) return;
    playlistBpmLoadedRef.current = true;

    const userId = session.user.name;

    supabase
      .from("user_playlists")
      .select("playlist_ids")
      .eq("user_id", userId)
      .single()
      .then(async ({ data, error }) => {
        if (error || !data?.playlist_ids?.length) {
          console.log("[PlaylistBPM] No saved playlists found for user:", userId);
          return;
        }

        const playlistIds: string[] = data.playlist_ids;
        console.log(`[PlaylistBPM] Loading BPM data for ${playlistIds.length} playlist(s):`, playlistIds);

        // Silently check Spotify context — runs before the slow BPM loading loop
        // so the result is ready long before the user presses Start Workout
        const playlistUris = playlistIds.map((id) => `spotify:playlist:${id}`);
        try {
          const cpRes = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
            headers: { Authorization: `Bearer ${session.accessToken}` },
          });
          if (cpRes.status === 204 || !cpRes.ok) {
            // Nothing playing — queue up first playlist for Start Workout
            pendingPlaylistContextRef.current = playlistUris[0];
            console.log(`[Playlist] No active playback — will start ${playlistUris[0]} on Start Workout`);
          } else {
            const cpData = await cpRes.json();
            const contextUri: string | null = cpData?.context?.uri ?? null;
            if (contextUri && playlistUris.includes(contextUri)) {
              pendingPlaylistContextRef.current = null;
              console.log(`[Playlist] Context already correct: ${contextUri}`);
            } else {
              pendingPlaylistContextRef.current = playlistUris[0];
              console.log(`[Playlist] Wrong context (${contextUri ?? "none"}) — will switch to ${playlistUris[0]} on Start Workout`);
            }
          }
        } catch {
          // Non-fatal — fall back to first playlist on Start Workout
          pendingPlaylistContextRef.current = playlistUris[0];
        }

        const allHigh: TrackBpm[] = [];
        const allLow: TrackBpm[] = [];

        for (const pid of playlistIds) {
          try {
            // Step 1: fetch tracks client-side (session already has playlist scopes)
            const { tracks, firstStatus } = await fetchClientPlaylistTracks(pid, session.accessToken);
            if (firstStatus === 403) {
              console.log('[PlaylistBPM] 403 on playlist fetch — missing playlist-read-private scope. Sign out and back in to fix.');
              continue;
            }
            console.log(`[PlaylistBPM] Client fetched ${tracks.length} tracks from ${pid}`);
            if (!tracks.length) continue;

            // Step 2: POST track list to server — server only does Songstats + Supabase cache
            const res = await fetch("/api/playlist-bpm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tracks }),
            });
            if (!res.ok) {
              console.log(`[PlaylistBPM] Server BPM lookup HTTP ${res.status} for ${pid}`);
              continue;
            }
            const result = await res.json();
            allHigh.push(...(result.high ?? []));
            allLow.push(...(result.low ?? []));
            console.log(
              `[PlaylistBPM] ${pid} → HIGH: ${result.high?.length}, LOW: ${result.low?.length}, UNKNOWN: ${result.unknown?.length}`,
              `| total: ${result.total}, cache: ${result.fromCache}, fresh: ${result.fromApi}`
            );
          } catch (err) {
            console.log(`[PlaylistBPM] Error for ${pid}:`, err);
          }
        }

        playlistBpmRef.current = { high: allHigh, low: allLow };
        console.log(
          `[PlaylistBPM] Buckets ready — HIGH: ${allHigh.length} tracks, LOW: ${allLow.length} tracks`
        );
      });
  }, [session]);

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

      const allTracks = [...playlistBpmRef.current.high, ...playlistBpmRef.current.low];
      const bpm = allTracks.find((t) => t.id === track.id)?.bpm ?? null;
      console.log('[BPM] Current track:', track.name, '| BPM:', bpm ?? 'not in playlist', '| Category:', bpm != null ? (bpm >= HIGH_BPM_CUTOFF ? 'HIGH' : 'LOW') : 'UNKNOWN');

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
  }, [session, spotifyFetch]);

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
    if (res.status === 204) { if (workoutStateRef.current === "idle") setNoDevice(true); return; }
    if (res.status === 200) {
      const data = await res.json();
      const newId = data?.item?.id;

      if (newId && newId !== prevTrackIdRef.current) {
        prevTrackIdRef.current = newId;

        const allBpmTracks = [...playlistBpmRef.current.high, ...playlistBpmRef.current.low];
        const currentBpm = allBpmTracks.find((t) => t.id === newId)?.bpm ?? null;
        console.log(
          `[Track] ♪ "${data?.item?.name}" by ${data?.item?.artists?.[0]?.name}`,
          `| BPM: ${currentBpm ?? 'not in playlist'}`,
          `| ${currentBpm != null ? (currentBpm >= HIGH_BPM_CUTOFF ? 'HIGH ↑' : 'LOW ↓') : 'UNKNOWN'}`,
          `| buckets: ${playlistBpmRef.current.high.length} HIGH / ${playlistBpmRef.current.low.length} LOW`
        );

        // Fetch queue — log next 5 and dynamically load BPM for any unknown tracks
        const currentTrackMeta = data?.item?.id ? {
          id: data.item.id as string,
          name: data.item.name as string,
          artists: (data.item.artists ?? []).map((a: any) => a.name as string),
        } : null;

        spotifyFetch("https://api.spotify.com/v1/me/player/queue", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then(async (qData) => {
            const upcoming: any[] = (qData?.queue ?? []).slice(0, 5);

            // 1. Dynamically fetch Songstats BPM for current track + queue tracks not yet cached
            const knownIds = new Set([...playlistBpmRef.current.high, ...playlistBpmRef.current.low].map((t) => t.id));
            const toLoad = [
              ...(currentTrackMeta && !knownIds.has(currentTrackMeta.id) ? [currentTrackMeta] : []),
              ...upcoming
                .filter((t: any) => t?.id && !knownIds.has(t.id))
                .map((t: any) => ({
                  id: t.id as string,
                  name: t.name as string,
                  artists: (t.artists ?? []).map((a: any) => a.name as string),
                })),
            ];

            if (toLoad.length > 0) {
              console.log(`[BPM] Dynamic load: fetching Songstats for ${toLoad.length} new tracks`);
              try {
                const r = await fetch("/api/playlist-bpm", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ tracks: toLoad }),
                });
                const result = r.ok ? await r.json() : null;
                if (result) {
                  playlistBpmRef.current = {
                    high: [...playlistBpmRef.current.high, ...(result.high ?? [])],
                    low:  [...playlistBpmRef.current.low,  ...(result.low  ?? [])],
                  };
                  console.log(
                    `[BPM] +${result.high?.length ?? 0} HIGH, +${result.low?.length ?? 0} LOW`,
                    `| buckets now: ${playlistBpmRef.current.high.length} HIGH / ${playlistBpmRef.current.low.length} LOW`,
                  );
                }
              } catch { /* ignore */ }
            }

            // 2. Log queue with accurate BPM (after fetch completes)
            const snapshot = [...playlistBpmRef.current.high, ...playlistBpmRef.current.low];
            console.log('[Queue] Next 5 songs:', upcoming.map((t: any, i: number) => {
              const bpm = snapshot.find((b) => b.id === t.id)?.bpm ?? null;
              return {
                '#': i + 1,
                name: t.name,
                artist: t.artists?.[0]?.name ?? '?',
                bpm: bpm ?? 'unknown',
                category: bpm != null ? (bpm >= HIGH_BPM_CUTOFF ? 'HIGH' : 'LOW') : 'UNKNOWN',
              };
            }));
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
  }, [session, spotifyFetch]);

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
    const playBody = pendingPlaylistContextRef.current
      ? { context_uri: pendingPlaylistContextRef.current }
      : {};
    if (pendingPlaylistContextRef.current) {
      console.log(`[Playlist] Switching context to: ${pendingPlaylistContextRef.current}`);
    }
    await spotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${device.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(playBody),
    });
    setWorkoutState("warmup");
    await new Promise((r) => setTimeout(r, 500));
    ensureTrackEnergy(true);
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
            className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-5 rounded-2xl text-xl touch-manipulation active:scale-95 transition-transform btn-animated"
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
