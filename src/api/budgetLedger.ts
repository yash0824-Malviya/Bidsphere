/**
 * Budget Ledger — live ERPNext budget accounting.
 *
 * This is the SINGLE, live-data source for how much of a Budget has actually
 * been committed (Purchase Orders) and consumed (Purchase Invoices), and for
 * the full Budget Transaction History (every PO, PI and Payment Entry that
 * touches the budget, with a running available balance).
 *
 * Consumption model (enterprise accounting):
 *   Reserved  = Σ open Purchase Order value (submitted, not yet fully billed)
 *   Consumed  = Σ submitted Purchase Invoice grand totals
 *   Available = Allocated − Consumed
 *   Utilization% = Consumed ÷ Allocated × 100
 *
 * A transaction is attributed to a Budget when it shares the Budget's
 * Company + Fiscal Year window AND its Cost Center matches the Budget's Cost
 * Center. Documents carrying no Cost Center at all are treated as belonging to
 * the Cost Center's budget (best-effort attribution) so that spend is never
 * silently dropped.
 *
 * Only ERPNext data is read here — never mock/placeholder values. Every figure
 * degrades gracefully to 0 / empty on error so the UI never crashes.
 */

import {
  apiGet,
  buildListConfig,
  buildResourceUrl,
  withSilent,
  type Filter,
} from "./erpnext";

const LOG_TAG = "[BudgetLedger]";

function log(op: string, data?: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`${LOG_TAG} ${op}`, data ?? "");
}

/* ─── Fiscal Year date range (cached) ─────────────────────────────────────── */

export interface FiscalYearRange {
  start?: string;
  end?: string;
}

const fyRangeCache = new Map<string, FiscalYearRange>();

/** Resolve a Fiscal Year's start/end dates (live ERPNext, cached per session). */
export async function resolveFiscalYearRange(
  fiscalYear: string | undefined | null,
): Promise<FiscalYearRange> {
  const fy = (fiscalYear ?? "").trim();
  if (!fy) return {};
  const cached = fyRangeCache.get(fy);
  if (cached) return cached;
  try {
    const row = await apiGet<{ year_start_date?: string; year_end_date?: string }>(
      buildResourceUrl("Fiscal Year", fy),
      { ...withSilent() },
    );
    const range: FiscalYearRange = {
      start: row.year_start_date,
      end: row.year_end_date,
    };
    fyRangeCache.set(fy, range);
    return range;
  } catch {
    return {};
  }
}

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type BudgetTransactionType =
  | "Purchase Order"
  | "Purchase Invoice"
  | "Payment Entry";

export interface BudgetTransaction {
  /** Stable key for React lists. */
  id: string;
  date: string;
  type: BudgetTransactionType;
  supplier: string;
  purchaseOrder?: string;
  purchaseInvoice?: string;
  paymentEntry?: string;
  amount: number;
  /** Available budget after this transaction (Allocated − cumulative Consumed). */
  runningBalance: number;
}

export interface LedgerPurchaseOrder {
  name: string;
  supplier: string;
  date: string;
  amount: number;
  billedPct: number;
  openAmount: number;
  status?: string;
}

export interface LedgerPurchaseInvoice {
  name: string;
  supplier: string;
  date: string;
  amount: number;
  outstanding: number;
  paid: number;
  status?: string;
  purchaseOrder?: string;
}

export interface LedgerPayment {
  name: string;
  supplier: string;
  date: string;
  amount: number;
  reference?: string;
  purchaseInvoice?: string;
}

export interface SpendBucket {
  label: string;
  amount: number;
}

export interface BudgetLedgerData {
  /** Σ submitted Purchase Invoice grand totals attributed to the budget. */
  consumed: number;
  /** Σ open (not yet billed) Purchase Order value attributed to the budget. */
  reserved: number;
  purchaseOrders: LedgerPurchaseOrder[];
  purchaseInvoices: LedgerPurchaseInvoice[];
  payments: LedgerPayment[];
  spendBySupplier: SpendBucket[];
  spendByDepartment: SpendBucket[];
  spendByCostCenter: SpendBucket[];
  transactions: BudgetTransaction[];
}

export interface BudgetLedgerScope {
  company?: string | null;
  costCenter?: string | null;
  fiscalYear?: string | null;
  /** Allocated budget amount — used to compute running available balance. */
  allocated: number;
}

