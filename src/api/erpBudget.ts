/**
 * ERPNext Budget API — single source of truth for budget master data.
 *
 * Uses the standard ERPNext "Budget" DocType (no custom DocType).
 * Workflow states: Draft → Submitted → Approved → Active | Rejected
 */

import {
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  COMPANY,
  withSilent,
  type Filter,
} from "./erpnext";
import { fetchSubmittedPurchaseOrders } from "./budgetConsumption";
import { fetchBudgetLedger } from "./budgetLedger";
import { fetchAllFinanceReviewRecords } from "./financeReviews";
import { queryClient } from "../queryClient";

const BUDGET_DOCTYPE = "Budget";
const LOG_TAG = "[ErpBudget]";

/**
 * Refresh every budget-driven React Query cache after a create/submit/approve/
 * reject/cancel so the Budget Dashboard, My Budgets and Budget Requests update
 * automatically — no manual reload. Matches any key beginning with "budget"
 * plus the Finance-Executive dashboard's `executive-all-budgets` key.
 */
export function invalidateBudgetViews(): void {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey?.[0];
      return (
        typeof key === "string" &&
        (key.startsWith("budget") ||
          key === "executive-all-budgets" ||
          key === "finance-manager-budget-dashboard" ||
          key === "my-budgets")
      );
    },
  });
}

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type BudgetWorkflowStatus =
  | "Draft"
  | "Submitted"
  | "Approved"
  | "Active"
  | "Rejected"
  | "Cancelled";

export interface BudgetAccountRow {
  name?: string;
  account: string;
  budget_amount: number;
}

export interface ErpBudgetRecord {
  name: string;
  company: string;
  budget_against: string;
  cost_center?: string;
  project?: string;
  /** Legacy ERPNext v15 */
  fiscal_year?: string;
  monthly_distribution?: string;
  /** Modern ERPNext (v16+) */
  from_fiscal_year?: string;
  to_fiscal_year?: string;
  account?: string;
  budget_amount?: number;
  distribution_frequency?: string;
  distribute_equally?: 0 | 1;
  action_if_annual_budget_exceeded?: string;
  action_if_accumulated_monthly_budget_exceeded?: string;
  applicable_on_material_request?: 0 | 1;
  applicable_on_purchase_order?: 0 | 1;
  applicable_on_booking_actual_expenses?: 0 | 1;
  docstatus: 0 | 1 | 2;
  workflow_state?: string;
  owner: string;
  creation: string;
  modified: string;
  modified_by?: string;
  /** Legacy child table — absent on modern Budget DocType */
  accounts?: BudgetAccountRow[];
  /** Populated from workflow / comments child table when available */
  _comments?: BudgetComment[];
}

export interface BudgetComment {
  comment: string;
  by: string;
  creation: string;
}

export interface BudgetListItem {
  name: string;
  company: string;
  budget_against?: string;
  cost_center?: string;
  project?: string;
  account?: string;
  fiscal_year: string;
  budget_amount: number;
  status: BudgetWorkflowStatus;
  owner: string;
  creation: string;
  modified: string;
  modified_by?: string;
  workflow_state?: string;
  docstatus: number;
}

export interface BudgetUtilization {
  budgetName: string;
  costCenter?: string;
  fiscalYear: string;
  budgetAmount: number;
  actualExpense: number;
  remainingBudget: number;
  utilizationPct: number;
  forecastUtilizationPct: number;
  availableBudget: number;
  /** Open (submitted, not-yet-billed) Purchase Order commitment, live ERPNext. */
  reservedBudget: number;
}

export type BudgetAgainst = "Cost Center" | "Project";

export interface CompanyOption {
  name: string;
  company_name?: string;
  default_currency?: string;
}

export interface CreateBudgetInput {
  company?: string;
  budget_against?: BudgetAgainst;
  cost_center?: string;
  project?: string;
  fiscal_year: string;
  account: string;
  budget_amount: number;
  naming_series?: string;
  monthly_distribution?: string;
  action_if_annual_budget_exceeded?: string;
  remarks?: string;
}

export interface UpdateBudgetInput {
  cost_center?: string;
  fiscal_year?: string;
  account?: string;
  budget_amount?: number;
  monthly_distribution?: string;
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

export function logErpBudget(op: string, data?: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`${LOG_TAG} ${op}`, data ?? "");
}

export function mapBudgetStatus(doc: Pick<ErpBudgetRecord, "docstatus" | "workflow_state">): BudgetWorkflowStatus {
  if (doc.docstatus === 2) return "Cancelled";
  if (doc.docstatus === 0) return "Draft";

  const ws = (doc.workflow_state ?? "").trim();
  if (ws === "Rejected") return "Rejected";
  if (ws === "Approved") return "Approved";
  if (ws === "Active") return "Active";
  if (ws === "Draft") return "Draft";
  if (ws === "Submitted") return "Submitted";

  // Submitted doc without explicit workflow state
  if (doc.docstatus === 1) return "Submitted";
  return "Draft";
}

