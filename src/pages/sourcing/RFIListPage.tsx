import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList,
  FileQuestion,
  Plus,
  Send,
  CheckCircle2,
} from "lucide-react";

import { getRfiStats, listRfisPaged } from "../../api/rfi";
import type { RfiStatus } from "../../types/rfi";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { SearchInput } from "../../components/ui";
import { useDebounce } from "../../hooks/useDebounce";
import { usePagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";
import { ownerTitleFromEmail } from "../../config/roles";

const LIST_STALE = 30_000;

const STATUS_FILTERS: { value: "" | RfiStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "Draft", label: "Draft" },
  { value: "Published", label: "Published" },
  { value: "Under Review", label: "Under Review" },
  { value: "Closed", label: "Closed" },
];

export default function RFIListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | RfiStatus>("");
  const debouncedSearch = useDebounce(search, 300);

  const filterKey = `${status}|${debouncedSearch}`;
  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: filterKey,
  });

  const listQuery = useQuery({
    queryKey: ["rfis", filterKey, page, pageSize],
    queryFn: () =>
      listRfisPaged({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        status: status || undefined,
      }),
    staleTime: LIST_STALE,
    placeholderData: (prev) => prev,
  });

  const statsQuery = useQuery({
    queryKey: ["rfi-stats"],
    queryFn: () => getRfiStats(),
    staleTime: LIST_STALE,
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.total ?? 0;
  const stats = statsQuery.data;

  const kpis = useMemo(
    () => [
      {
        label: "Draft",
        value: stats?.draft ?? "—",
        icon: ClipboardList,
        tone: "neutral" as const,
      },
      {
        label: "Published",
        value: stats?.published ?? "—",
        icon: Send,
        tone: "blue" as const,
      },
      {
        label: "Under Review",
        value: stats?.underReview ?? "—",
        icon: FileQuestion,
        tone: "amber" as const,
      },
      {
        label: "Closed",
        value: stats?.closed ?? "—",
        icon: CheckCircle2,
        tone: "emerald" as const,
      },
    ],
    [stats],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFI"
        description="Request for Information — collect supplier information before RFQ."
        actions={
          <Link
            to="/sourcing/rfi/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Create RFI
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-neutral-200 bg-white p-4"
          >
            <div className="flex items-center gap-2 text-neutral-500">
              <kpi.icon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">
                {kpi.label}
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-neutral-900">
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="max-w-sm flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search RFI number, title, category…"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "" | RfiStatus)}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.label} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="table-shell">
        {listQuery.isError ? (
          <ConnectionError
            title="Could not load RFIs"
            error={listQuery.error}
            onRetry={() => listQuery.refetch()}
          />
        ) : listQuery.isLoading ? (
          <TableSkeleton rows={5} columns={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileQuestion}
            title="No RFIs yet"
            description="Create a Request for Information to collect supplier details before issuing an RFQ."
            action={
              <Link
                to="/sourcing/rfi/new"
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                <Plus className="h-4 w-4" />
                Create RFI
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>RFI Number</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Department</th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th>Suppliers</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.name}
                    className="cursor-pointer hover:bg-neutral-50"
                    onClick={() =>
                      navigate(`/sourcing/rfi/${encodeURIComponent(r.name)}`)
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="table-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(
                            `/sourcing/rfi/${encodeURIComponent(r.name)}`,
                          );
                        }}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="max-w-[220px] truncate font-medium text-neutral-900">
                      {r.title}
                    </td>
                    <td>{r.category}</td>
                    <td>{r.department}</td>
                    <td>{formatDate(r.submission_deadline)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="tabular-nums">{r.suppliers.length}</td>
                    <td>{ownerTitleFromEmail(r.owner)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <PaginationBar
          currentPage={page}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          totalRecords={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </div>
  );
}
