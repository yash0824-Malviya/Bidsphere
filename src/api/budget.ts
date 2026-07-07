/**
 * Budget Management API
 *
 * ERPNext Budget DocType is the SINGLE SOURCE OF TRUTH.
 * No localStorage plans, seeds, or mock data.
 *
 * Remaining Budget = ERPNext Budget Amount − Actual Expense (live)
 */

import {
  approveBudget,
  cancelBudget,
  createBudget,
  fetchApprovedBudgets,
  fetchBudgetByName,
  fetchBudgetComments,
  fetchBudgetNamingSeries,
  fetchBudgets,
  fetchCompanies,
  fetchCompanyCurrency,
  fetchCostCenters,
  fetchExpenseAccounts,
  fetchFiscalYears,
  fetchFiscalYearDetails,
  fetchMonthlyDistributions,
  fetchMyBudgets,
  fetchPendingApprovalBudgets,
  fetchProjects,
  findDuplicateBudget,
  getActiveBudgetPool,
  getBudgetUtilization,
  isBudgetAvailableForProcurement,
  logErpBudget,
  mapBudgetStatus,
  rejectBudget,
  submitBudget,
  updateDraftBudget,
  getBudgetFiscalYear,
  getBudgetAmount,
  getBudgetAccountName,
  type BudgetAgainst,
  type BudgetListItem,
  type BudgetUtilization,
  type BudgetWorkflowStatus,
  type CompanyOption,
  type CreateBudgetInput,
  type ErpBudgetRecord,
  type UpdateBudgetInput,
} from "./erpBudget";
import { fetchSubmittedPurchaseOrders } from "./budgetConsumption";
import { fetchAllFinanceReviewRecords } from "./financeReviews";
import { getMaterialRequest } from "./purchasing";
import { apiGet, buildListConfig, buildResourceUrl, withSilent } from "./erpnext";
import type { AppRole } from "../config/roles";
import type { RFQ } from "../types/erpnext";

export type {
  BudgetAgainst,
  BudgetListItem,
  BudgetUtilization,
  BudgetWorkflowStatus,
  CompanyOption,
  CreateBudgetInput,
  ErpBudgetRecord,
  UpdateBudgetInput,
};

/** @deprecated Use BudgetListItem — kept for page compatibility during migration */
export interface BudgetPlan {
  id: string;
  name: string;
  fiscalYear: string;
  department: string;
  amount: number;
  currency: string;
  consumed: number;
  status: BudgetWorkflowStatus;
  createdAt: string;
  updatedAt: string;
  owner?: string;
  erpName?: string;
}

export interface BudgetApproval {
  id: string;
  budgetName: string;
  costCenter?: string;
  fiscalYear: string;
  budgetAmount: number;
  requestedBy: string;
  status: BudgetWorkflowStatus;
  createdAt: string;
  submittedAt?: string;
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
  utilizedBudget: number;
  remainingBudget: number;
  utilizationPct: number;
  approvedRfqValue: number;
  approvedPoValue: number;
  activePlans: number;
  pendingApprovals: number;
  draftCount: number;
  rejectedCount: number;
  totalRequested: number;
  approvedCount?: number;
  activeCount?: number;
  totalApprovedBudget?: number;
  overBudgetDepartments?: number;
  expiringBudgets?: number;
}

export interface ActiveBudgetMonitorRow extends DeptMonitorRow {
  budgetId: string;
  company: string;
  fiscalYear: string;
  costCenter?: string;
  account?: string;
}

export interface BudgetActivityItem {
  id: string;
  budgetName: string;
  event: string;
  user: string;
  date: string;
  detail?: string;
  status: BudgetWorkflowStatus;
}

export interface BudgetTimelineEvent {
  event: string;
  user: string;
  date: string;
  comment?: string;
}

export interface FinanceManagerDashboardData {
  kpis: {
    pendingApprovals: number;
    approvedCount: number;
    activeCount: number;
    rejectedCount: number;
    totalApprovedBudget: number;
    utilizationPct: number;
    overBudgetDepartments: number;
    expiringBudgets: number;
  };
  departmentUtilization: Array<{
    department: string;
    allocated: number;
    consumed: number;
    utilizationPct: number;
  }>;
  budgetVsActual: Array<{ label: string; budget: number; actual: number }>;
  monthlyConsumption: Array<{ month: string; amount: number }>;
  statusDistribution: Array<{ name: string; value: number; color: string }>;
  recentActivity: BudgetActivityItem[];
}

