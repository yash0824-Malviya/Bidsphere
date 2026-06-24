import type {
  PaymentEntry,
  PurchaseInvoice,
  PurchaseOrder,
  PurchaseReceipt,
} from "../types/erpnext";

export const SUPPORT_EMAIL = "support@netlink.com";

/** True when the document belongs to the logged-in supplier. */
export function supplierOwnsRecord(
  loggedInSupplier: string,
  doc?: { supplier?: string; supplier_name?: string; party?: string; party_name?: string }
): boolean {
  if (!loggedInSupplier) return false;
  const keys = [
    doc?.supplier,
    doc?.supplier_name,
    doc?.party,
    doc?.party_name,
  ].filter(Boolean);
  return keys.some((k) => k === loggedInSupplier);
}

export function isActivePOStatus(status?: string): boolean {
  return status !== "Completed" && status !== "Cancelled" && status !== "Closed";
}

export type GRNDisplayStatus = "Pending" | "Partial" | "Completed";

export function grnDisplayStatus(receipt: PurchaseReceipt): GRNDisplayStatus {
  const items = receipt.items ?? [];
  if (items.length === 0) {
    if (receipt.status === "Completed") return "Completed";
    return "Pending";
  }

  let ordered = 0;
  let received = 0;
  for (const item of items) {
    ordered += item.qty ?? 0;
    received += item.received_qty ?? item.qty ?? 0;
  }

  if (ordered <= 0) {
    return receipt.status === "Completed" ? "Completed" : "Pending";
  }
  if (received >= ordered - 0.001) return "Completed";
  if (received > 0) return "Partial";
  return "Pending";
}

export function grnProgress(receipt: PurchaseReceipt) {
  const items = receipt.items ?? [];
  let ordered = 0;
  let received = 0;
  for (const item of items) {
    ordered += item.qty ?? 0;
    received += item.received_qty ?? item.qty ?? 0;
  }
  const remaining = Math.max(0, ordered - received);
  const pct = ordered > 0 ? Math.min(100, (received / ordered) * 100) : 0;
  return { ordered, received, remaining, pct };
}

export type InvoiceDisplayStatus = "Draft" | "Submitted" | "Approved" | "Paid";

export function invoiceDisplayStatus(
  inv: Pick<PurchaseInvoice, "status" | "docstatus" | "outstanding_amount">
): InvoiceDisplayStatus {
  const docstatus = inv.docstatus ?? 0;
  if (docstatus === 0) return "Draft";
  if (inv.status === "Paid" || (inv.outstanding_amount ?? 0) <= 0.01) return "Paid";
  if (inv.status === "Submitted" || inv.status === "Unpaid" || inv.status === "Partly Paid") {
    return "Approved";
  }
  return "Submitted";
}

export type PaymentDisplayStatus = "Draft" | "Submitted" | "Paid" | "Cancelled";

export function paymentDisplayStatus(p: PaymentEntry): PaymentDisplayStatus {
  const docstatus = p.docstatus ?? 0;
  if (docstatus === 2) return "Cancelled";
  if (docstatus === 1) return "Paid";
  if (p.status === "Submitted") return "Paid";
  return "Draft";
}

export function primaryPOFromReceipt(receipt: PurchaseReceipt): string | undefined {
  return receipt.items?.find((i) => i.purchase_order)?.purchase_order;
}

export function primaryWarehouseFromReceipt(
  receipt: PurchaseReceipt
): string | undefined {
  return receipt.items?.find((i) => i.warehouse)?.warehouse;
}

export function primaryPOFromInvoice(invoice: PurchaseInvoice): string | undefined {
  return invoice.items?.find((i) => i.purchase_order)?.purchase_order;
}

export function poRfqReference(po: PurchaseOrder): string | undefined {
  return po.rfq_name ?? po.rfq ?? po.items?.find((i) => i.material_request)?.material_request;
}
