import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  FileCheck,
  PenTool,
  RefreshCw,
  Search,
} from "lucide-react";
import { canStartLegalSignature, isLegalReviewExecuted } from "../../types/legalEsign";
import { getAllLegalDocs } from "../../api/legalDocs";
import { formatDate } from "../../utils/format";
import { useDebounce } from "../../hooks/useDebounce";

interface Props {
  mode: "pending" | "completed";
}

export default function LegalEsignaturesPage({ mode }: Props) {
  const isPendingMode = mode === "pending";
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);

  const query = useQuery({
    queryKey: ["legal-esignatures-list"],
    queryFn: getAllLegalDocs,
    staleTime: 30_000,
  });

  const legalDocs = query.data ?? [];

  const allEsigns = useMemo(() => {
    return legalDocs.map((d) => {
      const isSigned = isLegalReviewExecuted(d);
      const isRejected = d.review_status === "Rejected";
      const status = isSigned ? "Signed" : isRejected ? "Declined" : canStartLegalSignature(d) ? "Pending Signature" : "Review / Approval Required";
      const signer = d.esign_signed_by || d.approved_by || "—";

      return {
        id: d.name || d.sq_name,
        documentName: d.rfq_name ? `${d.rfq_name} Master Agreement` : "Supplier Master Agreement",
        supplier: d.supplier,
        type: (d.grand_total ?? 0) > 25000 ? "Master Service Agreement" : "Supplier Sourcing Terms",
        signer,
        signingOrder: "Legal signatory",
        status,
        sentDate: d.submission_date || "",
        signedDate: isSigned ? (d.esign_signed_on || "") : "",
        expiryDate: d.valid_till || "",
        sqName: d.sq_name,
        rfqName: d.rfq_name,
      };
    });
  }, [legalDocs]);

  const displayedList = useMemo(() => {
    const list = isPendingMode
      ? allEsigns.filter((e) => e.status === "Pending Signature" || e.status === "Draft")
      : allEsigns.filter((e) => e.status === "Signed" || e.status === "Declined");

    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => `${e.documentName} ${e.supplier} ${e.id} ${e.signer}`.toLowerCase().includes(q));
  }, [allEsigns, isPendingMode, debouncedSearch]);

  const counts = useMemo(() => {
    return {
      pending: allEsigns.filter((e) => e.status === "Pending Signature" || e.status === "Draft").length,
      completed: allEsigns.filter((e) => e.status === "Signed").length,
      declined: allEsigns.filter((e) => e.status === "Declined").length,
    };
  }, [allEsigns]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-200">
              <PenTool className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              {isPendingMode ? "Pending Signatures" : "Completed Signatures"}
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {isPendingMode
              ? "Track, manage, and execute electronic signatures on supplier agreements and legal addendums."
              : "Audit trail of fully executed, cryptographically verified electronic signatures."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/legal/esignatures/pending"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold no-underline transition ${
              isPendingMode
                ? "bg-blue-600 text-white shadow-2xs"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            Pending ({counts.pending})
          </Link>
          <Link
            to="/legal/esignatures/completed"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold no-underline transition ${
              !isPendingMode
                ? "bg-blue-600 text-white shadow-2xs"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            Completed ({counts.completed})
          </Link>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search signatures by document, supplier or signer..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        {displayedList.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FileCheck className="h-10 w-10 text-slate-300" />
            <h3 className="mt-3 text-sm font-semibold text-slate-800">
              No {isPendingMode ? "pending" : "completed"} signatures
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {isPendingMode
                ? "There are no agreements awaiting electronic signature at this moment."
                : "No completed signature records match your search."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-3 py-3">Document Type</th>
                  <th className="px-3 py-3">Signer</th>
                  <th className="px-3 py-3">Sent Date</th>
                  <th className="px-3 py-3">{isPendingMode ? "Expiry Date" : "Signed Date"}</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedList.map((item) => (
                  <tr key={item.id} className="transition hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-primary-700 text-xs">
                      {item.documentName}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-900">
                      {item.supplier}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {item.type}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-700 font-medium">
                      {item.signer}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-500">
                      {formatDate(item.sentDate)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-600 font-medium">
                      {isPendingMode ? formatDate(item.expiryDate) : item.signedDate !== "—" ? formatDate(item.signedDate) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          item.status === "Signed"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : item.status === "Declined"
                              ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/legal/review/${encodeURIComponent(item.sqName)}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 no-underline transition hover:bg-blue-100"
                      >
                        {isPendingMode ? "Sign / Review" : "View Record"} <ArrowRight className="h-3 w-3" />
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
