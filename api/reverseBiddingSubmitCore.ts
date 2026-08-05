/**
 * Supplier Portal — privileged Reverse Bidding item bid submission.
 *
 * Supplier identity comes from the authenticated JWT (never the request body).
 * ERP writes use the admin API key so suppliers are not blocked by DocType
 * config endpoints or missing child-table permissions.
 */
import { randomUUID } from "node:crypto";
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import { ensureReverseBiddingChildNaming } from "./reverseBiddingNamingCore.js";
import { formatERPNextDatetime } from "../src/utils/erpNextDate.js";
import {
  recomputeBidItemState,
  toBidRate,
  validateItemBidCore,
  type ItemBidValidationResult,
} from "../src/utils/reverseBiddingBidValidation.js";
import {
  extractErrorMessage,
  isRetryableSaveError,
  isTimestampConflictError,
  REVERSE_BID_MAX_SAVE_ATTEMPTS,
  type ClientBidSnapshot,
} from "../src/utils/reverseBiddingSubmitHelpers.js";

const RB_DOCTYPE = "Reverse Bidding";
const RB_BID_DOCTYPE = "Reverse Bids";

export class ReverseBiddingSubmitError extends Error {
  status: number;
  submittedBid?: number;
  latestLowestBid?: number;
  itemCode?: string;
  reasonCode?: string;
  auction?: ReverseBiddingDoc;

  constructor(
    message: string,
    status = 400,
    details?: {
      submittedBid?: number;
      latestLowestBid?: number;
      itemCode?: string;
      reasonCode?: string;
      auction?: ReverseBiddingDoc;
    },
  ) {
    super(message);
    this.name = "ReverseBiddingSubmitError";
    this.status = status;
    this.submittedBid = details?.submittedBid;
    this.latestLowestBid = details?.latestLowestBid;
    this.itemCode = details?.itemCode;
    this.reasonCode = details?.reasonCode;
    this.auction = details?.auction;
  }
}

type ErpAdminConfig = { baseUrl: string; key: string; secret: string };

type ItemBidInput = { item_code: string; rate: number };

type ReverseBidItem = {
  name?: string;
  doctype?: string;
  supplier?: string;
  item_code?: string;
  item_name?: string;
  qty?: number;
  current_rate?: number;
  latest_rate?: number;
  amount?: number;
  bid_time?: string;
  round_number?: number;
  rank?: number;
  is_lowest?: 0 | 1;
  status?: string;
};

type ReverseBid = {
  name?: string;
  doctype?: string;
  supplier?: string;
  item_code?: string;
  item_name?: string;
  bid_amount?: number;
  previous_rate?: number;
  reduction_amount?: number;
  reduction_pct?: number;
  bid_time?: string;
  round_number?: number;
  status?: string;
};

type ReverseBiddingSupplier = {
  name?: string;
  doctype?: string;
  supplier?: string;
  current_bid?: number;
  joined_auction?: 0 | 1;
  invitation_status?: string;
  rank?: number;
};

type ReverseBiddingDoc = {
  name: string;
  rfq?: string;
  modified?: string;
  auction_status?: string;
  start_date_time?: string;
  end_date_time?: string;
  minimum_decrement?: number;
  lowest_bid?: number;
  currency?: string;
  bid_items?: ReverseBidItem[];
  bid_history?: ReverseBid[];
  invited_suppliers?: ReverseBiddingSupplier[];
};

function readErpAdminConfig(): ErpAdminConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!baseUrl || !key || !secret) {
    throw new ReverseBiddingSubmitError(
      "Reverse bidding backend misconfigured.",
      500,
    );
  }
  return { baseUrl, key, secret };
}

