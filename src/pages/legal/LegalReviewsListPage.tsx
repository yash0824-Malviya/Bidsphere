import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getLegalDocsByStatus } from "../../api/legalDocs";
import type { LegalDocumentSet } from "../../api/legalDocs";
import { formatDate } from "../../utils/format";
import {
  Gavel,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Loader2,
} from "lucide-react";

type StatusFilter = "Pending" | "Approved" | "Rejected";

const STATUS_ORDER_BY: Record<StatusFilter, string> = {
  Pending: "modified desc",
  Approved: "approved_on desc",
  Rejected: "approved_on desc",
};

export default function LegalReviewsListPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Pending");

  // Each tab is backed by its OWN dedicated ERPNext query — switching tabs
  // changes the query key, which triggers a fresh
  // `WHERE review_status = "<tab>"` fetch against `tabLegal Document
  // Review`. staleTime: 0 + refetchOnMount "always" guarantee every visit
  // (including from a different device/browser) reflects the current
  // ERPNext state — no cached browser state is ever authoritative.
  const pendingQuery = useQuery<LegalDocumentSet[]>({
    queryKey: ["legal-document-reviews", "Pending"],
    queryFn: () => getLegalDocsByStatus({ status: "Pending", orderBy: STATUS_ORDER_BY.Pending }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const approvedQuery = useQuery<LegalDocumentSet[]>({
    queryKey: ["legal-document-reviews", "Approved"],
    queryFn: () => getLegalDocsByStatus({ status: "Approved", orderBy: STATUS_ORDER_BY.Approved }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const rejectedQuery = useQuery<LegalDocumentSet[]>({
    queryKey: ["legal-document-reviews", "Rejected"],
    queryFn: () => getLegalDocsByStatus({ status: "Rejected", orderBy: STATUS_ORDER_BY.Rejected }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const queriesByStatus = {
    Pending: pendingQuery,
    Approved: approvedQuery,
    Rejected: rejectedQuery,
  } as const;

  const activeQuery = queriesByStatus[statusFilter];
  const filteredDocs = activeQuery.data ?? [];
  const isLoading = activeQuery.isLoading;
  const isError = activeQuery.isError;
  const error = activeQuery.error;

  const counts = {
    Pending: pendingQuery.data?.length ?? 0,
    Approved: approvedQuery.data?.length ?? 0,
    Rejected: rejectedQuery.data?.length ?? 0,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <Gavel className="h-6 w-6 text-primary-600" />
            Legal Reviews
          </h1>
          <p className="text-sm text-neutral-500">
            Every supplier quotation with submitted legal and compliance documents.
          </p>
        </div>

        <div className="flex gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
          {(["Pending", "Approved", "Rejected"] as StatusFilter[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                statusFilter === status
                  ? "bg-white text-primary-700 shadow-sm ring-1 ring-neutral-200"
                  : "text-neutral-500 hover:text-neutral-700"
              }`}
            >
              {status} ({counts[status]})
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading legal reviews…
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-danger-200 bg-danger-50 py-16 text-center">
          <XCircle className="mb-3 h-10 w-10 text-danger-400" />
          <p className="text-sm font-semibold text-danger-700">Failed to load legal reviews</p>
          <p className="mt-1 max-w-md text-xs text-danger-600">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 text-center shadow-sm">
          <FileText className="mb-3 h-10 w-10 text-neutral-400" />
          <p className="text-sm font-semibold text-neutral-700">
            No {statusFilter.toLowerCase()} reviews
          </p>
          <p className="mt-1 text-xs text-neutral-500 max-w-md">
            When suppliers submit legal documents (Terms, Warranty, Insurance) with their
            quotations, they will appear here automatically for review.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm text-neutral-500">
              <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-wider text-neutral-700 border-b border-neutral-200">
                <tr>
                  <th className="px-6 py-4">Supplier</th>
                  <th className="px-6 py-4">Supplier Quotation</th>
                  <th className="px-6 py-4">RFQ</th>
                  <th className="px-6 py-4">Submission Date</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Company</th>
                  <th className="px-6 py-4">Procurement Manager</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 bg-white">
                {filteredDocs.map((doc) => (
                  <tr
                    key={doc.name ?? doc.sq_name}
                    onClick={() => navigate(`/legal/review/${encodeURIComponent(doc.sq_name)}`)}
                    className="hover:bg-neutral-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 font-medium text-neutral-900">
                      {doc.supplier}
                    </td>
                    <td className="px-6 py-4 font-semibold text-neutral-900">
                      {doc.sq_name}
                    </td>
                    <td className="px-6 py-4 text-neutral-600">
                      {doc.rfq_name || "—"}
                    </td>
                    <td className="px-6 py-4 text-neutral-600">
                      {doc.submission_date ? formatDate(doc.submission_date) : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <StatusPill status={doc.review_status} />
                    </td>
                    <td className="px-6 py-4 text-neutral-600">{doc.company || "—"}</td>
                    <td className="px-6 py-4 text-neutral-600">
                      {doc.procurement_manager || "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700"
                      >
                        Review
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: LegalDocumentSet["review_status"] }) {
  const config = {
    Approved: { bg: "#dcfce7", fg: "#15803d", Icon: CheckCircle2 },
    Rejected: { bg: "#fee2e2", fg: "#dc2626", Icon: XCircle },
    Pending: { bg: "#fef3c7", fg: "#92400e", Icon: Clock },
  } as const;
  const { bg, fg, Icon } = config[status] ?? config.Pending;

  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: "20px",
        fontSize: "12px",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        background: bg,
        color: fg,
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}
