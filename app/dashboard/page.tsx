"use client";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LoadingScreen from "../components/LoadingScreen";

interface Workout {
  id: string;
  name: string;
  created_at: string;
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [hasPlaylists, setHasPlaylists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [playlistCoverUrl, setPlaylistCoverUrl] = useState<string | null>(null);
  const [firstPlaylistId, setFirstPlaylistId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status]);

  useEffect(() => {
    if (!session?.user?.name) return;
    Promise.all([
      supabase
        .from("workouts")
        .select("*")
        .eq("user_id", session.user.name)
        .order("created_at", { ascending: false }),
      supabase
        .from("user_playlists")
        .select("playlist_ids")
        .eq("user_id", session.user.name)
        .single(),
    ]).then(([workoutsRes, playlistsRes]) => {
      setWorkouts(workoutsRes.data || []);
      const ids = playlistsRes.data?.playlist_ids;
      const hasPl = Array.isArray(ids) && ids.length > 0;
      setHasPlaylists(hasPl);
      if (hasPl) setFirstPlaylistId(ids[0]);
      setLoading(false);
    });
  }, [session]);

  useEffect(() => {
    if (!firstPlaylistId || !session?.accessToken) return;
    fetch(`https://api.spotify.com/v1/playlists/${firstPlaylistId}?fields=images`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.images?.[0]?.url) setPlaylistCoverUrl(data.images[0].url);
      })
      .catch(() => {});
  }, [firstPlaylistId, session]);

  const startDelete = (workoutId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(workoutId);
  };

  const confirmDelete = async (workoutId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from("workouts").delete().eq("id", workoutId);
    setWorkouts((prev) => prev.filter((w) => w.id !== workoutId));
    setDeletingId(null);
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(null);
  };

  if (status === "loading" || loading) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f1f5f9] p-8">
      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-wide">LiftSync</h1>
            <p className="text-[#64748b] text-sm mt-1">
              Hey, {session?.user?.name?.split(" ")[0]} 👋
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => router.push(hasPlaylists ? "/playlist-select?mode=edit" : "/playlist-select")}
              className="relative w-12 h-12 rounded-full shrink-0 cursor-pointer overflow-hidden bg-[#1a1d2e]"
            >
              {playlistCoverUrl && (
                <img
                  src={playlistCoverUrl}
                  alt="playlist"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 rounded-full bg-black/40" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
              </div>
            </div>
            <button
              onClick={() => signOut()}
              className="text-[#64748b] hover:text-white text-sm transition"
            >
              Sign out
            </button>
          </div>
        </div>

        <h2 className="text-lg font-semibold tracking-wide mb-4">Your Workouts</h2>

        <div className="grid gap-3 mb-4">
          {workouts.length === 0 ? (
            <div className="card-metallic rounded-xl p-8 text-center text-[#64748b]">
              <p className="text-4xl mb-3">🏋️</p>
              <p>No workouts yet. Create your first one!</p>
            </div>
          ) : (
            workouts.map((workout) => {
              const isDeleting = deletingId === workout.id;

              if (isDeleting) {
                return (
                  <div
                    key={workout.id}
                    className="flex items-center justify-between bg-red-950 border border-red-500/40 rounded-xl p-4"
                  >
                    <p className="text-red-300 text-sm font-semibold truncate mr-4">
                      Delete &ldquo;{workout.name}&rdquo;?
                    </p>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={cancelDelete}
                        className="text-[#64748b] hover:text-white text-sm px-3 py-1.5 rounded-lg border border-white/10 transition active:scale-95"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={(e) => confirmDelete(workout.id, e)}
                        className="bg-red-600 hover:bg-red-500 text-white text-sm px-3 py-1.5 rounded-lg font-semibold transition active:scale-95"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={workout.id}
                  onClick={() => router.push(`/workout?workout_id=${workout.id}`)}
                  className="card-metallic flex items-center justify-between rounded-xl p-4 cursor-pointer transition hover:border-blue-500/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{workout.name}</p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/workout-setup?workout_id=${workout.id}`);
                        }}
                        className="text-[#64748b] hover:text-blue-400 transition shrink-0"
                        title="Edit workout"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => startDelete(workout.id, e)}
                        className="text-[#64748b] hover:text-red-400 transition shrink-0"
                        title="Delete"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-[#64748b] text-sm mt-0.5">
                      {new Date(workout.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <span className="text-[#64748b] text-xl ml-4 shrink-0">→</span>
                </div>
              );
            })
          )}
        </div>

        <button
          onClick={() => router.push(hasPlaylists ? "/workout-setup" : "/playlist-select")}
          className="w-full border border-blue-500 text-blue-500 hover:bg-blue-500/10 font-semibold py-4 rounded-xl transition active:scale-95 flex items-center justify-center gap-2 btn-animated"
        >
          <span className="text-xl">+</span> New Workout
        </button>

        <p className="text-center text-[#64748b] text-xs mt-2">
          BPM data provided by{" "}
          <a href="https://getsongbpm.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#94a3b8] transition">
            GetSongBPM
          </a>
        </p>
      </div>
    </div>
  );
}
