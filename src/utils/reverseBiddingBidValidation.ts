/**
 * Shared reverse-auction item bid validation (client + server).
 * ERPNext often returns child-table rates as strings — always coerce to numbers.
 */

export type BidRejectReasonCode =
  | "outbid"
  | "decrement"
  | "own_bid"
  | "not_live"
  | "not_invited"
  | "missing_item"
  | "invalid_rate"
  | "other";

export function toBidRate(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Compare bid rates as currency cents to avoid float drift. */
export function bidRateCents(value: unknown): number {
  return Math.round(toBidRate(value) * 100);
}

export function bidRateLess(a: number, b: number): boolean {
  return bidRateCents(a) < bidRateCents(b);
}

export function bidRateGreaterOrEqual(a: number, b: number): boolean {
  return bidRateCents(a) >= bidRateCents(b);
}

export function isItemLeader(ownCurrent: number, currentLowest: number): boolean {
  if (!(ownCurrent > 0) || !(currentLowest > 0)) return false;
  return bidRateCents(ownCurrent) <= bidRateCents(currentLowest);
}

export function formatBidOutbidMessage(
  submittedRate: number,
  latestLowest: number,
  formatAmount: (value: number) => string,
): string {
  return `Your submitted bid (${formatAmount(submittedRate)}) is higher than the latest lowest bid (${formatAmount(latestLowest)}). The auction has been updated. Please review the latest prices and submit a new bid.`;
}

export function formatBidDecrementMessage(
  submittedRate: number,
  maxAllowed: number,
  latestLowest: number,
  formatAmount: (value: number) => string,
): string {
  return `Your submitted bid (${formatAmount(submittedRate)}) must be at most ${formatAmount(maxAllowed)} — at least one decrement step below the latest lowest bid (${formatAmount(latestLowest)}). The auction has been updated. Please review the latest prices and submit a new bid.`;
}

export type ItemBidValidationResult = {
  ok: boolean;
  reason?: string;
  reasonCode?: BidRejectReasonCode;
  submittedRate?: number;
  currentLowest: number;
  maxAllowed: number;
  ownCurrent: number;
  isLeader: boolean;
};

type BidItemRow = {
  item_code?: string;
  supplier?: string;
  current_rate?: unknown;
  qty?: unknown;
};

/** Lowest current rate per item_code across all suppliers (rate > 0 only). */
export function lowestRateByItemFromRows(items: BidItemRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    const code = String(it.item_code ?? "").trim();
    if (!code) continue;
    const rate = toBidRate(it.current_rate);
    if (!(rate > 0)) continue;
    const prev = map.get(code);
    if (prev == null || bidRateLess(rate, prev)) map.set(code, rate);
  }
  return map;
}

