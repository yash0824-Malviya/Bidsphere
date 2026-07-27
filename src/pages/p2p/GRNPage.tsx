import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Plus } from "lucide-react";
import toast from "react-hot-toast";

import {
  getIncomingPurchaseOrders,
  getPurchaseReceipt,
  submitPurchaseReceipt,
} from "../../api/purchasing";
import { isWarehouseDigitalSignatureComplete } from "../../api/warehouseEsign";
import { invalidateFinanceDashboardMetrics } from "../../api/financeWorkflow";
import { reconcileProcurementReadyToIssue } from "../../api/materialRequestWorkflow";
import { invalidateWarehouseStock } from "../../api/warehouseStock";
import { fetchPagedList } from "../../api/erpnext";
import type { Filter } from "../../api/erpnext";
import type {
  PurchaseReceipt,
  PurchaseReceiptStatus,
} from "../../types/erpnext";
import EmptyState from "../../components/EmptyState";
import ConnectionError from "../../components/ConnectionError";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import PdfActions from "../../components/PdfActions";
import ExportButton from "../../components/export/ExportButton";
import type { ExportColumn } from "../../utils/export";
import UpcomingDeliveriesPanel from "../../components/warehouse/UpcomingDeliveriesPanel";
import { buildGrnPdf, grnPdfFilename } from "../../utils/pdf/grnPdf";
import { canCreateGRN } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { FilterBar, FilterField, SearchInput, SortableTableHeader } from "../../components/ui";
import { usePagination } from "../../hooks/usePagination";
import { useDebounce } from "../../hooks/useDebounce";
import {
  GRN_DEFAULT_SORT,
  grnComparators,
  sortNewestFirst,
  sortRows,
} from "../../utils/listSort";
import { formatCurrency, formatDate } from "../../utils/format";
import { buildUpcomingDeliveries } from "../../utils/upcomingDeliveries";

const GRN_DOCTYPE = "Purchase Receipt";

const GRN_FIELDS = [
  "name",
  "supplier",
  "supplier_name",
  "posting_date",
  "creation",
  "status",
  "grand_total",
  "currency",
  "total_qty",
];

/** Sort keys that map directly to a real Purchase Receipt field. */
const GRN_ORDER_BY_FIELD: Record<string, string> = {
  name: "name",
  supplier: "supplier_name",
  date: "posting_date",
  status: "status",
  total: "grand_total",
};

const GRN_COMPARATORS = grnComparators<PurchaseReceipt>();

const STATUS_OPTIONS: Array<"" | PurchaseReceiptStatus> = [
  "",
  "Draft",
  "To Bill",
  "Completed",
  "Closed",
  "Cancelled",
  "Return Issued",
];

