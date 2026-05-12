"use client";
import BottomNav from "../components/BottomNav";

export default function Stats() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f1f5f9] flex flex-col items-center justify-center pb-20">
      <div className="text-center">
        <p className="text-5xl mb-4">📊</p>
        <h1 className="text-2xl font-bold tracking-wide mb-2">Stats</h1>
        <p className="text-[#64748b]">Coming soon.</p>
      </div>
      <BottomNav />
    </div>
  );
}