const STATUS_CHART_COLORS: Record<string, string> = {
  Draft: "#94a3b8",
  Submitted: "#f59e0b",
  Approved: "#22c55e",
  Active: "#059669",
  Rejected: "#ef4444",
  Cancelled: "#cbd5e1",
};

function activityEventLabel(status: BudgetWorkflowStatus): string {
  switch (status) {
    case "Draft":
      return "Budget Created";
    case "Submitted":
      return "Budget Submitted";
    case "Approved":
      return "Budget Approved";
    case "Active":
      return "Budget Activated";
    case "Rejected":
      return "Budget Rejected";
    case "Cancelled":
      return "Budget Cancelled";
    default:
      return "Budget Updated";
  }
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
  utilizationPct?: number;
  forecastUtilizationPct?: number;
  availableBudget?: number;
}

export const BUDGET_EXCEEDED_WARNING =
  "Budget Exceeded - Finance Approval Required";

export function logBudget(operation: string, data?: unknown): void {
  logErpBudget(operation, data);
}

function listItemToPlan(item: BudgetListItem, utilization?: BudgetUtilization): BudgetPlan {
  return {
    id: item.name,
    erpName: item.name,
    name: item.name,
    fiscalYear: item.fiscal_year,
    department: item.cost_center ?? "—",
    amount: item.budget_amount,
    currency: "USD",
    consumed: utilization?.actualExpense ?? 0,
    status: item.status,
    createdAt: item.creation,
    updatedAt: item.modified,
    owner: item.owner,
  };
}

/* ─── Role helpers ────────────────────────────────────────────────────────── */

export function canApproveBudget(role: AppRole | undefined): boolean {
  return role === "finance" || role === "admin";
}

export function canCreateBudget(role: AppRole | undefined): boolean {
  return role === "finance_executive";
}

export function isFinanceExecutive(role: AppRole | undefined): boolean {
  return role === "finance_executive";
}

export function canCancelBudget(role: AppRole | undefined): boolean {
  return role === "finance" || role === "admin";
}

/* ─── Re-export ERPNext CRUD ──────────────────────────────────────────────── */

export {
  approveBudget,
  cancelBudget,
  createBudget,
  fetchApprovedBudgets,
  fetchBudgetByName,
  fetchBudgetComments,
  fetchBudgetNamingSeries,
  fetchBudgets,
  fetchCompanies,
  fetchCompanyCurrency,
  fetchCostCenters,
  fetchExpenseAccounts,
  fetchFiscalYears,
  fetchFiscalYearDetails,
  fetchMonthlyDistributions,
  fetchMyBudgets,
  fetchPendingApprovalBudgets,
  fetchProjects,
  findDuplicateBudget,
  getBudgetAmount,
  getBudgetAccountName,
  getBudgetFiscalYear,
  getBudgetUtilization,
  isBudgetAvailableForProcurement,
  mapBudgetStatus,
  rejectBudget,
  submitBudget,
  updateDraftBudget,
};

/* ─── Plans (ERPNext-backed) ──────────────────────────────────────────────── */

export async function getBudgetPlans(): Promise<BudgetPlan[]> {
  const items = await fetchBudgets();
  logBudget("GET plans (ERPNext)", { count: items.length });
  return items.map((item) => listItemToPlan(item));
}

export async function createBudgetPlan(
  input: Omit<BudgetPlan, "id" | "consumed" | "status" | "createdAt" | "updatedAt"> & {
    account?: string;
  }
): Promise<BudgetPlan> {
  const created = await createBudget({
    cost_center: input.department,
    fiscal_year: input.fiscalYear,
    account: input.account ?? "Expenses - " + (input.department.split(" - ")[0] || "I"),
    budget_amount: input.amount,
  });
  const item = {
    name: created.name,
    company: created.company,
    cost_center: created.cost_center,
    fiscal_year: getBudgetFiscalYear(created),
    budget_amount: getBudgetAmount(created),
    status: mapBudgetStatus(created),
    owner: created.owner,
    creation: created.creation,
    modified: created.modified,
    workflow_state: created.workflow_state,
    docstatus: created.docstatus,
  };
  return listItemToPlan(item);
}

