import { AlertTriangle, Lock } from "lucide-react";

import type { AuctionAlertPhase } from "../../hooks/useAuctionCountdownAlerts";

/**
 * Tailwind classes for the live countdown number, escalating with the alert
 * phase (red + pulse from 10s, stronger pulse from 5s, scale from 3s).
 */
export function countdownPhaseClass(phase: AuctionAlertPhase): string {
  switch (phase) {
    case "warn":
      return "text-red-600 auction-count-warn";
    case "urgent":
      return "text-red-600 auction-count-urgent";
    case "critical":
      return "text-red-700 auction-count-critical";
    case "closed":
      return "text-neutral-500";
    default:
      return "";
  }
}

const BANNER_STYLES: Record<
  Exclude<AuctionAlertPhase, "none">,
  string
> = {
  warn: "bg-amber-500",
  urgent: "bg-orange-600",
  critical: "bg-red-600",
  closed: "bg-neutral-800",
};

/**
 * Floating warning banner shown in the final 10 seconds of a reverse auction
 * and once it closes. Fixed at top-center, above all page content.
 */
export default function AuctionCountdownAlert({
  phase,
  secondsLeft,
  closed,
}: {
  phase: AuctionAlertPhase;
  secondsLeft: number;
  /** The auction has ended (status Completed) — show the closed banner. */
  closed: boolean;
}) {
  const showClosing = phase === "warn" || phase === "urgent" || phase === "critical";
  if (!showClosing && !closed) return null;

  const tone = closed ? BANNER_STYLES.closed : BANNER_STYLES[phase as "warn"];
  const pulse = !closed && phase !== "warn" ? "auction-count-warn" : "";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-none fixed left-1/2 top-4 z-[100] -translate-x-1/2 auction-alert-banner"
    >
      <div
        className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lg ring-1 ring-black/10 ${tone} ${pulse}`}
      >
        {closed ? (
          <>
            <Lock className="h-4 w-4" />
            <span>🔒 Auction Closed</span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-4 w-4" />
            <span>
              ⚠ Auction Closing in {secondsLeft} Second
              {secondsLeft === 1 ? "" : "s"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
