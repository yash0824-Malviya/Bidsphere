import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackagePlus, Plus } from "lucide-react";

import { getPurchaseReceipt, getPurchaseReceipts } from "../../api/purchasing";
import type { Filter } from "../../api/erpnext";
import type {
  PurchaseReceipt,
  PurchaseReceiptStatus,
} from "../../types/erpnext";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import PdfActions from "../../components/PdfActions";
import UpcomingDeliveriesPanel from "../../components/warehouse/UpcomingDeliveriesPanel";
import { buildGrnPdf, grnPdfFilename } from "../../utils/pdf/grnPdf";
import { canCreateGRN } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { FilterBar, FilterField, SearchInput, SortableTableHeader } from "../../components/ui";
import { useListSort } from "../../hooks/useListSort";
import { useDebounce } from "../../hooks/useDebounce";
import {
  GRN_DEFAULT_SORT,
  grnComparators,
  sortNewestFirst,
} from "../../utils/listSort";
import { formatCurrency, formatDate } from "../../utils/format";

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
  // GRN creation belongs to Warehouse operations. Procurement (and Finance)
  // use this screen purely to track receipt progress — no creation actions.
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

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["purchase-receipts", filters],
    queryFn: () =>
      getPurchaseReceipts({
        filters,
        fields: [
          "name",
          "supplier",
          "supplier_name",
          "posting_date",
          "creation",
          "status",
          "grand_total",
          "currency",
          "total_qty",
        ],
        order_by: "posting_date desc, creation desc, name desc",
        limit_page_length: 100,
      }),
  });

  const normalizedRows = useMemo(
    () =>
      sortNewestFirst(rows, {
        date: (g) => g.posting_date,
        creation: (g) => g.creation,
        name: (g) => g.name,
      }),
    [rows]
  );

  const { sort, setSort, sortedRows } = useListSort(
    normalizedRows,
    GRN_DEFAULT_SORT,
    GRN_COMPARATORS
  );

  return (
    <div>
      <PageHeader
        title={canCreate ? "Goods Receipt Notes" : "Track Goods Receipts"}
        description={
          canCreate
            ? "Receive inbound deliveries and record goods receipts against open purchase orders."
            : "Monitor warehouse receipt records and view receipt status against open purchase orders."
        }
        actions={
          canCreate ? (
            <Link to="/p2p/grn/new" className="btn-primary">
              <Plus className="h-4 w-4" /> New GRN
            </Link>
          ) : undefined
        }
      />

      {/* Upcoming Deliveries is a Warehouse receiving tool — hidden from
          Finance (and anyone else) who only view GRN records read-only. */}
      {canCreate && <UpcomingDeliveriesPanel />}

      <FilterBar>
        <FilterField label="Search" className="min-w-[220px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="GRN number…"
          />
        </FilterField>
        <FilterField label="Status" className="min-w-[160px]">
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

      <div className="table-shell">
        {isLoading ? (
          <TableSkeleton rows={6} columns={5} />
        ) : isError ? (
          <EmptyState
            icon={PackagePlus}
            title="Could not load goods receipts"
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
                    <td>
                      <StatusBadge status={g.status ?? "Draft"} />
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
      </div>
    </div>
  );
}
