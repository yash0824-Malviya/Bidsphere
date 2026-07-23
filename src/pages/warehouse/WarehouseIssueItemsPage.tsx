import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, Search } from "lucide-react";

import { getPendingMaterialRequests } from "../../services/warehouseService";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
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

function StatusPill({ status }: { status: RowStatus }) {
  const cls =
    status === "Available"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "Partial Stock"
        ? "border-orange-200 bg-orange-50 text-orange-700"
        : "border-rose-200 bg-rose-50 text-rose-700";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {status}
    </span>
  );
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
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by MR number, department, or item…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
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
          <div className="flex-1 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3.5">MR Number</th>
                  <th className="px-5 py-3.5">Department</th>
                  <th className="px-5 py-3.5">Item</th>
                  <th className="px-5 py-3.5 text-right">Available Qty</th>
                  <th className="px-5 py-3.5 text-right">Required Qty</th>
                  <th className="px-5 py-3.5 text-center">Status</th>
                  <th className="px-5 py-3.5">Required Date</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {rows.map((r, idx) => {
                  const isFirstOfMr =
                    idx === 0 || rows[idx - 1]?.mrName !== r.mrName;
                  return (
                    <tr
                      key={`${r.mrName}__${r.itemCode}`}
                      className="transition-colors hover:bg-slate-50/75"
                    >
                      <td className="px-5 py-3.5">
                        {isFirstOfMr ? (
                          <Link
                            to={`/warehouse/issue-items/${encodeURIComponent(r.mrName)}`}
                            className="font-semibold text-primary no-underline hover:underline"
                          >
                            {r.mrName}
                          </Link>
                        ) : (
                          <span className="text-slate-300">⋮</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {isFirstOfMr ? r.department : ""}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-900">
                          {r.itemCode}
                        </div>
                        <div className="text-xs text-slate-500">
                          {r.description}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-slate-800">
                        {r.availableQty}{" "}
                        <span className="text-xs font-normal text-slate-400">
                          {r.uom}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-slate-600">
                        {r.requiredQty}{" "}
                        <span className="text-xs text-slate-400">{r.uom}</span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-5 py-3.5 tabular-nums text-slate-600">
                        {isFirstOfMr ? formatDate(r.requiredDate) : ""}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {isFirstOfMr ? (
                          <Link
                            to={`/warehouse/issue-items/${encodeURIComponent(r.mrName)}`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-white no-underline shadow-sm hover:brightness-110"
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
        )}
      </div>
    </div>
  );
}
