/**
 * Payment Entry service — the dedicated Payment Processing flow.
 *
 * Orchestrates a fully ERPNext-driven supplier payment:
 *   PO → Purchase Invoice (create/submit) → Payment Entry (create, attach
 *   files, submit). Nothing here is mock/local — every record is a real
 *   ERPNext document.
 */

import { apiPost, COMPANY } from "./erpnext";
import { APP_NAME } from "../config/branding";
import {
  createInvoiceFromPO,
  createInvoiceFromReceipt,
  createPaymentEntry,
  getCompanyCurrency,
  getDefaultPaymentFromAccount,
  getExchangeRate,
  getInvoicesForGRN,
  getInvoicesForPO,
  getPaymentEntries,
  getPurchaseInvoice,
  submitPaymentEntry,
  submitPurchaseInvoice,
  updatePaymentEntry,
} from "./accounts";
import { getPurchaseOrder, getPurchaseReceipt } from "./purchasing";
import type { PurchaseInvoice } from "../types/erpnext";
import { DEFAULT_CURRENCY } from "../utils/format";
import { generateId } from "../utils/id";
import type { PaymentAttachmentKind } from "../types/paymentAttachment";
import {
  buildPaymentRemarks,
  collectExistingReferences,
  generatePaymentReference,
  type PaymentMethodDetails,
} from "../utils/usPaymentMethods";

const PAYMENT_ENTRY_DOCTYPE = "Payment Entry";

/* -------------------------------------------------------------------------- */
/*  Backend-derived payment reference                                         */
/* -------------------------------------------------------------------------- */

/**
 * Produce the next payment reference. Uniqueness is driven by LIVE ERPNext
 * data: we read every existing `Payment Entry.reference_no` from the backend
 * and increment the sequence for the chosen method + date. The frontend only
 * formats the value — it never invents the sequence.
 */
export async function getNextPaymentReference(
  method: string,
  postingDate: string
): Promise<string> {
  const existing = await getPaymentEntries({
    filters: [["payment_type", "=", "Pay"]],
    fields: ["reference_no"],
    limit_page_length: 500,
    order_by: "creation desc",
  });
  const refs = collectExistingReferences(existing);
  return generatePaymentReference(method, refs, postingDate);
}

/* -------------------------------------------------------------------------- */
/*  File upload (ERPNext File doctype, linked to the Payment Entry)           */
/* -------------------------------------------------------------------------- */

export interface UploadedPaymentFile {
  kind: PaymentAttachmentKind;
  file_url: string;
  file_name: string;
  name: string;
}

/**
 * Upload one file to ERPNext via `/api/method/upload_file`, attaching it to a
 * Payment Entry. Returns the backend-stored `file_url`. Axios sets the
 * multipart boundary automatically for `FormData` payloads.
 */
export async function uploadPaymentFile(
  file: File,
  paymentEntryName: string,
  kind: PaymentAttachmentKind,
  isPrivate = true
): Promise<UploadedPaymentFile> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("is_private", isPrivate ? "1" : "0");
  form.append("folder", "Home");
  form.append("doctype", PAYMENT_ENTRY_DOCTYPE);
  form.append("docname", paymentEntryName);

  const msg = await apiPost<{
    file_url: string;
    file_name?: string;
    name: string;
  }>("/api/method/upload_file", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return {
    kind,
    file_url: msg.file_url,
    file_name: msg.file_name ?? file.name,
    name: msg.name,
  };
}

/* -------------------------------------------------------------------------- */
/*  End-to-end payment processing                                             */
/* -------------------------------------------------------------------------- */

export interface PaymentFileInput {
  kind: PaymentAttachmentKind;
  file: File;
}

export interface ProcessInvoicePaymentInput {
  /** Submitted ERPNext Purchase Order the invoice/payment derives from. */
  poReference: string;
  /**
   * Submitted ERPNext Purchase Receipt (GRN) linked to the voucher, when
   * available. The voucher workflow is GRN-centric, so billing must be
   * derived from the GRN's received quantities — not the PO — whenever one
   * exists (see `processInvoicePayment` for why).
   */
  grnReference?: string;
  /** Exact ERPNext Mode of Payment name (e.g. "ACH Transfer"). */
  paymentMethod: string;
  /** Backend-derived payment reference. */
  paymentReference: string;
  /** Method-specific bank/account/routing/trace fields. */
  methodDetails: PaymentMethodDetails;
  /** Files to upload + link to the Payment Entry. */
  files?: PaymentFileInput[];
  /** Posting / value date (YYYY-MM-DD). */
  postingDate: string;
  /** Optional free-text note appended to remarks. */
  note?: string;
}

export interface ProcessInvoicePaymentResult {
  purchaseInvoice: string;
  paymentEntry: string;
  amountPaid: number;
  currency: string;
  attachmentUrls: string[];
}

