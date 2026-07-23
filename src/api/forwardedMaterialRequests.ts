/**
 * Forwarded Material Requests — Procurement-side data layer.
 *
 * ERPNext is the ONLY source of truth (no local storage / mock arrays). This
 * module derives, from live Material Request + RFQ + PO data:
 *   • the ACTIVE forwarded queue (forwarded, no RFQ yet) — see fetchProcurementQueue
 *   • the FORWARDED HISTORY (every MR ever forwarded, never deleted)
 *   • dashboard counters (forwarded / RFQs pending / RFQs created today / history)
 *
 * History enrichment is batched (one RFQ list fetch + one PO map) instead of
 * N per-row detail calls so the list stays fast.
 */
import {
  fetchMaterialRequestWorkflow,
  fetchProcurementQueue,
  getMaterialRequestWorkflowStatus,
  getMaterialRequestProcurementType,
  getMaterialRequestMode,
  listSubmittedMaterialRequestsCached,
  parseForwardedItemsFromMr,
  type MaterialRequestWorkflowRecord,
} from "./materialRequestWorkflow";
import { hydrateEngineeringDocsFromChild } from "../utils/materialRequestItemFiles";
import {
  batchRFQToPOMap,
  fetchErpNextRFQs,
  type ErpRFQRow,
} from "./legalReviews";
import { timedDashApi } from "./dashboardPerf";
import type {
  MaterialRequestMode,
  MaterialRequestProcurementType,
} from "../types/materialRequestWorkflow";

/* ─── stage model ────────────────────────────────────────────────────────── */

/** The full enterprise procurement lifecycle (spec §3 / §9). */
export const PROCUREMENT_STAGES = [
  "Department Created",
  "Warehouse Review",
  "Sent to Procurement",
  "RFQ Created",
  "Supplier Quotations",
  "Reverse Bidding",
  "AI Recommendation",
  "Legal Review",
  "Finance Review",
  "Purchase Order",
  "GRN",
  "Completed",
] as const;

export type ProcurementStage = (typeof PROCUREMENT_STAGES)[number];

export interface ForwardedItemLine {
  item_code: string;
  item_name: string;
  requested_qty: number;
  available_qty: number;
  remaining_qty: number;
  uom: string;
  warehouse: string;
  /** Optional engineering docs from Material Request Item (read-only). */
  part_name?: string;
  drawing_2d_url?: string;
  attachments?: import("../utils/materialRequestItemFiles").EngineeringAttachment[];
}

export interface ForwardedHistoryRow {
  mrNumber: string;
  department: string;
  warehouse: string;
  priority: string;
  procurementType: MaterialRequestProcurementType;
  requestMode: MaterialRequestMode;
  forwardedOn: string;
  forwardedBy: string;
  requestedBy: string;
  requiredDate: string;
  rfqNumber: string | null;
  rfqStatus: string;
  rfqCreatedOn: string | null;
  poNumber: string | null;
  currentStage: ProcurementStage;
  lastUpdated: string;
  status: string;
  totalItems: number;
  remainingQty: number;
  items: ForwardedItemLine[];
}

export interface ForwardedCounters {
  /** MRs at "Sent to Procurement" (awaiting RFQ). */
  forwardedRequests: number;
  rfqsPending: number;
  rfqsCreatedToday: number;
  /** All forwarded MRs (history). */
  historyCount: number;
  /** Forwarded MRs with High / Urgent priority. */
  highPriorityRequests: number;
  /** MRs forwarded to procurement today. */
  requestsCreatedToday: number;
}

/* ─── forwarded detection ────────────────────────────────────────────────── */

const FORWARDED_TAG = /\[BidSphere:Forwarded:([^|\]]*)\|([^\]]+)\]/;

function linkedRfqOf(mr: MaterialRequestWorkflowRecord): string | null {
  if (mr.custom_linked_rfq) return mr.custom_linked_rfq;
  const raw = String(mr.custom_warehouse_remarks ?? mr.remarks ?? "");
  const m = raw.match(/\[BidSphere RFQ:([^\]]+)\]/);
  return m?.[1]?.trim() || null;
}

