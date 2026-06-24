/**
 * Admin Module API — queries ERPNext for system-wide KPIs,
 * user/role management, workflow config, and report data.
 */

import { apiGet, apiPost, apiPut, apiDelete, buildResourceUrl, buildListConfig, withSilent } from "./erpnext";
import type { Filter } from "./erpnext";

/* ─── Types ───────────────────────────────────────────────────────────────── */

export interface AdminKpis {
  totalUsers: number;
  totalSuppliers: number;
  totalRFQs: number;
  totalPOs: number;
  totalSpend: number;
  pendingApprovals: number;
}

export interface ErpUser {
  name: string;
  email: string;
  full_name: string;
  enabled: number;
  creation: string;
  last_active?: string;
  user_type?: string;
  roles: string[];
}

export interface ErpRole {
  name: string;
  role_name: string;
  disabled: number;
}

export interface CompanyInfo {
  name: string;
  company_name: string;
  default_currency: string;
  country: string;
  domain?: string;
}

export interface WorkflowStage {
  name: string;
  label: string;
  enabled: boolean;
  order: number;
}

export interface ReportRow {
  [key: string]: string | number | null;
}

/* ─── Helper: safe count ──────────────────────────────────────────────────── */

async function safeCount(doctype: string, filters?: Filter[]): Promise<number> {
  try {
    const res = await apiGet<number>(
      `/api/method/frappe.client.get_count`,
      {
        params: {
          doctype,
          ...(filters ? { filters: JSON.stringify(filters) } : {}),
        },
        ...withSilent(),
      }
    );
    return typeof res === "number" ? res : 0;
  } catch {
    return 0;
  }
}

/* ─── Dashboard KPIs ──────────────────────────────────────────────────────── */

export async function getAdminKpis(): Promise<AdminKpis> {
  const [totalUsers, totalSuppliers, totalRFQs, totalPOs, pendingApprovals] =
    await Promise.all([
      safeCount("User", [["user_type", "=", "System User"]]),
      safeCount("Supplier"),
      safeCount("Request for Quotation"),
      safeCount("Purchase Order"),
      safeCount("Request for Quotation", [["docstatus", "=", "0"]]),
    ]);

  let totalSpend = 0;
  try {
    const pos = await apiGet<Array<{ grand_total: number }>>(
      buildResourceUrl("Purchase Order"),
      {
        ...buildListConfig({
          fields: ["grand_total"],
          filters: [["docstatus", "=", "1"]],
          limit_page_length: 0,
        }),
        ...withSilent(),
      }
    );
    totalSpend = (pos ?? []).reduce((sum, p) => sum + (p.grand_total ?? 0), 0);
  } catch { /* silent */ }

  return { totalUsers, totalSuppliers, totalRFQs, totalPOs, totalSpend, pendingApprovals };
}

/* ─── User Management ─────────────────────────────────────────────────────── */

export async function getUsers(page = 0, pageSize = 50, search?: string): Promise<ErpUser[]> {
  const filters: Filter[] = [["user_type", "=", "System User"]];
  if (search) {
    filters.push(["full_name", "like", `%${search}%`]);
  }

  try {
    const users = await apiGet<Array<{
      name: string;
      email: string;
      full_name: string;
      enabled: number;
      creation: string;
      last_active?: string;
      user_type?: string;
    }>>(
      buildResourceUrl("User"),
      {
        ...buildListConfig({
          fields: ["name", "email", "full_name", "enabled", "creation", "last_active", "user_type"],
          filters,
          order_by: "creation desc",
          limit_page_length: pageSize,
          limit_start: page * pageSize,
        }),
        ...withSilent(),
      }
    );

    return (users ?? []).map((u) => ({ ...u, roles: [] }));
  } catch {
    return [];
  }
}

export async function getUserDetail(userId: string): Promise<ErpUser | null> {
  try {
    const user = await apiGet<{
      name: string;
      email: string;
      full_name: string;
      enabled: number;
      creation: string;
      last_active?: string;
      user_type?: string;
      roles?: Array<{ role: string }>;
    }>(buildResourceUrl("User", userId), withSilent());

    return {
      name: user.name,
      email: user.email,
      full_name: user.full_name,
      enabled: user.enabled,
      creation: user.creation,
      last_active: user.last_active,
      user_type: user.user_type,
      roles: (user.roles ?? []).map((r) => r.role),
    };
  } catch {
    return null;
  }
}