const EMPTY_LEDGER: BudgetLedgerData = {
  consumed: 0,
  reserved: 0,
  purchaseOrders: [],
  purchaseInvoices: [],
  payments: [],
  spendBySupplier: [],
  spendByDepartment: [],
  spendByCostCenter: [],
  transactions: [],
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function humanizeDepartment(costCenter?: string | null): string {
  const src = (costCenter || "").trim();
  if (!src) return "Unassigned";
  return src.split(" - ")[0].trim() || "Unassigned";
}

function topBuckets(map: Map<string, number>, limit = 12): SpendBucket[] {
  return [...map.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

interface PiHeader {
  name: string;
  supplier?: string;
  supplier_name?: string;
  posting_date?: string;
  grand_total?: number;
  outstanding_amount?: number;
  status?: string;
  cost_center?: string;
}

interface PoHeader {
  name: string;
  supplier?: string;
  supplier_name?: string;
  transaction_date?: string;
  grand_total?: number;
  per_billed?: number;
  status?: string;
}

interface ChildRow {
  parent?: string;
  cost_center?: string;
  purchase_order?: string;
}

/** Bulk-fetch child-table cost centers (and PO links) keyed by parent name. */
async function fetchChildCostCenters(
  childDoctype: string,
  parentNames: string[],
): Promise<Map<string, { costCenters: Set<string>; purchaseOrder?: string }>> {
  const map = new Map<string, { costCenters: Set<string>; purchaseOrder?: string }>();
  if (parentNames.length === 0) return map;
  const wantsPo = childDoctype === "Purchase Invoice Item";
  try {
    const rows = await apiGet<ChildRow[]>(buildResourceUrl(childDoctype), {
      ...buildListConfig({
        fields: wantsPo
          ? ["parent", "cost_center", "purchase_order"]
          : ["parent", "cost_center"],
        filters: [["parent", "in", parentNames]],
        limit_page_length: 5000,
      }),
      ...withSilent(),
    });
    for (const row of rows ?? []) {
      if (!row.parent) continue;
      const entry = map.get(row.parent) ?? { costCenters: new Set<string>() };
      if (row.cost_center) entry.costCenters.add(row.cost_center);
      if (wantsPo && !entry.purchaseOrder && row.purchase_order) {
        entry.purchaseOrder = row.purchase_order;
      }
      map.set(row.parent, entry);
    }
  } catch {
    /* child table may not be queryable — degrade to header cost center */
  }
  return map;
}

/**
 * Decide whether a document belongs to the budget's cost center.
 *
 * Match when: the budget has no cost center (company-wide), OR the doc's cost
 * centers include the budget's, OR the doc carries no cost center at all
 * (unattributed spend is folded into the governing cost center so live spend
 * is never lost).
 */
function matchesCostCenter(
  budgetCostCenter: string | null | undefined,
  docCostCenters: Set<string>,
): boolean {
  if (!budgetCostCenter) return true;
  if (docCostCenters.size === 0) return true;
  return docCostCenters.has(budgetCostCenter);
}

/* ─── Live fetchers ───────────────────────────────────────────────────────── */

async function fetchSubmittedInvoices(
  company: string | null | undefined,
  range: FiscalYearRange,
): Promise<PiHeader[]> {
  const filters: Filter[] = [["docstatus", "=", 1]];
  if (company) filters.push(["company", "=", company]);
  if (range.start) filters.push(["posting_date", ">=", range.start]);
  if (range.end) filters.push(["posting_date", "<=", range.end]);
  try {
    const rows = await apiGet<PiHeader[]>(buildResourceUrl("Purchase Invoice"), {
      ...buildListConfig({
        fields: [
          "name",
          "supplier",
          "supplier_name",
          "posting_date",
          "grand_total",
          "outstanding_amount",
          "status",
          "cost_center",
        ],
        filters,
        limit_page_length: 2000,
        order_by: "posting_date asc",
      }),
      ...withSilent(),
    });
    return rows ?? [];
  } catch (err) {
    log("fetch invoices failed", err);
    return [];
  }
}

async function fetchSubmittedOrders(
  company: string | null | undefined,
  range: FiscalYearRange,
): Promise<PoHeader[]> {
  const filters: Filter[] = [["docstatus", "=", 1]];
  if (company) filters.push(["company", "=", company]);
  if (range.start) filters.push(["transaction_date", ">=", range.start]);
  if (range.end) filters.push(["transaction_date", "<=", range.end]);
  try {
    const rows = await apiGet<PoHeader[]>(buildResourceUrl("Purchase Order"), {
      ...buildListConfig({
        fields: [
          "name",
          "supplier",
          "supplier_name",
          "transaction_date",
          "grand_total",
          "per_billed",
          "status",
        ],
        filters,
        limit_page_length: 2000,
        order_by: "transaction_date asc",
      }),
      ...withSilent(),
    });
    return rows ?? [];
  } catch (err) {
    log("fetch orders failed", err);
    return [];
  }
}

interface PaymentRefRow {
  parent?: string;
  reference_name?: string;
  allocated_amount?: number;
}

interface PaymentHeader {
  name: string;
  party?: string;
  party_name?: string;
  posting_date?: string;
  paid_amount?: number;
  reference_no?: string;
}

/** Payment Entries (submitted) that settle any of the given Purchase Invoices. */
async function fetchPaymentsForInvoices(
  invoiceNames: string[],
): Promise<LedgerPayment[]> {
  if (invoiceNames.length === 0) return [];
  let refRows: PaymentRefRow[] = [];
  try {
    refRows =
      (await apiGet<PaymentRefRow[]>(buildResourceUrl("Payment Entry Reference"), {
        ...buildListConfig({
          fields: ["parent", "reference_name", "allocated_amount"],
          filters: [
            ["reference_doctype", "=", "Purchase Invoice"],
            ["reference_name", "in", invoiceNames],
            ["docstatus", "=", 1],
          ],
          limit_page_length: 5000,
        }),
        ...withSilent(),
      })) ?? [];
  } catch (err) {
    log("fetch payment references failed", err);
    return [];
  }

  const parentNames = [...new Set(refRows.map((r) => r.parent).filter(Boolean))] as string[];
  if (parentNames.length === 0) return [];

  let headers: PaymentHeader[] = [];
  try {
    headers =
      (await apiGet<PaymentHeader[]>(buildResourceUrl("Payment Entry"), {
        ...buildListConfig({
          fields: [
            "name",
            "party",
            "party_name",
            "posting_date",
            "paid_amount",
            "reference_no",
          ],
          filters: [
            ["name", "in", parentNames],
            ["docstatus", "=", 1],
          ],
          limit_page_length: 5000,
        }),
        ...withSilent(),
      })) ?? [];
  } catch (err) {
    log("fetch payment headers failed", err);
    return [];
  }

  const headerMap = new Map(headers.map((h) => [h.name, h]));
  const payments: LedgerPayment[] = [];
  for (const ref of refRows) {
    if (!ref.parent) continue;
    const header = headerMap.get(ref.parent);
    if (!header) continue;
    payments.push({
      name: header.name,
      supplier: header.party_name || header.party || "—",
      date: header.posting_date ?? "",
      amount: ref.allocated_amount ?? header.paid_amount ?? 0,
      reference: header.reference_no,
      purchaseInvoice: ref.reference_name,
    });
  }
  return payments;
}

/* ─── Public aggregation ──────────────────────────────────────────────────── */

/**
 * Full live ledger for a Budget scope. When `detail` is false, payments,
 * spend breakdowns and the transaction history are skipped (only consumed +
 * reserved + the raw PO/PI lists are computed) — used by the lightweight
 * utilization path that runs once per budget on the dashboard.
 */
export async function fetchBudgetLedger(
  scope: BudgetLedgerScope,
  opts?: { detail?: boolean },
): Promise<BudgetLedgerData> {
  const detail = opts?.detail ?? true;
  const range = await resolveFiscalYearRange(scope.fiscalYear);

  const [invoiceHeaders, orderHeaders] = await Promise.all([
    fetchSubmittedInvoices(scope.company, range),
    fetchSubmittedOrders(scope.company, range),
  ]);

  if (invoiceHeaders.length === 0 && orderHeaders.length === 0) {
    return EMPTY_LEDGER;
  }

  // Resolve cost centers from child item rows (falls back to header cost center).
  const [piChild, poChild] = await Promise.all([
    fetchChildCostCenters(
      "Purchase Invoice Item",
      invoiceHeaders.map((i) => i.name),
    ),
    fetchChildCostCenters(
      "Purchase Order Item",
      orderHeaders.map((o) => o.name),
    ),
  ]);

  const cc = scope.costCenter ?? null;

  /* Purchase Invoices → consumed */
  const purchaseInvoices: LedgerPurchaseInvoice[] = [];
  let consumed = 0;
  for (const pi of invoiceHeaders) {
    const childInfo = piChild.get(pi.name);
    const centers = new Set<string>(childInfo?.costCenters ?? []);
    if (pi.cost_center) centers.add(pi.cost_center);
    if (!matchesCostCenter(cc, centers)) continue;

    const amount = pi.grand_total ?? 0;
    const outstanding = pi.outstanding_amount ?? 0;
    consumed += amount;
    purchaseInvoices.push({
      name: pi.name,
      supplier: pi.supplier_name || pi.supplier || "—",
      date: pi.posting_date ?? "",
      amount,
      outstanding,
      paid: Math.max(amount - outstanding, 0),
      status: pi.status,
      purchaseOrder: childInfo?.purchaseOrder,
    });
  }

  /* Purchase Orders → reserved (open, not yet billed) */
  const purchaseOrders: LedgerPurchaseOrder[] = [];
  let reserved = 0;
  for (const po of orderHeaders) {
    const centers = new Set<string>(poChild.get(po.name)?.costCenters ?? []);
    if (!matchesCostCenter(cc, centers)) continue;

    const amount = po.grand_total ?? 0;
    const billedPct = po.per_billed ?? 0;
    const openAmount = Math.max(amount * (1 - billedPct / 100), 0);
    reserved += openAmount;
    purchaseOrders.push({
      name: po.name,
      supplier: po.supplier_name || po.supplier || "—",
      date: po.transaction_date ?? "",
      amount,
      billedPct,
      openAmount,
      status: po.status,
    });
  }

  if (!detail) {
    return {
      ...EMPTY_LEDGER,
      consumed,
      reserved,
      purchaseInvoices,
      purchaseOrders,
    };
  }

  /* Payments settling the matched invoices */
  const payments = await fetchPaymentsForInvoices(
    purchaseInvoices.map((i) => i.name),
  );

  /* Spend breakdowns (by consumed invoice value) */
  const bySupplier = new Map<string, number>();
  const byCostCenter = new Map<string, number>();
  const byDepartment = new Map<string, number>();
  for (const pi of purchaseInvoices) {
    bySupplier.set(pi.supplier, (bySupplier.get(pi.supplier) ?? 0) + pi.amount);
    const centers = piChild.get(pi.name)?.costCenters;
    const resolvedCc =
      (centers && centers.size > 0 ? [...centers][0] : undefined) ?? cc ?? "Unassigned";
    byCostCenter.set(resolvedCc, (byCostCenter.get(resolvedCc) ?? 0) + pi.amount);
    const dept = humanizeDepartment(resolvedCc);
    byDepartment.set(dept, (byDepartment.get(dept) ?? 0) + pi.amount);
  }

  /* Budget Transaction History — every PI + Payment, with running balance */
  interface Event {
    date: string;
    type: BudgetTransactionType;
    supplier: string;
    purchaseOrder?: string;
    purchaseInvoice?: string;
    paymentEntry?: string;
    amount: number;
    /** Amount that reduces available budget at this event (only PIs consume). */
    consumeDelta: number;
  }

  const events: Event[] = [];
  for (const pi of purchaseInvoices) {
    events.push({
      date: pi.date,
      type: "Purchase Invoice",
      supplier: pi.supplier,
      purchaseOrder: pi.purchaseOrder,
      purchaseInvoice: pi.name,
      amount: pi.amount,
      consumeDelta: pi.amount,
    });
  }
  const piPoMap = new Map(purchaseInvoices.map((p) => [p.name, p.purchaseOrder]));
  for (const pay of payments) {
    events.push({
      date: pay.date,
      type: "Payment Entry",
      supplier: pay.supplier,
      purchaseInvoice: pay.purchaseInvoice,
      purchaseOrder: pay.purchaseInvoice ? piPoMap.get(pay.purchaseInvoice) : undefined,
      paymentEntry: pay.name,
      amount: pay.amount,
      consumeDelta: 0,
    });
  }

  events.sort((a, b) => {
    const d = (a.date || "").localeCompare(b.date || "");
    if (d !== 0) return d;
    // Within a day, count the invoice before its payment.
    return a.type === "Purchase Invoice" ? -1 : 1;
  });

  let cumulativeConsumed = 0;
  const transactions: BudgetTransaction[] = events.map((ev, i) => {
    cumulativeConsumed += ev.consumeDelta;
    return {
      id: `${ev.type}-${ev.paymentEntry ?? ev.purchaseInvoice ?? i}`,
      date: ev.date,
      type: ev.type,
      supplier: ev.supplier,
      purchaseOrder: ev.purchaseOrder,
      purchaseInvoice: ev.purchaseInvoice,
      paymentEntry: ev.paymentEntry,
      amount: ev.amount,
      runningBalance: scope.allocated - cumulativeConsumed,
    };
  });
  // Newest first for display.
  transactions.reverse();

  return {
    consumed,
    reserved,
    purchaseOrders: purchaseOrders.sort((a, b) => b.date.localeCompare(a.date)),
    purchaseInvoices: purchaseInvoices.sort((a, b) => b.date.localeCompare(a.date)),
    payments: payments.sort((a, b) => b.date.localeCompare(a.date)),
    spendBySupplier: topBuckets(bySupplier),
    spendByDepartment: topBuckets(byDepartment),
    spendByCostCenter: topBuckets(byCostCenter),
    transactions,
  };
}
