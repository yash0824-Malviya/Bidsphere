/**
 * Parse warehouse review metadata (StockDecisions / ForwardedItems tags)
 * into a human-readable summary for Procurement UI — never expose raw JSON.
 */

import type { StockDecisionAction } from "../api/stockDecisionAudit";
import type { MaterialRequestItem } from "../types/erpnext";
import {
  extractBidSphereJsonTag,
  extractWarehouseMachineTags,
  parseForwardedItemsJsonFromRemarks,
} from "./warehouseIssueFulfillmentSync";
import { warehouseActionLabel } from "./warehouseStockActionRules";

export interface WarehouseReviewSummaryItem {
  item_code: string;
  item_name: string;
  requested_qty: number;
  available_qty: number;
  warehouse_action: string;
  uom: string;
}

export interface WarehouseForwardedBullet {
  name: string;
  qty: number;
  uom: string;
}

export interface WarehouseReviewSummary {
  reviewer_name: string;
  review_date: string;
  items_forwarded: WarehouseForwardedBullet[];
  reason: string;
  action: string;
  warehouse_notes: string;
  /** @deprecated Use warehouse_notes — kept for compatibility */
  manual_remarks: string;
  /** @deprecated Use items_forwarded / reason / action */
  section_title: string;
  /** @deprecated Use reason */
  overall_remarks: string[];
  /** @deprecated Detailed line items */
  items: WarehouseReviewSummaryItem[];
  hasContent: boolean;
}

type StockDecisionRow = {
  item_code: string;
  recommended_action?: StockDecisionAction;
  selected_action?: StockDecisionAction;
  selected_by?: string;
  selected_at?: string;
  reason?: string;
};

