import { useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  ListChecks,
  Timer,
} from "lucide-react";

import { fetchSlaReport, type SlaReportBreakdownRow } from "../../api/sla";
import { Skeleton } from "../../components/Skeleton";
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

export default function SlaReportsPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data, isLoading } = useQuery({
    queryKey: ["sla-report"],
    queryFn: fetchSlaReport,
    staleTime: 60_000,
    retry: false,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Gauge className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-neutral-900">SLA Reports</p>
          <p className="text-xs text-neutral-500">
            Compliance, breaches and resolution times across every workflow.
          </p>
        </div>
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi icon={ListChecks} accent="bg-slate-50 text-slate-600" label="Total SLAs" value={String(data.total)} />
            <Kpi icon={CheckCircle2} accent="bg-emerald-50 text-emerald-600" label="Completed On Time" value={String(data.completedOnTime)} />
            <Kpi icon={AlertTriangle} accent="bg-rose-50 text-rose-600" label="Breached" value={String(data.breached)} />
            <Kpi icon={Timer} accent="bg-amber-50 text-amber-600" label="Avg Resolution" value={fmtMinutes(data.avgResolutionMinutes)} />
            <Kpi icon={Gauge} accent="bg-primary/10 text-primary" label="Compliance" value={`${data.compliancePct}%`} />
            <Kpi icon={Clock} accent="bg-blue-50 text-blue-600" label="Open (Run/Due)" value={String(data.running + data.dueSoon)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownTable title="By Workflow" rows={data.byWorkflow} />
            <BreakdownTable title="By Department" rows={data.byDepartment} />
            <BreakdownTable title="By Role" rows={data.byRole} />
            <BreakdownTable title="By User" rows={data.byUser} />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  accent,
  label,
  value,
}: {
  icon: typeof Timer;
  accent: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-2 text-2xl font-bold tabular-nums text-neutral-900">{value}</p>
      <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
        {label}
      </p>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: SlaReportBreakdownRow[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-4 py-2.5">
        <h3 className="text-sm font-bold text-neutral-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{title.replace("By ", "")}</th>
              <th className="text-right">Total</th>
              <th className="text-right">On Time</th>
              <th className="text-right">Breached</th>
              <th className="text-right">Avg Res.</th>
              <th className="text-right">Compliance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-neutral-400">
                  No data yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key}>
                  <td className="font-medium text-neutral-700">{r.key}</td>
                  <td className="text-right tabular-nums text-neutral-600">{r.total}</td>
                  <td className="text-right tabular-nums text-emerald-600">{r.onTime}</td>
                  <td className="text-right tabular-nums text-rose-600">{r.breached}</td>
                  <td className="text-right tabular-nums text-neutral-600">
                    {fmtMinutes(r.avgResolutionMinutes)}
                  </td>
                  <td className="text-right tabular-nums font-semibold text-neutral-800">
                    {r.compliancePct}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
