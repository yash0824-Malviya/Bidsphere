/**
 * Centralized Supplier Portal RFQ & Quotation Status Resolver
 *
 * Implements the 7-state supplier quotation state machine:
 * 1. Awaiting Quotation (Action: Continue Quotation)
 * 2. Draft Quotation (Action: Continue Quotation)
 * 3. Quotation Submitted (Action: View Details)
 * 4. Revision Requested (Action: Revise Quotation)
 * 5. Under Review (Action: View Details)
 * 6. Awarded (Action: View Details)
 * 7. Closed (Action: View Details)
 *
 * Serves as the single source of truth across:
 * - My RFQs (SupplierRFQsPage)
 * - RFQ / Quotation Details (SupplierRFQPage)
 * - Submitted Quotations (SupplierQuotationsPage)
 * - Supplier Dashboard (SupplierDashboard)
 * - Notifications
 */

import type { StatusTone } from "../components/StatusBadge";

export type SupplierQuotationState =
  | "Awaiting Quotation"
  | "Draft Quotation"
  | "Quotation Submitted"
  | "Under Review"
  | "Revision Requested"
  | "Awarded"
  | "Closed";

export type SupplierQuotationAction = "continue" | "details" | "revise";

export interface SupplierRfqStatusMeta {
  status: SupplierQuotationState;
  label: string;
  action: SupplierQuotationAction;
  actionLabel: string;
  tone: StatusTone;
  isReadOnly: boolean;
  canEdit: boolean;
}

export const SUPPLIER_RFQ_STATUS_META: Record<
  SupplierQuotationState,
  SupplierRfqStatusMeta
> = {
  "Awaiting Quotation": {
    status: "Awaiting Quotation",
    label: "Awaiting Quotation",
    action: "continue",
    actionLabel: "Continue Quotation",
    tone: "warning", // Amber
    isReadOnly: false,
    canEdit: true,
  },
  "Draft Quotation": {
    status: "Draft Quotation",
    label: "Draft Quotation",
    action: "continue",
    actionLabel: "Continue Quotation",
    tone: "neutral", // Gray / slate
    isReadOnly: false,
    canEdit: true,
  },
  "Quotation Submitted": {
    status: "Quotation Submitted",
    label: "Quotation Submitted",
    action: "details",
    actionLabel: "View Details",
    tone: "info", // Blue
    isReadOnly: true,
    canEdit: false,
  },
  "Under Review": {
    status: "Under Review",
    label: "Under Review",
    action: "details",
    actionLabel: "View Details",
    tone: "info", // Blue
    isReadOnly: true,
    canEdit: false,
  },
  "Revision Requested": {
    status: "Revision Requested",
    label: "Revision Requested",
    action: "revise",
    actionLabel: "Revise Quotation",
    tone: "warning", // Orange / amber
    isReadOnly: false,
    canEdit: true,
  },
  Awarded: {
    status: "Awarded",
    label: "Awarded",
    action: "details",
    actionLabel: "View Details",
    tone: "awarded", // Green
    isReadOnly: true,
    canEdit: false,
  },
  Closed: {
    status: "Closed",
    label: "Closed",
    action: "details",
    actionLabel: "View Details",
    tone: "closed", // Gray
    isReadOnly: true,
    canEdit: false,
  },
};

export interface SupplierQuotationLike {
  name?: string;
  status?: string | null;
  docstatus?: number | null;
  modified?: string | null;
  creation?: string | null;
  valid_till?: string | null;
  grand_total?: number | null;
  custom_revision_requested?: number | boolean | null;
  amended_from?: string | null;
  supplier?: string | null;
  supplier_name?: string | null;
  items?: Array<{
    request_for_quotation?: string | null;
  }> | null;
}

export interface RfqLike {
  name: string;
  status?: string | null;
  docstatus?: number | null;
  valid_till?: string | null;
  award_supplier?: string | null;
  suppliers?: Array<{
    supplier?: string;
    supplier_name?: string;
    quote_status?: string;
  }> | null;
}

