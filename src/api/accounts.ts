/**
 * ERPNext Accounts service — Purchase Invoices and Payment Entries.
 *
 * All functions reuse the shared Axios instance and helpers from `./erpnext.ts`.
 */

import {
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  COMPANY,
} from "./erpnext";
import type { ListParams } from "./erpnext";
import { DEFAULT_CURRENCY } from "../utils/format";
import {
  buildPaymentEntryPayload,
  buildPurchaseInvoicePayload,
  todayERPNextDate,
} from "../utils/erpNextDate";
import { getSupplier } from "./supplier";
import type { PaymentEntry, PurchaseInvoice } from "../types/erpnext";
import {
  FALLBACK_PAYMENT_MODES,
  sortPaymentModes,
} from "../utils/usPaymentMethods";

/** Thrown when supplier ledger currency conflicts with invoice payable account. */
export class InvoiceCurrencyMismatchError extends Error {
  readonly details: {
    supplier: string;
    invoiceCurrency: string;
    ledgerCurrency: string;
    creditTo: string;
  };

  constructor(
    message: string,
    details: {
      supplier: string;
      invoiceCurrency: string;
      ledgerCurrency: string;
      creditTo: string;
    }
  ) {
    super(message);
    this.name = "InvoiceCurrencyMismatchError";
    this.details = details;
  }
}

const PURCHASE_INVOICE_DOCTYPE = "Purchase Invoice";
const PAYMENT_ENTRY_DOCTYPE = "Payment Entry";
const MODE_OF_PAYMENT_DOCTYPE = "Mode of Payment";

/* -------------------------------------------------------------------------- */
/*  Purchase Invoice                                                          */
/* -------------------------------------------------------------------------- */

