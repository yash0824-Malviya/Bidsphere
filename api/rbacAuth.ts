/**
 * Server-side RBAC: HMAC access tokens + role permission checks.
 *
 * Issued at internal login (`typ: "internal"`) and supplier portal login
 * (`typ: "supplier"`). Custom APIs and the ERP proxy require a valid token.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getEcrWorkflowTransition } from "./ecrWorkflowPolicy.js";

export type AppRole =
  | "admin"
  | "procurement"
  | "procurement_team"
  | "finance"
  | "finance_executive"
  | "warehouse"
  | "legal"
  | "department"
  | "manufacturing"
  | "engineer"
  | "engineering"
  | "operations"
  | "quality"
  | "program_manager";

export type AccessPrincipal =
  | {
      typ: "internal";
      sub: string;
      email: string;
      role: AppRole;
      exp: number;
      iat: number;
    }
  | {
      typ: "supplier";
      sub: string;
      supplier: string;
      onboarding?: string;
      exp: number;
      iat: number;
    };

export class RbacError extends Error {
  status: number;

  constructor(message: string, status: 401 | 403 = 401) {
    super(message);
    this.name = "RbacError";
    this.status = status;
  }
}

export interface EcrMutationSnapshot {
  name?: string;
  select_pxfp?: string;
  ecr_owner?: string;
  amended_from?: string;
  owner?: string;
}

const ERPNEXT_ROLE_MAP: Record<string, AppRole> = {
  Administrator: "admin",
  System: "admin",
  "Finance Admin": "admin",
  "Purchase Manager": "procurement",
  "Procurement Manager": "procurement",
  /** Operational PO ownership — distinct from Procurement Manager. */
  "Procurement Team": "procurement_team",
  "Procurement User": "procurement_team",
  "Purchase User": "procurement_team",
  "Accounts Manager": "finance",
  "Accounts Payable": "finance",
  "Accounts User": "finance_executive",
  "Finance Manager": "finance",
  "Finance Executive": "finance_executive",
  "Stock Manager": "warehouse",
  "Stock User": "warehouse",
  "Warehouse Manager": "warehouse",
  "Legal Reviewer": "legal",
  "Department User": "department",
  "Manufacturing Manager": "manufacturing",
  "Production Manager": "manufacturing",
  Engineer: "engineer",
  "Engineering Manager": "engineering",
  "Operations Manager": "operations",
  "Quality Manager": "quality",
  "Program Manager": "program_manager",
};

/** Finance Manager / Accounts Payable / Finance Admin (admin bypass). */
export const FINANCE_PAYABLES_ROLES: AppRole[] = ["finance"];

const INTERNAL_TTL_MS = 12 * 60 * 60 * 1000;
const SUPPLIER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sessionSecret(): string {
  return (
    process.env.BIDSPHERE_SESSION_SECRET ||
    process.env.ERP_API_SECRET ||
    process.env.VITE_API_SECRET ||
    "bidsphere-dev-session-secret"
  );
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}

function sign(payloadB64: string): string {
  return createHmac("sha256", sessionSecret()).update(payloadB64).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function issueInternalAccessToken(input: {
  sub: string;
  email: string;
  role: AppRole;
  ttlMs?: number;
}): string {
  const now = Date.now();
  const payload: AccessPrincipal = {
    typ: "internal",
    sub: input.sub,
    email: input.email,
    role: input.role,
    iat: now,
    exp: now + (input.ttlMs ?? INTERNAL_TTL_MS),
  };
  const body = b64urlJson(payload);
  return `${body}.${sign(body)}`;
}

export function issueSupplierAccessToken(input: {
  supplier: string;
  onboarding?: string;
  ttlMs?: number;
}): string {
  const now = Date.now();
  const payload: AccessPrincipal = {
    typ: "supplier",
    sub: input.supplier,
    supplier: input.supplier,
    onboarding: input.onboarding,
    iat: now,
    exp: now + (input.ttlMs ?? SUPPLIER_TTL_MS),
  };
  const body = b64urlJson(payload);
  return `${body}.${sign(body)}`;
}

export function verifyAccessToken(token: string | null | undefined): AccessPrincipal {
  const raw = String(token || "").trim();
  if (!raw) throw new RbacError("Not authenticated.", 401);
  const parts = raw.split(".");
  if (parts.length !== 2) throw new RbacError("Invalid access token.", 401);
  const [body, sig] = parts;
  if (!safeEqual(sign(body), sig)) {
    throw new RbacError("Invalid access token.", 401);
  }
  let payload: AccessPrincipal;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessPrincipal;
  } catch {
    throw new RbacError("Invalid access token.", 401);
  }
  if (!payload || typeof payload !== "object" || !payload.typ) {
    throw new RbacError("Invalid access token.", 401);
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    throw new RbacError("Session expired. Please sign in again.", 401);
  }
  return payload;
}

