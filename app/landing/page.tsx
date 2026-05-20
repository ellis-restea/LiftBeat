"use client";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { setNavDir, usePageEnter } from "@/lib/nav";

export default function Landing() {
  const router = useRouter();
  const enterClass = usePageEnter();

  const [statVal, setStatVal] = useState(0);
  const statRef = useRef<HTMLSpanElement>(null);
  const animatedRef = useRef(false);

  useEffect(() => {
    const el = statRef.current;
    if (!el) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || animatedRef.current) return;
      animatedRef.current = true;
      observer.disconnect();

      const duration = 1500;
      const target = 10.7;
      const start = performance.now();

      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        setStatVal(parseFloat((eased * target).toFixed(1)));
        if (t < 1) requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`min-h-screen bg-[#0a0a0f] text-[#f1f5f9] flex flex-col ${enterClass}`}>
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-6">
        <div className="mb-2">
          <h1 className="text-5xl font-black tracking-wide mb-3">LiftBeat</h1>
          <p className="text-[#94a3b8] text-lg font-medium max-w-xs">
            Your personal workout DJ.
          </p>
          <p className="text-[#64748b] text-sm max-w-xs mt-2 leading-relaxed">
            High BPM during your sets. Low BPM during rest. Automatically synced to Spotify.
          </p>
        </div>

        <div className="card-metallic rounded-2xl p-6 max-w-sm w-full text-left">
          <p className="text-[#f1f5f9] text-lg font-bold mb-2 leading-snug">
            Science backed — lift{" "}
            <span ref={statRef} className="text-blue-400 tabular-nums">
              {statVal.toFixed(1)}%
            </span>{" "}
            longer.
          </p>
          <p className="text-[#64748b] text-sm leading-relaxed">
            Research shows the right music at the right tempo increases endurance and speeds up
            recovery. We handle the playlist so you never have to.
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-sm mt-2">
          <button
            onClick={() => {
              setNavDir("forward");
              router.push("/onboarding");
            }}
            className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated"
          >
            Get Started
          </button>
          <button
            onClick={() => {
              setNavDir("forward");
              signIn("spotify", { callbackUrl: "/dashboard" });
            }}
            className="w-full bg-transparent border border-blue-500 text-blue-500 hover:bg-blue-500/10 font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated"
          >
            Log In
          </button>
        </div>
      </div>

      <p className="text-center text-[#64748b] text-xs pb-2">
        Powered by Spotify · Built for lifters
      </p>
    </div>
  );
}
