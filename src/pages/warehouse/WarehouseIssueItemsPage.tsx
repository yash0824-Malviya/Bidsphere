import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";

import { getPendingMaterialRequests } from "../../services/warehouseService";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import Pagination from "../../components/ui/Pagination";
import { SearchInput } from "../../components/ui";
import { useClientPagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";

type RowStatus = "Available" | "Partial Stock" | "Out of Stock";

interface ReadyRow {
  mrName: string;
  department: string;
  requiredDate: string;
  itemCode: string;
  description: string;
  uom: string;
  requiredQty: number;
  availableQty: number;
  status: RowStatus;
}

function stockTone(status: RowStatus): "success" | "warning" | "danger" {
  if (status === "Available") return "success";
  if (status === "Partial Stock") return "warning";
  return "danger";
}

/**
 * Ready to Issue — flatten pending MRs to issueable lines.
 * Issue opens the dedicated Material Issue page (does not alter Procurement).
 */
export default function WarehouseIssueItemsPage() {
  const [search, setSearch] = useState("");

  const pendingQuery = useQuery({
    queryKey: ["warehouse", "pending-requests"],
    queryFn: getPendingMaterialRequests,
    retry: false,
  });

  const rows = useMemo<ReadyRow[]>(() => {
    const data = pendingQuery.data ?? [];
    const flat: ReadyRow[] = [];
    for (const mr of data) {
      for (const item of mr.items ?? []) {
        const availableQty = Math.max(0, Number(item.available_qty) || 0);
        const requiredQty = Math.max(0, Number(item.required_qty) || 0);
        // Show lines that are part of MRs with any stock — include Out of Stock
        // siblings so the Issue page can show the full picture. Skip MRs with
        // zero stock on every line.
        flat.push({
          mrName: mr.name,
          department: mr.department || "—",
          requiredDate: mr.required_date,
          itemCode: item.item_code,
          description: item.description || item.item_code,
          uom: item.uom || "Nos",
          requiredQty,
          availableQty,
          status:
            availableQty <= 0
              ? "Out of Stock"
              : availableQty >= requiredQty
                ? "Available"
                : "Partial Stock",
        });
      }
    }
    // Keep only MRs that have at least one line with stock.
    const mrsWithStock = new Set(
      flat.filter((r) => r.availableQty > 0).map((r) => r.mrName),
    );
    const ready = flat.filter((r) => mrsWithStock.has(r.mrName));

    const q = search.trim().toLowerCase();
    if (!q) return ready;
    return ready.filter(
      (r) =>
        r.mrName.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.itemCode.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }, [pendingQuery.data, search]);

  // One Issue action per MR (not per line).
  const mrActions = useMemo(() => {
    const map = new Map<string, ReadyRow[]>();
    for (const r of rows) {
      const list = map.get(r.mrName) ?? [];
      list.push(r);
      map.set(r.mrName, list);
    }
    return map;
  }, [rows]);

  const {
    pageRows,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(rows, { resetKey: search });

  if (pendingQuery.isError) {
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load Ready to Issue list."
            description="We couldn't retrieve pending material requests. Please try again."
            onRetry={() => void pendingQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Ready to Issue"
        description="Material Requests with stock available for warehouse issue."
      />

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by MR number, department, or item…"
          />
        </div>
        <p className="text-[12px] text-slate-500">
          {mrActions.size} request(s) · {rows.length} line(s)
        </p>
      </div>

      <div className="flex min-h-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {pendingQuery.isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={6} columns={8} />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <EmptyState
              icon={PackageCheck}
              title="Nothing ready to issue"
              description={
                search
                  ? "Adjust your search terms."
                  : "No pending requests currently have stock on hand to issue."
              }
            />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>MR Number</th>
                    <th>Department</th>
                    <th>Item</th>
                    <th className="text-right">Available Qty</th>
                    <th className="text-right">Required Qty</th>
                    <th className="text-center">Status</th>
                    <th>Required Date</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, idx) => {
                    const isFirstOfMr =
                      idx === 0 || pageRows[idx - 1]?.mrName !== r.mrName;
                    return (
                      <tr key={`${r.mrName}__${r.itemCode}`}>
                        <td>
                          {isFirstOfMr ? (
                            <Link
                              to={`/warehouse/issue-items/${encodeURIComponent(r.mrName)}`}
                              className="table-link no-underline"
                            >
                              {r.mrName}
                            </Link>
                          ) : (
                            <span className="text-slate-300">⋮</span>
                          )}
                        </td>
                        <td className="text-slate-600">
                          {isFirstOfMr ? r.department : ""}
                        </td>
                        <td>
                          <div className="font-medium text-slate-900">
                            {r.itemCode}
                          </div>
                          <div className="text-xs text-slate-500">
                            {r.description}
                          </div>
                        </td>
                        <td className="text-right font-semibold tabular-nums text-slate-800">
                          {r.availableQty}{" "}
                          <span className="text-xs font-normal text-slate-400">
                            {r.uom}
                          </span>
                        </td>
                        <td className="text-right tabular-nums text-slate-600">
                          {r.requiredQty}{" "}
                          <span className="text-xs text-slate-400">{r.uom}</span>
                        </td>
                        <td className="text-center">
                          <StatusBadge status={r.status} tone={stockTone(r.status)} />
                        </td>
                        <td className="tabular-nums text-slate-600">
                          {isFirstOfMr ? formatDate(r.requiredDate) : ""}
                        </td>
                        <td className="text-right">
                          {isFirstOfMr ? (
                            <Link
                              to={`/warehouse/issue-items/${encodeURIComponent(r.mrName)}`}
                              className="btn-primary no-underline"
                            >
                              <PackageCheck className="h-4 w-4" />
                              Issue
                            </Link>
                          ) : null}
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
              recordLabel="lines"
            />
          </>
        )}
      </div>
    </div>
  );
}