export async function updateBudgetPlan(
  id: string,
  updates: Partial<
    Pick<BudgetPlan, "name" | "fiscalYear" | "department" | "amount" | "status"> & {
      account?: string;
    }
  >
): Promise<BudgetPlan | null> {
  try {
    const updated = await updateDraftBudget(id, {
      cost_center: updates.department,
      fiscal_year: updates.fiscalYear,
      budget_amount: updates.amount,
      account: updates.account,
    });
    return listItemToPlan({
      name: updated.name,
      company: updated.company,
      cost_center: updated.cost_center,
      fiscal_year: getBudgetFiscalYear(updated),
      budget_amount: getBudgetAmount(updated),
      status: mapBudgetStatus(updated),
      owner: updated.owner,
      creation: updated.creation,
      modified: updated.modified,
      workflow_state: updated.workflow_state,
      docstatus: updated.docstatus,
    });
  } catch {
    return null;
  }
}

export async function deleteBudgetPlan(id: string): Promise<boolean> {
  try {
    await cancelBudget(id);
    return true;
  } catch {
    return false;
  }
}

/* ─── Approvals (ERPNext workflow-backed) ─────────────────────────────────── */

export async function getBudgetApprovals(): Promise<BudgetApproval[]> {
  const pending = await fetchPendingApprovalBudgets();
  const all = await fetchBudgets();
  const history = all.filter(
    (b) => b.status === "Approved" || b.status === "Active" || b.status === "Rejected"
  );

  const map = (item: BudgetListItem): BudgetApproval => ({
    id: item.name,
    budgetName: item.name,
    costCenter: item.cost_center,
    fiscalYear: item.fiscal_year,
    budgetAmount: item.budget_amount,
    requestedBy: item.owner,
    status: item.status,
    createdAt: item.creation,
    submittedAt: item.status !== "Draft" ? item.modified : undefined,
    resolvedAt:
      item.status === "Approved" || item.status === "Active" || item.status === "Rejected"
        ? item.modified
        : undefined,
  });

  return [...pending, ...history].map(map);
}

export async function resolveBudgetApproval(
  id: string,
  action: "Approved" | "Rejected" | "Revision Requested",
  resolvedBy: string,
  notes?: string
): Promise<BudgetApproval | null> {
  if (action === "Approved") {
    await approveBudget(id, notes);
  } else if (action === "Rejected") {
    await rejectBudget(id, notes);
  } else {
    await rejectBudget(id, notes ?? "Revision requested");
  }

  const item = (await fetchBudgets()).find((b) => b.name === id);
  if (!item) return null;

  return {
    id: item.name,
    budgetName: item.name,
    costCenter: item.cost_center,
    fiscalYear: item.fiscal_year,
    budgetAmount: item.budget_amount,
    requestedBy: item.owner,
    status: item.status,
    createdAt: item.creation,
    resolvedAt: new Date().toISOString(),
    resolvedBy,
    notes,
  };
}

/* ─── Consumption ─────────────────────────────────────────────────────────── */

export async function computeBudgetConsumption(): Promise<BudgetConsumption> {
  const [reviewsResult, pos] = await Promise.all([
    fetchAllFinanceReviewRecords(),
    fetchSubmittedPurchaseOrders(),
  ]);
  const reviews = reviewsResult.items;

  const approvedRfqs = reviews.filter((r) => r.finance_status === "Budget Approved");
  const poRfqRefs = new Set(
    pos.map((p) => p.custom_rfq_reference?.trim()).filter((ref): ref is string => !!ref)
  );

  let approvedRfqValue = 0;
  const rfqsWithoutPo: string[] = [];

  for (const rfq of approvedRfqs) {
    if (poRfqRefs.has(rfq.rfq_name)) continue;
    approvedRfqValue += rfq.rfq_value ?? 0;
    rfqsWithoutPo.push(rfq.rfq_name);
  }

  const approvedPoValue = pos.reduce((s, p) => s + (p.grand_total ?? 0), 0);

  return {
    approvedRfqValue,
    approvedPoValue,
    consumedBudget: approvedRfqValue + approvedPoValue,
    approvedRfqCount: rfqsWithoutPo.length,
    approvedPoCount: pos.length,
    rfqsWithoutPo,
  };
}

