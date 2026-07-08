import { useEffect, useRef, useState } from "react";

import { playAuctionBeep, primeAuctionAudio } from "../utils/auctionAlertSound";

/** Visual urgency phase for the final countdown window. */
export type AuctionAlertPhase =
  | "none"
  | "warn" // 10–6 s
  | "urgent" // 5–4 s
  | "critical" // 3–1 s
  | "closed"; // 0 s / ended

export interface AuctionAlertState {
  phase: AuctionAlertPhase;
  secondsLeft: number;
}

function phaseForSeconds(active: boolean, s: number): AuctionAlertPhase {
  if (!active) return "none";
  if (s <= 0) return "closed";
  if (s <= 3) return "critical";
  if (s <= 5) return "urgent";
  if (s <= 10) return "warn";
  return "none";
}

/**
 * Drives the enterprise reverse-auction countdown alerts: a per-second beep in
 * the final 10 seconds (escalating in loudness), a one-shot "closed" tone at 0,
 * and the visual `phase` used for red/pulse/scale styling and the banner.
 *
 * Beeps fire only on second *transitions* while mounted, so:
 *   • a sound plays at most once per second, and
 *   • refreshing mid-countdown never replays seconds that already elapsed
 *     (the first observed second is recorded silently).
 */
export function useAuctionCountdownAlerts({
  msRemaining,
  active,
}: {
  msRemaining: number;
  active: boolean;
}): AuctionAlertState {
  const secondsLeft = active ? Math.max(0, Math.ceil(msRemaining / 1000)) : 0;
  const [phase, setPhase] = useState<AuctionAlertPhase>("none");

  const lastBeepSecond = useRef<number | null>(null);
  const closedPlayed = useRef(false);

  useEffect(() => {
    primeAuctionAudio();
  }, []);

  useEffect(() => {
    setPhase(phaseForSeconds(active, secondsLeft));

    if (!active) {
      lastBeepSecond.current = null;
      closedPlayed.current = false;
      return;
    }

    // First sample after (re)activation: record without beeping so a refresh
    // mid-countdown doesn't replay already-elapsed seconds.
    if (lastBeepSecond.current === null) {
      lastBeepSecond.current = secondsLeft;
      return;
    }
    // Once-per-second guard — only act on an actual second change.
    if (secondsLeft === lastBeepSecond.current) return;
    lastBeepSecond.current = secondsLeft;

    if (secondsLeft >= 1 && secondsLeft <= 10) {
      const level =
        secondsLeft >= 6 ? "warn" : secondsLeft >= 4 ? "urgent" : "critical";
      playAuctionBeep(level);
    } else if (secondsLeft === 0 && !closedPlayed.current) {
      closedPlayed.current = true;
      playAuctionBeep("closed");
    }
  }, [secondsLeft, active]);

  return { phase, secondsLeft };
}