export function resolveServerRole(user: {
  name: string;
  email: string;
  erpnext_roles?: string[];
}): AppRole | null {
  const name = user.name.trim().toLowerCase();
  const email = user.email.trim().toLowerCase();
  if (name === "administrator" || email === "administrator@example.com") {
    return "admin";
  }
  if (Array.isArray(user.erpnext_roles)) {
    const priority: AppRole[] = [
      "admin",
      "program_manager",
      "engineering",
      "operations",
      "quality",
      "engineer",
      "legal",
      "finance",
      "finance_executive",
      "manufacturing",
      "warehouse",
      "procurement",
      "procurement_team",
      "department",
    ];
    const resolved = new Set<AppRole>();
    for (const r of user.erpnext_roles) {
      const normalized = r.trim().toLowerCase();
      const m = Object.entries(ERPNEXT_ROLE_MAP).find(
        ([erpRole]) => erpRole.toLowerCase() === normalized,
      )?.[1];
      if (m) resolved.add(m);
    }
    for (const role of priority) {
      if (resolved.has(role)) return role;
    }
    // An explicit empty/unrecognized ERP role list is authoritative. Never
    // resurrect a revoked role from a hard-coded email address.
    return null;
  }
  return null;
}

const ECR_ROLES: AppRole[] = [
  "engineer",
  "engineering",
  "operations",
  "quality",
  "program_manager",
  "procurement_team",
  "procurement",
];

type PrActionRule = { roles: AppRole[]; statuses: string[] };

const PR_WORKFLOW_ACTION_RULES: Record<string, PrActionRule> = {
  "Submit Requisition": {
    roles: ["procurement_team", "procurement"],
    statuses: ["Draft"],
  },
  "Re-Submit after Revision": {
    roles: ["procurement_team", "procurement"],
    statuses: ["Needs Revision"],
  },
  "Cancel Requisition": {
    roles: ["procurement_team", "procurement"],
    statuses: ["Submitted"],
  },
  "Start Review": {
    roles: ["procurement"],
    statuses: ["Submitted"],
  },
  "Approve Requisition": {
    roles: ["procurement"],
    statuses: ["Under Review"],
  },
  "Send Back": {
    roles: ["procurement"],
    statuses: ["Under Review"],
  },
  "Reject Requisition": {
    roles: ["procurement"],
    statuses: ["Under Review"],
  },
  "Close Requisition": {
    roles: ["procurement"],
    statuses: ["RFQ Created"],
  },
};

const ECR_DOWNSTREAM_TRACE_FIELDS = new Set([
  "supplier_quotation",
  "selected_supplier",
  "purchase_order",
]);

