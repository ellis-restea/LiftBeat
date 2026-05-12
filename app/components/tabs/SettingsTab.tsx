"use client";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { feedback } from "@/lib/feedback";

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex justify-between items-center p-5">
      <div>
        <p className="font-semibold text-sm">{label}</p>
        <p className="text-[#64748b] text-xs mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => {
          onChange(!value);
          feedback("light");
        }}
        className={`w-12 h-6 rounded-full transition-colors shrink-0 ${
          value ? "bg-blue-500" : "bg-[#1a1d2e] border border-white/10"
        }`}
        aria-checked={value}
        role="switch"
      >
        <div
          className={`w-5 h-5 bg-white rounded-full transition-transform mx-0.5 ${
            value ? "translate-x-6" : ""
          }`}
        />
      </button>
    </div>
  );
}

export default function SettingsTab() {
  const { data: session } = useSession();
  const [soundOn,  setSoundOn]  = useState(true);
  const [hapticOn, setHapticOn] = useState(true);

  useEffect(() => {
    setSoundOn(localStorage.getItem("ls_sound")  !== "false");
    setHapticOn(localStorage.getItem("ls_haptic") !== "false");
  }, []);

  const handleSound = (v: boolean) => {
    setSoundOn(v);
    localStorage.setItem("ls_sound", v ? "true" : "false");
  };

  const handleHaptic = (v: boolean) => {
    setHapticOn(v);
    localStorage.setItem("ls_haptic", v ? "true" : "false");
  };

  return (
    <div className="p-8">
      <div className="max-w-md mx-auto">
        <h1 className="text-3xl font-bold tracking-wide mb-1">Settings</h1>
        <p className="text-[#64748b] mb-8">Your LiftSync account.</p>

        {/* Account */}
        <div className="card-metallic rounded-xl p-5 mb-4">
          <p className="text-[#64748b] text-xs uppercase tracking-widest mb-1">Signed in as</p>
          <p className="font-semibold">{session?.user?.name}</p>
        </div>

        {/* Sound & Haptics */}
        <div className="card-metallic rounded-xl divide-y divide-white/5 mb-4">
          <Toggle
            label="Sound Effects"
            description="Tap sounds for buttons and actions"
            value={soundOn}
            onChange={handleSound}
          />
          <Toggle
            label="Haptic Feedback"
            description="Vibration on Android devices"
            value={hapticOn}
            onChange={handleHaptic}
          />
        </div>

        {/* Spotify */}
        <div className="card-metallic rounded-xl p-5 mb-6">
          <p className="text-[#64748b] text-xs uppercase tracking-widest mb-1">Spotify</p>
          <p className="text-sm text-[#94a3b8]">Connected</p>
        </div>

        <button
          onClick={() => {
            feedback("medium");
            signOut({ callbackUrl: "/" });
          }}
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