/* ─── KPIs ────────────────────────────────────────────────────────────────── */

export async function getBudgetKpis(): Promise<BudgetKpis> {
  const [pool, allBudgets, consumption] = await Promise.all([
    getActiveBudgetPool(),
    fetchBudgets(),
    computeBudgetConsumption(),
  ]);

  const pendingApprovals = allBudgets.filter((b) => b.status === "Submitted").length;
  const draftCount = allBudgets.filter((b) => b.status === "Draft").length;
  const rejectedCount = allBudgets.filter((b) => b.status === "Rejected").length;
  const totalRequested = allBudgets
    .filter((b) => b.status !== "Draft" && b.status !== "Rejected" && b.status !== "Cancelled")
    .reduce((s, b) => s + b.budget_amount, 0);

  return {
    totalBudget: pool.totalBudget,
    consumedBudget: pool.actualExpense,
    utilizedBudget: pool.actualExpense,
    remainingBudget: pool.remainingBudget,
    utilizationPct: pool.utilizationPct,
    approvedRfqValue: consumption.approvedRfqValue,
    approvedPoValue: consumption.approvedPoValue,
    activePlans: allBudgets.filter((b) => isBudgetAvailableForProcurement(b.status)).length,
    pendingApprovals,
    draftCount,
    rejectedCount,
    totalRequested,
  };
}

/* ─── Monitoring ──────────────────────────────────────────────────────────── */

export async function getDeptMonitoring(): Promise<DeptMonitorRow[]> {
  const approved = await fetchApprovedBudgets();
  const rows: DeptMonitorRow[] = [];

  for (const item of approved) {
    const util = await getBudgetUtilization(item.name);
    const pct = util.utilizationPct;
    rows.push({
      department: item.cost_center ?? item.name,
      allocated: util.budgetAmount,
      consumed: util.actualExpense,
      remaining: util.remainingBudget,
      utilizationPct: pct,
      status:
        pct >= 100 ? "Exceeded" : pct >= 80 ? "Warning" : "On Track",
    });
  }

  return rows;
}

export async function getActiveBudgetMonitoring(): Promise<ActiveBudgetMonitorRow[]> {
  const active = (await fetchBudgets()).filter((b) => b.status === "Active");
  const rows: ActiveBudgetMonitorRow[] = [];

  for (const item of active) {
    const util = await getBudgetUtilization(item.name);
    const pct = util.utilizationPct;
    rows.push({
      budgetId: item.name,
      company: item.company,
      fiscalYear: item.fiscal_year,
      costCenter: item.cost_center,
      account: item.account,
      department: item.cost_center ?? item.project ?? item.name,
      allocated: util.budgetAmount,
      consumed: util.actualExpense,
      remaining: util.remainingBudget,
      utilizationPct: pct,
      status: pct >= 100 ? "Exceeded" : pct >= 80 ? "Warning" : "On Track",
    });
  }

  return rows;
}

