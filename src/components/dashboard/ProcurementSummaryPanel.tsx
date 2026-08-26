import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, FilePlus2 } from "lucide-react";
import { fetchProcurementSummary } from "../../api/dashboard";
import { Skeleton } from "../Skeleton";
import { formatCurrencyCompactIn } from "../../utils/format";

export default function ProcurementSummaryPanel() {
  const summaryQuery = useQuery({
    queryKey: ["dashboard-procurement-summary"],
    queryFn: fetchProcurementSummary,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (summaryQuery.isLoading || !summaryQuery.data) {
    return <Skeleton className="h-[240px] w-full rounded-lg" />;
  }

  const summary = summaryQuery.data;

  if (!summary.hasActivity) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white p-6 px-4 text-center shadow-sm">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-600">
          <BarChart3 className="h-5 w-5" />
        </span>
        <p className="text-sm font-semibold text-neutral-800">Procurement Analytics</p>
        <p className="max-w-xs text-xs text-neutral-500">
          No purchasing transactions have been completed yet. Analytics will
          automatically appear after RFQs, Purchase Orders or Purchase Invoices
          are processed.
        </p>
        <Link
          to="/sourcing/rfq/new"
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white no-underline shadow-sm hover:bg-primary-700"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          Create RFQ
        </Link>
      </div>
    );
  }

  const c = summary.currency;
  const funnelData = [
    { name: "Open", value: summary.funnel.open, color: "#1F3A6D" },
    { name: "Under Review", value: summary.funnel.underReview, color: "#f59e0b" },
    { name: "Approved", value: summary.funnel.approved, color: "#6366f1" },
    { name: "Completed", value: summary.funnel.completed, color: "#10b981" },
  ];

  return (
    <div className="dashboard-panel p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <BarChart3 className="h-4 w-4 text-primary-600" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Procurement Summary
        </h3>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-stretch w-full">
        <div className="flex-1 grid grid-cols-3 gap-2">
          <SummaryKpi label="Total RFQs" value={String(summary.totalRfqs)} />
          <SummaryKpi label="Quotations" value={String(summary.totalQuotations)} />
          <SummaryKpi label="Active Suppliers" value={String(summary.activeSuppliers)} />
          <SummaryKpi label="Purchase Orders" value={String(summary.totalPos)} />
          <SummaryKpi label="Pending RFQs" value={String(summary.pendingRfqs)} />
          <SummaryKpi label="Completed RFQs" value={String(summary.completedRfqs)} />
          <SummaryKpi
            label="Avg RFQ Value"
            value={formatCurrencyCompactIn(summary.avgRfqValue, c)}
          />
          <SummaryKpi
            label="Highest RFQ"
            value={formatCurrencyCompactIn(summary.maxRfqValue, c)}
          />
          <SummaryKpi
            label="Lowest RFQ"
            value={formatCurrencyCompactIn(summary.minRfqValue, c)}
          />
        </div>

        <div className="w-full md:w-[320px] lg:w-[400px] h-[160px] border-l border-neutral-100 pl-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip
                cursor={{ fill: "#f8fafc" }}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="value" name="RFQs" radius={[4, 4, 0, 0]} maxBarSize={44}>
                {funnelData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function SummaryKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2 border border-neutral-100/60">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-bold tabular-nums text-neutral-900" title={value}>
        {value}
      </p>
    </div>
  );
}
