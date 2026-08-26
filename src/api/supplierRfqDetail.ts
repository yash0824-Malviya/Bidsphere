/**
 * Supplier Portal — RFQ detail fetch with assignment / permission checks.
 *
 * Used by `/supplier/rfq/:rfqName` so failures surface as clear reasons
 * instead of a generic "Unable to load this document".
 */

import { isAxiosError } from "axios";

import { getRFQ } from "./sourcing";
import {
  apiGet,
  buildListConfig,
  buildResourceUrl,
  withSilent,
} from "./erpnext";
import type { RFQ, RFQItem, RfqQuoteRoundDoc } from "../types/erpnext";
import { sanitizeRfqForSupplier } from "../utils/rfqTargetPrice";

const LOG = "[SupplierRFQ Detail]";

export type SupplierRfqFailureCode =
  | "NOT_FOUND"
  | "NOT_ASSIGNED"
  | "PERMISSION"
  | "AUTH"
  | "UNPUBLISHED"
  | "CLOSED"
  | "SERVER"
  | "UNKNOWN";

export class SupplierRfqAccessError extends Error {
  readonly code: SupplierRfqFailureCode;
  readonly httpStatus?: number;

  constructor(
    code: SupplierRfqFailureCode,
    message: string,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "SupplierRfqAccessError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function supplierRfqFailureTitle(code: SupplierRfqFailureCode): string {
  switch (code) {
    case "NOT_FOUND":
      return "RFQ not found";
    case "NOT_ASSIGNED":
      return "Supplier not assigned";
    case "PERMISSION":
      return "Permission denied";
    case "AUTH":
      return "Session expired";
    case "UNPUBLISHED":
      return "RFQ not published";
    case "CLOSED":
      return "RFQ closed";
    case "SERVER":
      return "Backend server error";
    default:
      return "Unable to load RFQ";
  }
}

function httpStatusOf(err: unknown): number | undefined {
  if (isAxiosError(err)) return err.response?.status;
  if (err && typeof err === "object" && "response" in err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return String(err ?? "Unknown error");
}

function normalizeSupplierKey(value: string): string {
  return value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.,]+$/g, "")
    .trim()
    .toLowerCase();
}

function isSupplierInvited(rfq: RFQ, supplierId: string): boolean {
  const key = normalizeSupplierKey(supplierId);
  if (!key) return false;
  return (rfq.suppliers ?? []).some((row) => {
    const supplier = normalizeSupplierKey(String(row.supplier || ""));
    const supplierName = normalizeSupplierKey(
      String((row as { supplier_name?: string }).supplier_name || ""),
    );
    return supplier === key || (!!supplierName && supplierName === key);
  });
}

function mapRoundItemsToRfqItems(roundItems: RFQItem[]): RFQItem[] {
  return roundItems.map((row) => ({
    ...row,
    item_code: row.item_code,
    item_name: row.item_name ?? row.item_code,
    description: row.description ?? "",
    qty: Number(row.qty) || 0,
    uom: row.uom || "Nos",
  }));
}

/**
 * When the live RFQ child table is empty (or thinner than the active round),
 * hydrate items/suppliers from the active RFQ Round snapshot.
 */
async function enrichFromActiveRound(rfq: RFQ): Promise<RFQ> {
  const activeRoundName = String(rfq.custom_active_rfq_round || "").trim();
  const currentItems = rfq.items ?? [];
  if (!activeRoundName && currentItems.length > 0) return rfq;

  try {
    let round: RfqQuoteRoundDoc | null = null;
    if (activeRoundName) {
      round = await apiGet<RfqQuoteRoundDoc>(
        buildResourceUrl("RFQ Round", activeRoundName),
        withSilent({}),
      );
    } else {
      const rows = await apiGet<RfqQuoteRoundDoc[]>(
        buildResourceUrl("RFQ Round"),
        withSilent(
          buildListConfig({
            fields: ["name"],
            filters: [
              ["rfq", "=", rfq.name],
              ["status", "=", "Active"],
            ],
            limit_page_length: 1,
          }),
        ),
      );
      const name = String(rows?.[0]?.name || "").trim();
      if (name) {
        round = await apiGet<RfqQuoteRoundDoc>(
          buildResourceUrl("RFQ Round", name),
          withSilent({}),
        );
      }
    }

    if (!round?.name) return rfq;

    const roundItems = Array.isArray(round.items) ? round.items : [];
    const roundSuppliers = Array.isArray(round.suppliers) ? round.suppliers : [];
    const shouldReplaceItems =
      currentItems.length === 0 && roundItems.length > 0;

    // eslint-disable-next-line no-console
    console.info(LOG, "Active quote round", {
      rfqId: rfq.name,
      activeRound: round.name,
      roundNumber: round.round_number,
      roundItemCount: roundItems.length,
      rfqItemCount: currentItems.length,
      hydratedItems: shouldReplaceItems,
    });

    if (!shouldReplaceItems && roundSuppliers.length === 0) {
      return {
        ...rfq,
        custom_active_rfq_round: round.name,
        custom_current_round_number:
          round.round_number ?? rfq.custom_current_round_number,
      };
    }

    return {
      ...rfq,
      custom_active_rfq_round: round.name,
      custom_current_round_number:
        round.round_number ?? rfq.custom_current_round_number,
      message_for_supplier:
        round.message_for_supplier || rfq.message_for_supplier,
      terms: round.terms || rfq.terms,
      valid_till: round.valid_till || rfq.valid_till,
      items: shouldReplaceItems
        ? mapRoundItemsToRfqItems(roundItems)
        : currentItems,
      suppliers:
        (rfq.suppliers?.length ?? 0) > 0
          ? rfq.suppliers
          : (roundSuppliers as RFQ["suppliers"]),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "Active round enrichment skipped", {
      rfqId: rfq.name,
      message: messageOf(err),
    });
    return rfq;
  }
}

