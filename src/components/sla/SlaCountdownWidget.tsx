import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Timer } from "lucide-react";

import { computeSla, listTimersForRole, type SlaTimer } from "../../api/sla";
import { useSlaNow } from "../../hooks/useSlaTicker";
import SlaBadge from "./SlaBadge";

interface Props {
  role: string;
  title?: string;
  /** Max rows to list. Default 6. */
  limit?: number;
}

function routeFor(t: SlaTimer): string {
  const enc = encodeURIComponent(t.reference_name);
  switch (t.reference_doctype) {
    case "Material Request":
      return `/material-requests/${enc}`;
    case "Reverse Bidding":
      return `/sourcing/reverse-bidding/${enc}`;
    default:
      return "/admin/sla-reports";
  }
}

/**
 * Per-role SLA countdown panel for dashboards: On Track / Due Soon / Overdue
 * tallies plus the most urgent items with live countdowns. Pulls only the
 * signed-in role's open timers from the backend.
 */
export default function SlaCountdownWidget({ role, title = "SLA Countdown", limit = 6 }: Props) {
  const now = useSlaNow();
  const { data, isLoading } = useQuery({
    queryKey: ["sla-timers-role", role],
    queryFn: () => listTimersForRole(role),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const { rows, onTrack, dueSoon, breached } = useMemo(() => {
    const timers = data ?? [];
    const withComputed = timers.map((t) => ({ t, c: computeSla(t, now) }));
    // Most urgent first: breached, then least remaining.
    withComputed.sort((a, b) => {
      const rank = (p: string) => (p === "breached" ? 0 : p === "due_soon" ? 1 : 2);
      const r = rank(a.c.phase) - rank(b.c.phase);
      if (r !== 0) return r;
      return a.c.remainingMs - b.c.remainingMs;
    });
    return {
      rows: withComputed.slice(0, limit),
      onTrack: withComputed.filter((x) => x.c.phase === "on_track").length,
      dueSoon: withComputed.filter((x) => x.c.phase === "due_soon").length,
      breached: withComputed.filter((x) => x.c.phase === "breached").length,
    };
  }, [data, now, limit]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Timer className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-bold text-neutral-800">{title}</h3>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
            {onTrack} On Track
          </span>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
            {dueSoon} Due Soon
          </span>
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
            {breached} Overdue
          </span>
        </div>
      </div>

      {isLoading ? (
        <p className="py-4 text-center text-sm text-neutral-400">Loading SLAs…</p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-neutral-400">
          No active SLA timers.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map(({ t }) => (
            <li key={t.name} className="flex items-center justify-between gap-3 py-2">
              <Link
                to={routeFor(t)}
                className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-700 hover:text-primary"
              >
                <span className="truncate">{t.reference_name}</span>
                <span className="ml-2 text-[11px] text-neutral-400">{t.workflow}</span>
              </Link>
              <SlaBadge timer={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
