import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Truck } from "lucide-react";
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
import { format, parseISO } from "date-fns";

import PaginationBar from "../../components/PaginationBar";
import ReportChartCard, {
  REPORT_AXIS,
  REPORT_TOOLTIP,
} from "../../components/reports/ReportChartCard";
import ReportKpiGrid from "../../components/reports/ReportKpiGrid";
import ReportPageShell from "../../components/reports/ReportPageShell";
import EmptyState from "../../components/EmptyState";
import { TableSkeleton } from "../../components/Skeleton";
import { StatusBadge } from "../../components/ui";
import FilterBar, { FilterField } from "../../components/ui/FilterBar";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import { useClientPagination } from "../../hooks/usePagination";
import type { ExportColumn } from "../../utils/export";
import { formatDate } from "../../utils/format";
import {
  buildPoTrend,
  daysBetween,
  fetchReportPurchaseOrders,
  isCompletedPoStatus,
  isOpenPoStatus,
  type ReportPo,
} from "../../utils/reports/operationalReportData";
import { deriveScheduleDisplayStatus } from "../../utils/deliveryScheduleStatus";

function deliveryShipmentLabel(po: ReportPo): string {
  // Report rows have PO/GRN receipt signals only — never invent "In Transit".
  return deriveScheduleDisplayStatus({
    perReceived: Number(po.per_received) || 0,
    poStatus: po.status,
    poScheduleDate: po.schedule_date,
    grnCompleted: isCompletedPoStatus(po.status),
  });
}

function isDelayed(po: ReportPo): boolean {
  if (!po.schedule_date || isCompletedPoStatus(po.status)) return false;
  const today = format(new Date(), "yyyy-MM-dd");
  return po.schedule_date.slice(0, 10) < today && isOpenPoStatus(po.status);
}

function isDueToday(po: ReportPo): boolean {
  if (!po.schedule_date) return false;
  const today = format(new Date(), "yyyy-MM-dd");
  return po.schedule_date.slice(0, 10) === today;
}

function delayDays(po: ReportPo): number {
  if (!po.schedule_date || !isDelayed(po)) return 0;
  return daysBetween(po.schedule_date);
}

