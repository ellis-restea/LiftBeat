// Web Audio API + navigator.vibrate() feedback utilities.
// All functions are fire-and-forget and silently no-op when:
//   - called server-side (no window)
//   - the user has disabled the feature in localStorage
//   - the browser doesn't support the API

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
    if (_ctx.state === "suspended") _ctx.resume();
    return _ctx;
  } catch {
    return null;
  }
}

function tone(hz: number, ms: number, vol: number, delayMs = 0): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const t0  = ctx.currentTime + delayMs / 1000;
    const t1  = t0 + ms / 1000;

    osc.type = "sine";
    osc.frequency.setValueAtTime(hz, t0);

    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.start(t0);
    osc.stop(t1 + 0.01);
  } catch {
    // silently ignore
  }
}

const SOUNDS = {
  light:  () => tone(800, 20, 0.08),
  medium: () => tone(600, 30, 0.10),
  heavy:  () => tone(400, 50, 0.12),
  error:  () => { tone(300, 40, 0.10, 0); tone(300, 40, 0.10, 80); },
} as const;

const HAPTICS = {
  light:  () => navigator.vibrate?.(10),
  medium: () => navigator.vibrate?.(15),
  heavy:  () => navigator.vibrate?.(30),
  error:  () => navigator.vibrate?.([50, 50, 50]),
} as const;

export type FeedbackType = keyof typeof SOUNDS;

export function sound(type: FeedbackType): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("ls_sound") === "false") return;
  SOUNDS[type]();
}

export function haptic(type: FeedbackType): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("ls_haptic") === "false") return;
  HAPTICS[type]();
}

// Convenience: sound + haptic together
export function feedback(type: FeedbackType): void {
  sound(type);
  haptic(type);
}
