"use client";

const BARS = [
  { delay: "0s",    duration: "0.80s" },
  { delay: "0.18s", duration: "0.65s" },
  { delay: "0.06s", duration: "0.90s" },
  { delay: "0.25s", duration: "0.72s" },
];

export default function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0f] text-white gap-10">
      <h1 className="text-4xl font-bold tracking-wide">LiftBeat</h1>
      <div className="flex items-end gap-2" style={{ height: 52 }}>
        {BARS.map((bar, i) => (
          <div
            key={i}
            className="w-2.5 rounded-t-sm"
            style={{
              height: "100%",
              background: "linear-gradient(to top, #1d4ed8, #60a5fa)",
              boxShadow: "0 0 10px rgba(59,130,246,0.7), 0 0 22px rgba(59,130,246,0.3)",
              transformOrigin: "bottom",
              animation: `eq-bar ${bar.duration} ease-in-out ${bar.delay} infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