/**
 * Resolve the live Purchase Invoice to pay against, creating one if none
 * exists yet.
 *
 * The voucher workflow is GRN-centric (a Voucher is raised per Goods
 * Receipt Note, carrying `grn_reference` + `po_reference`), so billing MUST
 * be derived from the GRN via `make_purchase_invoice` on the Purchase
 * Receipt whenever a GRN is linked — not from the PO. Billing from the PO
 * directly returns an EMPTY `items` table whenever the PO has already been
 * (fully or partially) invoiced through a different receipt/flow, which
 * then fails Purchase Invoice submission with
 * `MandatoryError: Purchase Invoice - Items`. Falling back to the PO is
 * only safe when no GRN is linked at all.
 */
async function resolveOrCreatePurchaseInvoice(
  poReference: string,
  grnReference?: string
): Promise<string> {
  if (grnReference) {
    const existingForGrn = (await getInvoicesForGRN(grnReference)).filter(
      (i) => i.docstatus !== 2
    );
    const live =
      existingForGrn.find(
        (i) => i.docstatus === 1 && (i.outstanding_amount ?? 0) > 0
      ) ?? existingForGrn.find((i) => i.docstatus === 0);
    if (live) return live.name;

    const fullyPaid = existingForGrn.find(
      (i) => i.docstatus === 1 && (i.outstanding_amount ?? 0) <= 0
    );
    if (fullyPaid) {
      throw new Error(
        `Goods Receipt Note "${grnReference}" has already been fully invoiced and paid ` +
          `(${fullyPaid.name}). No further payment is due for this voucher.`
      );
    }

    const grn = await getPurchaseReceipt(grnReference);
    if ((grn.per_billed ?? 0) >= 100) {
      throw new Error(
        `Goods Receipt Note "${grnReference}" is already 100% billed but no matching ` +
          `Purchase Invoice record was found. This voucher cannot be invoiced — ` +
          `contact an administrator to reconcile the GRN billing status.`
      );
    }

    const created = await createInvoiceFromReceipt(grnReference);
    assertInvoiceHasItems(created, `Goods Receipt Note "${grnReference}"`);
    return created.name;
  }

  // No GRN linked — fall back to billing directly from the PO.
  const existingForPo = (await getInvoicesForPO(poReference)).filter(
    (i) => i.docstatus !== 2
  );
  const live =
    existingForPo.find(
      (i) => i.docstatus === 1 && (i.outstanding_amount ?? 0) > 0
    ) ?? existingForPo.find((i) => i.docstatus === 0);
  if (live) return live.name;

  const fullyPaid = existingForPo.find(
    (i) => i.docstatus === 1 && (i.outstanding_amount ?? 0) <= 0
  );
  if (fullyPaid) {
    throw new Error(
      `Purchase Order "${poReference}" has already been fully invoiced and paid ` +
        `(${fullyPaid.name}). No further payment is due for this voucher — please ` +
        `verify the linked PO/GRN reference before retrying.`
    );
  }

  const po = await getPurchaseOrder(poReference);
  if ((po.per_billed ?? 0) >= 100) {
    throw new Error(
      `Purchase Order "${poReference}" is already 100% billed but no matching ` +
        `Purchase Invoice record was found. This voucher cannot be invoiced — ` +
        `contact an administrator to reconcile the Purchase Order billing status.`
    );
  }

  const created = await createInvoiceFromPO(poReference);
  assertInvoiceHasItems(created, `Purchase Order "${poReference}"`);
  return created.name;
}

/** Never let a header-only draft (no billable line items) reach submission. */
function assertInvoiceHasItems(
  invoice: Pick<PurchaseInvoice, "items">,
  sourceLabel: string
): void {
  if (!invoice.items || invoice.items.length === 0) {
    throw new Error(
      `ERPNext returned a Purchase Invoice draft with no billable items for ${sourceLabel}. ` +
        `Payment cannot proceed — verify there is an unbilled balance in ERPNext.`
    );
  }
}

/**
 * Release a supplier payment end-to-end against LIVE ERPNext:
 *
 *   1. Reuse an existing live Purchase Invoice for the GRN/PO, or create one
 *      via `make_purchase_invoice` (correct items/taxes/credit_to).
 *   2. Submit the Purchase Invoice (docstatus 0 → 1).
 *   3. Create a Payment Entry draft reconciled against the invoice.
 *   4. Upload + link any attachments to that Payment Entry (best-effort).
 *   5. Persist method/reference/attachment URLs in remarks, then submit.
 *
 * ERPNext then drives all downstream status: Purchase Invoice → Paid,
 * Purchase Order → Fully Billed.
 */
