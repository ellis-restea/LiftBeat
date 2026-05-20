"use client";
import { useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { setNavDir, usePageEnter } from "@/lib/nav";
import { saveDjMode, type DjMode } from "@/lib/djMode";

export default function DjModePage() {
  return <Suspense><DjModeInner /></Suspense>;
}

function DjModeInner() {
  const { data: session } = useSession();
  const router = useRouter();
  const enterClass = usePageEnter();
  const [mode, setMode] = useState<DjMode>("responsive");
  const [saving, setSaving] = useState(false);

  const isResponsive = mode === "responsive";

  const handleToggle = () => setMode(isResponsive ? "chill" : "responsive");

  const handleContinue = async () => {
    if (!session?.user?.name) return;
    setSaving(true);
    await saveDjMode(session.user.name, mode);
    setSaving(false);
    setNavDir("forward");
    router.push("/workout-setup?from=onboarding");
  };

  return (
    <div className={`min-h-screen bg-[#0a0a0f] text-[#f1f5f9] flex flex-col overflow-hidden ${enterClass}`}>
      {/* Content — vertically centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        {/* Emoji */}
        <div className="text-6xl mb-6" style={{ transition: "opacity 200ms" }}>
          {isResponsive ? "⚡" : "🌊"}
        </div>

        {/* Headline */}
        <h2 className="text-3xl font-black tracking-wide mb-10 leading-tight max-w-xs">
          What kind of workout DJ do you want?
        </h2>

        {/* Toggle container with soft glow */}
        <div
          className="flex flex-col items-center gap-5 py-8 px-14 rounded-3xl"
          style={{
            boxShadow: isResponsive
              ? "0 0 64px 16px rgba(34,197,94,0.18)"
              : "0 0 64px 16px rgba(249,115,22,0.18)",
            transition: "box-shadow 500ms ease",
          }}
        >
          {/* Mode label */}
          <p
            className="text-xl font-bold tracking-wide"
            style={{
              color: isResponsive ? "#4ade80" : "#fb923c",
              transition: "color 300ms ease",
            }}
          >
            {isResponsive ? "Responsive" : "Chill"}
          </p>

          {/* Large iOS-style toggle */}
          <button
            onClick={handleToggle}
            role="switch"
            aria-checked={isResponsive}
            className="relative rounded-full focus:outline-none active:scale-95 transition-transform"
            style={{
              width: 80,
              height: 40,
              backgroundColor: isResponsive ? "#22c55e" : "#f97316",
              transition: "background-color 300ms ease",
            }}
          >
            <div
              className="absolute top-1 w-8 h-8 bg-white rounded-full shadow-lg"
              style={{
                transform: isResponsive ? "translateX(44px)" : "translateX(4px)",
                transition: "transform 300ms ease",
              }}
            />
          </button>
        </div>

        {/* Description */}
        <p
          className="text-[#64748b] text-base leading-relaxed mt-8 max-w-xs"
          style={{ minHeight: 48 }}
        >
          {isResponsive
            ? "Songs switch the moment your state changes."
            : "Lets the song finish, then queues the right one."}
        </p>
      </div>

      {/* Continue button */}
      <div className="px-8 pb-8 max-w-sm mx-auto w-full shrink-0">
        <button
          onClick={handleContinue}
          disabled={saving || !session?.user?.name}
          className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated"
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>
    </div>
  );
}
