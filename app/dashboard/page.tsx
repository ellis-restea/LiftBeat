"use client";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [playlistCoverUrl, setPlaylistCoverUrl] = useState<string | null>(null);
  const [firstPlaylistId, setFirstPlaylistId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

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

  // Fetch the first playlist's cover art from Spotify for the widget
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

  const startEdit = (workout: Workout, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(null);
    setEditingId(workout.id);
    setEditName(workout.name);
  };

  const saveEdit = async (workoutId: string) => {
    const trimmed = editName.trim();
    setEditingId(null);
    if (!trimmed) return;
    await supabase.from("workouts").update({ name: trimmed }).eq("id", workoutId);
    setWorkouts((prev) =>
      prev.map((w) => (w.id === workoutId ? { ...w, name: trimmed } : w))
    );
  };

  const startDelete = (workoutId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
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

  if (status === "loading" || loading)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-4">
        <h1 className="text-4xl font-bold tracking-tight">LiftSync</h1>
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">LiftSync</h1>
            <p className="text-gray-500 text-sm mt-1">
              Hey, {session?.user?.name?.split(" ")[0]} 👋
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => router.push(hasPlaylists ? "/playlist-select?mode=edit" : "/playlist-select")}
              className="relative w-12 h-12 rounded-full shrink-0 cursor-pointer"
              style={{
                backgroundImage: playlistCoverUrl ? `url(${playlistCoverUrl})` : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundColor: playlistCoverUrl ? undefined : "#374151",
              }}
            >
              <div className="absolute inset-0 rounded-full bg-black/40" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
              </div>
            </div>
            <button
              onClick={() => signOut()}
              className="text-gray-600 hover:text-white text-sm transition"
            >
              Sign out
            </button>
          </div>
        </div>

        <h2 className="text-lg font-semibold mb-4">Your Workouts</h2>

        <div className="grid gap-3 mb-4">
          {workouts.length === 0 ? (
            <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-500">
              <p className="text-4xl mb-3">🏋️</p>
              <p>No workouts yet. Create your first one!</p>
            </div>
          ) : (
            workouts.map((workout) => {
              const isEditing = editingId === workout.id;
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
                        className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg border border-gray-700 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={(e) => confirmDelete(workout.id, e)}
                        className="bg-red-600 hover:bg-red-500 text-white text-sm px-3 py-1.5 rounded-lg font-semibold transition"
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
                  onClick={() => {
                    if (isEditing) return;
                    router.push(`/workout?workout_id=${workout.id}`);
                  }}
                  className="flex items-center justify-between bg-gray-900 hover:bg-gray-800 border border-transparent hover:border-gray-700 rounded-xl p-4 cursor-pointer transition"
                >
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(workout.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onBlur={() => saveEdit(workout.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-gray-800 text-white rounded-lg px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-green-500 w-full max-w-xs"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="font-semibold truncate">{workout.name}</p>
                        <button
                          onClick={(e) => startEdit(workout, e)}
                          className="text-gray-600 hover:text-gray-300 transition shrink-0"
                          title="Rename"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => startDelete(workout.id, e)}
                          className="text-gray-600 hover:text-red-400 transition shrink-0"
                          title="Delete"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                          </svg>
                        </button>
                      </div>
                    )}
                    <p className="text-gray-500 text-sm mt-0.5">
                      {new Date(workout.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <span className="text-gray-600 text-xl ml-4 shrink-0">→</span>
                </div>
              );
            })
          )}
        </div>

        <button
          onClick={() => router.push(hasPlaylists ? "/workout-setup" : "/playlist-select")}
          className="w-full border border-gray-700 hover:border-green-500 hover:text-green-500 text-gray-400 font-semibold py-4 rounded-xl transition flex items-center justify-center gap-2"
        >
          <span className="text-xl">+</span> New Workout
        </button>
      </div>
    </div>
  );
}
