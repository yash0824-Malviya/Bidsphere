import type { QuotePriceStatus, SupplierQuotation } from "../types/erpnext";
import { formatCurrency } from "./format";

export interface QuotePrice {
  amount: number | null;
  status: QuotePriceStatus;
}

export type QuoteLineLike = {
  item_code?: unknown;
  item_name?: unknown;
  item?: unknown;
  rate?: unknown;
  unit_price?: unknown;
  price?: unknown;
  quoted_rate?: unknown;
  price_list_rate?: unknown;
  net_rate?: unknown;
  base_rate?: unknown;
  amount?: unknown;
  total?: unknown;
  line_total?: unknown;
  net_amount?: unknown;
  base_amount?: unknown;
  base_net_amount?: unknown;
  qty?: unknown;
  quantity?: unknown;
  requested_qty?: unknown;
  stock_qty?: unknown;
  delivery_days?: unknown;
};

export type QuoteLike = {
  name?: unknown;
  id?: unknown;
  supplier?: unknown;
  supplier_name?: unknown;
  rfq?: unknown;
  rfq_no?: unknown;
  request_for_quotation?: unknown;
  grand_total?: unknown;
  rounded_total?: unknown;
  total?: unknown;
  net_total?: unknown;
  base_grand_total?: unknown;
  base_net_total?: unknown;
  quote_amount?: unknown;
  quoted_amount?: unknown;
  total_amount?: unknown;
  quote_total?: unknown;
  total_value?: unknown;
  amount?: unknown;
  cost?: unknown;
  taxes_and_charges_added?: unknown;
  total_taxes_and_charges?: unknown;
  discount_amount?: unknown;
  items?: QuoteLineLike[] | null;
  lines?: QuoteLineLike[] | null;
  quotation_items?: QuoteLineLike[] | null;
  quotation_lines?: QuoteLineLike[] | null;
  byItem?: Map<string, unknown> | Record<string, unknown> | null;
  docstatus?: unknown;
  status?: unknown;
};

/** Parse an explicitly supplied monetary value without turning blanks into 0. */
export function parseQuoteAmount(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    // Strip optional currency prefix / commas if present (e.g., "$3,000.00")
    const cleanStr = trimmed.replace(/^[$\s]+/, "").replace(/,/g, "");
    if (cleanStr === "" || isNaN(Number(cleanStr))) return null;
    const parsed = Number(cleanStr);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Calculate a single line item's total: quantity × unitPrice or explicit line amount. */
export function calculateQuoteLineTotal(line: QuoteLineLike): number | null {
  if (!line || typeof line !== "object") return null;

  const explicitAmount =
    parseQuoteAmount(line.amount) ??
    parseQuoteAmount(line.line_total) ??
    parseQuoteAmount(line.total) ??
    parseQuoteAmount(line.net_amount) ??
    parseQuoteAmount(line.base_amount) ??
    parseQuoteAmount(line.base_net_amount);

  const rate =
    parseQuoteAmount(line.rate) ??
    parseQuoteAmount(line.unit_price) ??
    parseQuoteAmount(line.price) ??
    parseQuoteAmount(line.quoted_rate) ??
    parseQuoteAmount(line.price_list_rate) ??
    parseQuoteAmount(line.net_rate) ??
    parseQuoteAmount(line.base_rate);

  const qty =
    parseQuoteAmount(line.qty) ??
    parseQuoteAmount(line.quantity) ??
    parseQuoteAmount(line.requested_qty) ??
    parseQuoteAmount(line.stock_qty) ??
    1;

  if (explicitAmount !== null && explicitAmount > 0) {
    return explicitAmount;
  }
  if (rate !== null && rate > 0) {
    return rate * (qty > 0 ? qty : 1);
  }
  if (explicitAmount === 0 || rate === 0) {
    return 0;
  }
  if (explicitAmount !== null) {
    return explicitAmount;
  }
  return null;
}

/** Extract line items from any supported quote object shape. */
export function extractQuoteLines(q: QuoteLike): QuoteLineLike[] {
  if (!q || typeof q !== "object") return [];
  if (Array.isArray(q.items) && q.items.length > 0) return q.items;
  if (Array.isArray(q.lines) && q.lines.length > 0) return q.lines;
  if (Array.isArray(q.quotation_items) && q.quotation_items.length > 0) return q.quotation_items;
  if (Array.isArray(q.quotation_lines) && q.quotation_lines.length > 0) return q.quotation_lines;

  if (q.byItem instanceof Map) {
    const list: QuoteLineLike[] = [];
    for (const val of q.byItem.values()) {
      if (val && typeof val === "object") list.push(val as QuoteLineLike);
    }
    if (list.length > 0) return list;
  } else if (q.byItem && typeof q.byItem === "object") {
    const list: QuoteLineLike[] = [];
    for (const val of Object.values(q.byItem)) {
      if (val && typeof val === "object") list.push(val as QuoteLineLike);
    }
    if (list.length > 0) return list;
  }

  return [];
}

/** Calculate total price from an array of quote line items. */
export function priceFromLines(lines: QuoteLineLike[]): number | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;

  let total = 0;
  let hasAtLeastOnePrice = false;

  for (const line of lines) {
    const lineTotal = calculateQuoteLineTotal(line);
    if (lineTotal !== null) {
      total += lineTotal;
      hasAtLeastOnePrice = true;
    }
  }

  return hasAtLeastOnePrice ? total : null;
}