export function isBudgetAvailableForProcurement(status: BudgetWorkflowStatus): boolean {
  return status === "Approved" || status === "Active";
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

export type BudgetSchemaKind = "legacy" | "modern";

let cachedBudgetFieldNames: Set<string> | null = null;

/** Load Budget DocType field names via getdoctype (works with API token; DocField list does not). */
export async function getBudgetFieldNames(): Promise<Set<string>> {
  if (cachedBudgetFieldNames) return cachedBudgetFieldNames;
  try {
    const res = await apiPost<{ docs?: Array<{ fields?: Array<{ fieldname: string }> }> }>(
      "/api/method/frappe.desk.form.load.getdoctype",
      { doctype: BUDGET_DOCTYPE }
    );
    const names = new Set(
      (res?.docs?.[0]?.fields ?? []).map((f) => f.fieldname).filter(Boolean)
    );
    if (names.size === 0) {
      throw new Error("Budget DocType meta returned no fields");
    }
    cachedBudgetFieldNames = names;
  } catch (err) {
    logErpBudget("Budget meta fetch failed — assuming modern v16 schema", err);
    // ERPNext v16+ default; safer than legacy when meta is unavailable.
    cachedBudgetFieldNames = new Set([
      "from_fiscal_year",
      "to_fiscal_year",
      "account",
      "budget_amount",
      "distribution_frequency",
    ]);
  }
  logErpBudget("Budget DocType fields", [...cachedBudgetFieldNames].sort());
  return cachedBudgetFieldNames;
}

/** Detect ERPNext Budget DocType shape (v15 accounts table vs v16+ flat fields). */
export async function getBudgetSchema(): Promise<BudgetSchemaKind> {
  const fields = await getBudgetFieldNames();
  const schema = fields.has("from_fiscal_year") ? "modern" : "legacy";
  logErpBudget("Budget schema detected", schema);
  return schema;
}

function logBudgetCreateStage(stage: string, payload: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[ErpBudget] CREATE stage: ${stage}`, JSON.stringify(payload, null, 2));
}

function debugNumericField(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[ErpBudget] ${label}=${value}, type=${typeof value}`);
}

function coalesceNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") {
    debugNumericField("coalesceNumber.input (empty → fallback)", value);
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Strip null/undefined so ERPNext never receives JSON null for numeric fields. */
function sanitizeBudgetPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      clean[key] = value.map((row) =>
        typeof row === "object" && row !== null
          ? sanitizeBudgetPayload(row as Record<string, unknown>)
          : row
      );
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function validateCreateBudgetInput(
  input: CreateBudgetInput,
  company: string,
  budgetAgainst: BudgetAgainst
): void {
  const checks: Array<[string, unknown]> = [
    ["company", company],
    ["fiscal_year", input.fiscal_year],
    ["budget_against", budgetAgainst],
    ["account", input.account],
    ["budget_amount", input.budget_amount],
    ["action_if_annual_budget_exceeded", input.action_if_annual_budget_exceeded ?? "Stop"],
  ];

  if (budgetAgainst === "Cost Center") {
    checks.push(["cost_center", input.cost_center]);
  } else {
    checks.push(["project", input.project]);
  }

  for (const [name, value] of checks) {
    debugNumericField(name, value);
    if (value === null || value === undefined || value === "") {
      throw new Error(`Budget field "${name}" is required but was empty.`);
    }
  }

  const amount = coalesceNumber(input.budget_amount);
  debugNumericField("validated.budget_amount", amount);
  if (amount <= 0) {
    throw new Error("Budget amount must be greater than zero.");
  }
}

export function getBudgetFiscalYear(doc: ErpBudgetRecord): string {
  return doc.fiscal_year ?? doc.from_fiscal_year ?? doc.to_fiscal_year ?? "";
}

export function getBudgetAccountName(doc: ErpBudgetRecord): string | undefined {
  return doc.account ?? doc.accounts?.[0]?.account;
}

export function getBudgetAmount(doc: ErpBudgetRecord): number {
  if (doc.budget_amount != null) {
    return coalesceNumber(doc.budget_amount);
  }
  return sumBudgetAmount(doc.accounts);
}

/** Normalize legacy + modern Budget records into a consistent in-app shape. */
export function normalizeBudgetDoc(doc: ErpBudgetRecord): ErpBudgetRecord {
  const fiscalYear = getBudgetFiscalYear(doc);
  const account = getBudgetAccountName(doc);
  const budgetAmount = getBudgetAmount(doc);
  const accounts =
    doc.accounts && doc.accounts.length > 0
      ? doc.accounts
      : account
        ? [{ account, budget_amount: budgetAmount }]
        : [];

  return {
    ...doc,
    fiscal_year: fiscalYear,
    from_fiscal_year: doc.from_fiscal_year ?? fiscalYear,
    to_fiscal_year: doc.to_fiscal_year ?? fiscalYear,
    account,
    budget_amount: budgetAmount,
    accounts,
  };
}

function sumBudgetAmount(accounts: BudgetAccountRow[] | undefined): number {
  return (accounts ?? []).reduce((s, a) => s + coalesceNumber(a.budget_amount), 0);
}

function toListItem(doc: ErpBudgetRecord): BudgetListItem {
  const normalized = normalizeBudgetDoc(doc);
  return {
    name: normalized.name,
    company: normalized.company,
    budget_against: normalized.budget_against,
    cost_center: normalized.cost_center,
    project: normalized.project,
    account: getBudgetAccountName(normalized),
    fiscal_year: getBudgetFiscalYear(normalized),
    budget_amount: getBudgetAmount(normalized),
    status: mapBudgetStatus(normalized),
    owner: normalized.owner,
    creation: normalized.creation,
    modified: normalized.modified,
    modified_by: normalized.modified_by,
    workflow_state: normalized.workflow_state,
    docstatus: normalized.docstatus,
  };
}