export interface SupplierRfqStatusParams {
  rfq?: RfqLike | null;
  quotation?: SupplierQuotationLike | null;
  quotations?: SupplierQuotationLike[] | null;
  supplierId?: string | null;
  declined?: boolean | null;
  hasLocalDraft?: boolean | null;
}

export interface SupplierRfqStatusResult extends SupplierRfqStatusMeta {
  effectiveQuotation?: SupplierQuotationLike | null;
}

function normalizeKey(str?: string | null): string {
  return String(str || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.,]+$/g, "")
    .toLowerCase();
}

function matchesSupplier(
  quoteSupplier?: string | null,
  targetSupplier?: string | null,
): boolean {
  if (!targetSupplier) return true;
  if (!quoteSupplier) return true;
  const k1 = normalizeKey(quoteSupplier);
  const k2 = normalizeKey(targetSupplier);
  return k1 === k2 || k1.includes(k2) || k2.includes(k1);
}

/**
 * Find the latest effective quotation record for the current supplier and RFQ.
 * Edge case handling: multiple quotation records / revisions.
 */
export function findEffectiveQuotation(
  quotations: SupplierQuotationLike[],
  supplierId?: string | null,
  rfqName?: string | null,
): SupplierQuotationLike | null {
  if (!quotations || quotations.length === 0) return null;

  // Filter for matching RFQ if items present
  const relevant = quotations.filter((q) => {
    if (supplierId && !matchesSupplier(q.supplier || q.supplier_name, supplierId)) {
      return false;
    }
    if (rfqName && q.items && q.items.length > 0) {
      const hasLink = q.items.some(
        (it) => it.request_for_quotation && it.request_for_quotation === rfqName,
      );
      if (!hasLink) return false;
    }
    return true;
  });

  if (relevant.length === 0) return null;

  // Sort newest first by modified / creation
  const sorted = [...relevant].sort((a, b) => {
    const da = new Date(a.modified || a.creation || 0).getTime();
    const db = new Date(b.modified || b.creation || 0).getTime();
    return db - da;
  });

  // If any quote has Revision Requested, that is the active revision trigger
  const revisionQuote = sorted.find((q) => {
    const st = (q.status ?? "").toLowerCase();
    return (
      st.includes("revision") ||
      q.custom_revision_requested === 1 ||
      q.custom_revision_requested === true
    );
  });
  if (revisionQuote) return revisionQuote;

  // Otherwise, the latest modified quote is the effective one
  return sorted[0];
}

/**
 * Determine the supplier-facing RFQ & Quotation Status.
 *
 * Single authoritative status resolver for the Supplier Portal.
 */
