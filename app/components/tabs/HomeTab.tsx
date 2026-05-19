"use client";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { feedback } from "@/lib/feedback";

interface Workout { id: string; name: string; created_at: string; }
interface Props { hasPlaylists: boolean; }

export default function HomeTab({ hasPlaylists }: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!avatarMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [avatarMenuOpen]);

  useEffect(() => {
    if (!session?.user?.name) return;
    supabase
      .from("workouts")
      .select("*")
      .eq("user_id", session.user.name)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setWorkouts(data || []);
        setLoading(false);
      });
  }, [session]);

  const startDelete   = (id: string, e: React.MouseEvent) => { e.stopPropagation(); feedback("medium"); setDeletingId(id); };
  const cancelDelete  = (e: React.MouseEvent) => { e.stopPropagation(); feedback("light"); setDeletingId(null); };
  const confirmDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    feedback("medium");
    await supabase.from("workouts").delete().eq("id", id);
    setWorkouts((prev) => prev.filter((w) => w.id !== id));
    setDeletingId(null);
  };

  return (
    <div className="p-8">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-wide">LiftBeat</h1>
            <p className="text-[#64748b] text-sm mt-1">
              Hey, {session?.user?.name?.split(" ")[0]} 👋
            </p>
          </div>
          <div ref={avatarRef} className="relative">
            <button
              onClick={() => setAvatarMenuOpen((v) => !v)}
              className="w-9 h-9 rounded-full overflow-hidden border border-white/10 hover:border-blue-500/50 transition active:scale-95 focus:outline-none"
              aria-label="Account menu"
            >
              {session?.user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name ?? "Profile"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-[#1e293b] flex items-center justify-center text-sm font-semibold text-[#94a3b8]">
                  {session?.user?.name?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
            </button>
            {avatarMenuOpen && (
              <div className="absolute right-0 top-11 z-50 min-w-[120px] bg-[#111827] border border-white/10 rounded-xl shadow-xl overflow-hidden">
                <button
                  onClick={() => { setAvatarMenuOpen(false); signOut({ callbackUrl: "/" }); }}
                  className="w-full text-left px-4 py-3 text-sm text-[#f1f5f9] hover:bg-white/5 transition"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>

        <h2 className="text-lg font-semibold tracking-wide mb-4">Your Workouts</h2>

        {loading ? (
          <div className="grid gap-3 mb-4">
            {[55, 70, 45].map((w, i) => (
              <div key={i} className="card-metallic rounded-xl p-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="skeleton h-4 rounded mb-2" style={{ width: `${w}%` }} />
                  <div className="skeleton h-3 rounded w-16" />
                </div>
                <div className="skeleton w-5 h-4 rounded ml-4" />
              </div>
            ))}
          </div>
        ) : (
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
        )}

        <button
          onClick={() => router.push(hasPlaylists ? "/workout-setup" : "/playlist-select")}
          className="w-full border border-blue-500 text-blue-500 hover:bg-blue-500/10 font-semibold py-4 rounded-xl transition active:scale-95 flex items-center justify-center gap-2 btn-animated"
        >
          <span className="text-xl">+</span> New Workout
        </button>

      </div>
    </div>
  );
}
