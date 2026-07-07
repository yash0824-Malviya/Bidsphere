import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, Search } from "lucide-react";

import { getPendingMaterialRequests } from "../../services/warehouseService";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";
import { formatDate } from "../../utils/format";

interface ReadyRow {
  mrName: string;
  department: string;
  requiredDate: string;
  itemCode: string;
  description: string;
  uom: string;
  requiredQty: number;
  availableQty: number;
  issueQty: number;
  status: "Available" | "Partial Stock";
}

/**
 * Issue Items · Ready to Issue — a module dedicated to physically issuing stock
 * that the warehouse has confirmed available. It flattens every pending
 * Material Request into per-item rows that have stock on hand. The actual Stock
 * Entry (ERPNext) is created on the review screen, so this list links each row
 * to "Issue" there — no duplicate issuing logic, no changed ERPNext flow.
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
        const availableQty = Number(item.available_qty) || 0;
        if (availableQty <= 0) continue; // nothing on hand → not ready to issue
        const requiredQty = Number(item.required_qty) || 0;
        flat.push({
          mrName: mr.name,
          department: mr.department || "—",
          requiredDate: mr.required_date,
          itemCode: item.item_code,
          description: item.description || item.item_code,
          uom: item.uom || "Nos",
          requiredQty,
          availableQty,
          issueQty: Math.min(requiredQty, availableQty),
          status: availableQty >= requiredQty ? "Available" : "Partial Stock",
        });
      }
    }
    const q = search.trim().toLowerCase();
    if (!q) return flat;
    return flat.filter(
      (r) =>
        r.mrName.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.itemCode.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }, [pendingQuery.data, search]);

  if (pendingQuery.isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
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
      </div>

      <div className="flex min-h-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {pendingQuery.isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={6} columns={7} />
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
                  <th className="px-6 py-4">MR Number</th>
                  <th className="px-6 py-4">Department</th>
                  <th className="px-6 py-4">Item</th>
                  <th className="px-6 py-4 text-right">Issue Qty</th>
                  <th className="px-6 py-4">Required Date</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {rows.map((r) => (
                  <tr
                    key={`${r.mrName}__${r.itemCode}`}
                    className="transition-colors hover:bg-slate-50/75"
                  >
                    <td className="px-6 py-4">
                      <Link
                        to={`/warehouse/material-requests/review/${encodeURIComponent(r.mrName)}`}
                        className="font-semibold text-primary no-underline hover:underline"
                      >
                        {r.mrName}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{r.department}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">
                        {r.itemCode}
                      </div>
                      <div className="text-xs text-slate-500">
                        {r.description}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-semibold tabular-nums text-emerald-700">
                      {r.issueQty} {r.uom}
                    </td>
                    <td className="px-6 py-4 tabular-nums text-slate-600">
                      {formatDate(r.requiredDate)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          r.status === "Available"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-orange-200 bg-orange-50 text-orange-700"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/warehouse/material-requests/review/${encodeURIComponent(r.mrName)}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-white no-underline shadow-sm hover:brightness-110"
                      >
                        <PackageCheck className="h-4 w-4" />
                        Issue
                      </Link>
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
