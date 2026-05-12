"use client";
import { usePathname, useRouter } from "next/navigation";
import { Home, Music, BarChart2, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const tabs = [
  { label: "Home", icon: Home, href: "/dashboard" },
  { label: "Music", icon: Music, href: "/playlist-select" },
  { label: "Stats", icon: BarChart2, href: "/stats" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const activeIndex = tabs.findIndex((t) => pathname.startsWith(t.href));
  const resolved = activeIndex === -1 ? 0 : activeIndex;

  const [pillLeft, setPillLeft] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const getPillLeft = (index: number) => {
    const btn = tabRefs.current[index];
    const nav = navRef.current;
    if (!btn || !nav) return 0;
    const navRect = nav.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    return btnRect.left - navRect.left + btnRect.width / 2 - 24;
  };

  useEffect(() => {
    setPillLeft(getPillLeft(resolved));
  }, [resolved]);

  const handleTab = (index: number, href: string) => {
    if (index === resolved) return;
    setAnimating(true);
    setPillLeft(getPillLeft(index));
    router.push(href);
    setTimeout(() => setAnimating(false), 300);
  };

  return (
    <div
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around"
      style={{
        background: "#0f1117",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        height: 64,
      }}
    >
      {/* Sliding pill */}
      {pillLeft !== null && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            left: pillLeft,
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: animating ? "none" : "1px solid rgba(255,255,255,0.12)",
            background: animating ? "rgba(59,130,246,0.12)" : "transparent",
            transition: "left 300ms cubic-bezier(0.4,0,0.2,1), border 200ms, background 200ms",
            pointerEvents: "none",
          }}
        />
      )}

      {tabs.map((tab, i) => {
        const Icon = tab.icon;
        const isActive = i === resolved;
        return (
          <button
            key={tab.href}
            ref={(el) => { tabRefs.current[i] = el; }}
            onClick={() => handleTab(i, tab.href)}
            className="flex flex-col items-center justify-center gap-1 w-16 h-full"
            style={{ background: "none", border: "none", cursor: "pointer" }}
          >
            <Icon
              size={22}
              color={isActive ? "#3b82f6" : "#64748b"}
              strokeWidth={isActive ? 2.2 : 1.8}
              style={{ transition: "color 200ms" }}
            />
            <span
              style={{
                fontSize: 10,
                color: isActive ? "#3b82f6" : "#64748b",
                transition: "color 200ms",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
