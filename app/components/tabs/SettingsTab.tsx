"use client";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { feedback } from "@/lib/feedback";
import { loadDjMode, saveDjMode, type DjMode } from "@/lib/djMode";

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
  const [djMode, setDjMode] = useState<DjMode>("responsive");

  useEffect(() => {
    setSoundOn(localStorage.getItem("ls_sound")  !== "false");
    setHapticOn(localStorage.getItem("ls_haptic") !== "false");
  }, []);

  useEffect(() => {
    if (!session?.user?.name) return;
    loadDjMode(session.user.name).then(setDjMode);
  }, [session?.user?.name]);

  const handleSound = (v: boolean) => {
    setSoundOn(v);
    localStorage.setItem("ls_sound", v ? "true" : "false");
  };

  const handleHaptic = (v: boolean) => {
    setHapticOn(v);
    localStorage.setItem("ls_haptic", v ? "true" : "false");
  };

  const handleDjMode = (next: DjMode) => {
    feedback("light");
    setDjMode(next);
    if (session?.user?.name) saveDjMode(session.user.name, next).catch(() => {});
  };

  return (
    <div className="p-8">
      <div className="max-w-md mx-auto">
        <h1 className="text-3xl font-bold tracking-wide mb-1 mt-[35px]">Settings</h1>
        <p className="text-[#64748b] mb-8">Your LiftBeat account.</p>

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

        {/* DJ Mode */}
        <div
          className="card-metallic rounded-xl mb-4"
          style={{
            boxShadow: djMode === "responsive"
              ? "0 0 32px 4px rgba(34,197,94,0.12), 0 4px 24px rgba(0,0,0,0.4)"
              : "0 0 32px 4px rgba(249,115,22,0.12), 0 4px 24px rgba(0,0,0,0.4)",
            transition: "box-shadow 500ms ease",
          }}
        >
          <div className="flex justify-between items-center p-5">
            <div>
              <p className="font-semibold text-sm">DJ Type</p>
              <p className="text-[#64748b] text-xs mt-0.5">
                {djMode === "responsive"
                  ? "Songs switch the moment your state changes."
                  : "Lets the song finish, then queues the right one."}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              <span
                className="text-xs font-semibold"
                style={{
                  color: djMode === "responsive" ? "#4ade80" : "#fb923c",
                  transition: "color 300ms ease",
                }}
              >
                {djMode === "responsive" ? "Responsive" : "Chill"}
              </span>
              <button
                onClick={() => handleDjMode(djMode === "responsive" ? "chill" : "responsive")}
                role="switch"
                aria-checked={djMode === "responsive"}
                className="relative w-12 h-6 rounded-full shrink-0 focus:outline-none"
                style={{
                  backgroundColor: djMode === "responsive" ? "#22c55e" : "#f97316",
                  transition: "background-color 300ms ease",
                }}
              >
                <div
                  className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md"
                  style={{
                    transform: djMode === "responsive" ? "translateX(26px)" : "translateX(2px)",
                    transition: "transform 300ms ease",
                  }}
                />
              </button>
            </div>
          </div>
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

      </div>
    </div>
  );
}
