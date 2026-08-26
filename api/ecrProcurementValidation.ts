import {
  getExistingECRProcurementSource,
  normalizeECRProcurementSourceItem,
  validateECRProcurementSourceItems,
  type ECRProcurementLineLike,
} from "../src/utils/ecrProcurementValidation.js";
import type {
  ECRAffectedPart,
  ECRProcurementReferenceType,
} from "../src/types/erpnext.js";

export interface EcrProcurementDocument {
  name?: string;
  status?: string;
  docstatus?: number;
  ecr_reference?: string;
  custom_ecr_reference?: string;
  custom_purchase_requisition_reference?: string;
  custom_bidsphere_ecr_idempotency_key?: string;
  supplier?: string;
  suppliers?: Array<{ supplier?: string }>;
  items?: ECRProcurementLineLike[];
}

export type EcrProcurementDocumentLoader = (
  doctype:
    | "Request for Quotation"
    | "Purchase Order"
    | "Purchase Requisition"
    | "Supplier Quotation",
  name: string,
) => Promise<EcrProcurementDocument>;

export class EcrProcurementValidationError extends Error {
  status = 422;
  fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors)[0] || "Invalid ECR procurement reference.");
    this.name = "EcrProcurementValidationError";
    this.fieldErrors = fieldErrors;
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function referenceTypeFrom(value: unknown): ECRProcurementReferenceType | null {
  return value === "None" || value === "RFQ" || value === "Purchase Order"
    ? value
    : null;
}

/** Return the linked ECR only for requests that can create a new PR document. */
export function purchaseRequisitionEcrReferenceForCreate(
  apiPath: string,
  method: string,
  payload: Record<string, unknown>,
  document: Record<string, unknown>,
): string | null {
  if (method.toUpperCase() !== "POST") return null;
  const path = apiPath.replace(/\/+$/, "");
  const isResourceCreate = path === "resource/Purchase Requisition";
  const documentDoctype = clean(document.doctype) || clean(payload.doctype);
  const isGenericCreate =
    ["method/frappe.client.insert", "method/frappe.client.save"].includes(path) &&
    documentDoctype === "Purchase Requisition";
  if (!isResourceCreate && !isGenericCreate) return null;
  const candidate = Object.keys(document).length > 0 ? document : payload;
  return clean(candidate.ecr_reference) || null;
}

/** Block a second PR -> RFQ branch when the ECR already has a source RFQ/PO. */
export function assertEcrAllowsDownstreamPurchaseRequisition(
  ecr: Record<string, unknown>,
): void {
  const source = getExistingECRProcurementSource(ecr);
  if (!source) return;
  throw new EcrProcurementValidationError({
    ecr_reference:
      `ECR ${clean(ecr.name) || "record"} already references ${source.referenceType} ` +
      `${source.documentName}. No downstream Purchase Requisition was created.`,
  });
}

/**
 * The browser ERP gateway may create ordinary/manual PRs, but it must never
 * create an ECR-linked branch. That operation owns a unique idempotency key,
 * the ECR backlink, and a workflow transition and therefore belongs to the
 * trusted server endpoint.
 */
export function assertEcrLinkedPrUsesTrustedEndpoint(ecrReference: unknown): void {
  const reference = clean(ecrReference);
  if (!reference) return;
  throw new EcrProcurementValidationError({
    ecr_reference:
      `ECR-linked Purchase Requisitions must be created through ` +
      `/api/create-pr-from-ecr (${reference}).`,
  });
}

export function hasEcrProcurementReferenceFields(body: Record<string, unknown>): boolean {
  return [
    "procurement_reference_type",
    "existing_rfq_reference",
    "existing_purchase_order_reference",
    "suggested_supplier",
    "supplier_response_required",
    "affected_parts",
  ].some((field) => Object.prototype.hasOwnProperty.call(body, field));
}

