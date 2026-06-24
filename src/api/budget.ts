/**
 * Budget Management API
 *
 * Plans & override approvals → localStorage (`bidsphere-budget-plans`, `bidsphere-budget-approvals`)
 * Consumption (RFQ + PO commitments) → computed from ERPNext + finance review workflow
 *
 * Remaining Budget = Total Budget − Approved RFQ Value (no PO yet) − Approved PO Value
 */

import { fetchAllFinanceReviewRecords } from "./financeReviews";
import { apiGet, buildResourceUrl, buildListConfig, withSilent } from "./erpnext";

/* ─── Types ───────────────────────────────────────────────────────────────── */

export interface BudgetPlan {
  id: string;
  name: string;
  fiscalYear: string;
  department: string;
  amount: number;
  currency: string;
  consumed: number;
  status: "Active" | "Draft" | "Closed" | "Exceeded";
  createdAt: string;
  updatedAt: string;
}

export interface BudgetApproval {
  id: string;
  poName: string;
  poAmount: number;
  supplier: string;
  department: string;
  requestedBy: string;
  reason: string;
  budgetName: string;
  budgetRemaining: number;
  overageAmount: number;
  status: "Pending" | "Approved" | "Rejected" | "Revision Requested";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  notes?: string;
}

export interface BudgetConsumption {
  approvedRfqValue: number;
  approvedPoValue: number;
  consumedBudget: number;
  approvedRfqCount: number;
  approvedPoCount: number;
  rfqsWithoutPo: string[];
}

export interface BudgetKpis {
  totalBudget: number;
  consumedBudget: number;
  /** @deprecated alias — use consumedBudget */
  utilizedBudget: number;
  remainingBudget: number;
  utilizationPct: number;
  approvedRfqValue: number;
  approvedPoValue: number;
  activePlans: number;
  pendingApprovals: number;
}

export interface DeptMonitorRow {
  department: string;
  allocated: number;
  consumed: number;
  remaining: number;
  utilizationPct: number;
  status: "On Track" | "Warning" | "Exceeded";
}

export interface BudgetCheckResult {
  withinBudget: boolean;
  budgetName?: string;
  allocated?: number;
  consumed?: number;
  remaining?: number;
  poAmount: number;
  overageAmount?: number;
  warning?: string;
}

/* ─── Storage keys ────────────────────────────────────────────────────────── */

const PLANS_KEY = "bidsphere-budget-plans";
const APPROVALS_KEY = "bidsphere-budget-approvals";
const LOG_TAG = "[Budget]";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Structured console log for every budget operation. */
export function logBudget(operation: string, data?: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`${LOG_TAG} ${operation}`, data ?? "");
}

/* ─── Plans CRUD (localStorage) ───────────────────────────────────────────── */

export function getBudgetPlans(): BudgetPlan[] {
  try {
    const raw = localStorage.getItem(PLANS_KEY);
    const plans = raw ? (JSON.parse(raw) as BudgetPlan[]) : seedPlans();
    logBudget("GET plans", { count: plans.length, source: "localStorage", key: PLANS_KEY });
    return plans;
  } catch {
    logBudget("GET plans — parse error, reseeding");
    return seedPlans();
  }
}

function persist(plans: BudgetPlan[]) {
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
  logBudget("SAVE plans", { count: plans.length, key: PLANS_KEY });
}

