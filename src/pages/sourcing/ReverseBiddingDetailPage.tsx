import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Award,
  Ban,
  BadgeCheck,
  Brain,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  Gavel,
  Grid3x3,
  History,
  Send,
  ShieldCheck,
  Target,
  Timer,
  Trophy,
  Users,
} from "lucide-react";

import {
  cancelAuction,
  currentLowestBid,
  deriveAuctionStatus,
  ensureBidItems,
  getAuctionSupplierScores,
  getFinalRecommendation,
  getItemWiseMatrix,
  getReverseBidding,
  isApproved,
  lowestRateByItem,
  maybeAutoComplete,
  parseErpDateTime,
  scheduleAuction,
  sendAuctionWinnerToReview,
  sendInvitations,
  setItemTargets,
  startAuctionNow,
  summarizeBidHistory,
  type AuctionSupplierScore,
} from "../../api/reverseBidding";
import type {
  BidItemStatus,
  ReverseBidding,
  ReverseBiddingSupplier,
  ReverseBidItem,
} from "../../types/reverseBidding";
import AuctionStatusBadge from "../../components/reverse-bidding/AuctionStatusBadge";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import ConnectionError from "../../components/ConnectionError";
import { TableSkeleton } from "../../components/Skeleton";
import { useCountdown } from "../../hooks/useCountdown";
import { canManageReverseBidding } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { formatCurrencyIn, formatDateTime } from "../../utils/format";

type Status = ReturnType<typeof deriveAuctionStatus>;