export async function getBudgetTimeline(budgetName: string): Promise<BudgetTimelineEvent[]> {
  const [budget, comments] = await Promise.all([
    fetchBudgetByName(budgetName),
    fetchBudgetComments(budgetName),
  ]);
  const status = mapBudgetStatus(budget);
  const events: BudgetTimelineEvent[] = [
    {
      event: "Budget Created",
      user: budget.owner,
      date: budget.creation,
    },
  ];

  if (status !== "Draft") {
    events.push({
      event: "Submitted for Approval",
      user: budget.owner,
      date: budget.modified,
    });
  }

  if (status === "Approved" || status === "Active") {
    events.push({
      event: "Approved",
      user: budget.modified_by ?? "Finance Manager",
      date: budget.modified,
    });
  }

  if (status === "Active") {
    events.push({
      event: "Activated",
      user: budget.modified_by ?? "Finance Manager",
      date: budget.modified,
    });
  }

  if (status === "Rejected") {
    events.push({
      event: "Rejected",
      user: budget.modified_by ?? "Finance Manager",
      date: budget.modified,
    });
  }

  if (status === "Cancelled") {
    events.push({
      event: "Cancelled",
      user: budget.modified_by ?? "Finance Manager",
      date: budget.modified,
    });
  }

  for (const c of comments) {
    events.push({
      event: "Comment",
      user: c.by,
      date: c.creation,
      comment: c.comment,
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getFinanceManagerDashboard(): Promise<FinanceManagerDashboardData> {
  const [allBudgets, fiscalYears, pos] = await Promise.all([
    fetchBudgets(),
    fetchFiscalYearDetails(),
    fetchSubmittedPurchaseOrders(),
  ]);

  const pendingApprovals = allBudgets.filter((b) => b.status === "Submitted").length;
  const approvedCount = allBudgets.filter((b) => b.status === "Approved").length;
  const activeCount = allBudgets.filter((b) => b.status === "Active").length;
  const rejectedCount = allBudgets.filter((b) => b.status === "Rejected").length;

  const approvedAndActive = allBudgets.filter(
    (b) => b.status === "Approved" || b.status === "Active"
  );
  const totalApprovedBudget = approvedAndActive.reduce((s, b) => s + b.budget_amount, 0);

  const activeForUtil = allBudgets.filter((b) => b.status === "Active");
  const utilizations = await Promise.all(
    activeForUtil.map((b) => getBudgetUtilization(b.name))
  );

  const totalBudget = utilizations.reduce((s, u) => s + u.budgetAmount, 0);
  const totalActual = utilizations.reduce((s, u) => s + u.actualExpense, 0);
  const utilizationPct =
    totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;

  const departmentUtilization = utilizations.map((u) => ({
    department: u.costCenter ?? u.budgetName,
    allocated: u.budgetAmount,
    consumed: u.actualExpense,
    utilizationPct: u.utilizationPct,
  }));

  const overBudgetDepartments = departmentUtilization.filter(
    (d) => d.utilizationPct > 100
  ).length;

  const now = Date.now();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  const expiringFyNames = new Set(
    fiscalYears
      .filter((fy) => {
        if (!fy.year_end_date) return false;
        const end = new Date(fy.year_end_date).getTime();
        return end > now && end - now <= ninetyDays;
      })
      .map((fy) => fy.name)
  );
  const expiringBudgets = allBudgets.filter(
    (b) =>
      (b.status === "Active" || b.status === "Approved") &&
      expiringFyNames.has(b.fiscal_year)
  ).length;

  const budgetVsActual = utilizations.slice(0, 8).map((u) => ({
    label: (u.costCenter ?? u.budgetName).slice(0, 16),
    budget: u.budgetAmount,
    actual: u.actualExpense,
  }));

  const monthMap = new Map<string, number>();
  for (const po of pos) {
    if (!po.transaction_date || !po.grand_total) continue;
    const month = po.transaction_date.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + po.grand_total);
  }
  const monthlyConsumption = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, amount]) => ({
      month,
      amount,
    }));

  const statusBuckets: Record<string, number> = {};
  for (const b of allBudgets) {
    statusBuckets[b.status] = (statusBuckets[b.status] ?? 0) + 1;
  }
  const statusDistribution = Object.entries(statusBuckets)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({
      name,
      value,
      color: STATUS_CHART_COLORS[name] ?? "#64748b",
    }));

  const recentActivity: BudgetActivityItem[] = [...allBudgets]
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, 12)
    .map((b) => ({
      id: `${b.name}-${b.modified}`,
      budgetName: b.name,
      event: activityEventLabel(b.status),
      user: b.owner,
      date: b.modified,
      detail: `${b.cost_center ?? b.project ?? "—"} · ${b.fiscal_year}`,
      status: b.status,
    }));

  return {
    kpis: {
      pendingApprovals,
      approvedCount,
      activeCount,
      rejectedCount,
      totalApprovedBudget,
      utilizationPct,
      overBudgetDepartments,
      expiringBudgets,
    },
    departmentUtilization,
    budgetVsActual,
    monthlyConsumption,
    statusDistribution,
    recentActivity,
  };
}

export type RfqBudgetStatus = "Within Budget" | "Near Limit" | "Exceeded";