/** List Purchase Invoices, optionally filtered. */
export async function getPurchaseInvoices(
  filters?: ListParams
): Promise<PurchaseInvoice[]> {
  try {
    return await apiGet<PurchaseInvoice[]>(
      buildResourceUrl(PURCHASE_INVOICE_DOCTYPE),
      buildListConfig({
        fields: [
          "name",
          "supplier",
          "status",
          "posting_date",
          "grand_total",
          "outstanding_amount",
          "modified",
        ],
        order_by: "modified desc",
        limit_page_length: 50,
        ...filters,
      })
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[Invoices] 403/Error:", message);
    return [];
  }
}

/**
 * Fetch all Purchase Invoices that are eligible for payment.
 *
 * Strategy:
 *  1. Fetch ALL invoices where outstanding_amount > 0 (incl. drafts) so
 *     we can log every invoice with its exclusion reason in DevTools.
 *  2. Client-side filter for the truly payable set:
 *       docstatus = 1   — must be submitted to the accounting ledger
 *       status != Paid
 *       status != Cancelled
 *  3. Return only the payable subset; the diagnostic log shows why any
 *     invoice with a balance is still excluded (e.g. Draft, Cancelled).
 *
 * Why NOT filter docstatus server-side?
 *   If we push docstatus=1 to ERPNext and a Draft with outstanding_amount
 *   exists, the diagnostic log would never see it — obscuring the mismatch.
 *   Fetching all and filtering client-side gives full visibility.
 */
export async function getPayableInvoices(): Promise<PurchaseInvoice[]> {
  /*
   * Fetch ALL invoices with outstanding_amount > 0, across all companies.
   * No company filter is applied at the query level — invoices from any
   * company are shown in the dropdown. The "New Payment" page re-fetches the
   * selected invoice individually and warns the user if the invoice company
   * does not match the active company before allowing submission.
   *
   * Drafts are included so the diagnostic log can explain why they are excluded.
   */
  const all = await apiGet<PurchaseInvoice[]>(
    buildResourceUrl(PURCHASE_INVOICE_DOCTYPE),
    buildListConfig({
      filters: [
        ["outstanding_amount", ">", 0],
      ],
      fields: [
        "name",
        "company",
        "supplier",
        "supplier_name",
        "status",
        "docstatus",
        "outstanding_amount",
        "grand_total",
        "currency",
        "due_date",
        "credit_to",
        "conversion_rate",
        "posting_date",
      ],
      order_by: "due_date asc",
      limit_page_length: 200,
    })
  );

  // Submitted + unpaid only (Unpaid, Overdue, Partly Paid, etc.)
  const payable = all.filter(
    (inv) =>
      inv.docstatus === 1 &&
      inv.status !== "Paid" &&
      inv.status !== "Cancelled" &&
      inv.status !== "Draft"
  );

  // ── Diagnostic log ─────────────────────────────────────────────────────
  /* eslint-disable no-console */
  console.group(
    `[Payment] Invoice Diagnostic — fetched=${all.length}  payable=${payable.length}`
  );
  for (const inv of all) {
    const included = payable.some((p) => p.name === inv.name);
    const invCompany = (inv as PurchaseInvoice & { company?: string }).company;
    let reason = "N/A";
    if (!included) {
      if ((inv.docstatus ?? 0) !== 1)
        reason = `Draft (docstatus=${inv.docstatus ?? 0}) — submit first`;
      else if (inv.status === "Paid")
        reason = "Already Paid";
      else if (inv.status === "Cancelled")
        reason = "Cancelled";
      else
        reason = `Unexpected status: ${inv.status ?? "(null)"}`;
    }
    console.log(`Invoice: ${inv.name}`);
    console.log(`  Company: ${invCompany ?? "unknown"}${invCompany !== COMPANY ? "  ⚠ cross-company — payment will be blocked at submit" : ""}`);
    console.log(`  Status: ${inv.status ?? "(null)"}`);
    console.log(`  Outstanding: ${inv.outstanding_amount} ${inv.currency ?? ""}`);
    console.log(`  credit_to: ${inv.credit_to ?? "(none)"}`);
    console.log(`  Included in Payment Dropdown: ${included}`);
    console.log(`  Reason Excluded: ${reason}`);
    console.log("  ---");
  }
  console.groupEnd();
  /* eslint-enable no-console */

  return enrichInvoicesWithPayableCurrency(payable);
}

/** Attach `payable_currency` (credit_to account currency) to invoice rows. */
async function enrichInvoicesWithPayableCurrency<
  T extends PurchaseInvoice & { credit_to?: string },
>(invoices: T[]): Promise<T[]> {
  const cache = new Map<string, string>();
  return Promise.all(
    invoices.map(async (inv) => {
      if (!inv.credit_to) return inv;
      let payableCurrency = cache.get(inv.credit_to);
      if (!payableCurrency) {
        payableCurrency = await getAccountCurrency(inv.credit_to);
        cache.set(inv.credit_to, payableCurrency);
      }
      return { ...inv, payable_currency: payableCurrency };
    })
  );
}

/** Minimal invoice row returned by list queries. */
export interface InvoiceRow {
  name: string;
  status?: string;
  docstatus?: number;
  grand_total?: number;
  outstanding_amount?: number;
  modified?: string;
}

/**
 * Return all Purchase Invoices whose items reference `poName`.
 * Uses the child-table filter pattern (same as getGRNsForPO).
 * Cancelled invoices (docstatus === 2) are included so callers can exclude
 * them when deciding whether a "live" invoice already exists.
 */
export async function getInvoicesForPO(poName: string): Promise<InvoiceRow[]> {
  return apiGet<InvoiceRow[]>(
    buildResourceUrl(PURCHASE_INVOICE_DOCTYPE),
    buildListConfig({
      filters: [
        ["Purchase Invoice Item", "purchase_order", "=", poName],
      ],
      fields: [
        "name",
        "status",
        "docstatus",
        "grand_total",
        "outstanding_amount",
        "modified",
      ],
      limit_page_length: 10,
    })
  );
}

/**
 * Return all Purchase Invoices whose items reference Goods Receipt Note
 * `grnName` (child filter on `Purchase Invoice Item.purchase_receipt`). This
 * is the precise way to detect the invoice Finance created from a specific
 * GRN. Cancelled invoices (docstatus === 2) are included so callers can
 * exclude them when deciding whether a "live" invoice already exists.
 */
export async function getInvoicesForGRN(grnName: string): Promise<InvoiceRow[]> {
  try {
    return await apiGet<InvoiceRow[]>(
      buildResourceUrl(PURCHASE_INVOICE_DOCTYPE),
      buildListConfig({
        filters: [
          ["Purchase Invoice Item", "purchase_receipt", "=", grnName],
        ],
        fields: [
          "name",
          "status",
          "docstatus",
          "grand_total",
          "outstanding_amount",
          "modified",
        ],
        limit_page_length: 10,
      })
    );
  } catch {
    return [];
  }
}

/**
 * Fetch a single Purchase Invoice by name.
 * Always returns the full document including `company`, `credit_to`, and
 * all other fields needed for payment validation.
 */
export async function getPurchaseInvoice(
  name: string
): Promise<PurchaseInvoice & { company?: string }> {
  const inv = await apiGet<PurchaseInvoice & { company?: string }>(
    buildResourceUrl(PURCHASE_INVOICE_DOCTYPE, name)
  );
  if (!inv.credit_to) return inv;
  const payable_currency = await getAccountCurrency(inv.credit_to);
  return { ...inv, payable_currency };
}

/** Create a Purchase Invoice (saved as Draft). */
export async function createPurchaseInvoice(
  data: Partial<PurchaseInvoice>
): Promise<PurchaseInvoice> {
  const payload = buildPurchaseInvoicePayload({ ...data });
  // eslint-disable-next-line no-console
  console.log("Final API Payload", payload);
  return apiPost<PurchaseInvoice>(
    buildResourceUrl(PURCHASE_INVOICE_DOCTYPE),
    payload
  );
}

/** Return the `account_currency` of a GL Account. */
export async function getAccountCurrency(accountName: string): Promise<string> {
  const row = await apiGet<{ account_currency?: string }>(
    buildResourceUrl("Account", accountName),
    { params: { fields: JSON.stringify(["account_currency"]) } }
  );
  return row.account_currency ?? "USD";
}

/**
 * Currency locked on a supplier's ledger for a company (from submitted GLE).
 * Once set, ERPNext requires all new payable GL entries to use this currency.
 */
export async function getSupplierLedgerCurrency(
  supplier: string,
  company: string
): Promise<string | null> {
  const rows = await apiGet<Array<{ account_currency?: string }>>(
    buildResourceUrl("GL Entry"),
    buildListConfig({
      filters: [
        ["party_type", "=", "Supplier"],
        ["party", "=", supplier],
        ["company", "=", company],
        ["is_cancelled", "=", 0],
      ],
      fields: ["account_currency"],
      limit_page_length: 1,
    })
  );
  return rows[0]?.account_currency ?? null;
}

/** Payable account currency configured on the Supplier master (Party Account). */
export async function getSupplierPartyAccountCurrency(
  supplier: string,
  company: string
): Promise<string | null> {
  const doc = await getSupplier(supplier);
  const partyAccount = doc.accounts?.find((a) => a.company === company);
  if (!partyAccount?.account) return null;
  return getAccountCurrency(partyAccount.account);
}

export interface ResolvedPayableAccount {
  creditTo: string;
  accountCurrency: string;
  /** True when invoice transaction currency differs from payable/outstanding currency. */
  currencyMismatch: boolean;
  ledgerLocked: boolean;
  message?: string;
}

/**
 * Resolve the correct `credit_to` for a Purchase Invoice.
 *
 * ERPNext rules (validated on submit via GL Entry):
 *  - If the supplier already has GL entries for a company, the payable account
 *    currency MUST match that ledger currency (e.g. USD → "Creditors - INT").
 *  - Invoice document currency may differ from the payable account currency;
 *    outstanding is always tracked in the payable account currency.
 *  - Payable account currency MUST match the supplier ledger currency. */
export async function resolvePurchaseInvoiceCreditTo(
  company: string,
  supplier: string,
  invoiceCurrency: string
): Promise<ResolvedPayableAccount> {
  const ledgerCurrency = await getSupplierLedgerCurrency(supplier, company);
  const partyCurrency = await getSupplierPartyAccountCurrency(supplier, company);

  // Ledger lock takes precedence over party master default.
  const targetCurrency =
    ledgerCurrency ?? partyCurrency ?? invoiceCurrency;

  const creditTo = await ensurePayableAccount(company, targetCurrency);
  const currencyMismatch = invoiceCurrency !== targetCurrency;

  let message: string | undefined;
  if (ledgerCurrency && ledgerCurrency !== invoiceCurrency) {
    message =
      `Supplier "${supplier}" has existing ledger entries in ${ledgerCurrency} ` +
      `for ${company}. Payable account "${creditTo}" will be used. ` +
      `Invoice total is shown in ${invoiceCurrency}; outstanding will be in ${ledgerCurrency}.`;
  } else if (currencyMismatch) {
    message =
      `Invoice currency (${invoiceCurrency}) differs from payable account currency ` +
      `(${targetCurrency}). Outstanding will be recorded in ${targetCurrency}.`;
  }

  return {
    creditTo,
    accountCurrency: targetCurrency,
    currencyMismatch,
    ledgerLocked: !!ledgerCurrency,
    message,
  };
}

/**
 * Guarantee a leaf Payable account exists for `company` + `currency`.
 *
 * Lookup order:
 *  1. Search for an existing account_type=Payable, same company, same currency.
 *  2. If none exists, auto-create one under the parent of the company's first
 *     existing payable account (same parent group, different currency).
 *
 * The created account name follows the pattern "Creditors - {CURRENCY} - {ABBR}"
 * where ABBR is the company abbreviation (suffix of any existing payable account).
 *
 * ERPNext hard rule: `credit_to.account_currency` MUST equal the invoice
 * currency.  "Same company, any currency with conversion_rate" is NOT accepted.
 */
async function ensurePayableAccount(
  company: string,
  currency: string
): Promise<string> {
  const ACCOUNT = "Account";

  /* eslint-disable no-console */
  console.log(`[Invoice] ensurePayableAccount — company="${company}" currency="${currency}"`);

  // ── 1. Look for an existing match ────────────────────────────────────────
  const existing = await apiGet<Array<{ name: string; parent_account: string }>>(
    buildResourceUrl(ACCOUNT),
    buildListConfig({
      filters: [
        ["account_type",    "=", "Payable"],
        ["company",         "=", company],
        ["account_currency","=", currency],
        ["disabled",        "=", 0],
        ["is_group",        "=", 0],
      ],
      fields: ["name", "parent_account"],
      limit_page_length: 1,
    })
  );

  if (existing[0]) {
    console.log(`[Invoice]   ✓ found existing: ${existing[0].name}`);
    /* eslint-enable no-console */
    return existing[0].name;
  }

  // ── 2. No match — find the parent group from an existing payable account ─
  const anyPayable = await apiGet<Array<{
    name: string;
    parent_account: string;
  }>>(
    buildResourceUrl(ACCOUNT),
    buildListConfig({
      filters: [
        ["account_type", "=", "Payable"],
        ["company",      "=", company],
        ["disabled",     "=", 0],
        ["is_group",     "=", 0],
      ],
      fields: ["name", "parent_account"],
      limit_page_length: 1,
    })
  );

  if (!anyPayable[0]?.parent_account) {
    throw new Error(
      `No Payable accounts found for company "${company}". ` +
      `Please set up the Chart of Accounts in ERPNext first.`
    );
  }

  const parentAccount = anyPayable[0].parent_account;

  // Derive company abbreviation from an existing payable name
  // e.g. "Creditors - INT" → abbr = "INT"
  const abbrMatch = anyPayable[0].name.match(/-\s*([A-Z0-9]+)\s*$/);
  const abbr = abbrMatch ? abbrMatch[1] : company.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 5);
  const accountName = `Creditors - ${currency} - ${abbr}`;

  console.log(`[Invoice]   ✗ no ${currency} payable account found — auto-creating "${accountName}" under "${parentAccount}"`);

  // ── 3. Create the missing account ────────────────────────────────────────
  const created = await apiPost<{ name: string }>(
    buildResourceUrl(ACCOUNT),
    {
      account_name    : `Creditors - ${currency}`,
      parent_account  : parentAccount,
      company,
      account_type    : "Payable",
      account_currency: currency,
      is_group        : 0,
    }
  );

  console.log(`[Invoice]   ✓ auto-created payable account: ${created.name}`);
  /* eslint-enable no-console */

  return created.name;
}

