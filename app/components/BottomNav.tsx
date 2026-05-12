"use client";
import { Home, Music, BarChart2, Settings } from "lucide-react";

const TABS = [
  { label: "Home",     icon: Home      },
  { label: "Music",    icon: Music     },
  { label: "Stats",    icon: BarChart2 },
  { label: "Settings", icon: Settings  },
];

// Nav geometry (px)
const NAV_W   = 320;
const PAD     = 16;
const TAB_W   = (NAV_W - PAD * 2) / 4; // 72
const PILL_W  = 56;
const PILL_H  = 36;

function pillLeft(index: number) {
  const center = PAD + index * TAB_W + TAB_W / 2;
  return center - PILL_W / 2;
}

interface Props {
  activeIndex: number;
  onTabChange: (i: number) => void;
}

export default function BottomNav({ activeIndex, onTabChange }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        width: NAV_W,
        height: 64,
        borderRadius: 9999,
        background: "rgba(15, 17, 23, 0.88)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
        display: "flex",
        alignItems: "center",
        zIndex: 100,
        overflow: "hidden",
      }}
    >
      {/* Sliding pill */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: pillLeft(activeIndex),
          width: PILL_W,
          height: PILL_H,
          borderRadius: 9999,
          transform: "translateY(-50%)",
          background: "rgba(59,130,246,0.1)",
          border: "1px solid rgba(255,255,255,0.13)",
          transition: "left 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          pointerEvents: "none",
        }}
      />

      {/* Tab buttons */}
      {TABS.map(({ label, icon: Icon }, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={i}
            onClick={() => onTabChange(i)}
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
              flexShrink: 0,
              position: "relative",
              zIndex: 1,
              paddingLeft: 0,
              paddingRight: 0,
            }}
          >
            <Icon
              size={21}
              color={active ? "#3b82f6" : "#64748b"}
              strokeWidth={active ? 2.2 : 1.8}
              style={{ transition: "color 250ms ease, stroke 250ms ease" }}
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