export function classifyRfqBudgetStatus(
  remaining: number | null | undefined,
  rfqAmount: number,
  utilizationPct: number | null | undefined
): RfqBudgetStatus {
  const safeRemaining = remaining ?? 0;
  const safeUtil = utilizationPct ?? 0;
  if (rfqAmount > safeRemaining) return "Exceeded";
  if (safeUtil >= 80 || rfqAmount > safeRemaining * 0.5) return "Near Limit";
  return "Within Budget";
}

export async function getRfqBudgetCheckDetail(rfqAmount: number): Promise<
  BudgetCheckResult & { rfqAmount: number; remainingAfterRfq: number; budgetStatus: RfqBudgetStatus }
> {
  const check = await checkBudgetForRFQ(rfqAmount);
  const remaining = check.remaining ?? 0;
  const remainingAfterRfq = Math.max(remaining - rfqAmount, 0);
  const budgetStatus = classifyRfqBudgetStatus(
    remaining,
    rfqAmount,
    check.utilizationPct ?? 0
  );
  return { ...check, rfqAmount, remainingAfterRfq, budgetStatus };
}

export async function checkBudgetForRFQ(
  rfqAmount: number
): Promise<BudgetCheckResult> {
  const pool = await getActiveBudgetPool();
  const remaining = pool.remainingBudget ?? 0;
  const withinBudget = rfqAmount <= remaining;

  return {
    withinBudget,
    allocated: pool.totalBudget,
    consumed: pool.actualExpense,
    remaining,
    poAmount: rfqAmount,
    overageAmount: withinBudget ? undefined : rfqAmount - remaining,
    warning: withinBudget ? undefined : BUDGET_EXCEEDED_WARNING,
    utilizationPct: pool.utilizationPct,
    forecastUtilizationPct:
      pool.totalBudget > 0
        ? Math.round(((pool.actualExpense + rfqAmount) / pool.totalBudget) * 100)
        : 0,
    availableBudget: remaining,
  };
}

/* ─── Cost-Center-scoped RFQ budget check (Finance Review workspace) ────────
 *
 * The RFQ DocType itself carries no Department/Cost Center — those live on
 * the Material Request each RFQ item was raised from. This resolves the
 * real Cost Center (and Department, when set) for an RFQ, then finds the
 * ERPNext Budget document actually governing that Cost Center — never a
 * generic company-wide pool — so "Budget Available" and "Spend Forecast"
 * always reflect the specific department the spend belongs to.
 * ────────────────────────────────────────────────────────────────────────── */

export interface RfqCostCenterInfo {
  costCenter?: string;
  department?: string;
  company?: string;
}

/** Resolve an RFQ's Cost Center/Department via its items' Material Requests. */
export async function resolveRfqCostCenter(rfq: RFQ): Promise<RfqCostCenterInfo> {
  const mrNames = Array.from(
    new Set(
      (rfq.items ?? [])
        .map((i) => i.material_request)
        .filter((v): v is string => !!v && v.trim().length > 0)
    )
  );

  if (mrNames.length === 0) {
    return { company: rfq.company };
  }

  const mrDocs = await Promise.all(
    mrNames.map((name) => getMaterialRequest(name).catch(() => null))
  );

  let department: string | undefined;
  const costCenterVotes = new Map<string, number>();

  for (const mr of mrDocs) {
    if (!mr) continue;
    if (!department) {
      department = mr.department || mr.custom_department || undefined;
    }
    if (mr.cost_center) {
      costCenterVotes.set(mr.cost_center, (costCenterVotes.get(mr.cost_center) ?? 0) + 1);
    }
    for (const item of mr.items ?? []) {
      if (item.cost_center) {
        costCenterVotes.set(item.cost_center, (costCenterVotes.get(item.cost_center) ?? 0) + 1);
      }
    }
  }

  let costCenter: string | undefined;
  let bestVotes = 0;
  for (const [cc, votes] of costCenterVotes) {
    if (votes > bestVotes) {
      bestVotes = votes;
      costCenter = cc;
    }
  }

  return { costCenter, department, company: rfq.company };
}

/**
 * Finds the single ERPNext Budget document governing a Cost Center that is
 * actually available for procurement (workflow status "Approved" or
 * "Active" — never Draft/Submitted/Rejected/Cancelled). When more than one
 * qualifies (e.g. multiple fiscal years), prefers "Active" over "Approved",
 * then the most recently modified.
 */
