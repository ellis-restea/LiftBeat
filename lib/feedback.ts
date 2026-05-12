// Web Audio API + navigator.vibrate() feedback utilities.
// Silently no-ops when: server-side, user disabled in settings,
// or an input/textarea has focus (typing).

let _ctx: AudioContext | null = null;
let _lastSoundTime = 0; // epoch ms — enforces 150ms minimum gap between sounds

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
function withCtx(fn: (ctx: AudioContext) => void): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state !== "running") {
    ctx.resume().then(() => fn(ctx)).catch(() => {});
  } else {
    fn(ctx);
  }
}

// Gain envelope: 3ms exponential attack → linear fade to 0 ending 5ms before
// the oscillator stop time. The gain reaches 0 before stop so there's no click.
function scheduleTone(
  ctx: AudioContext,
  hz: number,
  ms: number,
  vol: number,
  delayMs = 0,
): void {
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const t0 = ctx.currentTime + delayMs / 1000;
    const t1 = t0 + ms / 1000;

    osc.type = "sine";
    osc.frequency.setValueAtTime(hz, t0);

    gain.gain.setValueAtTime(0.0001, t0);                    // near-zero start
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.003); // 3ms attack
    gain.gain.linearRampToValueAtTime(0, t1 - 0.005);        // fade to silence 5ms before stop

    osc.start(t0);
    osc.stop(t1);

    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch {
    // silently ignore
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

const SOUNDS: Record<FeedbackType, (ctx: AudioContext) => void> = {
  light:  (ctx) => scheduleTone(ctx, 800, 12, 0.08),
  medium: (ctx) => scheduleTone(ctx, 600, 18, 0.10),
  heavy:  (ctx) => scheduleTone(ctx, 400, 25, 0.12),
  error:  (ctx) => {
    scheduleTone(ctx, 300, 25, 0.10, 0);
    scheduleTone(ctx, 300, 25, 0.10, 80);
  },
};

const HAPTICS: Record<FeedbackType, () => void> = {
  light:  () => navigator.vibrate?.(10),
  medium: () => navigator.vibrate?.(15),
  heavy:  () => navigator.vibrate?.(30),
  error:  () => navigator.vibrate?.([50, 50, 50]),
};

export type FeedbackType = "light" | "medium" | "heavy" | "error";

export function sound(type: FeedbackType): void {
  if (typeof window === "undefined") return;
  if (isInputFocused()) return;
  if (localStorage.getItem("ls_sound") === "false") return;
  const now = Date.now();
  if (now - _lastSoundTime < 150) return; // too soon — skip to avoid browser suppression
  _lastSoundTime = now;
  withCtx(SOUNDS[type]);
}

export function haptic(type: FeedbackType): void {
  if (typeof window === "undefined") return;
  if (isInputFocused()) return;
  if (localStorage.getItem("ls_haptic") === "false") return;
  HAPTICS[type]();
}

export function feedback(type: FeedbackType): void {
  sound(type);
  haptic(type);
}
