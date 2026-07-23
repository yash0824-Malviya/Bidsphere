import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  ShieldCheck,
  Star,
  Timer,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import PaginationBar from "../../components/PaginationBar";
import ReportChartCard, {
  REPORT_AXIS,
  REPORT_TOOLTIP,
} from "../../components/reports/ReportChartCard";
import ReportKpiGrid from "../../components/reports/ReportKpiGrid";
import ReportPageShell from "../../components/reports/ReportPageShell";
import EmptyState from "../../components/EmptyState";
import { TableSkeleton } from "../../components/Skeleton";
import FilterBar, { FilterField } from "../../components/ui/FilterBar";
import type { SupplierPerformanceData } from "../../api/supplierPerformance";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import { useClientPagination } from "../../hooks/usePagination";
import type { ExportColumn } from "../../utils/export";
import {
  fetchReportPurchaseOrders,
  fetchSupplierPerformanceForPos,
} from "../../utils/reports/operationalReportData";

function performanceScore(row: SupplierPerformanceData): number {
  return Math.round(
    (row.delivery_score + row.quality_score + row.reliability_score) / 3,
  );
}

function onTimePct(row: SupplierPerformanceData): number {
  const total = row.on_time_deliveries + row.late_deliveries;
  if (total <= 0) return 0;
  return Math.round((row.on_time_deliveries / total) * 100);
}