const ECR_ENGINEER_EDIT_FIELDS = new Set([
  "ecr_title",
  "ecr_type",
  "priority",
  "requesting_department",
  "plant",
  "program",
  "project",
  "target_implementation_date",
  "chnage_description",
  "reason_for_change",
  "business_justification",
  "current_state",
  "proposed_state",
  "affected_parts",
  "product_impact",
  "material_impact",
  "manufacturing_impact",
  "tooling_impact",
  "quality_impact",
  "cost_impact",
  "supplier_impact",
  "delivery_impact",
  "customer_impact",
  "contract_impact",
  "supplier_response_required",
  "supplier_response_type",
  "suggested_supplier",
  "procurement_reference_type",
  "existing_rfq_reference",
  "existing_purchase_order_reference",
  "required_quantity",
  "quantity_uom",
  "supplier_response_requirements",
  "engineering_notes",
  "engineering_drawing",
  "3d_cad_file",
  "specification",
  "supporting_documents",
  "implementation_notes",
  "implementation_date",
  "validation_status",
  "validation_notes",
  "validation_documents",
]);

const ECR_WORKFLOW_OWNED_FIELDS = new Set([
  "approval_requirements",
  "ecr_number",
  "bidsphere_create_idempotency_key",
  "select_pxfp",
  "status",
  "docstatus",
  "ecr_owner",
  "amended_from",
  "company",
  "owner",
  "creation",
  "modified",
  "modified_by",
  "purchase_requisition",
  "rfq",
]);

const ECR_CREATE_PROTECTED_FIELDS = new Set([
  "approval_requirements",
  "owner",
  "creation",
  "modified",
  "modified_by",
]);

/** Server-side counterpart to the client action matrix. */
export function assertEcrWorkflowPermission(
  principal: Extract<AccessPrincipal, { typ: "internal" }>,
  action: string,
  status: string,
): void {
  const transition = getEcrWorkflowTransition(status, action);
  if (!transition || !transition.roles.includes(principal.role)) {
    throw new RbacError(
      "Access denied. Your role cannot perform this action at the current ECR status.",
      403,
    );
  }
}

/** Server-side counterpart to the Purchase Requisition workflow. */
export function assertPrWorkflowPermission(
  principal: Extract<AccessPrincipal, { typ: "internal" }>,
  action: string,
  status: string,
): void {
  const rule = PR_WORKFLOW_ACTION_RULES[action];
  if (!rule || !rule.statuses.includes(status)) {
    throw new RbacError(
      "Access denied. Your role cannot perform this Purchase Requisition action at the current status.",
      403,
    );
  }
  if (principal.role === "admin") return;
  if (!rule.roles.includes(principal.role)) {
    throw new RbacError(
      "Access denied. Your role cannot perform this Purchase Requisition action at the current status.",
      403,
    );
  }
}

function normalizedApiPath(apiPath: string): string {
  try {
    return decodeURIComponent(apiPath.replace(/^\/+/, "").replace(/\+/g, " "));
  } catch {
    return apiPath.replace(/^\/+/, "");
  }
}

