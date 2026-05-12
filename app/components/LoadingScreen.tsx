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

function randomOther(exclude: number) {
  let n;
  do { n = Math.floor(Math.random() * MESSAGES.length); } while (n === exclude);
  return n;
}

export default function LoadingScreen() {
  const [msgIndex, setMsgIndex] = useState(() => Math.floor(Math.random() * MESSAGES.length));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setMsgIndex((prev) => randomOther(prev));
      setTick((t) => t + 1);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-6">
      <h1 className="text-4xl font-bold tracking-tight">LiftSync</h1>
      <div className="flex flex-col items-center gap-4">
        <span
          className="text-green-400 text-4xl select-none"
          style={{ display: "inline-block", animation: "liftspin 2s linear infinite" }}
        >
          ✦
        </span>
        <p
          key={tick}
          className="text-gray-400 text-sm text-center max-w-xs px-4"
          style={{ animation: "liftfade 0.4s ease forwards" }}
        >
          {MESSAGES[msgIndex]}
        </p>
      </div>
    </div>
  );
}