export async function processInvoicePayment(
  input: ProcessInvoicePaymentInput
): Promise<ProcessInvoicePaymentResult> {
  const {
    poReference,
    grnReference,
    paymentMethod,
    paymentReference,
    methodDetails,
    files = [],
    postingDate,
    note,
  } = input;

  if (!poReference) {
    throw new Error(
      "This invoice has no linked Purchase Order, so an ERPNext Payment Entry cannot be created."
    );
  }

  const piName = await resolveOrCreatePurchaseInvoice(poReference, grnReference);

  // 2. Ensure submitted.
  let pi = await getPurchaseInvoice(piName);
  if ((pi.docstatus ?? 0) === 0) {
    await submitPurchaseInvoice(piName);
    pi = await getPurchaseInvoice(piName);
  }

  // ERPNext requires Payment Entry posting_date >= Purchase Invoice posting_date.
  // If the user's selected date is earlier, we auto-correct to the invoice date
  // (the effective date is applied to posting_date and reference_date below).
  const invoiceDate = (pi as { posting_date?: string }).posting_date;

  const company = (pi as { company?: string }).company ?? COMPANY;
  const payableCurrency =
    (pi as { payable_currency?: string }).payable_currency ??
    pi.currency ??
    DEFAULT_CURRENCY;
  const outstanding = pi.outstanding_amount ?? pi.grand_total ?? 0;

  if (outstanding <= 0) {
    throw new Error("This invoice has no outstanding balance to pay.");
  }
  if (!pi.credit_to) {
    throw new Error("Invoice payable account (credit_to) could not be resolved.");
  }

  // 3. Bank account + exchange rates.
  const fromAccount = await getDefaultPaymentFromAccount(
    company,
    payableCurrency
  );
  if (!fromAccount) {
    throw new Error(
      `No bank or cash account is configured for ${payableCurrency} payments in ERPNext.`
    );
  }
  const companyCurrency = await getCompanyCurrency(company);
  const sourceRate = await getExchangeRate(
    fromAccount.account_currency,
    companyCurrency,
    postingDate
  );
  const targetRate = await getExchangeRate(
    payableCurrency,
    companyCurrency,
    postingDate
  );
  if (sourceRate <= 0 || targetRate <= 0) {
    throw new Error("Exchange rate unavailable. Please retry.");
  }
  const paidAmountInBank = outstanding * (targetRate / sourceRate);

  // 4. Create the Payment Entry as a draft (needed before file attach).
  const baseRemarks = buildPaymentRemarks(
    {
      v: 1,
      method: paymentMethod,
      details: methodDetails,
      attachments: [],
      uiStatus: "Paid",
    },
    note ?? `Payment released from ${APP_NAME}`
  );

  // Ensure posting_date and reference_date are not before the invoice date.
  const effectivePostingDate =
    invoiceDate && postingDate < invoiceDate ? invoiceDate : postingDate;

  const paymentEntryPayload = {
    payment_type: "Pay" as const,
    party_type: "Supplier" as const,
    party: pi.supplier,
    posting_date: effectivePostingDate,
    company,
    mode_of_payment: paymentMethod,
    paid_from: fromAccount.name,
    paid_from_account_currency: fromAccount.account_currency,
    paid_amount: paidAmountInBank,
    source_exchange_rate: sourceRate,
    paid_to: pi.credit_to,
    paid_to_account_currency: payableCurrency,
    received_amount: outstanding,
    target_exchange_rate: targetRate,
    reference_no: paymentReference.trim(),
    reference_date: effectivePostingDate,
    remarks: baseRemarks,
    references: [
      {
        name: generateId(),
        reference_doctype: "Purchase Invoice" as const,
        reference_name: piName,
        total_amount: pi.grand_total ?? 0,
        outstanding_amount: outstanding,
        allocated_amount: outstanding,
      },
    ],
  };

  /* eslint-disable no-console */
  console.log("PAYMENT ENTRY PAYLOAD", paymentEntryPayload);
  console.log("Invoice Date", invoiceDate);
  console.log("Invoice Due Date", (pi as { due_date?: string }).due_date);
  console.log("Payment Date (user)", postingDate);
  console.log("Effective Payment Date", effectivePostingDate);
  /* eslint-enable no-console */

  const draft = await createPaymentEntry(paymentEntryPayload);

  // 5. Upload + link attachments to the draft (best-effort, non-blocking).
  const attachmentUrls: string[] = [];
  for (const { kind, file } of files) {
    try {
      const uploaded = await uploadPaymentFile(file, draft.name, kind);
      attachmentUrls.push(uploaded.file_url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[processInvoicePayment] attachment "${file.name}" upload failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 6. Persist the backend file URLs into remarks, then submit.
  if (attachmentUrls.length > 0) {
    const remarksWithUrls = buildPaymentRemarks(
      {
        v: 1,
        method: paymentMethod,
        details: methodDetails,
        attachments: attachmentUrls,
        uiStatus: "Paid",
      },
      note ?? `Payment released from ${APP_NAME}`
    );
    await updatePaymentEntry(draft.name, { remarks: remarksWithUrls });
  }

  const submitted = await submitPaymentEntry(draft.name);

  return {
    purchaseInvoice: piName,
    paymentEntry: submitted.name,
    amountPaid: outstanding,
    currency: payableCurrency,
    attachmentUrls,
  };
}
