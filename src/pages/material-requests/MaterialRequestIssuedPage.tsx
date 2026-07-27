import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  getMaterialRequestWorkflowStatus,
  listMaterialRequestsWorkflow,
} from "../../api/materialRequestWorkflow";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import Pagination from "../../components/ui/Pagination";
import { useClientPagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";
import { todayERPNextDate } from "../../utils/erpNextDate";

export default function MaterialRequestIssuedPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "issued";
  const today = todayERPNextDate();

  const { data = [], isLoading } = useQuery({
    queryKey: ["mr-issued", tab],
    queryFn: () => listMaterialRequestsWorkflow({ limit: 200 }),
  });

  const rows = useMemo(
    () =>
      data.filter((mr) => {
        const st = getMaterialRequestWorkflowStatus(mr);
        const modifiedToday = (mr.modified ?? "").startsWith(today);
        if (tab === "forwarded") {
          return st === "Forwarded to Procurement" && modifiedToday;
        }
        return (
          (st === "Completed" || st === "Material Issued") && modifiedToday
        );
      }),
    [data, tab, today],
  );

  const {
    pageRows,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(rows, { resetKey: tab });

  return (
    <div>
      <PageHeader
        title="Issued Materials"
        description={
          tab === "forwarded"
            ? "Material requests forwarded to procurement today."
            : "Material issued from stock today."
        }
      />

      <div className="mb-4 flex gap-2">
        <TabLink active={tab !== "forwarded"} to="/material-requests/issued">
          Issued Today
        </TabLink>
        <TabLink
          active={tab === "forwarded"}
          to="/material-requests/issued?tab=forwarded"
        >
          Forwarded Today
        </TabLink>
      </div>

      <div className="card overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-3 text-left">MR Number</th>
              <th className="px-4 py-3 text-left">Department</th>
              <th className="px-4 py-3 text-left">Modified</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                  No records for today.
                </td>
              </tr>
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
                  <td className="px-4 py-3">{mr.custom_department ?? "—"}</td>
                  <td className="px-4 py-3">{formatDate(mr.modified)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={getMaterialRequestWorkflowStatus(mr)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!isLoading && rows.length > 0 && (
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

function TabLink({
  active,
  to,
  children,
}: {
  active: boolean;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold no-underline ${
        active
          ? "bg-primary-600 text-white"
          : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
      }`}
    >
      {children}
    </Link>
  );
}