export default function GRNPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canCreate = canCreateGRN(role);
  const [status, setStatus] = useState<"" | PurchaseReceiptStatus>("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const filters = useMemo<Filter[]>(() => {
    const f: Filter[] = [];
    if (status) f.push(["status", "=", status]);
    if (debouncedSearch) f.push(["name", "like", `%${debouncedSearch}%`]);
    return f;
  }, [status, debouncedSearch]);

  const [sort, setSort] = useState(GRN_DEFAULT_SORT);
  const orderByField = GRN_ORDER_BY_FIELD[sort.key];
  const order_by = orderByField
    ? `${orderByField} ${sort.direction}, name desc`
    : "posting_date desc, creation desc, name desc";

  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: JSON.stringify(filters) + order_by,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["purchase-receipts", filters, page, pageSize, order_by],
    queryFn: () =>
      fetchPagedList<PurchaseReceipt>(GRN_DOCTYPE, {
        filters,
        fields: GRN_FIELDS,
        order_by,
        page,
        pageSize,
      }),
    placeholderData: (prev) => prev,
  });

  const rows = data?.data ?? [];

  const incomingQuery = useQuery({
    queryKey: ["incoming-purchase-orders"],
    queryFn: getIncomingPurchaseOrders,
    staleTime: 60_000,
    enabled: canCreate,
  });

  const deliveries = useMemo(
    () => buildUpcomingDeliveries(incomingQuery.data ?? []),
    [incomingQuery.data]
  );

  const sortedRows = useMemo(() => {
    const normalized = sortNewestFirst(rows, {
      date: (g) => g.posting_date,
      creation: (g) => g.creation,
      name: (g) => g.name,
    });
    return sortRows(normalized, sort, GRN_COMPARATORS);
  }, [rows, sort]);

  const exportColumns = useMemo<ExportColumn<PurchaseReceipt>[]>(
    () => [
      { id: "name", label: "GRN Number", accessor: (r) => r.name },
      {
        id: "supplier",
        label: "Supplier",
        accessor: (r) => r.supplier_name || r.supplier,
      },
      {
        id: "posting_date",
        label: "Date",
        type: "date",
        accessor: (r) => r.posting_date,
      },
      {
        id: "status",
        label: "Status",
        type: "status",
        accessor: (r) => r.status,
      },
      {
        id: "total_qty",
        label: "Total Qty",
        type: "number",
        accessor: (r) => r.total_qty,
      },
      {
        id: "grand_total",
        label: "Total",
        type: "currency",
        accessor: (r) => r.grand_total,
      },
    ],
    [],
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <PageHeader
        title={canCreate ? "Goods Receipt Notes" : "Track Goods Receipts"}
        description={
          canCreate
            ? "Receive inbound deliveries and record goods receipts against open purchase orders."
            : "Monitor warehouse receipt records and view receipt status against open purchase orders."
        }
        actions={
          <ExportButton
            module="GRN"
            filenamePrefix="GRN_List"
            columns={exportColumns}
            rows={sortedRows}
          />
        }
      />

      <div
        className={`grid min-h-0 flex-1 gap-3 ${
          canCreate
            ? "lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]"
            : "grid-cols-1"
        }`}
      >
        {canCreate && (
          <UpcomingDeliveriesPanel
            deliveries={deliveries}
            isLoading={incomingQuery.isLoading}
            className="max-h-[calc(100vh-11rem)] lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)]"
          />
        )}

        <section className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">GRN History</h2>
              <p className="text-[11px] text-neutral-500">
                Recorded goods receipt notes and receipt status
              </p>
            </div>
            {canCreate && (
              <Link to="/warehouse/inventory/create-grn" className="btn-primary shrink-0">
                <Plus className="h-4 w-4" /> New GRN
              </Link>
            )}
          </div>

          <FilterBar>
            <FilterField label="Search" className="min-w-[200px] flex-1">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="GRN number…"
              />
            </FilterField>
            <FilterField label="Status" className="min-w-[150px]">
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as PurchaseReceiptStatus | "")
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

          <div className="table-shell min-w-0">
            {isLoading ? (
              <TableSkeleton rows={6} columns={5} />
            ) : isError ? (
              <ConnectionError
                error={error}
                title="Could not load goods receipts"
                onRetry={() => void refetch()}
              />
            ) : sortedRows.length === 0 ? (
              <EmptyState
                icon={PackagePlus}
                title="No goods receipts yet"
                description={
                  canCreate
                    ? "Receive goods against an open PO to create a GRN."
                    : "Warehouse receipt records will appear here once goods are received."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortableTableHeader label="GRN Number" sortKey="name" sort={sort} onSort={setSort} />
                      <SortableTableHeader label="Supplier" sortKey="supplier" sort={sort} onSort={setSort} />
                      <SortableTableHeader label="Posting Date" sortKey="date" sort={sort} onSort={setSort} />
                      <SortableTableHeader label="Status" sortKey="status" sort={sort} onSort={setSort} />
                      <th className="text-right">Received Qty</th>
                      <SortableTableHeader label="Total" sortKey="total" sort={sort} onSort={setSort} className="text-right" />
                      <th className="text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((g: PurchaseReceipt) => (
                      <tr
                        key={g.name}
                        onClick={() => navigate(`/p2p/grn/${g.name}`)}
                        className="cursor-pointer"
                      >
                        <td>
                          <span className="table-link">{g.name}</span>
                        </td>
                        <td className="text-neutral-600">
                          {g.supplier_name ?? g.supplier}
                        </td>
                        <td className="text-neutral-600">
                          {formatDate(g.posting_date)}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={g.status ?? "Draft"} />
                            {g.status === "Draft" && canCreate && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (window.confirm(`Are you sure you want to submit GRN ${g.name}?`)) {
                                    const loadToast = toast.loading(`Submitting GRN ${g.name}...`);
                                    try {
                                      // Match detail-page gate: signature required before submit.
                                      const fresh = await getPurchaseReceipt(g.name);
                                      if (!isWarehouseDigitalSignatureComplete(fresh)) {
                                        toast.error(
                                          "Warehouse Digital Signature is mandatory before submitting GRN. Open the GRN to complete E-Sign.",
                                          { id: loadToast },
                                        );
                                        return;
                                      }
                                      await submitPurchaseReceipt(g.name);
                                      // Goods are on-hand in ERPNext Bin now —
                                      // advance any fully-received procurement
                                      // MR to Ready to Issue (best-effort).
                                      try {
                                        await reconcileProcurementReadyToIssue();
                                      } catch (reconcileErr) {
                                        // eslint-disable-next-line no-console
                                        console.warn("[GRN submit] Ready-to-Issue reconciliation skipped:", reconcileErr);
                                      }
                                      toast.success(`GRN ${g.name} submitted successfully`, { id: loadToast });
                                      invalidateWarehouseStock(queryClient);
                                      void queryClient.invalidateQueries({ queryKey: ["grns-awaiting-invoice"] });
                                      invalidateFinanceDashboardMetrics(queryClient);
                                    } catch (err) {
                                      toast.error(err instanceof Error ? err.message : "Failed to submit GRN", { id: loadToast });
                                    }
                                  }
                                }}
                                className="btn-primary"
                              >
                                Submit
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="text-right tabular-nums text-neutral-600">
                          {g.total_qty != null
                            ? new Intl.NumberFormat("en-US").format(g.total_qty)
                            : "—"}
                        </td>
                        <td className="text-right font-medium tabular-nums">
                          {formatCurrency(g.grand_total)}
                        </td>
                        <td className="text-right">
                          <PdfActions
                            variant="compact"
                            stopPropagation
                            className="justify-end"
                            filename={grnPdfFilename(g)}
                            build={async () => {
                              const full = await getPurchaseReceipt(g.name);
                              return buildGrnPdf(full, full.status ?? g.status ?? "Draft");
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!isLoading && !isError && sortedRows.length > 0 && (
              <PaginationBar
                currentPage={data?.current_page ?? page}
                totalPages={data?.total_pages ?? 1}
                totalRecords={data?.total_records ?? 0}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