export function getSupplierRFQStatus(
  params: SupplierRfqStatusParams,
): SupplierRfqStatusResult {
  const { rfq, quotation, quotations, supplierId, declined, hasLocalDraft } = params;

  // Gather candidate quotations
  const allQuotes: SupplierQuotationLike[] = [];
  if (quotation) allQuotes.push(quotation);
  if (quotations && quotations.length > 0) {
    for (const q of quotations) {
      if (!allQuotes.some((existing) => existing.name === q.name)) {
        allQuotes.push(q);
      }
    }
  }

  // Find effective quotation
  const effQuote = findEffectiveQuotation(allQuotes, supplierId, rfq?.name);

  // Check supplier row on RFQ
  const supplierRow = (rfq?.suppliers ?? []).find((s) =>
    matchesSupplier(s.supplier || s.supplier_name, supplierId),
  );

  // 1. Explicit decline ("No Quote")
  if (declined || supplierRow?.quote_status === "No Quote") {
    return {
      ...SUPPLIER_RFQ_STATUS_META["Closed"],
      effectiveQuotation: effQuote,
    };
  }

  // 2. RFQ Awarded
  const rfqStatusLower = (rfq?.status ?? "").toLowerCase();
  const isRfqAwarded = rfqStatusLower.includes("award");
  const isQuoteAccepted =
    effQuote &&
    effQuote.docstatus === 1 &&
    ((effQuote.status ?? "").toLowerCase().includes("accept") ||
      (effQuote.status ?? "").toLowerCase().includes("award"));
  const isSupplierAwarded =
    rfq?.award_supplier && matchesSupplier(rfq.award_supplier, supplierId);

  if (isQuoteAccepted || isSupplierAwarded) {
    return {
      ...SUPPLIER_RFQ_STATUS_META["Awarded"],
      effectiveQuotation: effQuote,
    };
  }

  // 3. RFQ Closed / Cancelled / Expired without award to this supplier
  if (
    rfqStatusLower === "cancelled" ||
    rfqStatusLower === "closed" ||
    rfqStatusLower === "expired" ||
    rfqStatusLower.includes("expired")
  ) {
    return {
      ...SUPPLIER_RFQ_STATUS_META["Closed"],
      effectiveQuotation: effQuote,
    };
  }

  // If RFQ is awarded to someone else, but not this supplier
  if (isRfqAwarded && !isSupplierAwarded && !isQuoteAccepted) {
    return {
      ...SUPPLIER_RFQ_STATUS_META["Closed"],
      effectiveQuotation: effQuote,
    };
  }

  // 4. Quotation state analysis
  if (effQuote) {
    const qStatusLower = (effQuote.status ?? "").toLowerCase();
    const docstatus = Number(effQuote.docstatus ?? 0);

    // Revision Requested
    if (
      qStatusLower.includes("revision") ||
      effQuote.custom_revision_requested === 1 ||
      effQuote.custom_revision_requested === true
    ) {
      return {
        ...SUPPLIER_RFQ_STATUS_META["Revision Requested"],
        effectiveQuotation: effQuote,
      };
    }

    // Submitted (docstatus === 1)
    if (docstatus === 1) {
      if (
        qStatusLower.includes("review") ||
        qStatusLower === "under review" ||
        qStatusLower === "in review"
      ) {
        return {
          ...SUPPLIER_RFQ_STATUS_META["Under Review"],
          effectiveQuotation: effQuote,
        };
      }
      return {
        ...SUPPLIER_RFQ_STATUS_META["Quotation Submitted"],
        effectiveQuotation: effQuote,
      };
    }

    // Draft (docstatus === 0)
    if (docstatus === 0 || qStatusLower === "draft") {
      // Check if this draft is a resubmission/revision for a previous submitted quote
      const hasPriorSubmitted = allQuotes.some(
        (q) => q.name !== effQuote.name && Number(q.docstatus) === 1,
      );
      if (hasPriorSubmitted || effQuote.amended_from) {
        return {
          ...SUPPLIER_RFQ_STATUS_META["Revision Requested"],
          effectiveQuotation: effQuote,
        };
      }

      return {
        ...SUPPLIER_RFQ_STATUS_META["Draft Quotation"],
        effectiveQuotation: effQuote,
      };
    }

    // Cancelled docstatus 2
    if (docstatus === 2 || qStatusLower === "cancelled") {
      return {
        ...SUPPLIER_RFQ_STATUS_META["Closed"],
        effectiveQuotation: effQuote,
      };
    }
  }

  // 5. Corroborating signal from RFQ supplier child row
  if (supplierRow?.quote_status === "Received") {
    return {
      ...SUPPLIER_RFQ_STATUS_META["Quotation Submitted"],
      effectiveQuotation: effQuote,
    };
  }

  // 6. Local draft in browser
  if (hasLocalDraft) {
    return {
      ...SUPPLIER_RFQ_STATUS_META["Draft Quotation"],
      effectiveQuotation: null,
    };
  }

  // 7. Default: Not started / invited
  return {
    ...SUPPLIER_RFQ_STATUS_META["Awaiting Quotation"],
    effectiveQuotation: null,
  };
}
