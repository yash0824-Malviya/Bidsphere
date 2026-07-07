/**
 * Reverse Bidding (reverse auction) API + business logic.
 *
 * Backed entirely by the three EXISTING custom DocTypes (no new DocTypes are
 * created): "Reverse Bidding", "Reverse Bidding Supplier", "Reverse Bids".
 *
 * The auction lifecycle is driven by the `auction_status` Select field
 * (Draft → Scheduled → Live → Completed / Cancelled). The document is kept at
 * docstatus 0 for its whole life so its child tables (invited_suppliers,
 * bid_history) stay editable while bids arrive. Optimistic concurrency is
 * enforced on bid submission via ERPNext's `modified` timestamp.
 */
import {
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  COMPANY,
} from "./erpnext";
import { getRFQ, getSupplierQuotations } from "./sourcing";
import { createPurchaseOrder } from "./purchasing";
import { scoreSuppliers } from "./supplierScoringEngine";
import type { AIQuotation } from "./ai";
import { getSupplierPerformance } from "./supplierPerformance";
import { getLatestScoringResult } from "./supplierScoringResults";
import { submitForReview } from "./rfqApprovalWorkflow";
import {
  ensureLegalDocumentReviewForSelection,
  type LegalDocumentItemSummary,
} from "./legalDocs";
import { formatERPNextDatetime } from "../utils/erpNextDate";
import type { PurchaseOrder } from "../types/erpnext";
import type {
  AuctionStatus,
  BidItemStatus,
  InvitationStatus,
  ReverseBid,
  ReverseBidItem,
  ReverseBidding,
  ReverseBiddingSupplier,
} from "../types/reverseBidding";

const RB_DOCTYPE = "Reverse Bidding";
const RB_SUPPLIER_DOCTYPE = "Reverse Bidding Supplier";
const RB_BID_DOCTYPE = "Reverse Bids";
const RB_ITEM_DOCTYPE = "Reverse Bid Item";

/**
 * Naming series for the "Reverse Bidding" DocType (Auto Name = "By Naming
 * Series"). This MUST be sent in the insert payload — ERPNext generates the
 * document name from it (e.g. RB-2026-00001). Without it, `frappe.client.save`
 * fails with "Please set the document name".
 */
const RB_NAMING_SERIES = "RB-.YYYY.-.#####";

const DEFAULT_CURRENCY =
  (import.meta.env.VITE_DEFAULT_CURRENCY as string | undefined) || "USD";

/** Approval markers stored in `remarks` (no dedicated approval field exists). */
const APPROVED_TAG = "[RB:Approved]";
const REJECTED_TAG = "[RB:Rejected]";

/* ────────────────────────────────────────────────────────────────────────
 * Date helpers
 * ──────────────────────────────────────────────────────────────────────── */

/** Parse an ERPNext datetime string ("YYYY-MM-DD HH:mm:ss") to epoch ms. */
export function parseErpDateTime(
  value: string | null | undefined
): number | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Derive the effective auction status from persisted status + the clock.
 * A "Scheduled" auction becomes "Live" once start passes, and "Completed"
 * once end passes — without requiring a write until an action is taken.
 */
export function deriveAuctionStatus(
  doc: Pick<ReverseBidding, "auction_status" | "start_date_time" | "end_date_time">,
  now: number = Date.now()
): AuctionStatus {
  const persisted = doc.auction_status ?? "Draft";
  // Draft and terminal/explicit states are respected as-is — a Draft auction
  // NEVER auto-advances (and is never auto-marked Closed).
  if (persisted === "Draft" || persisted === "Cancelled" || persisted === "Completed") {
    return persisted;
  }

  const start = parseErpDateTime(doc.start_date_time);
  const end = parseErpDateTime(doc.end_date_time);
  // A full schedule (both start AND end) is required before the clock can move
  // the auction to Live or Closed. Without it, stay in the persisted state
  // (Scheduled) — never derive "Completed" from a partial/missing schedule.
  if (start == null || end == null) return persisted;

  if (now >= end) return "Completed";
  if (now >= start) return "Live";
  return "Scheduled";
}

/* ────────────────────────────────────────────────────────────────────────
 * Ranking / lowest-bid helpers
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Normalize a supplier identifier for comparison — trims whitespace, strips
 * surrounding quotes (some Supplier docnames contain literal quotes), and
 * lowercases. Ensures the supplier-portal session name reliably matches the
 * invited-supplier row regardless of formatting.
 */