/**
 * Create a Purchase Invoice from a submitted Purchase Order.
 *
 * Flow:
 *  1. Call ERPNext's make_purchase_invoice — returns a fully-formed draft.
 *  2. Resolve the correct `credit_to` using ensurePayableAccount(), which
 *     guarantees company ownership AND currency match (ERPNext hard requirement).
 *     If no matching account exists, one is auto-created in the Chart of Accounts.
 *  3. Save the patched draft via POST /api/resource/Purchase Invoice.
 *
 * Diagnostic log (printed to DevTools console):
 *   company | supplier | invoice currency | payable account | account currency
 */
export async function createInvoiceFromPO(
  poName: string
): Promise<PurchaseInvoice & { payable_currency?: string; currency_note?: string }> {
  const draft = await apiPost<Record<string, unknown>>(
    "/api/method/erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_invoice",
    { source_name: poName }
  );

  const today = todayERPNextDate();
  const invoiceCurrency =
    (draft.currency as string | undefined) ?? "USD";
  const invoiceCompany =
    (draft.company as string | undefined) ?? COMPANY;
  const supplier = (draft.supplier as string | undefined) ?? "";
  const rawCreditTo = draft.credit_to as string | undefined;

  /* eslint-disable no-console */
  console.group("[Invoice] createInvoiceFromPO");
  console.log("  company          :", invoiceCompany);
  console.log("  supplier         :", supplier);
  console.log("  invoice currency :", invoiceCurrency);
  console.log("  credit_to (raw)  :", rawCreditTo ?? "(none)");

  const resolved = await resolvePurchaseInvoiceCreditTo(
    invoiceCompany,
    supplier,
    invoiceCurrency
  );

  const companyCurrency = await getCompanyCurrency(invoiceCompany);
  const conversionRate =
    invoiceCurrency === companyCurrency
      ? 1
      : await getExchangeRate(invoiceCurrency, companyCurrency, today);

  console.log("  credit_to (resolved):", resolved.creditTo);
  console.log("  payable currency    :", resolved.accountCurrency);
  console.log("  conversion_rate     :", conversionRate);
  if (resolved.message) console.warn("  note:", resolved.message);
  if (resolved.creditTo !== rawCreditTo) {
    console.warn(
      `  credit_to changed: "${rawCreditTo ?? "(none)"}" → "${resolved.creditTo}"`
    );
  }
  console.groupEnd();
  /* eslint-enable no-console */

  // ERPNext validates due_date >= posting_date (the "Supplier Invoice Date").
  // The draft returned by make_purchase_invoice may carry an older due_date
  // derived from the original PO schedule — clamp it to at least today.
  // Also clamp payment_schedule child rows (ERPNext validates each row's
  // due_date independently).
  const draftDueDate = (draft as { due_date?: string }).due_date;
  const dueDate =
    draftDueDate && draftDueDate >= today ? draftDueDate : today;

  // Payment schedule rows from the draft may also contain stale dates.
  const paymentSchedule = (
    draft as { payment_schedule?: Array<Record<string, unknown>> }
  ).payment_schedule;
  if (Array.isArray(paymentSchedule)) {
    for (const row of paymentSchedule) {
      if (typeof row.due_date === "string" && row.due_date < today) {
        row.due_date = today;
      }
    }
  }

  /* eslint-disable no-console */
  console.log("[createInvoiceFromPO] due_date clamp:", {
    draftDueDate,
    today,
    resolvedDueDate: dueDate,
    paymentScheduleDates: paymentSchedule?.map((r) => r.due_date),
  });
  /* eslint-enable no-console */

  const created = await createPurchaseInvoice({
    ...(draft as Partial<PurchaseInvoice>),
    credit_to: resolved.creditTo,
    conversion_rate: conversionRate,
    bill_no: `INV-${Date.now().toString().slice(-6)}`,
    bill_date: today,
    posting_date: today,
    due_date: dueDate,
  });

  return {
    ...created,
    payable_currency: resolved.accountCurrency,
    currency_note: resolved.message,
  };
}

