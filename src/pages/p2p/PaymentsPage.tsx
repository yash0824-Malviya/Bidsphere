import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CreditCard,
  Download,
  FileSpreadsheet,
  Plus,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { getModesOfPayment, getPaymentEntries } from "../../api/accounts";
import { getAllPayments, getVoucherById } from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import type { Filter } from "../../api/erpnext";
import PaymentActionsMenu from "../../components/payments/PaymentActionsMenu";
import PdfActions from "../../components/PdfActions";
import { buildPaymentReceiptPdf } from "../../utils/pdf/paymentPdf";
import { buildVoucherPaymentPdf } from "../../utils/pdf/voucherDocPdf";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { FilterBar, FilterField, SearchInput, SortableTableHeader, ErpNextDatePicker } from "../../components/ui";
import { useListSort } from "../../hooks/useListSort";
import { useDebounce } from "../../hooks/useDebounce";
import { exportPaymentsCsv, exportPaymentsPdf } from "../../utils/paymentExport";
import {
  computePaymentKpis,
  filterPayments,
  formatCurrencyCompact,
  mapPaymentUiStatus,
  monthlyPaymentTrend,
  PAYMENT_STATUS_OPTIONS,
  paymentAmount,
  recentLargePayments,
  topSuppliersByPayment,
  type PaymentUiStatus,
} from "../../utils/paymentUtils";
import { formatCurrency } from "../../utils/format";
import { formatUsDisplayDate } from "../../utils/erpNextDate";
import { getPaymentModeLabel } from "../../utils/usPaymentMethods";
import {
  PAYMENT_DEFAULT_SORT,
  paymentComparators,
  sortNewestFirst,
} from "../../utils/listSort";
import type { PaymentEntry } from "../../types/erpnext";

const PAYMENT_COMPARATORS = paymentComparators<PaymentEntry>();

