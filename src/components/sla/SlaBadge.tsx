import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";

import { computeSla, type SlaTimer } from "../../api/sla";
import { useSlaNow } from "../../hooks/useSlaTicker";

/** "02h 18m" or "1d 05h" — minute granularity, enterprise style. */
export function formatSlaDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}h`;
  return `${pad(hours)}h ${pad(minutes)}m`;
}

interface Props {
  timer: SlaTimer | null | undefined;
  /** Show the countdown text next to the status. Default true. */
  showCountdown?: boolean;
  className?: string;
}

/**
 * Colour-coded SLA badge with live countdown. Green = On Track, Yellow = Due
 * Soon, Red = Breached. Uses the shared 30s ticker, so it stays live without a
 * per-second timer.
 */
export default function SlaBadge({ timer, showCountdown = true, className }: Props) {
  const now = useSlaNow();
  if (!timer) return null;

  const c = computeSla(timer, now);

  const style: Record<
    typeof c.phase,
    { cls: string; icon: typeof Clock; label: string }
  > = {
    on_track: {
      cls: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      icon: CheckCircle2,
      label: "On Track",
    },
    due_soon: {
      cls: "bg-amber-50 text-amber-700 ring-amber-200",
      icon: Clock,
      label: "Due Soon",
    },
    breached: {
      cls: "bg-rose-50 text-rose-700 ring-rose-200",
      icon: AlertTriangle,
      label: "Breached",
    },
    completed: {
      cls: "bg-neutral-100 text-neutral-600 ring-neutral-200",
      icon: CheckCircle2,
      label: "Completed",
    },
    cancelled: {
      cls: "bg-neutral-100 text-neutral-500 ring-neutral-200",
      icon: XCircle,
      label: "Cancelled",
    },
  };

  const s = style[c.phase];
  const Icon = s.icon;

  const countdown =
    c.phase === "breached"
      ? `Overdue ${formatSlaDuration(c.overdueMs)}`
      : c.phase === "on_track" || c.phase === "due_soon"
        ? formatSlaDuration(c.remainingMs)
        : null;

  return (
    <span
      title={
        timer.due_time
          ? `${timer.workflow} SLA · due ${timer.due_time}`
          : `${timer.workflow} SLA`
      }
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${s.cls} ${className ?? ""}`}
    >
      <Icon className="h-3 w-3" />
      {s.label}
      {showCountdown && countdown ? (
        <span className="tabular-nums font-bold">· {countdown}</span>
      ) : null}
    </span>
  );
}
