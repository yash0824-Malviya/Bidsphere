/**
 * Budget Dashboard aggregation API — the single computed data layer for the
 * Budget Management module.
 *
 * All figures come from LIVE ERPNext data:
 *   - Allocated  = ERPNext Budget amount (Budget DocType)
 *   - Consumed   = ERPNext actual expense (get_actual_expense; GL-posted
 *                  Purchase Invoices) with a submitted Purchase Order fallback
 *                  — see getBudgetUtilization in erpBudget.ts
 *   - Available  = Allocated − Consumed
 *   - Utilization% = Consumed ÷ Allocated × 100
 *
 * Every calculation is performed here (not scattered across components) so the
 * dashboard, list and detail pages share one consistent, cache-friendly source.
 * Nothing throws to the UI — failures degrade to safe empty results.
 */

import {
  fetchApprovedBudgets,
  fetchBudgetByName,
  fetchBudgets,
  fetchCompanyCurrency,
  getBudgetAccountName,
  getBudgetAmount,
  getBudgetFiscalYear,
  getBudgetUtilization,
  mapBudgetStatus,
  type BudgetListItem,
  type BudgetWorkflowStatus,
} from "./erpBudget";
import { getBudgetTimeline } from "./budget";
import { fetchSubmittedPurchaseOrders } from "./budgetConsumption";
import {
  fetchBudgetLedger,
  type BudgetLedgerData,
  type SpendBucket,
} from "./budgetLedger";
import { COMPANY } from "./erpnext";

/* ─── Status classification (req. 6) ──────────────────────────────────────── */

export type BudgetHealth = "Available" | "Near Limit" | "Exceeded";

/**
 * Green  → Available (≤ 80%)
 * Yellow → Near Limit (> 80% and < 100%)
 * Red    → Exceeded (≥ 100%)
 */
export function classifyBudgetHealth(utilizationPct: number): BudgetHealth {
  if (utilizationPct >= 100) return "Exceeded";
  if (utilizationPct > 80) return "Near Limit";
  return "Available";
}

/* ─── Types ───────────────────────────────────────────────────────────────── */

export interface BudgetDashboardKpis {
  totalBudget: number;
  reservedBudget: number;
  consumedBudget: number;
  availableBudget: number;
  utilizationPct: number;
  activeBudgets: number;
  exceededCount: number;
  nearLimitCount: number;
}

export interface BudgetDashboardRow {
  name: string;
  company: string;
  department: string;
  costCenter: string;
  fiscalYear: string;
  allocated: number;
  reserved: number;
  consumed: number;
  available: number;
  utilizationPct: number;
  health: BudgetHealth;
  workflowStatus: BudgetWorkflowStatus;
}

export interface BudgetDashboardData {
  kpis: BudgetDashboardKpis;
  rows: BudgetDashboardRow[];
  currency: string;
  hasBudgets: boolean;
}

export interface BudgetDetailData {
  general: {
    name: string;
    company: string;
    department: string | null;
    costCenter: string | null;
    fiscalYear: string | null;
    currency: string;
    account: string | null;
    budgetAgainst: string;
    workflowStatus: BudgetWorkflowStatus;
  };
  financial: {
    allocated: number;
    reserved: number;
    consumed: number;
    available: number;
    utilizationPct: number;
    health: BudgetHealth;
  };
  budgetVsActual: Array<{ label: string; allocated: number; actual: number }>;
  monthlySpend: Array<{ month: string; amount: number }>;
  departmentUtilization: Array<{
    department: string;
    allocated: number;
    consumed: number;
    utilizationPct: number;
  }>;
  /** Live PO / PI / Payment ledger for this budget (single source of truth). */
  ledger: BudgetLedgerData;
}

const EMPTY_KPIS: BudgetDashboardKpis = {
  totalBudget: 0,
  reservedBudget: 0,
  consumedBudget: 0,
  availableBudget: 0,
  utilizationPct: 0,
  activeBudgets: 0,
  exceededCount: 0,
  nearLimitCount: 0,
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/** Human-readable department from an ERPNext Cost Center / Project name. */
function humanizeDepartment(
  costCenter?: string | null,
  project?: string | null,
): string {
  const src = (costCenter || project || "").trim();
  if (!src) return "";
  // ERPNext cost centers are named "Marketing - NL"; show the leading segment.
  return src.split(" - ")[0].trim();
}

async function safeCurrency(company?: string): Promise<string> {
  try {
    return await fetchCompanyCurrency(company || COMPANY);
  } catch {
    return "USD";
  }
}

/** Last-12-month submitted PO spend, bucketed by YYYY-MM (live ERPNext). */
async function computeMonthlySpend(): Promise<
  Array<{ month: string; amount: number }>
> {
  const pos = await fetchSubmittedPurchaseOrders();
  const byMonth = new Map<string, number>();
  for (const po of pos) {
    if (!po.transaction_date || !po.grand_total) continue;
    const month = po.transaction_date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + po.grand_total);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, amount]) => ({ month, amount }));
}

