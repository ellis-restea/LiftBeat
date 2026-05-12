// Web Audio API + navigator.vibrate() feedback utilities.
// Silently no-ops when: server-side, user disabled in settings,
// or an input/textarea has focus (typing).

let _ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!_ctx) {
      _ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
    }
    return _ctx;
  } catch {
    return null;
  }
}

// Call resume() synchronously within the user-gesture call stack so the
// browser accepts it, then schedule the actual audio in the .then() callback.
// Using async/await would resume AFTER the call stack unwinds; on some mobile
// browsers that loses the user-activation token and resume silently fails.
function withCtx(label: string, fn: (ctx: AudioContext) => void): void {
  const ctx = getCtx();
  if (!ctx) {
    console.log(`[Sound] ${label} — no AudioContext`);
    return;
  }
  console.log(`[Sound] ${label} — context state: ${ctx.state}`);
  if (ctx.state !== "running") {
    ctx.resume()
      .then(() => {
        console.log(`[Sound] ${label} — resumed, state now: ${ctx.state}`);
        fn(ctx);
      })
      .catch((err) => {
        console.log(`[Sound] ${label} — resume failed:`, err);
      });
  } else {
    fn(ctx);
  }
}

// Only exponential ramps — linearRampToValueAtTime can produce audible clicks
// at value-0 boundaries; exponential always stays positive.
// osc.onended disconnects nodes so they can be GC'd and don't pile up.
function scheduleTone(
  ctx: AudioContext,
  hz: number,
  ms: number,
  vol: number,
  delayMs = 0,
  label = "",
): void {
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const t0 = ctx.currentTime + delayMs / 1000;
    const t1 = t0 + ms / 1000;

    console.log(`[Sound] scheduleTone${label ? " " + label : ""} — hz:${hz} t0:${t0.toFixed(4)} t1:${t1.toFixed(4)} now:${ctx.currentTime.toFixed(4)}`);

    osc.type = "sine";
    osc.frequency.setValueAtTime(hz, t0);

    gain.gain.setValueAtTime(0.0001, t0);                     // near-zero start
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.003);  // 3ms attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);        // smooth decay

    osc.start(t0);
    osc.stop(t1 + 0.02);

    // Disconnect nodes once done so they can be garbage-collected
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  } catch (err) {
    console.log("[Sound] scheduleTone error:", err);
  }
}

// True when a text-entry element has focus — skip all feedback while typing.
function isInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (el as HTMLElement).isContentEditable;
}

const SOUNDS: Record<FeedbackType, (ctx: AudioContext, label: string) => void> = {
  light:  (ctx, lbl) => scheduleTone(ctx, 800, 20, 0.08, 0, lbl),
  medium: (ctx, lbl) => scheduleTone(ctx, 600, 30, 0.10, 0, lbl),
  heavy:  (ctx, lbl) => scheduleTone(ctx, 400, 50, 0.12, 0, lbl),
  error:  (ctx, lbl) => {
    scheduleTone(ctx, 300, 40, 0.10, 0,  lbl);
    scheduleTone(ctx, 300, 40, 0.10, 80, lbl);
  },
};

const HAPTICS: Record<FeedbackType, () => void> = {
  light:  () => navigator.vibrate?.(10),
  medium: () => navigator.vibrate?.(15),
  heavy:  () => navigator.vibrate?.(30),
  error:  () => navigator.vibrate?.([50, 50, 50]),
};

export type FeedbackType = "light" | "medium" | "heavy" | "error";

export function sound(type: FeedbackType, label = ""): void {
  if (typeof window === "undefined") return;
  if (isInputFocused()) return;
  if (localStorage.getItem("ls_sound") === "false") return;
  const tag = label || type;
  withCtx(tag, (ctx) => SOUNDS[type](ctx, tag));
}

export function haptic(type: FeedbackType): void {
  if (typeof window === "undefined") return;
  if (isInputFocused()) return;
  if (localStorage.getItem("ls_haptic") === "false") return;
  HAPTICS[type]();
}

export function feedback(type: FeedbackType, label = ""): void {
  sound(type, label);
  haptic(type);
}