export default function DeliveryReportPage() {
  const [supplier, setSupplier] = useState("");
  const [onlyDelayed, setOnlyDelayed] = useState(false);

  const query = useQuery({
    queryKey: ["operational-report-deliveries"],
    queryFn: async () => {
      const { rows } = await fetchReportPurchaseOrders();
      const deliveries = rows.filter(
        (p) => isOpenPoStatus(p.status) || isCompletedPoStatus(p.status),
      );
      return { rows: deliveries, fetchedAt: new Date().toISOString() };
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const allRows = query.data?.rows ?? [];
  const filtered = useMemo(() => {
    return allRows.filter((po) => {
      if (supplier) {
        const s = po.supplier_name || po.supplier || "";
        if (s !== supplier) return false;
      }
      if (onlyDelayed && !isDelayed(po)) return false;
      return true;
    });
  }, [allRows, supplier, onlyDelayed]);

  const kpis = useMemo(() => {
    const today = allRows.filter(isDueToday).length;
    const delayed = allRows.filter(isDelayed).length;
    const completed = allRows.filter((p) =>
      isCompletedPoStatus(p.status),
    ).length;
    const completedWithDates = allRows.filter(
      (p) =>
        isCompletedPoStatus(p.status) &&
        p.schedule_date &&
        (p.modified || p.transaction_date),
    );
    const avgDays =
      completedWithDates.length > 0
        ? Math.round(
            completedWithDates.reduce((s, p) => {
              try {
                const start = parseISO(
                  (p.transaction_date || "").slice(0, 10),
                ).getTime();
                const end = parseISO(
                  (p.modified || p.schedule_date || "").slice(0, 10),
                ).getTime();
                if (Number.isNaN(start) || Number.isNaN(end)) return s;
                return s + Math.max(0, (end - start) / 86_400_000);
              } catch {
                return s;
              }
            }, 0) / completedWithDates.length,
          )
        : 0;
    return [
      {
        key: "today",
        label: "Deliveries Today",
        value: String(today),
        icon: Truck,
      },
      {
        key: "delayed",
        label: "Delayed Deliveries",
        value: String(delayed),
        icon: AlertTriangle,
        tone: { bg: "bg-[#FEE2E2]", fg: "text-[#DC2626]" },
      },
      {
        key: "completed",
        label: "Completed Deliveries",
        value: String(completed),
        icon: CheckCircle2,
        tone: { bg: "bg-[#DCFCE7]", fg: "text-[#16A34A]" },
      },
      {
        key: "avg",
        label: "Average Delivery Time",
        value: `${avgDays} Days`,
        icon: Clock,
        tone: { bg: "bg-[#E0F2FE]", fg: "text-[#0284C7]" },
      },
    ];
  }, [allRows]);

  const trend = useMemo(() => buildPoTrend(filtered), [filtered]);
  const lateBySupplier = useMemo(() => {
    const map = new Map<string, number>();
    for (const po of filtered.filter(isDelayed)) {
      const name = po.supplier_name || po.supplier || "Unknown";
      map.set(name, (map.get(name) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filtered]);

  const supplierPerf = useMemo(() => {
    const map = new Map<string, { onTime: number; late: number }>();
    for (const po of filtered) {
      const name = po.supplier_name || po.supplier || "Unknown";
      const cur = map.get(name) || { onTime: 0, late: 0 };
      if (isDelayed(po)) cur.late += 1;
      else if (isCompletedPoStatus(po.status) || isOpenPoStatus(po.status)) {
        cur.onTime += 1;
      }
      map.set(name, cur);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name,
        onTime: v.onTime,
        late: v.late,
      }))
      .sort((a, b) => b.onTime + b.late - (a.onTime + a.late))
      .slice(0, 8);
  }, [filtered]);

  const suppliers = useMemo(
    () =>
      Array.from(
        new Set(
          allRows.map((r) => r.supplier_name || r.supplier).filter(Boolean),
        ),
      ).sort(),
    [allRows],
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
    resetKey: `${supplier}|${onlyDelayed}`,
  });

  const exportColumns = useMemo<ExportColumn<ReportPo>[]>(
    () => [
      { id: "name", label: "PO", accessor: (r) => r.name },
      {
        id: "supplier",
        label: "Supplier",
        accessor: (r) => r.supplier_name || r.supplier || "",
      },
      {
        id: "shipment",
        label: "Shipment",
        accessor: (r) => r.status || "",
      },
      {
        id: "eta",
        label: "ETA",
        accessor: (r) => r.schedule_date || "",
      },
      {
        id: "delay",
        label: "Delay (days)",
        accessor: (r) => delayDays(r),
      },
      { id: "status", label: "Status", accessor: (r) => r.status || "" },
    ],
    [],
  );

  return (
    <ReportPageShell
      title="Delivery Report"
      subtitle="Monitor supplier deliveries and expected arrival dates."
      lastUpdated={query.data?.fetchedAt}
      loading={query.isFetching}
      onRefresh={() => void query.refetch()}
      exportModule="Delivery Report"
      exportFilename="Delivery_Report"
      exportColumns={exportColumns}
      exportRows={filtered}
      kpis={
        <ReportKpiGrid
          items={kpis}
          loading={query.isLoading}
          columnsClassName="grid-cols-2 md:grid-cols-4"
        />
      }
      filters={
        <FilterBar>
          <div className="flex flex-wrap items-end gap-3">
            <FilterField label="Supplier">
              <select
                className="select-field"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              >
                <option value="">All</option>
                {suppliers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FilterField>
            <label className="flex items-center gap-2 pb-2 text-[12px] text-neutral-700">
              <input
                type="checkbox"
                checked={onlyDelayed}
                onChange={(e) => setOnlyDelayed(e.target.checked)}
                className="rounded border-neutral-300"
              />
              Delayed only
            </label>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSupplier("");
                setOnlyDelayed(false);
              }}
            >
              Reset
            </button>
          </div>
        </FilterBar>
      }
      charts={
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <ReportChartCard
            title="Delivery Trend"
            loading={query.isLoading}
            hasData={trend.some((t) => t.count > 0)}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" {...REPORT_AXIS} />
                <YAxis {...REPORT_AXIS} allowDecimals={false} />
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#0284C7"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ReportChartCard>
          <ReportChartCard
            title="Late Deliveries"
            loading={query.isLoading}
            hasData={lateBySupplier.length > 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lateBySupplier}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" {...REPORT_AXIS} />
                <YAxis {...REPORT_AXIS} allowDecimals={false} />
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Bar dataKey="value" fill="#DC2626" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </ReportChartCard>
          <ReportChartCard
            title="Supplier Delivery Performance"
            loading={query.isLoading}
            hasData={supplierPerf.length > 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={supplierPerf}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" {...REPORT_AXIS} />
                <YAxis {...REPORT_AXIS} allowDecimals={false} />
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Bar dataKey="onTime" stackId="a" fill="#16A34A" name="On time" />
                <Bar dataKey="late" stackId="a" fill="#DC2626" name="Late" />
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
              title="No Active Deliveries"
              description="Everything is on schedule for the selected filters."
            />
          ) : (
            <table className="w-full min-w-[860px] text-left">
              <thead className="bg-[#F8FAFC]">
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  <th className="px-4 py-2.5">PO</th>
                  <th className="px-3 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5">Shipment</th>
                  <th className="px-3 py-2.5">ETA</th>
                  <th className="px-3 py-2.5">Actual Delivery</th>
                  <th className="px-3 py-2.5">Delay</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {pageRows.map((po) => {
                  const delayed = isDelayed(po);
                  return (
                    <tr
                      key={po.name}
                      className={`text-[12px] ${delayed ? "bg-orange-50/40" : "hover:bg-[#F8FAFC]/80"}`}
                    >
                      <td className="px-4 py-3 font-semibold text-primary-700">
                        <Link
                          to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                          className="hover:underline"
                        >
                          {po.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        {po.supplier_name || po.supplier || "—"}
                      </td>
                      <td className="px-3 py-3 text-neutral-600">
                        {deliveryShipmentLabel(po)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-neutral-500">
                        {po.schedule_date
                          ? formatDate(po.schedule_date, "MMM d, yyyy")
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-neutral-500">
                        {isCompletedPoStatus(po.status) && po.modified
                          ? formatDate(po.modified, "MMM d, yyyy")
                          : "—"}
                      </td>
                      <td className="px-3 py-3">
                        {delayed ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">
                            {delayDays(po)} Days
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {po.status ? (
                          <StatusBadge status={po.status} size="sm" />
                        ) : (
                          "—"
                        )}
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
            recordLabel="deliveries"
          />
        </div>
      </section>
    </ReportPageShell>
  );
}