/**
 * Resolve `credit_to` + conversion rate on a freshly-made invoice draft and
 * persist it as a Draft Purchase Invoice. Shared by the PO- and GRN-sourced
 * invoice creation paths.
 */
async function finalizeInvoiceFromDraft(
  draft: Record<string, unknown>
): Promise<PurchaseInvoice & { payable_currency?: string; currency_note?: string }> {
  const today = todayERPNextDate();
  const invoiceCurrency = (draft.currency as string | undefined) ?? "USD";
  const invoiceCompany = (draft.company as string | undefined) ?? COMPANY;
  const supplier = (draft.supplier as string | undefined) ?? "";

  const resolved = await resolvePurchaseInvoiceCreditTo(
    invoiceCompany,
    supplier,
    invoiceCurrency
  );

  const companyCurrency = await getCompanyCurrency(invoiceCompany);
  const conversionRate =
    invoiceCurrency === companyCurrency
      ? 1
      : await getExchangeRate(invoiceCurrency, companyCurrency, today);

  // Clamp due_date to at least today (same logic as createInvoiceFromPO).
  const draftDueDate = (draft as { due_date?: string }).due_date;
  const dueDate =
    draftDueDate && draftDueDate >= today ? draftDueDate : today;

  // Payment schedule rows may also contain stale dates.
  const paymentSchedule = (
    draft as { payment_schedule?: Array<Record<string, unknown>> }
  ).payment_schedule;
  if (Array.isArray(paymentSchedule)) {
    for (const row of paymentSchedule) {
      if (typeof row.due_date === "string" && row.due_date < today) {
        row.due_date = today;
      }
    }
  }

  const created = await createPurchaseInvoice({
    ...(draft as Partial<PurchaseInvoice>),
    credit_to: resolved.creditTo,
    conversion_rate: conversionRate,
    bill_no: `INV-${Date.now().toString().slice(-6)}`,
    bill_date: today,
    posting_date: today,
    due_date: dueDate,
  });

  return {
    ...created,
    payable_currency: resolved.accountCurrency,
    currency_note: resolved.message,
  };
}