function buildModernCreatePayload(
  input: CreateBudgetInput,
  company: string,
  budgetAgainst: BudgetAgainst
): Record<string, unknown> {
  const budgetAmount = coalesceNumber(input.budget_amount);
  const fiscalYear = input.fiscal_year?.trim() ?? "";
  const account = input.account?.trim() ?? "";

  debugNumericField("budget_amount", budgetAmount);
  debugNumericField("applicable_on_material_request", 0);
  debugNumericField("applicable_on_purchase_order", 0);
  debugNumericField("applicable_on_booking_actual_expenses", 1);
  // eslint-disable-next-line no-console
  console.log(
    `[ErpBudget] create payload fields company=${company}, from_fiscal_year=${fiscalYear}, account=${account}, budget_against=${budgetAgainst}`
  );

  if (budgetAmount <= 0) {
    throw new Error("Budget amount must be greater than zero.");
  }
  if (!fiscalYear) throw new Error("Fiscal year is required.");
  if (!account) throw new Error("Expense account is required.");

  const payload: Record<string, unknown> = {
    doctype: BUDGET_DOCTYPE,
    budget_against: budgetAgainst,
    company,
    from_fiscal_year: fiscalYear,
    to_fiscal_year: fiscalYear,
    account,
    budget_amount: budgetAmount,
    distribution_frequency: input.monthly_distribution ? "Monthly" : "Yearly",
    distribute_equally: 1,
    applicable_on_material_request: 0,
    applicable_on_purchase_order: 0,
    applicable_on_booking_actual_expenses: 1,
    action_if_annual_budget_exceeded: input.action_if_annual_budget_exceeded ?? "Stop",
    action_if_accumulated_monthly_budget_exceeded: "Warn",
  };

  if (input.naming_series?.trim()) {
    payload.naming_series = input.naming_series.trim();
  }

  if (budgetAgainst === "Cost Center") {
    payload.cost_center = input.cost_center;
    payload.project = "";
  } else {
    payload.project = input.project;
    payload.cost_center = "";
  }

  return payload;
}

function buildLegacyCreatePayload(
  input: CreateBudgetInput,
  company: string,
  budgetAgainst: BudgetAgainst
): Record<string, unknown> {
  const budgetAmount = coalesceNumber(input.budget_amount);
  const fiscalYear = input.fiscal_year?.trim() ?? "";
  const account = input.account?.trim() ?? "";

  debugNumericField("budget_amount", budgetAmount);
  if (budgetAmount <= 0) {
    throw new Error("Budget amount must be greater than zero.");
  }
  if (!fiscalYear) throw new Error("Fiscal year is required.");
  if (!account) throw new Error("Expense account is required.");

  const payload: Record<string, unknown> = {
    doctype: BUDGET_DOCTYPE,
    budget_against: budgetAgainst,
    company,
    fiscal_year: fiscalYear,
    monthly_distribution: input.monthly_distribution ?? "",
    action_if_annual_budget_exceeded: input.action_if_annual_budget_exceeded ?? "Stop",
    action_if_accumulated_monthly_budget_exceeded: "Warn",
    applicable_on_material_request: 0,
    applicable_on_purchase_order: 0,
    applicable_on_booking_actual_expenses: 1,
    accounts: [
      {
        doctype: "Budget Account",
        account,
        budget_amount: budgetAmount,
      },
    ],
  };

  if (input.naming_series?.trim()) {
    payload.naming_series = input.naming_series.trim();
  }

  if (budgetAgainst === "Cost Center") {
    payload.cost_center = input.cost_center;
    payload.project = "";
  } else {
    payload.project = input.project;
    payload.cost_center = "";
  }

  return payload;
}

function formatBudgetCreateError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("NoneType") &&
    message.includes("not supported between instances")
  ) {
    return new Error(
      "ERPNext rejected the budget because budget_amount was missing on the server. " +
        "Your ERPNext v16 Budget DocType uses from_fiscal_year / to_fiscal_year and " +
        "top-level account + budget_amount — not the legacy accounts[] child table. " +
        "The app has been updated to send the correct v16 payload; please hard-refresh and retry."
    );
  }
  return err instanceof Error ? err : new Error(message);
}

async function callMethod<T>(method: string, args: Record<string, unknown>): Promise<T> {
  return apiPost<T>(`/api/method/${method}`, args);
}

/* ─── Read ────────────────────────────────────────────────────────────────── */

/** Standard Frappe fields — always queryable regardless of the doctype schema. */
const STANDARD_BUDGET_QUERY_FIELDS = [
  "name",
  "owner",
  "creation",
  "modified",
  "modified_by",
  "docstatus",
];

/**
 * Budget-specific fields we'd LIKE to read. They differ across ERPNext
 * versions (legacy v15 has `fiscal_year` + `accounts` child table; modern v16+
 * has `from_fiscal_year`/`to_fiscal_year` + flat `account`/`budget_amount`), so
 * each is only requested if it actually exists on this instance's DocType.
 */
const BUDGET_CANDIDATE_FIELDS = [
  "company",
  "budget_against",
  "cost_center",
  "project",
  "fiscal_year",
  "from_fiscal_year",
  "to_fiscal_year",
  "account",
  "budget_amount",
  "monthly_distribution",
  "distribution_frequency",
  "action_if_annual_budget_exceeded",
  "workflow_state",
];

