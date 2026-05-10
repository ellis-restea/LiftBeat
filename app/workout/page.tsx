"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  order_index: number;
}

type WorkoutState = "idle" | "warmup" | "exercising" | "resting" | "done";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatMs(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  return formatTime(totalSeconds);
}

export default function Workout() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const router = useRouter();

  const workoutId = searchParams.get("workout_id");
  const playlistIds = searchParams.get("playlists")?.split(",") || [];

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [currentSet, setCurrentSet] = useState(1);
  const [workoutState, setWorkoutState] = useState<WorkoutState>("idle");
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [highBpmTracks, setHighBpmTracks] = useState<any[]>([]);
  const [lowBpmTracks, setLowBpmTracks] = useState<any[]>([]);
  const [tracksLoaded, setTracksLoaded] = useState(false);
  const [songProgress, setSongProgress] = useState(0);
  const [songPosition, setSongPosition] = useState(0);
  const [songDuration, setSongDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const currentExercise = exercises[currentExerciseIndex];
  const totalSets = exercises.reduce((acc, ex) => acc + ex.sets, 0);
  const completedSets = exercises
    .slice(0, currentExerciseIndex)
    .reduce((acc, ex) => acc + ex.sets, 0) + (currentSet - 1);
  const workoutProgress = Math.round((completedSets / totalSets) * 100);

  // Load exercises
  useEffect(() => {
   
    if (!workoutId) return;
    supabase
      .from("exercises")
      .select("*")
      .eq("workout_id", workoutId)
      .order("order_index")
      .then(({ data }) => {
        if (data) setExercises(data);
        setLoading(false);
      });
  }, [workoutId]);

  // Load and analyze playlist BPMs
  useEffect(() => {
    
     if (!session?.accessToken || playlistIds.length === 0 || tracksLoaded) return;

    const loadTracks = async () => {
      let allTracks: any[] = [];

      for (const playlistId of playlistIds) {
        const res = await fetch(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`,
          { headers: { Authorization: `Bearer ${session.accessToken}` } }
        );
        const data = await res.json();
        const tracks = data.items?.map((item: any) => item.track).filter(Boolean) || [];
        allTracks = [...allTracks, ...tracks];
      }

      const ids = allTracks.slice(0, 100).map((t) => t.id).join(",");
      const featuresRes = await fetch(
        `https://api.spotify.com/v1/audio-features?ids=${ids}`,
        { headers: { Authorization: `Bearer ${session.accessToken}` } }
      );
      const featuresData = await featuresRes.json();

      const tracksWithBpm = allTracks.map((track, i) => ({
        ...track,
        bpm: featuresData.audio_features?.[i]?.tempo || 120,
      }));

      const bpms = tracksWithBpm.map((t) => t.bpm).sort((a, b) => a - b);
      const median = bpms[Math.floor(bpms.length / 2)];

      setHighBpmTracks(tracksWithBpm.filter((t) => t.bpm >= median));
      setLowBpmTracks(tracksWithBpm.filter((t) => t.bpm < median));

      setTracksLoaded(true);

    };

    loadTracks();
  }, [session, playlistIds]);

  // Play a track from the right bucket
  const playTrack = useCallback(async (high: boolean) => {
    if (!session?.accessToken) return;
    const bucket = high ? highBpmTracks : lowBpmTracks;
    if (bucket.length === 0) return;
    const track = bucket[Math.floor(Math.random() * bucket.length)];
    await fetch("https://api.spotify.com/v1/me/player/play", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: [`spotify:track:${track.id}`] }),
    });
    setCurrentTrack(track);
    setIsPlaying(true);
  }, [session, highBpmTracks, lowBpmTracks]);

  // Poll current track + progress every second
  const fetchCurrentTrack = useCallback(async () => {
    if (!session?.accessToken) return;
    const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.status === 200) {
      const data = await res.json();
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
  }, [session]);

  useEffect(() => {
    const interval = setInterval(fetchCurrentTrack, 1000);
    return () => clearInterval(interval);
  }, [fetchCurrentTrack]);

  // Rest timer
  useEffect(() => {
    if (workoutState !== "resting" || !currentExercise) return;
    setTimeLeft(currentExercise.rest_seconds);
  }, [workoutState, currentExercise]);

  useEffect(() => {
    if (workoutState !== "resting" || timeLeft <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setWorkoutState("exercising");
          playTrack(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [workoutState, playTrack]);

  const handleStart = () => {
    setWorkoutState("warmup");
    playTrack(true);
  };

  const handleStartSet = () => {
    setWorkoutState("exercising");
  };

  const handleSetDone = () => {
    if (!currentExercise) return;
    if (currentSet < currentExercise.sets) {
      setCurrentSet(currentSet + 1);
      setWorkoutState("resting");
      playTrack(false);
    } else if (currentExerciseIndex < exercises.length - 1) {
      setCurrentExerciseIndex(currentExerciseIndex + 1);
      setCurrentSet(1);
      setWorkoutState("resting");
      playTrack(false);
    } else {
      setWorkoutState("done");
    }
  };

  const togglePlayPause = async () => {
    if (!session?.accessToken) return;
    await fetch(`https://api.spotify.com/v1/me/player/${isPlaying ? "pause" : "play"}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    setIsPlaying(!isPlaying);
  };

  const skipTrack = async () => {
    if (!session?.accessToken) return;
    await fetch("https://api.spotify.com/v1/me/player/next", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    setTimeout(fetchCurrentTrack, 500);
  };

  const prevTrack = async () => {
    if (!session?.accessToken) return;
    await fetch("https://api.spotify.com/v1/me/player/previous", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    setTimeout(fetchCurrentTrack, 500);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      Loading workout...
    </div>
  );

  if (workoutState === "done") return (
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
    <div className={`min-h-screen ${bgColors[workoutState]} text-white flex flex-col items-center justify-between p-8 transition-colors duration-700`}>

      {/* Top */}
      <div className="text-center mt-4 w-full">
        <p className="text-gray-400 text-xs uppercase tracking-widest mb-1">
          Exercise {currentExerciseIndex + 1} of {exercises.length}
        </p>
        <h2 className="text-2xl font-bold">{currentExercise?.name}</h2>
        <p className="text-gray-400 mt-1 text-sm">
          {currentExercise?.reps} reps · Set {currentSet} of {currentExercise?.sets}
        </p>
      </div>

      {/* Middle */}
      <div className="flex flex-col items-center gap-5 w-full max-w-sm">

        {/* Status badge */}
        <span className={`${badgeColors[workoutState]} text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-widest`}>
          {statusLabels[workoutState]}
        </span>

        {/* Rest timer */}
        {workoutState === "resting" && (
          <p className={`text-7xl font-bold ${accentColors[workoutState]}`}>
            {formatTime(timeLeft)}
          </p>
        )}

        {/* Album art */}
        {currentTrack?.album?.images?.[0] ? (
          <img src={currentTrack.album.images[0].url} className="w-52 h-52 rounded-2xl shadow-2xl" />
        ) : (
          <div className="w-52 h-52 rounded-2xl bg-gray-800 flex items-center justify-center text-5xl">♪</div>
        )}

        {/* Song info */}
        <div className="text-center">
          <p className="font-semibold text-lg">{currentTrack?.name || "No track playing"}</p>
          <p className="text-gray-400 text-sm">{currentTrack?.artists?.[0]?.name}</p>
        </div>

        {/* Song progress bar */}
        <div className="w-full">
          <div className="w-full bg-gray-700 rounded-full h-1 mb-1">
            <div
              className="bg-white h-1 rounded-full transition-all"
              style={{ width: `${songProgress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>{formatMs(songPosition)}</span>
            <span>-{formatMs(Math.max(0, songDuration - songPosition))}</span>
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-8">
          <button onClick={prevTrack} className="text-gray-400 hover:text-white text-3xl">⏮</button>
          <button onClick={togglePlayPause} className="text-white text-5xl">
            {isPlaying ? "⏸" : "▶️"}
          </button>
          <button onClick={skipTrack} className="text-gray-400 hover:text-white text-3xl">⏭</button>
        </div>
      </div>

      {/* Bottom */}
      <div className="w-full max-w-sm mb-4 flex flex-col gap-4">

        {/* Action button */}
        {workoutState === "idle" && (
          <button onClick={handleStart} className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-5 rounded-2xl text-xl">
            Start Workout 🔥
          </button>
        )}
        {workoutState === "warmup" && (
          <button onClick={handleStartSet} className="w-full bg-red-500 hover:bg-red-400 text-white font-bold py-5 rounded-2xl text-xl">
            Start Set 💪
          </button>
        )}
        {workoutState === "exercising" && (
          <button onClick={handleSetDone} className="w-full bg-white text-black font-bold py-5 rounded-2xl text-xl">
            Done with Set ✓
          </button>
        )}

        {/* Workout progress bar */}
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
      </div>
    </div>
  );
}