/**
 * True when the MR was forwarded to Procurement by Warehouse. Uses every
 * reliable marker so a forwarded MR is never missed, while MRs that were only
 * issued from stock (never forwarded) are excluded.
 */
function isForwarded(mr: MaterialRequestWorkflowRecord): boolean {
  const status = getMaterialRequestWorkflowStatus(mr);
  // Forwarded History = actually handed to Procurement (not warehouse-only shortage).
  if (status === "Forwarded to Procurement" || status === "RFQ Created")
    return true;
  if (Number(mr.custom_forwarded_to_procurement) === 1) return true;
  if (linkedRfqOf(mr)) return true;
  const raw = String(mr.custom_warehouse_remarks ?? mr.remarks ?? "");
  return FORWARDED_TAG.test(raw);
}

function parseForwardedMeta(mr: MaterialRequestWorkflowRecord): {
  by: string;
  at: string;
} {
  if (mr.custom_forwarded_on) {
    return {
      by: mr.custom_forwarded_by || mr.modified_by || "",
      at: mr.custom_forwarded_on,
    };
  }
  const raw = String(mr.custom_warehouse_remarks ?? mr.remarks ?? "");
  const m = raw.match(FORWARDED_TAG);
  if (m) return { by: m[1]?.trim() || "", at: m[2]?.trim() || "" };
  // Fall back to the last write to the MR — the forward is normally the final
  // warehouse action before it leaves the queue.
  return { by: mr.modified_by || "", at: mr.modified || mr.creation || "" };
}

async function buildItemLines(
  mr: MaterialRequestWorkflowRecord,
): Promise<ForwardedItemLine[]> {
  const forwarded = parseForwardedItemsFromMr(mr);
  if (forwarded.length > 0) {
    return Promise.all(
      forwarded.map(async (fi) => {
        const remaining = fi.forward_qty ?? fi.shortage_qty ?? 0;
        const requested = fi.requested_qty ?? remaining;
        const mrItem = (mr.items ?? []).find((i) => i.item_code === fi.item_code);
        const eng = await hydrateEngineeringDocsFromChild(mrItem);
        return {
          item_code: fi.item_code,
          item_name: fi.item_name ?? fi.item_code,
          requested_qty: requested,
          available_qty: fi.issued_qty ?? Math.max(0, requested - remaining),
          remaining_qty: remaining,
          uom: fi.uom ?? "Nos",
          warehouse: fi.warehouse ?? "—",
          ...eng,
        };
      }),
    );
  }
  return Promise.all(
    (mr.items ?? []).map(async (it) => {
      const requested = Number(it.qty) || 0;
      const eng = await hydrateEngineeringDocsFromChild(it);
      return {
        item_code: it.item_code,
        item_name: it.item_name ?? it.item_code,
        requested_qty: requested,
        available_qty: 0,
        remaining_qty: requested,
        uom: it.uom ?? "Nos",
        warehouse: it.warehouse ?? "—",
        ...eng,
      };
    }),
  );
}

/* ─── RFQ status + stage derivation ──────────────────────────────────────── */

function rfqStatusLabel(rfq: ErpRFQRow | undefined): string {
  if (!rfq) return "—";
  const finance = (rfq.custom_finance_status ?? "").toLowerCase();
  const legal = (rfq.custom_legal_status ?? "").toLowerCase();
  const step = rfq.custom_workflow_step ?? "";
  if (/approv/.test(finance)) return "Finance Approved";
  if (/reject/.test(finance) || /reject/.test(legal)) return "Rejected";
  if (/approv/.test(legal)) return "Legal Approved";
  if (step) return step;
  if (rfq.custom_selected_supplier) return "Supplier Selected";
  return "Submitted";
}

