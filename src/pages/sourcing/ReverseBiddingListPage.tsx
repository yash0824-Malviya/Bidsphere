import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Gavel,
  TrendingDown,
} from "lucide-react";

import {
  deriveAuctionStatus,
  getReverseBiddingStats,
  listReverseBiddingsPaged,
} from "../../api/reverseBidding";
import type { ReverseBidding } from "../../types/reverseBidding";
import AuctionStatusBadge from "../../components/reverse-bidding/AuctionStatusBadge";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import ExportButton from "../../components/export/ExportButton";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";
import { usePagination } from "../../hooks/usePagination";
import { formatCurrencyIn, formatDateTime } from "../../utils/format";
import type { ExportColumn } from "../../utils/export";

const LIST_STALE = 60_000;

export default function ReverseBiddingListPage() {
  const navigate = useNavigate();
  const { page, pageSize, setPage, setPageSize } = usePagination();

  const listQuery = useQuery({
    queryKey: ["reverse-biddings", page, pageSize],
    queryFn: () => listReverseBiddingsPaged({ page, pageSize }),
    staleTime: LIST_STALE,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  // The KPI cards below summarize ALL auctions regardless of the current
  // page, so they stay on their own full-dataset query (unaffected by
  // pagination of the table).
  const statsQuery = useQuery({
    queryKey: ["reverse-bidding-stats"],
    queryFn: getReverseBiddingStats,
    staleTime: LIST_STALE,
    refetchInterval: 30_000,
  });

  const rows = useMemo(() => listQuery.data?.data ?? [], [listQuery.data]);
  const stats = statsQuery.data;

  const exportColumns = useMemo<ExportColumn<ReverseBidding>[]>(
    () => [
      { id: "name", label: "Auction ID", accessor: (r) => r.name },
      { id: "rfq", label: "RFQ", accessor: (r) => r.rfq },
      {
        id: "status",
        label: "Status",
        type: "status",
        accessor: (r) => deriveAuctionStatus(r),
      },
      {
        id: "start",
        label: "Start",
        type: "date",
        accessor: (r) => r.start_date_time,
      },
      {
        id: "end",
        label: "End",
        type: "date",
        accessor: (r) => r.end_date_time,
      },
      {
        id: "starting_price",
        label: "Starting Price",
        type: "currency",
        accessor: (r) => r.starting_price,
      },
      {
        id: "lowest_bid",
        label: "Lowest Bid",
        type: "currency",
        accessor: (r) => r.lowest_bid,
      },
      {
        id: "winning_supplier",
        label: "Winning Supplier",
        accessor: (r) => r.winning_supplier,
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reverse Bidding"
        description="Run live reverse auctions with AI-shortlisted suppliers."
        actions={
          <ExportButton
            module="Reverse Bidding"
            filenamePrefix="Reverse_Bidding"
            columns={exportColumns}
            rows={rows}
          />
        }
      />

      {/* Dashboard cards */}
      <DashboardKpiGrid columns={4}>
        <DashboardKpiCard
          icon={Activity}
          label="Active Auctions"
          value={stats ? String(stats.live) : "—"}
          iconClassName="bg-emerald-50 text-emerald-600"
        />
        <DashboardKpiCard
          icon={CalendarClock}
          label="Scheduled"
          value={stats ? String(stats.scheduled) : "—"}
          iconClassName="bg-amber-50 text-amber-600"
        />
        <DashboardKpiCard
          icon={CheckCircle2}
          label="Completed"
          value={stats ? String(stats.completed) : "—"}
          iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]"
        />
        <DashboardKpiCard
          icon={TrendingDown}
          label="Average Savings"
          value={stats ? `${stats.avgSavingsPct.toFixed(1)}%` : "—"}
          iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]"
        />
      </DashboardKpiGrid>

      {stats && (stats.lowestActiveBid != null || stats.upcoming.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <DashboardKpiCard
            icon={Gavel}
            label="Current Lowest Live Bid"
            value={
              stats.lowestActiveBid != null
                ? formatCurrencyIn(stats.lowestActiveBid)
                : "No live bids"
            }
            iconClassName="bg-emerald-50 text-emerald-600"
          />
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Upcoming Auctions
            </p>
            {stats.upcoming.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">
                No auctions scheduled.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {stats.upcoming.map((a) => (
                  <li
                    key={a.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <button
                      type="button"
                      className="table-link"
                      onClick={() =>
                        navigate(
                          `/sourcing/reverse-bidding/${encodeURIComponent(a.name)}`
                        )
                      }
                    >
                      {a.name}
                    </button>
                    <span className="text-neutral-500">
                      {formatDateTime(a.start_date_time)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="table-shell">
        {listQuery.isError ? (
          <ConnectionError
            title="Could not load auctions"
            error={listQuery.error}
            onRetry={() => listQuery.refetch()}
          />
        ) : listQuery.isLoading ? (
          <TableSkeleton rows={5} columns={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No reverse auctions yet"
            description="Reverse auctions are created from an RFQ after AI evaluation. Open an RFQ with quotations and choose 'Create Reverse Bidding'."
          />
        ) : (
          <div className="hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Auction ID</th>
                  <th>RFQ</th>
                  <th>Status</th>
                  <th>Start</th>
                  <th>End</th>
                  <th className="text-right">Lowest Bid</th>
                  <th>Winner</th>
                  <th>Company</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((rb) => (
                  <AuctionRow key={rb.name} rb={rb} navigate={navigate} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!listQuery.isLoading && !listQuery.isError && rows.length > 0 && (
          <PaginationBar
            currentPage={listQuery.data?.current_page ?? page}
            totalPages={listQuery.data?.total_pages ?? 1}
            totalRecords={listQuery.data?.total_records ?? 0}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}

        {/* Mobile cards */}
        {!listQuery.isLoading && !listQuery.isError && rows.length > 0 && (
          <div className="data-card-list md:hidden">
            {rows.map((rb) => {
              const status = deriveAuctionStatus(rb);
              return (
                <div
                  key={rb.name}
                  role="button"
                  tabIndex={0}
                  className="data-card-row"
                  onClick={() =>
                    navigate(
                      `/sourcing/reverse-bidding/${encodeURIComponent(rb.name)}`
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(
                        `/sourcing/reverse-bidding/${encodeURIComponent(rb.name)}`
                      );
                    }
                  }}
                >
                  <div className="data-card-field">
                    <span className="data-card-label">Auction</span>
                    <span className="data-card-value">{rb.name}</span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">RFQ</span>
                    <span className="data-card-value">{rb.rfq}</span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Status</span>
                    <span className="data-card-value">
                      <AuctionStatusBadge status={status} />
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Lowest Bid</span>
                    <span className="data-card-value">
                      {rb.lowest_bid
                        ? formatCurrencyIn(rb.lowest_bid, rb.currency)
                        : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AuctionRow({
  rb,
  navigate,
}: {
  rb: ReverseBidding;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const status = deriveAuctionStatus(rb);
  return (
    <tr
      className="cursor-pointer"
      onClick={() =>
        navigate(`/sourcing/reverse-bidding/${encodeURIComponent(rb.name)}`)
      }
    >
      <td className="font-medium text-primary">{rb.name}</td>
      <td className="text-neutral-600">{rb.rfq}</td>
      <td>
        <AuctionStatusBadge status={status} />
      </td>
      <td className="whitespace-nowrap text-neutral-600">
        {rb.start_date_time ? formatDateTime(rb.start_date_time) : "—"}
      </td>
      <td className="whitespace-nowrap text-neutral-600">
        {rb.end_date_time ? formatDateTime(rb.end_date_time) : "—"}
      </td>
      <td className="text-right tabular-nums font-medium text-emerald-600">
        {rb.lowest_bid ? formatCurrencyIn(rb.lowest_bid, rb.currency) : "—"}
      </td>
      <td className="text-neutral-600">{rb.winning_supplier || "—"}</td>
      <td className="text-neutral-600">{rb.company || "—"}</td>
    </tr>
  );
}

