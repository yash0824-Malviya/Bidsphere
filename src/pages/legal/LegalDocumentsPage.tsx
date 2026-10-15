import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  FileText,
  Filter,
  FolderLock,
  RefreshCw,
  Search,
} from "lucide-react";
import { getAllLegalDocs } from "../../api/legalDocs";
import { formatDate } from "../../utils/format";
import { useDebounce } from "../../hooks/useDebounce";

export default function LegalDocumentsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [categoryFilter, setCategoryFilter] = useState("All");

  const query = useQuery({
    queryKey: ["legal-master-documents"],
    queryFn: getAllLegalDocs,
    staleTime: 30_000,
  });

  const legalDocs = query.data ?? [];

  const masterDocs = useMemo(() => {
    return legalDocs.map((d, i) => {
      const isMaster = (d.grand_total ?? 0) > 25000;
      const category = isMaster ? "Master Service Agreement" : "Supplier Sourcing Agreement";
      return {
        id: `DOC-LGL-${202600 + i}`,
        title: `${d.supplier} ${category}`,
        supplier: d.supplier,
        category,
        version: "v1.2",
        status: d.review_status === "Approved" ? "Active" : d.review_status === "Rejected" ? "Rejected" : "In Review",
        effectiveDate: d.submission_date || "2026-01-15",
        expiryDate: d.valid_till || "2026-12-31",
        sqName: d.sq_name,
        rfqName: d.rfq_name,
      };
    });
  }, [legalDocs]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return masterDocs.filter((d) => {
      if (q && !`${d.title} ${d.supplier} ${d.id}`.toLowerCase().includes(q)) {
        return false;
      }
      if (categoryFilter !== "All" && d.category !== categoryFilter) {
        return false;
      }
      return true;
    });
  }, [masterDocs, debouncedSearch, categoryFilter]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700 ring-1 ring-violet-200">
              <FolderLock className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Legal Documents
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Repository of corporate agreements, non-disclosure agreements, and standard terms.
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

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search legal documents by title, supplier or doc ID..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-violet-500 focus:outline-none"
          >
            <option value="All">All Categories</option>
            <option value="Master Service Agreement">Master Service Agreement</option>
            <option value="Supplier Sourcing Agreement">Supplier Sourcing Agreement</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FileText className="h-10 w-10 text-slate-300" />
            <h3 className="mt-3 text-sm font-semibold text-slate-800">No legal documents found</h3>
            <p className="mt-1 text-xs text-slate-500">
              No records matched the selected filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Document ID</th>
                  <th className="px-4 py-3">Document Title</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Effective Date</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((doc) => (
                  <tr key={doc.id} className="transition hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-violet-700">
                      {doc.id}
                    </td>
                    <td className="px-4 py-3 max-w-[240px] truncate text-slate-800 text-xs font-medium">
                      {doc.title}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-900">
                      {doc.supplier}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {doc.category}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-600">
                      {doc.effectiveDate ? formatDate(doc.effectiveDate) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          doc.status === "Active"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : doc.status === "Rejected"
                              ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                        }`}
                      >
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/legal/review/${encodeURIComponent(doc.sqName)}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 no-underline hover:underline"
                      >
                        View Review <ArrowRight className="h-3 w-3" />
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
