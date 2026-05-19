"use client";

// Each bar maps to a drum element with its own height, animation curve, and beat-grid timing.
// Kick + snare share a 0.52s period (~115 BPM); snare is offset by half that.
// Hi-hat runs at 0.28s (3 hits/cycle) for rapid 16th-note flicker.
// Bass at 1.05s (~2 kick cycles) sustains across the bar like a sub note.
const BARS = [
  { label: "kick",  height: 56, style: "eq-kick 0.52s linear 0s infinite"   },
  { label: "snare", height: 40, style: "eq-snare 0.52s linear 0.26s infinite" },
  { label: "hihat", height: 26, style: "eq-hihat 0.28s linear 0.04s infinite" },
  { label: "bass",  height: 50, style: "eq-bass 1.05s ease-in-out 0.1s infinite" },
];

export default function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0f] text-white gap-10">
      <h1 className="text-4xl font-bold tracking-wide">LiftBeat</h1>
      <div className="flex items-end gap-1.5">
        {BARS.map((bar) => (
          <div
            key={bar.label}
            style={{
              width: 10,
              height: bar.height,
              borderRadius: "3px 3px 1px 1px",
              background: "linear-gradient(to top, #1d4ed8, #60a5fa)",
              boxShadow: "0 0 8px rgba(59,130,246,0.65), 0 0 18px rgba(59,130,246,0.25)",
              transformOrigin: "bottom",
              animation: bar.style,
              willChange: "transform, opacity",
            }}
          />
        ))}
      </div>
    </div>
  );
}