function deriveStage(
  mr: MaterialRequestWorkflowRecord,
  rfq: ErpRFQRow | undefined,
  poNumber: string | null,
): ProcurementStage {
  const status = getMaterialRequestWorkflowStatus(mr);
  if (status === "Completed") return "Completed";
  if (poNumber) return "Purchase Order";
  if (rfq) {
    const finance = (rfq.custom_finance_status ?? "").toLowerCase();
    const legal = (rfq.custom_legal_status ?? "").toLowerCase();
    if (/approv/.test(finance)) return "Finance Review";
    if (/approv/.test(legal)) return "Legal Review";
    if (rfq.custom_selected_supplier) return "AI Recommendation";
    return "RFQ Created";
  }
  if (linkedRfqOf(mr)) return "RFQ Created";
  return "Sent to Procurement";
}

/* ─── active queue (forwarded, no RFQ yet) ───────────────────────────────── */

/**
 * Forwarded MRs that still need an RFQ. Built on the shared, resilient
 * `fetchProcurementQueue` (same cache key across dashboard / warehouse) and
 * filtered to rows whose RFQ has NOT been created yet.
 */
export async function fetchForwardedActiveQueue(): Promise<
  MaterialRequestWorkflowRecord[]
> {
  // fetchProcurementQueue already excludes MRs with an *active* RFQ and
  // clears stale Cancelled/Rejected links in memory.
  const queue = await fetchProcurementQueue();
  return queue.filter((mr) => {
    const status = getMaterialRequestWorkflowStatus(mr);
    return (
      status === "Forwarded to Procurement" || status === "RFQ Created"
    );
  });
}

/* ─── forwarded history (every forwarded MR, never deleted) ──────────────── */

async function toHistoryRow(
  mr: MaterialRequestWorkflowRecord,
  rfqMap: Map<string, ErpRFQRow>,
  poMap: Map<string, string>,
  includeItems: boolean,
): Promise<ForwardedHistoryRow> {
  const rfqNumber = linkedRfqOf(mr);
  const rfq = rfqNumber ? rfqMap.get(rfqNumber) : undefined;
  const poNumber = rfqNumber ? (poMap.get(rfqNumber) ?? null) : null;
  const meta = parseForwardedMeta(mr);
  const items = includeItems ? await buildItemLines(mr) : [];
  return {
    mrNumber: mr.name,
    department: mr.custom_department || mr.department || "—",
    warehouse:
      items.find((i) => i.warehouse && i.warehouse !== "—")?.warehouse ?? "—",
    priority: mr.custom_priority || "Medium",
    procurementType: getMaterialRequestProcurementType(mr),
    requestMode: getMaterialRequestMode(mr),
    forwardedOn: meta.at,
    forwardedBy: meta.by,
    requestedBy: mr.custom_requested_by || mr.owner || "—",
    requiredDate: mr.schedule_date || "",
    rfqNumber,
    rfqStatus: rfqStatusLabel(rfq),
    rfqCreatedOn: rfq?.creation ?? null,
    poNumber,
    currentStage: deriveStage(mr, rfq, poNumber),
    lastUpdated: mr.modified || "",
    status: getMaterialRequestWorkflowStatus(mr),
    totalItems: items.length,
    remainingQty: items.reduce((s, i) => s + i.remaining_qty, 0),
    items,
  };
}

/**
 * Dashboard Action Center counters — NO per-MR get_doc hydration.
 * Uses the shared submitted-MR list + bulk RFQ/PO enrichment only.
 */