/* ─── Dashboard summary (req. 1, 3, 4, 8) ─────────────────────────────────── */

/**
 * Full Budget Dashboard payload: KPIs + list rows, computed from the ERPNext
 * Budgets that are actually in force (Approved / Active). Returns `hasBudgets:
 * false` (never a Frappe error) when none exist so the UI can show
 * "No Active Budget Found".
 */
export async function getBudgetDashboard(opts?: {
  /** Cap utilization fan-out (procurement analytics). Full Budget page omits. */
  maxBudgets?: number;
  /** React Query may pass QueryFunctionContext — ignore non-option shapes. */
  queryKey?: unknown;
}): Promise<BudgetDashboardData> {
  const maxBudgets =
    opts && typeof opts === "object" && typeof opts.maxBudgets === "number"
      ? opts.maxBudgets
      : undefined;

  let approved: Awaited<ReturnType<typeof fetchApprovedBudgets>> = [];
  try {
    approved = await fetchApprovedBudgets();
  } catch {
    return { kpis: EMPTY_KPIS, rows: [], currency: "USD", hasBudgets: false };
  }

  const currency = await safeCurrency(approved[0]?.company);

  if (approved.length === 0) {
    return { kpis: EMPTY_KPIS, rows: [], currency, hasBudgets: false };
  }

  const utilTargets =
    typeof maxBudgets === "number" && maxBudgets > 0
      ? approved.slice(0, maxBudgets)
      : approved;
  const utils = await Promise.allSettled(
    utilTargets.map((b) => getBudgetUtilization(b.name)),
  );
  const utilByName = new Map(
    utilTargets.map((b, i) => [b.name, utils[i]] as const),
  );

  const rows: BudgetDashboardRow[] = utilTargets.map((b) => {
    const settled = utilByName.get(b.name);
    const util =
      settled && settled.status === "fulfilled" ? settled.value : null;
    const allocated = util?.budgetAmount ?? b.budget_amount ?? 0;
    const consumed = util?.actualExpense ?? 0;
    const reserved = util?.reservedBudget ?? 0;
    const available = Math.max(allocated - consumed, 0);
    const utilizationPct =
      allocated > 0 ? Math.round((consumed / allocated) * 100) : 0;

    return {
      name: b.name,
      company: b.company,
      department: humanizeDepartment(b.cost_center, b.project) || "—",
      costCenter: b.cost_center || "—",
      fiscalYear: b.fiscal_year || "—",
      allocated,
      reserved,
      consumed,
      available,
      utilizationPct,
      health: classifyBudgetHealth(utilizationPct),
      workflowStatus: b.status,
    };
  });

  const totalBudget = rows.reduce((s, r) => s + r.allocated, 0);
  const reservedBudget = rows.reduce((s, r) => s + r.reserved, 0);
  const consumedBudget = rows.reduce((s, r) => s + r.consumed, 0);
  const availableBudget = Math.max(totalBudget - consumedBudget, 0);
  const utilizationPct =
    totalBudget > 0 ? Math.round((consumedBudget / totalBudget) * 100) : 0;

  const kpis: BudgetDashboardKpis = {
    totalBudget,
    reservedBudget,
    consumedBudget,
    availableBudget,
    utilizationPct,
    activeBudgets: rows.length,
    exceededCount: rows.filter((r) => r.health === "Exceeded").length,
    nearLimitCount: rows.filter((r) => r.health === "Near Limit").length,
  };

  return { kpis, rows, currency, hasBudgets: true };
}

/* ─── Shared Finance-Executive budget list (My Budgets + Budget Requests) ──── */

export interface ExecutiveBudgetRow {
  name: string;
  company: string;
  department: string;
  costCenter: string;
  fiscalYear: string;
  allocated: number;
  consumed: number;
  available: number;
  utilizationPct: number;
  status: BudgetWorkflowStatus;
  /** ERPNext record creator — shown as "Submitted By". */
  submittedBy: string;
  /** Live workflow decider (modified_by) once the budget leaves Draft. */
  currentApprover: string;
  creation: string;
  modified: string;
}

