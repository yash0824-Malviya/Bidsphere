import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, FileCheck2 } from "lucide-react";

import { fetchPagedList } from "../../api/erpnext";
import { getSuppliers } from "../../api/supplier";
import type { Filter } from "../../api/erpnext";
import type {
  PurchaseOrder,
  PurchaseOrderStatus,
} from "../../types/erpnext";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import ExportButton from "../../components/export/ExportButton";
import type { ExportColumn } from "../../utils/export";
import {
  FilterBar,
  FilterField,
  ProgressCell,
  ResponsiveTable,
  SearchInput,
  SortableTableHeader,
} from "../../components/ui";
import { usePagination } from "../../hooks/usePagination";
import { useDebounce } from "../../hooks/useDebounce";
import {
  PO_DEFAULT_SORT,
  purchaseOrderComparators,
  sortNewestFirst,
  sortRows,
} from "../../utils/listSort";
import { formatCurrency, formatDate } from "../../utils/format";

const PO_DOCTYPE = "Purchase Order";

const PO_FIELDS = [
  "name",
  "supplier",
  "supplier_name",
  "transaction_date",
  "creation",
  "status",
  "grand_total",
  "per_received",
  "per_billed",
  "currency",
];

/** Sort keys that map directly to a real Purchase Order field, so the server
 * can order the whole dataset rather than just the current page. */
const PO_ORDER_BY_FIELD: Record<string, string> = {
  name: "name",
  supplier: "supplier_name",
  date: "transaction_date",
  status: "status",
  total: "grand_total",
  received: "per_received",
  billed: "per_billed",
};

const PO_COMPARATORS = purchaseOrderComparators<PurchaseOrder>();

