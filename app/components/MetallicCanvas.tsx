"use client";
import { useEffect, useRef } from "react";

interface Props {
  r: number;
  g: number;
  b: number;
}

export default function MetallicCanvas({ r, g, b }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRgb = useRef({ r, g, b });

  useEffect(() => {
    targetRgb.current = { r, g, b };
  }, [r, g, b]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const grain = document.createElement("canvas");

    const buildGrain = () => {
      const w = canvas.width;
      const h = canvas.height;
      grain.width = w;
      grain.height = h;
      const gCtx = grain.getContext("2d")!;
      const img = gCtx.createImageData(w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const v = (Math.sin(y * 3.2) * 0.5 + 0.5) * 0.5 + Math.random() * 0.5;
          const c = Math.floor(v * 255);
          d[i] = c; d[i + 1] = c; d[i + 2] = c;
          d[i + 3] = 12;
        }
      }
      gCtx.putImageData(img, 0, 0);
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      buildGrain();
    };

    resize();
    window.addEventListener("resize", resize);

    const cur = { r, g, b };
    let t = 0;
    let raf: number;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const tgt = targetRgb.current;

      cur.r += (tgt.r - cur.r) * 0.02;
      cur.g += (tgt.g - cur.g) * 0.02;
      cur.b += (tgt.b - cur.b) * 0.02;

      const R = Math.round(cur.r);
      const G = Math.round(cur.g);
      const B = Math.round(cur.b);

      // 1. Dark base
      const base = ctx.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0,   "#111116");
      base.addColorStop(0.5, "#18181f");
      base.addColorStop(1,   "#0d0d11");
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);

      // 2. Glow 1 — large, drifts left-center
      const g1x = w * 0.25 + Math.sin(t * 0.28) * w * 0.08;
      const g1y = h * 0.50 + Math.cos(t * 0.22) * h * 0.08;
      const grd1 = ctx.createRadialGradient(g1x, g1y, 0, g1x, g1y, 300);
      grd1.addColorStop(0, `rgba(${R},${G},${B},0.28)`);
      grd1.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd1;
      ctx.fillRect(0, 0, w, h);

      // 3. Glow 2 — smaller, drifts right-center
      const g2x = w * 0.72 + Math.cos(t * 0.19) * w * 0.07;
      const g2y = h * 0.45 + Math.sin(t * 0.31) * h * 0.07;
      const grd2 = ctx.createRadialGradient(g2x, g2y, 0, g2x, g2y, 200);
      grd2.addColorStop(0, `rgba(${R},${G},${B},0.20)`);
      grd2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd2;
      ctx.fillRect(0, 0, w, h);

      // 4. Grain texture (static, generated once per resize)
      ctx.drawImage(grain, 0, 0);

      // 5. Edge vignette
      const vig = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      t += 0.006;
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
        display: "block",
      }}
    />
  );
}
