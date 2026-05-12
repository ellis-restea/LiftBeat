// Web Audio API + navigator.vibrate() feedback utilities.
// Silently no-ops when: server-side, user disabled in settings,
// an input/textarea has focus (typing), or the API is unavailable.

let _ctx: AudioContext | null = null;

// Returns the singleton AudioContext without resuming it.
// Resume is handled in tone() so it can be properly awaited.
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

// True when a text-entry element has focus — skip all feedback while typing.
function isInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    (el as HTMLElement).isContentEditable
  );
}

// Dedup: ignore a sound if the same type fired within this window (ms).
// Prevents double-fire when selection feedback + save feedback overlap.
const DEDUP_MS = 80;
const _lastFired: Partial<Record<string, number>> = {};
function isDuplicate(type: string): boolean {
  const now = Date.now();
  if (_lastFired[type] !== undefined && now - _lastFired[type]! < DEDUP_MS) return true;
  _lastFired[type] = now;
  return false;
}

async function tone(hz: number, ms: number, vol: number, delayMs = 0): Promise<void> {
  const ctx = getCtx();
  if (!ctx) return;

  // Await resume so the oscillator is scheduled on a running context.
  // Without this, tones scheduled on a suspended context are silently dropped.
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }

  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const t0 = ctx.currentTime + delayMs / 1000;
    const t1 = t0 + ms / 1000;

    osc.type = "sine";
    osc.frequency.setValueAtTime(hz, t0);

    // Brief linear attack (2 ms) then exponential decay — prevents clicks
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.start(t0);
    osc.stop(t1 + 0.01);
  } catch {
    // silently ignore scheduling errors
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
  if (isInputFocused()) return;
  if (isDuplicate(`sound:${type}`)) return;
  if (localStorage.getItem("ls_sound") === "false") return;
  SOUNDS[type](); // fire-and-forget async — no need to await
}

export function haptic(type: FeedbackType): void {
  if (typeof window === "undefined") return;
  if (isInputFocused()) return;
  if (localStorage.getItem("ls_haptic") === "false") return;
  HAPTICS[type]();
}

// Convenience: sound + haptic together
export function feedback(type: FeedbackType): void {
  sound(type);
  haptic(type);
}
