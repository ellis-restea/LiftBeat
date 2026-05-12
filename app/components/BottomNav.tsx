"use client";
import { useRef } from "react";
import { Home, Music, BarChart2, Settings } from "lucide-react";

const TABS = [
  { label: "Home",     icon: Home      },
  { label: "Music",    icon: Music     },
  { label: "Stats",    icon: BarChart2 },
  { label: "Settings", icon: Settings  },
];

// 4 tabs × 80px = exactly 320px — no padding offset, perfect centering
const NAV_W  = 320;
const NAV_H  = 64;
const TAB_W  = NAV_W / 4; // 80
const PILL_W = 60;
const PILL_H = 54; // 50% taller than original 36px

function pillLeft(index: number): number {
  // Center of tab i = TAB_W * i + TAB_W / 2
  // Pill left edge  = center − PILL_W / 2
  return TAB_W * index + (TAB_W - PILL_W) / 2;
}

interface Props {
  activeIndex: number;
  onTabChange: (i: number) => void;
}

export default function BottomNav({ activeIndex, onTabChange }: Props) {
  const pillRef  = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = (i: number) => {
    if (i === activeIndex) return;
    onTabChange(i);

    // Re-trigger the bubble animation without touching React state
    const pill = pillRef.current;
    if (!pill) return;
    pill.classList.remove("bubble-transit");
    void pill.offsetWidth; // force style flush so the animation restarts
    pill.classList.add("bubble-transit");

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      pillRef.current?.classList.remove("bubble-transit");
    }, 340);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        width: NAV_W,
        height: NAV_H,
        borderRadius: 9999,
        background: "rgba(15, 17, 23, 0.88)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
        display: "flex",
        alignItems: "center",
        zIndex: 100,
        overflow: "hidden",
      }}
    >
      {/* Bubble pill — left transitions via CSS, appearance via .bubble-transit keyframe */}
      <div
        ref={pillRef}
        style={{
          position: "absolute",
          top: "50%",
          left: pillLeft(activeIndex),
          width: PILL_W,
          height: PILL_H,
          borderRadius: 9999,
          transform: "translateY(-50%)",
          background: "rgba(59, 130, 246, 0.08)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.14)",
          transition: "left 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          pointerEvents: "none",
        }}
      />

      {TABS.map(({ label, icon: Icon }, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={i}
            onClick={() => handleClick(i)}
            style={{
              width: TAB_W,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              background: "none",
              border: "none",
              cursor: "pointer",
              position: "relative",
              zIndex: 1,
              flexShrink: 0,
              padding: 0,
            }}
          >
            <Icon
              size={21}
              color={active ? "#3b82f6" : "#64748b"}
              strokeWidth={active ? 2.2 : 1.8}
              style={{ transition: "color 250ms ease" }}
            />
            <span
              style={{
                fontSize: 9.5,
                letterSpacing: "0.04em",
                color: active ? "#3b82f6" : "#64748b",
                fontWeight: active ? 600 : 400,
                transition: "color 250ms ease",
                userSelect: "none",
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
