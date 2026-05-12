"use client";
import { useSession, signOut } from "next-auth/react";

export default function SettingsTab() {
  const { data: session } = useSession();

  return (
    <div className="p-8">
      <div className="max-w-md mx-auto">
        <h1 className="text-3xl font-bold tracking-wide mb-1">Settings</h1>
        <p className="text-[#64748b] mb-8">Your LiftSync account.</p>

        <div className="card-metallic rounded-xl p-5 mb-4">
          <p className="text-[#64748b] text-xs uppercase tracking-widest mb-1">Signed in as</p>
          <p className="font-semibold">{session?.user?.name}</p>
        </div>

        <div className="card-metallic rounded-xl p-5 mb-6">
          <p className="text-[#64748b] text-xs uppercase tracking-widest mb-1">Spotify</p>
          <p className="text-sm text-[#94a3b8]">Connected</p>
        </div>

        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full border border-red-500/40 text-red-400 hover:bg-red-500/10 font-semibold py-4 rounded-xl transition active:scale-95"
        >
          Sign out
        </button>

        <p className="text-center text-[#64748b] text-xs mt-6">
          More settings coming soon — BPM thresholds, rest notifications, and more.
        </p>
      </div>
    </div>
  );
}