export function validateItemBidCore(input: {
  derivedAuctionStatus: string;
  supplierInvited: boolean;
  items: BidItemRow[];
  supplier: string;
  itemCode: string;
  rate: number;
  minimumDecrement: unknown;
  sameSupplier: (a: string | undefined, b: string | undefined) => boolean;
  formatAmount?: (value: number) => string;
}): ItemBidValidationResult {
  const itemCode = String(input.itemCode ?? "").trim();
  const rate = toBidRate(input.rate);
  const decrement = toBidRate(input.minimumDecrement);
  const fmt =
    input.formatAmount ??
    ((value: number) => `$${value.toFixed(2)}`);

  const own = input.items.find(
    (i) =>
      String(i.item_code ?? "").trim() === itemCode &&
      input.sameSupplier(i.supplier, input.supplier),
  );
  const lowestMap = lowestRateByItemFromRows(input.items);
  const currentLowest = lowestMap.get(itemCode) ?? toBidRate(own?.current_rate);
  const ownCurrent = toBidRate(own?.current_rate);
  const leader = isItemLeader(ownCurrent, currentLowest);
  const maxAllowed = leader
    ? ownCurrent
    : currentLowest > 0
      ? decrement > 0
        ? toBidRate(currentLowest - decrement)
        : currentLowest
      : ownCurrent > 0
        ? ownCurrent
        : Number.POSITIVE_INFINITY;

  const base = {
    currentLowest,
    maxAllowed,
    ownCurrent,
    isLeader: leader,
    submittedRate: rate,
  };

  if (input.derivedAuctionStatus !== "Live") {
    return {
      ok: false,
      reason: "The auction is not live.",
      reasonCode: "not_live",
      ...base,
    };
  }
  if (!input.supplierInvited) {
    return {
      ok: false,
      reason: "You are not invited to this reverse auction.",
      reasonCode: "not_invited",
      ...base,
    };
  }
  if (!own) {
    return {
      ok: false,
      reason: "This item is not part of your bid sheet.",
      reasonCode: "missing_item",
      ...base,
    };
  }
  if (!(rate > 0)) {
    return {
      ok: false,
      reason: "Rate must be greater than zero.",
      reasonCode: "invalid_rate",
      ...base,
    };
  }
  if (ownCurrent > 0 && bidRateGreaterOrEqual(rate, ownCurrent)) {
    return {
      ok: false,
      reason: "Your bid must be lower than your previous bid.",
      reasonCode: "own_bid",
      ...base,
    };
  }
  if (!leader) {
    if (currentLowest > 0 && bidRateGreaterOrEqual(rate, currentLowest)) {
      return {
        ok: false,
        reason: formatBidOutbidMessage(rate, currentLowest, fmt),
        reasonCode: "outbid",
        ...base,
      };
    }
    if (
      currentLowest > 0 &&
      decrement > 0 &&
      bidRateCents(rate) > bidRateCents(maxAllowed) &&
      bidRateLess(rate, currentLowest)
    ) {
      return {
        ok: false,
        reason: formatBidDecrementMessage(rate, maxAllowed, currentLowest, fmt),
        reasonCode: "decrement",
        ...base,
      };
    }
  }
  return { ok: true, ...base };
}

type RecomputeBidItem = BidItemRow & {
  amount?: number;
  rank?: number;
  is_lowest?: 0 | 1;
  status?: string;
};

/** Recompute per-item amount, rank, is_lowest, and status after rate changes. */
export function recomputeBidItemState<T extends RecomputeBidItem>(
  items: T[],
  opts: { live?: boolean } = {},
): T[] {
  const byItem = new Map<string, T[]>();
  for (const it of items) {
    const code = String(it.item_code ?? "").trim();
    const list = byItem.get(code) ?? [];
    list.push(it);
    byItem.set(code, list);
  }
  const rankOf = new Map<T, number>();
  const lowestFlag = new Map<T, boolean>();
  for (const [, rows] of byItem) {
    const ranked = [...rows]
      .filter((r) => toBidRate(r.current_rate) > 0)
      .sort((a, b) => bidRateCents(a.current_rate) - bidRateCents(b.current_rate));
    const min = ranked[0] ? toBidRate(ranked[0].current_rate) : 0;
    ranked.forEach((r, i) => rankOf.set(r, i + 1));
    for (const r of rows) {
      const rowRate = toBidRate(r.current_rate);
      lowestFlag.set(
        r,
        rowRate > 0 && bidRateCents(rowRate) === bidRateCents(min),
      );
    }
  }

  return items.map((it) => {
    const rowRate = toBidRate(it.current_rate);
    const qty = toBidRate(it.qty);
    const rank = rankOf.get(it) ?? 0;
    const isLowest = lowestFlag.get(it) ?? false;
    let status: string;
    if (rowRate <= 0) {
      status = "Waiting";
    } else if (isLowest) {
      status = "Leading";
    } else {
      status = opts.live ? "Outbid" : "Active";
    }
    return {
      ...it,
      amount: rowRate * qty,
      rank,
      is_lowest: (isLowest ? 1 : 0) as 0 | 1,
      status,
    };
  });
}
