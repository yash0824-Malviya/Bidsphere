import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ClipboardList,
  Copy,
  FileText,
  Link2,
  Pencil,
  Plus,
  Send,
  CheckCircle2,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  getRfpStats,
  listRfpsPaged,
  syncLocalRfpEnrichmentToErp,
} from "../../api/rfp";
import type { RfpStatus } from "../../types/rfp";
import { rfpNeedsNarrativeSync } from "../../api/rfpStorage";
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

const STATUS_FILTERS: { value: "" | RfpStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "Draft", label: "Draft" },
  { value: "Published", label: "Published" },
  { value: "Under Review", label: "Under Review" },
  { value: "Closed", label: "Closed" },
];

export default function RFPListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | RfpStatus>("");
  const debouncedSearch = useDebounce(search, 300);

  const filterKey = `${status}|${debouncedSearch}`;
  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: filterKey,
  });

  const listQuery = useQuery({
    queryKey: ["rfps", filterKey, page, pageSize],
    queryFn: async () => {
      const pageResult = await listRfpsPaged({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        status: status || undefined,
      });
      // Backfill narrative fields from local enrichment → ERP (cross-browser Supplier Portal).
      await Promise.all(
        (pageResult.data ?? []).map(async (row) => {
          try {
            if (rfpNeedsNarrativeSync(row)) {
              await syncLocalRfpEnrichmentToErp(row.name);
            }
          } catch {
            /* non-blocking */
          }
        }),
      );
      return pageResult;
    },
    staleTime: LIST_STALE,
    placeholderData: (prev) => prev,
  });

  const statsQuery = useQuery({
    queryKey: ["rfp-stats"],
    queryFn: () => getRfpStats(),
    staleTime: LIST_STALE,
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.total ?? 0;
  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFP"
        description="Request for Proposal — collect supplier proposals."
        actions={
          <Link to="/sourcing/rfp/new" className="btn-primary">
            <Plus />
            Create RFP
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
            icon={FileText}
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
            placeholder="Search RFP number, title…"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "" | RfpStatus)}
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
            title="Could not load RFPs"
            error={listQuery.error}
            onRetry={() => listQuery.refetch()}
          />
        ) : listQuery.isLoading ? (
          <TableSkeleton rows={5} columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No RFPs yet"
            description="Create a Request for Proposal to invite suppliers and collect proposal documents."
            action={
              <Link to="/sourcing/rfp/new" className="btn-primary">
                <Plus className="h-4 w-4" />
                Create RFP
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>RFP Number</th>
                  <th>Title</th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th>Suppliers</th>
                  <th>Owner</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const detailPath = `/sourcing/rfp/${encodeURIComponent(r.name)}`;
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
                      <td className="max-w-[240px] truncate font-medium text-neutral-900">
                        {r.title}
                      </td>
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
                                toast("Duplicate from RFP details", {
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
