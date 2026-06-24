import { useLayoutEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Filter,
  Globe,
  LogIn,
  RefreshCw,
  Search,
  Shield,
  User,
  X,
} from "lucide-react";

import { getAccessLogs, getAccessLogUsers } from "../../api/accessLogs";
import type { AccessLogEntry, AccessLogFilters } from "../../api/accessLogs";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatDateTime } from "../../utils/format";

const ACTIONS = ["All", "Login", "Logout", "Failed Login", "Password Reset", "Role Change", "User Status Change"];
const STATUSES = ["All", "success", "failed", "info"];
const PAGE_SIZE = 60;

export default function AccessLogsPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const [filters, setFilters] = useState<AccessLogFilters>({ page: 0, pageSize: PAGE_SIZE });
  const [searchInput, setSearchInput] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["access-logs", filters],
    queryFn: () => getAccessLogs(filters),
    staleTime: 30_000,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["access-log-users"],
    queryFn: getAccessLogUsers,
    staleTime: 5 * 60_000,
  });

  const entries = data?.entries ?? [];
  const hasMore = entries.length >= PAGE_SIZE;

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.dateFrom) n++;
    if (filters.dateTo) n++;
    if (filters.user) n++;
    if (filters.action && filters.action !== "All") n++;
    if (filters.status && filters.status !== "All") n++;
    if (filters.search) n++;
    return n;
  }, [filters]);

  function applySearch() {
    setFilters((f) => ({ ...f, search: searchInput.trim() || undefined, page: 0 }));
  }
  function clearFilters() {
    setFilters({ page: 0, pageSize: PAGE_SIZE });
    setSearchInput("");
  }
  function exportCSV() {
    if (entries.length === 0) return;
    const header = "Timestamp,User,Role,IP Address,Action,Status";
    const rows = entries.map((e) =>
      [e.timestamp, `"${e.fullName}"`, e.role, `"${e.ipAddress}"`, `"${e.action}"`, e.status].join(",")
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `access-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const stats = useMemo(() => {
    let logins = 0, failed = 0, resets = 0;
    for (const e of entries) {
      if (e.action === "Login") logins++;
      if (e.action === "Failed Login") failed++;
      if (e.action === "Password Reset") resets++;
    }
    return { logins, failed, resets, total: entries.length };
  }, [entries]);

  return (
    <div className="-mt-1">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50">
            <LogIn className="h-4 w-4 text-rose-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-neutral-900">Access Logs</h1>
            <p className="text-[10px] text-neutral-500">Authentication &middot; Security events &middot; User access monitoring</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:opacity-50 cursor-pointer border-none">
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button type="button" onClick={exportCSV} disabled={entries.length === 0} className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:opacity-50 cursor-pointer border-none">
            <Download className="h-3 w-3" /> Export
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="mb-2 grid grid-cols-4 gap-2">
        <MiniKpi label="Total Events" value={stats.total} color="text-neutral-700" />
        <MiniKpi label="Logins" value={stats.logins} color="text-emerald-600" />
        <MiniKpi label="Failed Attempts" value={stats.failed} color="text-red-600" />
        <MiniKpi label="Password Resets" value={stats.resets} color="text-amber-600" />
      </div>

      {/* Search + Filters */}
      <div className="mb-2 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder="Search by username..."
            className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
          />
        </div>
        <button type="button" onClick={applySearch} className="rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700 cursor-pointer border-none">Search</button>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border-none ${
            showFilters || activeFilterCount > 0
              ? "bg-primary-50 text-primary-700 ring-1 ring-primary-300"
              : "bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50"
          }`}
        >
          <Filter className="h-3 w-3" /> Filters
          {activeFilterCount > 0 && <span className="ml-0.5 rounded-full bg-primary-600 px-1.5 py-px text-[9px] font-bold text-white">{activeFilterCount}</span>}
        </button>
        {activeFilterCount > 0 && (
          <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-neutral-500 hover:text-neutral-700 cursor-pointer bg-transparent border-none">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="mb-2 grid grid-cols-2 gap-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm lg:grid-cols-5">
          <FF label="Date From">
            <input type="date" value={filters.dateFrom ?? ""} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined, page: 0 }))} className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none" />
          </FF>
          <FF label="Date To">
            <input type="date" value={filters.dateTo ?? ""} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || undefined, page: 0 }))} className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none" />
          </FF>
          <FF label="User">
            <select value={filters.user ?? ""} onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value || undefined, page: 0 }))} className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none">
              <option value="">All Users</option>
              {users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </FF>
          <FF label="Action">
            <select value={filters.action ?? "All"} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value === "All" ? undefined : e.target.value, page: 0 }))} className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none">
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </FF>
          <FF label="Status">
            <select value={filters.status ?? "All"} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value === "All" ? undefined : e.target.value, page: 0 }))} className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none">
              {STATUSES.map((s) => <option key={s} value={s}>{s === "All" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </FF>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-1">{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-8 rounded" />)}</div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white py-14 text-center shadow-sm">
          <Shield className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">No access log entries found</p>
          <p className="mt-0.5 text-xs text-neutral-500">Adjust your filters or date range.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr className="border-b border-neutral-200">
                  <th className="w-[18%] px-3 py-2 text-left font-semibold text-neutral-500 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Timestamp</span>
                  </th>
                  <th className="w-[20%] px-3 py-2 text-left font-semibold text-neutral-500 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> User</span>
                  </th>
                  <th className="w-[12%] px-3 py-2 text-left font-semibold text-neutral-500">Role</th>
                  <th className="w-[18%] px-3 py-2 text-left font-semibold text-neutral-500 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> IP Address</span>
                  </th>
                  <th className="w-[20%] px-3 py-2 text-left font-semibold text-neutral-500">Action</th>
                  <th className="w-[12%] px-3 py-2 text-left font-semibold text-neutral-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <AccessRow key={e.name} entry={e} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-neutral-200 px-3 py-1.5">
            <p className="text-[11px] text-neutral-500">Page {(filters.page ?? 0) + 1} &middot; {entries.length} entries</p>
            <div className="flex items-center gap-1">
              <button type="button" disabled={(filters.page ?? 0) === 0} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))} className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 cursor-pointer bg-transparent border-none">
                <ChevronLeft className="h-3 w-3" /> Prev
              </button>
              <button type="button" disabled={!hasMore} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 0) + 1 }))} className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 cursor-pointer bg-transparent border-none">
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