const INTERNAL_LINE_RE =
  /^\[BidSphere:|^\[ForwardedItems:|^\[BidSphere RFQ:|^\s*[\[{]|"(item_code|selected_action|recommended_action|forward_qty)"/i;

function parseStockDecisionsFromRemarks(
  remarks: string | null | undefined,
): StockDecisionRow[] {
  const hit = extractBidSphereJsonTag(remarks, "StockDecisions");
  if (!hit) return [];
  try {
    const parsed = JSON.parse(hit.json) as StockDecisionRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseForwardedAuditTag(raw: string): { by?: string; at?: string } {
  const m = raw.match(/\[BidSphere:Forwarded:([^|\]]+?)\|([^\]]+)\]/i);
  if (!m) return {};
  return { by: m[1]?.trim(), at: m[2]?.trim() };
}

function formatReviewDate(value?: string | null): string {
  if (!value?.trim()) return "—";
  const normalized = value.trim().includes("T")
    ? value.trim()
    : value.trim().replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return value.trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  let hours = d.getHours();
  const minutes = pad(d.getMinutes());
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${pad(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()} ${pad(hours)}:${minutes} ${ampm}`;
}

/**
 * Remove all BidSphere / JSON / debug metadata — safe for Procurement UI.
 */
export function cleanWarehouseProseForDisplay(
  raw: string | null | undefined,
): string {
  let text = String(raw || "");
  text = extractWarehouseMachineTags(text).prose;
  text = text.replace(/\[BidSphere:[^\]]*\]/gi, "");
  text = text.replace(/\[ForwardedItems:[\s\S]*?\]/gi, "");
  text = text.replace(/\[\s*\{[\s\S]*?\}\s*(?:,\s*\{[\s\S]*?\}\s*)*\]/g, "");
  text = text.replace(/\{[\s\S]*?"item_code"[\s\S]*?\}/g, "");

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((line) => !INTERNAL_LINE_RE.test(line));

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Strip all BidSphere machine tags — safe for supplier-facing / prose fields. */
export function stripAllBidSphereMetadata(text?: string | null): string {
  return cleanWarehouseProseForDisplay(text);
}

function deriveReason(items: WarehouseReviewSummaryItem[]): string {
  if (items.length === 0) return "";
  const allZero = items.every((i) => i.available_qty <= 0);
  const allForward = items.every((i) => /forward/i.test(i.warehouse_action));
  const anyPartial = items.some((i) => /partial/i.test(i.warehouse_action));
  if (allZero && allForward) return "Insufficient inventory available.";
  if (anyPartial) return "Partial stock available.";
  if (allForward) return "Items require procurement sourcing.";
  return "Warehouse review completed.";
}

function deriveAction(items: WarehouseReviewSummaryItem[]): string {
  if (items.length === 0) return "";
  const allForward = items.every((i) => /forward/i.test(i.warehouse_action));
  const anyPartial = items.some((i) => /partial/i.test(i.warehouse_action));
  if (anyPartial) return "Issue partial stock and forward remaining to Procurement.";
  if (allForward) return "Forwarded to Procurement.";
  return "Issue material from warehouse stock.";
}

/**
 * Build a procurement-facing warehouse review summary from raw MR remarks.
 * Structured JSON tags are parsed internally; only human-readable fields are returned.
 */
export function buildWarehouseReviewSummary(
  rawRemarks: string | null | undefined,
  opts?: {
    forwarded_by?: string | null;
    forwarded_on?: string | null;
    mr_items?: MaterialRequestItem[];
    material_request?: string;
  },
): WarehouseReviewSummary {
  const raw = String(rawRemarks || "");
  const forwardedAudit = parseForwardedAuditTag(raw);
  const warehouse_notes = cleanWarehouseProseForDisplay(raw);
  const stockDecisions = parseStockDecisionsFromRemarks(raw);
  const forwardedItems = parseForwardedItemsJsonFromRemarks(raw);

  const itemNameByCode = new Map<string, string>();
  for (const it of opts?.mr_items ?? []) {
    if (it.item_code) {
      itemNameByCode.set(
        it.item_code,
        it.item_name?.trim() || it.description?.trim() || it.item_code,
      );
    }
  }
  for (const fi of forwardedItems) {
    if (fi.item_code && fi.item_name) {
      itemNameByCode.set(fi.item_code, fi.item_name);
    }
  }

  const mergedCodes = new Set<string>();
  for (const row of stockDecisions) mergedCodes.add(row.item_code);
  for (const fi of forwardedItems) mergedCodes.add(fi.item_code);

  const items: WarehouseReviewSummaryItem[] = [];

  for (const itemCode of mergedCodes) {
    const decision = stockDecisions.find((r) => r.item_code === itemCode);
    const forwarded = forwardedItems.find((f) => f.item_code === itemCode);
    const mrItem = opts?.mr_items?.find((i) => i.item_code === itemCode);

    const requested =
      forwarded?.requested_qty ?? (Number(mrItem?.qty) || 0);
    const available =
      forwarded?.available_qty != null
        ? Math.max(0, Number(forwarded.available_qty) || 0)
        : forwarded?.issued_qty != null
          ? Math.max(
              0,
              requested - Math.max(0, Number(forwarded.forward_qty) || 0),
            )
          : 0;

    const action = decision?.selected_action ?? decision?.recommended_action;
    const warehouse_action = action
      ? warehouseActionLabel(action)
      : forwarded && (forwarded.forward_qty ?? forwarded.shortage_qty ?? 0) > 0
        ? "Forward to Procurement"
        : "Reviewed";

    items.push({
      item_code: itemCode,
      item_name:
        forwarded?.item_name?.trim() ||
        itemNameByCode.get(itemCode) ||
        itemCode,
      requested_qty: requested,
      available_qty: available,
      warehouse_action,
      uom: forwarded?.uom || mrItem?.uom || mrItem?.stock_uom || "Nos",
    });
  }

  items.sort((a, b) => a.item_code.localeCompare(b.item_code));

  const primaryDecision = stockDecisions[0];
  const reviewer_name =
    opts?.forwarded_by?.trim() ||
    forwardedAudit.by?.trim() ||
    primaryDecision?.selected_by?.trim() ||
    "Warehouse Manager";
  const review_date = formatReviewDate(
    opts?.forwarded_on ||
      forwardedAudit.at ||
      primaryDecision?.selected_at,
  );

  const allForward =
    items.length > 0 &&
    items.every((i) => /forward/i.test(i.warehouse_action));
  const section_title = allForward ? "Items Forwarded" : "Items Reviewed";

  const reason = deriveReason(items);
  const action = deriveAction(items);
  const overall_remarks = reason
    ? [reason, action.endsWith(".") ? action : `${action}.`].filter(Boolean)
    : [];

  const items_forwarded = items
    .filter((i) => /forward/i.test(i.warehouse_action))
    .map((i) => ({
      name: i.item_name,
      qty: i.requested_qty,
      uom: i.uom,
    }));

  const hasContent =
    items.length > 0 ||
    Boolean(reason) ||
    Boolean(warehouse_notes);

  return {
    reviewer_name,
    review_date,
    items_forwarded,
    reason,
    action,
    warehouse_notes,
    manual_remarks: warehouse_notes,
    section_title,
    overall_remarks,
    items,
    hasContent,
  };
}