/**
 * Create a Purchase Invoice directly from a submitted Goods Receipt Note
 * (Purchase Receipt). This is the Finance entry point of the P2P workflow:
 * the resulting invoice is linked back to the GRN via
 * `Purchase Invoice Item.purchase_receipt`, so the GRN can display its
 * invoice number and flip to "Invoice Created".
 */
export async function createInvoiceFromReceipt(
  receiptName: string
): Promise<PurchaseInvoice & { payable_currency?: string; currency_note?: string }> {
  const draft = await apiPost<Record<string, unknown>>(
    "/api/method/erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_invoice",
    { source_name: receiptName }
  );
  // eslint-disable-next-line no-console
  console.log("[Invoice] createInvoiceFromReceipt — source GRN:", receiptName);
  return finalizeInvoiceFromDraft(draft);
}

/**
 * Patch a draft Purchase Invoice so `credit_to` and exchange rates are valid
 * before submission. ERPNext rejects submit when payable account currency
 * conflicts with the supplier's existing ledger currency.
 */
export async function preparePurchaseInvoiceForSubmit(
  name: string
): Promise<PurchaseInvoice> {
  const inv = await getPurchaseInvoice(name);
  if ((inv.docstatus ?? 0) !== 0) return inv;

  const invoiceCurrency = inv.currency ?? "USD";
  const company = inv.company ?? COMPANY;
  const supplier = inv.supplier;

  const resolved = await resolvePurchaseInvoiceCreditTo(
    company,
    supplier,
    invoiceCurrency
  );

  const companyCurrency = await getCompanyCurrency(company);
  const conversionRate =
    invoiceCurrency === companyCurrency
      ? 1
      : await getExchangeRate(
          invoiceCurrency,
          companyCurrency,
          inv.posting_date ?? todayERPNextDate()
        );

  const currentCreditCurrency = inv.credit_to
    ? await getAccountCurrency(inv.credit_to)
    : null;

  const needsUpdate =
    inv.credit_to !== resolved.creditTo ||
    currentCreditCurrency !== resolved.accountCurrency ||
    Math.abs((inv.conversion_rate ?? 0) - conversionRate) > 0.0001;

  if (!needsUpdate) return inv;

  /* eslint-disable no-console */
  console.group("[Invoice] preparePurchaseInvoiceForSubmit");
  console.log("  invoice            :", name);
  console.log("  credit_to          :", inv.credit_to, "→", resolved.creditTo);
  console.log("  payable currency   :", resolved.accountCurrency);
  console.log("  conversion_rate    :", inv.conversion_rate, "→", conversionRate);
  if (resolved.message) console.warn("  note:", resolved.message);
  console.groupEnd();
  /* eslint-enable no-console */

  return updatePurchaseInvoice(name, {
    credit_to: resolved.creditTo,
    conversion_rate: conversionRate,
  });
}

