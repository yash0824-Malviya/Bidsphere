import type { RFQItemLine } from "../components/RFQItemLineRow";
import type { EngineeringAttachment } from "./materialRequestItemFiles";

export const INHERITED_MR_LINE_TOOLTIP =
  "This item originates from an approved Material Request and cannot be modified.";

/** Document categories procurement may attach on top of inherited MR files. */
export const PROCUREMENT_RFQ_ADDON_DOCUMENT_TYPES = [
  "Technical Specifications",
  "Commercial Documents",
  "Drawings",
  "Images",
  "Quality Documents",
  "Packaging Specifications",
] as const;

export function isInheritedMrRfqLine(row: RFQItemLine): boolean {
  return row.inherited_from_mr === true;
}

export function inheritedLineBadgeLabel(row: RFQItemLine): string {
  if (
    row.warehouse_available_qty != null ||
    row.warehouse?.trim()
  ) {
    return "Warehouse Forwarded";
  }
  return "Inherited from Material Request";
}

/** Department / warehouse files on inherited lines — never delete. */
export function canDeleteInheritedRfqAttachment(
  att: EngineeringAttachment,
): boolean {
  return att.source === "procurement";
}

/**
 * Procurement may edit visibility / document type on inherited Department
 * files (e.g. mark Internal Only) and fully manage procurement add-ons.
 */
export function canEditInheritedRfqAttachment(
  _att: EngineeringAttachment,
): boolean {
  return true;
}