function recordBody(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      return parsed && typeof parsed === "object"
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/**
 * Enforce ECR mutation ownership at the trusted ERP proxy. `currentStatus` is
 * loaded server-side by the proxy, never accepted from the browser.
 */
export function enforceEcrMutationRbac(
  principal: AccessPrincipal,
  apiPath: string,
  method: string,
  body?: unknown,
  currentStatus?: string,
  currentDocument?: EcrMutationSnapshot | null,
): void {
  const m = method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(m)) return;
  const path = normalizedApiPath(apiPath);
  const payload = recordBody(body);
  const doc = recordBody(payload.doc);
  const doctype = String(doc.doctype || payload.doctype || "");
  const isEcrResource =
    path === "resource/Engineering Change Request" ||
    path.startsWith("resource/Engineering Change Request/");
  const isEcrWorkflow =
    path === "method/frappe.model.workflow.apply_workflow" &&
    doctype === "Engineering Change Request";
  const isEcrComment =
    path === "resource/Comment" &&
    String(payload.reference_doctype || "") === "Engineering Change Request";
  const isEcrGenericMutation =
    path.startsWith("method/") &&
    !isEcrWorkflow &&
    doctype === "Engineering Change Request";

  if (!isEcrResource && !isEcrWorkflow && !isEcrComment && !isEcrGenericMutation) return;
  if (principal.typ !== "internal") {
    throw new RbacError("Forbidden. Internal authentication required.", 403);
  }
  if (isEcrGenericMutation) {
    throw new RbacError(
      "Generic ERP document mutations are disabled for Engineering Change Requests.",
      403,
    );
  }
  if (isEcrResource && path === "resource/Engineering Change Request" && m === "POST") {
    throw new RbacError(
      "New ECRs must use the secured /api/ecr-create endpoint.",
      403,
    );
  }
  if (
    isEcrResource &&
    ["PUT", "PATCH"].includes(m) &&
    (
      Object.prototype.hasOwnProperty.call(payload, "select_pxfp") ||
      Object.prototype.hasOwnProperty.call(payload, "docstatus")
    )
  ) {
    throw new RbacError(
      "ECR status can only be changed through an authorized workflow action.",
      403,
    );
  }
  if (
    isEcrResource &&
    m === "POST" &&
    (
      (Object.prototype.hasOwnProperty.call(payload, "select_pxfp") &&
        String(payload.select_pxfp || "Draft") !== "Draft") ||
      Number(payload.docstatus || 0) !== 0
    )
  ) {
    throw new RbacError("New ECRs must be created in Draft status.", 403);
  }
  if (
    isEcrResource &&
    m === "POST" &&
    Object.keys(payload).some((field) => ECR_CREATE_PROTECTED_FIELDS.has(field))
  ) {
    throw new RbacError(
      "New ECR approval tasks and audit metadata are server-managed.",
      403,
    );
  }
  if (isEcrResource && ["PUT", "PATCH"].includes(m)) {
    const protectedFields = Object.keys(payload).filter((field) =>
      ECR_WORKFLOW_OWNED_FIELDS.has(field),
    );
    if (protectedFields.length > 0) {
      throw new RbacError(
        "ECR workflow tasks, business number, and audit metadata are server-managed.",
        403,
      );
    }
  }
  if (isEcrWorkflow) {
    throw new RbacError(
      "ECR workflow actions must use the secured /api/ecr-workflow-action endpoint.",
      403,
    );
  }

  if (principal.role === "admin") return;

  if (!ECR_ROLES.includes(principal.role)) {
    throw new RbacError("Access denied. Engineering Change access is required.", 403);
  }

  if (isEcrComment) return;

  if (isEcrResource && m === "POST") {
    requireRoles(principal, ["engineer"]);
    const requestedOwner = String(payload.ecr_owner || "").trim().toLowerCase();
    const identities = new Set([principal.sub, principal.email].map((value) => value.trim().toLowerCase()));
    if (requestedOwner && !identities.has(requestedOwner)) {
      throw new RbacError("Engineers can create ECRs only for themselves.", 403);
    }
    return;
  }

  if (isEcrResource && ["PUT", "PATCH", "DELETE"].includes(m)) {
    if (m === "DELETE") {
      throw new RbacError("Only an administrator can delete an ECR.", 403);
    }
    requireRoles(principal, ["engineer", "procurement_team", "procurement"]);
    if (principal.role === "engineer" && !["Draft", "Sent Back", "Needs Revision"].includes(currentStatus || "")) {
      throw new RbacError("Engineers can edit only Draft or Sent Back ECRs.", 403);
    }
    if (principal.role === "engineer") {
      const identities = new Set([principal.sub, principal.email].map((value) => value.trim().toLowerCase()));
      const owners = [currentDocument?.ecr_owner, currentDocument?.amended_from, currentDocument?.owner]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());
      if (owners.length === 0 || !owners.some((owner) => identities.has(owner))) {
        throw new RbacError("Access denied. Engineers can edit only their own ECRs.", 403);
      }
      const disallowed = Object.keys(payload).filter(
        (field) => field !== "access_token" && !ECR_ENGINEER_EDIT_FIELDS.has(field),
      );
      if (disallowed.length > 0) {
        throw new RbacError(
          `Engineers cannot update server-managed ECR fields: ${disallowed.join(", ")}.`,
          403,
        );
      }
    }
    if (
      (principal.role === "procurement" || principal.role === "procurement_team") &&
      !["Procurement Review", "RFQ Pending", "RFQ"].includes(currentStatus || "")
    ) {
      throw new RbacError("Procurement can update ECR traceability only during the procurement and RFQ stages.", 403);
    }
    if (principal.role === "procurement" || principal.role === "procurement_team") {
      const disallowed = Object.keys(payload).filter(
        (field) => field !== "access_token" && !ECR_DOWNSTREAM_TRACE_FIELDS.has(field),
      );
      if (disallowed.length > 0) {
        throw new RbacError(
          "Procurement can update only downstream ECR traceability fields.",
          403,
        );
      }
    }
  }
}

