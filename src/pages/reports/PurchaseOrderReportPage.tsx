import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  ShoppingCart,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
import SupplierDistributionChart, {
  buildTopSupplierChartData,
} from "../../components/reports/SupplierDistributionChart";
import ReportKpiGrid from "../../components/reports/ReportKpiGrid";
import ReportPageShell from "../../components/reports/ReportPageShell";
import EmptyState from "../../components/EmptyState";
import { TableSkeleton } from "../../components/Skeleton";
import { StatusBadge } from "../../components/ui";
import FilterBar, { FilterField } from "../../components/ui/FilterBar";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import { useClientPagination } from "../../hooks/usePagination";
import type { ExportColumn } from "../../utils/export";
import { formatCurrency, formatDate } from "../../utils/format";
import {
  buildPoTrend,
  fetchReportPurchaseOrders,
  isCancelledPoStatus,
  isCompletedPoStatus,
  isOpenPoStatus,
  reportPoHasField,
  statusDistribution,
  supplierDistribution,
  type ReportPo,
} from "../../utils/reports/operationalReportData";

const PIE_COLORS = [
  "#1993FF",
  "#16A34A",
  "#D97706",
  "#7C3AED",
  "#EA580C",
  "#64748B",
];

interface Filters {
  dateFrom: string;
  dateTo: string;
  supplier: string;
  department: string;
  buyer: string;
  status: string;
  costCenter: string;
  poNumber: string;
}

const EMPTY_FILTERS: Filters = {
  dateFrom: "",
  dateTo: "",
  supplier: "",
  department: "",
  buyer: "",
  status: "",
  costCenter: "",
  poNumber: "",
};