/**
 * Load an RFQ for the Supplier Portal and enforce portal rules.
 */
export async function getSupplierRfqDetail(
  rfqName: string,
  supplierId: string,
): Promise<RFQ> {
  const name = String(rfqName || "").trim();
  const supplier = String(supplierId || "").trim();

  // eslint-disable-next-line no-console
  console.info(LOG, "Fetch start", {
    url: `/api/resource/Request for Quotation/${encodeURIComponent(name)}`,
    rfqName: name,
    supplierId: supplier,
    authSource: "X-Bidsphere-Access-Token (supplier JWT / session)",
  });

  if (!name) {
    throw new SupplierRfqAccessError("NOT_FOUND", "RFQ not found");
  }
  if (!supplier) {
    throw new SupplierRfqAccessError(
      "AUTH",
      "Session expired. Please sign in again.",
    );
  }

  let rfq: RFQ;
  try {
    rfq = await getRFQ(name);
  } catch (err) {
    const status = httpStatusOf(err);
    const raw = messageOf(err);

    // eslint-disable-next-line no-console
    console.error(LOG, "API error", {
      rfqName: name,
      supplierId: supplier,
      httpStatus: status ?? null,
      message: raw,
      error: err,
    });

    if (status === 404 || /does not exist|not found/i.test(raw)) {
      throw new SupplierRfqAccessError("NOT_FOUND", "RFQ not found", status);
    }
    if (status === 401 || /not authenticated|unauthorized|session/i.test(raw)) {
      throw new SupplierRfqAccessError(
        "AUTH",
        "Session expired. Please sign in again.",
        status,
      );
    }
    if (status === 403 || /permission|not permitted|forbidden/i.test(raw)) {
      throw new SupplierRfqAccessError(
        "PERMISSION",
        "Permission denied",
        status,
      );
    }
    if (status != null && status >= 500) {
      throw new SupplierRfqAccessError(
        "SERVER",
        "Backend server error",
        status,
      );
    }
    throw new SupplierRfqAccessError(
      "UNKNOWN",
      raw || "Unable to load RFQ",
      status,
    );
  }

  if (!rfq?.name) {
    throw new SupplierRfqAccessError("NOT_FOUND", "RFQ not found");
  }

  // Ensure child tables are always arrays for downstream consumers.
  rfq = {
    ...rfq,
    items: Array.isArray(rfq.items) ? rfq.items : [],
    suppliers: Array.isArray(rfq.suppliers) ? rfq.suppliers : [],
  };

  rfq = await enrichFromActiveRound(rfq);

  // eslint-disable-next-line no-console
  console.info(LOG, "API response", {
    rfqId: rfq.name,
    docstatus: rfq.docstatus,
    status: rfq.status,
    currency:
      (rfq as { currency?: string }).currency ||
      (rfq as { company?: string }).company ||
      null,
    itemCount: rfq.items?.length ?? 0,
    supplierCount: rfq.suppliers?.length ?? 0,
    activeRound: rfq.custom_active_rfq_round ?? null,
    roundNumber: rfq.custom_current_round_number ?? null,
    requireCostBreakdown: rfq.custom_require_cost_breakdown,
  });

  const docstatus = Number((rfq as { docstatus?: number }).docstatus ?? 0);
  if (docstatus === 0) {
    throw new SupplierRfqAccessError(
      "UNPUBLISHED",
      "This RFQ has not been published yet.",
    );
  }
  if (docstatus === 2) {
    throw new SupplierRfqAccessError("CLOSED", "RFQ closed");
  }

  const status = String(rfq.status || "").trim().toLowerCase();
  if (status === "cancelled" || status === "closed") {
    throw new SupplierRfqAccessError("CLOSED", "RFQ closed");
  }

  if (!isSupplierInvited(rfq, supplier)) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "Supplier not on RFQ", {
      rfqId: name,
      supplierId: supplier,
      invitedSuppliers: (rfq.suppliers ?? []).map((s) => s.supplier),
    });
    throw new SupplierRfqAccessError(
      "NOT_ASSIGNED",
      "Supplier not assigned",
    );
  }

  /* Never leak hidden Target Prices to supplier clients / DevTools / exports. */
  const sanitized = sanitizeRfqForSupplier(rfq);

  // eslint-disable-next-line no-console
  console.info(LOG, "Access granted", {
    rfqId: name,
    supplierId: supplier,
    itemCount: sanitized.items?.length ?? 0,
    show_target_price: sanitized.show_target_price,
    targetPricesReturned: sanitized.show_target_price
      ? sanitized.items.filter((i) => (i.target_price ?? i.custom_target_price) != null).length
      : 0,
  });

  if ((sanitized.items?.length ?? 0) === 0) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "RFQ has zero line items after load", {
      rfqId: name,
      activeRound: sanitized.custom_active_rfq_round ?? null,
    });
  }

  return sanitized;
}