export async function toggleUserEnabled(userId: string, enabled: boolean): Promise<boolean> {
  try {
    await apiPut(buildResourceUrl("User", userId), { enabled: enabled ? 1 : 0 });
    return true;
  } catch {
    return false;
  }
}

/* ─── User save helpers ────────────────────────────────────────────────────── */

async function validateRoles(roles: string[]): Promise<string | null> {
  try {
    const validRoles = await apiGet<Array<{ name: string }>>(
      buildResourceUrl("Role"),
      {
        ...buildListConfig({
          fields: ["name"],
          filters: [["name", "in", roles]],
          limit_page_length: 200,
        }),
        ...withSilent(),
      }
    );
    const validSet = new Set((validRoles ?? []).map((r) => r.name));
    const invalid = roles.filter((r) => !validSet.has(r));
    if (invalid.length > 0) {
      return `Invalid roles: ${invalid.join(", ")}`;
    }
    return null;
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[Admin] Role validation lookup failed, skipping pre-check");
    return null;
  }
}

function friendlyUserError(raw: string, userId: string): string {
  if (raw.includes("Not permitted") || raw.includes("Insufficient Permission")) {
    return "You do not have permission to update this user.";
  }
  if (raw.includes("does not exist")) {
    return `User "${userId}" was not found.`;
  }
  if (raw.includes("LinkValidationError")) {
    return "One or more selected roles are invalid.";
  }
  if (raw.includes("DuplicateEntryError") || raw.includes("already exists")) {
    return `A user with this email already exists.`;
  }
  if (raw.includes("ValidationError")) {
    return `Validation failed: ${raw.replace(/.*ValidationError[:\s]*/i, "")}`;
  }
  if (raw.includes("save() missing") || raw.includes("positional argument")) {
    return "Server method not available. Please contact your administrator.";
  }
  return raw;
}

export interface CreateUserPayload {
  email: string;
  first_name: string;
  last_name?: string;
  new_password: string;
  roles?: string[];
  send_welcome_email?: boolean;
}

export interface UpdateUserPayload {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  department?: string;
  designation?: string;
  enabled?: number;
  roles?: string[];
}

export async function createUser(payload: CreateUserPayload): Promise<{ ok: boolean; name?: string; error?: string }> {
  try {
    const body: Record<string, unknown> = {
      email: payload.email,
      first_name: payload.first_name,
      last_name: payload.last_name ?? "",
      new_password: payload.new_password,
      send_welcome_email: payload.send_welcome_email ? 1 : 0,
      user_type: "System User",
      enabled: 1,
    };
    if (payload.roles?.length) {
      body.roles = payload.roles.map((r) => ({ role: r }));
    }

    const res = await apiPost<{ name: string }>(buildResourceUrl("User"), body);
    return { ok: true, name: res?.name };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, error: friendlyUserError(raw, payload.email) };
  }
}

export async function updateUser(userId: string, payload: UpdateUserPayload): Promise<{ ok: boolean; error?: string }> {
  try {
    // Validate roles exist before saving
    if (payload.roles !== undefined && payload.roles.length > 0) {
      const validationError = await validateRoles(payload.roles);
      if (validationError) return { ok: false, error: validationError };
    }

    // Build the update body for the resource PUT endpoint.
    // Roles are set as the complete child table — Frappe replaces all
    // existing role entries with the provided list.
    const body: Record<string, unknown> = {};
    if (payload.full_name !== undefined) body.full_name = payload.full_name;
    if (payload.first_name !== undefined) body.first_name = payload.first_name;
    if (payload.last_name !== undefined) body.last_name = payload.last_name;
    if (payload.phone !== undefined) body.phone = payload.phone;
    if (payload.department !== undefined) body.department = payload.department;
    if (payload.designation !== undefined) body.designation = payload.designation;
    if (payload.enabled !== undefined) body.enabled = payload.enabled;
    if (payload.roles !== undefined) {
      body.roles = payload.roles.map((r) => ({ role: r }));
    }

    await apiPut(buildResourceUrl("User", userId), body);

    return { ok: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, error: friendlyUserError(raw, userId) };
  }
}

export async function deleteUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiDelete(buildResourceUrl("User", userId));
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete user";
    return { ok: false, error: msg };
  }
}

