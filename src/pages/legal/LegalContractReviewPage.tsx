import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  FileCheck,
  RefreshCw,
  Search,
} from "lucide-react";
import { getAllLegalDocs } from "../../api/legalDocs";
import { formatCurrencyCompact } from "../../utils/format";
import { useDebounce } from "../../hooks/useDebounce";

export default function LegalContractReviewPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);

  const query = useQuery({
    queryKey: ["legal-contract-review-queue"],
    queryFn: getAllLegalDocs,
    staleTime: 30_000,
  });

  const legalDocs = query.data ?? [];

  const pendingContracts = useMemo(() => {
    return legalDocs
      .filter((d) => d.review_status === "Pending")
      .map((d, idx) => ({
        contractNumber: `CTR-2026-${String(200 + idx).padStart(4, "0")}`,
        supplier: d.supplier,
        rfqName: d.rfq_name || d.sq_name,
        type: (d.grand_total ?? 0) > 25000 ? "Master Service Agreement" : "Supplier Sourcing Terms",
        value: d.grand_total ?? 0,
        submissionDate: d.submission_date || "2026-02-15",
        targetDate: d.valid_till || "2026-12-31",
        sqName: d.sq_name,
        company: d.company || "Bidsphere",
        priority: (d.grand_total ?? 0) > 50000 ? "High" : "Standard",
      }));
  }, [legalDocs]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return pendingContracts.filter((c) => {
      if (q && !`${c.contractNumber} ${c.supplier} ${c.rfqName} ${c.type}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [pendingContracts, debouncedSearch]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200">
              <FileCheck className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Contract Review
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Active queue of supplier commercial agreements, MSAs and addendums requiring legal terms review.
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
            placeholder="Search pending contracts by number, supplier or RFQ..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <h3 className="mt-3 text-sm font-semibold text-slate-800">All contracts reviewed</h3>
            <p className="mt-1 text-xs text-slate-500">
              There are no pending commercial contracts requiring review at this time.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Contract #</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-3 py-3">Contract Type</th>
                  <th className="px-3 py-3">RFQ Ref</th>
                  <th className="px-3 py-3 text-right">Value</th>
                  <th className="px-3 py-3">Priority</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.contractNumber} className="transition hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-amber-700">
                      {c.contractNumber}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-900">
                      {c.supplier}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {c.type}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">
                      {c.rfqName}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-semibold text-slate-900">
                      {formatCurrencyCompact(c.value)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          c.priority === "High"
                            ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {c.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/legal/review/${encodeURIComponent(c.sqName)}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 no-underline transition hover:bg-amber-100"
                      >
                        Review Contract <ArrowRight className="h-3 w-3" />
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
