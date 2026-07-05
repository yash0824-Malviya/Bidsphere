import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";

import { getGrnList } from "../../api/purchasing";
import ErrorState from "../../components/ErrorState";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { FilterBar, FilterField, SearchInput } from "../../components/ui";
import { useDebounce } from "../../hooks/useDebounce";
import { formatDate } from "../../utils/format";
import type { PurchaseReceiptStatus } from "../../types/erpnext";

const PAGE_SIZE = 20;

const STATUS_OPTIONS: Array<"" | PurchaseReceiptStatus> = [
  "",
  "Draft",
  "To Bill",
  "Completed",
  "Closed",
  "Cancelled",
  "Return Issued",
];

/**
 * Present the ROLE that created a Goods Receipt instead of the raw ERPNext
 * owner (which may be "Administrator" or a bare email). Goods Receipts are a
 * procurement-workflow output, so any account that isn't a recognised
 * warehouse user resolves to "Procurement". Usernames/emails are never shown.
 */
const ROLE_BY_EMAIL_PREFIX: Array<[string, string]> = [
  ["warehouse@", "Warehouse"],
  ["procurement@", "Procurement"],
  ["department@", "Department"],
  ["finance.executive@", "Finance Executive"],
  ["finance@", "Finance"],
];

function creatorRoleLabel(owner?: string): string {
  const value = (owner ?? "").trim().toLowerCase();
  for (const [prefix, label] of ROLE_BY_EMAIL_PREFIX) {
    if (value.startsWith(prefix)) return label;
  }
  // Administrator / admin@ / unknown users / arbitrary emails / empty owner →
  // the goods-receipt workflow role. Never expose a username or email.
  return "Procurement";
}

/**
 * Compact Purchase Order label showing only the last 4 digits of the ERPNext
 * PO number, prefixed with "PUR-" (e.g. "PUR-ORD-2026-00013" → "PUR-0013").
 * Returns "--" when the receipt is not linked to any Purchase Order.
 */
function formatPoShort(po?: string): string {
  const digits = (po ?? "").replace(/\D/g, "");
  if (!digits) return "--";
  return `PUR-${digits.slice(-4).padStart(4, "0")}`;
}

