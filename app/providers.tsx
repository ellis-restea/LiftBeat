"use client";
import { SessionProvider } from "next-auth/react";
import { useEffect } from "react";

function ButtonSpring() {
  useEffect(() => {
    let downBtn: HTMLButtonElement | null = null;

    const press = (e: PointerEvent) => {
      const btn = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      downBtn = btn;
      btn.style.transition = "transform 80ms ease-in";
      btn.style.transform = "scale(0.95)";
    };

    const release = () => {
      if (!downBtn) return;
      const btn = downBtn;
      downBtn = null;
      btn.style.transition = "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)";
      btn.style.transform = "scale(1)";
      setTimeout(() => {
        if (btn.style.transform === "scale(1)") {
          btn.style.transform = "";
          btn.style.transition = "";
        }
      }, 250);
    };

    document.addEventListener("pointerdown", press);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);

    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
    };
  }, []);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ButtonSpring />
      {children}
    </SessionProvider>
  );
}