export default function PaymentsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState<"" | PaymentUiStatus>("");
  const [methodFilter, setMethodFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const apiFilters = useMemo<Filter[]>(
    () => [["payment_type", "=", "Pay"]],
    []
  );

  const { data: paymentModes = [] } = useQuery({
    queryKey: ["modes-of-payment"],
    queryFn: getModesOfPayment,
    staleTime: 5 * 60_000,
  });

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["payment-entries", apiFilters],
    queryFn: () =>
      getPaymentEntries({
        filters: apiFilters,
        fields: [
          "name",
          "party",
          "party_name",
          "posting_date",
          "creation",
          "mode_of_payment",
          "paid_amount",
          "received_amount",
          "reference_no",
          "status",
          "docstatus",
          "paid_from_account_currency",
          "paid_to_account_currency",
          "owner",
        ],
        order_by: "posting_date desc, creation desc, name desc",
        limit_page_length: 200,
      }),
  });

  // Workflow payments derived from the voucher store. These are appended to the
  // ERPNext payment history (never replacing it) so the module is one unified
  // ledger. Each carries its voucher id so the row can drill down to the
  // linked Invoice → Voucher → PO → Supplier.
  const syncVersion = useVoucherSyncStore((s) => s.version);
  const workflowPayments = useMemo(() => getAllPayments(), [syncVersion]);

  const workflowRows = useMemo(
    () =>
      workflowPayments.map((p) => ({
        name: p.payment_id,
        party: p.supplier,
        party_name: p.supplier_name,
        posting_date: p.paid_date.slice(0, 10),
        creation: p.paid_date,
        mode_of_payment: p.method,
        paid_amount: p.amount,
        received_amount: p.amount,
        reference_no: p.reference_number,
        status: "Submitted",
        docstatus: 1,
        paid_from_account_currency: p.currency,
        paid_to_account_currency: p.currency,
        owner: "voucher-workflow",
      })) as unknown as PaymentEntry[],
    [workflowPayments]
  );

  // payment_id → voucher_id, so workflow rows drill into the invoice/voucher.
  const workflowVoucherByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of workflowPayments) m.set(p.payment_id, p.voucher_id);
    return m;
  }, [workflowPayments]);

  // Unified ledger: ERPNext history + workflow payments, deduplicated by name.
  // ERPNext rows take priority (authoritative status/amounts). Workflow rows
  // only appear when they don't yet exist in the ERPNext response (e.g. the
  // Payment Entry was created locally but hasn't been fetched yet).
  const mergedRows = useMemo(() => {
    const seen = new Set<string>();
    const result: PaymentEntry[] = [];
    for (const r of rows) {
      if (r.name && !seen.has(r.name)) {
        seen.add(r.name);
        result.push(r);
      }
    }
    for (const r of workflowRows) {
      if (r.name && !seen.has(r.name)) {
        seen.add(r.name);
        result.push(r);
      }
    }
    return result;
  }, [workflowRows, rows]);

  function openPayment(p: PaymentEntry) {
    const voucherId = p.name ? workflowVoucherByName.get(p.name) : undefined;
    if (voucherId) {
      navigate(`/p2p/invoices/${encodeURIComponent(voucherId)}`);
    } else if (p.name) {
      navigate(`/p2p/payments/${encodeURIComponent(p.name)}`);
    }
  }

  const methodFilterOptions = useMemo(() => {
    const workflowMethods = workflowPayments.map((p) => p.method);
    return ["All", ...new Set([...paymentModes, ...workflowMethods])];
  }, [paymentModes, workflowPayments]);

  const filtered = useMemo(
    () =>
      filterPayments(mergedRows, {
        search: debouncedSearch,
        status: statusFilter,
        method: methodFilter,
        dateFrom,
        dateTo,
      }),
    [mergedRows, debouncedSearch, statusFilter, methodFilter, dateFrom, dateTo]
  );

  const normalizedFiltered = useMemo(
    () =>
      sortNewestFirst(filtered, {
        date: (p) => p.posting_date,
        creation: (p) => p.creation,
        name: (p) => p.name ?? "",
      }),
    [filtered]
  );

  const { sort, setSort, sortedRows } = useListSort(
    normalizedFiltered,
    PAYMENT_DEFAULT_SORT,
    PAYMENT_COMPARATORS
  );

  const kpis = useMemo(() => computePaymentKpis(mergedRows), [mergedRows]);
  const trend = useMemo(() => monthlyPaymentTrend(mergedRows), [mergedRows]);
  const topSuppliers = useMemo(
    () => topSuppliersByPayment(mergedRows),
    [mergedRows]
  );
  const largePayments = useMemo(() => recentLargePayments(filtered, 5), [filtered]);

  function handleExportPdf() {
    if (filtered.length === 0) {
      toast.error("No payments to export.");
      return;
    }
    void exportPaymentsPdf(filtered)
      .then(() => toast.success("Payments PDF downloaded."))
      .catch(() => toast.error("Could not generate payments PDF."));
  }

  function handleExportExcel() {
    if (filtered.length === 0) {
      toast.error("No payments to export.");
      return;
    }
    exportPaymentsCsv(filtered);
    toast.success("Payments exported to Excel (CSV).");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Accounts Payable disbursements — ACH, wire, check, and card payments to suppliers."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/p2p/payments/new" className="btn-primary">
              <Plus className="h-4 w-4" /> New Payment
            </Link>
            <button
              type="button"
              onClick={handleExportPdf}
              className="btn-secondary"
            >
              <Download className="h-4 w-4" />
              Export PDF
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="btn-secondary"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel
            </button>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PaymentKpiCard
          icon={Wallet}
          label="Total Payments"
          value={formatCurrencyCompact(kpis.total)}
          tone="primary"
          loading={isLoading}
        />
        <PaymentKpiCard
          icon={TrendingUp}
          label="Payments This Month"
          value={formatCurrencyCompact(kpis.monthTotal)}
          tone="accent"
          loading={isLoading}
        />
        <PaymentKpiCard
          icon={CreditCard}
          label="Pending Payments"
          value={formatCurrencyCompact(kpis.pending)}
          tone="warning"
          loading={isLoading}
        />
        <PaymentKpiCard
          icon={Users}
          label="Active Suppliers Paid"
          value={String(kpis.activeSuppliers)}
          tone="neutral"
          loading={isLoading}
        />
      </div>

      {/* Filters */}
      <FilterBar>
        <FilterField label="Search Payment Number" className="min-w-[200px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Payment number, supplier, reference…"
          />
        </FilterField>
        <FilterField label="Status" className="min-w-[140px]">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "" | PaymentUiStatus)
            }
            className="select-field"
          >
            <option value="">All</option>
            {PAYMENT_STATUS_OPTIONS.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Payment Method" className="min-w-[150px]">
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="select-field"
          >
            {methodFilterOptions.map((m) => (
              <option key={m} value={m}>
                {m === "All" ? m : getPaymentModeLabel(m)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="From" className="min-w-[160px]">
          <ErpNextDatePicker
            value={dateFrom}
            onChange={setDateFrom}
            showFormatHint={false}
          />
        </FilterField>
        <FilterField label="To" className="min-w-[160px]">
          <ErpNextDatePicker
            value={dateTo}
            onChange={setDateTo}
            showFormatHint={false}
          />
        </FilterField>
      </FilterBar>

      {/* Analytics + table */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* Monthly trend */}
          <div className="card p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Monthly Payment Trend
                </h3>
                <p className="text-xs text-neutral-500">
                  Payment spending month-wise
                </p>
              </div>
            </div>
            {isLoading ? (
              <div className="h-52 animate-pulse rounded-xl bg-neutral-100" />
            ) : (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      axisLine={{ stroke: "#e2e8f0" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) =>
                        formatCurrencyCompact(v)
                      }
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(99,102,241,0.06)" }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                        fontSize: 12,
                      }}
                      formatter={(value) =>
                        formatCurrencyCompact(typeof value === "number" ? value : 0)
                      }
                    />
                    <Bar dataKey="amount" name="Payments" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="table-shell">
            {isLoading ? (
              <TableSkeleton rows={8} columns={8} />
            ) : isError && mergedRows.length === 0 ? (
              <EmptyState icon={CreditCard} title="Could not load payments" />
            ) : sortedRows.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title="No payments found"
                description="Adjust filters or record a new payment against an invoice."
                action={
                  <Link to="/p2p/payments/new" className="btn-primary">
                    <Plus className="h-4 w-4" /> New Payment
                  </Link>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortableTableHeader label="Payment Number" sortKey="name" sort={sort} onSort={setSort} />
                      <SortableTableHeader label="Supplier" sortKey="supplier" sort={sort} onSort={setSort} />
                      <SortableTableHeader label="Date" sortKey="date" sort={sort} onSort={setSort} />
                      <SortableTableHeader label="Payment Method" sortKey="method" sort={sort} onSort={setSort} />
                      <th>Reference Number</th>
                      <SortableTableHeader label="Status" sortKey="status" sort={sort} onSort={setSort} />
                      <SortableTableHeader label="Amount" sortKey="amount" sort={sort} onSort={setSort} className="text-right" />
                      <th>PDF</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((p) => {
                      const isWorkflow = !!(
                        p.name && workflowVoucherByName.has(p.name)
                      );
                      return (
                        <tr
                          key={p.name}
                          className="cursor-pointer"
                          onClick={() => openPayment(p)}
                        >
                          <td>
                            <span className="table-link">{p.name}</span>
                          </td>
                          <td className="text-neutral-600">
                            {p.party_name ?? p.party ?? "—"}
                          </td>
                          <td className="text-neutral-600">
                            {formatUsDisplayDate(p.posting_date) || "—"}
                          </td>
                          <td className="text-neutral-600">
                            {p.mode_of_payment
                              ? getPaymentModeLabel(p.mode_of_payment)
                              : "—"}
                          </td>
                          <td className="text-neutral-600">
                            {p.reference_no ?? "—"}
                          </td>
                          <td>
                            <StatusBadge status={mapPaymentUiStatus(p)} />
                          </td>
                          <td className="text-right tabular-nums">
                            <span className="block font-medium">
                              {formatCurrency(paymentAmount(p))}
                            </span>
                          </td>
                          <td>
                            <PdfActions
                              variant="compact"
                              stopPropagation
                              filename={
                                (p.name ?? "PAYMENT")
                                  .toUpperCase()
                                  .startsWith("PAY-")
                                  ? `${p.name}.pdf`
                                  : `PAY-${p.name ?? "PAYMENT"}.pdf`
                              }
                              build={async () => {
                                const voucherId = p.name
                                  ? workflowVoucherByName.get(p.name)
                                  : undefined;
                                if (voucherId) {
                                  const v = getVoucherById(voucherId);
                                  if (!v) throw new Error("Voucher not found");
                                  return buildVoucherPaymentPdf(v);
                                }
                                return buildPaymentReceiptPdf(p);
                              }}
                            />
                          </td>
                          <td>
                            {isWorkflow ? (
                              <span className="text-[10px] text-neutral-400">
                                —
                              </span>
                            ) : (
                              <PaymentActionsMenu payment={p} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar analytics */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-neutral-900">
              Top Suppliers by Payment
            </h3>
            <p className="text-xs text-neutral-500">By total amount paid</p>
            <ul className="mt-4 space-y-3">
              {topSuppliers.length === 0 ? (
                <li className="text-xs text-neutral-400">No paid suppliers yet.</li>
              ) : (
                topSuppliers.map((s, i) => (
                  <li
                    key={s.name}
                    className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-50 text-xs font-bold text-primary">
                        {i + 1}
                      </span>
                      <span className="truncate text-sm font-medium text-neutral-800">
                        {s.name}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-700">
                      {formatCurrencyCompact(s.total)}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-neutral-900">
              Recent Large Payments
            </h3>
            <p className="text-xs text-neutral-500">Highest value disbursements</p>
            <ul className="mt-4 space-y-2">
              {largePayments.length === 0 ? (
                <li className="text-xs text-neutral-400">No payments yet.</li>
              ) : (
                largePayments.map((p) => (
                  <li key={p.name}>
                    <button
                      type="button"
                      onClick={() => openPayment(p)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-100 px-3 py-2 text-left transition hover:border-primary-200 hover:bg-primary-50/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-neutral-800">
                          {p.name}
                        </p>
                        <p className="truncate text-[10px] text-neutral-500">
                          {p.party_name ?? p.party}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">
                        {formatCurrencyCompact(paymentAmount(p))}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentKpiCard({
  icon: Icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "primary" | "accent" | "warning" | "neutral";
  loading?: boolean;
}) {
  const gradients: Record<string, string> = {
    primary: "bg-primary-50 ring-primary-100",
    accent: "bg-primary-50 ring-primary-100",
    warning: "bg-warning-50 ring-warning-100",
    neutral: "bg-neutral-50 ring-neutral-200",
  };
  const iconTone: Record<string, string> = {
    primary: "bg-primary text-white shadow-primary/25",
    accent: "bg-primary-500 text-white shadow-primary/25",
    warning: "bg-warning-500 text-white shadow-warning/25",
    neutral: "bg-neutral-600 text-white",
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl p-5 shadow-sm ring-1 ${gradients[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            {label}
          </p>
          {loading ? (
            <div className="mt-2 h-8 w-24 animate-pulse rounded bg-neutral-200/60" />
          ) : (
            <p className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
              {value}
            </p>
          )}
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-md ${iconTone[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
