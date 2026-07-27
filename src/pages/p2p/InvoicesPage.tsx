import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";

import { getPurchaseInvoices } from "../../api/accounts";
import type { Filter } from "../../api/erpnext";
import type {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
} from "../../types/erpnext";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import { AppLoading } from "../../components/enterprise";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { FilterBar, FilterField, SearchInput, SortableTableHeader } from "../../components/ui";
import Pagination from "../../components/ui/Pagination";
import { useListSort } from "../../hooks/useListSort";
import { useDebounce } from "../../hooks/useDebounce";
import { useClientPagination } from "../../hooks/usePagination";
import {
  INVOICE_DEFAULT_SORT,
  invoiceComparators,
  sortNewestFirst,
} from "../../utils/listSort";
import {
  formatCurrency,
  formatDate,
  isOverdue,
} from "../../utils/format";

const INVOICE_COMPARATORS = invoiceComparators<PurchaseInvoice>();

const STATUS_OPTIONS: Array<"" | PurchaseInvoiceStatus> = [
  "",
  "Draft",
  "Submitted",
  "Paid",
  "Partly Paid",
  "Unpaid",
  "Overdue",
  "Return",
  "Cancelled",
];

/** Days overdue — negative means not yet due. */
function daysOverdue(dueDateStr?: string): number {
  if (!dueDateStr) return 0;
  const due = new Date(dueDateStr).getTime();
  return Math.floor((Date.now() - due) / 86_400_000);
}

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"" | PurchaseInvoiceStatus>("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const filters = useMemo<Filter[]>(() => {
    const f: Filter[] = [];
    if (status) f.push(["status", "=", status]);
    if (debouncedSearch) f.push(["name", "like", `%${debouncedSearch}%`]);
    return f;
  }, [status, debouncedSearch]);

  const {
    data: rows = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<PurchaseInvoice[]>({
    queryKey: ["purchase-invoices", filters],
    queryFn: () =>
      getPurchaseInvoices({
        filters,
        fields: [
          // NOTE: "purchase_order" is NOT queryable at list level on this ERPNext
          // instance — including it returns HTTP 417 and breaks the whole query.
          "name",
          "supplier",
          "supplier_name",
          "posting_date",
          "due_date",
          "creation",
          "bill_no",
          "status",
          "docstatus",           // needed to identify Draft vs Submitted
          "grand_total",
          "outstanding_amount",
          "currency",
        ],
        order_by: "posting_date desc, creation desc, name desc",
        limit_page_length: 100,
      }),
    staleTime: 0,
    retry: 1,
  });

  const normalizedRows = useMemo(
    () =>
      sortNewestFirst(rows, {
        date: (inv) => inv.posting_date,
        creation: (inv) => inv.creation,
        name: (inv) => inv.name,
      }),
    [rows]
  );

  const { sort, setSort, sortedRows } = useListSort(
    normalizedRows,
    INVOICE_DEFAULT_SORT,
    INVOICE_COMPARATORS
  );

  const {
    pageRows,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(sortedRows, {
    resetKey: `${debouncedSearch}|${status}|${sort.key}|${sort.direction}`,
  });

  // Summary counts shown in the toolbar
  const submittedCount = sortedRows.filter((r) => r.docstatus === 1).length;
  const draftCount = sortedRows.filter((r) => (r.docstatus ?? 0) === 0).length;

  return (
    <div>
      <PageHeader
        title="Purchase Invoices"
        description="Track invoices received from suppliers and their payment status."
      />

      {/* Summary counts */}
      {!isLoading && !isError && rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-primary-100 px-2.5 py-1 font-medium text-primary-700">
            {submittedCount} submitted (payable)
          </span>
          {draftCount > 0 && (
            <span
              className="rounded-full bg-warning-100 px-2.5 py-1 font-medium text-warning-700"
              title="Draft invoices must be submitted before payment can be recorded"
            >
              {draftCount} draft — needs submission
            </span>
          )}
        </div>
      )}

      <FilterBar>
        <FilterField label="Search" className="min-w-[220px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Invoice number…"
          />
        </FilterField>
        <FilterField label="Status" className="min-w-[160px]">
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as PurchaseInvoiceStatus | "")
            }
            className="select-field"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt || "All statuses"}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      <div className="table-shell">
        {isLoading ? (
          <div className="p-4">
            <AppLoading variant="table" compact title="Loading document..." />
          </div>
        ) : isError ? (
          <ConnectionError error={error} onRetry={() => void refetch()} />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No invoices yet"
            description="Submitted purchase invoices will appear here."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortableTableHeader label="Invoice" sortKey="name" sort={sort} onSort={setSort} />
                    <SortableTableHeader label="Supplier" sortKey="supplier" sort={sort} onSort={setSort} />
                    <SortableTableHeader label="Posting Date" sortKey="date" sort={sort} onSort={setSort} />
                    <SortableTableHeader label="Due Date" sortKey="due" sort={sort} onSort={setSort} />
                    <SortableTableHeader label="Status" sortKey="status" sort={sort} onSort={setSort} />
                    <th>Age</th>
                    <SortableTableHeader label="Total" sortKey="total" sort={sort} onSort={setSort} className="text-right" />
                    <SortableTableHeader label="Outstanding" sortKey="outstanding" sort={sort} onSort={setSort} className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((inv) => {
                    const unpaid =
                      inv.status !== "Paid" && inv.status !== "Cancelled";
                    const overdue = unpaid && isOverdue(inv.due_date);
                    const effectiveStatus = overdue
                      ? "Overdue"
                      : inv.status ?? "Draft";
                    const age = daysOverdue(inv.due_date);
                    return (
                      <tr
                        key={inv.name}
                        onClick={() =>
                          navigate(`/p2p/invoices/${encodeURIComponent(inv.name)}`)
                        }
                        className="cursor-pointer"
                      >
                        <td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="table-link">
                              {inv.name}
                            </span>
                            {(inv.docstatus ?? 0) === 0 && (
                              <span
                                className="rounded-full border border-warning-300 bg-warning-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-700"
                                title="Draft — submit this invoice to record it in accounting and enable payment"
                              >
                                Draft
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-neutral-600">
                          {inv.supplier_name ?? inv.supplier}
                        </td>
                        <td className="text-neutral-600">
                          {formatDate(inv.posting_date)}
                        </td>
                        <td
                          className={
                            overdue
                              ? "font-medium text-danger-500"
                              : "text-neutral-600"
                          }
                        >
                          {formatDate(inv.due_date)}
                        </td>
                        <td>
                          <StatusBadge status={effectiveStatus} />
                        </td>
                        <td>
                          <AgeBadge days={age} paid={!unpaid} />
                        </td>
                        <td className="text-right font-medium tabular-nums">
                          {formatCurrency(inv.grand_total)}
                        </td>
                        <td className="text-right tabular-nums text-neutral-700">
                          {formatCurrency(inv.outstanding_amount ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
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
      </div>
    </div>
  );
}

function AgeBadge({ days, paid }: { days: number; paid: boolean }) {
  if (paid)
    return <span className="text-xs text-neutral-400">—</span>;
  if (days <= 0)
    return (
      <span className="text-xs text-neutral-500">
        Due in {Math.abs(days)}d
      </span>
    );
  return (
    <span
      className={`text-xs font-medium ${
        days > 30 ? "text-danger-600" : "text-warning-600"
      }`}
    >
      {days}d overdue
    </span>
  );
}

