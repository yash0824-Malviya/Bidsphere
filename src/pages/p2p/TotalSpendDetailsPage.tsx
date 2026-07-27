import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Calculator,
  Calendar,
  DollarSign,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PaginationBar from "../../components/PaginationBar";
import StatusBadge from "../../components/StatusBadge";
import DashboardKpiCard, {
  DashboardKpiGrid,
  DashboardKpiSkeleton,
} from "../../components/dashboard/DashboardKpiCard";
import { Skeleton } from "../../components/Skeleton";
import ExportButton from "../../components/export/ExportButton";
import { fetchPagedList } from "../../api/erpnext";
import {
  buildTotalSpendInvoiceFilters,
  dashboardYtdStart,
  fetchDashboardSpendSummary,
} from "../../api/dashboard";
import { useClientPagination } from "../../hooks/usePagination";
import { formatCurrencyIn, formatDate } from "../../utils/format";
import type { ExportColumn } from "../../utils/export";

interface PurchaseInvoiceRow {
  name: string;
  supplier?: string;
  supplier_name?: string;
  posting_date?: string;
  status?: string;
  docstatus?: number;
  grand_total?: number;
  currency?: string;
}

type SortKey = "name" | "supplier" | "posting_date" | "amount";
type SortDir = "asc" | "desc";

const DOCTYPE = "Purchase Invoice";
const FIELDS = [
  "name",
  "supplier",
  "supplier_name",
  "posting_date",
  "status",
  "docstatus",
  "grand_total",
  "currency",
] as const;

const FETCH_LIMIT = 500;

function invoiceAmount(inv: PurchaseInvoiceRow): number {
  return typeof inv.grand_total === "number" ? inv.grand_total : 0;
}

function supplierLabel(inv: PurchaseInvoiceRow): string {
  return (inv.supplier_name || inv.supplier || "—").trim() || "—";
}

function normalizeStatus(status?: string): string {
  return (status || "Submitted").trim() || "Submitted";
}