/** Update an existing Purchase Invoice. */
export async function updatePurchaseInvoice(
  name: string,
  data: Partial<PurchaseInvoice>
): Promise<PurchaseInvoice> {
  return apiPut<PurchaseInvoice>(
    buildResourceUrl(PURCHASE_INVOICE_DOCTYPE, name),
    data
  );
}

/**
 * Submit a Purchase Invoice — transitions docstatus 0 → 1.
 * Uses GET-then-PUT (same proven pattern as PO/GRN/RFQ submission).
 * `frappe.client.submit(doctype, docname)` raises
 * "submit() missing 1 required positional argument: 'doc'".
 */
export async function submitPurchaseInvoice(
  name: string
): Promise<PurchaseInvoice> {
  // Fix credit_to / conversion_rate before submit.
  const prepared = await preparePurchaseInvoiceForSubmit(name);

  const invoiceCurrency = prepared.currency ?? "USD";
  const payableCurrency =
    prepared.credit_to
      ? await getAccountCurrency(prepared.credit_to)
      : invoiceCurrency;

  if (prepared.credit_to) {
    const ledgerCurrency = await getSupplierLedgerCurrency(
      prepared.supplier,
      prepared.company ?? COMPANY
    );
    if (
      ledgerCurrency &&
      payableCurrency !== ledgerCurrency
    ) {
      throw new InvoiceCurrencyMismatchError(
        `Cannot submit invoice: supplier "${prepared.supplier}" requires payable ` +
          `account in ${ledgerCurrency}, but "${prepared.credit_to}" is ${payableCurrency}.`,
        {
          supplier: prepared.supplier,
          invoiceCurrency,
          ledgerCurrency,
          creditTo: prepared.credit_to,
        }
      );
    }
  }

  const modified =
    (prepared as { modified?: string }).modified ??
    (prepared as { data?: { modified?: string } }).data?.modified;
  const body: Record<string, unknown> = { docstatus: 1 };
  if (modified) body.modified = modified;

  try {
    return await apiPut<PurchaseInvoice>(
      buildResourceUrl(PURCHASE_INVOICE_DOCTYPE, name),
      body
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("InvalidAccountCurrency")) {
      throw new InvoiceCurrencyMismatchError(
        `Supplier "${prepared.supplier}" has existing accounting entries in ` +
          `${payableCurrency === invoiceCurrency ? "another" : payableCurrency} ` +
          `currency for company "${prepared.company}". ` +
          `Use payable account "${prepared.credit_to}" (${payableCurrency}). ` +
          `Outstanding is recorded in ${payableCurrency}, not ${invoiceCurrency}.`,
        {
          supplier: prepared.supplier,
          invoiceCurrency,
          ledgerCurrency: payableCurrency,
          creditTo: prepared.credit_to ?? "",
        }
      );
    }
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/*  Payment Entry                                                             */
/* -------------------------------------------------------------------------- */

/** List Payment Entries, optionally filtered. */
export async function getPaymentEntries(
  filters?: ListParams
): Promise<PaymentEntry[]> {
  return apiGet<PaymentEntry[]>(
    buildResourceUrl(PAYMENT_ENTRY_DOCTYPE),
    buildListConfig({
      fields: [
        "name",
        "party",
        "party_type",
        "payment_type",
        "posting_date",
        "paid_amount",
        "status",
        "modified",
      ],
      order_by: "modified desc",
      limit_page_length: 50,
      ...filters,
    })
  );
}

/** Fetch a single Payment Entry by `name`. */
export async function getPaymentEntry(name: string): Promise<PaymentEntry> {
  return apiGet<PaymentEntry>(
    buildResourceUrl(PAYMENT_ENTRY_DOCTYPE, name)
  );
}

/** Fetch Mode of Payment names from ERPNext (exact payload values). */
export async function getModesOfPayment(): Promise<string[]> {
  try {
    const rows = await apiGet<Array<{ name: string; enabled?: 0 | 1 }>>(
      buildResourceUrl(MODE_OF_PAYMENT_DOCTYPE),
      buildListConfig({
        fields: ["name", "enabled"],
        order_by: "name asc",
        limit_page_length: 100,
      })
    );
    const enabled = rows
      .filter((row) => row.enabled !== 0)
      .map((row) => row.name);
    const modes = enabled.length > 0 ? enabled : rows.map((row) => row.name);
    return sortPaymentModes(modes);
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        "[getModesOfPayment] API failed, using fallback modes:",
        err instanceof Error ? err.message : err
      );
    }
    return [...FALLBACK_PAYMENT_MODES];
  }
}