export default function PurchaseOrderReportPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);

  const query = useQuery({
    // v3 busts prior empty/error caches from silent-empty fetch.
    queryKey: ["operational-report-purchase-orders", "v3"],
    queryFn: async () => {
      const result = await fetchReportPurchaseOrders();
      return {
        rows: result.rows,
        availableFields: result.availableFields,
        removedFields: result.removedFields,
        fetchedAt: new Date().toISOString(),
      };
    },
    ...DASHBOARD_QUERY_OPTIONS,
    // Always revalidate this report — never serve a stale empty dashboard.
    staleTime: 30_000,
    refetchOnMount: "always",
    retry: false,
  });

  const allRows = query.data?.rows ?? [];
  const availableFields = query.data?.availableFields ?? [];
  const showDepartment = reportPoHasField(availableFields, "department");
  const showCostCenter = reportPoHasField(availableFields, "cost_center");
  const showBuyer = reportPoHasField(availableFields, "owner");

  const filterOptions = useMemo(() => {
    const suppliers = Array.from(
      new Set(allRows.map((r) => r.supplier_name || r.supplier).filter(Boolean)),
    ).sort();
    const departments = showDepartment
      ? Array.from(
          new Set(
            allRows.map((r) => r.department).filter(Boolean) as string[],
          ),
        ).sort()
      : [];
    const buyers = showBuyer
      ? Array.from(
          new Set(allRows.map((r) => r.owner).filter(Boolean) as string[]),
        ).sort()
      : [];
    const statuses = Array.from(
      new Set(allRows.map((r) => r.status || "Draft")),
    ).sort();
    const costCenters = showCostCenter
      ? Array.from(
          new Set(
            allRows.map((r) => r.cost_center).filter(Boolean) as string[],
          ),
        ).sort()
      : [];
    return { suppliers, departments, buyers, statuses, costCenters };
  }, [allRows, showBuyer, showCostCenter, showDepartment]);

  const filtered = useMemo(() => {
    // Default filters are empty ("All") — date/supplier/status are optional.
    return allRows.filter((po) => {
      const date = (po.transaction_date || po.creation || "").slice(0, 10);
      // Date filters only apply when set AND the row has a comparable date.
      if (applied.dateFrom) {
        if (!date || date < applied.dateFrom) return false;
      }
      if (applied.dateTo) {
        if (!date || date > applied.dateTo) return false;
      }
      if (applied.supplier) {
        const s = po.supplier_name || po.supplier || "";
        if (s !== applied.supplier) return false;
      }
      if (
        showDepartment &&
        applied.department &&
        (po.department || "") !== applied.department
      ) {
        return false;
      }
      if (
        showBuyer &&
        applied.buyer &&
        (po.owner || "") !== applied.buyer
      ) {
        return false;
      }
      if (applied.status && (po.status || "Draft") !== applied.status) {
        return false;
      }
      if (
        showCostCenter &&
        applied.costCenter &&
        (po.cost_center || "") !== applied.costCenter
      ) {
        return false;
      }
      if (
        applied.poNumber &&
        !po.name.toLowerCase().includes(applied.poNumber.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [allRows, applied, showBuyer, showCostCenter, showDepartment]);

  const kpis = useMemo(() => {
    const total = filtered.length;
    const open = filtered.filter((p) => isOpenPoStatus(p.status)).length;
    const completed = filtered.filter((p) =>
      isCompletedPoStatus(p.status),
    ).length;
    const cancelled = filtered.filter((p) =>
      isCancelledPoStatus(p.status),
    ).length;
    const value = filtered.reduce(
      (s, p) => s + (Number(p.grand_total) || 0),
      0,
    );
    const avg = total > 0 ? value / total : 0;
    return [
      {
        key: "total",
        label: "Total Purchase Orders",
        value: total.toLocaleString(),
        icon: ShoppingCart,
      },
      {
        key: "open",
        label: "Open Purchase Orders",
        value: open.toLocaleString(),
        icon: FileText,
        tone: { bg: "bg-[#FEF3C7]", fg: "text-[#D97706]" },
      },
      {
        key: "completed",
        label: "Completed Purchase Orders",
        value: completed.toLocaleString(),
        icon: CheckCircle2,
        tone: { bg: "bg-[#DCFCE7]", fg: "text-[#16A34A]" },
      },
      {
        key: "cancelled",
        label: "Cancelled Purchase Orders",
        value: cancelled.toLocaleString(),
        icon: Ban,
        tone: { bg: "bg-[#FEE2E2]", fg: "text-[#DC2626]" },
      },
      {
        key: "value",
        label: "Total Purchase Value",
        value: formatCurrency(value),
        icon: CircleDollarSign,
      },
      {
        key: "avg",
        label: "Average PO Value",
        value: formatCurrency(avg),
        icon: CircleDollarSign,
        tone: { bg: "bg-[#EDE9FE]", fg: "text-[#7C3AED]" },
      },
    ];
  }, [filtered]);

  const trend = useMemo(() => buildPoTrend(filtered), [filtered]);
  const suppliers = useMemo(
    () => supplierDistribution(filtered, Number.MAX_SAFE_INTEGER),
    [filtered],
  );
  const topSupplierChart = useMemo(
    () => buildTopSupplierChartData(suppliers, 5),
    [suppliers],
  );
  const statuses = useMemo(() => statusDistribution(filtered), [filtered]);

  useEffect(() => {
    if (query.isLoading || query.isFetching) return;
    const chartData = {
      trend,
      suppliers: topSupplierChart,
      statuses,
    };
    console.log("KPI Data:", kpis);
    console.log("Chart Data:", chartData);
    console.log("Table Rows:", filtered);
    if (query.isError) {
      console.error(
        "Purchase Order Report query error:",
        query.error instanceof Error
          ? query.error.message
          : query.error,
      );
    } else if (allRows.length > 0 && filtered.length === 0) {
      console.warn(
        "Purchase Order Report: filters excluded all records.",
        { applied, totalFetched: allRows.length },
      );
    } else if (!query.isError && allRows.length === 0) {
      console.warn(
        "Purchase Order Report: frontend received 0 Purchase Orders from API.",
        {
          availableFields,
          removedFields: query.data?.removedFields ?? [],
          applied,
        },
      );
    }
  }, [
    query.isLoading,
    query.isFetching,
    query.isError,
    query.error,
    query.data?.removedFields,
    allRows.length,
    availableFields,
    applied,
    filtered,
    kpis,
    trend,
    topSupplierChart,
    statuses,
  ]);

  const filterKey = JSON.stringify(applied);
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
    resetKey: filterKey,
  });

  const exportColumns = useMemo<ExportColumn<ReportPo>[]>(() => {
    const cols: ExportColumn<ReportPo>[] = [
      { id: "name", label: "PO Number", accessor: (r) => r.name },
      {
        id: "supplier",
        label: "Supplier",
        accessor: (r) => r.supplier_name || r.supplier || "",
      },
    ];
    if (showBuyer) {
      cols.push({ id: "buyer", label: "Buyer", accessor: (r) => r.owner || "" });
    }
    if (showDepartment) {
      cols.push({
        id: "department",
        label: "Department",
        accessor: (r) => r.department || "",
      });
    }
    if (showCostCenter) {
      cols.push({
        id: "costCenter",
        label: "Cost Center",
        accessor: (r) => r.cost_center || "",
      });
    }
    cols.push(
      {
        id: "order_date",
        label: "Order Date",
        accessor: (r) => r.transaction_date || "",
      },
      {
        id: "delivery_date",
        label: "Delivery Date",
        accessor: (r) => r.schedule_date || "",
      },
      { id: "status", label: "Status", accessor: (r) => r.status || "" },
      {
        id: "amount",
        label: "Amount",
        accessor: (r) => r.grand_total ?? 0,
      },
      {
        id: "grn",
        label: "GRN %",
        accessor: (r) => r.per_received ?? 0,
      },
      {
        id: "invoice",
        label: "Invoice %",
        accessor: (r) => r.per_billed ?? 0,
      },
    );
    return cols;
  }, [showBuyer, showCostCenter, showDepartment]);

  const fetchError =
    query.isError && query.error
      ? query.error instanceof Error
        ? query.error.message
        : String(query.error)
      : null;

  return (
    <ReportPageShell
      title="Purchase Order Report"
      subtitle="Analyze all Purchase Orders by supplier, status and buyer."
      lastUpdated={query.data?.fetchedAt}
      loading={query.isFetching}
      onRefresh={() => void query.refetch()}
      exportModule="Purchase Order Report"
      exportFilename="PO_Report"
      exportColumns={exportColumns}
      exportRows={filtered}
      kpis={<ReportKpiGrid items={kpis} loading={query.isLoading} />}
      filters={
        <FilterBar className="mt-0">
          <div className="flex w-full flex-wrap items-end gap-3">
            <FilterField label="Date From">
              <input
                type="date"
                className="input-field"
                value={draft.dateFrom}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, dateFrom: e.target.value }))
                }
              />
            </FilterField>
            <FilterField label="Date To">
              <input
                type="date"
                className="input-field"
                value={draft.dateTo}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, dateTo: e.target.value }))
                }
              />
            </FilterField>
            <FilterField label="Supplier">
              <select
                className="select-field"
                value={draft.supplier}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, supplier: e.target.value }))
                }
              >
                <option value="">All</option>
                {filterOptions.suppliers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FilterField>
            {showDepartment ? (
              <FilterField label="Department">
                <select
                  className="select-field"
                  value={draft.department}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, department: e.target.value }))
                  }
                >
                  <option value="">All</option>
                  {filterOptions.departments.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </FilterField>
            ) : null}
            {showBuyer ? (
              <FilterField label="Buyer">
                <select
                  className="select-field"
                  value={draft.buyer}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, buyer: e.target.value }))
                  }
                >
                  <option value="">All</option>
                  {filterOptions.buyers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </FilterField>
            ) : null}
            <FilterField label="Status">
              <select
                className="select-field"
                value={draft.status}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, status: e.target.value }))
                }
              >
                <option value="">All</option>
                {filterOptions.statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FilterField>
            {showCostCenter ? (
              <FilterField label="Cost Center">
                <select
                  className="select-field"
                  value={draft.costCenter}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, costCenter: e.target.value }))
                  }
                >
                  <option value="">All</option>
                  {filterOptions.costCenters.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </FilterField>
            ) : null}
            <FilterField label="PO Number">
              <input
                type="search"
                className="input-field"
                placeholder="Search PO…"
                value={draft.poNumber}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, poNumber: e.target.value }))
                }
              />
            </FilterField>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setApplied(draft)}
            >
              Apply Filters
            </button>
          </div>
        </FilterBar>
      }
      charts={
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {fetchError ? (
            <div className="xl:col-span-2 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Unable to load Purchase Orders</p>
                <p className="mt-1 whitespace-pre-wrap break-words opacity-90">
                  {fetchError}
                </p>
                <p className="mt-2 text-[12px] text-red-700/80">
                  Open the browser console for full request/response logs
                  (Purchase Order API, Request, ERP Response).
                </p>
              </div>
            </div>
          ) : null}
          <ReportChartCard
            title="Purchase Order Trend"
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
                  name="POs"
                  stroke="#1993FF"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ReportChartCard>
          <ReportChartCard
            title="Monthly PO Value"
            loading={query.isLoading}
            hasData={trend.some((t) => t.value > 0)}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" {...REPORT_AXIS} />
                <YAxis {...REPORT_AXIS} />
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Bar dataKey="value" name="Value" fill="#1993FF" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </ReportChartCard>
          <ReportChartCard
            title="Supplier Distribution"
            subtitle="Top 5 Suppliers by Purchase Orders"
            className="h-[320px] sm:h-[340px]"
            loading={query.isLoading}
            hasData={topSupplierChart.length > 0}
            action={
              <Link
                to="/reports/operations/supplier-performance"
                className="text-[12px] font-semibold text-[#0F6CBD] no-underline hover:underline"
              >
                View All
              </Link>
            }
          >
            <SupplierDistributionChart data={topSupplierChart} />
          </ReportChartCard>
          <ReportChartCard
            title="Status Distribution"
            loading={query.isLoading}
            hasData={statuses.length > 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statuses}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {statuses.map((_, i) => (
                    <Cell
                      key={i}
                      fill={PIE_COLORS[i % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={REPORT_TOOLTIP} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ReportChartCard>
        </div>
      }
    >
      <section className="overflow-hidden rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="overflow-x-auto">
          {query.isLoading ? (
            <div className="p-4">
              <TableSkeleton rows={8} columns={8} />
            </div>
          ) : fetchError ? (
            <EmptyState
              title="Purchase Orders failed to load"
              description={fetchError}
            />
          ) : pageRows.length === 0 ? (
            <EmptyState
              title="No Purchase Orders"
              description={
                allRows.length > 0
                  ? "Filters excluded all records. Reset filters to see Purchase Orders."
                  : "ERPNext returned no Purchase Orders for this user. Confirm POs exist and you have read permission."
              }
            />
          ) : (
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-[#F8FAFC]">
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  <th className="px-4 py-2.5">PO Number</th>
                  <th className="px-3 py-2.5">Supplier</th>
                  {showBuyer ? (
                    <th className="px-3 py-2.5">Buyer</th>
                  ) : null}
                  {showDepartment ? (
                    <th className="px-3 py-2.5">Department</th>
                  ) : null}
                  {showCostCenter ? (
                    <th className="px-3 py-2.5">Cost Center</th>
                  ) : null}
                  <th className="px-3 py-2.5">Order Date</th>
                  <th className="px-3 py-2.5">Delivery Date</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Amount</th>
                  <th className="px-3 py-2.5">GRN %</th>
                  <th className="px-3 py-2.5">Invoice %</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {pageRows.map((po) => (
                  <tr key={po.name} className="text-[12px] hover:bg-[#F8FAFC]/80">
                    <td className="px-4 py-3 font-semibold text-primary-700">
                      <Link
                        to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                        className="hover:underline"
                      >
                        {po.name}
                      </Link>
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-3">
                      {po.supplier_name || po.supplier || "—"}
                    </td>
                    {showBuyer ? (
                      <td className="px-3 py-3 text-neutral-600">
                        {po.owner || "—"}
                      </td>
                    ) : null}
                    {showDepartment ? (
                      <td className="px-3 py-3 text-neutral-600">
                        {po.department || "—"}
                      </td>
                    ) : null}
                    {showCostCenter ? (
                      <td className="px-3 py-3 text-neutral-600">
                        {po.cost_center || "—"}
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap px-3 py-3 text-neutral-500">
                      {po.transaction_date
                        ? formatDate(po.transaction_date, "MMM d, yyyy")
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-neutral-500">
                      {po.schedule_date
                        ? formatDate(po.schedule_date, "MMM d, yyyy")
                        : "—"}
                    </td>
                    <td className="px-3 py-3">
                      {po.status ? (
                        <StatusBadge status={po.status} size="sm" />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold tabular-nums">
                      {formatCurrency(po.grand_total)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-neutral-600">
                      {Math.round(Number(po.per_received) || 0)}%
                    </td>
                    <td className="px-3 py-3 tabular-nums text-neutral-600">
                      {Math.round(Number(po.per_billed) || 0)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                          className="text-[11px] font-semibold text-primary-600 hover:underline"
                        >
                          View
                        </Link>
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-800"
                          onClick={() => window.print()}
                        >
                          Print
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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
            recordLabel="purchase orders"
          />
        </div>
      </section>
    </ReportPageShell>
  );
}