export function createBudgetPlan(
  input: Omit<BudgetPlan, "id" | "consumed" | "status" | "createdAt" | "updatedAt">
): BudgetPlan {
  const plans = getBudgetPlans();
  const plan: BudgetPlan = {
    ...input,
    id: uid(),
    consumed: 0,
    status: "Active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  plans.push(plan);
  persist(plans);
  logBudget("CREATE plan", plan);
  return plan;
}

export function updateBudgetPlan(
  id: string,
  updates: Partial<
    Pick<BudgetPlan, "name" | "fiscalYear" | "department" | "amount" | "currency" | "status">
  >
): BudgetPlan | null {
  const plans = getBudgetPlans();
  const idx = plans.findIndex((p) => p.id === id);
  if (idx === -1) {
    logBudget("UPDATE plan — not found", { id });
    return null;
  }
  plans[idx] = { ...plans[idx], ...updates, updatedAt: new Date().toISOString() };
  persist(plans);
  logBudget("UPDATE plan", plans[idx]);
  return plans[idx];
}

export function deleteBudgetPlan(id: string): boolean {
  const plans = getBudgetPlans();
  const filtered = plans.filter((p) => p.id !== id);
  if (filtered.length === plans.length) {
    logBudget("DELETE plan — not found", { id });
    return false;
  }
  persist(filtered);
  logBudget("DELETE plan", { id });
  return true;
}

/* ─── Approvals CRUD (localStorage) ───────────────────────────────────────── */

export function getBudgetApprovals(): BudgetApproval[] {
  try {
    const raw = localStorage.getItem(APPROVALS_KEY);
    const approvals = raw ? (JSON.parse(raw) as BudgetApproval[]) : [];
    logBudget("GET approvals", { count: approvals.length, key: APPROVALS_KEY });
    return approvals;
  } catch {
    return [];
  }
}

function persistApprovals(approvals: BudgetApproval[]) {
  localStorage.setItem(APPROVALS_KEY, JSON.stringify(approvals));
  logBudget("SAVE approvals", { count: approvals.length, key: APPROVALS_KEY });
}

export function createBudgetApproval(
  input: Omit<BudgetApproval, "id" | "status" | "createdAt">
): BudgetApproval {
  const approvals = getBudgetApprovals();
  const approval: BudgetApproval = {
    ...input,
    id: uid(),
    status: "Pending",
    createdAt: new Date().toISOString(),
  };
  approvals.push(approval);
  persistApprovals(approvals);
  logBudget("CREATE approval", approval);
  return approval;
}

export function resolveBudgetApproval(
  id: string,
  action: "Approved" | "Rejected" | "Revision Requested",
  resolvedBy: string,
  notes?: string
): BudgetApproval | null {
  const approvals = getBudgetApprovals();
  const idx = approvals.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  approvals[idx] = {
    ...approvals[idx],
    status: action,
    resolvedAt: new Date().toISOString(),
    resolvedBy,
    notes,
  };
  persistApprovals(approvals);
  logBudget("RESOLVE approval", approvals[idx]);
  return approvals[idx];
}

/* ─── Workflow consumption (ERPNext + finance reviews) ─────────────────────── */

interface SubmittedPORow {
  name: string;
  grand_total?: number;
  custom_rfq_reference?: string;
}

/** Submitted Purchase Orders from ERPNext (docstatus = 1). */
export async function fetchSubmittedPurchaseOrders(): Promise<SubmittedPORow[]> {
  logBudget("FETCH submitted POs — ERPNext", {
    endpoint: buildResourceUrl("Purchase Order"),
  });
  try {
    const rows = await apiGet<SubmittedPORow[]>(
      buildResourceUrl("Purchase Order"),
      {
        ...buildListConfig({
          fields: ["name", "grand_total", "custom_rfq_reference"],
          filters: [["docstatus", "=", 1]],
          limit_page_length: 500,
        }),
        ...withSilent(),
      }
    );
    logBudget("FETCH submitted POs — response", {
      count: rows?.length ?? 0,
      total: (rows ?? []).reduce((s, p) => s + (p.grand_total ?? 0), 0),
    });
    return rows ?? [];
  } catch (err) {
    logBudget("FETCH submitted POs — error", err);
    return [];
  }
}

/**
 * Compute live budget consumption from workflow:
 *   Consumed = Approved RFQ commitments (no PO yet) + Submitted PO value
 */
export async function computeBudgetConsumption(): Promise<BudgetConsumption> {
  logBudget("COMPUTE consumption — start");

  const [reviews, pos] = await Promise.all([
    fetchAllFinanceReviewRecords(),
    fetchSubmittedPurchaseOrders(),
  ]);

  const approvedRfqs = reviews.filter(
    (r) => r.finance_status === "Budget Approved"
  );
  const poRfqRefs = new Set(
    pos
      .map((p) => p.custom_rfq_reference?.trim())
      .filter((ref): ref is string => !!ref)
  );

  let approvedRfqValue = 0;
  const rfqsWithoutPo: string[] = [];

  for (const rfq of approvedRfqs) {
    if (poRfqRefs.has(rfq.rfq_name)) continue;
    approvedRfqValue += rfq.rfq_value ?? 0;
    rfqsWithoutPo.push(rfq.rfq_name);
  }

  const approvedPoValue = pos.reduce((s, p) => s + (p.grand_total ?? 0), 0);
  const consumedBudget = approvedRfqValue + approvedPoValue;

  const result: BudgetConsumption = {
    approvedRfqValue,
    approvedPoValue,
    consumedBudget,
    approvedRfqCount: rfqsWithoutPo.length,
    approvedPoCount: pos.length,
    rfqsWithoutPo,
  };

  logBudget("COMPUTE consumption — result", result);
  return result;
}

/* ─── KPIs ────────────────────────────────────────────────────────────────── */

export async function getBudgetKpis(): Promise<BudgetKpis> {
  logBudget("GET KPIs — start");
  const plans = getBudgetPlans();
  const approvals = getBudgetApprovals();
  const consumption = await computeBudgetConsumption();

  const totalBudget = plans
    .filter((p) => p.status === "Active")
    .reduce((s, p) => s + p.amount, 0);

  const consumedBudget = consumption.consumedBudget;
  const remainingBudget = Math.max(totalBudget - consumedBudget, 0);
  const utilizationPct =
    totalBudget > 0 ? Math.round((consumedBudget / totalBudget) * 100) : 0;

  const result: BudgetKpis = {
    totalBudget,
    consumedBudget,
    utilizedBudget: consumedBudget,
    remainingBudget,
    utilizationPct,
    approvedRfqValue: consumption.approvedRfqValue,
    approvedPoValue: consumption.approvedPoValue,
    activePlans: plans.filter((p) => p.status === "Active").length,
    pendingApprovals: approvals.filter((a) => a.status === "Pending").length,
  };

  logBudget("GET KPIs — response", result);
  return result;
}

/* ─── Monitoring rows ─────────────────────────────────────────────────────── */

export async function getDeptMonitoring(): Promise<DeptMonitorRow[]> {
  logBudget("GET dept monitoring — start");
  const plans = getBudgetPlans().filter(
    (p) => p.status === "Active" || p.status === "Exceeded"
  );
  const consumption = await computeBudgetConsumption();
  const deptMap = new Map<string, { allocated: number; consumed: number }>();

  for (const p of plans) {
    const existing = deptMap.get(p.department) ?? { allocated: 0, consumed: 0 };
    existing.allocated += p.amount;
    deptMap.set(p.department, existing);
  }

  const totalAllocated = [...deptMap.values()].reduce(
    (s, d) => s + d.allocated,
    0
  );

  const rows = [...deptMap.entries()].map(([department, d]) => {
    const consumed =
      totalAllocated > 0
        ? Math.round(
            consumption.consumedBudget * (d.allocated / totalAllocated)
          )
        : 0;
    const remaining = Math.max(d.allocated - consumed, 0);
    const pct =
      d.allocated > 0 ? Math.round((consumed / d.allocated) * 100) : 0;
    return {
      department,
      allocated: d.allocated,
      consumed,
      remaining,
      utilizationPct: pct,
      status:
        pct >= 100 ? ("Exceeded" as const) : pct >= 80 ? ("Warning" as const) : ("On Track" as const),
    };
  });

  logBudget("GET dept monitoring — response", { departments: rows.length, rows });
  return rows;
}

/* ─── Budget validation ─────────────────────────────────────────────────────── */

export const BUDGET_EXCEEDED_WARNING =
  "Budget Exceeded - Finance Approval Required";

/** Check whether an RFQ value fits within remaining budget. */
export async function checkBudgetForRFQ(
  rfqAmount: number
): Promise<BudgetCheckResult> {
  const kpis = await getBudgetKpis();
  const remaining = kpis.remainingBudget;
  const withinBudget = rfqAmount <= remaining;

  const result: BudgetCheckResult = {
    withinBudget,
    allocated: kpis.totalBudget,
    consumed: kpis.consumedBudget,
    remaining,
    poAmount: rfqAmount,
    overageAmount: withinBudget ? undefined : rfqAmount - remaining,
    warning: withinBudget ? undefined : BUDGET_EXCEEDED_WARNING,
  };

  logBudget("CHECK RFQ budget", { rfqAmount, ...result });
  return result;
}

export function checkBudgetForPO(
  department: string,
  poAmount: number
): BudgetCheckResult {
  const plans = getBudgetPlans().filter(
    (p) => p.status === "Active" && p.department === department
  );
  if (plans.length === 0) {
    logBudget("CHECK PO budget — no dept plan", { department, poAmount });
    return { withinBudget: true, poAmount };
  }

  const totalAllocated = plans.reduce((s, p) => s + p.amount, 0);
  const totalConsumed = plans.reduce((s, p) => s + p.consumed, 0);
  const remaining = totalAllocated - totalConsumed;
  const budgetName = plans[0].name;

  const result =
    poAmount <= remaining
      ? {
          withinBudget: true as const,
          budgetName,
          allocated: totalAllocated,
          consumed: totalConsumed,
          remaining,
          poAmount,
        }
      : {
          withinBudget: false as const,
          budgetName,
          allocated: totalAllocated,
          consumed: totalConsumed,
          remaining,
          poAmount,
          overageAmount: poAmount - remaining,
          warning: BUDGET_EXCEEDED_WARNING,
        };

  logBudget("CHECK PO budget (dept plan)", { department, ...result });
  return result;
}

/* ─── Seed data ───────────────────────────────────────────────────────────── */

function seedPlans(): BudgetPlan[] {
  const now = new Date().toISOString();
  const plans: BudgetPlan[] = [
    {
      id: "seed-1",
      name: "IT Equipment Budget",
      fiscalYear: "2025-2026",
      department: "IT",
      amount: 240000,
      currency: "USD",
      consumed: 0,
      status: "Active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-2",
      name: "Office Supplies Budget",
      fiscalYear: "2025-2026",
      department: "Administration",
      amount: 85000,
      currency: "USD",
      consumed: 0,
      status: "Active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-3",
      name: "Marketing Budget",
      fiscalYear: "2025-2026",
      department: "Marketing",
      amount: 150000,
      currency: "USD",
      consumed: 0,
      status: "Active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-4",
      name: "Manufacturing Materials",
      fiscalYear: "2025-2026",
      department: "Production",
      amount: 500000,
      currency: "USD",
      consumed: 0,
      status: "Active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-5",
      name: "R&D Equipment",
      fiscalYear: "2025-2026",
      department: "R&D",
      amount: 200000,
      currency: "USD",
      consumed: 0,
      status: "Active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-6",
      name: "HR Training Budget",
      fiscalYear: "2024-2025",
      department: "HR",
      amount: 75000,
      currency: "USD",
      consumed: 0,
      status: "Closed",
      createdAt: now,
      updatedAt: now,
    },
  ];
  persist(plans);
  logBudget("SEED plans", { count: plans.length });
  return plans;
}
