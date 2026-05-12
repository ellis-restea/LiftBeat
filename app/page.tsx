"use client";
import { useSession, signIn } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import LoadingScreen from "./components/LoadingScreen";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.push("/dashboard");
    }
  }, [status]);

  if (status === "loading") return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f1f5f9] flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-6">
        <div className="mb-4">
          <h1 className="text-5xl font-black tracking-wide mb-3">LiftSync</h1>
          <p className="text-[#64748b] text-lg max-w-xs">
            Your music. Your rhythm. Your best workout yet.
          </p>
        </div>

        <div className="card-metallic rounded-2xl p-6 max-w-sm w-full text-left">
          <p className="text-blue-500 text-xs font-bold uppercase tracking-widest mb-2">Science backed</p>
          <p className="text-[#f1f5f9] text-2xl font-bold mb-1">10.7% longer.</p>
          <p className="text-[#64748b] text-sm">
            Studies show high BPM music helps people push through intense workouts significantly longer than without music.
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-sm mt-4">
          <button
            onClick={() => router.push("/onboarding")}
            className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated"
          >
            Get Started
          </button>
          <button
            onClick={() => signIn("spotify", { callbackUrl: "/dashboard" })}
            className="w-full bg-transparent border border-blue-500 text-blue-500 hover:bg-blue-500/10 font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated"
          >
            Log In
          </button>
        </div>
      </div>

      <p className="text-center text-[#64748b] text-xs pb-2">
        Powered by Spotify · Built for lifters
      </p>
      <footer className="text-center py-4">
        <a href="https://getsongbpm.com" target="_blank" rel="noopener noreferrer" className="text-[#64748b] hover:text-[#94a3b8] text-xs">
          BPM data provided by GetSongBPM
        </a>
      </footer>
    </div>
  );
}
