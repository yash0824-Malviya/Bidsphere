import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, FileText } from "lucide-react";
import toast from "react-hot-toast";

import {
  deriveSupplierRfpFacingStatus,
  getSupplierRfpAssignment,
  getSupplierRFPs,
  resolvePortalSupplierIdForRfp,
  type SupplierRfpListRow,
} from "../../api/rfp";
import { openErpFileInBrowser } from "../../api/legalDocsStorage";
import EmptyState from "../../components/EmptyState";
import PaginationBar from "../../components/PaginationBar";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import ConnectionError from "../../components/ConnectionError";
import SupplierBreadcrumb from "../../components/supplier-portal/SupplierBreadcrumb";
import { useClientPagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import type { SupplierRfpFacingStatus } from "../../types/rfp";

const LOG = "[SupplierPortal:RFP]";

async function downloadSubmittedProposal(
  row: SupplierRfpListRow,
  supplierId: string,
): Promise<void> {
  try {
    const { response } = await getSupplierRfpAssignment(row.name, supplierId);
    const docs = (response.documents ?? []).filter((d) => d.file?.file_url);
    if (!docs.length) {
      toast.error("No submitted proposal files are available to download.");
      return;
    }
    for (const doc of docs) {
      await openErpFileInBrowser(doc.file.file_url, {
        mode: "download",
        fileName: doc.file.file_name || "proposal-document",
      });
    }
    toast.success(
      docs.length === 1
        ? "Download started."
        : `Downloading ${docs.length} files…`,
    );
  } catch (err) {
    toast.error(
      err instanceof Error
        ? err.message
        : "Could not download submitted proposal.",
    );
  }
}

export default function SupplierRFPsPage() {
  const { erpSupplierName, isReady, session } = useSupplierSession();

  const supplierQuery = useQuery({
    queryKey: [
      "supplier-portal-rfp-supplier-id",
      erpSupplierName,
      session?.linkedSupplier,
    ],
    enabled: isReady && !!erpSupplierName,
    queryFn: async () => {
      const linked = String(session?.linkedSupplier || "").trim();
      const candidate = linked || erpSupplierName;
      const resolved = await resolvePortalSupplierIdForRfp(candidate);
      // eslint-disable-next-line no-console
      console.log(LOG, "Resolved portal supplier", {
        linked_supplier: linked || "(none)",
        session_supplier: erpSupplierName,
        resolved_supplier: resolved,
      });
      return resolved;
    },
    staleTime: 5 * 60_000,
  });

  const resolvedSupplier = supplierQuery.data ?? "";

  const listQuery = useQuery({
    queryKey: ["supplier-portal-rfps", resolvedSupplier],
    enabled: !!resolvedSupplier,
    queryFn: () => getSupplierRFPs(resolvedSupplier),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const rows = listQuery.data ?? [];

  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    totalRecords,
    totalPages,
    pageRows,
  } = useClientPagination(rows, {
    defaultPageSize: 10,
    resetKey: resolvedSupplier,
  });

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<SupplierRfpFacingStatus, number>> = {};
    for (const row of rows) {
      const facing = deriveSupplierRfpFacingStatus(row);
      counts[facing] = (counts[facing] || 0) + 1;
    }
    return counts;
  }, [rows]);

  useEffect(() => {
    if (!listQuery.isSuccess) return;
    // eslint-disable-next-line no-console
    console.log(LOG, "My RFPs page render", {
      resolved_supplier: resolvedSupplier,
      assigned_rfp_count: rows.length,
      names: rows.map((r) => r.name),
      facing: rows.map((r) => ({
        name: r.name,
        facing: deriveSupplierRfpFacingStatus(r),
      })),
      status_counts: statusCounts,
    });
  }, [listQuery.isSuccess, resolvedSupplier, rows, statusCounts]);

  const loading =
    !isReady ||
    supplierQuery.isLoading ||
    (!!resolvedSupplier && listQuery.isLoading);

  return (
    <div className="flex w-full flex-col gap-6">
      <SupplierBreadcrumb
        items={[
          { label: "Dashboard", to: "/supplier/dashboard" },
          { label: "RFPs" },
        ]}
      />

      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
          My RFPs
          {!loading ? (
            <span className="ml-2 inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 align-middle text-xs font-semibold text-primary-700 ring-1 ring-inset ring-primary-100">
              {rows.length}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-[13px] text-[#64748B]">
          Every Request for Proposal assigned to your company — including
          submitted proposals.
        </p>
      </header>

      <div className="table-shell">
        {loading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : supplierQuery.isError || listQuery.isError ? (
          <ConnectionError
            title="Could not load RFPs"
            error={supplierQuery.error || listQuery.error}
            onRetry={() => {
              void supplierQuery.refetch();
              void listQuery.refetch();
            }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No RFPs assigned"
            description="When procurement publishes a Request for Proposal and invites your company, it will appear here."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>RFP Number</th>
                    <th>Title</th>
                    <th>Deadline</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((rfp) => {
                    const facing = deriveSupplierRfpFacingStatus(rfp);
                    const submitted =
                      facing === "Submitted" ||
                      facing === "Under Review" ||
                      facing === "Awarded" ||
                      facing === "Rejected" ||
                      facing === "Clarification Requested";
                    return (
                      <tr key={rfp.name}>
                        <td>
                          <Link
                            to={`/supplier/rfps/${encodeURIComponent(rfp.name)}`}
                            className="table-link"
                          >
                            {rfp.name}
                          </Link>
                        </td>
                        <td className="max-w-[240px] truncate font-medium text-neutral-900">
                          {rfp.title}
                        </td>
                        <td>{formatDate(rfp.submission_deadline, "d MMM yyyy")}</td>
                        <td>
                          <StatusBadge status={facing} />
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {submitted ? (
                              <>
                                <Link
                                  to={`/supplier/rfps/${encodeURIComponent(rfp.name)}`}
                                  className="btn-secondary no-underline"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  View Submission
                                </Link>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void downloadSubmittedProposal(
                                      rfp,
                                      resolvedSupplier,
                                    );
                                  }}
                                  className="btn-secondary"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  Download
                                </button>
                              </>
                            ) : (
                              <Link
                                to={`/supplier/rfps/${encodeURIComponent(rfp.name)}`}
                                className="btn-primary no-underline"
                              >
                                Open
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              totalRecords={totalRecords}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              recordLabel="records"
            />
          </>
        )}
      </div>
    </div>
  );
}
