/**
 * Supplier Portal — RFQ detail fetch with assignment / permission checks.
 *
 * Used by `/supplier/rfq/:rfqName` so failures surface as clear reasons
 * instead of a generic "Unable to load this document".
 */

import { isAxiosError } from "axios";

import { getRFQ } from "./sourcing";
import type { RFQ } from "../types/erpnext";
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

  // eslint-disable-next-line no-console
  console.info(LOG, "API response", {
    rfqName: rfq?.name,
    docstatus: rfq?.docstatus,
    status: rfq?.status,
    supplierCount: rfq?.suppliers?.length ?? 0,
    itemCount: rfq?.items?.length ?? 0,
    suppliers: (rfq?.suppliers ?? []).map((s) => s.supplier),
    requireCostBreakdown: rfq?.custom_require_cost_breakdown,
  });

  if (!rfq?.name) {
    throw new SupplierRfqAccessError("NOT_FOUND", "RFQ not found");
  }

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

  const invited = (rfq.suppliers ?? []).some(
    (s) => String(s.supplier || "").trim() === supplier,
  );
  if (!invited) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "Supplier not on RFQ", {
      rfqName: name,
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
    rfqName: name,
    supplierId: supplier,
    show_target_price: sanitized.show_target_price,
    targetPricesReturned: sanitized.show_target_price
      ? sanitized.items.filter((i) => i.target_price != null).length
      : 0,
  });

  return sanitized;
}
