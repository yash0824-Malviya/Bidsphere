import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Gavel, TrendingDown, Trophy } from "lucide-react";

import {
  currentLowestBid,
  deriveAuctionStatus,
  ensureBidItems,
  getReverseBidding,
  lowestRateByItem,
  maybeAutoComplete,
  parseErpDateTime,
  sameSupplier,
  submitBid,
  submitItemBids,
  supplierIsInvited,
  validateBid,
  validateItemBid,
  type ItemBidInput,
} from "../../api/reverseBidding";
import AuctionStatusBadge from "../../components/reverse-bidding/AuctionStatusBadge";
import AuctionCountdownAlert, {
  countdownPhaseClass,
} from "../../components/reverse-bidding/AuctionCountdownAlert";
import { TableSkeleton } from "../../components/Skeleton";
import SupplierPortalLayout from "./SupplierPortalLayout";
import SupplierAccessDenied from "../../components/supplier-portal/SupplierAccessDenied";
import { useCountdown } from "../../hooks/useCountdown";
import { useServerTimeOffset } from "../../hooks/useServerTimeOffset";
import { useAuctionCountdownAlerts } from "../../hooks/useAuctionCountdownAlerts";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import { formatCurrencyIn, formatDateTime } from "../../utils/format";

export default function SupplierAuctionPage() {
  const { t } = useTranslation();
  const { auctionName } = useParams<{ auctionName: string }>();
  const name = auctionName ? decodeURIComponent(auctionName) : "";
  const { supplierName, isReady, isAuthenticated } = useSupplierSession();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [itemBids, setItemBids] = useState<Record<string, string>>({});
  const flashRef = useRef<number | null>(null);
  const [flash, setFlash] = useState(false);

  const query = useQuery({
    queryKey: ["supplier-auction", name],
    enabled: !!name && !!supplierName,
    queryFn: () => getReverseBidding(name),
    refetchInterval: 5000,
  });

  const auction = query.data;
  const status = auction ? deriveAuctionStatus(auction) : "Draft";
  const lowest = auction ? currentLowestBid(auction) : 0;

  /* Back-fill item rows if this auction predates the item-wise feature. */
  const backfillRef = useRef(false);
  useEffect(() => {
    if (!auction || backfillRef.current) return;
    if ((auction.bid_items ?? []).length > 0) return;
    if (!auction.rfq || (auction.invited_suppliers ?? []).length === 0) return;
    backfillRef.current = true;
    void ensureBidItems(auction)
      .then(() => invalidateAuction())
      .catch(() => {
        backfillRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.name, auction?.bid_items?.length]);

  /* Finalize the auction (winner + Closed) once the end time passes, even if
   * no procurement user is watching. Guarded so it fires at most once. */
  const closedRef = useRef(false);
  useEffect(() => {
    if (!auction || closedRef.current) return;
    if (status !== "Completed" || auction.auction_status === "Completed") return;
    closedRef.current = true;
    void maybeAutoComplete(auction)
      .then(() => invalidateAuction())
      .catch(() => {
        closedRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.name, status, auction?.auction_status]);

  /* Flash animation whenever the lowest bid changes. */
  const prevLowest = useRef(lowest);
  useEffect(() => {
    if (auction && prevLowest.current !== lowest) {
      prevLowest.current = lowest;
      setFlash(true);
      if (flashRef.current) window.clearTimeout(flashRef.current);
      flashRef.current = window.setTimeout(() => setFlash(false), 800);
    }
  }, [lowest, auction]);

  const serverOffset = useServerTimeOffset();
  const countdownTarget = useMemo(() => {
    if (!auction) return null;
    if (status === "Live") return parseErpDateTime(auction.end_date_time);
    if (status === "Scheduled") return parseErpDateTime(auction.start_date_time);
    return null;
  }, [auction, status]);
  const countdown = useCountdown(countdownTarget, serverOffset);

  // Enterprise countdown alerts (beeps + red/pulse/scale) only while live.
  const alerts = useAuctionCountdownAlerts({
    msRemaining: countdown.msRemaining,
    active: status === "Live",
  });
  // Freeze bidding the instant the clock hits zero, even before the status
  // flip / next refetch lands (belt-and-suspenders with the Live gate).
  const biddingFrozen = status !== "Live" || countdown.msRemaining <= 0;

  const invalidateAuction = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-auction", name] });
    queryClient.invalidateQueries({ queryKey: ["supplier-auctions"] });
  };

  const bid = useMutation({
    mutationFn: () =>
      submitBid({ auctionName: name, supplier: supplierName, amount: Number(amount) }),
    onSuccess: () => {
      toast.success(t("reverseBidding.bidSubmitted"));
      setAmount("");
      invalidateAuction();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("reverseBidding.bidRejected")),
  });

  const itemBid = useMutation({
    mutationFn: (items: ItemBidInput[]) =>
      submitItemBids({ auctionName: name, supplier: supplierName, items }),
    onSuccess: () => {
      toast.success(t("reverseBidding.itemBidsSubmitted"));
      setItemBids({});
      invalidateAuction();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : t("reverseBidding.bidRejected")),
  });

  if (isReady && !isAuthenticated) {
    return (
      <SupplierPortalLayout>
        <SupplierAccessDenied
          title={t("reverseBidding.signInRequired")}
          description={t("reverseBidding.signInToParticipate")}
        />
      </SupplierPortalLayout>
    );
  }

  if (query.isLoading || !auction) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <div className="table-shell">
          <TableSkeleton rows={4} columns={2} />
        </div>
      </SupplierPortalLayout>
    );
  }

  if (!supplierIsInvited(auction, supplierName)) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <SupplierAccessDenied
          title={t("reverseBidding.notInvited")}
          description={t("reverseBidding.notInvitedDesc")}
        />
      </SupplierPortalLayout>
    );
  }

  const mine = (auction.invited_suppliers ?? []).find((s) =>
    sameSupplier(s.supplier, supplierName)
  );
  const myBids = (auction.bid_history ?? [])
    .filter((b) => sameSupplier(b.supplier, supplierName))
    .sort(
      (a, b) => (parseErpDateTime(b.bid_time) ?? 0) - (parseErpDateTime(a.bid_time) ?? 0)
    );

  const decrement = auction.minimum_decrement ?? 0;
  const maxAllowed = decrement > 0 ? lowest - decrement : lowest;
  const isLeader = mine?.rank === 1;

  const check =
    amount !== "" ? validateBid(auction, supplierName, Number(amount)) : null;

  // Item-wise: this supplier's own item rows + per-item lowest across suppliers.
  const myItems = (auction.bid_items ?? []).filter((i) =>
    sameSupplier(i.supplier, supplierName)
  );
  const hasItems = myItems.length > 0;
  const lowestByItem = lowestRateByItem(auction.bid_items ?? []);

  const setItemBid = (code: string, value: string) =>
    setItemBids((prev) => ({ ...prev, [code]: value }));

  const enteredItemBids: ItemBidInput[] = Object.entries(itemBids)
    .map(([item_code, v]) => ({ item_code, rate: Number(v) }))
    .filter((b) => b.item_code && Number.isFinite(b.rate) && b.rate > 0);

  const anyItemInvalid = enteredItemBids.some((b) => {
    const v = validateItemBid(auction, supplierName, b.item_code, b.rate);
    return !v.ok;
  });

  const winnerPending =
    status === "Completed" &&
    !auction.winning_supplier &&
    !(auction.winner_price ?? auction.lowest_bid);

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <AuctionCountdownAlert
          phase={alerts.phase}
          secondsLeft={alerts.secondsLeft}
          closed={status === "Completed"}
        />
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-neutral-900">
            <Gavel className="h-5 w-5 text-primary" />
            {auction.name}
          </h1>
          <p className="text-sm text-neutral-500">{t("reverseBidding.rfqPrefix")} {auction.rfq}</p>
        </div>
        <AuctionStatusBadge status={status} />
      </div>

      {/* Live band */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div
          className={`rounded-xl border p-4 transition-colors ${
            flash
              ? "border-emerald-400 bg-emerald-50"
              : "border-neutral-200 bg-white"
          }`}
        >
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
            <TrendingDown className="h-3.5 w-3.5" />
            {t("reverseBidding.currentLowestBid")}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">
            {lowest > 0 ? formatCurrencyIn(lowest, auction.currency) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {status === "Live"
              ? t("reverseBidding.auctionEndsIn")
              : status === "Scheduled"
                ? t("reverseBidding.auctionStartsIn")
                : status === "Completed"
                  ? t("reverseBidding.auctionLabel")
                  : t("reverseBidding.statusLabel")}
          </p>
          <p
            className={`mt-1 inline-block text-2xl font-bold tabular-nums text-neutral-900 ${
              status === "Live" ? countdownPhaseClass(alerts.phase) : ""
            }`}
          >
            {status === "Live" || status === "Scheduled"
              ? countdown.label
              : status === "Completed"
                ? t("reverseBidding.closedLabel")
                : t("reverseBidding.notScheduled")}
          </p>
        </div>
        <div
          className={`rounded-xl border p-4 ${
            isLeader
              ? "border-emerald-300 bg-emerald-50"
              : "border-neutral-200 bg-white"
          }`}
        >
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
            <Trophy className="h-3.5 w-3.5" />
            {t("reverseBidding.yourRank")}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">
            {mine?.rank ? `#${mine.rank}` : "—"}
            {isLeader && (
              <span className="ml-2 text-xs font-semibold text-emerald-600">
                {t("reverseBidding.leading")}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Bidding form */}
      {status === "Live" ? (
        hasItems ? (
          /* ── Item-wise bidding sheet ─────────────────────────────────── */
          <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-sm font-semibold text-neutral-800">
              {t("reverseBidding.submitYourItemPrices")}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {decrement > 0
                ? t("reverseBidding.itemPricesHintDecrement", {
                    amount: formatCurrencyIn(decrement, auction.currency),
                  })
                : t("reverseBidding.itemPricesHint")}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                    <th className="pb-2 text-left">{t("reverseBidding.item")}</th>
                    <th className="pb-2 text-right">{t("reverseBidding.qty")}</th>
                    <th className="pb-2 text-right">{t("reverseBidding.yourPrice")}</th>
                    <th className="pb-2 text-right">{t("reverseBidding.currentLowest")}</th>
                    <th className="pb-2 text-right">{t("reverseBidding.target")}</th>
                    <th className="pb-2 text-right">{t("reverseBidding.newBid")}</th>
                  </tr>
                </thead>
                <tbody>
                  {myItems.map((it) => {
                    const itemLowest =
                      lowestByItem.get(it.item_code) ?? it.current_rate ?? 0;
                    const value = itemBids[it.item_code] ?? "";
                    const parsed = Number(value);
                    const v =
                      value !== "" && Number.isFinite(parsed)
                        ? validateItemBid(
                            auction,
                            supplierName,
                            it.item_code,
                            parsed
                          )
                        : null;
                    const isLow =
                      (it.current_rate ?? 0) > 0 &&
                      it.current_rate === itemLowest;
                    return (
                      <tr
                        key={it.item_code}
                        className="border-t border-neutral-100 align-top"
                      >
                        <td className="py-2 pr-2">
                          <div className="font-medium text-neutral-800">
                            {it.item_name ?? it.item_code}
                          </div>
                          <div className="text-[11px] text-neutral-400">
                            {it.item_code}
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums text-neutral-500">
                          {it.qty ?? 0} {it.uom ?? ""}
                        </td>
                        <td className="py-2 text-right tabular-nums font-semibold text-neutral-900">
                          {it.current_rate
                            ? formatCurrencyIn(it.current_rate, auction.currency)
                            : "—"}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            isLow
                              ? "font-bold text-emerald-600"
                              : "text-neutral-600"
                          }`}
                        >
                          {itemLowest > 0
                            ? formatCurrencyIn(itemLowest, auction.currency)
                            : "—"}
                          {isLow && (
                            <span className="ml-1 text-[10px] font-semibold text-emerald-600">
                              {t("reverseBidding.you")}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums text-primary">
                          {(it.target_rate ?? 0) > 0
                            ? formatCurrencyIn(it.target_rate ?? 0, auction.currency)
                            : "—"}
                        </td>
                        <td className="py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={value}
                            disabled={biddingFrozen}
                            onChange={(e) =>
                              setItemBid(it.item_code, e.target.value)
                            }
                            className="input-field w-28 text-right disabled:cursor-not-allowed disabled:bg-neutral-100"
                            placeholder={
                              decrement > 0
                                ? String(Math.max(0, itemLowest - decrement))
                                : "0.00"
                            }
                          />
                          {v && !v.ok && (
                            <p className="mt-1 text-[10px] font-medium text-rose-600">
                              {v.reason}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-end gap-3">
              {enteredItemBids.length > 0 && (
                <span className="text-xs text-neutral-500">
                  {t("reverseBidding.itemsToSubmit", {
                    count: enteredItemBids.length,
                  })}
                </span>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={
                  itemBid.isPending ||
                  enteredItemBids.length === 0 ||
                  anyItemInvalid ||
                  biddingFrozen
                }
                onClick={() => itemBid.mutate(enteredItemBids)}
              >
                <Gavel className="h-4 w-4" />
                {itemBid.isPending
                  ? t("common.submitting")
                  : t("reverseBidding.submitItemBids")}
              </button>
            </div>
          </div>
        ) : (
          /* ── Legacy total-amount bidding (auctions without item rows) ── */
          <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-sm font-semibold text-neutral-800">{t("reverseBidding.placeABid")}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {decrement > 0
                ? t("reverseBidding.bidHintDecrement", {
                    amount: formatCurrencyIn(decrement, auction.currency),
                    max: formatCurrencyIn(maxAllowed, auction.currency),
                  })
                : t("reverseBidding.bidHint")}
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-neutral-600">
                  {t("reverseBidding.bidAmount", { currency: auction.currency })}
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  disabled={biddingFrozen}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input-field w-48 disabled:cursor-not-allowed disabled:bg-neutral-100"
                  placeholder={maxAllowed > 0 ? String(maxAllowed) : "0.00"}
                />
              </label>
              <button
                type="button"
                className="btn-primary"
                disabled={bid.isPending || (check ? !check.ok : true) || biddingFrozen}
                onClick={() => bid.mutate()}
              >
                <Gavel className="h-4 w-4" />
                {bid.isPending ? t("common.submitting") : t("reverseBidding.submitBid")}
              </button>
            </div>
            {check && !check.ok && amount !== "" && (
              <p className="mt-2 text-xs font-medium text-rose-600">
                {check.reason}
              </p>
            )}
          </div>
        )
      ) : status === "Scheduled" ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-800">
          <p className="font-semibold">{t("reverseBidding.auctionScheduled")}</p>
          <p className="mt-1 text-blue-700">
            {t("reverseBidding.biddingOpensAt", {
              date: formatDateTime(auction.start_date_time),
            })}
          </p>
        </div>
      ) : status === "Completed" ? (
        <div className="mt-4 space-y-3">
          {winnerPending && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
              <span className="inline-block h-2 w-2 animate-ping rounded-full bg-amber-500" />
              {t("reverseBidding.winnerCalculating", {
                defaultValue: "Auction closed — winner is being finalized…",
              })}
            </div>
          )}
          <div
            className={`rounded-xl border p-4 ${
              sameSupplier(auction.winning_supplier, supplierName)
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-neutral-200 bg-neutral-50 text-neutral-700"
            }`}
          >
            <p className="text-sm font-semibold">
              {sameSupplier(auction.winning_supplier, supplierName)
                ? t("reverseBidding.congratsWon")
                : t("reverseBidding.auctionClosedMsg")}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-neutral-400">{t("reverseBidding.yourFinalRank")}</dt>
                <dd className="font-bold tabular-nums">
                  {mine?.rank ? `#${mine.rank}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-400">{t("reverseBidding.yourFinalBid")}</dt>
                <dd className="font-bold tabular-nums">
                  {mine?.current_bid
                    ? formatCurrencyIn(mine.current_bid, auction.currency)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-400">{t("reverseBidding.winningBid")}</dt>
                <dd className="font-bold tabular-nums text-emerald-600">
                  {auction.winner_price || auction.lowest_bid
                    ? formatCurrencyIn(
                        auction.winner_price ?? auction.lowest_bid ?? 0,
                        auction.currency
                      )
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-400">{t("reverseBidding.result")}</dt>
                <dd className="font-bold">
                  {sameSupplier(auction.winning_supplier, supplierName)
                    ? t("reverseBidding.won")
                    : mine?.current_bid
                      ? t("reverseBidding.notSelected")
                      : t("reverseBidding.noBid")}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
          {t("reverseBidding.auctionNotScheduled")}
        </div>
      )}

      {/* Your own bid history (competitor bids are never shown) */}
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-neutral-800">
          {t("reverseBidding.yourBidsCount", { count: myBids.length })}
        </p>
        {myBids.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {t("reverseBidding.noBidYet")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                  <th className="pb-2 text-left">{t("reverseBidding.time")}</th>
                  <th className="pb-2 text-center">{t("reverseBidding.round")}</th>
                  <th className="pb-2 text-left">{t("reverseBidding.item")}</th>
                  <th className="pb-2 text-right">{t("reverseBidding.previous")}</th>
                  <th className="pb-2 text-right">{t("reverseBidding.newBid")}</th>
                  <th className="pb-2 text-right">{t("reverseBidding.reduction")}</th>
                </tr>
              </thead>
              <tbody>
                {myBids.map((b, i) => (
                  <tr
                    key={`${b.bid_time}-${b.item_code ?? ""}-${i}`}
                    className="border-t border-neutral-100"
                  >
                    <td className="py-2 text-neutral-600">
                      {b.bid_time ? formatDateTime(b.bid_time) : "—"}
                    </td>
                    <td className="py-2 text-center tabular-nums text-neutral-500">
                      {b.round_number ?? "—"}
                    </td>
                    <td className="py-2 text-neutral-700">
                      {b.item_name ?? b.item_code ?? t("reverseBidding.allItems")}
                    </td>
                    <td className="py-2 text-right tabular-nums text-neutral-500">
                      {(b.previous_rate ?? 0) > 0
                        ? formatCurrencyIn(b.previous_rate ?? 0, auction.currency)
                        : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold text-neutral-900">
                      {formatCurrencyIn(b.bid_amount, auction.currency)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-emerald-600">
                      {(b.reduction_amount ?? 0) > 0
                        ? formatCurrencyIn(b.reduction_amount ?? 0, auction.currency)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SupplierPortalLayout>
  );
}
