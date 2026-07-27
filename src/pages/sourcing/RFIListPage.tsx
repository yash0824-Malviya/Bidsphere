import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ClipboardList,
  Copy,
  FileQuestion,
  Link2,
  Pencil,
  Plus,
  Send,
  CheckCircle2,
} from "lucide-react";
import toast from "react-hot-toast";

import { getRfiStats, listRfisPaged } from "../../api/rfi";
import type { RfiStatus } from "../../types/rfi";
import ConnectionError from "../../components/ConnectionError";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { SearchInput, TableRowActions } from "../../components/ui";
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFI"
        description="Request for Information — collect supplier information before RFQ."
        actions={
          <Link to="/sourcing/rfi/new" className="btn-primary">
            <Plus />
            Create RFI
          </Link>
        }
      />

      <div className="sourcing-list-kpis">
        <DashboardKpiGrid columns={4}>
          <DashboardKpiCard
            icon={ClipboardList}
            label="Draft"
            value={stats?.draft ?? "—"}
            iconClassName="bg-neutral-100 text-neutral-500"
          />
          <DashboardKpiCard
            icon={Send}
            label="Published"
            value={stats?.published ?? "—"}
            iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]"
          />
          <DashboardKpiCard
            icon={FileQuestion}
            label="Under Review"
            value={stats?.underReview ?? "—"}
            iconClassName="bg-amber-50 text-amber-600"
          />
          <DashboardKpiCard
            icon={CheckCircle2}
            label="Closed"
            value={stats?.closed ?? "—"}
            iconClassName="bg-emerald-50 text-emerald-600"
          />
        </DashboardKpiGrid>
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
          className="select-field w-auto sm:w-[180px]"
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
              <Link to="/sourcing/rfi/new" className="btn-primary">
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
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const detailPath = `/sourcing/rfi/${encodeURIComponent(r.name)}`;
                  return (
                    <tr
                      key={r.name}
                      className="cursor-pointer"
                      onClick={() => navigate(detailPath)}
                    >
                      <td>
                        <button
                          type="button"
                          className="table-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(detailPath);
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
                      <td className="col-actions">
                        <TableRowActions
                          label={r.name}
                          viewTo={detailPath}
                          items={[
                            {
                              id: "edit",
                              label: "Edit",
                              icon: Pencil,
                              onClick: () => navigate(detailPath),
                            },
                            {
                              id: "duplicate",
                              label: "Duplicate",
                              icon: Copy,
                              onClick: () =>
                                toast("Duplicate from RFI details", {
                                  icon: "ℹ️",
                                }),
                            },
                            {
                              id: "copy",
                              label: "Copy Link",
                              icon: Link2,
                              onClick: () => {
                                void navigator.clipboard
                                  .writeText(
                                    `${window.location.origin}${detailPath}`,
                                  )
                                  .then(() => toast.success("Link copied"))
                                  .catch(() =>
                                    toast.error("Could not copy link"),
                                  );
                              },
                            },
                            {
                              id: "archive",
                              label: "Archive",
                              icon: Archive,
                              separatorBefore: true,
                              onClick: () =>
                                toast.success(`Archive queued for ${r.name}`),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
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
