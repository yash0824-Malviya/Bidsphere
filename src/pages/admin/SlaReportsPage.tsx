import { useLayoutEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  ListChecks,
  Timer,
} from "lucide-react";

import {
  deriveTimerStatus,
  listAllTimers,
  parseSlaTime,
  summarizeTimers,
  type SlaReportBreakdownRow,
} from "../../api/sla";
import { SLA_PRIORITIES, SLA_WORKFLOWS } from "../../config/slaWorkflows";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";

const STATUS_OPTIONS = ["Running", "Due Soon", "Breached", "Completed", "Cancelled"] as const;

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
    queryKey: ["sla-report-timers"],
    queryFn: listAllTimers,
    staleTime: 60_000,
    retry: false,
  });

  const [workflow, setWorkflow] = useState("");
  const [role, setRole] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((t) => t.role && set.add(t.role));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const from = fromDate ? new Date(fromDate).getTime() : null;
    const to = toDate ? new Date(toDate).getTime() + 86_400_000 : null;
    return rows.filter((t) => {
      if (workflow && String(t.workflow) !== workflow) return false;
      if (role && (t.role ?? "") !== role) return false;
      if (priority && (t.priority ?? "") !== priority) return false;
      if (status && deriveTimerStatus(t) !== status) return false;
      if (from != null || to != null) {
        const started = parseSlaTime(t.start_time);
        if (started == null) return false;
        if (from != null && started < from) return false;
        if (to != null && started > to) return false;
      }
      return true;
    });
  }, [data, workflow, role, priority, status, fromDate, toDate]);

  const report = useMemo(() => summarizeTimers(filtered), [filtered]);

  const resetFilters = () => {
    setWorkflow("");
    setRole("");
    setPriority("");
    setStatus("");
    setFromDate("");
    setToDate("");
  };

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

      <div className="grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
        <FilterSelect label="Workflow" value={workflow} onChange={setWorkflow}>
          <option value="">All</option>
          {SLA_WORKFLOWS.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Role" value={role} onChange={setRole}>
          <option value="">All</option>
          {roleOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Priority" value={priority} onChange={setPriority}>
          <option value="">All</option>
          {SLA_PRIORITIES.filter((p) => p !== "All").map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Status" value={status} onChange={setStatus}>
          <option value="">All</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </FilterSelect>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">From</span>
          <input
            type="date"
            className="input-field"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">To</span>
          <input
            type="date"
            className="input-field"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <div className="flex items-end">
          <button type="button" className="btn-secondary" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <DashboardKpiGrid columns={6}>
            <DashboardKpiCard icon={ListChecks} iconClassName="bg-slate-50 text-slate-600" label="Total SLAs" value={String(report.total)} />
            <DashboardKpiCard icon={CheckCircle2} iconClassName="bg-emerald-50 text-emerald-600" label="Completed On Time" value={String(report.completedOnTime)} />
            <DashboardKpiCard icon={AlertTriangle} iconClassName="bg-rose-50 text-rose-600" label="Breached" value={String(report.breached)} />
            <DashboardKpiCard icon={Timer} iconClassName="bg-amber-50 text-amber-600" label="Avg Resolution" value={fmtMinutes(report.avgResolutionMinutes)} />
            <DashboardKpiCard icon={Gauge} iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]" label="Compliance" value={`${report.compliancePct}%`} />
            <DashboardKpiCard icon={Clock} iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]" label="Open (Run/Due)" value={String(report.running + report.dueSoon)} />
          </DashboardKpiGrid>

          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownTable title="By Workflow" rows={report.byWorkflow} />
            <BreakdownTable title="By Role" rows={report.byRole} />
            <BreakdownTable title="By Priority" rows={report.byPriority} />
            <BreakdownTable title="By Status" rows={report.byStatus} />
          </div>
        </>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium text-neutral-600">{label}</span>
      <select
        className="select-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
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