/** Enforce trusted Purchase Requisition resource and workflow mutations. */
export function enforcePrMutationRbac(
  principal: AccessPrincipal,
  apiPath: string,
  method: string,
  body?: unknown,
  currentStatus?: string,
): void {
  const m = method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(m)) return;
  const path = normalizedApiPath(apiPath);
  const payload = recordBody(body);
  const doc = recordBody(payload.doc);
  const doctype = String(doc.doctype || payload.doctype || payload.dt || "");
  const isPrResource =
    path === "resource/Purchase Requisition" ||
    path.startsWith("resource/Purchase Requisition/");
  const isPrWorkflow =
    path === "method/frappe.model.workflow.apply_workflow" &&
    doctype === "Purchase Requisition";
  const isPrGenericMutation =
    path.startsWith("method/") &&
    !isPrWorkflow &&
    doctype === "Purchase Requisition";

  if (!isPrResource && !isPrWorkflow && !isPrGenericMutation) return;
  if (principal.typ !== "internal") {
    throw new RbacError("Forbidden. Internal authentication required.", 403);
  }
  if (isPrGenericMutation) {
    throw new RbacError(
      "Generic ERP document mutations are disabled for Purchase Requisitions.",
      403,
    );
  }
  if (
    isPrResource &&
    Object.prototype.hasOwnProperty.call(payload, "data")
  ) {
    throw new RbacError(
      "Wrapped data payloads are not allowed for Purchase Requisition mutations.",
      403,
    );
  }
  if (
    isPrResource &&
    ["PUT", "PATCH"].includes(m) &&
    (
      Object.prototype.hasOwnProperty.call(payload, "status") ||
      Object.prototype.hasOwnProperty.call(payload, "docstatus")
    )
  ) {
    throw new RbacError(
      "Purchase Requisition status can only be changed through an authorized workflow action.",
      403,
    );
  }
  if (
    isPrResource &&
    m === "POST" &&
    (
      (Object.prototype.hasOwnProperty.call(payload, "status") &&
        String(payload.status || "Draft") !== "Draft") ||
      Number(payload.docstatus || 0) !== 0
    )
  ) {
    throw new RbacError("New Purchase Requisitions must be created in Draft status.", 403);
  }
  if (
    isPrResource &&
    m === "POST" &&
    (
      String(payload.ecr_reference || "").trim() ||
      String(payload.custom_bidsphere_ecr_idempotency_key || "").trim()
    )
  ) {
    throw new RbacError(
      "ECR-linked Purchase Requisitions must use the secured /api/create-pr-from-ecr endpoint.",
      403,
    );
  }
  if (
    isPrResource &&
    ["PUT", "PATCH"].includes(m) &&
    (
      Object.prototype.hasOwnProperty.call(payload, "ecr_reference") ||
      Object.prototype.hasOwnProperty.call(
        payload,
        "custom_bidsphere_ecr_idempotency_key",
      )
    )
  ) {
    throw new RbacError(
      "Purchase Requisition ECR traceability is server-managed.",
      403,
    );
  }
  if (isPrWorkflow) {
    if (!currentStatus) {
      throw new RbacError("Unable to verify the current Purchase Requisition status.", 403);
    }
    assertPrWorkflowPermission(principal, String(payload.action || ""), currentStatus);
    return;
  }

  if (principal.role === "admin") return;

  requireRoles(principal, ["procurement_team", "procurement"]);
  if (m === "DELETE") {
    throw new RbacError("Only an administrator can delete a Purchase Requisition.", 403);
  }
  if (["PUT", "PATCH"].includes(m)) {
    if (!currentStatus) {
      throw new RbacError("Unable to verify the current Purchase Requisition status.", 403);
    }
    if (
      principal.role !== "procurement_team" ||
      !["Draft", "Needs Revision"].includes(currentStatus)
    ) {
      throw new RbacError(
        "Purchase Requisition details can be edited only by Procurement Team while Draft or Needs Revision.",
        403,
      );
    }
  }
}

