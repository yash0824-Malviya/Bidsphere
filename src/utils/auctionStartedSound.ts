/**
 * Short enterprise "auction started" chime (≈3s, ~50% volume, no loop).
 * Additive only — does not affect countdown beeps or auction workflow.
 *
 * Respects browser autoplay: if playback is blocked, queues until the next
 * user gesture (click / keypress / pointer move).
 */

let ctx: AudioContext | null = null;
let pendingPlay = false;
let gestureBound = false;

const VOLUME = 0.5; // 40–60% range
const TOTAL_DURATION_SEC = 3.2;

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

function bindGestureUnlock(): void {
  if (gestureBound || typeof window === "undefined") return;
  gestureBound = true;
  const onGesture = () => {
    const c = getCtx();
    if (c?.state === "suspended") void c.resume().catch(() => {});
    if (pendingPlay) {
      pendingPlay = false;
      void playAuctionStartedChimeNow();
    }
  };
  window.addEventListener("pointerdown", onGesture);
  window.addEventListener("keydown", onGesture);
  window.addEventListener("mousemove", onGesture, { once: false });
}

/** Attempt immediate playback. Returns false if autoplay is blocked. */
async function playAuctionStartedChimeNow(): Promise<boolean> {
  const c = getCtx();
  if (!c) return false;
  try {
    if (c.state === "suspended") {
      await c.resume();
    }
    if (c.state !== "running") return false;

    const now = c.currentTime;
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(VOLUME, now + 0.04);
    master.gain.setValueAtTime(VOLUME, now + TOTAL_DURATION_SEC - 0.45);
    master.gain.exponentialRampToValueAtTime(0.0001, now + TOTAL_DURATION_SEC);
    master.connect(c.destination);

    // Soft two-tone enterprise chime (C5 → E5 → G5), no loop.
    const notes: Array<{ freq: number; at: number; dur: number }> = [
      { freq: 523.25, at: 0, dur: 0.55 },
      { freq: 659.25, at: 0.45, dur: 0.65 },
      { freq: 783.99, at: 1.0, dur: 1.1 },
      { freq: 1046.5, at: 1.9, dur: 1.1 },
    ];

    for (const note of notes) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, now + note.at);
      const t0 = now + note.at;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.85, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + note.dur + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Play the auction-started notification sound once.
 * If the browser blocks autoplay, queues for the next user interaction.
 */
export function playAuctionStartedSound(): void {
  bindGestureUnlock();
  void playAuctionStartedChimeNow().then((ok) => {
    if (!ok) pendingPlay = true;
  });
}