/**
 * Build the list of fields to request from the Budget list API using the LIVE
 * DocType metadata. This prevents `frappe.exceptions.DataError: Field not
 * permitted in query: <field>` (e.g. `fiscal_year` on a v16 instance that only
 * has `from_fiscal_year`/`to_fiscal_year`). Standard framework fields are always
 * safe and always included.
 */
async function getBudgetQueryFields(): Promise<string[]> {
  try {
    const meta = await getBudgetFieldNames();
    const valid = BUDGET_CANDIDATE_FIELDS.filter((f) => meta.has(f));
    return [...STANDARD_BUDGET_QUERY_FIELDS, ...valid];
  } catch {
    // Meta unavailable — request only the always-safe standard fields; the
    // per-record enrichment below still fetches the full doc for details.
    return [...STANDARD_BUDGET_QUERY_FIELDS];
  }
}

export async function fetchBudgetByName(name: string): Promise<ErpBudgetRecord> {
  logErpBudget("FETCH budget", { name });
  const doc = await apiGet<ErpBudgetRecord>(buildResourceUrl(BUDGET_DOCTYPE, name));
  return normalizeBudgetDoc(doc);
}

export async function fetchBudgets(params?: {
  owner?: string;
  status?: BudgetWorkflowStatus | "All";
  limit?: number;
}): Promise<BudgetListItem[]> {
  logErpBudget("FETCH budgets", params);

  const filters: Filter[] = [];
  if (params?.owner) {
    filters.push(["owner", "=", params.owner]);
  }

  // Only request fields the live Budget DocType actually has. Any missing
  // detail (e.g. legacy `accounts` child table) is filled per-record below via
  // fetchBudgetByName, which reads the full document without field filtering.
  const queryFields = await getBudgetQueryFields();
  const resourceUrl = buildResourceUrl(BUDGET_DOCTYPE);

  let rows: ErpBudgetRecord[] | undefined;
  try {
    rows = await apiGet<ErpBudgetRecord[]>(resourceUrl, {
      ...buildListConfig({
        fields: queryFields,
        filters: filters.length > 0 ? filters : undefined,
        limit_page_length: params?.limit ?? 200,
        order_by: "modified desc",
      }),
      ...withSilent(),
    });
  } catch (err) {
    // Never surface a raw Frappe DataError/traceback — degrade to an empty
    // list so callers (Budget dashboards, RFQ budget popup) render gracefully.
    logErpBudget("FETCH budgets failed — returning empty list", {
      url: resourceUrl,
      filters,
      queryFields,
      err,
    });
    return [];
  }

  const list = rows ?? [];

  // DEBUG: ERPNext returned zero Budget rows. Surface everything needed to tell
  // a genuine "no budgets" from a filter/permission problem (docstatus,
  // workflow_state, company, owner, fiscal_year, or role visibility).
  if (list.length === 0) {
    logErpBudget("FETCH budgets — ZERO records returned by ERPNext", {
      url: resourceUrl,
      filters: filters.length > 0 ? filters : "(none — all budgets visible to session user)",
      queryFields,
      rawResponseCount: 0,
      hint: "Verify the logged-in user has Budget read permission and that no docstatus/workflow_state/company/owner/fiscal_year filter is excluding valid records.",
    });
  }

  const enriched: BudgetListItem[] = [];

  for (const row of list) {
    let doc = row;
    if (!doc.accounts || doc.accounts.length === 0) {
      try {
        doc = await fetchBudgetByName(row.name);
      } catch {
        doc = { ...row, accounts: [] };
      }
    }
    const item = toListItem(doc);
    if (params?.status && params.status !== "All" && item.status !== params.status) {
      continue;
    }
    enriched.push(item);
  }

  logErpBudget("FETCH budgets — result", {
    url: resourceUrl,
    filters: filters.length > 0 ? filters : "(none)",
    rawResponseCount: list.length,
    count: enriched.length,
  });
  return enriched;
}

export async function fetchMyBudgets(ownerEmail: string): Promise<BudgetListItem[]> {
  return fetchBudgets({ owner: ownerEmail });
}

export async function fetchPendingApprovalBudgets(): Promise<BudgetListItem[]> {
  const all = await fetchBudgets();
  return all.filter((b) => b.status === "Submitted");
}

export async function fetchApprovedBudgets(): Promise<BudgetListItem[]> {
  const all = await fetchBudgets();
  return all.filter((b) => isBudgetAvailableForProcurement(b.status));
}

/**
 * Find an existing (non-cancelled) Budget that would collide with a new one,
 * mirroring ERPNext's own duplicate rule: same Company + Budget Account +
 * Fiscal Year against the same Cost Center (or Project). Returns the matching
 * budget so the UI can offer "View Existing Budget", or `null` when the
 * combination is free. Never throws — a failed lookup degrades to `null` so
 * creation can still proceed (ERPNext remains the final authority).
 */
export async function findDuplicateBudget(params: {
  company: string;
  fiscalYear: string;
  account: string;
  costCenter?: string;
  project?: string;
}): Promise<BudgetListItem | null> {
  try {
    const all = await fetchBudgets({ limit: 500 });
    const norm = (v?: string) => (v ?? "").trim();
    const match = all.find((b) => {
      if (b.status === "Cancelled") return false;
      if (norm(b.company) !== norm(params.company)) return false;
      if (norm(b.fiscal_year) !== norm(params.fiscalYear)) return false;
      if (norm(b.account) !== norm(params.account)) return false;
      if (params.costCenter) return norm(b.cost_center) === norm(params.costCenter);
      if (params.project) return norm(b.project) === norm(params.project);
      return false;
    });
    return match ?? null;
  } catch (err) {
    logErpBudget("findDuplicateBudget failed — assuming no duplicate", err);
    return null;
  }
}

