"use client";
import { useEffect, useState } from "react";

const MESSAGES = [
  "Analyzing your sonic trajectory...",
  "Galvanizing your workout sequence...",
  "Syncing the beats to your gains...",
  "Calibrating auditory performance metrics...",
  "Reverberating through your playlist...",
  "Cooking up something fire...",
  "Orchestrating your perfect session...",
  "Deciphering your vibe...",
  "Harmonizing tempo with intensity...",
  "Getting your gains ready...",
  "Quantifying optimal BPM distribution...",
  "Loading the good stuff...",
  "Amplifying your workout potential...",
  "Calculating peak performance frequencies...",
  "Almost there, for real...",
];

const STAR_FRAMES = [
  { char: "✦", size: "text-3xl" },
  { char: "✧", size: "text-xl" },
  { char: "✸", size: "text-4xl" },
  { char: "✹", size: "text-2xl" },
  { char: "✺", size: "text-3xl" },
  { char: "✻", size: "text-xl" },
  { char: "✼", size: "text-4xl" },
  { char: "✴", size: "text-2xl" },
  { char: "✵", size: "text-3xl" },
  { char: "✳", size: "text-xl" },
  { char: "✱", size: "text-4xl" },
];

function randomOther(exclude: number, len: number) {
  let n;
  do { n = Math.floor(Math.random() * len); } while (n === exclude);
  return n;
}

export default function LoadingScreen() {
  const [msgIndex, setMsgIndex] = useState(0);
  const [starIndex, setStarIndex] = useState(0);
  const [msgTick, setMsgTick] = useState(0);

  useEffect(() => {
    const starId = setInterval(() => {
      setStarIndex((i) => (i + 1) % STAR_FRAMES.length);
    }, 150);
    return () => clearInterval(starId);
  }, []);

  useEffect(() => {
    // Randomize immediately on mount (safe — client only)
    setMsgIndex(Math.floor(Math.random() * MESSAGES.length));
    const msgId = setInterval(() => {
      setMsgIndex((prev) => randomOther(prev, MESSAGES.length));
      setMsgTick((t) => t + 1);
    }, 2000);
    return () => clearInterval(msgId);
  }, []);

  const star = STAR_FRAMES[starIndex];

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0f] text-white gap-6">
      <h1 className="text-4xl font-bold tracking-wide">LiftBeat</h1>
      <div className="flex flex-col items-center gap-4">
        <span
          className={`text-blue-500 select-none ${star.size}`}
          style={{ display: "inline-block", width: "3rem", textAlign: "center", lineHeight: 1 }}
        >
          {star.char}
        </span>
        <p
          key={msgTick}
          className="text-[#64748b] text-sm text-center max-w-xs px-4 font-light"
          style={{ animation: "liftfade 0.4s ease forwards" }}
        >
          {MESSAGES[msgIndex]}
        </p>
      </div>
    </div>
  );
}
