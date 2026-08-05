import {
  disableServerScriptsFor,
  getRFQ,
  updateRFQ,
  type CreateRFQSupplierInput,
} from "./sourcing";
import { assertSuppliersActive, getSuppliers } from "./supplier";
import { triggerRfqSupplierInvited } from "./notifications";
import {
  appendRfqInviteAudit,
  logRfqSupplierInviteAudit,
} from "./rfqSupplierInviteAudit";
import { parseRfqMessage, rebuildRfqMessage } from "../utils/rfqMessage";
import type { RFQ } from "../types/erpnext";
import { apiPost } from "./erpnext";
import { bidsphereApiFetch } from "../utils/bidsphereApiFetch";

const RFQ_DOCTYPE = "Request for Quotation";

const ALREADY_INVITED_MSG =
  "This supplier has already been invited to this RFQ.";

function normSupplier(id: string): string {
  return id.trim().toLowerCase();
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Could not invite suppliers.";
}

function mapRfqInviteError(err: unknown): Error {
  const msg = extractErrorMessage(err);
  const lower = msg.toLowerCase();

  if (
    lower.includes("already invited") ||
    lower.includes("already participating") ||
    lower.includes("duplicate")
  ) {
    return new Error(ALREADY_INVITED_MSG);
  }

  return new Error(msg);
}

export class RfqSupplierInviteApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "RfqSupplierInviteApiError";
    this.status = status;
    this.code = code;
  }
}

async function inviteSuppliersViaServerApi(input: {
  rfqName: string;
  suppliers: CreateRFQSupplierInput[];
  emailBySupplier: Map<string, string | undefined>;
}): Promise<RFQ> {
  const res = await bidsphereApiFetch("/api/rfq-supplier-invite", {
    method: "POST",
    json: {
      rfq_name: input.rfqName,
      suppliers: input.suppliers.map((s) => ({
        supplier: s.supplier,
        supplier_name: s.supplier_name || s.supplier,
        email_id: input.emailBySupplier.get(s.supplier),
      })),
    },
  });

  let json: {
    success?: boolean;
    message?: string;
    code?: string;
    rfq?: RFQ;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {
      success: false,
      message: `Could not invite suppliers (HTTP ${res.status}).`,
    };
  }

  if (!res.ok || json.success === false) {
    throw new RfqSupplierInviteApiError(
      json.message || `Could not invite suppliers (HTTP ${res.status}).`,
      res.status,
      json.code,
    );
  }

  if (!json.rfq) {
    return getRFQ(input.rfqName);
  }
  return json.rfq;
}

export async function extendRfqDeadline(
  rfqName: string,
  newValidTill: string,
): Promise<RFQ> {
  await disableServerScriptsFor(RFQ_DOCTYPE);
  const fresh = await getRFQ(rfqName);
  const parsed = parseRfqMessage(fresh.message_for_supplier);
  const message_for_supplier = rebuildRfqMessage({
    title: parsed.title,
    validTill: newValidTill,
    body: parsed.body,
  });

  if (fresh.docstatus === 1) {
    await apiPost("/api/method/frappe.client.set_value", {
      doctype: RFQ_DOCTYPE,
      name: rfqName,
      fieldname: "valid_till",
      value: newValidTill,
    });
    await apiPost("/api/method/frappe.client.set_value", {
      doctype: RFQ_DOCTYPE,
      name: rfqName,
      fieldname: "message_for_supplier",
      value: message_for_supplier,
    });
    return getRFQ(rfqName);
  }

  return updateRFQ(rfqName, {
    modified: fresh.modified,
    valid_till: newValidTill,
    message_for_supplier,
  });
}

export async function inviteSuppliersToRfq(input: {
  rfqName: string;
  newSuppliers: CreateRFQSupplierInput[];
  invitedBy: string;
  validTill?: string;
}): Promise<{ rfq: RFQ; invited: CreateRFQSupplierInput[]; round: number }> {
  await disableServerScriptsFor(RFQ_DOCTYPE);

  const requested = input.newSuppliers.filter((s) => s.supplier?.trim());
  if (requested.length === 0) {
    throw new Error("Select at least one supplier to invite.");
  }

  const fresh = await getRFQ(input.rfqName);
  const existingIds = new Set(
    (fresh.suppliers ?? []).map((s) => normSupplier(s.supplier)),
  );

  const duplicateNames = requested.filter((s) =>
    existingIds.has(normSupplier(s.supplier)),
  );
  const toInvite = requested.filter(
    (s) => !existingIds.has(normSupplier(s.supplier)),
  );

  if (toInvite.length === 0) {
    throw new Error(
      duplicateNames.length === 1
        ? ALREADY_INVITED_MSG
        : "All selected suppliers are already invited to this RFQ.",
    );
  }

  await assertSuppliersActive(toInvite.map((s) => s.supplier));

  const supplierRows = await getSuppliers({
    filters: [["name", "in", toInvite.map((s) => s.supplier)]],
    fields: ["name", "email_id"],
    limit_page_length: toInvite.length,
  });
  const emailBySupplier = new Map(
    supplierRows.map((s) => [s.name, s.email_id]),
  );

  let updated: RFQ;
  try {
    updated = await inviteSuppliersViaServerApi({
      rfqName: input.rfqName,
      suppliers: toInvite,
      emailBySupplier,
    });
  } catch (err) {
    throw mapRfqInviteError(err);
  }

  const round = appendRfqInviteAudit(
    input.rfqName,
    toInvite.map((s) => ({
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
      invited_by: input.invitedBy,
    })),
  );

  for (const inv of toInvite) {
    triggerRfqSupplierInvited({
      rfqId: input.rfqName,
      supplier: inv.supplier,
      supplierName: inv.supplier_name || inv.supplier,
      validTill: input.validTill,
    });
    await logRfqSupplierInviteAudit({
      rfqName: input.rfqName,
      supplier: inv.supplier,
      supplierName: inv.supplier_name || inv.supplier,
      invitedBy: input.invitedBy,
      round,
    });
  }

  return { rfq: updated, invited: toInvite, round };
}