export default function WarehouseGRNListPage() {
  const navigate = useNavigate();

  const grnQuery = useQuery({
    queryKey: ["warehouse-grn-list"],
    queryFn: () => getGrnList({ limit: 500 }),
    staleTime: 30_000,
  });

  const rows = useMemo(() => grnQuery.data ?? [], [grnQuery.data]);

  /* ── Filters ── */
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | PurchaseReceiptStatus>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const s = r.supplier_name ?? r.supplier;
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const warehouseOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.warehouse) set.add(r.warehouse);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (supplierFilter && (r.supplier_name ?? r.supplier) !== supplierFilter)
        return false;
      if (warehouseFilter && r.warehouse !== warehouseFilter) return false;
      if (dateFrom && r.posting_date && r.posting_date < dateFrom) return false;
      if (dateTo && r.posting_date && r.posting_date > dateTo) return false;
      if (q) {
        const haystack = `${r.name} ${r.purchase_order ?? ""} ${formatPoShort(
          r.purchase_order
        )} ${r.supplier_name ?? ""} ${r.supplier ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    rows,
    debouncedSearch,
    statusFilter,
    supplierFilter,
    warehouseFilter,
    dateFrom,
    dateTo,
  ]);

  // Reset to the first page whenever the filtered set changes size.
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filteredRows.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );

  const filtersActive =
    !!search ||
    !!supplierFilter ||
    !!warehouseFilter ||
    !!statusFilter ||
    !!dateFrom ||
    !!dateTo;

  function clearFilters() {
    setSearch("");
    setSupplierFilter("");
    setWarehouseFilter("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="GRN List"
        description="All Goods Receipt Notes recorded in ERPNext. Search, filter, and view receipts."
      />

      <FilterBar>
        <FilterField label="Search" className="min-w-[220px] flex-1">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(0);
            }}
            placeholder="GRN number, PO, or supplier…"
          />
        </FilterField>
        <FilterField label="Supplier" className="min-w-[160px]">
          <select
            value={supplierFilter}
            onChange={(e) => {
              setSupplierFilter(e.target.value);
              setPage(0);
            }}
            className="select-field"
          >
            <option value="">All suppliers</option>
            {supplierOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Warehouse" className="min-w-[160px]">
          <select
            value={warehouseFilter}
            onChange={(e) => {
              setWarehouseFilter(e.target.value);
              setPage(0);
            }}
            className="select-field"
          >
            <option value="">All warehouses</option>
            {warehouseOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Status" className="min-w-[150px]">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as PurchaseReceiptStatus | "");
              setPage(0);
            }}
            className="select-field"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt || "All statuses"}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="From Date" className="min-w-[140px]">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(0);
            }}
            className="select-field"
          />
        </FilterField>
        <FilterField label="To Date" className="min-w-[140px]">
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(0);
            }}
            className="select-field"
          />
        </FilterField>
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="self-end whitespace-nowrap text-xs font-semibold text-primary-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </FilterBar>

      <div className="table-shell min-w-0">
        {grnQuery.isLoading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : grnQuery.isError ? (
          <ErrorState
            title="Could not load goods receipts"
            description="Goods Receipt Notes could not be loaded from ERPNext."
            onRetry={() => void grnQuery.refetch()}
          />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={Search}
            title={rows.length === 0 ? "No goods receipts yet" : "No matching goods receipts"}
            description={
              rows.length === 0
                ? "Receive goods against an open purchase order to create a GRN."
                : "Try adjusting your search or filters."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>GRN Number</th>
                    <th>Purchase Order</th>
                    <th>Supplier</th>
                    <th>Warehouse</th>
                    <th>Receipt Date</th>
                    <th>Posting Date</th>
                    <th>Status</th>
                    <th>Created By (Role)</th>
                    <th className="w-16 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((g) => (
                    <tr key={g.name}>
                      <td>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/p2p/grn/${encodeURIComponent(g.name)}`)
                          }
                          className="table-link"
                        >
                          {g.name}
                        </button>
                      </td>
                      <td className="text-neutral-600">
                        {g.purchase_order ? (
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/p2p/purchase-orders/${encodeURIComponent(g.purchase_order!)}`
                              )
                            }
                            className="table-link"
                            title={g.purchase_order}
                          >
                            {formatPoShort(g.purchase_order)}
                          </button>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td className="text-neutral-600">
                        {g.supplier_name ?? g.supplier ?? "—"}
                      </td>
                      <td className="text-neutral-600">{g.warehouse || "--"}</td>
                      <td className="text-neutral-600">
                        {g.creation ? formatDate(g.creation) : "—"}
                      </td>
                      <td className="text-neutral-600">
                        {g.posting_date ? formatDate(g.posting_date) : "—"}
                      </td>
                      <td>
                        <StatusBadge status={g.status ?? "Draft"} />
                      </td>
                      <td>
                        <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
                          {creatorRoleLabel(g.owner)}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center justify-center">
                          <button
                            type="button"
                            title="View GRN"
                            onClick={() =>
                              navigate(`/p2p/grn/${encodeURIComponent(g.name)}`)
                            }
                            className="inline-flex items-center justify-center rounded-md border border-neutral-200 bg-white p-1.5 text-neutral-500 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500">
              <span>
                Showing{" "}
                <span className="font-semibold text-neutral-700">
                  {safePage * PAGE_SIZE + 1}–
                  {Math.min((safePage + 1) * PAGE_SIZE, filteredRows.length)}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-neutral-700">
                  {filteredRows.length}
                </span>{" "}
                goods receipts
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 font-semibold text-neutral-600 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <span className="px-2 font-semibold text-neutral-700">
                  Page {safePage + 1} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 font-semibold text-neutral-600 disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