const ACTION_COLORS: Record<string, string> = {
  Login: "bg-emerald-50 text-emerald-700",
  Logout: "bg-blue-50 text-blue-700",
  "Failed Login": "bg-red-50 text-red-700",
  "Password Reset": "bg-amber-50 text-amber-700",
  "Role Change": "bg-violet-50 text-violet-700",
  "User Status Change": "bg-orange-50 text-orange-700",
  "Account Locked": "bg-red-50 text-red-700",
  "Session Event": "bg-neutral-100 text-neutral-600",
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  success: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Success" },
  failed: { bg: "bg-red-50", text: "text-red-700", label: "Failed" },
  info: { bg: "bg-blue-50", text: "text-blue-700", label: "Info" },
};

function AccessRow({ entry }: { entry: AccessLogEntry }) {
  const st = STATUS_STYLES[entry.status] ?? STATUS_STYLES.info;
  return (
    <tr className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 transition-colors">
      <td className="px-3 py-2 text-neutral-600 tabular-nums whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3 flex-shrink-0 text-neutral-400" />
          {formatDateTime(entry.timestamp)}
        </span>
      </td>
      <td className="px-3 py-2">
        <p className="font-medium text-neutral-900 truncate max-w-[180px]" title={entry.user}>{entry.fullName}</p>
      </td>
      <td className="px-3 py-2">
        <span className="rounded bg-neutral-100 px-1.5 py-px text-[10px] font-semibold text-neutral-600">{entry.role}</span>
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-neutral-500 tabular-nums whitespace-nowrap">{entry.ipAddress}</td>
      <td className="px-3 py-2">
        <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${ACTION_COLORS[entry.action] ?? "bg-neutral-100 text-neutral-600"}`}>
          {entry.action}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
      </td>
    </tr>
  );
}

function MiniKpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
      <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[9px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
    </div>
  );
}

function FF({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