/** Statuses for which live consumption is meaningful (invoices can post). */
const CONSUMING_STATUSES: BudgetWorkflowStatus[] = ["Approved", "Active", "Submitted"];

/**
 * THE single live budget list for every Finance-Executive screen (My Budgets,
 * Budget Requests). It reads the EXACT same ERPNext query the Budget Dashboard
 * uses — `fetchBudgets({ limit: 500 })`, no owner filter — so the three views
 * can never diverge, then layers on live Consumed / Available figures. There is
 * no mock/placeholder data and no owner-based pre-filter (which previously hid
 * real records whose ERPNext `owner` didn't match the session e-mail).
 */
export async function getExecutiveBudgetList(): Promise<ExecutiveBudgetRow[]> {
  let budgets: BudgetListItem[] = [];
  try {
    budgets = await fetchBudgets({ limit: 500 });
  } catch {
    return [];
  }

  return Promise.all(
    budgets.map(async (b): Promise<ExecutiveBudgetRow> => {
      const allocated = b.budget_amount ?? 0;
      let consumed = 0;
      if (CONSUMING_STATUSES.includes(b.status)) {
        try {
          const util = await getBudgetUtilization(b.name);
          consumed = util.actualExpense;
        } catch {
          consumed = 0;
        }
      }
      const available = Math.max(allocated - consumed, 0);
      const utilizationPct =
        allocated > 0 ? Math.round((consumed / allocated) * 100) : 0;

      const currentApprover =
        b.status === "Draft"
          ? "—"
          : b.status === "Submitted"
            ? "Finance Manager (Pending)"
            : b.modified_by || "Finance Manager";

      return {
        name: b.name,
        company: b.company,
        department: humanizeDepartment(b.cost_center, b.project) || "—",
        costCenter: b.cost_center || "—",
        fiscalYear: b.fiscal_year || "—",
        allocated,
        consumed,
        available,
        utilizationPct,
        status: b.status,
        submittedBy: b.owner,
        currentApprover,
        creation: b.creation,
        modified: b.modified,
      };
    }),
  );
}

/* ─── Budget Monitoring (Finance Manager) ─────────────────────────────────── */

export type MonitorStatus = "On Track" | "Warning" | "Exceeded";

export interface BudgetMonitorRow {
  budgetId: string;
  company: string;
  fiscalYear: string;
  department: string;
  costCenter: string;
  allocated: number;
  reserved: number;
  consumed: number;
  remaining: number;
  utilizationPct: number;
  status: MonitorStatus;
}

export interface BudgetMonitoringData {
  kpis: {
    totalBudget: number;
    reservedBudget: number;
    consumedBudget: number;
    availableBudget: number;
    utilizationPct: number;
    activeBudgets: number;
  };
  spendBySupplier: SpendBucket[];
  spendByDepartment: SpendBucket[];
  spendByCostCenter: SpendBucket[];
  monthlySpend: Array<{ month: string; amount: number }>;
  rows: BudgetMonitorRow[];
  currency: string;
  hasBudgets: boolean;
}

function mergeBuckets(target: Map<string, number>, buckets: SpendBucket[]): void {
  for (const b of buckets) {
    target.set(b.label, (target.get(b.label) ?? 0) + b.amount);
  }
}

