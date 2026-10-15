import type { QuotePriceStatus, SupplierVerdict } from "../types/erpnext";
import { parseQuoteAmount, resolveQuotePrice, type QuoteLike } from "./quotePrice";

export interface QuotationCompletenessResult {
  quotation_status: "COMPLETE" | "INCOMPLETE";
  is_complete: boolean;
  missing_fields: string[];
}

/**
 * Determine quotation completeness ONLY from the actual quotation record:
 * - workflow/submission state
 * - docstatus
 * - mandatory quotation fields
 * - actual saved quotation data
 *
 * Does NOT use:
 * - AI score
 * - risk score
 * - weighted score
 * - price score
 * - delivery score
 * - quality score
 * - reliability score
 * - recommendation score
 */
export function evaluateQuotationCompleteness(
  record: unknown,
): QuotationCompletenessResult {
  if (!record || typeof record !== "object") {
    return {
      quotation_status: "INCOMPLETE",
      is_complete: false,
      missing_fields: ["Quotation Record"],
    };
  }

  const quote = record as Record<string, unknown>;

  // If the record already carries a definitive completeness result from backend/authoritative source,
  // preserve it without re-deriving unless missing_fields needs evaluation.
  if (
    typeof quote.is_complete === "boolean" &&
    (quote.quotation_status === "COMPLETE" || quote.quotation_status === "INCOMPLETE") &&
    Array.isArray(quote.missing_fields)
  ) {
    return {
      quotation_status: quote.quotation_status,
      is_complete: quote.is_complete,
      missing_fields: quote.missing_fields as string[],
    };
  }

  const missingFields: string[] = [];

  // 1. Mandatory Supplier Identity
  const supplierId =
    quote.supplier ||
    quote.supplier_name ||
    quote.supplier_id ||
    quote.name;
  if (!supplierId || (typeof supplierId === "string" && !supplierId.trim())) {
    missingFields.push("Supplier");
  }

  // 2. Submission State / Workflow / Docstatus
  // docstatus 0 = Draft, 1 = Submitted, 2 = Cancelled
  const docstatus = quote.docstatus;
  const statusStr = typeof quote.status === "string" ? quote.status.trim().toLowerCase() : "";
  const priceStatus =
    (quote.price_status as string) ||
    (quote.priceStatus as string) ||
    (quote.quote_price_status as string) ||
    "";

  if (docstatus !== undefined && docstatus !== null) {
    const docNum = Number(docstatus);
    if (docNum === 0) {
      missingFields.push("Quotation Submission");
    } else if (docNum === 2) {
      missingFields.push("Quotation Submission");
    }
  } else if (statusStr === "draft") {
    missingFields.push("Quotation Submission");
  } else if (statusStr === "cancelled") {
    missingFields.push("Quotation Submission");
  } else if (priceStatus === "not_submitted") {
    missingFields.push("Quotation Submission");
  }

  // 3. Items and Pricing
  const items = Array.isArray(quote.items)
    ? quote.items
    : Array.isArray(quote.lines)
    ? quote.lines
    : Array.isArray(quote.quotation_items)
    ? quote.quotation_items
    : null;

  const byItem = quote.byItem instanceof Map ? quote.byItem : null;

  const hasItems =
    (items !== null && items.length > 0) ||
    (byItem !== null && byItem.size > 0);

  if (items !== null && items.length === 0 && (!byItem || byItem.size === 0)) {
    missingFields.push("Quotation Items");
  }

  const resolvedPrice = resolveQuotePrice(quote as QuoteLike);
  const totalAmount =
    resolvedPrice.amount ??
    parseQuoteAmount(quote.grand_total) ??
    parseQuoteAmount(quote.total) ??
    parseQuoteAmount(quote.total_value) ??
    parseQuoteAmount(quote.amount);

  if (
    totalAmount === null ||
    totalAmount <= 0 ||
    resolvedPrice.status === "price_not_provided" ||
    resolvedPrice.status === "not_submitted"
  ) {
    missingFields.push("Pricing");
  }

  // 4. Delivery Date / Commitment
  // Must provide a delivery commitment: delivery_date, valid_till, or delivery_days > 0
  let hasDelivery = false;

  const rawValidTill = quote.valid_till || quote.validityDate || quote.validity_date;
  if (typeof rawValidTill === "string" && rawValidTill.trim().length > 0) {
    hasDelivery = true;
  }

  const rawDeliveryDate = quote.delivery_date || quote.expected_delivery_date || quote.schedule_date;
  if (typeof rawDeliveryDate === "string" && rawDeliveryDate.trim().length > 0) {
    hasDelivery = true;
  }

  const rawDeliveryDays = parseQuoteAmount(quote.delivery_days ?? quote.lead_time_days);
  if (rawDeliveryDays !== null && rawDeliveryDays > 0) {
    hasDelivery = true;
  }

  if (!hasDelivery && items && items.length > 0) {
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const itObj = it as Record<string, unknown>;
      const itDate = itObj.delivery_date || itObj.expected_delivery_date;
      if (typeof itDate === "string" && itDate.trim().length > 0) {
        hasDelivery = true;
        break;
      }
      const itDays = parseQuoteAmount(itObj.delivery_days ?? itObj.lead_time_days);
      if (itDays !== null && itDays > 0) {
        hasDelivery = true;
        break;
      }
    }
  }

  if (!hasDelivery && byItem && byItem.size > 0) {
    for (const val of byItem.values()) {
      if (val && typeof val === "object") {
        const v = val as Record<string, unknown>;
        const d = parseQuoteAmount(v.delivery_days);
        if (d !== null && d > 0) {
          hasDelivery = true;
          break;
        }
      }
    }
  }

  // If price is valid and total amount > 0, but no delivery timeline or date is given anywhere on a full quotation record
  const isFullQuotation = items !== null || byItem !== null || "delivery_date" in quote || "valid_till" in quote || "delivery_days" in quote || "expected_delivery_date" in quote;
  if (!hasDelivery && isFullQuotation) {
    missingFields.push("Delivery Date");
  }

  // Unique missing fields
  const uniqueMissing = Array.from(new Set(missingFields));

  if (uniqueMissing.length === 0) {
    return {
      quotation_status: "COMPLETE",
      is_complete: true,
      missing_fields: [],
    };
  }

  return {
    quotation_status: "INCOMPLETE",
    is_complete: false,
    missing_fields: uniqueMissing,
  };
}

/**
 * Determine verdict independently of derived scores:
 * - A complete quotation must NEVER be labeled "QUOTE INCOMPLETE"
 * - High risk + complete quotation => "HIGH RISK / REVIEW"
 * - Incomplete quotation => "QUOTE INCOMPLETE"
 * - Preserves "AVOID" if explicitly set
 */
export function resolveSupplierVerdict(params: {
  completeness: QuotationCompletenessResult;
  risk?: string | null;
  rank?: number;
  existingVerdict?: string | null;
}): SupplierVerdict {
  if (params.existingVerdict === "AVOID") {
    return "AVOID";
  }

  if (!params.completeness.is_complete) {
    return "QUOTE INCOMPLETE";
  }

  const isHighRisk = params.risk === "High" || params.risk === "HIGH RISK";

  if (isHighRisk || params.existingVerdict === "HIGH RISK / REVIEW") {
    return "HIGH RISK / REVIEW";
  }

  if (
    params.existingVerdict === "BEST VALUE" ||
    params.existingVerdict === "GOOD OPTION" ||
    params.existingVerdict === "EXPENSIVE"
  ) {
    return params.existingVerdict;
  }

  if (params.rank === 1) {
    return "BEST VALUE";
  }

  return "GOOD OPTION";
}
