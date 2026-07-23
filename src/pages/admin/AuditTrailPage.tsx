import { useLayoutEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  RefreshCw,
  Search,
  Shield,
  User,
  X,
} from "lucide-react";

import { getAuditTrail, getAuditUsers } from "../../api/auditTrail";
import type { AuditEntry, AuditFilters } from "../../api/auditTrail";
import ExportButton from "../../components/export/ExportButton";
import PaginationBar from "../../components/PaginationBar";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatDateTime } from "../../utils/format";
import type { ExportColumn } from "../../utils/export";

const MODULES = ["All", "Sourcing", "P2P", "Warehouse", "Finance", "Auth", "Admin", "System"];
const ACTIONS = ["All", "Created", "Updated", "Submitted", "Cancelled", "Deleted", "Login", "Logout"];
const PAGE_SIZE = 50;

export default function AuditTrailPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const [filters, setFilters] = useState<AuditFilters>({ page: 0, pageSize: PAGE_SIZE });
  const [searchInput, setSearchInput] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit-trail", filters],
    queryFn: () => getAuditTrail(filters),
    staleTime: 30_000,
  });

  const usersQuery = useQuery({
    queryKey: ["audit-users"],
    queryFn: getAuditUsers,
    staleTime: 5 * 60_000,
  });

  const entries = data?.entries ?? [];
  const hasMore = entries.length >= PAGE_SIZE;
  const users = usersQuery.data ?? [];

  const currentPage = (filters.page ?? 0) + 1;
  const pageSize = filters.pageSize ?? PAGE_SIZE;
  const totalRecords = hasMore
    ? currentPage * pageSize + 1
    : (currentPage - 1) * pageSize + entries.length;
  const totalPages = hasMore ? currentPage + 1 : currentPage;

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.dateFrom) n++;
    if (filters.dateTo) n++;
    if (filters.user) n++;
    if (filters.module && filters.module !== "All") n++;
    if (filters.action && filters.action !== "All") n++;
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

  const exportColumns = useMemo<ExportColumn<AuditEntry>[]>(
    () => [
      {
        id: "timestamp",
        label: "Timestamp",
        type: "date",
        accessor: (e) => e.timestamp,
      },
      { id: "fullName", label: "User Name", accessor: (e) => e.fullName },
      { id: "email", label: "Email", accessor: (e) => e.email },
      { id: "role", label: "Role", accessor: (e) => e.role },
      { id: "module", label: "Module", accessor: (e) => e.module },
      {
        id: "action",
        label: "Action",
        type: "status",
        accessor: (e) => e.action,
      },
      { id: "documentId", label: "Document", accessor: (e) => e.documentId },
      { id: "remarks", label: "Remarks", accessor: (e) => e.remarks },
    ],
    [],
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50">
            <Shield className="h-4 w-4 text-primary-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-neutral-900">Audit Trail</h1>
            <p className="text-[11px] text-neutral-500">System activity log &middot; All modules</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50 disabled:opacity-50 cursor-pointer border-none"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </button>
          <ExportButton
            module="Audit Logs"
            filenamePrefix="Audit_Logs"
            columns={exportColumns}
            rows={entries}
          />
        </div>
      </div>

      {/* Search + filter toggle */}
      <div className="mb-2 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder="Search by Document ID..."
            className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
          />
        </div>
        <button
          type="button"
          onClick={applySearch}
          className="rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700 cursor-pointer border-none"
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition cursor-pointer border-none ${
            showFilters || activeFilterCount > 0
              ? "bg-primary-50 text-primary-700 ring-1 ring-primary-300"
              : "bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50"
          }`}
        >
          <Filter className="h-3 w-3" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 rounded-full bg-primary-600 px-1.5 py-px text-[9px] font-bold text-white">{activeFilterCount}</span>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold text-neutral-500 hover:text-neutral-700 cursor-pointer bg-transparent border-none"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="mb-2 grid grid-cols-2 gap-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm lg:grid-cols-5">
          <FilterField label="Date From">
            <input
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined, page: 0 }))}
              className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
            />
          </FilterField>
          <FilterField label="Date To">
            <input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || undefined, page: 0 }))}
              className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
            />
          </FilterField>
          <FilterField label="User">
            <select
              value={filters.user ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value || undefined, page: 0 }))}
              className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
            >
              <option value="">All Users</option>
              {users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </FilterField>
          <FilterField label="Module">
            <select
              value={filters.module ?? "All"}
              onChange={(e) => setFilters((f) => ({ ...f, module: e.target.value === "All" ? undefined : e.target.value, page: 0 }))}
              className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
            >
              {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </FilterField>
          <FilterField label="Action">
            <select
              value={filters.action ?? "All"}
              onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value === "All" ? undefined : e.target.value, page: 0 }))}
              className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
            >
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </FilterField>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-1">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-9 rounded" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white py-16 text-center shadow-sm">
          <FileText className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">No audit entries found</p>
          <p className="mt-0.5 text-xs text-neutral-500">Adjust your filters or search criteria.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr className="border-b border-neutral-200">
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500 w-[155px]">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Timestamp</span>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500 w-[160px]">
                    <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> User Name</span>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500 w-[180px]">Email</th>
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500 w-[130px]">Role</th>
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500 w-[90px]">Module</th>
                  <th className="px-3 py-2 text-left font-semibold text-neutral-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <AuditRow key={entry.name} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>

          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={(page) =>
              setFilters((f) => ({ ...f, page: page - 1 }))
            }
            onPageSizeChange={(size) =>
              setFilters((f) => ({ ...f, pageSize: size, page: 0 }))
            }
            recordLabel="audit entries"
          />
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

const ROLE_COLORS: Record<string, string> = {
  "Procurement Manager": "bg-blue-50 text-blue-700",
  "Procurement Team": "bg-sky-50 text-sky-700",
  "Finance Manager": "bg-emerald-50 text-emerald-700",
  "Legal Reviewer": "bg-violet-50 text-violet-700",
  "Warehouse Manager": "bg-amber-50 text-amber-700",
  Administrator: "bg-rose-50 text-rose-700",
  System: "bg-neutral-100 text-neutral-500",
  Procurement: "bg-blue-50 text-blue-700",
  Finance: "bg-emerald-50 text-emerald-700",
  Legal: "bg-violet-50 text-violet-700",
  Warehouse: "bg-amber-50 text-amber-700",
  User: "bg-neutral-100 text-neutral-600",
};

const MODULE_BG: Record<string, string> = {
  Sourcing: "bg-blue-50 text-blue-700",
  P2P: "bg-violet-50 text-violet-700",
  Warehouse: "bg-amber-50 text-amber-700",
  Finance: "bg-emerald-50 text-emerald-700",
  Auth: "bg-rose-50 text-rose-700",
  Admin: "bg-red-50 text-red-700",
  System: "bg-neutral-100 text-neutral-600",
};

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <tr className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 transition-colors">
      <td className="px-3 py-2 text-neutral-600 tabular-nums whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3 w-3 flex-shrink-0 text-neutral-400" />
          {formatDateTime(entry.timestamp)}
        </div>
      </td>
      <td className="px-3 py-2">
        <p className="font-medium text-neutral-900 truncate max-w-[160px]" title={entry.fullName}>{entry.fullName}</p>
      </td>
      <td className="px-3 py-2">
        <p className="text-[11px] text-neutral-500 truncate max-w-[180px]" title={entry.email}>{entry.email}</p>
      </td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold ${ROLE_COLORS[entry.role] ?? ROLE_COLORS.User}`}>
          {entry.role}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold ${MODULE_BG[entry.module] ?? MODULE_BG.System}`}>
          {entry.module}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-start gap-1.5">
          <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-neutral-400" />
          <span className="text-neutral-700 leading-snug">{entry.action}</span>
        </div>
      </td>
    </tr>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