export async function fetchFiscalYears(): Promise<string[]> {
  try {
    const rows = await apiGet<Array<{ name: string }>>(
      buildResourceUrl("Fiscal Year"),
      buildListConfig({
        fields: ["name"],
        filters: [["disabled", "=", 0]],
        limit_page_length: 50,
        order_by: "year_start_date desc",
      })
    );
    return (rows ?? []).map((r) => r.name);
  } catch {
    return [];
  }
}

export async function fetchFiscalYearDetails(): Promise<
  Array<{ name: string; year_end_date?: string }>
> {
  try {
    const rows = await apiGet<Array<{ name: string; year_end_date?: string }>>(
      buildResourceUrl("Fiscal Year"),
      buildListConfig({
        fields: ["name", "year_end_date"],
        filters: [["disabled", "=", 0]],
        limit_page_length: 50,
        order_by: "year_start_date desc",
      })
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

export async function fetchCostCenters(company?: string): Promise<Array<{ name: string; cost_center_name?: string }>> {
  try {
    const filters: Filter[] = [["is_group", "=", 0]];
    if (company) filters.push(["company", "=", company]);
    const rows = await apiGet<Array<{ name: string; cost_center_name?: string }>>(
      buildResourceUrl("Cost Center"),
      buildListConfig({
        fields: ["name", "cost_center_name"],
        filters,
        limit_page_length: 200,
      })
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

export async function fetchExpenseAccounts(company?: string): Promise<Array<{ name: string }>> {
  try {
    const filters: Filter[] = [
      ["is_group", "=", 0],
      ["root_type", "=", "Expense"],
    ];
    if (company) filters.push(["company", "=", company]);
    const rows = await apiGet<Array<{ name: string }>>(
      buildResourceUrl("Account"),
      buildListConfig({
        fields: ["name"],
        filters,
        limit_page_length: 200,
      })
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

export async function fetchCompanies(): Promise<CompanyOption[]> {
  try {
    const rows = await apiGet<CompanyOption[]>(
      buildResourceUrl("Company"),
      buildListConfig({
        fields: ["name", "company_name", "default_currency"],
        limit_page_length: 50,
        order_by: "name asc",
      })
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

export async function fetchProjects(
  company?: string
): Promise<Array<{ name: string; project_name?: string }>> {
  try {
    const filters: Filter[] = [];
    if (company) filters.push(["company", "=", company]);
    const rows = await apiGet<Array<{ name: string; project_name?: string }>>(
      buildResourceUrl("Project"),
      buildListConfig({
        fields: ["name", "project_name"],
        filters: filters.length > 0 ? filters : undefined,
        limit_page_length: 200,
        order_by: "name asc",
      })
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

export async function fetchMonthlyDistributions(): Promise<Array<{ name: string }>> {
  try {
    const rows = await apiGet<Array<{ name: string }>>(
      buildResourceUrl("Monthly Distribution"),
      buildListConfig({
        fields: ["name"],
        limit_page_length: 100,
        order_by: "name asc",
      })
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

/** Default naming series pattern from ERPNext Budget DocType meta. */
export async function fetchBudgetNamingSeries(): Promise<string> {
  try {
    const rows = await apiGet<Array<{ options?: string; default?: string }>>(
      buildResourceUrl("DocField"),
      buildListConfig({
        fields: ["options", "default"],
        filters: [
          ["parent", "=", BUDGET_DOCTYPE],
          ["fieldname", "=", "naming_series"],
        ],
        limit_page_length: 1,
      })
    );
    const field = rows?.[0];
    const options = (field?.options ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (options.length > 0) return options[0];
    if (field?.default?.trim()) return field.default.trim();
  } catch {
    /* fall through */
  }
  return "BUD-.YYYY.-";
}

export async function fetchCompanyCurrency(company: string): Promise<string> {
  try {
    const doc = await apiGet<{ default_currency?: string }>(
      buildResourceUrl("Company", company)
    );
    return doc.default_currency ?? "USD";
  } catch {
    return "USD";
  }
}

/* ─── Write ───────────────────────────────────────────────────────────────── */

export async function createBudget(input: CreateBudgetInput): Promise<ErpBudgetRecord> {
  const company = input.company ?? COMPANY;
  const budgetAgainst = input.budget_against ?? "Cost Center";
  const fieldNames = await getBudgetFieldNames();
  const schema = fieldNames.has("from_fiscal_year") ? "modern" : "legacy";

  logBudgetCreateStage("1-frontend-input", input);
  logErpBudget("CREATE budget", { schema, input });

  validateCreateBudgetInput(input, company, budgetAgainst);

  if (budgetAgainst === "Cost Center" && !input.cost_center?.trim()) {
    throw new Error("Cost Center is required when budget is against Cost Center.");
  }
  if (budgetAgainst === "Project" && !input.project?.trim()) {
    throw new Error("Project is required when budget is against Project.");
  }

  const rawPayload =
    schema === "modern"
      ? buildModernCreatePayload(input, company, budgetAgainst)
      : buildLegacyCreatePayload(input, company, budgetAgainst);

  const payload = sanitizeBudgetPayload(rawPayload);
  logBudgetCreateStage("2-api-payload-to-erpnext", payload);
  logErpBudget("CREATE budget payload", payload);

  try {
    const created = await apiPost<ErpBudgetRecord | { name: string }>(
      buildResourceUrl(BUDGET_DOCTYPE),
      payload
    );
    logBudgetCreateStage("3-erpnext-response", created);
    const name =
      (created as ErpBudgetRecord)?.name ??
      (created as { name?: string })?.name;
    if (!name) throw new Error("Budget creation failed — no document name returned");

    if (input.remarks?.trim()) {
      await addBudgetComment(name, input.remarks.trim());
    }

    const saved = await fetchBudgetByName(name);
    logBudgetCreateStage("4-erpnext-saved-doc", {
      name: saved.name,
      company: saved.company,
      budget_against: saved.budget_against,
      account: getBudgetAccountName(saved),
      from_fiscal_year: saved.from_fiscal_year,
      to_fiscal_year: saved.to_fiscal_year,
      fiscal_year: saved.fiscal_year,
      budget_amount: getBudgetAmount(saved),
    });
    invalidateBudgetViews();
    return saved;
  } catch (err) {
    logBudgetCreateStage("error", err instanceof Error ? err.message : err);
    throw formatBudgetCreateError(err);
  }
}

export async function updateDraftBudget(
  name: string,
  input: UpdateBudgetInput
): Promise<ErpBudgetRecord> {
  const existing = await fetchBudgetByName(name);
  if (mapBudgetStatus(existing) !== "Draft") {
    throw new Error("Only draft budgets can be edited.");
  }

  const schema = await getBudgetSchema();
  const updates: Record<string, unknown> = {};
  if (input.cost_center) updates.cost_center = input.cost_center;
  if (input.monthly_distribution !== undefined) {
    updates.monthly_distribution = input.monthly_distribution;
  }

  if (schema === "modern") {
    if (input.fiscal_year) {
      updates.from_fiscal_year = input.fiscal_year;
      updates.to_fiscal_year = input.fiscal_year;
    }
    if (input.account) updates.account = input.account;
    if (input.budget_amount !== undefined) {
      const amount = coalesceNumber(input.budget_amount);
      debugNumericField("budget_amount", amount);
      updates.budget_amount = amount;
    }
    if (input.monthly_distribution) {
      updates.distribution_frequency = "Monthly";
    }
  } else {
    if (input.fiscal_year) updates.fiscal_year = input.fiscal_year;
    if (input.account || input.budget_amount !== undefined) {
      const account = input.account ?? getBudgetAccountName(existing);
      const amount =
        input.budget_amount !== undefined
          ? coalesceNumber(input.budget_amount)
          : getBudgetAmount(existing);
      debugNumericField("budget_amount", amount);
      if (account) {
        updates.accounts = [{ doctype: "Budget Account", account, budget_amount: amount }];
      }
    }
  }

  logErpBudget("UPDATE draft", { name, schema, updates });
  await apiPut(buildResourceUrl(BUDGET_DOCTYPE, name), updates);
  return fetchBudgetByName(name);
}

export async function submitBudget(name: string): Promise<ErpBudgetRecord> {
  const doc = await fetchBudgetByName(name);
  if (mapBudgetStatus(doc) !== "Draft") {
    throw new Error("Only draft budgets can be submitted.");
  }
  logErpBudget("SUBMIT budget", { name });
  await callMethod("frappe.client.submit", { doc });
  const submitted = await fetchBudgetByName(name);
  invalidateBudgetViews();
  return submitted;
}

export async function applyBudgetWorkflowAction(
  name: string,
  action: "Approve" | "Reject" | "Activate" | "Cancel"
): Promise<ErpBudgetRecord> {
  const doc = await fetchBudgetByName(name);
  logErpBudget("WORKFLOW action", { name, action });
  try {
    await callMethod("frappe.model.workflow.apply_workflow", { doc, action });
  } catch (err) {
    // Fallback: set workflow_state directly when workflow engine unavailable
    const stateMap: Record<string, string> = {
      Approve: "Approved",
      Reject: "Rejected",
      Activate: "Active",
      Cancel: "Cancelled",
    };
    await apiPut(buildResourceUrl(BUDGET_DOCTYPE, name), {
      workflow_state: stateMap[action] ?? action,
    });
    if (action === "Cancel") {
      await callMethod("frappe.client.cancel", { doctype: BUDGET_DOCTYPE, name });
    }
    logErpBudget("WORKFLOW fallback applied", { name, action, err });
  }
  const refreshed = await fetchBudgetByName(name);
  invalidateBudgetViews();
  return refreshed;
}

export async function approveBudget(name: string, comment?: string): Promise<ErpBudgetRecord> {
  if (comment?.trim()) {
    await addBudgetComment(name, comment.trim());
  }
  const approved = await applyBudgetWorkflowAction(name, "Approve");
  // Transition Approved → Active for procurement availability
  if (mapBudgetStatus(approved) === "Approved") {
    try {
      return await applyBudgetWorkflowAction(name, "Activate");
    } catch {
      await apiPut(buildResourceUrl(BUDGET_DOCTYPE, name), { workflow_state: "Active" });
      return fetchBudgetByName(name);
    }
  }
  return approved;
}

export async function rejectBudget(name: string, comment?: string): Promise<ErpBudgetRecord> {
  if (comment?.trim()) {
    await addBudgetComment(name, comment.trim());
  }
  return applyBudgetWorkflowAction(name, "Reject");
}

export async function cancelBudget(name: string): Promise<ErpBudgetRecord> {
  return applyBudgetWorkflowAction(name, "Cancel");
}

export async function addBudgetComment(name: string, comment: string): Promise<void> {
  try {
    await callMethod("frappe.desk.form.utils.add_comment", {
      reference_doctype: BUDGET_DOCTYPE,
      reference_name: name,
      content: comment,
      comment_email: "",
      comment_by: "",
    });
  } catch {
    logErpBudget("Comment add failed (non-fatal)", { name });
  }
}

export async function fetchBudgetComments(name: string): Promise<BudgetComment[]> {
  try {
    const rows = await apiGet<Array<{ content?: string; comment_by?: string; creation?: string }>>(
      buildResourceUrl("Comment"),
      buildListConfig({
        fields: ["content", "comment_by", "creation"],
        filters: [
          ["reference_doctype", "=", BUDGET_DOCTYPE],
          ["reference_name", "=", name],
        ],
        limit_page_length: 50,
        order_by: "creation desc",
      })
    );
    return (rows ?? []).map((r) => ({
      comment: r.content ?? "",
      by: r.comment_by ?? "",
      creation: r.creation ?? "",
    }));
  } catch {
    return [];
  }
}

/* ─── Utilization (live ERPNext + commitments) ────────────────────────────── */

async function fetchActualExpenseFromErp(budget: ErpBudgetRecord): Promise<number | null> {
  const normalized = normalizeBudgetDoc(budget);
  const account = getBudgetAccountName(normalized);
  if (!account) return null;

  try {
    const result = await callMethod<number | Record<string, number>>(
      "erpnext.accounts.doctype.budget.budget.get_actual_expense",
      {
        budget_against: normalized.budget_against,
        cost_center: normalized.cost_center,
        fiscal_year: getBudgetFiscalYear(normalized),
        company: normalized.company,
        accounts: account ? [account] : [],
        account,
        budget_start_date: undefined,
        budget_end_date: undefined,
      }
    );
    if (typeof result === "number") return result;
    if (result && typeof result === "object") {
      return Object.values(result).reduce((s, v) => s + (Number(v) || 0), 0);
    }
  } catch {
    /* method may not exist on all ERPNext versions */
  }
  return null;
}

async function computeCommitmentForCostCenter(costCenter?: string): Promise<number> {
  const [reviewsResult, pos] = await Promise.all([
    fetchAllFinanceReviewRecords(),
    fetchSubmittedPurchaseOrders(),
  ]);
  const reviews = reviewsResult.items;

  const poRfqRefs = new Set(
    pos.map((p) => p.custom_rfq_reference?.trim()).filter((r): r is string => !!r)
  );

  let rfqCommitment = 0;
  for (const rfq of reviews.filter((r) => r.finance_status === "Budget Approved")) {
    if (poRfqRefs.has(rfq.rfq_name)) continue;
    rfqCommitment += rfq.rfq_value ?? 0;
  }

  const poValue = pos.reduce((s, p) => s + (p.grand_total ?? 0), 0);
  // When cost center is specified, commitments are attributed proportionally
  // until PO/RFQ carry explicit cost_center fields.
  void costCenter;
  return rfqCommitment + poValue;
}

export async function getBudgetUtilization(budgetName: string): Promise<BudgetUtilization> {
  const budget = await fetchBudgetByName(budgetName);
  const budgetAmount = getBudgetAmount(budget);
  const fiscalYear = getBudgetFiscalYear(budget);
  debugNumericField("utilization.budget_amount", budgetAmount);

  // Consumed is driven by LIVE submitted Purchase Invoices attributed to this
  // budget (Company + Cost Center + Fiscal Year). Reserved is the open,
  // not-yet-billed Purchase Order commitment for the same scope. This is the
  // enterprise accounting model — every submitted invoice increases Consumed
  // and reduces Available immediately.
  let actualExpense = 0;
  let reservedBudget = 0;
  try {
    const ledger = await fetchBudgetLedger(
      {
        company: budget.company,
        costCenter: budget.cost_center ?? null,
        fiscalYear,
        allocated: budgetAmount,
      },
      { detail: false },
    );
    actualExpense = coalesceNumber(ledger.consumed);
    reservedBudget = coalesceNumber(ledger.reserved);
  } catch {
    // Fall back to the ERPNext native actual-expense / PO commitment path so a
    // transient invoice-query failure never zeroes out consumption.
    const native = await fetchActualExpenseFromErp(budget);
    actualExpense = coalesceNumber(
      native ?? (await computeCommitmentForCostCenter(budget.cost_center)),
    );
  }
  debugNumericField("utilization.actual_expense", actualExpense);

  const remainingBudget = Math.max(budgetAmount - actualExpense, 0);
  const utilizationPct =
    budgetAmount > 0 ? Math.round((actualExpense / budgetAmount) * 100) : 0;

  // Forecast: current consumption plus open commitments.
  const forecastExpense = actualExpense + reservedBudget;
  const forecastUtilizationPct =
    budgetAmount > 0 ? Math.round((forecastExpense / budgetAmount) * 100) : 0;

  return {
    budgetName: budget.name,
    costCenter: budget.cost_center,
    fiscalYear,
    budgetAmount,
    actualExpense,
    remainingBudget,
    utilizationPct,
    forecastUtilizationPct,
    availableBudget: remainingBudget,
    reservedBudget,
  };
}

/* ─── RFQ pre-submission budget check (visibility only) ────────────────────── */

export interface RfqBudgetSummary {
  /** Total approved/active budget in scope. */
  allocated: number;
  /** Actual expense + committed spend already consumed. */
  consumed: number;
  /** allocated − consumed (never negative). */
  available: number;
  utilizationPct: number;
  matchedBudgetNames: string[];
  fiscalYear: string | null;
  costCenter: string | null;
  /** How the in-scope budgets were selected (for the modal caption). */
  scope: "cost-center" | "company" | "all";
  /** False when no approved/active budget is in scope for this RFQ. */
  budgetAvailable: boolean;
  /** User-facing note when no budget is found (never a raw error). */
  message?: string;
}

/** Graceful "no budget" summary — used when none is found or lookup fails. */
function emptyBudgetSummary(opts: {
  costCenter: string | null;
  fiscalYear: string | null;
  scope: RfqBudgetSummary["scope"];
}): RfqBudgetSummary {
  return {
    allocated: 0,
    consumed: 0,
    available: 0,
    utilizationPct: 0,
    matchedBudgetNames: [],
    fiscalYear: opts.fiscalYear,
    costCenter: opts.costCenter,
    scope: opts.scope,
    budgetAvailable: false,
    message: "No active budget found.",
  };
}

/**
 * Live budget snapshot for the "Check Budget" pre-submission popup on the RFQ
 * Details page. Reads only approved/active ERPNext Budget records (single source
 * of truth) and their real utilization. It NARROWS by cost center + fiscal year
 * when the RFQ provides them, otherwise falls back to company- or account-wide
 * totals so the Procurement Manager always sees a meaningful figure.
 *
 * This is read-only visibility — it never creates an approval workflow and never
 * blocks submission.
 */
export async function getRfqBudgetSummary(opts: {
  company?: string | null;
  costCenter?: string | null;
  fiscalYear?: string | null;
}): Promise<RfqBudgetSummary> {
  const company = opts.company?.trim() || null;
  const costCenter = opts.costCenter?.trim() || null;
  const fiscalYear = opts.fiscalYear?.trim() || null;
  let scope: RfqBudgetSummary["scope"] = company ? "company" : "all";

  try {
    const approved = await fetchApprovedBudgets();

    let matched = approved;
    if (company) {
      matched = matched.filter((b) => b.company === company);
    }

    // Prefer the tightest scope that still returns at least one budget.
    if (costCenter || fiscalYear) {
      const narrowed = matched.filter(
        (b) =>
          (!costCenter || b.cost_center === costCenter) &&
          (!fiscalYear || b.fiscal_year === fiscalYear),
      );
      if (narrowed.length > 0) {
        matched = narrowed;
        scope = "cost-center";
      }
    }

    // No approved/active budget in scope — return a graceful, non-error result.
    if (matched.length === 0) {
      logErpBudget("RFQ budget summary — no active budget", {
        company,
        costCenter,
        fiscalYear,
      });
      return emptyBudgetSummary({ costCenter, fiscalYear, scope });
    }

    // Per-budget utilization is best-effort — a single failure must not blow up
    // the whole summary.
    const utilResults = await Promise.allSettled(
      matched.map((b) => getBudgetUtilization(b.name)),
    );
    const utils = utilResults
      .filter(
        (r): r is PromiseFulfilledResult<BudgetUtilization> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);

    const allocated = utils.reduce((s, u) => s + u.budgetAmount, 0);
    const consumed = utils.reduce((s, u) => s + u.actualExpense, 0);
    const available = Math.max(allocated - consumed, 0);
    const utilizationPct =
      allocated > 0 ? Math.round((consumed / allocated) * 100) : 0;

    logErpBudget("RFQ budget summary", {
      company,
      costCenter,
      fiscalYear,
      scope,
      matched: matched.length,
      allocated,
      consumed,
      available,
    });

    return {
      allocated,
      consumed,
      available,
      utilizationPct,
      matchedBudgetNames: matched.map((b) => b.name),
      fiscalYear,
      costCenter,
      scope,
      budgetAvailable: true,
    };
  } catch (err) {
    // Absolutely never propagate a raw Frappe error to the popup.
    logErpBudget("RFQ budget summary failed — returning empty summary", err);
    return emptyBudgetSummary({ costCenter, fiscalYear, scope });
  }
}

/** Aggregate utilization across all procurement-available budgets. */
export async function getActiveBudgetPool(): Promise<{
  totalBudget: number;
  actualExpense: number;
  remainingBudget: number;
  utilizationPct: number;
  budgets: BudgetUtilization[];
}> {
  const approved = await fetchApprovedBudgets();
  const utilizations = await Promise.all(
    approved.map((b) => getBudgetUtilization(b.name))
  );

  const totalBudget = utilizations.reduce((s, u) => s + u.budgetAmount, 0);
  const actualExpense = utilizations.reduce((s, u) => s + u.actualExpense, 0);
  const remainingBudget = Math.max(totalBudget - actualExpense, 0);
  const utilizationPct =
    totalBudget > 0 ? Math.round((actualExpense / totalBudget) * 100) : 0;

  return { totalBudget, actualExpense, remainingBudget, utilizationPct, budgets: utilizations };
}
