"use client";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status]);

  useEffect(() => {
    if (session?.user?.name) {
      supabase
        .from("workouts")
        .select("*")
        .eq("user_id", session.user.name)
        .order("created_at", { ascending: false })
        .then(({ data }) => {
          setWorkouts(data || []);
          setLoading(false);
        });
    }
  }, [session]);

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
            <p className="text-gray-500 text-sm mt-1">Hey, {session?.user?.name?.split(" ")[0]} 👋</p>
          </div>
          <button onClick={() => signOut()} className="text-gray-600 hover:text-white text-sm transition">
            Sign out
          </button>
        </div>

        <h2 className="text-lg font-semibold mb-4">Your Workouts</h2>

        <div className="grid gap-3 mb-4">
          {workouts.length === 0 ? (
            <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-500">
              <p className="text-4xl mb-3">🏋️</p>
              <p>No workouts yet. Create your first one!</p>
            </div>
          ) : (
            workouts.map((workout) => (
              <div
                key={workout.id}
                onClick={() => router.push(`/playlist-select?workout_id=${workout.id}`)}
                className="flex items-center justify-between bg-gray-900 hover:bg-gray-800 border border-transparent hover:border-gray-700 rounded-xl p-4 cursor-pointer transition"
              >
                <div>
                  <p className="font-semibold">{workout.name}</p>
                  <p className="text-gray-500 text-sm">
                    {new Date(workout.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <span className="text-gray-600 text-xl">→</span>
              </div>
            ))
          )}
        </div>

        <button
          onClick={() => router.push("/playlist-select")}
          className="w-full border border-gray-700 hover:border-green-500 hover:text-green-500 text-gray-400 font-semibold py-4 rounded-xl transition flex items-center justify-center gap-2"
        >
          <span className="text-xl">+</span> New Workout
        </button>
      </div>
    </div>
  );
}