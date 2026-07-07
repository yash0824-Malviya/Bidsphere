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
  listReverseBiddings,
} from "../../api/reverseBidding";
import type { ReverseBidding } from "../../types/reverseBidding";
import AuctionStatusBadge from "../../components/reverse-bidding/AuctionStatusBadge";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import { formatCurrencyIn, formatDateTime } from "../../utils/format";

const LIST_STALE = 60_000;

export default function ReverseBiddingListPage() {
  const navigate = useNavigate();

  const listQuery = useQuery({
    queryKey: ["reverse-biddings"],
    queryFn: listReverseBiddings,
    staleTime: LIST_STALE,
    refetchInterval: 30_000,
  });

  const statsQuery = useQuery({
    queryKey: ["reverse-bidding-stats"],
    queryFn: getReverseBiddingStats,
    staleTime: LIST_STALE,
    refetchInterval: 30_000,
  });

  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reverse Bidding"
        description="Run live reverse auctions with AI-shortlisted suppliers."
      />

      {/* Dashboard cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Activity}
          label="Active Auctions"
          value={stats ? String(stats.live) : "—"}
          tone="emerald"
        />
        <KpiCard
          icon={CalendarClock}
          label="Scheduled"
          value={stats ? String(stats.scheduled) : "—"}
          tone="amber"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Completed"
          value={stats ? String(stats.completed) : "—"}
          tone="blue"
        />
        <KpiCard
          icon={TrendingDown}
          label="Average Savings"
          value={stats ? `${stats.avgSavingsPct.toFixed(1)}%` : "—"}
          tone="violet"
        />
      </div>

      {stats && (stats.lowestActiveBid != null || stats.upcoming.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Current Lowest Live Bid
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">
              {stats.lowestActiveBid != null
                ? formatCurrencyIn(stats.lowestActiveBid)
                : "No live bids"}
            </p>
          </div>
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

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone: "emerald" | "amber" | "blue" | "violet";
}) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-neutral-500">
            {label}
          </p>
          <p className="text-xl font-bold tabular-nums text-neutral-900">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}