export async function fetchForwardedDashboardCounters(): Promise<ForwardedCounters> {
  return timedDashApi("Action Center · forwarded counters", async () => {
    const all = await listSubmittedMaterialRequestsCached(500);
    const forwardedLite = all.filter(isForwarded);
    const rfqNames = [
      ...new Set(
        forwardedLite.map(linkedRfqOf).filter((n): n is string => Boolean(n)),
      ),
    ];
    const [rfqMap, poMap] = await Promise.all([
      rfqNames.length > 0
        ? timedDashApi("Action Center · RFQ map", () =>
            fetchErpNextRFQs().catch(() => new Map<string, ErpRFQRow>()),
          )
        : Promise.resolve(new Map<string, ErpRFQRow>()),
      rfqNames.length > 0
        ? timedDashApi("Action Center · PO map", () =>
            batchRFQToPOMap(rfqNames).catch(() => new Map<string, string>()),
          )
        : Promise.resolve(new Map<string, string>()),
    ]);

    const rows = await Promise.all(
      forwardedLite.map((mr) => toHistoryRow(mr, rfqMap, poMap, false)),
    );
    return buildForwardedCounters(rows);
  });
}

export async function fetchForwardedHistory(): Promise<ForwardedHistoryRow[]> {
  console.log("[Procurement] Loading forwarded history…");

  const all = await listSubmittedMaterialRequestsCached(500);

  const forwardedLite = all.filter(isForwarded);

  // Hydrate a bounded subset for the history pages (items / warehouse).
  // Cap keeps the N× get_doc fan-out from blocking the UI on large tenants.
  const HYDRATE_CAP = 80;
  const toHydrate = forwardedLite.slice(0, HYDRATE_CAP);
  const rest = forwardedLite.slice(HYDRATE_CAP);
  const hydrated = await Promise.all(
    toHydrate.map(async (doc) => {
      try {
        return await fetchMaterialRequestWorkflow(doc.name);
      } catch {
        return doc;
      }
    }),
  );
  const forwarded = [...hydrated, ...rest];

  // Batch-enrich: one RFQ list fetch + one PO map for every linked RFQ.
  const rfqNames = [
    ...new Set(
      forwarded.map(linkedRfqOf).filter((n): n is string => Boolean(n)),
    ),
  ];
  const [rfqMap, poMap] = await Promise.all([
    rfqNames.length > 0
      ? fetchErpNextRFQs().catch(() => new Map<string, ErpRFQRow>())
      : Promise.resolve(new Map<string, ErpRFQRow>()),
    rfqNames.length > 0
      ? batchRFQToPOMap(rfqNames).catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>()),
  ]);

  const rows = await Promise.all(
    forwarded.map((mr) => toHistoryRow(mr, rfqMap, poMap, true)),
  );

  rows.sort((a, b) => (b.forwardedOn || "").localeCompare(a.forwardedOn || ""));

  console.log(`[Procurement] Forwarded history: ${rows.length} records`, {
    withRfq: rows.filter((r) => r.rfqNumber).length,
    withPo: rows.filter((r) => r.poNumber).length,
  });

  return rows;
}

/* ─── dashboard counters ─────────────────────────────────────────────────── */

export function buildForwardedCounters(
  history: ForwardedHistoryRow[],
): ForwardedCounters {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const highPriority = new Set(["Urgent", "High"]);

  const isToday = (raw: string | null | undefined): boolean => {
    if (!raw) return false;
    const d = new Date(raw);
    return !Number.isNaN(d.getTime()) && d >= startOfToday;
  };

  const forwardedRequests = history.filter(
    (r) => r.currentStage === "Sent to Procurement",
  ).length;

  const rfqsPending = history.filter(
    (r) => r.rfqNumber && !r.poNumber && r.currentStage !== "Completed",
  ).length;

  // RFQs whose linked RFQ document was created today (live RFQ creation date).
  const rfqsCreatedToday = history.filter((r) =>
    isToday(r.rfqCreatedOn),
  ).length;

  const highPriorityRequests = history.filter((r) =>
    highPriority.has(String(r.priority || "").trim()),
  ).length;

  const requestsCreatedToday = history.filter((r) =>
    isToday(r.forwardedOn),
  ).length;

  return {
    forwardedRequests,
    rfqsPending,
    rfqsCreatedToday,
    historyCount: history.length,
    highPriorityRequests,
    requestsCreatedToday,
  };
}
