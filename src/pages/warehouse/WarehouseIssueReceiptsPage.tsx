import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import {
  hydrateMaterialIssueReceiptsFromErp,
  listMaterialIssueReceipts,
  listPendingDepartmentReceipts,
  listPendingWarehouseReceipts,
} from "../../api/materialIssueReceipt";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import Pagination from "../../components/ui/Pagination";
import { useClientPagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";

type Mode = "all" | "pending-acceptance" | "awaiting-warehouse-sign";

/**
 * Warehouse Issue Items → Issue Receipts / Pending Department Acceptance.
 */
export default function WarehouseIssueReceiptsPage({
  mode = "all",
}: {
  mode?: Mode;
}) {
  const listQuery = useQuery({
    queryKey: ["material-issue-receipts", "warehouse", mode],
    queryFn: async () => {
      await hydrateMaterialIssueReceiptsFromErp();
      if (mode === "pending-acceptance") return listPendingDepartmentReceipts();
      if (mode === "awaiting-warehouse-sign") {
        return listPendingWarehouseReceipts();
      }
      return listMaterialIssueReceipts();
    },
    refetchOnMount: "always",
    staleTime: 0,
  });

  const rows = listQuery.data ?? [];
  const {
    pageRows,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(rows, { resetKey: mode });
  const title =
    mode === "pending-acceptance"
      ? "Pending Department Acceptance"
      : mode === "awaiting-warehouse-sign"
        ? "Awaiting Warehouse Signature"
        : "Issue Receipts";
  const description =
    mode === "pending-acceptance"
      ? "Material Issue Receipts waiting for department digital signature."
      : mode === "awaiting-warehouse-sign"
        ? "Receipts that still need the Warehouse Manager signature."
        : "All Material Issue Receipts for the Warehouse ↔ Department confirmation workflow.";

  return (
    <div className="space-y-5">
      <PageHeader title={title} description={description} />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          to="/warehouse/issue-items/receipts"
          className={`rounded-lg border px-3 py-1.5 no-underline ${
            mode === "all"
              ? "border-primary-200 bg-primary-50 text-primary-800"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          All Receipts
        </Link>
        <Link
          to="/warehouse/issue-items/pending-acceptance"
          className={`rounded-lg border px-3 py-1.5 no-underline ${
            mode === "pending-acceptance"
              ? "border-primary-200 bg-primary-50 text-primary-800"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Pending Department Acceptance
        </Link>
        <Link
          to="/warehouse/issue-items"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 no-underline hover:bg-slate-50"
        >
          Ready to Issue
        </Link>
      </div>
      <div className="rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
        {listQuery.isLoading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No material issue receipts in this view.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Receipt No.</th>
                  <th className="px-4 py-3">Stock Entry</th>
                  <th className="px-4 py-3">Material Request</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Warehouse</th>
                  <th className="px-4 py-3">Issue Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-mono font-semibold">
                      {r.issue_number}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">
                      {r.stock_entry}
                    </td>
                    <td className="px-4 py-3">{r.mr_name}</td>
                    <td className="px-4 py-3">{r.department}</td>
                    <td className="px-4 py-3">{r.warehouse}</td>
                    <td className="px-4 py-3">{formatDate(r.issue_date)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/warehouse/material-issue-receipts/${encodeURIComponent(r.issue_number)}`}
                        className="text-sm font-medium text-primary-700 hover:underline"
                      >
                        {r.status === "Waiting Warehouse Signature"
                          ? "Sign receipt"
                          : "View"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalRecords={totalRecords}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              recordLabel="receipts"
            />
          </div>
        )}
      </div>
    </div>
  );
}