export async function findActiveBudgetForCostCenter(
  costCenter: string,
  company?: string
): Promise<(BudgetUtilization & { budgetName: string; budgetAccount?: string; status: BudgetWorkflowStatus }) | null> {
  const all = await fetchBudgets({ limit: 500 });
  const candidates = all.filter(
    (b) =>
      b.cost_center === costCenter &&
      isBudgetAvailableForProcurement(b.status) &&
      (!company || b.company === company)
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.status !== b.status) return a.status === "Active" ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  });

  const chosen = candidates[0];
  const util = await getBudgetUtilization(chosen.name);
  return { ...util, budgetName: chosen.name, budgetAccount: chosen.account, status: chosen.status };
}

/** Leading segment of a Cost Center name → department (e.g. "Marketing - NL" → "Marketing"). */
function departmentFromCostCenter(costCenter?: string | null): string {
  const src = (costCenter || "").trim();
  if (!src) return "";
  return src.split(" - ")[0].trim();
}

/**
 * Fallback budget resolver by Department. Material Requests in this app carry a
 * Department (`custom_department`) but frequently no explicit Cost Center, so we
 * match an Approved/Active ERPNext Budget whose governing Cost Center belongs to
 * that department (leading name segment, or contains the department name).
 */
export async function findActiveBudgetForDepartment(
  department: string,
  company?: string
): Promise<(BudgetUtilization & { budgetName: string; budgetAccount?: string; status: BudgetWorkflowStatus }) | null> {
  const dept = (department || "").trim().toLowerCase();
  if (!dept) return null;
  const all = await fetchBudgets({ limit: 500 });
  const candidates = all.filter(
    (b) =>
      !!b.cost_center &&
      isBudgetAvailableForProcurement(b.status) &&
      (!company || b.company === company) &&
      (departmentFromCostCenter(b.cost_center).toLowerCase() === dept ||
        b.cost_center!.toLowerCase().includes(dept))
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.status !== b.status) return a.status === "Active" ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  });

  const chosen = candidates[0];
  const util = await getBudgetUtilization(chosen.name);
  return { ...util, budgetName: chosen.name, budgetAccount: chosen.account, status: chosen.status };
}

/** The ERPNext Fiscal Year covering today (fallback: most recent enabled year). */
export async function getCurrentFiscalYear(): Promise<string | undefined> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const rows = await apiGet<Array<{ name: string }>>(
      buildResourceUrl("Fiscal Year"),
      withSilent(
        buildListConfig({
          fields: ["name"],
          filters: [
            ["year_start_date", "<=", today],
            ["year_end_date", ">=", today],
          ],
          limit_page_length: 1,
        })
      )
    );
    if (rows?.[0]?.name) return rows[0].name;
  } catch {
    /* fall through to the list-based fallback */
  }
  try {
    const all = await fetchFiscalYears();
    return all[0];
  } catch {
    return undefined;
  }
}

export type BudgetForecastStatus = "Green" | "Yellow" | "Red";

export interface RfqCostCenterBudgetCheck {
  found: boolean;
  costCenter?: string;
  department?: string;
  company?: string;
  budgetName?: string;
  budgetAccount?: string;
  fiscalYear?: string;
  allocatedBudget?: number;
  actualSpend?: number;
  remainingBudget?: number;
  availableBudget?: number;
  rfqValue: number;
  forecastSpend?: number;
  /** Utilization BEFORE this RFQ is committed. */
  budgetUtilizationPct?: number;
  /** Utilization AFTER this RFQ is committed — (Current Spend + RFQ Value) / Allocated Budget. */
  spendForecastPct?: number;
  /** Remaining budget after this RFQ is committed — negative means it would exceed the budget. */
  forecastImpact?: number;
  forecastStatus?: BudgetForecastStatus;
  withinBudget?: boolean;
  /** Populated only when `found` is false — the exact ERPNext-driven reason, never a generic message. */
  noBudgetMessage?: string;
}

function classifyForecastStatus(spendForecastPct: number): BudgetForecastStatus {
  if (spendForecastPct > 90) return "Red";
  if (spendForecastPct >= 70) return "Yellow";
  return "Green";
}

