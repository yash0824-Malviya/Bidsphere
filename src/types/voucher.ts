/**
 * Voucher domain model.
 *
 * A Voucher is the Finance team's replacement for the legacy "Invoice"
 * workflow. Finance issues a Voucher against a PO/GRN, sends it to the
 * supplier, the supplier raises an invoice back, Finance confirms payment,
 * and the supplier confirms receipt — a full round-trip with an audit trail.
 *
 * This is a self-contained workflow layer persisted in localStorage (see
 * `src/api/vouchers.ts`); it does not touch the ERPNext Purchase Invoice
 * doctype.
 */

export type VoucherStatus =
  | "draft" // finance creating
  | "sent" // sent to supplier
  | "viewed" // supplier viewed
  | "invoice_raised" // supplier created/submitted invoice
  | "under_review" // finance + procurement reviewing
  | "invoice_approved" // finance approved invoice
  | "invoice_rejected" // finance rejected invoice (supplier may re-create)
  | "payment_confirmed" // finance released payment
  | "payment_received"; // supplier confirmed receipt

export type VoucherActorRole = "finance" | "procurement" | "supplier" | "admin";

/**
 * Lifecycle of the supplier invoice raised against a voucher.
 *   submitted → approved → paid
 *             ↘ rejected (supplier may re-create)
 */
export type InvoiceStatus = "submitted" | "approved" | "rejected" | "paid";

export interface VoucherItem {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  uom: string;
}

export interface VoucherHistoryEntry {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  actor_role: VoucherActorRole;
  note?: string;
}

export interface SupplierInvoice {
  invoice_number: string;
  raised_at: string;
  subtotal: number;
  tax_rate: number; // US state/federal tax %
  tax_amount: number;
  total: number;
  payment_terms: string;
  due_date: string;
  notes: string;
  /** Invoice review lifecycle (defaults to "submitted" when raised). */
  status?: InvoiceStatus;
  reviewed_by?: string; // finance user who approved/rejected
  reviewed_at?: string;
  rejection_reason?: string;
  paid_at?: string;
}

/**
 * A flattened, list-friendly view of a supplier invoice, derived from the
 * voucher it lives on. Carries the full linkage chain so the same record can
 * be traced across Voucher ID, GRN ID, PO ID, and Supplier ID.
 */
export interface InvoiceRecord {
  invoice_number: string;
  voucher_id: string;
  po_reference: string;
  grn_reference: string;
  supplier: string;
  supplier_name: string;
  amount: number; // invoice total
  currency: string;
  raised_at: string;
  due_date: string;
  status: InvoiceStatus;
  voucher_status: VoucherStatus;
}

export interface PaymentConfirmation {
  /** Stable payment identifier — the single source of truth across screens. */
  payment_id?: string;
  confirmed_at: string;
  confirmed_by: string;
  payment_method: string;
  reference_number: string;
  amount: number;
  status?: "Paid" | "Completed";
}

/**
 * A flattened payment record derived from a voucher's `payment`. Both the
 * Invoice Detail page and the Payments module read from this single object, so
 * method / reference / amount can never disagree between screens.
 */
export interface PaymentRecord {
  payment_id: string;
  voucher_id: string;
  invoice_number: string;
  po_reference: string;
  grn_reference: string;
  supplier: string;
  supplier_name: string;
  method: string;
  reference_number: string;
  amount: number;
  currency: string;
  status: "Paid" | "Completed";
  paid_date: string;
}

export interface Voucher {
  id: string; // unique voucher ID: VCH-YYYY-XXXXX
  po_reference: string; // linked PO
  grn_reference: string; // linked GRN
  supplier: string;
  supplier_name: string;
  created_by: string; // finance user
  created_at: string;
  amount: number;
  currency: string;
  items: VoucherItem[];
  status: VoucherStatus;
  payment_terms?: string;
  due_date?: string;
  notes?: string;
  history: VoucherHistoryEntry[];
  invoice?: SupplierInvoice; // supplier's invoice back
  payment?: PaymentConfirmation;
}

export interface AppNotification {
  id: string;
  for: VoucherActorRole;
  message: string;
  voucher_id: string;
  read: boolean;
  timestamp: string;
}