export async function assertEcrProcurementRelationships(
  ecr: Record<string, unknown>,
  loadDocument: EcrProcurementDocumentLoader,
): Promise<void> {
  const rawReferenceType = ecr.procurement_reference_type;
  const rawReferenceTypeValue = clean(rawReferenceType);
  const referenceType = rawReferenceTypeValue
    ? referenceTypeFrom(rawReferenceTypeValue) ?? "None"
    : "None";
  const supplier = clean(ecr.suggested_supplier);
  const rfqId = clean(ecr.existing_rfq_reference);
  const purchaseOrderId = clean(ecr.existing_purchase_order_reference);
  const parts = Array.isArray(ecr.affected_parts)
    ? ecr.affected_parts as Partial<ECRAffectedPart>[]
    : [];

  if (rawReferenceTypeValue && !referenceTypeFrom(rawReferenceTypeValue)) {
    throw new EcrProcurementValidationError({
      procurement_reference_type: "Reference Type must be None, RFQ, or Purchase Order.",
    });
  }

  if (referenceType === "None") {
    const errors: Record<string, string> = {};
    if (rfqId) errors.existing_rfq_reference = "RFQ must be empty when Reference Type is None.";
    if (purchaseOrderId) {
      errors.existing_purchase_order_reference = "Purchase Order must be empty when Reference Type is None.";
    }
    parts.forEach((part, index) => {
      if (
        clean(part.source_reference_type) ||
        clean(part.source_document_reference) ||
        clean(part.source_item_reference)
      ) {
        errors[`partitem.${index}`] = "Procurement source metadata must be empty when Reference Type is None.";
      }
    });
    if (Object.keys(errors).length > 0) {
      throw new EcrProcurementValidationError(errors);
    }
    return;
  }

  const consistencyErrors: Record<string, string> = {};
  if (clean(ecr.supplier_response_required) !== "Yes") {
    consistencyErrors.supplier_response_required =
      "Supplier Required must be Yes when an RFQ or Purchase Order is referenced.";
  }
  if (!supplier) consistencyErrors.suggested_supplier = "Supplier is required.";
  if (referenceType === "RFQ") {
    if (!rfqId) consistencyErrors.existing_rfq_reference = "RFQ is required.";
    if (purchaseOrderId) {
      consistencyErrors.existing_purchase_order_reference =
        "Purchase Order must be empty when Reference Type is RFQ.";
    }
  } else {
    if (!purchaseOrderId) {
      consistencyErrors.existing_purchase_order_reference = "Purchase Order is required.";
    }
    if (rfqId) {
      consistencyErrors.existing_rfq_reference =
        "RFQ must be empty when Reference Type is Purchase Order.";
    }
  }
  if (Object.keys(consistencyErrors).length > 0) {
    throw new EcrProcurementValidationError(consistencyErrors);
  }

  const documentId = referenceType === "RFQ" ? rfqId : purchaseOrderId;
  const doctype = referenceType === "RFQ"
    ? "Request for Quotation"
    : "Purchase Order";
  let document: EcrProcurementDocument;
  try {
    document = await loadDocument(doctype, documentId);
  } catch {
    throw new EcrProcurementValidationError({
      [referenceType === "RFQ"
        ? "existing_rfq_reference"
        : "existing_purchase_order_reference"]:
        `${referenceType} '${documentId}' does not exist or is not accessible.`,
    });
  }
  if (Number(document.docstatus) === 2 || clean(document.status).toLowerCase() === "cancelled") {
    throw new EcrProcurementValidationError({
      [referenceType === "RFQ"
        ? "existing_rfq_reference"
        : "existing_purchase_order_reference"]:
        `${referenceType} '${documentId}' is cancelled and cannot be used as an ECR source.`,
    });
  }

  const belongsToSupplier = referenceType === "RFQ"
    ? (document.suppliers ?? []).some((row) => clean(row.supplier) === supplier)
    : clean(document.supplier) === supplier;
  if (!belongsToSupplier) {
    throw new EcrProcurementValidationError({
      [referenceType === "RFQ"
        ? "existing_rfq_reference"
        : "existing_purchase_order_reference"]:
        `${referenceType} '${documentId}' is not associated with supplier '${supplier}'.`,
    });
  }

  const sourceItems = (document.items ?? [])
    .map(normalizeECRProcurementSourceItem)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const result = validateECRProcurementSourceItems({
    supplier,
    referenceType,
    rfqId,
    purchaseOrderId,
    parts,
  }, sourceItems);
  if (Object.keys(result.errors).length > 0) {
    throw new EcrProcurementValidationError(result.errors);
  }

  const snapshotErrors: Record<string, string> = {};
  result.canonicalParts.forEach((canonicalPart, index) => {
    const submittedPart = parts[index];
    if (
      clean(submittedPart?.part_description) !== clean(canonicalPart.part_description) ||
      Number(submittedPart?.quantity) !== Number(canonicalPart.quantity) ||
      clean(submittedPart?.uom) !== clean(canonicalPart.uom)
    ) {
      snapshotErrors[`partitem.${index}`] =
        `Selected item '${clean(canonicalPart.partitem) || "Unknown"}' details do not match ${documentId}. Reload the source items and select it again.`;
    }
  });
  if (Object.keys(snapshotErrors).length > 0) {
    throw new EcrProcurementValidationError(snapshotErrors);
  }
}
