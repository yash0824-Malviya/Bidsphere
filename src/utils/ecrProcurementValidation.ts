import type {
  ECRAffectedPart,
  ECRProcurementReferenceType,
} from "../types/erpnext";

export interface ECRProcurementSourceItem {
  sourceItemReference: string;
  itemId: string;
  itemCode: string;
  description: string;
  quantity: number;
  uom: string;
}

export interface ECRProcurementSelectionInput {
  supplier: string;
  referenceType: ECRProcurementReferenceType;
  rfqId?: string;
  purchaseOrderId?: string;
  parts: Partial<ECRAffectedPart>[];
}

export interface ECRProcurementSelectionResult {
  errors: Record<string, string>;
  canonicalParts: Partial<ECRAffectedPart>[];
  sourceItems: ECRProcurementSourceItem[];
}

export interface ECRCanonicalMasterReferences {
  supplier?: string;
  parts: Array<string | undefined>;
}

export interface ExistingECRProcurementSource {
  referenceType: Exclude<ECRProcurementReferenceType, "None">;
  documentName: string;
}

export interface ECRProcurementLineLike {
  name?: string;
  item_code?: string;
  item_name?: string;
  description?: string;
  qty?: number;
  uom?: string;
  stock_uom?: string;
  /** Standard Supplier Quotation Item backlink to its RFQ. */
  request_for_quotation?: string;
}

function clean(value: string | undefined | null): string {
  return String(value ?? "").trim();
}

/**
 * Feed canonical Supplier / Item Link values into relationship validation.
 * Master-data resolution must finish before this helper is called.
 */
export function canonicalizeECRProcurementSelectionInput(
  input: ECRProcurementSelectionInput,
  canonical: ECRCanonicalMasterReferences,
): ECRProcurementSelectionInput {
  return {
    ...input,
    supplier: clean(canonical.supplier) || input.supplier,
    parts: input.parts.map((part, index) => ({
      ...part,
      partitem: clean(canonical.parts[index]) || part.partitem,
    })),
  };
}

/** Resolve the existing source document independently from downstream trace fields. */
export function getExistingECRProcurementSource(input: {
  procurement_reference_type?: ECRProcurementReferenceType | string | null;
  existing_rfq_reference?: string | null;
  existing_purchase_order_reference?: string | null;
}): ExistingECRProcurementSource | null {
  if (input.procurement_reference_type === "RFQ") {
    const documentName = clean(input.existing_rfq_reference);
    return documentName ? { referenceType: "RFQ", documentName } : null;
  }
  if (input.procurement_reference_type === "Purchase Order") {
    const documentName = clean(input.existing_purchase_order_reference);
    return documentName ? { referenceType: "Purchase Order", documentName } : null;
  }
  return null;
}

export function normalizeECRProcurementSourceItem(
  row: ECRProcurementLineLike,
): ECRProcurementSourceItem | null {
  const sourceItemReference = clean(row.name);
  const itemId = clean(row.item_code);
  const quantity = Number(row.qty);
  const uom = clean(row.uom) || clean(row.stock_uom);
  if (!sourceItemReference || !itemId || !Number.isFinite(quantity) || !uom) return null;
  return {
    sourceItemReference,
    itemId,
    itemCode: itemId,
    description: clean(row.description) || clean(row.item_name) || itemId,
    quantity,
    uom,
  };
}

export function validateECRProcurementSourceItems(
  input: ECRProcurementSelectionInput,
  sourceItems: ECRProcurementSourceItem[],
): ECRProcurementSelectionResult {
  if (input.referenceType === "None") {
    const errors: Record<string, string> = {};
    if (clean(input.rfqId)) {
      errors.existing_rfq_reference = "RFQ must be empty when Reference Type is None.";
    }
    if (clean(input.purchaseOrderId)) {
      errors.existing_purchase_order_reference =
        "Purchase Order must be empty when Reference Type is None.";
    }
    input.parts.forEach((part, index) => {
      if (
        clean(part.source_reference_type) ||
        clean(part.source_document_reference) ||
        clean(part.source_item_reference)
      ) {
        errors[`partitem.${index}`] =
          "Procurement source metadata must be empty when Reference Type is None.";
      }
    });
    return { errors, canonicalParts: input.parts, sourceItems: [] };
  }

  const referenceType: Exclude<ECRProcurementReferenceType, "None"> = input.referenceType;

  const documentId = referenceType === "RFQ"
    ? clean(input.rfqId)
    : clean(input.purchaseOrderId);
  const documentLabel = referenceType === "RFQ" ? "RFQ" : "Purchase Order";
  const errors: Record<string, string> = {};
  if (!clean(input.supplier)) {
    errors.suggested_supplier = "Select a valid supplier before choosing a procurement reference.";
  }
  if (!documentId) {
    errors[referenceType === "RFQ"
      ? "existing_rfq_reference"
      : "existing_purchase_order_reference"] = `${documentLabel} is required.`;
  }
  if (input.parts.length === 0) {
    errors.parts = `Select at least one affected item from the ${documentLabel}.`;
  }

  const bySourceReference = new Map(
    sourceItems.map((item) => [item.sourceItemReference, item]),
  );
  const seen = new Set<string>();
  const canonicalParts = input.parts.map((part, index) => {
    const sourceItemReference = clean(part.source_item_reference);
    const sourceDocument = clean(part.source_document_reference);
    const sourceType = clean(part.source_reference_type);
    const sourceItem = bySourceReference.get(sourceItemReference);
    const field = `partitem.${index}`;

    if (
      !sourceItem ||
      sourceDocument !== documentId ||
      sourceType !== referenceType ||
      clean(part.partitem) !== sourceItem.itemId ||
      seen.has(sourceItemReference)
    ) {
      errors[field] = `Selected item '${clean(part.partitem) || "Unknown"}' is not part of ${documentId || `the selected ${documentLabel}`}.`;
      return part;
    }

    if (!sourceItem.uom) {
      errors[field] = `Selected item '${sourceItem.itemId}' has no UOM in ${documentId}.`;
      return part;
    }

    seen.add(sourceItemReference);
    return {
      ...part,
      partitem: sourceItem.itemId,
      part_description: sourceItem.description,
      quantity: sourceItem.quantity,
      uom: sourceItem.uom,
      source_reference_type: referenceType,
      source_document_reference: documentId,
      source_item_reference: sourceItem.sourceItemReference,
    };
  });

  return { errors, canonicalParts, sourceItems };
}
