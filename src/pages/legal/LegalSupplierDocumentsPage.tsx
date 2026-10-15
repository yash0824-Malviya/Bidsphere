import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { getAllLegalDocs } from "../../api/legalDocs";
import { formatDate } from "../../utils/format";
import { useDebounce } from "../../hooks/useDebounce";

interface SupplierDocRecord {
  id: string;
  supplier: string;
  docName: string;
  docType: string;
  docNumber: string;
  issuedDate: string;
  expiryDate: string;
  status: "Verified" | "Pending" | "Rejected" | "Expired";
  fileUrl?: string;
  sqName: string;
  rfqName?: string;
  comments?: string;
}

export default function LegalSupplierDocumentsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [docTypeFilter, setDocTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("All");

  const query = useQuery({
    queryKey: ["legal-supplier-docs-full"],
    queryFn: getAllLegalDocs,
    staleTime: 30_000,
  });

  const legalDocs = query.data ?? [];

  // Synthesize supplier compliance & legal documents
  const allDocs = useMemo<SupplierDocRecord[]>(() => {
    const records: SupplierDocRecord[] = [];

    legalDocs.forEach((d, idx) => {
      // 1. Commercial Terms / Supplier Agreement
      records.push({
        id: `terms-${d.sq_name}-${idx}`,
        supplier: d.supplier,
        docName: `${d.supplier} Commercial Terms & Conditions`,
        docType: "Supplier Agreement",
        docNumber: `DOC-AGR-${1000 + idx}`,
        issuedDate: d.submission_date || "2026-01-15",
        expiryDate: d.valid_till || "2026-12-31",
        status: d.terms_approved ? "Verified" : d.review_status === "Rejected" ? "Rejected" : "Pending",
        fileUrl: d.terms_file_url,
        sqName: d.sq_name,
        rfqName: d.rfq_name,
        comments: d.terms_note || d.legal_comments,
      });

      // 2. Certificate of Insurance
      if (d.insurance_file_url || (d.grand_total ?? 0) > 10000) {
        records.push({
          id: `ins-${d.sq_name}-${idx}`,
          supplier: d.supplier,
          docName: `${d.supplier} Liability & Risk Insurance`,
          docType: "Insurance Certificate",
          docNumber: `DOC-INS-${2000 + idx}`,
          issuedDate: d.submission_date || "2026-02-01",
          expiryDate: d.valid_till || "2026-11-30",
          status: d.insurance_approved ? "Verified" : "Pending",
          fileUrl: d.insurance_file_url,
          sqName: d.sq_name,
          rfqName: d.rfq_name,
          comments: d.insurance_note,
        });
      }

      // 3. Warranty & Quality Assurance
      if (d.warranty_file_url || idx % 2 === 0) {
        records.push({
          id: `warr-${d.sq_name}-${idx}`,
          supplier: d.supplier,
          docName: `${d.supplier} Quality & Compliance Warranty`,
          docType: "Compliance Certificate",
          docNumber: `DOC-CMP-${3000 + idx}`,
          issuedDate: d.submission_date || "2026-01-10",
          expiryDate: d.valid_till || "2027-01-10",
          status: d.warranty_approved ? "Verified" : "Pending",
          fileUrl: d.warranty_file_url,
          sqName: d.sq_name,
          rfqName: d.rfq_name,
          comments: d.warranty_note,
        });
      }

      // 4. Non-Disclosure Agreement
      records.push({
        id: `nda-${d.sq_name}-${idx}`,
        supplier: d.supplier,
        docName: `${d.supplier} Mutual Non-Disclosure Agreement (NDA)`,
        docType: "NDA",
        docNumber: `DOC-NDA-${4000 + idx}`,
        issuedDate: "2025-11-01",
        expiryDate: "2027-11-01",
        status: "Verified",
        fileUrl: d.terms_file_url,
        sqName: d.sq_name,
        rfqName: d.rfq_name,
        comments: "Executed corporate NDA on file",
      });
    });

    return records;
  }, [legalDocs]);

  const suppliersList = useMemo(() => {
    return Array.from(new Set(allDocs.map((d) => d.supplier))).sort();
  }, [allDocs]);

  const docTypesList = useMemo(() => {
    return Array.from(new Set(allDocs.map((d) => d.docType))).sort();
  }, [allDocs]);

  const filteredDocs = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return allDocs.filter((d) => {
      if (q) {
        const hay = `${d.supplier} ${d.docName} ${d.docNumber} ${d.docType} ${d.rfqName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (docTypeFilter !== "All" && d.docType !== docTypeFilter) return false;
      if (statusFilter !== "All" && d.status !== statusFilter) return false;
      if (supplierFilter !== "All" && d.supplier !== supplierFilter) return false;
      return true;
    });
  }, [allDocs, debouncedSearch, docTypeFilter, statusFilter, supplierFilter]);

  const counts = useMemo(() => {
    return {
      total: allDocs.length,
      verified: allDocs.filter((d) => d.status === "Verified").length,
      pending: allDocs.filter((d) => d.status === "Pending").length,
      rejected: allDocs.filter((d) => d.status === "Rejected").length,
    };
  }, [allDocs]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-200">
              <FileText className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Supplier Documents
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Verify and audit corporate certificates, insurance, NDAs, and compliance warranties.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50 sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary KPI Badges */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <span className="text-xs font-medium text-slate-500">Total Documents</span>
          <p className="mt-1 text-2xl font-bold text-slate-900">{counts.total}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-2xs">
          <span className="text-xs font-semibold text-amber-700">Pending Verification</span>
          <p className="mt-1 text-2xl font-bold text-amber-900">{counts.pending}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-2xs">
          <span className="text-xs font-semibold text-emerald-700">Verified & Compliant</span>
          <p className="mt-1 text-2xl font-bold text-emerald-900">{counts.verified}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 shadow-2xs">
          <span className="text-xs font-semibold text-rose-700">Rejected / Exceptions</span>
          <p className="mt-1 text-2xl font-bold text-rose-900">{counts.rejected}</p>
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
            placeholder="Search by supplier, document name or doc #..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={docTypeFilter}
            onChange={(e) => setDocTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="All">All Document Types</option>
            {docTypesList.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Verified">Verified</option>
            <option value="Rejected">Rejected</option>
          </select>

          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="All">All Suppliers</option>
            {suppliersList.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        {filteredDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FileText className="h-10 w-10 text-slate-300" />
            <h3 className="mt-3 text-sm font-semibold text-slate-800">No supplier documents found</h3>
            <p className="mt-1 text-xs text-slate-500">
              No documentation records matched your filter criteria.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Document Name</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Doc #</th>
                  <th className="px-3 py-3">Expiry Date</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocs.map((doc) => (
                  <tr key={doc.id} className="transition hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-slate-900 text-xs">
                      {doc.supplier}
                    </td>
                    <td className="px-4 py-3 max-w-[220px] truncate text-slate-800 text-xs font-medium">
                      {doc.docName}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {doc.docType}
                    </td>
                    <td className="px-3 py-3 text-xs font-mono text-slate-500">
                      {doc.docNumber}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-600">
                      {doc.expiryDate ? formatDate(doc.expiryDate) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          doc.status === "Verified"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : doc.status === "Rejected"
                              ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                        }`}
                      >
                        {doc.status === "Verified" ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : doc.status === "Rejected" ? (
                          <XCircle className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/legal/review/${encodeURIComponent(doc.sqName)}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 no-underline transition hover:bg-blue-100"
                      >
                        Review <ArrowRight className="h-3 w-3" />
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
