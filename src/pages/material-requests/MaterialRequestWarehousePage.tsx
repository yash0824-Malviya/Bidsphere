import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  getMaterialRequestWorkflowStatus,
  listWarehouseMaterialRequestQueue,
} from "../../api/materialRequestWorkflow";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import Pagination from "../../components/ui/Pagination";
import { useClientPagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";

export default function MaterialRequestWarehousePage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["mr-warehouse-queue"],
    queryFn: () => listWarehouseMaterialRequestQueue(),
  });

  const {
    pageRows,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(data);

  return (
    <div>
      <PageHeader
        title="Warehouse Review Queue"
        description="Submitted material requests awaiting stock check, issue, or forward to procurement."
      />
      <div className="card overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-3 text-left">MR Number</th>
              <th className="px-4 py-3 text-left">Required Date</th>
              <th className="px-4 py-3 text-left">Department</th>
              <th className="px-4 py-3 text-left">Priority</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-500">Loading…</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-500">No pending reviews.</td></tr>
            ) : (
              pageRows.map((mr) => (
                <tr key={mr.name} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/material-requests/${encodeURIComponent(mr.name)}`}
                      className="font-semibold text-primary-600 no-underline"
                    >
                      {mr.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{formatDate(mr.schedule_date)}</td>
                  <td className="px-4 py-3">{mr.custom_department ?? "—"}</td>
                  <td className="px-4 py-3">{mr.custom_priority ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={getMaterialRequestWorkflowStatus(mr)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!isLoading && data.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            recordLabel="requests"
          />
        )}
      </div>
    </div>
  );
}
