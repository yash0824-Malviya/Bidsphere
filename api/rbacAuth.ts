/**
 * Server-side RBAC: HMAC access tokens + role permission checks.
 *
 * Issued at internal login (`typ: "internal"`) and supplier portal login
 * (`typ: "supplier"`). Custom APIs and the ERP proxy require a valid token.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type AppRole =
  | "admin"
  | "procurement"
  | "procurement_team"
  | "finance"
  | "finance_executive"
  | "warehouse"
  | "legal"
  | "department"
  | "manufacturing";

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

const ROLE_USER_EMAILS: Record<string, AppRole> = {
  "admin@netlink.com": "admin",
  "procurement@netlink.com": "procurement",
  "procurement.team@netlink.com": "procurement_team",
  "finance@netlink.com": "finance",
  "finance.executive@netlink.com": "finance_executive",
  "warehouse@netlink.com": "warehouse",
  "legal@netlink.com": "legal",
  "department@netlink.com": "department",
  "manufacturing@netlink.com": "manufacturing",
  "production@netlink.com": "manufacturing",
};

const ERPNEXT_ROLE_MAP: Record<string, AppRole> = {
  Administrator: "admin",
  System: "admin",
  "Finance Admin": "admin",
  "Purchase Manager": "procurement",
  "Procurement Manager": "procurement",
  /** Operational PO ownership — distinct from Procurement Manager. */
  "Procurement Team": "procurement_team",
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
}): AppRole {
  const name = user.name.trim().toLowerCase();
  const email = user.email.trim().toLowerCase();
  if (name === "administrator" || email === "administrator@example.com") {
    return "admin";
  }
  const mapped = ROLE_USER_EMAILS[email] ?? ROLE_USER_EMAILS[name];
  if (mapped) return mapped;

  if (user.erpnext_roles?.length) {
    const priority: AppRole[] = [
      "admin",
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
      const m = ERPNEXT_ROLE_MAP[r];
      if (m) resolved.add(m);
    }
    for (const role of priority) {
      if (resolved.has(role)) return role;
    }
  }
  return "procurement";
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
