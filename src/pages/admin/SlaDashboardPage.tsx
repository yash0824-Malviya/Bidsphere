import { useLayoutEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Gauge,
  ListChecks,
  Timer,
  TrendingUp,
} from "lucide-react";

import { computeSla, fetchSlaReport, listAllOpenTimers } from "../../api/sla";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";
import SlaBadge from "../../components/sla/SlaBadge";
import { Skeleton } from "../../components/Skeleton";
import { useSlaNow } from "../../hooks/useSlaTicker";
import { useOptionalLayout } from "../../contexts/LayoutContext";

function fmtMinutes(min: number): string {
  if (!(min > 0)) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export default function SlaDashboardPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const now = useSlaNow();

  const reportQ = useQuery({
    queryKey: ["sla-dashboard-report"],
    queryFn: fetchSlaReport,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const openQ = useQuery({
    queryKey: ["sla-dashboard-open"],
    queryFn: listAllOpenTimers,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const report = reportQ.data;

  const upcoming = useMemo(() => {
    const rows = (openQ.data ?? [])
      .map((t) => ({ t, c: computeSla(t, now) }))
      .filter((x) => x.c.phase === "breached" || x.c.phase === "due_soon" || x.c.phase === "on_track")
      .sort((a, b) => {
        const rank = (p: string) => (p === "breached" ? 0 : p === "due_soon" ? 1 : 2);
        const r = rank(a.c.phase) - rank(b.c.phase);
        if (r !== 0) return r;
        return a.c.remainingMs - b.c.remainingMs;
      });
    return rows.slice(0, 12);
  }, [openQ.data, now]);

  const routeFor = (doctype: string, ref: string): string => {
    const enc = encodeURIComponent(ref);
    switch (doctype) {
      case "Material Request":
        return `/material-requests/${enc}`;
      case "Reverse Bidding":
        return `/sourcing/reverse-bidding/${enc}`;
      case "Purchase Order":
        return `/p2p/purchase-orders/${enc}`;
      default:
        return "/admin/sla-reports";
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Timer className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-neutral-900">SLA Dashboard</p>
            <p className="text-xs text-neutral-500">
              Live status across every workflow — counts refresh automatically.
            </p>
          </div>
        </div>
        <Link to="/admin/sla-reports" className="btn-secondary">
          <Gauge className="h-4 w-4" />
          Open Reports
        </Link>
      </div>

      {reportQ.isLoading || !report ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <DashboardKpiGrid columns={6}>
            <DashboardKpiCard icon={Clock} iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]" label="Running" value={report.running} />
            <DashboardKpiCard icon={AlertTriangle} iconClassName="bg-amber-50 text-amber-600" label="Warning" value={report.dueSoon} />
            <DashboardKpiCard icon={AlertTriangle} iconClassName="bg-rose-50 text-rose-600" label="Breached" value={report.breached} />
            <DashboardKpiCard icon={CheckCircle2} iconClassName="bg-emerald-50 text-emerald-600" label="Completed" value={report.completed} />
            <DashboardKpiCard icon={CalendarClock} iconClassName="bg-rose-50 text-rose-600" label="Today's Breaches" value={report.todaysBreaches} />
            <DashboardKpiCard icon={TrendingUp} iconClassName="bg-amber-50 text-amber-600" label="Upcoming Breaches" value={report.upcomingBreaches} />
            <DashboardKpiCard icon={Timer} iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]" label="Avg Completion" value={fmtMinutes(report.avgResolutionMinutes)} />
          </DashboardKpiGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
                <h3 className="text-sm font-bold text-neutral-800">
                  Open SLAs — most urgent
                </h3>
                <span className="text-[11px] text-neutral-400">
                  {openQ.data?.length ?? 0} open
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Workflow</th>
                      <th>Role</th>
                      <th>Due</th>
                      <th className="text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-sm text-neutral-400">
                          No open SLA timers.
                        </td>
                      </tr>
                    ) : (
                      upcoming.map(({ t }) => (
                        <tr key={t.name}>
                          <td className="font-medium text-neutral-800">
                            <Link
                              to={routeFor(t.reference_doctype, t.reference_name)}
                              className="hover:text-primary"
                            >
                              {t.reference_name}
                            </Link>
                          </td>
                          <td className="text-neutral-600">{t.workflow}</td>
                          <td className="text-neutral-600">{t.role || "—"}</td>
                          <td className="text-neutral-500">{t.due_time ?? "—"}</td>
                          <td className="text-right">
                            <SlaBadge timer={t} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2.5">
                <ListChecks className="h-4 w-4 text-neutral-400" />
                <h3 className="text-sm font-bold text-neutral-800">By Workflow</h3>
              </div>
              <ul className="divide-y divide-neutral-100">
                {report.byWorkflow.length === 0 ? (
                  <li className="px-4 py-6 text-center text-sm text-neutral-400">
                    No SLA data yet.
                  </li>
                ) : (
                  report.byWorkflow.map((r) => (
                    <li key={r.key} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="truncate text-neutral-700">{r.key}</span>
                      <span className="flex items-center gap-2 tabular-nums">
                        <span className="text-neutral-500">{r.total}</span>
                        {r.breached > 0 ? (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                            {r.breached} breached
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            {r.compliancePct}%
                          </span>
                        )}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

