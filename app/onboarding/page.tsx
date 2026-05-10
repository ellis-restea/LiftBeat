"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

const slides = [
  {
    tag: "The Problem",
    headline: "You're leaving gains on the table.",
    body: "Most people shuffle the same playlist and fumble with their phone between sets. Your music should work as hard as you do — automatically.",
    visual: "🎧",
    cta: null,
  },
  {
    tag: "The Science",
    headline: "10.7% longer. 13% faster recovery.",
    body: "Peer-reviewed research shows that high tempo music (130 BPM) helps people push through intense workouts significantly longer, with faster heart rate recovery after. Your playlist tempo matters.",
    source: "Stork et al., BMC Sports Science, 2019",
    visual: "📈",
    cta: null,
  },
  {
    tag: "The Solution",
    headline: "LiftSync does it automatically.",
    body: "High BPM during your set. Low BPM during rest. Synced to your Spotify, timed to your workout. No touching your phone. Just lift.",
    visual: "⚡",
    cta: "Connect Spotify & Get Started",
  },
];

export default function Onboarding() {
  const [current, setCurrent] = useState(0);
  const router = useRouter();
  const slide = slides[current];

  const handleNext = () => {
    if (current < slides.length - 1) {
      setCurrent(current + 1);
    }
  };

  const handleSpotify = () => {
    signIn("spotify", { callbackUrl: "/playlist-select" });
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Skip */}
      <div className="flex justify-end p-6">
        <button
          onClick={() => signIn("spotify", { callbackUrl: "/playlist-select" })}
          className="text-gray-500 hover:text-white text-sm transition"
        >
          Skip
        </button>
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-6">
        <div className="text-6xl mb-2">{slide.visual}</div>

        <div>
          <p className="text-green-400 text-xs font-bold uppercase tracking-widest mb-3">
            {slide.tag}
          </p>
          <h2 className="text-3xl font-black mb-4 leading-tight">{slide.headline}</h2>
          <p className="text-gray-400 text-base max-w-sm leading-relaxed">{slide.body}</p>
          {slide.source && (
            <p className="text-gray-600 text-xs mt-3 italic">{slide.source}</p>
          )}
        </div>
      </div>

      {/* Bottom */}
      <div className="p-8 flex flex-col gap-4 max-w-sm mx-auto w-full">
        {/* Dots */}
        <div className="flex justify-center gap-2 mb-2">
          {slides.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === current ? "w-6 bg-green-500" : "w-1.5 bg-gray-700"
              }`}
            />
          ))}
        </div>

        {slide.cta ? (
          <button
            onClick={handleSpotify}
            className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-xl text-lg transition"
          >
            {slide.cta}
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="w-full bg-white hover:bg-gray-100 text-black font-bold py-4 rounded-xl text-lg transition"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}