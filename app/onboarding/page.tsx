"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { setNavDir, usePageEnter } from "@/lib/nav";

const slides = [
  {
    tag: "The Problem",
    headline: "You're losing reps to your playlist.",
    body: "Between every set, you're fumbling with your phone, skipping songs, killing your momentum. Your music should match your intensity — automatically. That's what LiftBeat does.",
    visual: "🎧",
    visualMarginTop: 120,
    bodyMarginBottom: 0,
    source: null,
    cta: null,
  },
  {
    tag: "The Science",
    headline: "The right BPM makes you lift harder.",
    body: "High tempo music (130+ BPM) during sets helps you push 10.7% longer. Lower tempo music during rest leads to 13% faster heart rate recovery after your set. Same workout, better music timing, better results.",
    source: "Stork et al., BMC Sports Science, 2019",
    visual: "📈",
    visualMarginTop: 60,
    bodyMarginBottom: 0,
    cta: null,
  },
  {
    tag: "The Solution",
    headline: "LiftBeat is your workout DJ.",
    body: "High BPM during your set. Low BPM during rest. Synced to your Spotify, timed to your workout. Hit one button to start — we handle everything else.",
    visual: "⚡",
    visualMarginTop: 0,
    bodyMarginBottom: 100,
    source: null,
    cta: "Connect Spotify & Get Started",
  },
];

export default function Onboarding() {
  const [current, setCurrent] = useState(0);
  // null = no animation (initial load). Number = which slide is animating in.
  const [animating, setAnimating] = useState<number | null>(null);
  // Per-slide key; incrementing forces the text container to remount and restart CSS animations.
  const [slideAnimKeys, setSlideAnimKeys] = useState<Record<number, number>>({});
  const enterClass = usePageEnter();
  const slide = slides[current];

  const navigate = (next: number) => {
    setCurrent(next);
    setAnimating(next);
    setSlideAnimKeys(k => ({ ...k, [next]: (k[next] ?? 0) + 1 }));
  };

  const handleNext = () => {
    if (current < slides.length - 1) navigate(current + 1);
  };

  const handleBack = () => {
    if (current > 0) navigate(current - 1);
  };

  const handleSpotify = () => {
    setNavDir("forward");
    signIn("spotify", { callbackUrl: "/dj-mode" });
  };

  return (
    <div className={`min-h-screen bg-[#0a0a0f] text-[#f1f5f9] flex flex-col overflow-hidden ${enterClass}`}>
      {/* Top bar */}
      <div className="flex items-center p-6 shrink-0">
        {current > 0 ? (
          <button
            onClick={handleBack}
            className="text-[#64748b] hover:text-white text-sm transition mt-5"
          >
            ← Back
          </button>
        ) : (
          <div />
        )}
      </div>

      {/* Carousel — text sits at the bottom of this area, not centered */}
      <div className="flex-1 overflow-hidden">
        <div
          className="flex h-full"
          style={{
            transform: `translateX(-${current * (100 / slides.length)}%)`,
            transition: "transform 300ms ease-in-out",
            width: `${slides.length * 100}%`,
          }}
        >
          {slides.map((s, i) => (
            <div
              key={i}
              style={{ width: `${100 / slides.length}%` }}
              className="flex flex-col items-center justify-end pb-0 px-8 text-center gap-6"
            >
              <div className="text-6xl" style={s.visualMarginTop ? { marginTop: s.visualMarginTop } : undefined}>{s.visual}</div>
              {/* Rekeying this div remounts it, restarting CSS animations from scratch */}
              <div
                key={slideAnimKeys[i] ?? 0}
                className="text-center max-w-sm mx-auto"
              >
                <p className={`text-blue-500 text-xs font-bold uppercase tracking-widest mb-3${animating === i ? " slide-text-in" : ""}`}>
                  {s.tag}
                </p>
                <h2 className={`text-3xl font-black tracking-wide mb-4 leading-tight${animating === i ? " slide-text-in" : ""}`}>
                  {s.headline}
                </h2>
                <p
                  className={`text-[#64748b] text-base text-center leading-relaxed${animating === i ? " slide-text-in-d1" : ""}`}
                  style={s.bodyMarginBottom ? { marginBottom: s.bodyMarginBottom } : undefined}
                >
                  {s.body}
                </p>
                {s.source && (
                  <p className={`text-[#64748b] text-xs mt-3 italic font-light${animating === i ? " slide-text-in-d2" : ""}`}>
                    {s.source}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom */}
      <div className="pt-0 px-8 pb-8 flex flex-col gap-2 max-w-sm mx-auto w-full shrink-0">
        {/* Dots */}
        <div className="flex justify-center gap-2">
          {slides.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ease-in-out ${
                i === current ? "w-6 bg-blue-500" : "w-1.5 bg-[#334155]"
              }`}
            />
          ))}
        </div>

        {slide.cta ? (
          <button
            onClick={handleSpotify}
            className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated mt-[10px] mb-[40px]"
          >
            {slide.cta}
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated mt-[10px] mb-[40px]"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
