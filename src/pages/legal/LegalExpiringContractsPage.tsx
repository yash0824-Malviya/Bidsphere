import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarClock,
  FileText,
  Filter,
  RefreshCw,
  Search,
} from "lucide-react";
import { getAllLegalDocs } from "../../api/legalDocs";
import { formatCurrencyCompact, formatDate } from "../../utils/format";
import { useDebounce } from "../../hooks/useDebounce";

function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const target = Date.parse(dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr);
  if (Number.isNaN(target)) return null;
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export default function LegalExpiringContractsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [urgencyFilter, setUrgencyFilter] = useState("All");

  const query = useQuery({
    queryKey: ["legal-expiring-contracts"],
    queryFn: getAllLegalDocs,
    staleTime: 30_000,
  });

  const legalDocs = query.data ?? [];

  const expiringList = useMemo(() => {
    return legalDocs
      .map((d, idx) => {
        const remaining = daysUntil(d.valid_till);
        let urgency = "Future";
        if (remaining != null && remaining < 0) urgency = "Overdue";
        else if (remaining != null && remaining <= 30) urgency = "30 Days";
        else if (remaining != null && remaining <= 60) urgency = "60 Days";
        else if (remaining != null && remaining <= 90) urgency = "90 Days";

        return {
          contractNumber: `CTR-2026-${String(100 + idx).padStart(4, "0")}`,
          supplier: d.supplier,
          type: (d.grand_total ?? 0) > 25000 ? "Master Service Agreement" : "Supplier Sourcing Terms",
          expiryDate: d.valid_till || "2026-12-31",
          remainingDays: remaining,
          value: d.grand_total ?? 0,
          urgency,
          sqName: d.sq_name,
        };
      })
      .sort((a, b) => {
        if (a.remainingDays == null && b.remainingDays == null) return 0;
        if (a.remainingDays == null) return 1;
        if (b.remainingDays == null) return -1;
        return a.remainingDays - b.remainingDays;
      });
  }, [legalDocs]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return expiringList.filter((c) => {
      if (q && !`${c.contractNumber} ${c.supplier} ${c.type}`.toLowerCase().includes(q)) {
        return false;
      }
      if (urgencyFilter !== "All" && c.urgency !== urgencyFilter) {
        return false;
      }
      return true;
    });
  }, [expiringList, debouncedSearch, urgencyFilter]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-700 ring-1 ring-rose-200">
              <CalendarClock className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Expiring Contracts
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Monitor approaching contract expirations, renewal deadlines, and overdue agreements.
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
            placeholder="Search expiring contracts by number or supplier..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-rose-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-rose-500 focus:outline-none"
          >
            <option value="All">All Horizons</option>
            <option value="Overdue">Overdue</option>
            <option value="30 Days">Within 30 Days</option>
            <option value="60 Days">Within 60 Days</option>
            <option value="90 Days">Within 90 Days</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FileText className="h-10 w-10 text-slate-300" />
            <h3 className="mt-3 text-sm font-semibold text-slate-800">No expiring contracts found</h3>
            <p className="mt-1 text-xs text-slate-500">
              No active contracts meet the selected urgency criteria.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Contract #</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Expiry Date</th>
                  <th className="px-3 py-3">Remaining</th>
                  <th className="px-3 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.contractNumber} className="transition hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary-700">
                      {c.contractNumber}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-900">
                      {c.supplier}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {c.type}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-600">
                      {formatDate(c.expiryDate)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          c.remainingDays != null && c.remainingDays < 0
                            ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                            : c.remainingDays != null && c.remainingDays <= 30
                              ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {c.remainingDays != null && c.remainingDays < 0
                          ? `${Math.abs(c.remainingDays)}d overdue`
                          : c.remainingDays === 0
                            ? "Expires today"
                            : `${c.remainingDays}d remaining`}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-semibold text-slate-900">
                      {formatCurrencyCompact(c.value)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/legal/review/${encodeURIComponent(c.sqName)}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 no-underline hover:underline"
                      >
                        Review Renewal <ArrowRight className="h-3 w-3" />
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
