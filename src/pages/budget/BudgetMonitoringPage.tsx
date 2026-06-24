import { useLayoutEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  Search,
} from "lucide-react";

import { getDeptMonitoring } from "../../api/budget";
import type { DeptMonitorRow } from "../../api/budget";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatCurrency } from "../../utils/format";

const fmt = (n: number) => formatCurrency(n);

export default function BudgetMonitoringPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: rows = [], isLoading } = useQuery<DeptMonitorRow[]>({
    queryKey: ["budget-monitoring"],
    queryFn: getDeptMonitoring,
    staleTime: 30_000,
  });

  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.department.toLowerCase().includes(q));
  }, [rows, search]);

  const totalAllocated = rows.reduce((s, r) => s + r.allocated, 0);
  const totalConsumed = rows.reduce((s, r) => s + r.consumed, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);
  const avgUtilization =
    totalAllocated > 0 ? Math.round((totalConsumed / totalAllocated) * 100) : 0;

  function exportCSV() {
    const header = "Department,Allocated,Consumed,Remaining,Utilization %,Status";
    const csvRows = filtered.map((r) =>
      [r.department, r.allocated, r.consumed, r.remaining, r.utilizationPct, r.status].join(",")
    );
    const blob = new Blob([[header, ...csvRows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-monitoring-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="-mt-1">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
            <BarChart3 className="h-4 w-4 text-violet-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-neutral-900">Budget Monitoring</h1>
            <p className="text-[10px] text-neutral-500">Department utilization from live RFQ + PO consumption</p>
          </div>
        </div>
        <button
          type="button"
          onClick={exportCSV}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
        >
          <Download className="h-3 w-3" /> Export CSV
        </button>
      </div>

      {isLoading ? (
        <Skeleton className="mb-3 h-16 rounded-lg" />
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <SummaryCard label="Total Allocated" value={fmt(totalAllocated)} />
          <SummaryCard label="Consumed Budget" value={fmt(totalConsumed)} />
          <SummaryCard label="Remaining Budget" value={fmt(totalRemaining)} />
          <SummaryCard label="Avg Utilization" value={`${avgUtilization}%`} />
        </div>
      )}

      {/* Search + table — rest unchanged from original */}
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search departments…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-neutral-200 py-1.5 pl-8 pr-3 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="border-b border-neutral-100 bg-neutral-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-neutral-500">Department</th>
              <th className="px-3 py-2 text-right font-semibold text-neutral-500">Allocated</th>
              <th className="px-3 py-2 text-right font-semibold text-neutral-500">Consumed</th>
              <th className="px-3 py-2 text-right font-semibold text-neutral-500">Remaining</th>
              <th className="px-3 py-2 text-right font-semibold text-neutral-500">Utilization</th>
              <th className="px-3 py-2 text-left font-semibold text-neutral-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-neutral-400">Loading…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-neutral-400">No departments found</td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.department} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/50">
                  <td className="px-3 py-2 font-medium text-neutral-900">{row.department}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(row.allocated)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(row.consumed)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(row.remaining)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.utilizationPct}%</td>
                  <td className="px-3 py-2">
                    <StatusPill status={row.status} />
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="text-sm font-bold tabular-nums text-neutral-900">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: DeptMonitorRow["status"] }) {
  const cls =
    status === "Exceeded"
      ? "bg-red-50 text-red-700"
      : status === "Warning"
      ? "bg-amber-50 text-amber-700"
      : "bg-emerald-50 text-emerald-700";
  const Icon =
    status === "Exceeded" ? AlertTriangle : status === "Warning" ? AlertTriangle : CheckCircle2;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      <Icon className="h-3 w-3" /> {status}
    </span>
  );
}