function normalizeSupplierId(value: string | undefined | null): string {
  return (value ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .toLowerCase();
}

/** Whether two supplier identifiers refer to the same supplier. */
export function sameSupplier(
  a: string | undefined,
  b: string | undefined
): boolean {
  return normalizeSupplierId(a) === normalizeSupplierId(b);
}

/** Invitations that make an auction visible to the supplier portal. */
function isInvitationVisible(status: InvitationStatus | undefined): boolean {
  return status === "Sent" || status === "Accepted";
}

function bidValues(suppliers: ReverseBiddingSupplier[]): number[] {
  return suppliers
    .map((s) => (typeof s.current_bid === "number" ? s.current_bid : NaN))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Current lowest standing offer (bids + initial quotes fall back to starting price). */
export function currentLowestBid(doc: ReverseBidding): number {
  const values = bidValues(doc.invited_suppliers ?? []);
  if (values.length > 0) return Math.min(...values);
  if (typeof doc.lowest_bid === "number" && doc.lowest_bid > 0) return doc.lowest_bid;
  if (typeof doc.starting_price === "number" && doc.starting_price > 0) {
    return doc.starting_price;
  }
  return 0;
}

export interface BidHistorySummary {
  totalBids: number;
  currentRound: number;
  lowestBid: number;
  highestBid: number;
  lastBidTime?: string;
  lastBidSupplier?: string;
  avgReductionPct: number;
}

/**
 * Roll up the append-only bid history into the headline numbers shown above
 * the procurement Live Bid History table. Lowest/highest are the standing
 * supplier TOTALS; reduction % averages every recorded bid step.
 */
export function summarizeBidHistory(doc: ReverseBidding): BidHistorySummary {
  const rows = doc.bid_history ?? [];
  const totals = bidValues(doc.invited_suppliers ?? []);
  const sorted = [...rows].sort(
    (a, b) => (parseErpDateTime(a.bid_time) ?? 0) - (parseErpDateTime(b.bid_time) ?? 0)
  );
  const last = sorted[sorted.length - 1];
  const reductions = rows
    .map((r) => r.reduction_pct ?? 0)
    .filter((p) => p > 0);
  return {
    totalBids: rows.length,
    currentRound: rows.reduce((m, b) => Math.max(m, b.round_number ?? 0), 0),
    lowestBid: totals.length ? Math.min(...totals) : doc.lowest_bid ?? 0,
    highestBid: totals.length
      ? Math.max(...totals)
      : doc.starting_price ?? 0,
    lastBidTime: last?.bid_time,
    lastBidSupplier: last?.supplier,
    avgReductionPct: reductions.length
      ? reductions.reduce((a, b) => a + b, 0) / reductions.length
      : 0,
  };
}

/** Re-rank invited suppliers by current bid ascending (lowest = rank 1). */
function recomputeRanks(
  suppliers: ReverseBiddingSupplier[],
  field: "rank" | "final_rank" = "rank"
): ReverseBiddingSupplier[] {
  const withBid = suppliers
    .filter((s) => typeof s.current_bid === "number" && s.current_bid! > 0)
    .sort((a, b) => (a.current_bid ?? 0) - (b.current_bid ?? 0));
  const rankBySupplier = new Map<string, number>();
  withBid.forEach((s, i) => rankBySupplier.set(s.supplier, i + 1));
  return suppliers.map((s) => ({
    ...s,
    [field]: rankBySupplier.get(s.supplier) ?? 0,
  }));
}

/* ────────────────────────────────────────────────────────────────────────
 * Item-wise helpers (Reverse Bid Item)
 * ──────────────────────────────────────────────────────────────────────── */

/** Lowest current rate per item_code across all suppliers (rate > 0 only). */
export function lowestRateByItem(
  items: ReverseBidItem[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    const rate = it.current_rate ?? 0;
    if (!(rate > 0)) continue;
    const prev = map.get(it.item_code);
    if (prev == null || rate < prev) map.set(it.item_code, rate);
  }
  return map;
}

/**
 * Recompute derived item-wise fields (amount, per-item rank, is_lowest,
 * status) for the whole bid_items table. `completed` marks the overall
 * winner's rows as "Winner".
 */
function recomputeItemState(
  items: ReverseBidItem[],
  opts: { completed?: boolean; winner?: string; live?: boolean } = {}
): ReverseBidItem[] {
  // Group by item_code to rank suppliers within each item.
  const byItem = new Map<string, ReverseBidItem[]>();
  for (const it of items) {
    const list = byItem.get(it.item_code) ?? [];
    list.push(it);
    byItem.set(it.item_code, list);
  }
  const rankOf = new Map<ReverseBidItem, number>();
  const lowestFlag = new Map<ReverseBidItem, boolean>();
  for (const [, rows] of byItem) {
    const ranked = [...rows]
      .filter((r) => (r.current_rate ?? 0) > 0)
      .sort((a, b) => (a.current_rate ?? 0) - (b.current_rate ?? 0));
    const min = ranked[0]?.current_rate ?? 0;
    ranked.forEach((r, i) => rankOf.set(r, i + 1));
    for (const r of rows) {
      lowestFlag.set(r, (r.current_rate ?? 0) > 0 && r.current_rate === min);
    }
  }

  return items.map((it) => {
    const rate = it.current_rate ?? 0;
    const rank = rankOf.get(it) ?? 0;
    const isLowest = lowestFlag.get(it) ?? false;
    let status: BidItemStatus;
    if (opts.completed) {
      status = opts.winner && it.supplier === opts.winner ? "Winner" : "Outbid";
    } else if (rate <= 0) {
      status = "Waiting";
    } else if (isLowest) {
      status = "Leading";
    } else {
      status = opts.live ? "Outbid" : "Active";
    }
    return {
      ...it,
      amount: rate * (it.qty ?? 0),
      rank,
      is_lowest: (isLowest ? 1 : 0) as 0 | 1,
      status,
    };
  });
}

/** Sum of item amounts per supplier (their running total quote). */
export function supplierTotalsFromItems(
  items: ReverseBidItem[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    const amt = (it.current_rate ?? 0) * (it.qty ?? 0);
    map.set(it.supplier, (map.get(it.supplier) ?? 0) + amt);
  }
  return map;
}

interface SeedRfqItem {
  item_code: string;
  item_name?: string;
  name?: string;
  qty?: number;
  uom?: string;
}
interface SeedQuotation {
  supplier?: string;
  supplier_name?: string;
  items?: { item_code: string; rate?: number; amount?: number; qty?: number }[];
}

/**
 * Build item-wise bid rows (one per supplier × RFQ item) from live RFQ items
 * and each supplier's quotation line rates. Used both when creating a new
 * auction and when back-filling item rows for auctions created before the
 * item-wise feature existed. Rows come back with ranks/lowest/status derived.
 */
export function buildBidItemsFromQuotations(
  rfqItems: SeedRfqItem[],
  quotations: SeedQuotation[],
  supplierIds: string[],
  targetsByItem?: Map<string, number>
): ReverseBidItem[] {
  const rateBySupplierItem = new Map<string, Map<string, number>>();
  for (const q of quotations) {
    const id = (q.supplier ?? q.supplier_name ?? "").trim();
    if (!id) continue;
    const m = rateBySupplierItem.get(id) ?? new Map<string, number>();
    for (const it of q.items ?? []) {
      const r =
        typeof it.rate === "number" && it.rate > 0
          ? it.rate
          : it.amount && it.qty
            ? it.amount / it.qty
            : 0;
      const prev = m.get(it.item_code);
      if (prev == null || (r > 0 && r < prev)) m.set(it.item_code, r);
    }
    rateBySupplierItem.set(id, m);
  }

  const rows: ReverseBidItem[] = [];
  for (const supplierId of supplierIds) {
    const rateMap = rateBySupplierItem.get(supplierId) ?? new Map();
    for (const it of rfqItems) {
      const rate = rateMap.get(it.item_code) ?? 0;
      rows.push({
        doctype: RB_ITEM_DOCTYPE,
        supplier: supplierId,
        item_code: it.item_code,
        item_name: it.item_name ?? it.item_code,
        rfq_item: it.name,
        qty: it.qty ?? 0,
        uom: it.uom ?? "Nos",
        initial_rate: rate,
        current_rate: rate,
        latest_rate: rate,
        amount: rate * (it.qty ?? 0),
        target_rate: targetsByItem?.get(it.item_code) ?? 0,
        round_number: 0,
      });
    }
  }
  return recomputeItemState(rows);
}

/* ────────────────────────────────────────────────────────────────────────
 * Reads
 * ──────────────────────────────────────────────────────────────────────── */

const LIST_FIELDS = [
  "name",
  "rfq",
  "company",
  "currency",
  "auction_status",
  "start_date_time",
  "end_date_time",
  "starting_price",
  "minimum_decrement",
  "lowest_bid",
  "winning_supplier",
  "winner_price",
  "procurement_manager",
  "modified",
  "creation",
];

export async function listReverseBiddings(): Promise<ReverseBidding[]> {
  const rows = await apiGet<ReverseBidding[]>(
    buildResourceUrl(RB_DOCTYPE),
    buildListConfig({
      fields: LIST_FIELDS,
      order_by: "modified desc",
      limit_page_length: 500,
    })
  );
  return rows ?? [];
}

export async function getReverseBidding(name: string): Promise<ReverseBidding> {
  return apiGet<ReverseBidding>(buildResourceUrl(RB_DOCTYPE, name));
}

/** Return the most recent non-cancelled auction for an RFQ, if any. */
export async function getReverseBiddingForRFQ(
  rfqName: string
): Promise<ReverseBidding | null> {
  const rows = await apiGet<ReverseBidding[]>(
    buildResourceUrl(RB_DOCTYPE),
    buildListConfig({
      fields: ["name", "auction_status"],
      filters: [["rfq", "=", rfqName]],
      order_by: "creation desc",
      limit_page_length: 5,
    })
  );
  const active = (rows ?? []).find((r) => r.auction_status !== "Cancelled");
  if (!active) return null;
  return getReverseBidding(active.name);
}

/* ────────────────────────────────────────────────────────────────────────
 * Writes — internal helper (partial merge PUT with optimistic lock)
 * ──────────────────────────────────────────────────────────────────────── */

function isTimestampConflict(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : JSON.stringify(err ?? "");
  return /timestamp|has been modified|modified after|409|conflict/i.test(msg);
}

async function patchReverseBidding(
  name: string,
  patch: Record<string, unknown>,
  knownModified?: string
): Promise<ReverseBidding> {
  let modified = knownModified;
  if (!modified) {
    const fresh = await apiGet<ReverseBidding>(buildResourceUrl(RB_DOCTYPE, name));
    modified = fresh.modified;
  }
  const url = buildResourceUrl(RB_DOCTYPE, name);
  const body: Record<string, unknown> = { ...patch };
  if (modified) body.modified = modified;
  try {
    return await apiPut<ReverseBidding>(url, body);
  } catch (err) {
    // The 5s live-refresh can bump `modified` between our read and write,
    // producing a TimestampMismatchError. Re-read the freshest stamp and
    // retry once so a legitimate write is never silently dropped.
    if (!isTimestampConflict(err)) throw err;
    const fresh = await apiGet<ReverseBidding>(url);
    return apiPut<ReverseBidding>(url, { ...patch, modified: fresh.modified });
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Create Reverse Bidding from an RFQ (after AI evaluation)
 * ──────────────────────────────────────────────────────────────────────── */

export interface CreateReverseBiddingInput {
  rfqName: string;
  /**
   * AI-shortlisted / approved supplier ids. Only these (intersected with
   * suppliers that actually submitted a quotation) are invited. When omitted
   * or empty, every quoting supplier is invited.
   */
  approvedSuppliers?: string[];
  procurementManager?: string;
  currency?: string;
  remarks?: string;
}

function quotationTotal(items: { rate?: number; amount?: number; qty?: number }[]): number {
  return items.reduce((sum, it) => {
    const amt =
      typeof it.amount === "number"
        ? it.amount
        : (it.rate ?? 0) * (it.qty ?? 0);
    return sum + (Number.isFinite(amt) ? amt : 0);
  }, 0);
}

export async function createReverseBiddingFromRFQ(
  input: CreateReverseBiddingInput
): Promise<ReverseBidding> {
  const { rfqName } = input;
  if (!rfqName) throw new Error("An RFQ is required to create a reverse auction.");

  // Fail loudly (never crash) if the naming series is somehow blank.
  if (!RB_NAMING_SERIES) {
    throw new Error("Reverse Bidding Naming Series is not configured.");
  }

  // Idempotent: if an auction already exists for this RFQ, return it instead
  // of creating a duplicate.
  const existing = await getReverseBiddingForRFQ(rfqName);
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(
      "[ReverseBidding] Auction already exists for RFQ",
      rfqName,
      "→",
      existing.name
    );
    return existing;
  }

  const rfq = await getRFQ(rfqName);
  const company = rfq.company ?? COMPANY;

  const quotations = await getSupplierQuotations(rfqName);
  if (quotations.length === 0) {
    throw new Error(
      "No supplier quotations found for this RFQ. Reverse bidding can only start after quotations and AI evaluation."
    );
  }

  // Suppliers who actually submitted a quotation (+ their quoted totals).
  // Keyed by canonical supplier id; `aliases` lets us match the AI shortlist
  // whether it carries supplier ids or display names.
  const bySupplier = new Map<
    string,
    { total: number; aliases: Set<string> }
  >();
  for (const q of quotations) {
    const id = (q.supplier ?? q.supplier_name ?? "").trim();
    if (!id) continue;
    const total =
      typeof q.grand_total === "number" && q.grand_total > 0
        ? q.grand_total
        : typeof q.total === "number" && q.total > 0
          ? q.total
          : quotationTotal(q.items ?? []);
    const aliases = new Set<string>([id.toLowerCase()]);
    if (q.supplier_name) aliases.add(q.supplier_name.trim().toLowerCase());
    const prev = bySupplier.get(id);
    if (!prev) {
      bySupplier.set(id, { total, aliases });
    } else {
      // Keep the best (lowest) quote if a supplier quoted more than once.
      prev.total = Math.min(prev.total, total);
      for (const a of aliases) prev.aliases.add(a);
    }
  }

  // Restrict to AI-approved suppliers when a shortlist is provided (match on
  // supplier id OR display name).
  const approved = (input.approvedSuppliers ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const approvedSet = new Set(approved.map((s) => s.toLowerCase()));

  const invitedEntries: [string, number][] = [...bySupplier.entries()]
    .filter(([, v]) =>
      approvedSet.size === 0
        ? true
        : [...v.aliases].some((a) => approvedSet.has(a))
    )
    .map(([id, v]) => [id, v.total]);

  if (invitedEntries.length === 0) {
    throw new Error(
      "None of the shortlisted suppliers submitted a quotation for this RFQ."
    );
  }

  // Seed item-wise bid rows from live RFQ items + supplier quotation rates.
  const bidItems = buildBidItemsFromQuotations(
    rfq.items ?? [],
    quotations,
    invitedEntries.map(([supplier]) => supplier)
  );

  // Supplier totals derived item-wise (fallback to SQ total when no items).
  const itemTotals = supplierTotalsFromItems(bidItems);
  const invitedRows: ReverseBiddingSupplier[] = invitedEntries.map(
    ([supplier, total]) => {
      const itemTotal = itemTotals.get(supplier) ?? 0;
      const effective = itemTotal > 0 ? itemTotal : total;
      return {
        doctype: RB_SUPPLIER_DOCTYPE,
        supplier,
        initial_quotation_amount: effective,
        current_bid: effective,
        invitation_status: "Pending",
        joined_auction: 0,
      };
    }
  );
  const rankedRows = recomputeRanks(invitedRows);

  const effectiveTotals = invitedRows
    .map((r) => r.current_bid ?? 0)
    .filter((t) => t > 0);
  const startingPrice = effectiveTotals.length ? Math.max(...effectiveTotals) : 0;
  const bestQuote = effectiveTotals.length ? Math.min(...effectiveTotals) : 0;

  const doc: Record<string, unknown> = {
    doctype: RB_DOCTYPE,
    // Drives ERPNext autoname ("By Naming Series"). Never set `name` manually —
    // let the naming series generate it (e.g. RB-2026-00001).
    naming_series: RB_NAMING_SERIES,
    rfq: rfqName,
    company,
    currency: input.currency || DEFAULT_CURRENCY,
    auction_status: "Draft",
    starting_price: startingPrice,
    lowest_bid: bestQuote,
    minimum_decrement: 0,
    // Child rows (invited suppliers + item-wise bids) are inserted together
    // with the parent in a single frappe.client.save call.
    invited_suppliers: rankedRows,
    bid_history: [],
    bid_items: bidItems,
  };
  if (input.procurementManager) doc.procurement_manager = input.procurementManager;
  if (input.remarks) doc.remarks = input.remarks;

  // eslint-disable-next-line no-console
  console.log("[ReverseBidding] Creating auction:", {
    rfq: rfqName,
    company,
    selected_suppliers: invitedEntries.map(([supplier]) => supplier),
    naming_series: RB_NAMING_SERIES,
  });

  let created: ReverseBidding;
  try {
    created = await apiPost<ReverseBidding>(
      "/api/method/frappe.client.save",
      { doc }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ReverseBidding] Creation failed:", err);
    throw new Error(
      `Reverse Bidding creation failed: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }

  // Verify ERPNext generated the document name from the naming series.
  if (!created?.name) {
    throw new Error("Reverse Bidding document name generation failed.");
  }

  // eslint-disable-next-line no-console
  console.log("[ReverseBidding] Auction created:", created.name);

  return created;
}

/* ────────────────────────────────────────────────────────────────────────
 * Invitations
 * ──────────────────────────────────────────────────────────────────────── */

export async function sendInvitations(name: string): Promise<ReverseBidding> {
  const doc = await getReverseBidding(name);
  const invited = doc.invited_suppliers ?? [];
  if (invited.length === 0) {
    throw new Error("Cannot send invitations — no suppliers are invited.");
  }

  const sentAt = formatERPNextDatetime(new Date()) ?? undefined;
  const updated: ReverseBiddingSupplier[] = invited.map((s) => {
    // Never downgrade suppliers who already declined or accepted/joined.
    if (s.invitation_status === "Declined" || s.invitation_status === "Accepted") {
      return s;
    }
    return {
      ...s,
      invitation_status: "Sent",
      invitation_sent_at: s.invitation_sent_at ?? sentAt,
    };
  });

  // Email notification hook placeholder — integrate with the notification
  // service / ERPNext email queue here when SMTP is provisioned.
  // eslint-disable-next-line no-console
  console.log("[ReverseBidding] Sending invitations", {
    auction: name,
    rfq: doc.rfq,
    suppliers: updated.map((s) => `${s.supplier}=${s.invitation_status}`),
  });

  // Persist to ERPNext and verify the write actually took effect before the
  // caller reports success (never fake success).
  const saved = await patchReverseBidding(
    name,
    { invited_suppliers: updated },
    doc.modified
  );

  const confirmed = (saved.invited_suppliers ?? []).filter((s) =>
    isInvitationVisible(s.invitation_status)
  );
  if (confirmed.length === 0) {
    throw new Error(
      "ERPNext did not record any 'Sent' invitations. Please retry."
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    "[ReverseBidding] Invitations confirmed:",
    confirmed.map((s) => s.supplier)
  );
  return saved;
}

/* ────────────────────────────────────────────────────────────────────────
 * Schedule auction
 * ──────────────────────────────────────────────────────────────────────── */

export interface ScheduleAuctionInput {
  startDateTime: string; // ISO or ERPNext datetime
  endDateTime: string;
  minimumDecrement: number;
}

export async function scheduleAuction(
  name: string,
  input: ScheduleAuctionInput
): Promise<ReverseBidding> {
  // 1. Validate.
  if (!input.startDateTime) throw new Error("Start date & time is required.");
  if (!input.endDateTime) throw new Error("End date & time is required.");
  const start = parseErpDateTime(input.startDateTime);
  const end = parseErpDateTime(input.endDateTime);
  if (start == null) throw new Error("A valid start date/time is required.");
  if (end == null) throw new Error("A valid end date/time is required.");
  if (end <= start) throw new Error("Auction end must be after the start time.");
  if (!(input.minimumDecrement >= 0)) {
    throw new Error("Minimum decrement must be zero or a positive amount.");
  }

  const startErp = formatERPNextDatetime(input.startDateTime);
  const endErp = formatERPNextDatetime(input.endDateTime);
  if (!startErp || !endErp) {
    throw new Error("Could not format the schedule dates for ERPNext.");
  }

  const doc = await getReverseBidding(name);
  if (!doc.rfq) throw new Error("Cannot schedule an auction without an RFQ.");
  if ((doc.invited_suppliers ?? []).length === 0) {
    throw new Error("Cannot schedule an auction without invited suppliers.");
  }

  // 2. Persist to ERPNext (retry-safe on timestamp conflicts).
  const payload = {
    start_date_time: startErp,
    end_date_time: endErp,
    minimum_decrement: input.minimumDecrement,
    auction_status: "Scheduled" as AuctionStatus,
  };
  // eslint-disable-next-line no-console
  console.log("[ReverseBidding] Scheduling auction", { name, ...payload });
  await patchReverseBidding(name, payload, doc.modified);

  // 3. Reload from ERPNext and verify the write actually persisted — never
  // report success on stale/optimistic state.
  const reloaded = await getReverseBidding(name);
  if (!reloaded.start_date_time || !reloaded.end_date_time) {
    throw new Error(
      "ERPNext did not persist the schedule. Please retry — the dates were not saved."
    );
  }
  // eslint-disable-next-line no-console
  console.log("[ReverseBidding] Schedule confirmed", {
    start: reloaded.start_date_time,
    end: reloaded.end_date_time,
    status: reloaded.auction_status,
  });
  return reloaded;
}

/** Force a scheduled/draft auction into the Live state immediately. */
export async function startAuctionNow(name: string): Promise<ReverseBidding> {
  const doc = await getReverseBidding(name);
  if ((doc.invited_suppliers ?? []).length === 0) {
    throw new Error("Cannot start an auction without invited suppliers.");
  }
  const now = new Date();
  const startIso = formatERPNextDatetime(now);
  const end =
    parseErpDateTime(doc.end_date_time) ??
    now.getTime() + 60 * 60 * 1000; // default 1h window if none set
  const endIso =
    doc.end_date_time && parseErpDateTime(doc.end_date_time)! > now.getTime()
      ? doc.end_date_time
      : formatERPNextDatetime(new Date(end));
  await patchReverseBidding(
    name,
    {
      start_date_time: startIso,
      end_date_time: endIso,
      auction_status: "Live",
    },
    doc.modified
  );
  const reloaded = await getReverseBidding(name);
  if (reloaded.auction_status !== "Live" || !reloaded.start_date_time) {
    throw new Error("ERPNext did not persist the Live status. Please retry.");
  }
  return reloaded;
}

export async function cancelAuction(
  name: string,
  reason?: string
): Promise<ReverseBidding> {
  const doc = await getReverseBidding(name);
  const remarks = reason
    ? `${doc.remarks ?? ""}\n[RB:Cancelled] ${reason}`.trim()
    : doc.remarks;
  return patchReverseBidding(
    name,
    { auction_status: "Cancelled", remarks },
    doc.modified
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Bidding
 * ──────────────────────────────────────────────────────────────────────── */

export interface SubmitBidInput {
  auctionName: string;
  supplier: string;
  amount: number;
}

export interface BidValidation {
  ok: boolean;
  reason?: string;
  currentLowest: number;
  maxAllowed: number;
}

/** Pure validation used by both the UI (live hints) and submitBid. */
export function validateBid(
  doc: ReverseBidding,
  supplier: string,
  amount: number,
  now: number = Date.now()
): BidValidation {
  const currentLowest = currentLowestBid(doc);
  const decrement = doc.minimum_decrement ?? 0;
  const row = (doc.invited_suppliers ?? []).find((s) => s.supplier === supplier);
  const ownCurrent = row?.current_bid ?? 0;
  const isLeader = ownCurrent > 0 && currentLowest > 0 && ownCurrent <= currentLowest;
  const maxAllowed = isLeader
    ? ownCurrent
    : decrement > 0
      ? currentLowest - decrement
      : currentLowest;

  const status = deriveAuctionStatus(doc, now);
  if (status !== "Live") {
    return { ok: false, reason: "The auction is not live.", currentLowest, maxAllowed };
  }
  if (!row) {
    return {
      ok: false,
      reason: "You are not invited to this auction.",
      currentLowest,
      maxAllowed,
    };
  }
  if (row.invitation_status === "Declined") {
    return { ok: false, reason: "You declined this auction.", currentLowest, maxAllowed };
  }
  if (!(amount > 0)) {
    return { ok: false, reason: "Bid amount must be greater than zero.", currentLowest, maxAllowed };
  }
  // Always require improving on your own previous bid — this lets a leader
  // keep bidding without limit.
  if (ownCurrent > 0 && amount >= ownCurrent) {
    return {
      ok: false,
      reason: "Your bid must be lower than your previous bid.",
      currentLowest,
      maxAllowed,
    };
  }
  // A challenger (not currently lowest) must beat the current lowest bid.
  if (!isLeader) {
    if (amount >= currentLowest) {
      return {
        ok: false,
        reason: "Bid must be lower than the current lowest bid.",
        currentLowest,
        maxAllowed,
      };
    }
    if (decrement > 0 && amount > maxAllowed) {
      return {
        ok: false,
        reason: `Bid must be at least ${decrement} below the current lowest bid.`,
        currentLowest,
        maxAllowed,
      };
    }
  }
  return { ok: true, currentLowest, maxAllowed };
}

export async function submitBid(input: SubmitBidInput): Promise<ReverseBidding> {
  const doc = await getReverseBidding(input.auctionName);
  const check = validateBid(doc, input.supplier, input.amount);
  if (!check.ok) throw new Error(check.reason ?? "Invalid bid.");

  const now = new Date();
  const prevMaxRound = (doc.bid_history ?? [])
    .filter((b) => b.supplier === input.supplier)
    .reduce((m, b) => Math.max(m, b.round_number ?? 0), 0);
  const previous =
    (doc.invited_suppliers ?? []).find((s) => s.supplier === input.supplier)
      ?.current_bid ?? 0;
  const reduction = previous > 0 ? previous - input.amount : 0;

  const newBid: ReverseBid = {
    doctype: RB_BID_DOCTYPE,
    supplier: input.supplier,
    bid_amount: input.amount,
    previous_rate: previous,
    reduction_amount: reduction > 0 ? reduction : 0,
    reduction_pct:
      previous > 0 ? Number(((reduction / previous) * 100).toFixed(2)) : 0,
    bid_time: formatERPNextDatetime(now) ?? undefined,
    round_number: prevMaxRound + 1,
    status: "Accepted",
  };

  // Append-only: never overwrite prior bids.
  const history: ReverseBid[] = [...(doc.bid_history ?? []), newBid];

  const invited = (doc.invited_suppliers ?? []).map((s) =>
    s.supplier === input.supplier
      ? {
          ...s,
          current_bid: input.amount,
          joined_auction: 1 as const,
          invitation_status:
            s.invitation_status === "Sent" ||
            s.invitation_status === "Pending" ||
            !s.invitation_status
              ? "Accepted"
              : s.invitation_status,
        }
      : s
  );
  const ranked = recomputeRanks(invited);
  const lowest = Math.min(...bidValues(ranked));

  // Optimistic concurrency: PUT with the modified stamp we validated against.
  return patchReverseBidding(
    input.auctionName,
    {
      invited_suppliers: ranked,
      bid_history: history,
      lowest_bid: Number.isFinite(lowest) ? lowest : doc.lowest_bid,
    },
    doc.modified
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Item-wise bidding
 * ──────────────────────────────────────────────────────────────────────── */

export interface ItemBidInput {
  item_code: string;
  rate: number;
}

export interface SubmitItemBidsInput {
  auctionName: string;
  supplier: string;
  items: ItemBidInput[];
}

export interface ItemBidValidation {
  ok: boolean;
  reason?: string;
  /** Lowest current rate for the item across suppliers. */
  currentLowest: number;
  /** Highest rate this bid may be (currentLowest − decrement). */
  maxAllowed: number;
  /** This supplier's own current rate for the item. */
  ownCurrent: number;
}

/**
 * Validate a single item-level bid. A valid bid must (a) be > 0, (b) not
 * increase the supplier's own current rate, and (c) be at least
 * `minimum_decrement` below the current lowest rate for that item.
 */
export function validateItemBid(
  doc: ReverseBidding,
  supplier: string,
  itemCode: string,
  rate: number,
  now: number = Date.now()
): ItemBidValidation {
  const items = doc.bid_items ?? [];
  const forItem = items.filter((i) => i.item_code === itemCode);
  const own = forItem.find((i) => i.supplier === supplier);
  const lowestMap = lowestRateByItem(items);
  const currentLowest = lowestMap.get(itemCode) ?? own?.current_rate ?? 0;
  const decrement = doc.minimum_decrement ?? 0;
  const ownCurrent = own?.current_rate ?? 0;
  // This supplier already holds (or ties) the lowest price for this item.
  const isLeader = ownCurrent > 0 && currentLowest > 0 && ownCurrent <= currentLowest;
  // A leader may keep improving their own price by any amount; a challenger
  // must undercut the current lowest by at least the minimum decrement.
  const maxAllowed = isLeader
    ? ownCurrent
    : decrement > 0
      ? currentLowest - decrement
      : currentLowest;

  const status = deriveAuctionStatus(doc, now);
  if (status !== "Live") {
    return { ok: false, reason: "The auction is not live.", currentLowest, maxAllowed, ownCurrent };
  }
  if (!own) {
    return { ok: false, reason: "This item is not part of your bid sheet.", currentLowest, maxAllowed, ownCurrent };
  }
  if (!(rate > 0)) {
    return { ok: false, reason: "Rate must be greater than zero.", currentLowest, maxAllowed, ownCurrent };
  }
  // Rule: new bid must always be strictly lower than this supplier's previous
  // price — this alone lets a leader keep bidding as many times as they like.
  if (ownCurrent > 0 && rate >= ownCurrent) {
    return { ok: false, reason: "Your bid must be lower than your previous bid.", currentLowest, maxAllowed, ownCurrent };
  }
  // A challenger (not currently lowest) must beat the current lowest price.
  if (!isLeader) {
    if (currentLowest > 0 && rate >= currentLowest) {
      return { ok: false, reason: "Your bid must be lower than the current lowest price.", currentLowest, maxAllowed, ownCurrent };
    }
    if (decrement > 0 && rate > maxAllowed) {
      return { ok: false, reason: `Bid must be at least ${decrement} below the current lowest (≤ ${maxAllowed}).`, currentLowest, maxAllowed, ownCurrent };
    }
  }
  return { ok: true, currentLowest, maxAllowed, ownCurrent };
}

/**
 * Submit one or more item-level rates for a supplier. Recomputes item ranks,
 * per-item lowest flags, each supplier's running total, overall ranks and
 * lowest bid, and appends a Reverse Bids event for the round.
 */
export async function submitItemBids(
  input: SubmitItemBidsInput
): Promise<ReverseBidding> {
  const doc = await getReverseBidding(input.auctionName);
  const clean = (input.items ?? []).filter(
    (i) => i.item_code && Number.isFinite(i.rate) && i.rate > 0
  );
  if (clean.length === 0) {
    throw new Error("Enter at least one lower item price to submit.");
  }

  // Validate every submitted line before writing anything.
  for (const line of clean) {
    const v = validateItemBid(doc, input.supplier, line.item_code, line.rate);
    if (!v.ok) {
      throw new Error(`${line.item_code}: ${v.reason ?? "Invalid bid."}`);
    }
  }

  const now = new Date();
  const bidTime = formatERPNextDatetime(now) ?? undefined;
  const rateByItem = new Map(clean.map((l) => [l.item_code, l.rate]));

  // Round number for this supplier = highest prior round + 1 (history now holds
  // one row per item, so count rounds not rows).
  const prevMaxRound = (doc.bid_history ?? [])
    .filter((b) => b.supplier === input.supplier)
    .reduce((m, b) => Math.max(m, b.round_number ?? 0), 0);
  const round = prevMaxRound + 1;

  // Capture each item's price BEFORE this bid, to record the reduction.
  const prevRateByItem = new Map<string, { rate: number; name: string }>();
  for (const it of doc.bid_items ?? []) {
    if (it.supplier === input.supplier) {
      prevRateByItem.set(it.item_code, {
        rate: it.current_rate ?? 0,
        name: it.item_name ?? it.item_code,
      });
    }
  }

  // Apply new rates to this supplier's item rows.
  let items = (doc.bid_items ?? []).map((it) => {
    if (it.supplier !== input.supplier) return it;
    const newRate = rateByItem.get(it.item_code);
    if (newRate == null) return it;
    return {
      ...it,
      current_rate: newRate,
      latest_rate: newRate,
      amount: newRate * (it.qty ?? 0),
      bid_time: bidTime,
      round_number: round,
    };
  });
  const live = deriveAuctionStatus(doc) === "Live";
  items = recomputeItemState(items, { live });

  // Recompute supplier totals + ranks from the updated item rows.
  const totals = supplierTotalsFromItems(items);
  const invited = (doc.invited_suppliers ?? []).map((s) => {
    const total = totals.get(s.supplier);
    if (s.supplier === input.supplier) {
      return {
        ...s,
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

  // Append one immutable history row per submitted item — never overwrite or
  // supersede prior rows, so the full negotiation trail is preserved.
  const newHistoryRows: ReverseBid[] = clean.map((line) => {
    const prev = prevRateByItem.get(line.item_code);
    const previous = prev?.rate ?? 0;
    const reduction = previous > 0 ? previous - line.rate : 0;
    const reductionPct = previous > 0 ? (reduction / previous) * 100 : 0;
    return {
      doctype: RB_BID_DOCTYPE,
      supplier: input.supplier,
      item_code: line.item_code,
      item_name: prev?.name ?? line.item_code,
      bid_amount: line.rate,
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

  return patchReverseBidding(
    input.auctionName,
    {
      bid_items: items,
      invited_suppliers: ranked,
      bid_history: history,
      lowest_bid: Number.isFinite(lowest as number) ? lowest : doc.lowest_bid,
    },
    doc.modified
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Item-wise comparison matrix + report
 * ──────────────────────────────────────────────────────────────────────── */

export interface MatrixRow {
  item_code: string;
  item_name: string;
  qty: number;
  uom: string;
  /** supplier → current rate (0 = no bid). */
  rates: Record<string, number>;
  lowest: number;
  lowestSupplier: string;
  /** Procurement target price for the item (0 = not set). */
  target: number;
}

export interface ItemWiseMatrix {
  suppliers: string[];
  rows: MatrixRow[];
  /** supplier → running total (Σ rate·qty). */
  totals: Record<string, number>;
  winner: string;
  winnerTotal: number;
}

/** Build the procurement comparison matrix (items × suppliers) from bid_items. */
export function getItemWiseMatrix(doc: ReverseBidding): ItemWiseMatrix {
  const items = doc.bid_items ?? [];
  const suppliers = Array.from(new Set(items.map((i) => i.supplier)));
  const byItem = new Map<string, MatrixRow>();

  for (const it of items) {
    const row =
      byItem.get(it.item_code) ??
      ({
        item_code: it.item_code,
        item_name: it.item_name ?? it.item_code,
        qty: it.qty ?? 0,
        uom: it.uom ?? "",
        rates: {},
        lowest: 0,
        lowestSupplier: "",
        target: 0,
      } as MatrixRow);
    row.rates[it.supplier] = it.current_rate ?? 0;
    if ((it.target_rate ?? 0) > 0) row.target = it.target_rate ?? 0;
    byItem.set(it.item_code, row);
  }

  const rows = [...byItem.values()].map((row) => {
    let lowest = Infinity;
    let lowestSupplier = "";
    for (const s of suppliers) {
      const r = row.rates[s] ?? 0;
      if (r > 0 && r < lowest) {
        lowest = r;
        lowestSupplier = s;
      }
    }
    return {
      ...row,
      lowest: Number.isFinite(lowest) ? lowest : 0,
      lowestSupplier,
    };
  });

  const totals: Record<string, number> = {};
  for (const s of suppliers) totals[s] = 0;
  for (const it of items) {
    totals[it.supplier] =
      (totals[it.supplier] ?? 0) + (it.current_rate ?? 0) * (it.qty ?? 0);
  }

  let winner = "";
  let winnerTotal = Infinity;
  for (const s of suppliers) {
    const t = totals[s];
    if (t > 0 && t < winnerTotal) {
      winnerTotal = t;
      winner = s;
    }
  }

  return {
    suppliers,
    rows,
    totals,
    winner,
    winnerTotal: Number.isFinite(winnerTotal) ? winnerTotal : 0,
  };
}

export interface ItemWiseWinner {
  item_code: string;
  item_name: string;
  qty: number;
  supplier: string;
  rate: number;
  amount: number;
}

export interface ItemWiseReport {
  matrix: ItemWiseMatrix;
  itemWinners: ItemWiseWinner[];
  startingTotal: number;
  winningTotal: number;
  savings: number;
  savingsPct: number;
}

/** Full item-wise final report used at auction end. */
export function getItemWiseReport(doc: ReverseBidding): ItemWiseReport {
  const matrix = getItemWiseMatrix(doc);
  const itemWinners: ItemWiseWinner[] = matrix.rows
    .filter((r) => r.lowestSupplier)
    .map((r) => ({
      item_code: r.item_code,
      item_name: r.item_name,
      qty: r.qty,
      supplier: r.lowestSupplier,
      rate: r.lowest,
      amount: r.lowest * r.qty,
    }));
  const startingTotal = doc.starting_price ?? 0;
  const winningTotal = matrix.winnerTotal;
  const savings = startingTotal > 0 ? Math.max(0, startingTotal - winningTotal) : 0;
  const savingsPct = startingTotal > 0 ? (savings / startingTotal) * 100 : 0;
  return { matrix, itemWinners, startingTotal, winningTotal, savings, savingsPct };
}

/**
 * Backfill item-wise rows for an auction that has none yet (created before the
 * item-wise feature). Loads live RFQ items + supplier quotation rates and
 * persists them once. Returns the (possibly updated) auction. Safe to call
 * from a render path — it only writes when `bid_items` is empty.
 */
export async function ensureBidItems(
  doc: ReverseBidding
): Promise<ReverseBidding> {
  if ((doc.bid_items ?? []).length > 0) return doc;
  if (!doc.rfq) return doc;
  const supplierIds = (doc.invited_suppliers ?? []).map((s) => s.supplier);
  if (supplierIds.length === 0) return doc;

  const [rfq, quotations] = await Promise.all([
    getRFQ(doc.rfq),
    getSupplierQuotations(doc.rfq),
  ]);
  if ((rfq.items ?? []).length === 0) return doc;

  const items = buildBidItemsFromQuotations(
    rfq.items ?? [],
    quotations,
    supplierIds
  );
  if (items.length === 0) return doc;

  return patchReverseBidding(doc.name, { bid_items: items }, doc.modified);
}

export interface ItemTargetInput {
  item_code: string;
  target: number;
}

/**
 * Persist procurement's per-item target prices. The target is item-wide (same
 * across suppliers) so it is written onto every supplier's row for that item
 * and becomes visible to suppliers during bidding.
 */
export async function setItemTargets(
  name: string,
  targets: ItemTargetInput[]
): Promise<ReverseBidding> {
  const doc = await getReverseBidding(name);
  const map = new Map(targets.map((t) => [t.item_code, t.target]));
  const items = (doc.bid_items ?? []).map((it) =>
    map.has(it.item_code)
      ? { ...it, target_rate: map.get(it.item_code) ?? 0 }
      : it
  );
  return patchReverseBidding(name, { bid_items: items }, doc.modified);
}

/* ────────────────────────────────────────────────────────────────────────
 * Close auction / determine winner
 * ──────────────────────────────────────────────────────────────────────── */

export async function closeAuction(name: string): Promise<ReverseBidding> {
  const doc = await getReverseBidding(name);
  const invited = doc.invited_suppliers ?? [];
  const finalRanked = recomputeRanks(invited, "final_rank").map((s) => ({
    ...s,
    rank: s.final_rank,
  }));
  const withBids = finalRanked
    .filter((s) => typeof s.current_bid === "number" && s.current_bid! > 0)
    .sort((a, b) => (a.current_bid ?? 0) - (b.current_bid ?? 0));
  const winner = withBids[0];

  // Finalize item-wise statuses (winner rows → Winner, rest → Outbid).
  const finalItems = recomputeItemState(doc.bid_items ?? [], {
    completed: true,
    winner: winner?.supplier,
  });

  return patchReverseBidding(
    name,
    {
      auction_status: "Completed",
      winning_supplier: winner?.supplier,
      winner_price: winner?.current_bid,
      lowest_bid: winner?.current_bid ?? doc.lowest_bid,
      invited_suppliers: finalRanked,
      bid_items: finalItems,
    },
    doc.modified
  );
}

/**
 * If the clock says the auction is over but the persisted status hasn't caught
 * up yet, finalize it. Returns the (possibly) updated doc. Safe to call from a
 * polling loop — it only writes once.
 */
export async function maybeAutoComplete(
  doc: ReverseBidding
): Promise<ReverseBidding> {
  const derived = deriveAuctionStatus(doc);
  if (derived === "Completed" && doc.auction_status !== "Completed") {
    return closeAuction(doc.name);
  }
  return doc;
}

/* ────────────────────────────────────────────────────────────────────────
 * Approval workflow (stored via remarks tags — no approval field exists)
 * ──────────────────────────────────────────────────────────────────────── */

export function isApproved(doc: Pick<ReverseBidding, "remarks">): boolean {
  return (doc.remarks ?? "").includes(APPROVED_TAG);
}
export function isRejected(doc: Pick<ReverseBidding, "remarks">): boolean {
  return (doc.remarks ?? "").includes(REJECTED_TAG);
}

export async function approveAuction(name: string): Promise<ReverseBidding> {
  const doc = await getReverseBidding(name);
  if (deriveAuctionStatus(doc) !== "Completed") {
    throw new Error("Only a completed auction can be approved.");
  }
  if (!doc.winning_supplier) {
    throw new Error("No winning supplier to approve.");
  }
  const remarks = `${(doc.remarks ?? "").replace(REJECTED_TAG, "").trim()}\n${APPROVED_TAG} ${formatERPNextDatetime(new Date())}`.trim();
  return patchReverseBidding(name, { remarks }, doc.modified);
}

export async function rejectAuction(
  name: string,
  reason?: string
): Promise<ReverseBidding> {
  const doc = await getReverseBidding(name);
  const remarks = `${(doc.remarks ?? "").replace(APPROVED_TAG, "").trim()}\n${REJECTED_TAG} ${reason ?? ""} ${formatERPNextDatetime(new Date())}`.trim();
  return patchReverseBidding(name, { remarks }, doc.modified);
}

/** Reopen a completed auction for another round of bidding. */
export async function reopenAuction(
  name: string,
  newEndDateTime: string
): Promise<ReverseBidding> {
  const end = parseErpDateTime(newEndDateTime);
  if (end == null || end <= Date.now()) {
    throw new Error("Reopen requires a future end date/time.");
  }
  const doc = await getReverseBidding(name);
  const remarks = `${(doc.remarks ?? "").replace(APPROVED_TAG, "").replace(REJECTED_TAG, "").trim()}\n[RB:Reopened] ${formatERPNextDatetime(new Date())}`.trim();
  return patchReverseBidding(
    name,
    {
      auction_status: "Live",
      start_date_time: formatERPNextDatetime(new Date()),
      end_date_time: formatERPNextDatetime(newEndDateTime),
      winning_supplier: "",
      winner_price: 0,
      remarks,
    },
    doc.modified
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * AI final recommendation (reuses the deterministic scoring engine)
 * ──────────────────────────────────────────────────────────────────────── */

export interface FinalRecommendationRow {
  supplier: string;
  initial_quote: number;
  final_bid: number;
  savings: number;
  savings_pct: number;
  score: number;
  rank: number;
  reason: string;
}

export interface FinalRecommendation {
  recommended_supplier: string;
  confidence: number;
  reasoning: string;
  rows: FinalRecommendationRow[];
}

export async function getFinalRecommendation(
  doc: ReverseBidding
): Promise<FinalRecommendation> {
  const invited = (doc.invited_suppliers ?? []).filter(
    (s) => typeof s.current_bid === "number" && s.current_bid! > 0
  );
  if (invited.length === 0) {
    return {
      recommended_supplier: doc.winning_supplier ?? "",
      confidence: 0,
      reasoning: "No bids were recorded for this auction.",
      rows: [],
    };
  }

  // Item count for the RFQ (used by the price/coverage dimensions).
  let itemCount = 1;
  try {
    const rfq = await getRFQ(doc.rfq);
    itemCount = (rfq.items ?? []).length || 1;
  } catch {
    itemCount = 1;
  }

  const quotations: AIQuotation[] = invited.map((s) => ({
    supplier_name: s.supplier,
    total_value: s.current_bid ?? 0,
    items: [
      {
        item: doc.rfq,
        unit_price: s.current_bid ?? 0,
        total: s.current_bid ?? 0,
      },
    ],
  }));

  let historical;
  try {
    historical = await getSupplierPerformance(invited.map((s) => s.supplier));
  } catch {
    historical = undefined;
  }

  const engine = scoreSuppliers(quotations, itemCount, undefined, historical);
  const scoreBySupplier = new Map(
    engine.suppliers.map((s) => [s.supplier_name, s])
  );

  const rows: FinalRecommendationRow[] = invited
    .map((s) => {
      const initial = s.initial_quotation_amount ?? s.current_bid ?? 0;
      const final = s.current_bid ?? 0;
      const savings = Math.max(0, initial - final);
      const scored = scoreBySupplier.get(s.supplier);
      return {
        supplier: s.supplier,
        initial_quote: initial,
        final_bid: final,
        savings,
        savings_pct: initial > 0 ? (savings / initial) * 100 : 0,
        score: scored?.final_score ?? 0,
        rank: 0,
        reason:
          scored?.recommendation_reason ??
          "Ranked on final bid price (lower is better).",
      };
    })
    .sort((a, b) => {
      // Prefer higher composite score; fall back to lower final bid.
      if (b.score !== a.score) return b.score - a.score;
      return a.final_bid - b.final_bid;
    })
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const top = rows[0];
  const confidence = top ? Math.round(Math.min(99, 60 + top.score * 0.35)) : 0;
  const lowest = [...rows].sort((a, b) => a.final_bid - b.final_bid)[0];
  const reasoning = top
    ? `${top.supplier} offers the best blend of price and historical performance ` +
      `(composite score ${Math.round(top.score)}/100) with a final bid of ` +
      `${top.final_bid.toLocaleString()} — a ${top.savings_pct.toFixed(1)}% ` +
      `reduction from the opening quotation. ` +
      (lowest && lowest.supplier !== top.supplier
        ? `${lowest.supplier} posted the lowest absolute bid (${lowest.final_bid.toLocaleString()}), ` +
          `but scored lower on delivery/reliability history.`
        : `It also posted the lowest absolute bid.`)
    : "Insufficient data for a recommendation.";

  return {
    recommended_supplier: top?.supplier ?? doc.winning_supplier ?? "",
    confidence,
    reasoning,
    rows,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Create Purchase Order from the auction winner
 * ──────────────────────────────────────────────────────────────────────── */

export async function createPurchaseOrderFromAuction(
  name: string
): Promise<PurchaseOrder> {
  const doc = await getReverseBidding(name);
  if (deriveAuctionStatus(doc) !== "Completed") {
    throw new Error("The auction must be completed before creating a PO.");
  }
  if (!isApproved(doc)) {
    throw new Error("The Procurement Manager must approve the auction first.");
  }
  const supplier = doc.winning_supplier;
  const winnerPrice = doc.winner_price ?? doc.lowest_bid ?? 0;
  if (!supplier || !(winnerPrice > 0)) {
    throw new Error("No winning supplier / winner price recorded.");
  }

  const rfq = await getRFQ(doc.rfq);
  const quotations = await getSupplierQuotations(doc.rfq);
  const winningSq = quotations.find(
    (q) => (q.supplier ?? q.supplier_name) === supplier
  );

  const sqTotal = winningSq
    ? typeof winningSq.grand_total === "number" && winningSq.grand_total > 0
      ? winningSq.grand_total
      : quotationTotal(winningSq.items ?? [])
    : 0;
  // Distribute the negotiated auction discount proportionally across items.
  const discountFactor = sqTotal > 0 ? winnerPrice / sqTotal : 1;

  const rateBySqItem = new Map<string, number>();
  for (const it of winningSq?.items ?? []) {
    rateBySqItem.set(it.item_code, it.rate ?? 0);
  }

  // Winning supplier's FINAL item-wise negotiated rates take precedence.
  const winnerRateByItem = new Map<string, number>();
  for (const it of doc.bid_items ?? []) {
    if (it.supplier === supplier && (it.current_rate ?? 0) > 0) {
      winnerRateByItem.set(it.item_code, it.current_rate ?? 0);
    }
  }

  const today = formatERPNextDatetime(new Date())?.slice(0, 10);
  const rfqItems = rfq.items ?? [];
  const items = rfqItems.map((it) => {
    // Prefer the final reverse-bid item rate; only fall back to the SQ rate
    // (with proportional discount) when no item-wise bid exists.
    const itemBidRate = winnerRateByItem.get(it.item_code);
    if (itemBidRate != null && itemBidRate > 0) {
      return {
        item_code: it.item_code,
        item_name: it.item_name ?? it.item_code,
        description: it.description ?? it.item_name ?? it.item_code,
        qty: it.qty,
        uom: it.uom ?? "Nos",
        rate: itemBidRate,
        amount: itemBidRate * (it.qty ?? 0),
        schedule_date: it.schedule_date ?? today,
        supplier_quotation: winningSq?.name,
      };
    }
    const baseRate =
      rateBySqItem.get(it.item_code) ??
      (rfqItems.length ? winnerPrice / rfqItems.length / (it.qty || 1) : 0);
    const rate = baseRate * discountFactor;
    return {
      item_code: it.item_code,
      item_name: it.item_name ?? it.item_code,
      description: it.description ?? it.item_name ?? it.item_code,
      qty: it.qty,
      uom: it.uom ?? "Nos",
      rate,
      amount: rate * (it.qty ?? 0),
      schedule_date: it.schedule_date ?? today,
      supplier_quotation: winningSq?.name,
    };
  });

  const po = await createPurchaseOrder({
    supplier,
    company: doc.company ?? COMPANY,
    transaction_date: today,
    schedule_date: today,
    remarks: `${doc.rfq} · Reverse Auction ${doc.name}`,
    items: items as unknown as PurchaseOrder["items"],
  });

  // Record the created PO on the auction for traceability.
  try {
    await patchReverseBidding(name, {
      remarks: `${doc.remarks ?? ""}\n[RB:PO] ${po.name}`.trim(),
    });
  } catch {
    /* best effort */
  }

  return po;
}

/* ────────────────────────────────────────────────────────────────────────
 * Dashboard statistics
 * ──────────────────────────────────────────────────────────────────────── */

export interface ReverseBiddingStats {
  total: number;
  live: number;
  scheduled: number;
  completed: number;
  draft: number;
  avgSavingsPct: number;
  lowestActiveBid: number | null;
  upcoming: ReverseBidding[];
}

export async function getReverseBiddingStats(): Promise<ReverseBiddingStats> {
  const rows = await listReverseBiddings();
  const now = Date.now();

  let live = 0;
  let scheduled = 0;
  let completed = 0;
  let draft = 0;
  const savings: number[] = [];
  const activeLows: number[] = [];
  const upcoming: ReverseBidding[] = [];

  for (const r of rows) {
    const status = deriveAuctionStatus(r, now);
    if (status === "Live") {
      live += 1;
      if (typeof r.lowest_bid === "number" && r.lowest_bid > 0) {
        activeLows.push(r.lowest_bid);
      }
    } else if (status === "Scheduled") {
      scheduled += 1;
      upcoming.push(r);
    } else if (status === "Completed") {
      completed += 1;
      const start = r.starting_price ?? 0;
      const win = r.winner_price ?? r.lowest_bid ?? 0;
      if (start > 0 && win > 0 && win <= start) {
        savings.push(((start - win) / start) * 100);
      }
    } else if (status === "Draft") {
      draft += 1;
    }
  }

  upcoming.sort(
    (a, b) =>
      (parseErpDateTime(a.start_date_time) ?? Infinity) -
      (parseErpDateTime(b.start_date_time) ?? Infinity)
  );

  return {
    total: rows.length,
    live,
    scheduled,
    completed,
    draft,
    avgSavingsPct: savings.length
      ? savings.reduce((a, b) => a + b, 0) / savings.length
      : 0,
    lowestActiveBid: activeLows.length ? Math.min(...activeLows) : null,
    upcoming: upcoming.slice(0, 5),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Supplier-portal reads (own auctions only)
 * ──────────────────────────────────────────────────────────────────────── */

/** Auctions a given supplier is invited to (Sent/Live/Completed). */
export async function getSupplierAuctions(
  supplier: string
): Promise<ReverseBidding[]> {
  if (!supplier) return [];
  // The child-table membership can't be filtered at the list endpoint on this
  // install, so fetch every non-cancelled auction and filter client-side by
  // invited rows. Draft auctions ARE included — invitations are sent while an
  // auction is still Draft (scheduling happens later), so a supplier must see
  // a Draft auction it was invited to.
  const rows = await listReverseBiddings();
  const detailed = await Promise.allSettled(
    rows
      .filter((r) => r.auction_status !== "Cancelled")
      .map((r) => getReverseBidding(r.name))
  );
  return detailed
    .filter(
      (d): d is PromiseFulfilledResult<ReverseBidding> => d.status === "fulfilled"
    )
    .map((d) => d.value)
    .filter(
      (doc) =>
        doc.auction_status !== "Cancelled" &&
        (doc.invited_suppliers ?? []).some(
          (s) =>
            sameSupplier(s.supplier, supplier) &&
            isInvitationVisible(s.invitation_status)
        )
    );
}

/** Whether a supplier is invited to a specific auction (and not declined). */
export function supplierIsInvited(
  doc: ReverseBidding,
  supplier: string
): boolean {
  return (doc.invited_suppliers ?? []).some(
    (s) =>
      sameSupplier(s.supplier, supplier) && s.invitation_status !== "Declined"
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * AI scores for the auction comparison table (from Supplier Scoring Result)
 * ──────────────────────────────────────────────────────────────────────── */

export interface AuctionSupplierScore {
  aiScore: number;
  deliveryScore: number;
  riskScore: number;
  rank: number;
}

/**
 * Load the AI evaluation scores (final/AI score, delivery, derived risk) for
 * the suppliers of an auction's RFQ, keyed by lowercased supplier id AND name
 * so the auction's supplier rows resolve regardless of which identifier the
 * scoring record stored. Returns an empty map if the RFQ was never scored.
 */
export async function getAuctionSupplierScores(
  rfqName: string
): Promise<Map<string, AuctionSupplierScore>> {
  const map = new Map<string, AuctionSupplierScore>();
  if (!rfqName) return map;
  let result;
  try {
    result = await getLatestScoringResult(rfqName);
  } catch {
    return map;
  }
  for (const row of result?.supplier_scores ?? []) {
    const reliability = Number.isFinite(row.reliability_score)
      ? row.reliability_score
      : 0;
    const score: AuctionSupplierScore = {
      aiScore: Math.round(row.final_score ?? 0),
      deliveryScore: Math.round(row.delivery_score ?? 0),
      // Risk is the inverse of reliability (higher reliability → lower risk).
      riskScore: Math.max(0, Math.min(100, Math.round(100 - reliability))),
      rank: row.ranking ?? 0,
    };
    if (row.supplier) map.set(row.supplier.trim().toLowerCase(), score);
    if (row.supplier_name) map.set(row.supplier_name.trim().toLowerCase(), score);
  }
  return map;
}

/* ────────────────────────────────────────────────────────────────────────
 * Approve winner → existing Legal Review → Finance Review → PO workflow
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Route the auction winner into the SAME approval workflow a normal RFQ
 * supplier selection uses: it records the RFQ approval state and creates the
 * Legal Document Review. The existing Legal → Finance → PO flow then proceeds
 * unchanged. This never touches PO/Legal/Finance logic — it only feeds them.
 */
export async function sendAuctionWinnerToReview(
  auctionName: string,
  submittedBy?: string
): Promise<ReverseBidding> {
  const doc = await getReverseBidding(auctionName);
  if (deriveAuctionStatus(doc) !== "Completed") {
    throw new Error("The auction must be completed before approving a winner.");
  }
  const supplier = doc.winning_supplier;
  const winnerPrice = doc.winner_price ?? doc.lowest_bid ?? 0;
  if (!supplier || !(winnerPrice > 0)) {
    throw new Error("No winning supplier / winner price recorded.");
  }

  const rfq = await getRFQ(doc.rfq);
  const quotations = await getSupplierQuotations(doc.rfq);
  const sq = quotations.find(
    (q) => q.supplier === supplier || q.supplier_name === supplier
  );

  const pm = submittedBy || doc.procurement_manager || "procurement@netlink.com";

  await submitForReview({
    rfqName: rfq.name,
    rfqTitle: rfq.name,
    company: rfq.company ?? doc.company ?? "",
    selectedSupplier: sq?.supplier ?? supplier,
    selectedSupplierTotal: winnerPrice,
    rfqValue: winnerPrice,
    submittedBy: pm,
  });

  if (sq?.name) {
    const itemSummary: LegalDocumentItemSummary[] = (sq.items ?? []).map(
      (it) => ({
        item_code: it.item_code,
        item_name: it.item_name,
        qty: it.qty,
        uom: it.uom,
        rate: it.rate,
        amount: it.amount ?? it.qty * it.rate,
      })
    );
    try {
      await ensureLegalDocumentReviewForSelection({
        sq_name: sq.name,
        rfq_name: rfq.name,
        supplier: sq.supplier,
        company: rfq.company ?? doc.company ?? "",
        quotation_number: sq.name,
        procurement_manager: pm,
        submission_date: sq.transaction_date ?? new Date().toISOString(),
        grand_total: winnerPrice,
        valid_till: sq.valid_till,
        item_summary: JSON.stringify(itemSummary),
        terms_file_url: (sq.custom_terms__condition as string | undefined) ?? "",
        terms_note: sq.custom_terms_note ?? "",
        warranty_file_url:
          (sq.custom_warenty_certificate as string | undefined) ?? "",
        warranty_note: sq.custom_warranty_note ?? "",
        insurance_file_url:
          (sq.custom_insurance_certificate as string | undefined) ?? "",
        insurance_note: sq.custom_insurance_note ?? "",
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[ReverseBidding] Legal Document Review creation failed:",
        err
      );
    }
  }

  // Tag the auction so its status card reflects that it entered review.
  const remarks = `${(doc.remarks ?? "").replace(REJECTED_TAG, "").trim()}\n${APPROVED_TAG} → Legal Review ${formatERPNextDatetime(new Date())}`.trim();
  return patchReverseBidding(auctionName, { remarks }, doc.modified);
}