function bucketsFromMap(map: Map<string, number>, limit = 24): SpendBucket[] {
  return [...map.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

function monitorStatus(utilizationPct: number): MonitorStatus {
  if (utilizationPct >= 100) return "Exceeded";
  if (utilizationPct >= 80) return "Warning";
  return "On Track";
}

/**
 * Aggregated Budget Monitoring payload for the Finance Manager — Total /
 * Reserved / Consumed / Available plus Department, Cost Center and Supplier
 * spend breakdowns and a monthly spend trend, all from the live per-budget
 * ledgers (Purchase Orders → reserved, Purchase Invoices → consumed). Reads
 * only the Approved/Active ERPNext budgets actually in force.
 */
export async function getBudgetMonitoringData(): Promise<BudgetMonitoringData> {
  let budgets: Awaited<ReturnType<typeof fetchApprovedBudgets>> = [];
  try {
    budgets = await fetchApprovedBudgets();
  } catch {
    budgets = [];
  }

  const currency = await safeCurrency(budgets[0]?.company);
  const emptyKpis = {
    totalBudget: 0,
    reservedBudget: 0,
    consumedBudget: 0,
    availableBudget: 0,
    utilizationPct: 0,
    activeBudgets: 0,
  };

  if (budgets.length === 0) {
    return {
      kpis: emptyKpis,
      spendBySupplier: [],
      spendByDepartment: [],
      spendByCostCenter: [],
      monthlySpend: [],
      rows: [],
      currency,
      hasBudgets: false,
    };
  }

  const settled = await Promise.allSettled(
    budgets.map(async (b) => {
      const ledger = await fetchBudgetLedger(
        {
          company: b.company,
          costCenter: b.cost_center ?? null,
          fiscalYear: b.fiscal_year,
          allocated: b.budget_amount ?? 0,
        },
        { detail: true },
      );
      return { budget: b, ledger };
    }),
  );

  const supplier = new Map<string, number>();
  const department = new Map<string, number>();
  const costCenter = new Map<string, number>();
  const monthly = new Map<string, number>();

  let totalBudget = 0;
  let reservedBudget = 0;
  let consumedBudget = 0;
  const rows: BudgetMonitorRow[] = [];

  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    const budget = budgets[i];
    const allocated = budget.budget_amount ?? 0;
    const ledger: BudgetLedgerData | null =
      result.status === "fulfilled" ? result.value.ledger : null;

    const consumed = ledger?.consumed ?? 0;
    const reserved = ledger?.reserved ?? 0;
    const remaining = Math.max(allocated - consumed, 0);
    const utilizationPct =
      allocated > 0 ? Math.round((consumed / allocated) * 100) : 0;

    totalBudget += allocated;
    reservedBudget += reserved;
    consumedBudget += consumed;

    if (ledger) {
      mergeBuckets(supplier, ledger.spendBySupplier);
      mergeBuckets(department, ledger.spendByDepartment);
      mergeBuckets(costCenter, ledger.spendByCostCenter);
      for (const pi of ledger.purchaseInvoices) {
        if (!pi.date) continue;
        const month = pi.date.slice(0, 7);
        monthly.set(month, (monthly.get(month) ?? 0) + pi.amount);
      }
    }

    rows.push({
      budgetId: budget.name,
      company: budget.company,
      fiscalYear: budget.fiscal_year || "—",
      department: humanizeDepartment(budget.cost_center, budget.project) || "—",
      costCenter: budget.cost_center || "—",
      allocated,
      reserved,
      consumed,
      remaining,
      utilizationPct,
      status: monitorStatus(utilizationPct),
    });
  }

  const availableBudget = Math.max(totalBudget - consumedBudget, 0);
  const utilizationPct =
    totalBudget > 0 ? Math.round((consumedBudget / totalBudget) * 100) : 0;

  const monthlySpend = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, amount]) => ({ month, amount }));

  return {
    kpis: {
      totalBudget,
      reservedBudget,
      consumedBudget,
      availableBudget,
      utilizationPct,
      activeBudgets: budgets.length,
    },
    spendBySupplier: bucketsFromMap(supplier),
    spendByDepartment: bucketsFromMap(department),
    spendByCostCenter: bucketsFromMap(costCenter),
    monthlySpend,
    rows,
    currency,
    hasBudgets: true,
  };
}

/* ─── Budget History (consolidated transaction feed) ──────────────────────── */

export type BudgetHistoryCategory =
  | "Workflow"
  | "Purchase Order"
  | "Purchase Invoice"
  | "Payment Entry";

export interface BudgetHistoryEntry {
  id: string;
  date: string;
  category: BudgetHistoryCategory;
  /** Human title — e.g. "Budget Approved", "Purchase Invoice", "Payment". */
  title: string;
  /** Acting user (workflow) or supplier (transaction). */
  actor: string;
  /** Linked ERPNext document (PO / PI / Payment Entry), when applicable. */
  reference?: string;
  referenceType?: BudgetHistoryCategory;
  amount?: number;
  /** Available budget after a consuming (Purchase Invoice) event. */
  runningBalance?: number;
  comment?: string;
}

export interface BudgetHistoryFeed {
  currency: string;
  allocated: number;
  entries: BudgetHistoryEntry[];
}

/**
 * Consolidated, live transaction history for a single Budget — every event that
 * touches it, in one feed: workflow milestones (Created, Submitted, Approved,
 * Activated, Rejected, Cancelled) plus the ledger transactions that consume or
 * reserve it (Purchase Orders, Purchase Invoices, Payments) with a running
 * available balance. All values are read from live ERPNext data.
 */
