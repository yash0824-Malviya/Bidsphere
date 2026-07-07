import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileSearch, Search } from "lucide-react";

import { fetchProcurementQueue } from "../../api/materialRequestWorkflow";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";
import { ItemStatusBadge } from "../../components/material-requests/FulfillmentUI";
import { computeRequestFulfillment } from "../../utils/materialRequestFulfillment";

interface ShortageRow {
  mrName: string;
  department: string;
  itemCode: string;
  itemName: string;
  requested: number;
  issued: number;
  remaining: number;
  forwardQty: number;
  status: "Partial" | "Procurement" | "Issued" | "Pending Review";
  rfqId: string | null;
}

/**
 * Procurement Required — the warehouse's read-only view of shortage items it
 * forwarded to Procurement. One row per shortage line (procurement qty > 0).
 * The warehouse never creates RFQs (that is a Procurement action), so each row
 * links to the RFQ once Procurement has created it.
 */
export default function WarehouseForwardedRequestsPage() {
  const [search, setSearch] = useState("");

  const queueQuery = useQuery({
    queryKey: ["mr-procurement-queue", "warehouse"],
    queryFn: fetchProcurementQueue,
    retry: false,
  });

  const rows = useMemo<ShortageRow[]>(() => {
    const data = queueQuery.data ?? [];
    const flat: ShortageRow[] = [];
    for (const mr of data) {
      const fulfillment = computeRequestFulfillment(mr);
      const rfqId = mr.custom_linked_rfq ?? null;
      for (const it of fulfillment.items) {
        if (it.procurement <= 0) continue; // only shortage lines
        flat.push({
          mrName: mr.name,
          department: mr.custom_department ?? "—",
          itemCode: it.item_code,
          itemName: it.item_name,
          requested: it.requested,
          issued: it.issued,
          remaining: it.remaining,
          forwardQty: it.procurement,
          status: it.status,
          rfqId,
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
        r.itemName.toLowerCase().includes(q),
    );
  }, [queueQuery.data, search]);

  if (queueQuery.isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load Procurement Required list."
            description="We couldn't retrieve the forwarded shortage items. Please try again."
            onRetry={() => void queueQuery.refetch()}
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
        {queueQuery.isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={6} columns={8} />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <EmptyState
              icon={FileSearch}
              title="No shortages forwarded"
              description={
                search
                  ? "Adjust your search terms."
                  : "No material request shortages have been forwarded to procurement."
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
                  <th className="px-6 py-4 text-right">Requested</th>
                  <th className="px-6 py-4 text-right">Issued</th>
                  <th className="px-6 py-4 text-right">Remaining</th>
                  <th className="px-6 py-4 text-right">Forward Qty</th>
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
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      {r.mrName}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{r.department}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">
                        {r.itemCode}
                      </div>
                      <div className="text-xs text-slate-500">{r.itemName}</div>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-slate-700">
                      {r.requested}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-emerald-700">
                      {r.issued}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-orange-700">
                      {r.remaining}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold tabular-nums text-blue-700">
                      {r.forwardQty}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <ItemStatusBadge status={r.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      {r.rfqId ? (
                        <Link
                          to={`/sourcing/rfq/${encodeURIComponent(r.rfqId)}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 no-underline shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50"
                        >
                          View RFQ
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                          Awaiting RFQ
                        </span>
                      )}
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