/* -------------------------------------------------------------------------- */
/*  Payment helpers — accounts, currency, exchange rate                       */
/* -------------------------------------------------------------------------- */

export interface PaymentFromAccount {
  name: string;
  account_currency: string;
  account_type: string;
}

/** Fetch Bank and Cash GL accounts for the given company. */
export async function getPaymentFromAccounts(
  company: string
): Promise<PaymentFromAccount[]> {
  return apiGet<PaymentFromAccount[]>(
    buildResourceUrl("Account"),
    buildListConfig({
      filters: [
        ["company", "=", company],
        ["account_type", "in", "Bank,Cash"],
        ["is_group", "=", 0],
        ["disabled", "=", 0],
      ],
      fields: ["name", "account_currency", "account_type"],
      limit_page_length: 50,
    })
  );
}

/** Default bank/cash account for supplier payments (prefers matching currency). */
export async function getDefaultPaymentFromAccount(
  company: string,
  currency?: string
): Promise<PaymentFromAccount | null> {
  const accounts = await getPaymentFromAccounts(company);
  if (accounts.length === 0) return null;

  const pool =
    currency && currency.length > 0
      ? accounts.filter(
          (a) => (a.account_currency ?? DEFAULT_CURRENCY) === currency
        )
      : accounts;
  const pick = pool.length > 0 ? pool : accounts;

  return (
    pick.find((a) => a.account_type === "Bank") ??
    pick.find((a) => a.account_type === "Cash") ??
    pick[0]
  );
}

