import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";

import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import EmptyState from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";
import { fetchPagedList } from "../../api/erpnext";
import {
  buildTotalSpendInvoiceFilters,
  dashboardYtdStart,
  fetchDashboardSpendSummary,
} from "../../api/dashboard";
import { usePagination } from "../../hooks/usePagination";
import { formatCurrencyIn, formatDate } from "../../utils/format";

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

export default function TotalSpendDetailsPage() {
  const since = dashboardYtdStart();
  const filters = useMemo(() => buildTotalSpendInvoiceFilters(since), [since]);

  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: JSON.stringify(filters),
  });

  const spendSummaryQuery = useQuery({
    queryKey: ["dashboard-spend-summary"],
    queryFn: fetchDashboardSpendSummary,
    staleTime: 60_000,
  });

  const invoicesQuery = useQuery({
    queryKey: ["total-spend-details", filters, page, pageSize],
    queryFn: () =>
      fetchPagedList<PurchaseInvoiceRow>(DOCTYPE, {
        fields: [...FIELDS],
        filters,
        order_by: "posting_date desc, creation desc, name desc",
        page,
        pageSize,
      }),
    placeholderData: (prev) => prev,
  });

  const rows = invoicesQuery.data?.data ?? [];
  const totalRecords = invoicesQuery.data?.total_records ?? 0;

  const untilDisplay = useMemo(() => formatDate(new Date()), []);

  return (
    <div>
      <PageHeader
        title="Total Spend Details"
        description="Submitted purchase invoices included in the dashboard's Total Spend KPI."
      />

      <div className="card mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold text-neutral-500">Total Spend</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-neutral-900">
              {spendSummaryQuery.data
                ? formatCurrencyIn(
                    spendSummaryQuery.data.ytdSpend,
                    spendSummaryQuery.data.currency
                  )
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-neutral-500">
              Number of Invoices
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-neutral-900">
              {totalRecords.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-neutral-500">Date Range</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">
              {formatDate(since)} – {untilDisplay}
            </p>
          </div>
        </div>
      </div>

      {invoicesQuery.isLoading ? (
        <div className="card">
          <div className="px-4 py-8 text-center text-sm text-neutral-500">
            Loading invoices…
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Receipt}
            title="No spend yet"
            description="No submitted purchase invoices were found for the current YTD window."
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3 text-left">Invoice</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-left">Posting Date</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.map((inv) => (
                  <tr key={inv.name} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-semibold text-neutral-900">
                      {inv.name}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {inv.supplier_name ?? inv.supplier ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {inv.posting_date ? formatDate(inv.posting_date) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.status ?? "Submitted"} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-neutral-900">
                      {typeof inv.grand_total === "number"
                        ? formatCurrencyIn(inv.grand_total, inv.currency)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PaginationBar
            currentPage={invoicesQuery.data?.current_page ?? page}
            totalPages={invoicesQuery.data?.total_pages ?? 1}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}
    </div>
  );
}

