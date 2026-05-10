"use client";
import { useSession, signIn } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.push("/dashboard");
    }
  }, [status]);

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-4">
        <h1 className="text-4xl font-bold tracking-tight">LiftSync</h1>
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-6">
        <div className="mb-4">
          <h1 className="text-5xl font-black tracking-tight mb-3">LiftSync</h1>
          <p className="text-gray-400 text-lg max-w-xs">
            Your music. Your rhythm. Your best workout yet.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-sm w-full text-left">
          <p className="text-green-400 text-xs font-bold uppercase tracking-widest mb-2">Science backed</p>
          <p className="text-white text-2xl font-bold mb-1">10.7% longer.</p>
          <p className="text-gray-400 text-sm">
            Studies show high BPM music helps people push through intense workouts significantly longer than without music.
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-sm mt-4">
          <button
            onClick={() => router.push("/onboarding")}
            className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-xl text-lg transition"
          >
            Get Started
          </button>
          <button
            onClick={() => signIn("spotify", { callbackUrl: "/dashboard" })}
            className="w-full bg-gray-900 hover:bg-gray-800 border border-gray-700 text-white font-bold py-4 rounded-xl text-lg transition"
          >
            Log In
          </button>
        </div>
      </div>

      <p className="text-center text-gray-700 text-xs pb-6">
        Powered by Spotify · Built for lifters
      </p>
    </div>
  );
}