/**
 * Cost-Center-scoped budget check for a specific RFQ — the data source for
 * the Finance Review workspace's "Budget Availability & Spend Forecast"
 * section. Every figure comes from ERPNext: the Budget document governing
 * the RFQ's actual Cost Center, and the live actual-expense/commitment
 * figures for that same Cost Center. If no active Budget governs that Cost
 * Center, returns `found: false` with the exact reason instead of a generic
 * "unavailable" placeholder.
 */
export async function getRfqBudgetCheckByCostCenter(
  rfq: RFQ,
  rfqAmount: number
): Promise<RfqCostCenterBudgetCheck> {
  const info = await resolveRfqCostCenter(rfq);
  const company = info.company;

  // 1) Prefer a Budget governing the RFQ's explicit Cost Center.
  let match = info.costCenter
    ? await findActiveBudgetForCostCenter(info.costCenter, company)
    : null;
  let costCenter = info.costCenter;

  // 2) Fall back to a department-scoped Budget when the MR chain carries a
  //    Department but no Cost Center (the common case in this workflow).
  if (!match && info.department) {
    const byDept = await findActiveBudgetForDepartment(info.department, company);
    if (byDept) {
      match = byDept;
      costCenter = byDept.costCenter ?? costCenter;
    }
  }

  if (!match) {
    const fiscalYear = await getCurrentFiscalYear();
    let reason: string;
    if (!costCenter && !info.department) {
      reason =
        "This RFQ's Material Requests have no Department or Cost Center assigned in ERPNext.";
    } else if (!costCenter) {
      reason = `No Cost Center is mapped to the "${info.department}" department, and no Approved/Active Budget matches it.`;
    } else {
      reason = `No Approved or Active ERPNext Budget governs Cost Center "${costCenter}"${
        fiscalYear ? ` for ${fiscalYear}` : ""
      }.`;
    }
    return {
      found: false,
      costCenter,
      department: info.department,
      company,
      fiscalYear,
      rfqValue: rfqAmount,
      noBudgetMessage: reason,
    };
  }

  const resolvedCostCenter = costCenter ?? match.costCenter;
  const allocatedBudget = match.budgetAmount;
  const actualSpend = match.actualExpense;
  const remainingBudget = match.remainingBudget;
  const forecastSpend = actualSpend + rfqAmount;
  const budgetUtilizationPct =
    allocatedBudget > 0 ? Math.round((actualSpend / allocatedBudget) * 100) : 0;
  const spendForecastPct =
    allocatedBudget > 0 ? Math.round((forecastSpend / allocatedBudget) * 100) : 0;
  const forecastImpact = remainingBudget - rfqAmount;

  return {
    found: true,
    costCenter: resolvedCostCenter,
    department: info.department || departmentFromCostCenter(resolvedCostCenter) || undefined,
    company,
    budgetName: match.budgetName,
    budgetAccount: match.budgetAccount,
    fiscalYear: match.fiscalYear,
    allocatedBudget,
    actualSpend,
    remainingBudget,
    availableBudget: remainingBudget,
    rfqValue: rfqAmount,
    forecastSpend,
    budgetUtilizationPct,
    spendForecastPct,
    forecastImpact,
    forecastStatus: classifyForecastStatus(spendForecastPct),
    withinBudget: forecastImpact >= 0,
  };
}

export async function checkBudgetForPO(
  department: string,
  poAmount: number
): Promise<BudgetCheckResult> {
  const approved = await fetchApprovedBudgets();
  const match = approved.find((b) => b.cost_center === department);
  if (!match) {
    return checkBudgetForRFQ(poAmount);
  }
  const util = await getBudgetUtilization(match.name);
  const remaining = util.remainingBudget ?? 0;
  const withinBudget = poAmount <= remaining;
  return {
    withinBudget,
    budgetName: match.name,
    allocated: util.budgetAmount,
    consumed: util.actualExpense,
    remaining: util.remainingBudget,
    poAmount,
    overageAmount: withinBudget ? undefined : poAmount - util.remainingBudget,
    warning: withinBudget ? undefined : BUDGET_EXCEEDED_WARNING,
    utilizationPct: util.utilizationPct,
    availableBudget: util.remainingBudget,
  };
}
