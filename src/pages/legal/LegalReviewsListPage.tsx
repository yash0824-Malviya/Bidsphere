import { useNavigate } from "react-router-dom";
import { getAllLegalDocs } from "../../api/legalDocs";
import {
  Gavel,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react";

export default function LegalReviewsListPage() {
  const navigate = useNavigate();
  const allDocs = getAllLegalDocs();

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <Gavel className="h-6 w-6 text-primary-600" />
            All Legal Reviews
          </h1>
          <p className="text-sm text-neutral-500">
            List of all supplier quotations with submitted legal and compliance documents.
          </p>
        </div>
      </div>

      {allDocs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 text-center shadow-sm">
          <FileText className="mb-3 h-10 w-10 text-neutral-400" />
          <p className="text-sm font-semibold text-neutral-700">No legal documents submitted yet</p>
          <p className="mt-1 text-xs text-neutral-500 max-w-md">
            When suppliers submit legal documents (Terms, Warranty, Insurance) with their quotations, they will appear here for review.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm text-neutral-500">
              <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-wider text-neutral-700 border-b border-neutral-200">
                <tr>
                  <th className="px-6 py-4">SQ Name</th>
                  <th className="px-6 py-4">Supplier</th>
                  <th className="px-6 py-4">RFQ Name</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Submitted At</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 bg-white">
                {allDocs.map((doc) => (
                  <tr
                    key={doc.sq_name}
                    onClick={() => {
                      // eslint-disable-next-line no-console
                      console.log('[Navigation] Navigating to legal review with ID:', doc.sq_name)
                      navigate(`/legal/review/${doc.sq_name}`)
                    }}
                    className="hover:bg-neutral-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 font-semibold text-neutral-900">
                      {doc.sq_name}
                    </td>
                    <td className="px-6 py-4 text-neutral-700">
                      {doc.supplier}
                    </td>
                    <td className="px-6 py-4 text-neutral-600">
                      {doc.rfq_name || "—"}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        style={{
                          padding: "4px 10px",
                          borderRadius: "20px",
                          fontSize: "12px",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          background:
                            doc.review_status === "approved"
                              ? "#dcfce7"
                              : doc.review_status === "rejected"
                              ? "#fee2e2"
                              : "#fef3c7",
                          color:
                            doc.review_status === "approved"
                              ? "#15803d"
                              : doc.review_status === "rejected"
                              ? "#dc2626"
                              : "#92400e",
                        }}
                      >
                        {doc.review_status === "approved" && (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        {doc.review_status === "rejected" && (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        {doc.review_status === "pending" && (
                          <Clock className="h-3.5 w-3.5" />
                        )}
                        {doc.review_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-neutral-600">
                      {doc.submitted_by_supplier_at
                        ? new Date(doc.submitted_by_supplier_at).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700"
                      >
                        Review Workspace
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