function normSupplier(v: string | undefined | null): string {
  return (v ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .toLowerCase();
}

function sameSupplier(a: string | undefined, b: string | undefined): boolean {
  const na = normSupplier(a);
  const nb = normSupplier(b);
  return na.length > 0 && na === nb;
}

function parseErpDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function deriveAuctionStatus(
  doc: Pick<
    ReverseBiddingDoc,
    "auction_status" | "start_date_time" | "end_date_time"
  >,
  now = Date.now(),
): string {
  const persisted = doc.auction_status ?? "Draft";
  if (persisted === "Draft" || persisted === "Cancelled" || persisted === "Completed") {
    return persisted;
  }
  const start = parseErpDateTime(doc.start_date_time);
  const end = parseErpDateTime(doc.end_date_time);
  if (start == null || end == null) return persisted;
  if (now >= end) return "Completed";
  if (now >= start) return "Live";
  return "Scheduled";
}

function formatServerAmount(value: number, currency?: string): string {
  const code = (currency ?? "USD").trim() || "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function validateItemBid(
  doc: ReverseBiddingDoc,
  supplier: string,
  itemCode: string,
  rate: number,
): ItemBidValidationResult {
  return validateItemBidCore({
    derivedAuctionStatus: deriveAuctionStatus(doc),
    supplierInvited: supplierIsInvited(doc, supplier),
    items: doc.bid_items ?? [],
    supplier,
    itemCode,
    rate: toBidRate(rate),
    minimumDecrement: doc.minimum_decrement,
    sameSupplier,
    formatAmount: (value) => formatServerAmount(value, doc.currency),
  });
}

function supplierTotalsFromItems(items: ReverseBidItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    const amt = toBidRate(it.current_rate) * toBidRate(it.qty);
    map.set(String(it.supplier), (map.get(String(it.supplier)) ?? 0) + amt);
  }
  return map;
}

function recomputeRanks(
  suppliers: ReverseBiddingSupplier[],
): ReverseBiddingSupplier[] {
  const withBid = suppliers
    .filter((s) => toBidRate(s.current_bid) > 0)
    .sort((a, b) => toBidRate(a.current_bid) - toBidRate(b.current_bid));
  const rankBySupplier = new Map<string, number>();
  withBid.forEach((s, i) => rankBySupplier.set(String(s.supplier), i + 1));
  return suppliers.map((s) => ({
    ...s,
    rank: rankBySupplier.get(String(s.supplier)) ?? 0,
  }));
}

function bidValues(suppliers: ReverseBiddingSupplier[]): number[] {
  return suppliers
    .map((s) => toBidRate(s.current_bid))
    .filter((v) => v > 0);
}

function isPersistedChildRow(name?: string): boolean {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 && !trimmed.startsWith("new-");
}