/** Fetch the default_currency of a Company document. */
export async function getCompanyCurrency(company: string): Promise<string> {
  const doc = await apiGet<{ default_currency?: string }>(
    buildResourceUrl("Company", company)
  );
  return doc.default_currency ?? "USD";
}

/**
 * Get the exchange rate from ERPNext for `fromCurrency` → `toCurrency`
 * on a given date. Returns 1 when the currencies are the same.
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  transactionDate: string
): Promise<number> {
  if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return 1;
  try {
    const result = await apiGet<number | string>(
      "/api/method/erpnext.setup.utils.get_exchange_rate",
      {
        params: {
          from_currency: fromCurrency,
          to_currency: toCurrency,
          transaction_date: transactionDate,
        },
      }
    );
    const rate = typeof result === "number" ? result : Number(result);
    return rate > 0 ? rate : 1;
  } catch {
    // Fallback — caller should warn the user
    return 0;
  }
}

/** Create a Payment Entry (saved as Draft). */
export async function createPaymentEntry(
  data: Partial<PaymentEntry>
): Promise<PaymentEntry> {
  const payload = buildPaymentEntryPayload({ ...data });
  // eslint-disable-next-line no-console
  console.log("Final API Payload", payload);
  return apiPost<PaymentEntry>(
    buildResourceUrl(PAYMENT_ENTRY_DOCTYPE),
    payload
  );
}

/** Update a draft Payment Entry. */
export async function updatePaymentEntry(
  name: string,
  data: Partial<PaymentEntry>
): Promise<PaymentEntry> {
  const fresh = await apiGet<PaymentEntry>(
    buildResourceUrl(PAYMENT_ENTRY_DOCTYPE, name)
  );
  const modified =
    (fresh as { modified?: string }).modified ??
    (fresh as { data?: { modified?: string } }).data?.modified;
  const body = buildPaymentEntryPayload({ ...data });
  if (modified) (body as Record<string, unknown>).modified = modified;
  // eslint-disable-next-line no-console
  console.log("Final API Payload", body);
  return apiPut<PaymentEntry>(
    buildResourceUrl(PAYMENT_ENTRY_DOCTYPE, name),
    body
  );
}

/**
 * Submit a Payment Entry — transitions docstatus 0 → 1.
 * Uses GET-then-PUT (same proven pattern as PO/GRN/RFQ/Invoice submission).
 */
export async function submitPaymentEntry(name: string): Promise<PaymentEntry> {
  const fresh = await apiGet<PaymentEntry>(
    buildResourceUrl(PAYMENT_ENTRY_DOCTYPE, name)
  );
  const modified =
    (fresh as { modified?: string }).modified ??
    (fresh as { data?: { modified?: string } }).data?.modified;
  const body: Record<string, unknown> = { docstatus: 1 };
  if (modified) body.modified = modified;
  return apiPut<PaymentEntry>(
    buildResourceUrl(PAYMENT_ENTRY_DOCTYPE, name),
    body
  );
}