export default function SupplierPerformanceReportPage() {
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["operational-report-supplier-performance"],
    queryFn: async () => {
      const { rows: pos } = await fetchReportPurchaseOrders();
      const rows = await fetchSupplierPerformanceForPos(pos);
      return { rows, fetchedAt: new Date().toISOString() };
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const allRows = query.data?.rows ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) =>
      r.supplier_name.toLowerCase().includes(q),
    );
  }, [allRows, search]);

  const kpis = useMemo(() => {
    if (allRows.length === 0) {
      return [
        { key: "rating", label: "Average Rating", value: "—", icon: Star },
        {
          key: "otd",
          label: "On-Time Delivery",
          value: "—",
          icon: Timer,
        },
        {
          key: "quality",
          label: "Quality Score",
          value: "—",
          icon: ShieldCheck,
        },
        {
          key: "response",
          label: "Response Rate",
          value: "—",
          icon: Users,
        },
        {
          key: "lead",
          label: "Lead Time",
          value: "—",
          icon: Clock,
        },
      ];
    }
    const avgRating =
      allRows.reduce((s, r) => s + performanceScore(r), 0) / allRows.length;
    const avgOtd =
      allRows.reduce((s, r) => s + onTimePct(r), 0) / allRows.length;
    const avgQuality =
      allRows.reduce((s, r) => s + r.quality_score, 0) / allRows.length;
    const avgResponse =
      allRows.reduce((s, r) => s + r.reliability_score, 0) / allRows.length;
    const avgLead =
      allRows.reduce((s, r) => s + (r.avg_delay_days || 0), 0) /
      allRows.length;
    return [
      {
        key: "rating",
        label: "Average Rating",
        value: `${(avgRating / 20).toFixed(1)} / 5`,
        icon: Star,
        tone: { bg: "bg-[#FEF3C7]", fg: "text-[#D97706]" },
      },
      {
        key: "otd",
        label: "On-Time Delivery",
        value: `${Math.round(avgOtd)}%`,
        icon: Timer,
        tone: { bg: "bg-[#DCFCE7]", fg: "text-[#16A34A]" },
      },
      {
        key: "quality",
        label: "Quality Score",
        value: `${Math.round(avgQuality)}%`,
        icon: ShieldCheck,
        tone: { bg: "bg-[#E8F4FF]", fg: "text-[#1993FF]" },
      },
      {
        key: "response",
        label: "Response Rate",
        value: `${Math.round(avgResponse)}%`,
        icon: Users,
        tone: { bg: "bg-[#EDE9FE]", fg: "text-[#7C3AED]" },
      },
      {
        key: "lead",
        label: "Lead Time",
        value: `${Math.round(avgLead)} Days`,
        icon: Clock,
        tone: { bg: "bg-[#E0F2FE]", fg: "text-[#0284C7]" },
      },
    ];
  }, [allRows]);

  const topSuppliers = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => performanceScore(b) - performanceScore(a))
        .slice(0, 8)
        .map((r) => ({
          name: r.supplier_name,
          score: performanceScore(r),
        })),
    [filtered],
  );

  const qualityTrend = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => b.quality_score - a.quality_score)
        .slice(0, 8)
        .map((r) => ({
          name: r.supplier_name,
          quality: Math.round(r.quality_score),
          delivery: Math.round(r.delivery_score),
        })),
    [filtered],
  );

  const responseTrend = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => b.reliability_score - a.reliability_score)
        .slice(0, 8)
        .map((r) => ({
          name: r.supplier_name,
          response: Math.round(r.reliability_score),
        })),
    [filtered],
  );

  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    totalRecords,
    totalPages,
    pageRows,
  } = useClientPagination(filtered, {
    defaultPageSize: 25,
    resetKey: search,
  });

  const exportColumns = useMemo<ExportColumn<SupplierPerformanceData>[]>(
    () => [
      {
        id: "supplier",
        label: "Supplier",
        accessor: (r) => r.supplier_name,
      },
      { id: "orders", label: "Orders", accessor: (r) => r.total_pos },
      {
        id: "completed",
        label: "Completed",
        accessor: (r) => r.completed_pos,
      },
      { id: "late", label: "Late", accessor: (r) => r.late_deliveries },
      {
        id: "rejected",
        label: "Rejected",
        accessor: (r) => Math.round(r.total_rejected_qty || 0),
      },
      {
        id: "rating",
        label: "Rating",
        accessor: (r) => (performanceScore(r) / 20).toFixed(1),
      },
      {
        id: "score",
        label: "Performance Score",
        accessor: (r) => performanceScore(r),
      },
    ],
    [],
  );

  return (
    <ReportPageShell
      title="Supplier Performance Report"
      subtitle="Analyze supplier delivery, quality and response performance."
      lastUpdated={query.data?.fetchedAt}
      loading={query.isFetching}
      onRefresh={() => void query.refetch()}
      exportModule="Supplier Performance Report"
      exportFilename="Supplier_Performance_Report"
      exportColumns={exportColumns}
      exportRows={filtered}
      kpis={
        <ReportKpiGrid
          items={kpis}
          loading={query.isLoading}
          columnsClassName="grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
        />
      }
      filters={
        <FilterBar>
          <div className="flex flex-wrap items-end gap-3">
            <FilterField label="Global Search" className="min-w-[220px]">
              <input
                type="search"
                className="input-field"
                placeholder="Search suppliers…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </FilterField>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSearch("")}
            >
              Reset
            </button>
            <Link
              to="/suppliers?tab=performance"
              className="btn-secondary no-underline"
            >
              Open Supplier Directory
            </Link>
          </div>
        </FilterBar>
      }
      charts={
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <ReportChartCard
            title="Top Suppliers"
            loading={query.isLoading}
            hasData={topSuppliers.length > 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSuppliers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis type="number" domain={[0, 100]} {...REPORT_AXIS} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  {...REPORT_AXIS}
                />
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Bar dataKey="score" fill="#1993FF" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </ReportChartCard>
          <ReportChartCard
            title="Quality Trend"
            loading={query.isLoading}
            hasData={qualityTrend.length > 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={qualityTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" {...REPORT_AXIS} hide />
                <YAxis domain={[0, 100]} {...REPORT_AXIS} />
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Line
                  type="monotone"
                  dataKey="quality"
                  stroke="#16A34A"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="delivery"
                  stroke="#1993FF"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </ReportChartCard>
          <ReportChartCard
            title="Response Trend"
            loading={query.isLoading}
            hasData={responseTrend.length > 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={responseTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" {...REPORT_AXIS} hide />
                <YAxis domain={[0, 100]} {...REPORT_AXIS} />
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Bar dataKey="response" fill="#7C3AED" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </ReportChartCard>
        </div>
      }
    >
      <section className="overflow-hidden rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="overflow-x-auto">
          {query.isLoading ? (
            <div className="p-4">
              <TableSkeleton rows={8} columns={7} />
            </div>
          ) : pageRows.length === 0 ? (
            <EmptyState
              title="No supplier performance data"
              description="Performance metrics appear after purchase order and GRN activity."
            />
          ) : (
            <table className="w-full min-w-[860px] text-left">
              <thead className="bg-[#F8FAFC]">
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  <th className="px-4 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5">Orders</th>
                  <th className="px-3 py-2.5">Completed</th>
                  <th className="px-3 py-2.5">Late</th>
                  <th className="px-3 py-2.5">Rejected</th>
                  <th className="px-3 py-2.5">Rating</th>
                  <th className="px-4 py-2.5">Performance Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {pageRows.map((row) => {
                  const score = performanceScore(row);
                  return (
                    <tr
                      key={row.supplier_name}
                      className="text-[12px] hover:bg-[#F8FAFC]/80"
                    >
                      <td className="px-4 py-3 font-semibold text-[#111827]">
                        <Link
                          to={`/suppliers/${encodeURIComponent(row.supplier_name)}`}
                          className="text-primary-700 hover:underline"
                        >
                          {row.supplier_name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 tabular-nums">{row.total_pos}</td>
                      <td className="px-3 py-3 tabular-nums">
                        {row.completed_pos}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-red-600">
                        {row.late_deliveries}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {Math.round(row.total_rejected_qty || 0)}
                      </td>
                      <td className="px-3 py-3 tabular-nums font-semibold">
                        {(score / 20).toFixed(1)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-100">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(100, score)}%` }}
                            />
                          </div>
                          <span className="tabular-nums font-semibold text-neutral-700">
                            {score}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-[#F1F5F9] px-3 py-2">
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            recordLabel="suppliers"
          />
        </div>
      </section>
    </ReportPageShell>
  );
}