export async function resetUserPassword(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiPost("/api/method/frappe.core.doctype.user.user.reset_password", {
      user: userId,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reset password";
    return { ok: false, error: msg };
  }
}

/* ─── Role Management ─────────────────────────────────────────────────────── */

export async function getRoles(): Promise<ErpRole[]> {
  try {
    const roles = await apiGet<ErpRole[]>(
      buildResourceUrl("Role"),
      {
        ...buildListConfig({
          fields: ["name", "role_name", "disabled"],
          order_by: "name asc",
          limit_page_length: 200,
        }),
        ...withSilent(),
      }
    );
    return roles ?? [];
  } catch {
    return [];
  }
}

export async function getUserRoles(userId: string): Promise<string[]> {
  const detail = await getUserDetail(userId);
  return detail?.roles ?? [];
}

export async function assignRoleToUser(userId: string, role: string): Promise<boolean> {
  try {
    const detail = await getUserDetail(userId);
    if (!detail) return false;

    const currentRoles = detail.roles ?? [];
    if (currentRoles.includes(role)) return true;

    await apiPut(buildResourceUrl("User", userId), {
      roles: [...currentRoles, role].map((r) => ({ role: r })),
    });
    return true;
  } catch {
    return false;
  }
}

/* ─── Workflow Management ─────────────────────────────────────────────────── */

const PROCUREMENT_WORKFLOW_STAGES: WorkflowStage[] = [
  { name: "rfq_creation", label: "RFQ Creation", enabled: true, order: 1 },
  { name: "supplier_quotation", label: "Supplier Quotation", enabled: true, order: 2 },
  { name: "ai_analysis", label: "AI Analysis", enabled: true, order: 3 },
  { name: "legal_review", label: "Legal Review", enabled: true, order: 4 },
  { name: "finance_review", label: "Finance Review", enabled: true, order: 5 },
  { name: "po_creation", label: "PO Creation", enabled: true, order: 6 },
  { name: "grn", label: "Goods Receipt", enabled: true, order: 7 },
  { name: "invoice", label: "Invoice", enabled: true, order: 8 },
  { name: "payment", label: "Payment", enabled: true, order: 9 },
];

export function getWorkflowStages(): WorkflowStage[] {
  const stored = localStorage.getItem("bidsphere_workflow_config");
  if (stored) {
    try { return JSON.parse(stored) as WorkflowStage[]; } catch { /* fallthrough */ }
  }
  return PROCUREMENT_WORKFLOW_STAGES;
}

export function saveWorkflowStages(stages: WorkflowStage[]): void {
  localStorage.setItem("bidsphere_workflow_config", JSON.stringify(stages));
}

/* ─── Reports ─────────────────────────────────────────────────────────────── */

export async function getReportData(
  reportType: "rfq" | "supplier" | "po" | "spend",
  dateFrom?: string,
  dateTo?: string
): Promise<ReportRow[]> {
  const doctype =
    reportType === "rfq" ? "Request for Quotation"
      : reportType === "supplier" ? "Supplier"
      : reportType === "po" ? "Purchase Order"
      : "Purchase Order";

  const filters: Filter[] = [];
  if (dateFrom) filters.push(["creation", ">=", dateFrom]);
  if (dateTo) filters.push(["creation", "<=", `${dateTo} 23:59:59`]);

  const fieldsMap: Record<string, string[]> = {
    rfq: ["name", "transaction_date", "status", "vendor as supplier", "grand_total", "creation"],
    supplier: ["name", "supplier_name", "country", "disabled"],
    po: ["name", "supplier", "transaction_date", "grand_total", "status", "per_received", "per_billed"],
    spend: ["name", "supplier", "transaction_date", "grand_total", "status"],
  };

  try {
    if (reportType === "spend") {
      filters.push(["docstatus", "=", "1"]);
    }
    const rows = await apiGet<ReportRow[]>(
      buildResourceUrl(doctype),
      {
        ...buildListConfig({
          fields: fieldsMap[reportType],
          filters: filters.length > 0 ? filters : undefined,
          order_by: "creation desc",
          limit_page_length: 200,
        }),
        ...withSilent(),
      }
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

/* ─── System Settings ─────────────────────────────────────────────────────── */

export async function getCompanyInfo(): Promise<CompanyInfo | null> {
  try {
    const companies = await apiGet<CompanyInfo[]>(
      buildResourceUrl("Company"),
      {
        ...buildListConfig({
          fields: ["name", "company_name", "default_currency", "country", "domain"],
          limit_page_length: 1,
        }),
        ...withSilent(),
      }
    );
    return companies?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function getSystemSettings(): Promise<Record<string, unknown>> {
  try {
    const res = await apiGet<Record<string, unknown>>(
      buildResourceUrl("System Settings", "System Settings"),
      withSilent()
    );
    return res ?? {};
  } catch {
    return {};
  }
}