function extractErpErrorMessage(json: unknown, fallback: string): string {
  const data = (json ?? {}) as {
    exception?: string;
    message?: string | { message?: string };
    _server_messages?: string;
  };
  if (data._server_messages) {
    try {
      const parsed = JSON.parse(data._server_messages) as string[];
      const first = parsed[0] ? JSON.parse(parsed[0]) : null;
      if (first?.message) return String(first.message);
    } catch {
      /* keep */
    }
  }
  if (typeof data.exception === "string" && data.exception.trim()) {
    return data.exception.replace(/^[^:]+:\s*/, "").trim();
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  return fallback;
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown; search?: Record<string, string> },
): Promise<T> {
  const qs = init?.search
    ? `?${new URLSearchParams(init.search).toString()}`
    : "";
  const url = `${cfg.baseUrl}/api/${path}${qs}`;
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `token ${cfg.key}:${cfg.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body:
      init?.body !== undefined
        ? JSON.stringify(sanitizeErpPayloadDates(init.body))
        : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = extractErpErrorMessage(
      json,
      text || `ERPNext request failed (${res.status})`,
    );
    throw new ReverseBiddingSubmitError(
      res.status === 409 ? `${msg} (HTTP 409 Conflict)` : msg,
      res.status || 502,
    );
  }
  const wrapped = json as { data?: T; message?: T };
  return (
    wrapped?.data !== undefined
      ? wrapped.data
      : wrapped?.message !== undefined
        ? wrapped.message
        : (json as T)
  );
}

async function loadAuction(
  cfg: ErpAdminConfig,
  name: string,
): Promise<ReverseBiddingDoc> {
  const doc = await erpFetch<ReverseBiddingDoc>(
    cfg,
    `resource/${encodeURIComponent(RB_DOCTYPE)}/${encodeURIComponent(name)}`,
  );
  if (!doc?.name) {
    throw new ReverseBiddingSubmitError(
      `Reverse auction "${name}" was not found.`,
      404,
    );
  }
  return doc;
}

function logBidSaveOperation(details: Record<string, unknown>): void {
  console.info("[reverse-bidding-submit] bid save", details);
}

function supplierIsInvited(doc: ReverseBiddingDoc, supplier: string): boolean {
  return (doc.invited_suppliers ?? []).some((s) =>
    sameSupplier(s.supplier, supplier),
  );
}

function bidItemRowChanged(before: ReverseBidItem, after: ReverseBidItem): boolean {
  return (
    toBidRate(before.current_rate) !== toBidRate(after.current_rate) ||
    toBidRate(before.amount) !== toBidRate(after.amount) ||
    toBidRate(before.latest_rate) !== toBidRate(after.latest_rate) ||
    (before.rank ?? 0) !== (after.rank ?? 0) ||
    (before.is_lowest ?? 0) !== (after.is_lowest ?? 0) ||
    (before.round_number ?? 0) !== (after.round_number ?? 0) ||
    (before.status ?? "") !== (after.status ?? "")
  );
}

function supplierRowChanged(
  before: ReverseBiddingSupplier,
  after: ReverseBiddingSupplier,
): boolean {
  return (
    toBidRate(before.current_bid) !== toBidRate(after.current_bid) ||
    (before.rank ?? 0) !== (after.rank ?? 0) ||
    (before.joined_auction ?? 0) !== (after.joined_auction ?? 0) ||
    (before.invitation_status ?? "") !== (after.invitation_status ?? "")
  );
}

async function saveChildDocument(
  cfg: ErpAdminConfig,
  doc: Record<string, unknown>,
): Promise<void> {
  const payload = { ...doc };
  delete payload.creation;
  delete payload.modified;
  delete payload.modified_by;
  delete payload.owner;
  delete payload.docstatus;
  await erpFetch(cfg, "method/frappe.client.save", {
    method: "POST",
    body: { doc: payload },
  });
}

async function insertChildDocument(
  cfg: ErpAdminConfig,
  doc: Record<string, unknown>,
): Promise<void> {
  const payload = { ...doc };
  delete payload.name;
  delete payload.creation;
  delete payload.modified;
  delete payload.modified_by;
  delete payload.owner;
  delete payload.docstatus;
  await erpFetch(cfg, "method/frappe.client.insert", {
    method: "POST",
    body: { doc: payload },
  });
}

/**
 * Persist bid changes row-by-row instead of replacing the full parent document.
 * Avoids optimistic-lock failures on `modified` when the auction is polled concurrently.
 */
async function persistBidChangesIncremental(
  cfg: ErpAdminConfig,
  doc: ReverseBiddingDoc,
  supplier: string,
  clean: ItemBidInput[],
  payload: ReturnType<typeof buildSavePayload>,
  txId: string,
  attempt: number,
): Promise<void> {
  const rateByItem = new Map(clean.map((l) => [l.item_code, toBidRate(l.rate)]));
  const beforeItems = new Map(
    (doc.bid_items ?? [])
      .filter((r) => isPersistedChildRow(r.name))
      .map((r) => [String(r.name), r]),
  );

  for (const row of payload.bid_items) {
    if (!isPersistedChildRow(row.name)) continue;
    const before = beforeItems.get(String(row.name));
    if (before && !bidItemRowChanged(before, row)) continue;

    const submittedBid = sameSupplier(row.supplier, supplier)
      ? rateByItem.get(String(row.item_code))
      : undefined;

    logBidSaveOperation({
      transactionId: txId,
      attempt,
      action: submittedBid != null ? "update_bid_item" : "update_bid_item_rank",
      auctionId: doc.name,
      itemId: row.item_code,
      supplierId: row.supplier,
      existingBid: toBidRate(before?.current_rate),
      submittedBid: submittedBid ?? null,
      databaseVersion: doc.modified,
      rowName: row.name,
    });

    await saveChildDocument(cfg, {
      ...row,
      doctype: "Reverse Bid Item",
      name: row.name,
      parent: doc.name,
      parenttype: RB_DOCTYPE,
      parentfield: "bid_items",
    });
  }

  const prevHistoryLen = (doc.bid_history ?? []).length;
  const newHistoryRows = payload.bid_history.slice(prevHistoryLen);
  for (const [i, row] of newHistoryRows.entries()) {
    logBidSaveOperation({
      transactionId: txId,
      attempt,
      action: "insert_bid_history",
      auctionId: doc.name,
      itemId: row.item_code,
      supplierId: row.supplier,
      submittedBid: toBidRate(row.bid_amount),
      existingBid: toBidRate(row.previous_rate),
      databaseVersion: doc.modified,
      historyIdx: prevHistoryLen + i + 1,
    });

    await insertChildDocument(cfg, {
      ...row,
      doctype: RB_BID_DOCTYPE,
      parent: doc.name,
      parenttype: RB_DOCTYPE,
      parentfield: "bid_history",
      idx: prevHistoryLen + i + 1,
    });
  }

  const beforeSuppliers = new Map(
    (doc.invited_suppliers ?? [])
      .filter((r) => isPersistedChildRow(r.name))
      .map((r) => [String(r.name), r]),
  );

  for (const row of payload.invited_suppliers) {
    if (!isPersistedChildRow(row.name)) continue;
    const before = beforeSuppliers.get(String(row.name));
    if (before && !supplierRowChanged(before, row)) continue;

    logBidSaveOperation({
      transactionId: txId,
      attempt,
      action: "update_supplier_rank",
      auctionId: doc.name,
      supplierId: row.supplier,
      existingBid: toBidRate(before?.current_bid),
      submittedBid: toBidRate(row.current_bid),
      databaseVersion: doc.modified,
      rowName: row.name,
      rank: row.rank,
    });

    await saveChildDocument(cfg, {
      ...row,
      doctype: "Reverse Bidding Supplier",
      name: row.name,
      parent: doc.name,
      parenttype: RB_DOCTYPE,
      parentfield: "invited_suppliers",
    });
  }

  if (toBidRate(doc.lowest_bid) !== toBidRate(payload.lowest_bid)) {
    logBidSaveOperation({
      transactionId: txId,
      attempt,
      action: "update_lowest_bid",
      auctionId: doc.name,
      supplierId: supplier,
      existingBid: toBidRate(doc.lowest_bid),
      submittedBid: toBidRate(payload.lowest_bid),
      databaseVersion: doc.modified,
    });

    await erpFetch(cfg, "method/frappe.client.set_value", {
      method: "POST",
      body: {
        doctype: RB_DOCTYPE,
        name: doc.name,
        fieldname: "lowest_bid",
        value: payload.lowest_bid,
      },
    });
  }
}

function supplierTotalLowest(doc: ReverseBiddingDoc): number {
  const totals = bidValues(doc.invited_suppliers ?? []);
  if (totals.length > 0) return Math.min(...totals);
  return toBidRate(doc.lowest_bid);
}

function logBidValidation(details: {
  phase: "pre-save" | "retry" | "post-conflict";
  attempt: number;
  auctionId: string;
  rfqId?: string;
  supplier: string;
  itemCode: string;
  submittedBid: number;
  backendItemLowest: number;
  backendTotalLowest: number;
  clientSnapshot?: ClientBidSnapshot;
}): void {
  const frontendItemLowest =
    details.clientSnapshot?.lowestByItem?.[details.itemCode];
  console.info("[reverse-bidding-submit] bid validation", {
    phase: details.phase,
    attempt: details.attempt,
    auctionId: details.auctionId,
    rfqId: details.rfqId,
    supplier: details.supplier,
    itemCode: details.itemCode,
    submittedBid: details.submittedBid,
    backendItemLowest: details.backendItemLowest,
    backendTotalLowest: details.backendTotalLowest,
    frontendDisplayedItemLowest: frontendItemLowest,
    frontendDisplayedTotalLowest: details.clientSnapshot?.totalLowest,
    frontendBackendItemDelta:
      frontendItemLowest != null
        ? details.backendItemLowest - frontendItemLowest
        : undefined,
  });
}

function buildSavePayload(
  doc: ReverseBiddingDoc,
  supplier: string,
  clean: ItemBidInput[],
): {
  bid_items: ReverseBidItem[];
  invited_suppliers: ReverseBiddingSupplier[];
  bid_history: ReverseBid[];
  lowest_bid: number | undefined;
} {
  const bidTime = formatERPNextDatetime(new Date()) ?? undefined;
  const rateByItem = new Map(clean.map((l) => [l.item_code, toBidRate(l.rate)]));
  const prevMaxRound = (doc.bid_history ?? [])
    .filter((b) => sameSupplier(b.supplier, supplier))
    .reduce((m, b) => Math.max(m, b.round_number ?? 0), 0);
  const round = prevMaxRound + 1;

  const prevRateByItem = new Map<string, { rate: number; name: string }>();
  for (const it of doc.bid_items ?? []) {
    if (sameSupplier(it.supplier, supplier)) {
      prevRateByItem.set(String(it.item_code), {
        rate: toBidRate(it.current_rate),
        name: it.item_name ?? String(it.item_code),
      });
    }
  }

  let items = (doc.bid_items ?? []).map((it) => {
    if (!sameSupplier(it.supplier, supplier)) return it;
    const newRate = rateByItem.get(String(it.item_code));
    if (newRate == null) return it;
    return {
      ...it,
      doctype: "Reverse Bid Item",
      current_rate: newRate,
      latest_rate: newRate,
      amount: newRate * toBidRate(it.qty),
      bid_time: bidTime,
      round_number: round,
    };
  });
  items = recomputeBidItemState(items, {
    live: deriveAuctionStatus(doc) === "Live",
  });

  const totals = supplierTotalsFromItems(items);
  const invited = (doc.invited_suppliers ?? []).map((s) => {
    const total = totals.get(String(s.supplier));
    if (sameSupplier(s.supplier, supplier)) {
      return {
        ...s,
        doctype: "Reverse Bidding Supplier",
        current_bid: total ?? s.current_bid,
        joined_auction: 1 as const,
        invitation_status:
          s.invitation_status === "Sent" ||
          s.invitation_status === "Pending" ||
          !s.invitation_status
            ? "Accepted"
            : s.invitation_status,
      };
    }
    return total != null ? { ...s, current_bid: total } : s;
  });
  const ranked = recomputeRanks(invited);

  const newHistoryRows: ReverseBid[] = clean.map((line) => {
    const prev = prevRateByItem.get(line.item_code);
    const previous = toBidRate(prev?.rate);
    const bidRate = toBidRate(line.rate);
    const reduction = previous > 0 ? previous - bidRate : 0;
    const reductionPct = previous > 0 ? (reduction / previous) * 100 : 0;
    return {
      doctype: RB_BID_DOCTYPE,
      supplier,
      item_code: line.item_code,
      item_name: prev?.name ?? line.item_code,
      bid_amount: bidRate,
      previous_rate: previous,
      reduction_amount: reduction > 0 ? reduction : 0,
      reduction_pct: reductionPct > 0 ? Number(reductionPct.toFixed(2)) : 0,
      bid_time: bidTime,
      round_number: round,
      status: "Accepted",
    };
  });

  const history: ReverseBid[] = [...(doc.bid_history ?? []), ...newHistoryRows];
  const bidTotals = bidValues(ranked);
  const lowest = bidTotals.length ? Math.min(...bidTotals) : doc.lowest_bid;

  return {
    bid_items: items,
    invited_suppliers: ranked,
    bid_history: history,
    lowest_bid: Number.isFinite(lowest as number) ? lowest : doc.lowest_bid,
  };
}

function validateAllItemBids(
  doc: ReverseBiddingDoc,
  supplier: string,
  clean: ItemBidInput[],
  opts: {
    phase: "pre-save" | "retry" | "post-conflict";
    attempt: number;
    clientSnapshot?: ClientBidSnapshot;
  },
): void {
  const backendTotalLowest = supplierTotalLowest(doc);
  for (const line of clean) {
    const rate = toBidRate(line.rate);
    const v = validateItemBid(doc, supplier, line.item_code, rate);
    logBidValidation({
      phase: opts.phase,
      attempt: opts.attempt,
      auctionId: doc.name,
      rfqId: doc.rfq,
      supplier,
      itemCode: line.item_code,
      submittedBid: rate,
      backendItemLowest: v.currentLowest,
      backendTotalLowest,
      clientSnapshot: opts.clientSnapshot,
    });
    if (!v.ok) {
      throw new ReverseBiddingSubmitError(v.reason ?? "Invalid bid.", 409, {
        submittedBid: rate,
        latestLowestBid: v.currentLowest,
        itemCode: line.item_code,
        reasonCode: v.reasonCode,
        auction: doc,
      });
    }
  }
}

export async function submitItemBidsCore(input: {
  auctionName: string;
  supplier: string;
  items: ItemBidInput[];
  clientSnapshot?: ClientBidSnapshot;
}): Promise<ReverseBiddingDoc> {
  const auctionName = input.auctionName.trim();
  const supplier = input.supplier.trim();
  if (!auctionName) {
    throw new ReverseBiddingSubmitError("Auction document name is missing.", 400);
  }
  if (!supplier) {
    throw new ReverseBiddingSubmitError("Supplier identity is missing.", 401);
  }

  await ensureReverseBiddingChildNaming();

  const cfg = readErpAdminConfig();
  let doc = await loadAuction(cfg, auctionName);

  console.log("[reverse-bidding-submit] loaded auction", {
    authenticatedSupplier: supplier,
    auctionId: doc.name,
    rfqId: doc.rfq,
    auctionStatus: doc.auction_status,
    derivedStatus: deriveAuctionStatus(doc),
    bidItems: (doc.bid_items ?? []).length,
    historyRows: (doc.bid_history ?? []).length,
  });

  if (!supplierIsInvited(doc, supplier)) {
    throw new ReverseBiddingSubmitError(
      "You are not invited to this reverse auction.",
      403,
    );
  }

  const ownItems = (doc.bid_items ?? []).filter((i) =>
    sameSupplier(i.supplier, supplier),
  );
  if (ownItems.length === 0) {
    throw new ReverseBiddingSubmitError(
      "Your bid sheet is not ready yet. Refresh the page and try again.",
      409,
    );
  }

  const clean = (input.items ?? []).filter(
    (i) => i.item_code && Number.isFinite(i.rate) && i.rate > 0,
  );
  if (clean.length === 0) {
    throw new ReverseBiddingSubmitError(
      "Enter at least one lower item price to submit.",
      400,
    );
  }

  const txId = randomUUID();
  let lastError: unknown;

  for (let attempt = 1; attempt <= REVERSE_BID_MAX_SAVE_ATTEMPTS; attempt += 1) {
    doc = await loadAuction(cfg, auctionName);
    const phase = attempt === 1 ? "pre-save" : "retry";

    validateAllItemBids(doc, supplier, clean, {
      phase,
      attempt,
      clientSnapshot: input.clientSnapshot,
    });

    const payload = buildSavePayload(doc, supplier, clean);
    const ownExistingBids = Object.fromEntries(
      (doc.bid_items ?? [])
        .filter((i) => sameSupplier(i.supplier, supplier))
        .map((i) => [String(i.item_code), toBidRate(i.current_rate)]),
    );

    logBidSaveOperation({
      transactionId: txId,
      attempt,
      phase: "start",
      auctionId: doc.name,
      rfqId: doc.rfq,
      supplierId: supplier,
      databaseVersion: doc.modified,
      existingBids: ownExistingBids,
      submittedBids: Object.fromEntries(
        clean.map((c) => [c.item_code, toBidRate(c.rate)]),
      ),
      backendTotalLowest: supplierTotalLowest(doc),
    });

    try {
      await persistBidChangesIncremental(
        cfg,
        doc,
        supplier,
        clean,
        payload,
        txId,
        attempt,
      );

      const saved = await loadAuction(cfg, auctionName);

      console.log("[reverse-bidding-submit] success", {
        transactionId: txId,
        authenticatedSupplier: supplier,
        auctionId: saved.name,
        rfqId: saved.rfq,
        attempt,
        lowest_bid: saved.lowest_bid,
        historyRows: (saved.bid_history ?? []).length,
      });

      return saved;
    } catch (err) {
      lastError = err;
      const httpStatus =
        err instanceof ReverseBiddingSubmitError ? err.status : undefined;
      const isConflict = isTimestampConflictError(err) || httpStatus === 409;

      console.warn("[reverse-bidding-submit] save failed", {
        transactionId: txId,
        auctionId: auctionName,
        attempt,
        httpStatus,
        isConflict,
        error: extractErrorMessage(err),
      });

      if (attempt >= REVERSE_BID_MAX_SAVE_ATTEMPTS || !isRetryableSaveError(err)) {
        if (err instanceof ReverseBiddingSubmitError) {
          throw err;
        }
        throw new ReverseBiddingSubmitError(extractErrorMessage(err), httpStatus ?? 502);
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw new ReverseBiddingSubmitError(
    extractErrorMessage(lastError) ||
      "Could not save your bid after retrying due to a server conflict.",
    lastError instanceof ReverseBiddingSubmitError
      ? lastError.status
      : 503,
    { auction: await loadAuction(cfg, auctionName), reasonCode: "other" },
  );
}
