import { getPurchaseOrder, getPurchaseOrdersStrict } from "./purchasing";
import { getRFQ, getRFQsPaged } from "./sourcing";
import type {
  ECRProcurementReferenceType,
  POItem,
  RFQItem,
} from "../types/erpnext";
import type { Filter } from "./erpnext";
import {
  normalizeECRProcurementSourceItem,
  validateECRProcurementSourceItems,
  type ECRProcurementSelectionInput,
  type ECRProcurementSelectionResult,
  type ECRProcurementSourceItem,
} from "../utils/ecrProcurementValidation";

export {
  validateECRProcurementSourceItems,
  type ECRProcurementSelectionInput,
  type ECRProcurementSelectionResult,
  type ECRProcurementSourceItem,
} from "../utils/ecrProcurementValidation";

export interface ECRProcurementDocumentOption {
  name: string;
  status?: string | null;
}

export class ECRProcurementReferenceError extends Error {
  field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ECRProcurementReferenceError";
    this.field = field;
  }
}

function clean(value: string | undefined | null): string {
  return String(value ?? "").trim();
}

function uniqueDocuments(
  rows: ECRProcurementDocumentOption[],
): ECRProcurementDocumentOption[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const name = clean(row.name);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export async function fetchECRSupplierRFQs(
  supplier: string,
): Promise<ECRProcurementDocumentOption[]> {
  const supplierId = clean(supplier);
  if (!supplierId) return [];

  const filters: Filter[] = [
    ["Request for Quotation Supplier", "supplier", "=", supplierId],
    ["docstatus", "!=", 2],
    ["status", "not in", ["Cancelled"]],
  ];
  const page = await getRFQsPaged({
    page: 1,
    pageSize: 1000,
    filters,
    order_by: "modified desc, name desc",
  });
  return uniqueDocuments(page.data.map((row) => ({
    name: row.name,
    status: row.status,
  })));
}

export async function fetchECRSupplierPurchaseOrders(
  supplier: string,
): Promise<ECRProcurementDocumentOption[]> {
  const supplierId = clean(supplier);
  if (!supplierId) return [];

  const rows = await getPurchaseOrdersStrict({
    filters: [
      ["supplier", "=", supplierId],
      ["docstatus", "!=", 2],
      ["status", "not in", ["Cancelled"]],
    ],
    limit_page_length: 1000,
    order_by: "modified desc, name desc",
  });
  return uniqueDocuments(rows.map((row) => ({
    name: row.name,
    status: row.status,
  })));
}

export async function fetchECRProcurementSourceItems(
  referenceType: Exclude<ECRProcurementReferenceType, "None">,
  documentName: string,
  supplier: string,
): Promise<ECRProcurementSourceItem[]> {
  const documentId = clean(documentName);
  const supplierId = clean(supplier);
  if (!documentId || !supplierId) return [];

  if (referenceType === "RFQ") {
    const rfq = await getRFQ(documentId);
    if (Number(rfq.docstatus) === 2 || clean(rfq.status).toLowerCase() === "cancelled") {
      throw new ECRProcurementReferenceError(
        "existing_rfq_reference",
        `RFQ '${documentId}' is cancelled and cannot be used as an ECR source.`,
      );
    }
    const belongsToSupplier = (rfq.suppliers ?? []).some(
      (row) => clean(row.supplier) === supplierId,
    );
    if (!belongsToSupplier) {
      throw new ECRProcurementReferenceError(
        "existing_rfq_reference",
        `RFQ '${documentId}' is not associated with supplier '${supplierId}'.`,
      );
    }
    return (rfq.items ?? [])
      .map((row: RFQItem) => normalizeECRProcurementSourceItem(row))
      .filter((item): item is ECRProcurementSourceItem => Boolean(item));
  }

  const purchaseOrder = await getPurchaseOrder(documentId);
  if (
    Number(purchaseOrder.docstatus) === 2 ||
    clean(purchaseOrder.status).toLowerCase() === "cancelled"
  ) {
    throw new ECRProcurementReferenceError(
      "existing_purchase_order_reference",
      `Purchase Order '${documentId}' is cancelled and cannot be used as an ECR source.`,
    );
  }
  if (clean(purchaseOrder.supplier) !== supplierId) {
    throw new ECRProcurementReferenceError(
      "existing_purchase_order_reference",
      `Purchase Order '${documentId}' is not associated with supplier '${supplierId}'.`,
    );
  }
  return (purchaseOrder.items ?? [])
    .map((row: POItem) => normalizeECRProcurementSourceItem(row))
    .filter((item): item is ECRProcurementSourceItem => Boolean(item));
}

export async function validateECRProcurementSelection(
  input: ECRProcurementSelectionInput,
): Promise<ECRProcurementSelectionResult> {
  if (input.referenceType === "None") {
    return { errors: {}, canonicalParts: input.parts, sourceItems: [] };
  }

  const documentId = input.referenceType === "RFQ"
    ? clean(input.rfqId)
    : clean(input.purchaseOrderId);
  const requiredField = input.referenceType === "RFQ"
    ? "existing_rfq_reference"
    : "existing_purchase_order_reference";
  if (!clean(input.supplier) || !documentId) {
    return validateECRProcurementSourceItems(input, []);
  }

  try {
    const sourceItems = await fetchECRProcurementSourceItems(
      input.referenceType,
      documentId,
      input.supplier,
    );
    return validateECRProcurementSourceItems(input, sourceItems);
  } catch (error) {
    if (error instanceof ECRProcurementReferenceError) {
      return {
        errors: { [error.field]: error.message },
        canonicalParts: input.parts,
        sourceItems: [],
      };
    }
    return {
      errors: {
        [requiredField]: `Unable to validate ${input.referenceType} '${documentId}'. Please try again.`,
      },
      canonicalParts: input.parts,
      sourceItems: [],
    };
  }
}