export default function TotalSpendDetailsPage() {
  const since = dashboardYtdStart();
  const baseFilters = useMemo(
    () => buildTotalSpendInvoiceFilters(since),
    [since],
  );
  const untilDisplay = useMemo(
    () => formatDate(new Date(), "MMM dd, yyyy"),
    [],
  );
  const sinceDisplay = useMemo(
    () => formatDate(since, "MMM dd, yyyy"),
    [since],
  );

  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("posting_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [actionsOpen, setActionsOpen] = useState<string | null>(null);

  const spendSummaryQuery = useQuery({
    queryKey: ["dashboard-spend-summary"],
    queryFn: fetchDashboardSpendSummary,
    staleTime: 60_000,
  });

  const invoicesQuery = useQuery({
    queryKey: ["total-spend-details", baseFilters],
    queryFn: () =>
      fetchPagedList<PurchaseInvoiceRow>(DOCTYPE, {
        fields: [...FIELDS],
        filters: baseFilters,
        order_by: "posting_date desc, creation desc, name desc",
        page: 1,
        pageSize: FETCH_LIMIT,
      }),
  });

  const allRows = invoicesQuery.data?.data ?? [];
  const currency =
    spendSummaryQuery.data?.currency || allRows[0]?.currency || "USD";

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const inv of allRows) {
      const name = supplierLabel(inv);
      if (name !== "—") set.add(name);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const inv of allRows) set.add(normalizeStatus(inv.status));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const showStatusColumn = useMemo(() => {
    if (statusOptions.length === 0) return false;
    if (statusOptions.length === 1 && statusOptions[0] === "Paid") return false;
    return true;
  }, [statusOptions]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = amountMin.trim() === "" ? null : Number(amountMin);
    const max = amountMax.trim() === "" ? null : Number(amountMax);

    let rows = allRows.filter((inv) => {
      if (q && !inv.name.toLowerCase().includes(q)) return false;
      if (supplierFilter && supplierLabel(inv) !== supplierFilter) return false;
      if (statusFilter && normalizeStatus(inv.status) !== statusFilter) {
        return false;
      }
      if (dateFrom && (inv.posting_date || "") < dateFrom) return false;
      if (dateTo && (inv.posting_date || "") > dateTo) return false;
      const amt = invoiceAmount(inv);
      if (min != null && Number.isFinite(min) && amt < min) return false;
      if (max != null && Number.isFinite(max) && amt > max) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      if (sortKey === "supplier") {
        return supplierLabel(a).localeCompare(supplierLabel(b)) * dir;
      }
      if (sortKey === "posting_date") {
        return (a.posting_date || "").localeCompare(b.posting_date || "") * dir;
      }
      return (invoiceAmount(a) - invoiceAmount(b)) * dir;
    });

    return rows;
  }, [
    allRows,
    search,
    supplierFilter,
    statusFilter,
    dateFrom,
    dateTo,
    amountMin,
    amountMax,
    sortKey,
    sortDir,
  ]);

  const {
    pageRows,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(filteredRows, {
    syncUrl: false,
    resetKey: `${search}|${supplierFilter}|${statusFilter}|${dateFrom}|${dateTo}|${amountMin}|${amountMax}|${sortKey}|${sortDir}`,
  });

  const totalSpend =
    spendSummaryQuery.data?.ytdSpend ??
    allRows.reduce((sum, inv) => sum + invoiceAmount(inv), 0);
  const totalInvoices = allRows.length;
  const avgInvoice = totalInvoices > 0 ? totalSpend / totalInvoices : 0;

  const insights = useMemo(() => {
    if (filteredRows.length === 0) {
      return {
        highest: null as PurchaseInvoiceRow | null,
        lowest: null as PurchaseInvoiceRow | null,
        average: 0,
        topSupplier: "—",
        largestSpendSupplier: "—",
      };
    }
    let highest = filteredRows[0];
    let lowest = filteredRows[0];
    const bySupplier = new Map<string, { count: number; spend: number }>();
    let sum = 0;
    for (const inv of filteredRows) {
      const amt = invoiceAmount(inv);
      sum += amt;
      if (amt > invoiceAmount(highest)) highest = inv;
      if (amt < invoiceAmount(lowest)) lowest = inv;
      const key = supplierLabel(inv);
      const prev = bySupplier.get(key) ?? { count: 0, spend: 0 };
      prev.count += 1;
      prev.spend += amt;
      bySupplier.set(key, prev);
    }
    let topSupplier = "—";
    let topCount = -1;
    let largestSpendSupplier = "—";
    let largestSpend = -1;
    for (const [name, stats] of bySupplier) {
      if (stats.count > topCount) {
        topCount = stats.count;
        topSupplier = name;
      }
      if (stats.spend > largestSpend) {
        largestSpend = stats.spend;
        largestSpendSupplier = name;
      }
    }
    return {
      highest,
      lowest,
      average: sum / filteredRows.length,
      topSupplier,
      largestSpendSupplier,
    };
  }, [filteredRows]);

  const exportColumns = useMemo<ExportColumn<PurchaseInvoiceRow>[]>(
    () => [
      { id: "name", label: "Invoice Number", accessor: (r) => r.name },
      {
        id: "supplier",
        label: "Supplier",
        accessor: (r) => supplierLabel(r),
      },
      {
        id: "posting_date",
        label: "Posting Date",
        type: "date",
        accessor: (r) => r.posting_date,
      },
      {
        id: "status",
        label: "Status",
        type: "status",
        accessor: (r) => normalizeStatus(r.status),
      },
      {
        id: "amount",
        label: "Amount",
        type: "currency",
        accessor: (r) => invoiceAmount(r),
      },
    ],
    [],
  );

  function resetFilters() {
    setSearch("");
    setSupplierFilter("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
    setAmountMin("");
    setAmountMax("");
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "amount" || key === "posting_date" ? "desc" : "asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  function handlePrint() {
    window.print();
  }

  const loading = invoicesQuery.isLoading || spendSummaryQuery.isLoading;
  const hasActiveFilters = Boolean(
    search ||
      supplierFilter ||
      statusFilter ||
      dateFrom ||
      dateTo ||
      amountMin ||
      amountMax,
  );

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[32px] font-bold leading-tight text-neutral-900">
            Total Spend Details
          </h1>
          <p className="mt-1 max-w-2xl text-[15px] text-neutral-500">
            View and analyze all supplier invoices contributing to the selected
            spend period.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportButton
            module="Total Spend"
            filenamePrefix="Total_Spend_Invoices"
            columns={exportColumns}
            rows={filteredRows}
            title="Total Spend Details"
          />
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex h-10 items-center gap-2 rounded-control border border-neutral-200 bg-white px-3 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            <Printer className="h-4 w-4" />
            Print Report
          </button>
        </div>
      </div>

      {/* KPI cards */}
      {loading && allRows.length === 0 ? (
        <DashboardKpiSkeleton count={4} columns={4} />
      ) : (
        <DashboardKpiGrid columns={4} className="md:grid-cols-2 xl:grid-cols-4">
          <DashboardKpiCard
            label="Total Spend"
            value={formatCurrencyIn(totalSpend, currency)}
            subtitle="Year to date"
            icon={DollarSign}
            iconClassName="bg-primary-50 text-primary-600"
          />
          <DashboardKpiCard
            label="Total Invoices"
            value={totalInvoices.toLocaleString()}
            subtitle="Submitted invoices"
            icon={Receipt}
            iconClassName="bg-sky-50 text-sky-700"
          />
          <DashboardKpiCard
            label="Average Invoice Value"
            value={formatCurrencyIn(avgInvoice, currency)}
            subtitle="Across all invoices"
            icon={Calculator}
            iconClassName="bg-amber-50 text-amber-700"
          />
          <DashboardKpiCard
            label="Reporting Period"
            value={`${sinceDisplay} – ${untilDisplay}`}
            subtitle="Current YTD window"
            icon={Calendar}
            iconClassName="bg-emerald-50 text-emerald-700"
            valueClassName="text-[17px] font-semibold leading-snug text-neutral-900"
          />
        </DashboardKpiGrid>
      )}

      {/* Quick insights */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {(
          [
            {
              label: "Highest Invoice",
              value: insights.highest
                ? formatCurrencyIn(invoiceAmount(insights.highest), currency)
                : "—",
              hint: insights.highest?.name ?? "—",
              icon: TrendingUp,
            },
            {
              label: "Lowest Invoice",
              value: insights.lowest
                ? formatCurrencyIn(invoiceAmount(insights.lowest), currency)
                : "—",
              hint: insights.lowest?.name ?? "—",
              icon: TrendingDown,
            },
            {
              label: "Average Invoice",
              value: formatCurrencyIn(insights.average, currency),
              hint: "Filtered set",
              icon: Calculator,
            },
            {
              label: "Top Supplier",
              value: insights.topSupplier,
              hint: "Most invoices",
              icon: Users,
            },
            {
              label: "Largest Spend Supplier",
              value: insights.largestSpendSupplier,
              hint: "Highest total",
              icon: DollarSign,
            },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="rounded-card border border-neutral-200 bg-white px-4 py-3 shadow-card"
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </div>
              <p
                className="mt-1.5 truncate text-[15px] font-semibold tabular-nums text-neutral-900"
                title={item.value}
              >
                {item.value}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-neutral-400" title={item.hint}>
                {item.hint}
              </p>
            </div>
          );
        })}
      </section>

      {/* Sticky filter bar */}
      <div className="sticky top-[52px] z-10 rounded-card border border-neutral-200 bg-white/95 p-3 shadow-card backdrop-blur">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[180px] flex-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Search Invoice Number
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ACC-PINV-…"
                className="h-10 w-full rounded-control border border-neutral-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </label>

          <label className="min-w-[150px] text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Supplier
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="mt-1 h-10 w-full rounded-control border border-neutral-200 bg-white px-2.5 text-sm"
            >
              <option value="">All suppliers</option>
              {supplierOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          {showStatusColumn || statusOptions.length > 1 ? (
            <label className="min-w-[130px] text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="mt-1 h-10 w-full rounded-control border border-neutral-200 bg-white px-2.5 text-sm"
              >
                <option value="">All statuses</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 block h-10 rounded-control border border-neutral-200 px-2.5 text-sm"
            />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 block h-10 rounded-control border border-neutral-200 px-2.5 text-sm"
            />
          </label>

          <label className="w-[110px] text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Min Amount
            <input
              type="number"
              min={0}
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
              placeholder="0"
              className="mt-1 h-10 w-full rounded-control border border-neutral-200 px-2.5 text-sm"
            />
          </label>
          <label className="w-[110px] text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Max Amount
            <input
              type="number"
              min={0}
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
              placeholder="—"
              className="mt-1 h-10 w-full rounded-control border border-neutral-200 px-2.5 text-sm"
            />
          </label>

          <button
            type="button"
            onClick={resetFilters}
            disabled={!hasActiveFilters}
            className="inline-flex h-10 items-center gap-1.5 rounded-control border border-neutral-200 bg-white px-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Filters
          </button>
        </div>
      </div>

      {/* Table */}
      <section className="overflow-hidden rounded-card border border-neutral-200 bg-white shadow-card">
        {loading && allRows.length === 0 ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-4 py-12">
            <EmptyState
              icon={Receipt}
              title="No invoices found."
              description={
                hasActiveFilters
                  ? "Try adjusting or clearing your filters to see matching invoices."
                  : "No submitted purchase invoices were found for the current YTD window."
              }
              action={
                hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-2 rounded-control bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset Filters
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[15px]">
                <thead className="bg-neutral-50 text-[13px] font-semibold uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("name")}
                        className="inline-flex items-center gap-1 hover:text-neutral-800"
                      >
                        Invoice Number{sortIndicator("name")}
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("supplier")}
                        className="inline-flex items-center gap-1 hover:text-neutral-800"
                      >
                        Supplier{sortIndicator("supplier")}
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("posting_date")}
                        className="inline-flex items-center gap-1 hover:text-neutral-800"
                      >
                        Posting Date{sortIndicator("posting_date")}
                      </button>
                    </th>
                    {showStatusColumn ? (
                      <th className="px-4 py-3">Status</th>
                    ) : null}
                    <th className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort("amount")}
                        className="inline-flex items-center gap-1 hover:text-neutral-800"
                      >
                        Amount{sortIndicator("amount")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {pageRows.map((inv) => {
                    const supplier = supplierLabel(inv);
                    return (
                      <tr key={inv.name} className="hover:bg-neutral-50/80">
                        <td className="px-4 py-3">
                          <Link
                            to={`/p2p/invoices/${encodeURIComponent(inv.name)}`}
                            className="font-semibold text-primary-600 no-underline hover:underline"
                          >
                            {inv.name}
                          </Link>
                        </td>
                        <td className="max-w-[220px] px-4 py-3 text-neutral-700">
                          <span className="block truncate" title={supplier}>
                            {supplier}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                          {inv.posting_date
                            ? formatDate(inv.posting_date, "d MMM yyyy")
                            : "—"}
                        </td>
                        {showStatusColumn ? (
                          <td className="px-4 py-3">
                            <StatusBadge status={normalizeStatus(inv.status)} />
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-neutral-900">
                          {formatCurrencyIn(invoiceAmount(inv), inv.currency || currency)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="relative inline-flex items-center justify-end gap-1">
                            <Link
                              to={`/p2p/invoices/${encodeURIComponent(inv.name)}`}
                              className="inline-flex h-8 items-center gap-1 rounded-control px-2 text-xs font-semibold text-primary-700 no-underline hover:bg-primary-50"
                              title="View"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View
                            </Link>
                            <button
                              type="button"
                              className="inline-flex h-8 items-center gap-1 rounded-control px-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
                              title="Download PDF"
                              onClick={() => window.print()}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              PDF
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-8 items-center gap-1 rounded-control px-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
                              title="Print"
                              onClick={() => window.print()}
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Print
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-control text-neutral-500 hover:bg-neutral-100"
                              aria-label="More actions"
                              onClick={() =>
                                setActionsOpen((cur) =>
                                  cur === inv.name ? null : inv.name,
                                )
                              }
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                            {actionsOpen === inv.name ? (
                              <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-card border border-neutral-200 bg-white py-1 shadow-card">
                                <Link
                                  to={`/p2p/invoices/${encodeURIComponent(inv.name)}`}
                                  className="flex items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 no-underline hover:bg-neutral-50"
                                  onClick={() => setActionsOpen(null)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  Open invoice
                                </Link>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                                  onClick={() => {
                                    setActionsOpen(null);
                                    window.print();
                                  }}
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  Download PDF
                                </button>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                                  onClick={() => {
                                    setActionsOpen(null);
                                    void navigator.clipboard?.writeText(inv.name);
                                  }}
                                >
                                  <FileSpreadsheet className="h-3.5 w-3.5" />
                                  Copy invoice #
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              totalRecords={totalRecords}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              recordLabel="invoices"
            />
          </>
        )}
      </section>
    </div>
  );
}
