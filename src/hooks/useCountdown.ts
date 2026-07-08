import { useEffect, useState } from "react";

export interface CountdownState {
  /** Milliseconds remaining until the target (0 once passed). */
  msRemaining: number;
  /** Whether the target time is in the past. */
  isExpired: boolean;
  /** "HH:MM:SS" (or "DDd HH:MM:SS" when > 24h) formatted remaining time. */
  label: string;
}

function format(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${hms}` : hms;
}

/**
 * Live countdown to a target epoch (ms). Ticks every second. Pass `null` to
 * disable (returns an expired, empty state).
 *
 * `offsetMs` corrects for browser clock skew: pass the (server − client) offset
 * from `useServerTimeOffset()` so the countdown tracks server time. Defaults to
 * 0 (client clock).
 */
export function useCountdown(
  targetMs: number | null,
  offsetMs = 0
): CountdownState {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (targetMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [targetMs]);

  if (targetMs == null) {
    return { msRemaining: 0, isExpired: true, label: "—" };
  }
  const msRemaining = Math.max(0, targetMs - (now + offsetMs));
  return {
    msRemaining,
    isExpired: msRemaining <= 0,
    label: format(msRemaining),
  };
}