/** Header names the SPA / portal send. */
export function extractAccessToken(
  headers: Record<string, unknown> | undefined,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): string {
  const read = (key: string): string => {
    if (!headers) return "";
    const v = headers[key] ?? headers[key.toLowerCase()];
    if (Array.isArray(v)) return String(v[0] ?? "").trim();
    return typeof v === "string" ? v.trim() : "";
  };

  const headerToken =
    read("x-bidsphere-access-token") ||
    read("X-Bidsphere-Access-Token");
  if (headerToken) return headerToken;

  const auth = read("authorization") || read("Authorization");
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer?.[1] && !bearer[1].startsWith("token ")) {
    return bearer[1].trim();
  }

  if (typeof body?.access_token === "string") return body.access_token.trim();

  if (query) {
    const q = query.access_token ?? query.token;
    if (Array.isArray(q)) return String(q[0] ?? "").trim();
    if (typeof q === "string") return q.trim();
  }
  return "";
}

export function requireInternalAuth(
  headers: Record<string, unknown> | undefined,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Extract<AccessPrincipal, { typ: "internal" }> {
  const principal = verifyAccessToken(extractAccessToken(headers, body, query));
  if (principal.typ !== "internal") {
    throw new RbacError("Forbidden. Internal authentication required.", 403);
  }
  return principal;
}

export function requireSupplierAuth(
  headers: Record<string, unknown> | undefined,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Extract<AccessPrincipal, { typ: "supplier" }> {
  const token = extractAccessToken(headers, body, query);
  if (!token) {
    throw new RbacError(
      "Not authenticated. Please sign in again to the Supplier Portal.",
      401,
    );
  }
  const principal = verifyAccessToken(token);
  if (principal.typ !== "supplier") {
    throw new RbacError(
      "Forbidden. Supplier Portal authentication is required. Finance users can only review supplier-submitted invoices.",
      403,
    );
  }
  return principal;
}

/** Any authenticated principal (internal user or supplier). */
export function requireAnyAuth(
  headers: Record<string, unknown> | undefined,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): AccessPrincipal {
  return verifyAccessToken(extractAccessToken(headers, body, query));
}

export function requireRoles(
  principal: Extract<AccessPrincipal, { typ: "internal" }>,
  allowed: AppRole[],
): void {
  if (principal.role === "admin") return;
  if (!allowed.includes(principal.role)) {
    throw new RbacError(
      "Access denied. You don't have permission to perform this action.",
      403,
    );
  }
}

function bodyDoctype(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  if (typeof b.doctype === "string") return b.doctype;
  const doc = b.doc;
  if (doc && typeof doc === "object" && typeof (doc as { doctype?: string }).doctype === "string") {
    return (doc as { doctype: string }).doctype;
  }
  return "";
}

/**
 * Enforce finance-payables RBAC on ERP proxy mutations.
 *
 * - Purchase Invoice / Payment Entry / make_purchase_invoice → Finance only
 * - Voucher writes → Finance (internal) OR authenticated Supplier (portal)
 * - Procurement / Warehouse / Legal cannot create invoices or release payments
 */
export function enforcePayablesMutationRbac(
  principal: AccessPrincipal,
  apiPath: string,
  method: string,
  body?: unknown,
): void {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return;

  const path = apiPath.replace(/^\/+/, "");
  const doctype = bodyDoctype(body);
  const isVoucherResource =
    path === "resource/Voucher" || path.startsWith("resource/Voucher/");
  const isPiResource =
    path === "resource/Purchase%20Invoice" ||
    path.startsWith("resource/Purchase%20Invoice/") ||
    path === "resource/Purchase Invoice" ||
    path.startsWith("resource/Purchase Invoice/");
  const isPeResource =
    path === "resource/Payment%20Entry" ||
    path.startsWith("resource/Payment%20Entry/") ||
    path === "resource/Payment Entry" ||
    path.startsWith("resource/Payment Entry/");
  const isMakePi =
    path.includes("make_purchase_invoice") ||
    path.includes("make_purchase_invoice_from_purchase_receipt");
  const isClientPayables =
    (path.startsWith("method/frappe.client.") ||
      path.startsWith("method/frappe.desk.form.save")) &&
    (doctype === "Voucher" ||
      doctype === "Purchase Invoice" ||
      doctype === "Payment Entry");

  const touchesPayables =
    isVoucherResource ||
    isPiResource ||
    isPeResource ||
    isMakePi ||
    isClientPayables;

  if (!touchesPayables) return;

  const voucherOnly =
    isVoucherResource || (isClientPayables && doctype === "Voucher");

  if (principal.typ === "supplier") {
    if (voucherOnly) return;
    throw new RbacError(
      "Access denied. Suppliers cannot create ERPNext invoices or payment entries.",
      403,
    );
  }

  requireRoles(principal, FINANCE_PAYABLES_ROLES);
}

/** Procurement onboarding admin actions. */
export const PROCUREMENT_ONBOARDING_ROLES: AppRole[] = [
  "admin",
  "procurement",
];

/** Legal review write APIs. */
export const LEGAL_REVIEW_ROLES: AppRole[] = ["admin", "legal"];

/** Finance review write APIs (same gateway may serve finance). */
export const FINANCE_REVIEW_ROLES: AppRole[] = ["admin", "finance"];

/** Department BOM upload / validation (NOT procurement). */
export const DEPARTMENT_BOM_ROLES: AppRole[] = ["admin", "department", "manufacturing"];

/** Master Data — Temporary Item Store review. */
export const MASTER_DATA_BOM_ROLES: AppRole[] = ["admin", "manufacturing"];

/** @deprecated Legacy procurement RFQ-from-BOM — admin-only fallback. */
export const BOM_RFQ_LEGACY_ROLES: AppRole[] = ["admin"];

/** BOM APIs — department upload + master data (procurement excluded). */
export const BOM_ROLES: AppRole[] = [...DEPARTMENT_BOM_ROLES, ...MASTER_DATA_BOM_ROLES].filter(
  (r, i, a) => a.indexOf(r) === i,
);

/** Map supplier-onboarding action → required roles (null = public / portal-session). */
export function rolesForOnboardingAction(action: string): AppRole[] | "portal" | "public" {
  switch (action) {
    case "portal-login":
    case "portal-forgot-password":
    case "portal-reset-password-otp":
    case "get-by-token":
    case "list-categories":
    case "legacy-pin-token":
      return "public";
    case "portal-profile":
    case "portal-save-draft":
    case "portal-submit":
    case "portal-comment":
    case "portal-change-password":
    case "portal-security":
    case "portal-change-pin":
    case "portal-logout-others":
    case "supplier-save-draft":
    case "supplier-submit":
    case "resolve-upload":
    case "discussion-list":
    case "discussion-send":
    case "discussion-read":
    case "discussion-resolve":
    case "discussion-mark-read":
      return "portal";
    default:
      // Legacy PIN profile APIs + any legacy-pin-* action
      if (action.startsWith("legacy-pin-")) return "portal";
      // list, get, create, save-draft, generate-*, approve, reject, stats, …
      return PROCUREMENT_ONBOARDING_ROLES;
  }
}
