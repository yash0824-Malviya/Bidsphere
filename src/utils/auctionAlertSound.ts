/**
 * Reverse-auction countdown alert sounds.
 *
 * Uses the HTML5 Web Audio API to synthesize beeps at runtime — no audio files
 * to ship or preload. Everything degrades gracefully: if the browser has no
 * AudioContext, or autoplay is blocked until the first user gesture, calls are
 * silent no-ops rather than throwing.
 */

type BeepLevel = "warn" | "urgent" | "critical" | "closed";

interface BeepProfile {
  freq: number;
  /** Seconds. */
  duration: number;
  /** Peak gain (0–1). */
  gain: number;
  type: OscillatorType;
}

// Louder / higher pitched as urgency increases (task: stronger beep at 5s, etc).
const PROFILES: Record<BeepLevel, BeepProfile> = {
  warn: { freq: 660, duration: 0.12, gain: 0.16, type: "sine" },
  urgent: { freq: 880, duration: 0.16, gain: 0.3, type: "square" },
  critical: { freq: 1046, duration: 0.2, gain: 0.42, type: "square" },
  closed: { freq: 320, duration: 0.55, gain: 0.4, type: "sawtooth" },
};

let ctx: AudioContext | null = null;
let unlockBound = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

/**
 * Resume the AudioContext on the first user gesture so beeps aren't blocked by
 * the browser autoplay policy. Safe to call repeatedly; binds listeners once.
 */
export function primeAuctionAudio(): void {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  const resume = () => {
    const c = getCtx();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", resume);
  window.addEventListener("keydown", resume);
  window.addEventListener("touchstart", resume);
}

/**
 * Play a single alert beep. No-op when audio is unavailable or still blocked by
 * the autoplay policy (we attempt a resume but never throw).
 */
export function playAuctionBeep(level: BeepLevel): void {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume().catch(() => {});
    const p = PROFILES[level];
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = p.type;
    osc.frequency.setValueAtTime(p.freq, now);
    // A short attack/decay envelope so beeps sound crisp, not clicky.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(p.gain, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + p.duration);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(now + p.duration + 0.03);
  } catch {
    /* ignore — audio must never break the auction UI */
  }
}