const STATUS_OPTIONS: Array<"" | PurchaseOrderStatus> = [
  "",
  "Draft",
  "On Hold",
  "To Receive and Bill",
  "To Receive",
  "To Bill",
  "Completed",
  "Closed",
  "Cancelled",
];

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preset = (searchParams.get("preset") ?? "").toLowerCase();
  const [status, setStatus] = useState<"" | PurchaseOrderStatus>("");
  const [supplier, setSupplier] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const debouncedSearch = useDebounce(search, 300);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["supplier-options"],
    queryFn: () =>
      getSuppliers({
        filters: [["disabled", "=", 0]],
        fields: ["name", "supplier_name"],
        limit_page_length: 200,
        order_by: "supplier_name asc",
      }),
  });

  const filters = useMemo<Filter[]>(() => {
    const f: Filter[] = [];
    if (preset === "pending") f.push(["docstatus", "=", 0]);
    if (status) f.push(["status", "=", status]);
    if (supplier) f.push(["supplier", "=", supplier]);
    if (from) f.push(["transaction_date", ">=", from]);
    if (to) f.push(["transaction_date", "<=", to]);
    if (debouncedSearch) f.push(["name", "like", `%${debouncedSearch}%`]);
    return f;
  }, [preset, status, supplier, from, to, debouncedSearch]);

  const [sort, setSort] = useState(PO_DEFAULT_SORT);
  const orderByField = PO_ORDER_BY_FIELD[sort.key];
  const order_by = orderByField
    ? `${orderByField} ${sort.direction}, name desc`
    : "transaction_date desc, creation desc, name desc";

  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: JSON.stringify(filters) + order_by,
  });

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["purchase-orders", filters, page, pageSize, order_by],
    queryFn: () =>
      fetchPagedList<PurchaseOrder>(PO_DOCTYPE, {
        filters,
        fields: PO_FIELDS,
        order_by,
        page,
        pageSize,
      }),
    placeholderData: (prev) => prev,
  });

  const rows = data?.data ?? [];

  // `rows` is already server-ordered for every sortable column above, so
  // this pass is just a stable tie-breaker within the current page.
  const sortedRows = useMemo(() => {
    const normalized = sortNewestFirst(rows, {
      date: (po) => po.transaction_date,
      creation: (po) => po.creation,
      name: (po) => po.name,
    });
    return sortRows(normalized, sort, PO_COMPARATORS);
  }, [rows, sort]);

  const allSelected = sortedRows.length > 0 && selected.size === sortedRows.length;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedRows.map((r) => r.name)));
    }
  }

  function toggleOne(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const exportColumns = useMemo<ExportColumn<PurchaseOrder>[]>(
    () => [
      { id: "name", label: "PO Number", accessor: (r) => r.name },
      {
        id: "supplier",
        label: "Supplier",
        accessor: (r) => r.supplier_name || r.supplier,
      },
      {
        id: "transaction_date",
        label: "Date",
        type: "date",
        accessor: (r) => r.transaction_date,
      },
      {
        id: "status",
        label: "Status",
        type: "status",
        accessor: (r) => r.status,
      },
      {
        id: "grand_total",
        label: "Total",
        type: "currency",
        accessor: (r) => r.grand_total,
      },
      {
        id: "per_received",
        label: "% Received",
        type: "number",
        accessor: (r) => r.per_received,
      },
      {
        id: "per_billed",
        label: "% Billed",
        type: "number",
        accessor: (r) => r.per_billed,
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        description="Track all open and completed purchase orders."
        actions={
          <ExportButton
            module="Purchase Orders"
            filenamePrefix="Purchase_Orders"
            columns={exportColumns}
            rows={sortedRows}
          />
        }
      />

      <FilterBar>
        <FilterField label="Search" className="min-w-[220px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="PO number…"
          />
        </FilterField>
        <FilterField label="Status" className="min-w-[160px]">
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as PurchaseOrderStatus | "")
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
        <FilterField label="Supplier" className="min-w-[200px]">
          <select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="select-field"
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.name} value={s.name}>
                {s.supplier_name ?? s.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="From" className="min-w-[150px]">
          <div className="relative">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input-field pr-9"
            />
            <Calendar className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          </div>
        </FilterField>
        <FilterField label="To" className="min-w-[150px]">
          <div className="relative">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input-field pr-9"
            />
            <Calendar className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          </div>
        </FilterField>
      </FilterBar>

      <div className="table-shell">
        {isLoading ? (
          <TableSkeleton rows={6} columns={8} />
        ) : isError ? (
          <ConnectionError
            title="Could not load purchase orders"
            error={error}
            onRetry={() => refetch()}
          />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={FileCheck2}
            title="No purchase orders"
            description="Purchase Orders are created from approved RFQs. Check your Dashboard for RFQs ready for PO creation."
          />
        ) : (
          <ResponsiveTable
            rows={sortedRows}
            rowKey={(po) => po.name}
            onRowClick={(po) => navigate(`/p2p/purchase-orders/${po.name}`)}
            columns={[
              {
                key: "name",
                header: "PO Number",
                render: (po: PurchaseOrder) => po.name,
              },
              {
                key: "supplier",
                header: "Supplier",
                render: (po: PurchaseOrder) => po.supplier_name ?? po.supplier,
              },
              {
                key: "date",
                header: "Date",
                render: (po: PurchaseOrder) => formatDate(po.transaction_date),
              },
              {
                key: "status",
                header: "Status",
                render: (po: PurchaseOrder) => (
                  <StatusBadge status={po.status ?? "Draft"} />
                ),
              },
              {
                key: "total",
                header: "Total",
                render: (po: PurchaseOrder) => formatCurrency(po.grand_total),
              },
              {
                key: "received",
                header: "% Received",
                render: (po: PurchaseOrder) => `${po.per_received ?? 0}%`,
              },
              {
                key: "billed",
                header: "% Billed",
                render: (po: PurchaseOrder) => `${po.per_billed ?? 0}%`,
              },
            ]}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-neutral-300 text-primary focus:ring-primary/30"
                      aria-label="Select all"
                    />
                  </th>
                  <SortableTableHeader
                    label="PO Number"
                    sortKey="name"
                    sort={sort}
                    onSort={setSort}
                  />
                  <SortableTableHeader
                    label="Supplier"
                    sortKey="supplier"
                    sort={sort}
                    onSort={setSort}
                  />
                  <SortableTableHeader
                    label="Date"
                    sortKey="date"
                    sort={sort}
                    onSort={setSort}
                  />
                  <SortableTableHeader
                    label="Status"
                    sortKey="status"
                    sort={sort}
                    onSort={setSort}
                  />
                  <SortableTableHeader
                    label="Total"
                    sortKey="total"
                    sort={sort}
                    onSort={setSort}
                    className="text-right"
                  />
                  <SortableTableHeader
                    label="% Received"
                    sortKey="received"
                    sort={sort}
                    onSort={setSort}
                    className="w-[140px]"
                  />
                  <SortableTableHeader
                    label="% Billed"
                    sortKey="billed"
                    sort={sort}
                    onSort={setSort}
                    className="w-[140px]"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((po: PurchaseOrder) => (
                  <tr
                    key={po.name}
                    onClick={() => navigate(`/p2p/purchase-orders/${po.name}`)}
                    className="cursor-pointer"
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(po.name)}
                        onChange={() => toggleOne(po.name)}
                        className="h-4 w-4 rounded border-neutral-300 text-primary focus:ring-primary/30"
                        aria-label={`Select ${po.name}`}
                      />
                    </td>
                    <td>
                      <span className="table-link">{po.name}</span>
                    </td>
                    <td className="text-neutral-600">
                      {po.supplier_name ?? po.supplier}
                    </td>
                    <td className="text-neutral-600">
                      {formatDate(po.transaction_date)}
                    </td>
                    <td>
                      <StatusBadge status={po.status ?? "Draft"} />
                    </td>
                    <td className="text-right font-medium tabular-nums">
                      {formatCurrency(po.grand_total)}
                    </td>
                    <td>
                      <ProgressCell value={po.per_received ?? 0} />
                    </td>
                    <td>
                      <ProgressCell value={po.per_billed ?? 0} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
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
    </div>
  );
}