/**
 * Single canonical function to resolve a supplier quotation total.
 * 
 * Hierarchy:
 * 1. Explicit line items sum (quantity × unitPrice) + applicable charges/taxes - discounts
 * 2. Header grand_total / total / net_total if positive (> 0)
 * 3. Explicit zero quote only if line items explicitly equal 0
 * 4. Returns null (never defaults to 0) if pricing is missing or unavailable.
 */
export function getSupplierQuoteTotal(quote: unknown): number | null {
  if (quote === null || quote === undefined) {
    return null;
  }

  if (typeof quote === "number") {
    return Number.isFinite(quote) ? quote : null;
  }

  if (typeof quote === "string") {
    return parseQuoteAmount(quote);
  }

  if (typeof quote !== "object") {
    return null;
  }

  const q = quote as QuoteLike;

  // 1. Check line items
  const lines = extractQuoteLines(q);
  const lineSum = priceFromLines(lines);

  // 2. Check header totals
  const headerTotal =
    parseQuoteAmount(q.grand_total) ??
    parseQuoteAmount(q.rounded_total) ??
    parseQuoteAmount(q.total_value) ??
    parseQuoteAmount(q.total) ??
    parseQuoteAmount(q.total_amount) ??
    parseQuoteAmount(q.quote_total) ??
    parseQuoteAmount(q.quote_amount) ??
    parseQuoteAmount(q.quoted_amount) ??
    parseQuoteAmount(q.net_total) ??
    parseQuoteAmount(q.base_grand_total) ??
    parseQuoteAmount(q.base_net_total) ??
    parseQuoteAmount(q.amount) ??
    parseQuoteAmount(q.cost);

  const taxes =
    parseQuoteAmount(q.taxes_and_charges_added) ??
    parseQuoteAmount(q.total_taxes_and_charges) ??
    0;
  const discounts = parseQuoteAmount(q.discount_amount) ?? 0;

  if (lineSum !== null && lineSum > 0) {
    return lineSum + (taxes > 0 ? taxes : 0) - (discounts > 0 ? discounts : 0);
  }

  if (headerTotal !== null && headerTotal > 0) {
    return headerTotal;
  }

  // 3. Genuine zero check: lines must exist and explicitly sum to 0
  if (lineSum === 0 && lines.length > 0) {
    return 0;
  }

  // If header explicitly zero and line items are explicitly priced at 0
  if (headerTotal === 0 && lines.length > 0 && lineSum !== null) {
    return 0;
  }

  // Log diagnostic warning if quotation object exists but amount cannot be resolved
  const supplierId = q.supplier || q.supplier_name;
  const rfqId = q.rfq || q.rfq_no || q.request_for_quotation;
  const quoteId = q.name || q.id;
  if (import.meta.env.DEV && (supplierId || rfqId || quoteId)) {
    // eslint-disable-next-line no-console
    console.warn("[QuotePrice] Quote amount could not be resolved:", {
      supplierId,
      rfqId,
      quoteId,
      headerTotal,
      lineSum,
      itemCount: lines.length,
    });
  }

  return null;
}

/**
 * Resolve a Supplier Quotation price and status while preserving incomplete data.
 * A numeric zero is accepted only when the quote contains explicit zero
 * pricing; absent/blank values stay null with "price_not_provided" status.
 */
export function resolveQuotePrice(quote: unknown): QuotePrice {
  if (quote === null || quote === undefined) {
    return { amount: null, status: "not_submitted" };
  }

  if (typeof quote === "number") {
    return Number.isFinite(quote)
      ? { amount: quote, status: "submitted" }
      : { amount: null, status: "price_not_provided" };
  }

  if (typeof quote === "string") {
    const trimmed = quote.trim();
    if (trimmed === "") {
      return { amount: null, status: "price_not_provided" };
    }
    const parsed = parseQuoteAmount(trimmed);
    return parsed !== null
      ? { amount: parsed, status: "submitted" }
      : { amount: null, status: "price_not_provided" };
  }

  if (typeof quote !== "object") {
    return { amount: null, status: "price_not_provided" };
  }

  const amount = getSupplierQuoteTotal(quote);
  if (amount !== null) {
    return { amount, status: "submitted" };
  }

  return { amount: null, status: "price_not_provided" };
}

export function resolveSupplierQuotationPrice(
  quote: SupplierQuotation | null | undefined,
): QuotePrice {
  return resolveQuotePrice(quote as QuoteLike | null | undefined);
}

export function isSubmittedQuoteAmount(
  amount: number | null | undefined,
): amount is number {
  return typeof amount === "number" && Number.isFinite(amount);
}

export function formatQuoteTotal(
  amount: number | null | undefined,
  status?: QuotePriceStatus,
): string {
  if (status === "not_submitted") return "Not Submitted";
  if (status === "price_not_provided") return "Amount unavailable";
  if (isSubmittedQuoteAmount(amount)) return formatCurrency(amount);
  return status === "submitted" ? "Amount unavailable" : "Not Submitted";
}