export async function getBudgetTransactionFeed(
  budgetName: string,
): Promise<BudgetHistoryFeed> {
  if (!budgetName) return { currency: "USD", allocated: 0, entries: [] };

  const budget = await fetchBudgetByName(budgetName);
  const allocated = getBudgetAmount(budget) ?? 0;
  const fiscalYear = getBudgetFiscalYear(budget) || null;

  const [currency, timeline, ledger] = await Promise.all([
    safeCurrency(budget.company),
    getBudgetTimeline(budgetName).catch(() => []),
    fetchBudgetLedger(
      {
        company: budget.company,
        costCenter: budget.cost_center ?? null,
        fiscalYear,
        allocated,
      },
      { detail: true },
    ).catch(() => null),
  ]);

  const entries: BudgetHistoryEntry[] = [];

  timeline.forEach((ev, i) => {
    entries.push({
      id: `wf-${i}-${ev.date}`,
      date: ev.date,
      category: "Workflow",
      title: ev.event,
      actor: ev.user,
      comment: ev.comment,
    });
  });

  if (ledger) {
    for (const po of ledger.purchaseOrders) {
      entries.push({
        id: `po-${po.name}`,
        date: po.date,
        category: "Purchase Order",
        title: "Purchase Order",
        actor: po.supplier,
        reference: po.name,
        referenceType: "Purchase Order",
        amount: po.amount,
      });
    }
    for (const t of ledger.transactions) {
      if (t.type === "Purchase Invoice") {
        entries.push({
          id: `pi-${t.id}`,
          date: t.date,
          category: "Purchase Invoice",
          title: "Purchase Invoice",
          actor: t.supplier,
          reference: t.purchaseInvoice,
          referenceType: "Purchase Invoice",
          amount: t.amount,
          runningBalance: t.runningBalance,
        });
      } else if (t.type === "Payment Entry") {
        entries.push({
          id: `pe-${t.id}`,
          date: t.date,
          category: "Payment Entry",
          title: "Payment",
          actor: t.supplier,
          reference: t.paymentEntry,
          referenceType: "Payment Entry",
          amount: t.amount,
        });
      }
    }
  }

  // Newest first; workflow events (with time component) and transactions (date
  // only) sort together by their date string.
  entries.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return { currency, allocated, entries };
}

/* ─── Detail (req. 5, 7) ──────────────────────────────────────────────────── */

/**
 * Detailed data for a single Budget: general info, financial summary, and the
 * three charts (Budget vs Actual, Monthly Spend Trend, Department-wise
 * Utilization) — all from live ERPNext data. Missing cost center / department /
 * fiscal year are returned as `null` so the page can show the exact
 * "… not configured" message instead of a fabricated value.
 */
export async function getBudgetDetailData(
  name: string,
): Promise<BudgetDetailData> {
  const budget = await fetchBudgetByName(name);
  const allocatedAmount = getBudgetAmount(budget) ?? 0;
  const budgetFiscalYear = getBudgetFiscalYear(budget) || null;

  const [currency, monthlySpend, dashboard, ledger] = await Promise.all([
    safeCurrency(budget.company),
    computeMonthlySpend(),
    getBudgetDashboard(),
    fetchBudgetLedger(
      {
        company: budget.company,
        costCenter: budget.cost_center ?? null,
        fiscalYear: budgetFiscalYear,
        allocated: allocatedAmount,
      },
      { detail: true },
    ).catch(() => null),
  ]);

  const resolvedLedger: BudgetLedgerData =
    ledger ?? {
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

  const allocated = allocatedAmount;
  const consumed = resolvedLedger.consumed;
  const reserved = resolvedLedger.reserved;
  const available = Math.max(allocated - consumed, 0);
  const utilizationPct =
    allocated > 0 ? Math.round((consumed / allocated) * 100) : 0;

  const costCenter = budget.cost_center?.trim() || null;
  const fiscalYear = budgetFiscalYear;
  const department = humanizeDepartment(budget.cost_center, budget.project) || null;

  return {
    general: {
      name: budget.name,
      company: budget.company,
      department,
      costCenter,
      fiscalYear,
      currency,
      account: getBudgetAccountName(budget) || null,
      budgetAgainst: budget.budget_against || "Cost Center",
      workflowStatus: mapBudgetStatus(budget),
    },
    financial: {
      allocated,
      reserved,
      consumed,
      available,
      utilizationPct,
      health: classifyBudgetHealth(utilizationPct),
    },
    budgetVsActual: [{ label: "This Budget", allocated, actual: consumed }],
    monthlySpend,
    departmentUtilization: dashboard.rows.map((r) => ({
      department: r.department,
      allocated: r.allocated,
      consumed: r.consumed,
      utilizationPct: r.utilizationPct,
    })),
    ledger: resolvedLedger,
  };
}