/** Convert an ERPNext datetime string to a datetime-local input value. */
function toLocalInputValue(value?: string | null): string {
  const ms = parseErpDateTime(value);
  if (ms == null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/* ── Live status vocabulary (Part 6) ───────────────────────────────────── */

type BidStatusKind =
  | "Winner"
  | "Leading"
  | "Outbid"
  | "Active"
  | "Joined"
  | "Waiting";

function computeBidStatus(
  s: ReverseBiddingSupplier,
  status: Status,
  winningSupplier?: string
): BidStatusKind {
  const hasBid = typeof s.current_bid === "number" && s.current_bid > 0;
  if (status === "Completed" && winningSupplier && s.supplier === winningSupplier)
    return "Winner";
  if (hasBid) {
    if (s.rank === 1) return "Leading";
    return status === "Live" ? "Outbid" : "Active";
  }
  return s.joined_auction ? "Joined" : "Waiting";
}

const BID_STATUS_STYLES: Record<BidStatusKind, string> = {
  Winner: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  Leading: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Outbid: "bg-orange-50 text-orange-700 ring-orange-200",
  Active: "bg-blue-50 text-blue-700 ring-blue-200",
  Joined: "bg-slate-100 text-slate-600 ring-slate-200",
  Waiting: "bg-neutral-100 text-neutral-500 ring-neutral-200",
};

function BidStatusBadge({ kind }: { kind: BidStatusKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${BID_STATUS_STYLES[kind]}`}
    >
      {kind}
    </span>
  );
}

const ITEM_STATUS_STYLES: Record<BidItemStatus, string> = {
  Winner: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  Leading: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Outbid: "bg-orange-50 text-orange-700 ring-orange-200",
  Active: "bg-blue-50 text-blue-700 ring-blue-200",
  Waiting: "bg-neutral-100 text-neutral-500 ring-neutral-200",
};

function ItemStatusBadge({ status }: { status: BidItemStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${ITEM_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export default function ReverseBiddingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const name = id ? decodeURIComponent(id) : "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage = canManageReverseBidding(user?.role);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<Record<string, string>>({});
  const backfillRef = useRef(false);
  const targetsInitRef = useRef(false);

  const auctionQuery = useQuery({
    queryKey: ["reverse-bidding", name],
    queryFn: () => getReverseBidding(name),
    enabled: !!name,
    refetchInterval: 5000, // live refresh every 5s
    refetchOnWindowFocus: true,
  });

  const auction = auctionQuery.data;
  const status = auction ? deriveAuctionStatus(auction) : "Draft";

  // AI evaluation scores for the comparison table (live, from Supplier Scoring Result).
  const scoresQuery = useQuery({
    queryKey: ["auction-supplier-scores", auction?.rfq],
    queryFn: () => getAuctionSupplierScores(auction!.rfq),
    enabled: !!auction?.rfq,
    staleTime: 60_000,
  });
  const scores = scoresQuery.data;

  // AI final recommendation — auto-generated once the auction completes.
  const recommendationQuery = useQuery({
    queryKey: ["auction-recommendation", name],
    queryFn: () => getFinalRecommendation(auction!),
    enabled: !!auction && status === "Completed",
    staleTime: 60_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["reverse-bidding", name] });
    queryClient.invalidateQueries({ queryKey: ["reverse-biddings"] });
    queryClient.invalidateQueries({ queryKey: ["reverse-bidding-stats"] });
  };

  /* Back-fill item rows for auctions created before the item-wise feature. */
  useEffect(() => {
    if (!auction || backfillRef.current) return;
    if ((auction.bid_items ?? []).length > 0) return;
    if (!auction.rfq || (auction.invited_suppliers ?? []).length === 0) return;
    backfillRef.current = true;
    void ensureBidItems(auction)
      .then(() => invalidate())
      .catch(() => {
        backfillRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.name, auction?.bid_items?.length]);

  /* Seed target inputs once from persisted item rows. */
  useEffect(() => {
    if (!auction || targetsInitRef.current) return;
    const items = auction.bid_items ?? [];
    if (items.length === 0) return;
    const init: Record<string, string> = {};
    for (const it of items) {
      if (!(it.item_code in init)) {
        init[it.item_code] =
          (it.target_rate ?? 0) > 0 ? String(it.target_rate) : "";
      }
    }
    setTargets(init);
    targetsInitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.name, auction?.bid_items?.length]);

  const saveTargets = useMutation({
    mutationFn: () =>
      setItemTargets(
        name,
        Object.entries(targets).map(([item_code, v]) => ({
          item_code,
          target: Number(v) || 0,
        }))
      ),
    onSuccess: () => {
      toast.success("Target prices saved — now visible to suppliers.");
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not save targets"),
  });

  /* Auto-complete once when the clock passes the end time. */
  const autoCompletedRef = useRef(false);
  useEffect(() => {
    if (!auction) return;
    if (
      deriveAuctionStatus(auction) === "Completed" &&
      auction.auction_status !== "Completed" &&
      !autoCompletedRef.current
    ) {
      autoCompletedRef.current = true;
      void maybeAutoComplete(auction).then(() => invalidate());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.name, auction?.auction_status, auction?.end_date_time, status]);

  /* Countdown target: end when live, start when scheduled. */
  const countdownTarget = useMemo(() => {
    if (!auction) return null;
    if (status === "Live") return parseErpDateTime(auction.end_date_time);
    if (status === "Scheduled") return parseErpDateTime(auction.start_date_time);
    return null;
  }, [auction, status]);
  const countdown = useCountdown(countdownTarget);
  const timeRemaining =
    status === "Live" || status === "Scheduled"
      ? countdown.label
      : status === "Completed"
        ? "Closed"
        : "Not scheduled";

  if (!name) {
    return <p className="text-sm text-rose-600">No auction specified.</p>;
  }
  if (auctionQuery.isError) {
    return (
      <ConnectionError
        title="Could not load auction"
        error={auctionQuery.error}
        onRetry={() => auctionQuery.refetch()}
      />
    );
  }
  if (auctionQuery.isLoading || !auction) {
    return (
      <div className="table-shell">
        <TableSkeleton rows={6} columns={4} />
      </div>
    );
  }

  const currency = auction.currency;
  const invited = [...(auction.invited_suppliers ?? [])].sort(
    (a, b) => (a.rank || 99) - (b.rank || 99)
  );
  const lowest = currentLowestBid(auction);
  const startingPrice = auction.starting_price ?? 0;
  const overallSavings = startingPrice > 0 && lowest > 0 ? startingPrice - lowest : 0;
  const overallSavingsPct =
    startingPrice > 0 && overallSavings > 0
      ? (overallSavings / startingPrice) * 100
      : 0;
  const invitedCount = invited.length;
  const joinedCount = invited.filter((s) => s.joined_auction).length;
  const approved = isApproved(auction);

  const scoreFor = (supplier: string): AuctionSupplierScore | undefined =>
    scores?.get(supplier.trim().toLowerCase());

  // Bid history is stored append-only with per-item previous/new/reduction.
  // Newest first for display. Falls back to computing previous for any legacy
  // rows that predate the item-level fields.
  const initialBySupplier = new Map<string, number>();
  for (const s of invited)
    initialBySupplier.set(s.supplier, s.initial_quotation_amount ?? 0);
  const bidRowsNewestFirst = [...(auction.bid_history ?? [])]
    .sort((a, b) => {
      const ta = parseErpDateTime(a.bid_time) ?? 0;
      const tb = parseErpDateTime(b.bid_time) ?? 0;
      if (tb !== ta) return tb - ta;
      return (b.round_number ?? 0) - (a.round_number ?? 0);
    })
    .map((b) => {
      const previous =
        b.previous_rate ?? initialBySupplier.get(b.supplier) ?? 0;
      const reduction =
        b.reduction_amount ?? (previous > 0 ? previous - b.bid_amount : 0);
      return { ...b, previous, reduction };
    });
  const bidSummary = summarizeBidHistory(auction);

  const toggle = (supplier: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(supplier)) next.delete(supplier);
      else next.add(supplier);
      return next;
    });

  const toggleExpand = (supplier: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(supplier)) next.delete(supplier);
      else next.add(supplier);
      return next;
    });

  // Item-wise data (Reverse Bid Item child table).
  const bidItems = auction.bid_items ?? [];
  const hasItemBids = bidItems.length > 0;
  const matrix = getItemWiseMatrix(auction);
  const lowestByItem = lowestRateByItem(bidItems);
  const itemsBySupplier = new Map<string, ReverseBidItem[]>();
  for (const it of bidItems) {
    const list = itemsBySupplier.get(it.supplier) ?? [];
    list.push(it);
    itemsBySupplier.set(it.supplier, list);
  }
  const setTarget = (code: string, value: string) =>
    setTargets((prev) => ({ ...prev, [code]: value }));

  return (
    <div className="space-y-5">
      {/* ── Top header ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Gavel className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-bold text-neutral-900">
                {auction.name}
              </p>
              <p className="text-xs text-neutral-500">
                RFQ {auction.rfq}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <AuctionStatusBadge status={status} />
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                Time Remaining
              </p>
              <p
                className={`text-lg font-bold tabular-nums ${
                  status === "Live" ? "text-emerald-600" : "text-neutral-800"
                }`}
              >
                {timeRemaining}
              </p>
            </div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-neutral-100 pt-4 text-sm sm:grid-cols-4">
          <HeaderField label="Auction Start">
            {auction.start_date_time ? formatDateTime(auction.start_date_time) : "—"}
          </HeaderField>
          <HeaderField label="Auction End">
            {auction.end_date_time ? formatDateTime(auction.end_date_time) : "—"}
          </HeaderField>
          <HeaderField label="Procurement Manager">
            {auction.procurement_manager || "—"}
          </HeaderField>
          <HeaderField label="Company">{auction.company || "—"}</HeaderField>
        </dl>
      </div>

      {/* ── Procurement action bar (pre-completion) ────────────────────── */}
      {canManage && status !== "Completed" && (
        <ActionBar auction={auction} status={status} onDone={invalidate} />
      )}

      {/* ── Completion result card (Part 7) ────────────────────────────── */}
      {status === "Completed" && (
        <CompletionCard
          auction={auction}
          savings={overallSavings}
          savingsPct={overallSavingsPct}
          recommendationText={
            recommendationQuery.data?.reasoning ??
            (recommendationQuery.isLoading
              ? "Generating AI recommendation…"
              : undefined)
          }
          canManage={canManage}
          approved={approved}
          submittedBy={user?.email}
          onDone={invalidate}
        />
      )}

      {/* ── Main grid: comparison (left) + summary (right) ─────────────── */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* LEFT: supplier comparison + bid history */}
        <div className="space-y-5 lg:col-span-2">
          <Section
            title={`Supplier Comparison (${invited.length})`}
            icon={Users}
          >
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10" />
                    <th className="w-14">Rank</th>
                    <th>Supplier</th>
                    <th className="text-center">AI Score</th>
                    <th className="text-right">Initial Quote</th>
                    <th className="text-right">Current Bid</th>
                    <th className="text-right">Savings</th>
                    <th>Bid Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invited.map((s) => {
                    const init = s.initial_quotation_amount ?? 0;
                    const cur = s.current_bid ?? 0;
                    const savings = init > 0 && cur > 0 ? init - cur : 0;
                    const pct = init > 0 && savings > 0 ? (savings / init) * 100 : 0;
                    const kind = computeBidStatus(s, status, auction.winning_supplier);
                    const score = scoreFor(s.supplier);
                    const isLeader = kind === "Leading" || kind === "Winner";
                    const isOpen = expanded.has(s.supplier);
                    const supplierItems = itemsBySupplier.get(s.supplier) ?? [];
                    return (
                      <Fragment key={s.supplier}>
                        <tr className={isLeader ? "bg-emerald-50/60" : undefined}>
                          <td>
                            {hasItemBids && supplierItems.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(s.supplier)}
                                aria-label={`Toggle ${s.supplier} items`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            ) : (
                              <input
                                type="checkbox"
                                checked={selected.has(s.supplier)}
                                onChange={() => toggle(s.supplier)}
                                aria-label={`Select ${s.supplier}`}
                                className="h-4 w-4 cursor-pointer rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                              />
                            )}
                          </td>
                          <td>
                            {s.rank ? (
                              <span
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                                  isLeader
                                    ? "bg-emerald-500 text-white"
                                    : "bg-neutral-100 text-neutral-600"
                                }`}
                              >
                                {s.rank}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="font-medium text-neutral-800">
                            {s.supplier}
                          </td>
                          <td className="text-center">
                            {score ? (
                              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold tabular-nums text-primary">
                                {score.aiScore}
                              </span>
                            ) : (
                              <span className="text-xs text-neutral-400">—</span>
                            )}
                          </td>
                          <td className="text-right tabular-nums text-neutral-600">
                            {init ? formatCurrencyIn(init, currency) : "—"}
                          </td>
                          <td className="text-right tabular-nums font-semibold text-neutral-900">
                            {cur ? formatCurrencyIn(cur, currency) : "—"}
                          </td>
                          <td className="text-right tabular-nums text-emerald-600">
                            {savings > 0
                              ? `${formatCurrencyIn(savings, currency)} (${pct.toFixed(1)}%)`
                              : "—"}
                          </td>
                          <td>
                            <BidStatusBadge kind={kind} />
                          </td>
                        </tr>
                        {isOpen && supplierItems.length > 0 && (
                          <tr>
                            <td colSpan={8} className="bg-neutral-50/70 p-0">
                              <SupplierItemBreakdown
                                items={supplierItems}
                                currency={currency}
                                lowestByItem={lowestByItem}
                                targets={targets}
                                canManage={canManage && status !== "Completed"}
                                onTargetChange={setTarget}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {invited.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-sm text-neutral-500">
                        No suppliers invited yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Live bid history (Part 5) */}
          <Section
            title={`Live Bid History (${bidSummary.totalBids})`}
            icon={History}
          >
            {/* Summary strip */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              <MiniStat label="Total Bids">{bidSummary.totalBids}</MiniStat>
              <MiniStat label="Current Round">
                {bidSummary.currentRound || "—"}
              </MiniStat>
              <MiniStat label="Lowest Bid" tone="emerald">
                {bidSummary.lowestBid > 0
                  ? formatCurrencyIn(bidSummary.lowestBid, currency)
                  : "—"}
              </MiniStat>
              <MiniStat label="Highest Bid">
                {bidSummary.highestBid > 0
                  ? formatCurrencyIn(bidSummary.highestBid, currency)
                  : "—"}
              </MiniStat>
              <MiniStat label="Avg Reduction">
                {bidSummary.avgReductionPct > 0
                  ? `${bidSummary.avgReductionPct.toFixed(1)}%`
                  : "—"}
              </MiniStat>
              <MiniStat label="Last Bid">
                {bidSummary.lastBidTime
                  ? formatDateTime(bidSummary.lastBidTime)
                  : "—"}
              </MiniStat>
              <MiniStat label="Last Supplier">
                {bidSummary.lastBidSupplier ?? "—"}
              </MiniStat>
            </div>

            {bidRowsNewestFirst.length === 0 ? (
              <p className="text-sm text-neutral-500">No bids submitted yet.</p>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <table className="data-table">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr>
                      <th>Time</th>
                      <th className="text-center">Round</th>
                      <th>Supplier</th>
                      <th>Item</th>
                      <th className="text-right">Previous Price</th>
                      <th className="text-right">New Price</th>
                      <th className="text-right">Reduction</th>
                      <th className="text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bidRowsNewestFirst.map((b, i) => (
                      <tr key={`${b.supplier}-${b.item_code ?? ""}-${b.bid_time}-${i}`}>
                        <td className="whitespace-nowrap text-neutral-600">
                          {b.bid_time ? formatDateTime(b.bid_time) : "—"}
                        </td>
                        <td className="text-center tabular-nums text-neutral-500">
                          {b.round_number ?? "—"}
                        </td>
                        <td className="font-medium text-neutral-800">
                          {b.supplier}
                        </td>
                        <td className="text-neutral-700">
                          {b.item_name ?? b.item_code ?? "All items"}
                        </td>
                        <td className="text-right tabular-nums text-neutral-500">
                          {b.previous > 0
                            ? formatCurrencyIn(b.previous, currency)
                            : "—"}
                        </td>
                        <td className="text-right tabular-nums font-semibold text-neutral-900">
                          {formatCurrencyIn(b.bid_amount, currency)}
                        </td>
                        <td className="text-right tabular-nums text-emerald-600">
                          {b.reduction > 0 ? (
                            <>
                              {formatCurrencyIn(b.reduction, currency)}
                              {(b.reduction_pct ?? 0) > 0 && (
                                <span className="ml-1 text-[11px] text-emerald-500">
                                  ({(b.reduction_pct ?? 0).toFixed(1)}%)
                                </span>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="text-center">
                          <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            {b.status ?? "Accepted"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Item-wise comparison matrix (Procurement view) */}
          {hasItemBids && matrix.rows.length > 0 && (
            <Section
              title="Item-wise Comparison Matrix"
              icon={Grid3x3}
            >
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-white">Item</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Target</th>
                      {matrix.suppliers.map((sup) => (
                        <th key={sup} className="text-right">
                          {sup}
                        </th>
                      ))}
                      <th className="text-right">Lowest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map((row) => (
                      <tr key={row.item_code}>
                        <td className="sticky left-0 bg-white font-medium text-neutral-800">
                          <div>{row.item_name}</div>
                          <div className="text-[11px] text-neutral-400">
                            {row.item_code}
                          </div>
                        </td>
                        <td className="text-right tabular-nums text-neutral-500">
                          {row.qty}
                        </td>
                        <td className="text-right">
                          {canManage && status !== "Completed" ? (
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={targets[row.item_code] ?? ""}
                              onChange={(e) =>
                                setTarget(row.item_code, e.target.value)
                              }
                              className="input-field ml-auto w-24 text-right"
                              placeholder="Target"
                            />
                          ) : row.target > 0 ? (
                            <span className="tabular-nums text-primary">
                              {formatCurrencyIn(row.target, currency)}
                            </span>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        {matrix.suppliers.map((sup) => {
                          const rate = row.rates[sup] ?? 0;
                          const isLow =
                            rate > 0 && rate === row.lowest;
                          return (
                            <td
                              key={sup}
                              className={`text-right tabular-nums ${
                                isLow
                                  ? "bg-emerald-50 font-bold text-emerald-700"
                                  : "text-neutral-700"
                              }`}
                            >
                              {rate > 0
                                ? formatCurrencyIn(rate, currency)
                                : "—"}
                            </td>
                          );
                        })}
                        <td className="text-right tabular-nums font-bold text-emerald-700">
                          {row.lowest > 0
                            ? formatCurrencyIn(row.lowest, currency)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-neutral-200 font-semibold">
                      <td className="sticky left-0 bg-white">Total</td>
                      <td />
                      <td />
                      {matrix.suppliers.map((sup) => {
                        const total = matrix.totals[sup] ?? 0;
                        const isWinner = sup === matrix.winner;
                        return (
                          <td
                            key={sup}
                            className={`text-right tabular-nums ${
                              isWinner
                                ? "text-emerald-700"
                                : "text-neutral-800"
                            }`}
                          >
                            {total > 0
                              ? formatCurrencyIn(total, currency)
                              : "—"}
                          </td>
                        );
                      })}
                      <td className="text-right text-emerald-700">
                        {matrix.winnerTotal > 0
                          ? formatCurrencyIn(matrix.winnerTotal, currency)
                          : "—"}
                      </td>
                    </tr>
                    {matrix.winner && (
                      <tr>
                        <td
                          colSpan={matrix.suppliers.length + 4}
                          className="pt-2 text-xs text-neutral-500"
                        >
                          Lowest total:{" "}
                          <span className="font-semibold text-emerald-700">
                            {matrix.winner}
                          </span>
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
              {canManage && status !== "Completed" && (
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-neutral-100 pt-3">
                  <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                    <Target className="h-3.5 w-3.5" />
                    Set a target price per item — suppliers see it while bidding.
                  </p>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={saveTargets.isPending}
                    onClick={() => saveTargets.mutate()}
                  >
                    {saveTargets.isPending ? "Saving…" : "Save Target Prices"}
                  </button>
                </div>
              )}
            </Section>
          )}
        </div>

        {/* RIGHT: auction summary card */}
        <div className="space-y-5">
          <Section title="Auction Summary" icon={Timer}>
            <dl className="space-y-1">
              <SummaryRow label="Starting Price">
                {formatCurrencyIn(startingPrice, currency)}
              </SummaryRow>
              <SummaryRow label="Current Lowest Bid" tone="emerald">
                {lowest > 0 ? formatCurrencyIn(lowest, currency) : "—"}
              </SummaryRow>
              <SummaryRow label="Winning Supplier" tone="blue">
                {auction.winning_supplier ||
                  (status === "Completed" ? "—" : "TBD")}
              </SummaryRow>
              <SummaryRow label="Savings" tone="emerald">
                {overallSavings > 0
                  ? `${formatCurrencyIn(overallSavings, currency)} (${overallSavingsPct.toFixed(1)}%)`
                  : "—"}
              </SummaryRow>
              <SummaryRow label="Auction Status">
                <AuctionStatusBadge status={status} />
              </SummaryRow>
              <SummaryRow label="Current Round">
                {bidSummary.currentRound || "—"}
              </SummaryRow>
              <SummaryRow label="Minimum Decrement">
                {auction.minimum_decrement
                  ? formatCurrencyIn(auction.minimum_decrement, currency)
                  : "—"}
              </SummaryRow>
              <SummaryRow label="Time Remaining">{timeRemaining}</SummaryRow>
              <SummaryRow label="Total Invited Suppliers">
                {invitedCount}
              </SummaryRow>
              <SummaryRow label="Joined Suppliers">
                {joinedCount} / {invitedCount}
              </SummaryRow>
            </dl>
          </Section>

          {/* AI recommendation ranking (when completed) */}
          {status === "Completed" && recommendationQuery.data && (
            <Section title="AI Ranking" icon={Brain}>
              <div className="space-y-2">
                {recommendationQuery.data.rows.map((r) => (
                  <div
                    key={r.supplier}
                    className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                        {r.rank}
                      </span>
                      <span className="text-sm font-medium text-neutral-800">
                        {r.supplier}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-neutral-900">
                        {formatCurrencyIn(r.final_bid, currency)}
                      </p>
                      <p className="text-[11px] text-emerald-600">
                        {r.savings_pct.toFixed(1)}% saved
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate("/sourcing/reverse-bidding")}
        className="text-sm text-neutral-500 hover:text-neutral-700"
      >
        ← Back to auctions
      </button>
    </div>
  );
}

/* ── Completion result card + post-auction actions (Parts 7 & 8) ───────── */

function CompletionCard({
  auction,
  savings,
  savingsPct,
  recommendationText,
  canManage,
  approved,
  submittedBy,
  onDone,
}: {
  auction: ReverseBidding;
  savings: number;
  savingsPct: number;
  recommendationText?: string;
  canManage: boolean;
  approved: boolean;
  submittedBy?: string;
  onDone: () => void;
}) {
  const currency = auction.currency;
  const winner = auction.winning_supplier;
  const winnerPrice = auction.winner_price ?? auction.lowest_bid ?? 0;
  const winnerRow = (auction.invited_suppliers ?? []).find(
    (s) => s.supplier === winner
  );
  const originalQuote = winnerRow?.initial_quotation_amount ?? 0;
  const [confirmOpen, setConfirmOpen] = useState(false);

  const totalBidsSubmitted = (auction.bid_history ?? []).length;
  const auctionDuration = formatDuration(
    parseErpDateTime(auction.start_date_time),
    parseErpDateTime(auction.end_date_time)
  );

  const approve = useMutation({
    mutationFn: () => sendAuctionWinnerToReview(auction.name, submittedBy),
    onSuccess: () => {
      toast.success("Winner approved — sent to Legal & Finance review.");
      setConfirmOpen(false);
      onDone();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not approve winner"),
  });

  const cancel = useMutation({
    mutationFn: () => cancelAuction(auction.name, "Cancelled after completion"),
    onSuccess: () => {
      toast.success("Auction cancelled — no Purchase Order created.");
      onDone();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not cancel auction"),
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-primary-50/30 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            <Trophy className="h-3 w-3" />
            Auction Winner
          </div>
          <h3 className="mt-3 text-2xl font-bold text-neutral-900">
            {winner || "No winner"}
          </h3>
          {recommendationText && (
            <p className="mt-2 max-w-xl text-sm text-neutral-600">
              {recommendationText}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <ResultStat label="Winning Price">
            {winnerPrice ? formatCurrencyIn(winnerPrice, currency) : "—"}
          </ResultStat>
          <ResultStat label="Original Quote">
            {originalQuote ? formatCurrencyIn(originalQuote, currency) : "—"}
          </ResultStat>
          <ResultStat label="Savings" tone="emerald">
            {savings > 0 ? formatCurrencyIn(savings, currency) : "—"}
          </ResultStat>
          <ResultStat label="Difference" tone="emerald">
            {savingsPct > 0 ? `${savingsPct.toFixed(1)}%` : "—"}
          </ResultStat>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-emerald-100 pt-4">
        <div className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <Award className="h-3.5 w-3.5" />
          AI Recommendation: Award Purchase Order
        </div>
        {canManage && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {approved ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700">
                <ShieldCheck className="h-4 w-4" />
                Sent to Legal &amp; Finance Review
              </span>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-800 disabled:opacity-60"
                disabled={approve.isPending || !winner}
                onClick={() => setConfirmOpen(true)}
              >
                <BadgeCheck className="h-4 w-4" />
                {approve.isPending ? "Approving…" : "Approve Winner"}
              </button>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
              disabled={cancel.isPending || approved}
              onClick={() => {
                if (window.confirm("Cancel this auction? No PO will be created."))
                  cancel.mutate();
              }}
            >
              <Ban className="h-4 w-4" />
              Cancel Auction
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => approve.mutate()}
        title="Approve auction winner?"
        description="This sends the winner to Legal & Finance review and then creates the Purchase Order using the final reverse-bid prices."
        confirmLabel="Approve & Send to Review"
        tone="primary"
        isLoading={approve.isPending}
      >
        <dl className="space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <ConfirmRow label="Winning Supplier">{winner || "—"}</ConfirmRow>
          <ConfirmRow label="Final Bid">
            {winnerPrice ? formatCurrencyIn(winnerPrice, currency) : "—"}
          </ConfirmRow>
          <ConfirmRow label="Savings">
            {savings > 0
              ? `${formatCurrencyIn(savings, currency)}${savingsPct > 0 ? ` (${savingsPct.toFixed(1)}%)` : ""}`
              : "—"}
          </ConfirmRow>
          <ConfirmRow label="Bids Submitted">{totalBidsSubmitted}</ConfirmRow>
          <ConfirmRow label="Auction Duration">{auctionDuration}</ConfirmRow>
        </dl>
      </ConfirmDialog>
    </div>
  );
}

function ConfirmRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-semibold tabular-nums text-neutral-900">{children}</dd>
    </div>
  );
}

/** Human-readable duration between two epoch-ms timestamps. */
function formatDuration(startMs: number | null, endMs: number | null): string {
  if (startMs == null || endMs == null || endMs <= startMs) return "—";
  const totalMin = Math.round((endMs - startMs) / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(" ");
}

function ResultStat({
  label,
  children,
  tone = "neutral",
}: {
  label: string;
  children: ReactNode;
  tone?: "neutral" | "emerald";
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      <p
        className={`mt-0.5 text-lg font-bold tabular-nums ${
          tone === "emerald" ? "text-emerald-600" : "text-neutral-900"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

/* ── Action bar (procurement only, pre-completion) ─────────────────────── */

function ActionBar({
  auction,
  status,
  onDone,
}: {
  auction: ReverseBidding;
  status: Status;
  onDone: () => void;
}) {
  const name = auction.name;
  const [showSchedule, setShowSchedule] = useState(false);
  const [start, setStart] = useState(() =>
    toLocalInputValue(auction.start_date_time)
  );
  const [end, setEnd] = useState(() => toLocalInputValue(auction.end_date_time));
  const [decrement, setDecrement] = useState(
    auction.minimum_decrement ? String(auction.minimum_decrement) : ""
  );

  const wrap = (p: Promise<unknown>, msg: string) =>
    p
      .then(() => {
        toast.success(msg);
        onDone();
      })
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : "Action failed")
      );

  const invite = useMutation({
    mutationFn: () => sendInvitations(name),
    onSuccess: () => {
      toast.success("Invitations sent.");
      onDone();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to send invitations"),
  });

  const schedule = useMutation({
    mutationFn: () =>
      scheduleAuction(name, {
        startDateTime: start,
        endDateTime: end,
        minimumDecrement: Number(decrement) || 0,
      }),
    onSuccess: () => {
      toast.success("Auction scheduled.");
      setShowSchedule(false);
      onDone();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to schedule"),
  });

  const startNow = useMutation({
    mutationFn: () => startAuctionNow(name),
    onSuccess: () => {
      toast.success("Auction is now live.");
      onDone();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to start"),
  });

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "Draft" && (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={invite.isPending}
              onClick={() => invite.mutate()}
            >
              <Send className="h-4 w-4" />
              Send Invitations
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowSchedule((v) => !v)}
            >
              <Clock className="h-4 w-4" />
              Schedule Auction
            </button>
          </>
        )}

        {status === "Scheduled" && (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={startNow.isPending}
              onClick={() => startNow.mutate()}
            >
              <Gavel className="h-4 w-4" />
              Start Now
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowSchedule((v) => !v)}
            >
              <Clock className="h-4 w-4" />
              Reschedule
            </button>
          </>
        )}

        {(status === "Draft" ||
          status === "Scheduled" ||
          status === "Live") && (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
            onClick={() => {
              if (window.confirm("Cancel this auction?")) {
                void wrap(cancelAuction(name), "Auction cancelled.");
              }
            }}
          >
            <Ban className="h-4 w-4" />
            Cancel
          </button>
        )}
      </div>

      {showSchedule && (
        <div className="mt-3 grid gap-3 border-t border-neutral-100 pt-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-neutral-600">Start</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="input-field"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-neutral-600">End</span>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="input-field"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-neutral-600">
              Min. Decrement
            </span>
            <input
              type="number"
              min={0}
              value={decrement}
              onChange={(e) => setDecrement(e.target.value)}
              className="input-field"
              placeholder="0"
            />
          </label>
          <div className="sm:col-span-3">
            <button
              type="button"
              className="btn-primary"
              disabled={schedule.isPending}
              onClick={() => schedule.mutate()}
            >
              Save Schedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Per-supplier item breakdown (expandable row) ──────────────────────── */

function SupplierItemBreakdown({
  items,
  currency,
  lowestByItem,
  targets,
  canManage,
  onTargetChange,
}: {
  items: ReverseBidItem[];
  currency?: string;
  lowestByItem: Map<string, number>;
  targets: Record<string, string>;
  canManage: boolean;
  onTargetChange: (code: string, value: string) => void;
}) {
  return (
    <div className="px-4 py-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            <th className="pb-1 text-left">Item</th>
            <th className="pb-1 text-right">Qty</th>
            <th className="pb-1 text-right">Initial Price</th>
            <th className="pb-1 text-right">Current Lowest</th>
            <th className="pb-1 text-right">Target</th>
            <th className="pb-1 text-right">Latest Bid</th>
            <th className="pb-1 text-right">Difference</th>
            <th className="pb-1 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const initial = it.initial_rate ?? 0;
            const current = it.current_rate ?? 0;
            const latest = it.latest_rate ?? current;
            const itemLowest = lowestByItem.get(it.item_code) ?? current;
            const target = Number(targets[it.item_code]) || it.target_rate || 0;
            const diff = target > 0 && current > 0 ? current - target : 0;
            return (
              <tr key={it.item_code} className="border-t border-neutral-100">
                <td className="py-1.5 pr-2">
                  <div className="font-medium text-neutral-800">
                    {it.item_name ?? it.item_code}
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    {it.item_code}
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums text-neutral-500">
                  {it.qty ?? 0} {it.uom ?? ""}
                </td>
                <td className="py-1.5 text-right tabular-nums text-neutral-500">
                  {initial > 0 ? formatCurrencyIn(initial, currency) : "—"}
                </td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-emerald-600">
                  {itemLowest > 0 ? formatCurrencyIn(itemLowest, currency) : "—"}
                </td>
                <td className="py-1.5 text-right">
                  {canManage ? (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={targets[it.item_code] ?? ""}
                      onChange={(e) =>
                        onTargetChange(it.item_code, e.target.value)
                      }
                      className="input-field ml-auto w-24 text-right"
                      placeholder="Target"
                    />
                  ) : target > 0 ? (
                    <span className="tabular-nums text-primary">
                      {formatCurrencyIn(target, currency)}
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums text-neutral-800">
                  {latest > 0 ? formatCurrencyIn(latest, currency) : "—"}
                </td>
                <td
                  className={`py-1.5 text-right tabular-nums ${
                    diff > 0 ? "text-orange-600" : "text-emerald-600"
                  }`}
                >
                  {target > 0 && current > 0
                    ? `${diff > 0 ? "+" : ""}${formatCurrencyIn(diff, currency)}`
                    : "—"}
                </td>
                <td className="py-1.5 text-right">
                  <ItemStatusBadge status={it.status ?? "Waiting"} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canManage && (
        <p className="mt-2 text-[11px] text-neutral-400">
          Target prices are item-wide and shared across suppliers. Use “Save
          Target Prices” below the comparison matrix to publish them to
          suppliers.
        </p>
      )}
    </div>
  );
}

/* ── Small presentational helpers ──────────────────────────────────────── */

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Clock;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-800">
        <Icon className="h-4 w-4 text-neutral-400" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function HeaderField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
        {label === "Company" && <Building2 className="h-3 w-3" />}
        {label}
      </dt>
      <dd className="mt-0.5 text-neutral-800">{children}</dd>
    </div>
  );
}

function MiniStat({
  label,
  children,
  tone = "neutral",
}: {
  label: string;
  children: ReactNode;
  tone?: "neutral" | "emerald";
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p
        className={`mt-0.5 truncate text-sm font-bold tabular-nums ${
          tone === "emerald" ? "text-emerald-600" : "text-neutral-900"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function SummaryRow({
  label,
  children,
  tone = "neutral",
}: {
  label: string;
  children: ReactNode;
  tone?: "neutral" | "emerald" | "blue";
}) {
  const tones: Record<string, string> = {
    neutral: "text-neutral-900",
    emerald: "text-emerald-600",
    blue: "text-blue-600",
  };
  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-50 py-1.5 last:border-0">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${tones[tone]}`}>
        {children}
      </dd>
    </div>
  );
}
