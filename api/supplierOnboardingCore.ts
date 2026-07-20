/**
 * Supplier Onboarding — server-owned business logic.
 *
 * Creates Supplier Master ONLY on final approval.
 * Never touches RFQ / PO / existing portal session cookies.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import {
  getOnboardingSteps,
  splitPayload,
  type OnboardingStepDef,
} from "../src/config/supplierOnboardingForm.js";
import {
  PORTAL_PASSWORD_MAX_LEN,
  PORTAL_PASSWORD_MIN_LEN,
  PORTAL_PASSWORD_POLICY_MESSAGE,
  logPortalPasswordValidation,
  validatePortalPassword,
} from "../src/utils/supplierPortalPassword.js";
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";

export const DOCTYPE = "Supplier Onboarding";
export const CATEGORY_DOCTYPE = "Supplier Category";

export const ONBOARDING_APPROVAL_STAGES = [
  { id: "procurement", label: "Procurement", order: 1 },
] as const;

export class OnboardingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "OnboardingError";
    this.status = status;
  }
}

export interface ErpAdminConfig {
  baseUrl: string;
  key: string;
  secret: string;
}

export function readErpAdminConfig(): ErpAdminConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!baseUrl || !key || !secret) {
    throw new OnboardingError(
      "Onboarding backend misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET.",
      503,
    );
  }
  return { baseUrl, key, secret };
}

function linkExpiryDays(): number {
  const n = parseInt(process.env.ONBOARDING_LINK_EXPIRY_DAYS || "7", 10);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown; formData?: FormData },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `token ${cfg.key}:${cfg.secret}`,
    Accept: "application/json",
  };
  let body: BodyInit | undefined;
  if (init?.formData) {
    body = init.formData as unknown as BodyInit;
  } else if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(sanitizeErpPayloadDates(init.body));
  }
  const res = await fetch(`${cfg.baseUrl}/api/${path}`, {
    method: init?.method ?? "GET",
    headers,
    body,
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const errObj = data as Record<string, unknown>;
    const msg =
      (typeof errObj.message === "string" && errObj.message) ||
      (typeof errObj.exception === "string" && errObj.exception) ||
      (typeof errObj._server_messages === "string" && errObj._server_messages) ||
      `ERPNext request failed (${res.status})`;
    throw new OnboardingError(String(msg).slice(0, 500), res.status >= 500 ? 502 : 400);
  }
  const envelope = data as { message?: T; data?: T };
  if (envelope.data !== undefined) return envelope.data;
  if (envelope.message !== undefined) return envelope.message;
  return data as T;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }
  return [];
}

function parseFormData(raw: unknown): {
  version: number;
  fields: Record<string, unknown>;
  portal?: PortalMeta;
} {
  if (!raw) return { version: 1, fields: {} };
  if (typeof raw === "object" && raw !== null && "fields" in (raw as object)) {
    const obj = raw as { version?: number; fields: Record<string, unknown>; portal?: PortalMeta };
    return { version: obj.version ?? 1, fields: obj.fields || {}, portal: obj.portal };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.fields) {
        return {
          version: parsed.version ?? 1,
          fields: parsed.fields || {},
          portal: parsed.portal,
        };
      }
      return { version: 1, fields: parsed && typeof parsed === "object" ? parsed : {} };
    } catch {
      return { version: 1, fields: {} };
    }
  }
  return { version: 1, fields: {} };
}

export type PortalComment = {
  id: string;
  author: string;
  role: "procurement" | "supplier";
  text: string;
  at: string;
};

export type PortalLoginHistoryEntry = {
  id: string;
  at: string;
  browser: string;
  device: string;
  ip: string;
  status: "Success" | "Failed";
  auth_mode: "account" | "pin";
};

export type PortalActiveSession = {
  id: string;
  /** SHA-256 of session token — never store raw token in the list. */
  token_hash: string;
  created_at: string;
  last_seen: string;
  browser: string;
  device: string;
  ip: string;
};

export type PortalClientMeta = {
  browser?: string;
  device?: string;
  ip?: string;
  user_agent?: string;
};

export type PortalMeta = {
  password_hash?: string;
  password_salt?: string;
  temp_password?: string;
  first_login?: boolean;
  session_token?: string;
  session_expires?: string;
  unlocked?: boolean;
  comments?: PortalComment[];
  /** Mirror of Onboarding Discussion child rows (source of truth for the app). */
  discussion?: DiscussionMessage[];
  notify_supplier?: boolean;
  notify_procurement?: boolean;
  /** Hashed 4-digit portal PIN (legacy PIN login). */
  pin_hash?: string;
  pin_salt?: string;
  /** Password-reset OTP (hashed). */
  otp_hash?: string;
  otp_salt?: string;
  otp_expires?: string;
  otp_attempts?: number;
  login_history?: PortalLoginHistoryEntry[];
  active_sessions?: PortalActiveSession[];
};

export const DISCUSSION_SECTION_TAGS = [
  "Company",
  "Contact",
  "Business",
  "Plant & Capacity",
  "Bank",
  "Documents",
  "Review",
] as const;

export type DiscussionSectionTag = (typeof DISCUSSION_SECTION_TAGS)[number] | "";

export type DiscussionMessage = {
  message_id: string;
  sender_role: "Supplier" | "Procurement";
  sender_name: string;
  message: string;
  sent_on: string;
  section_tag?: DiscussionSectionTag | string;
  file_url?: string;
  file_name?: string;
  resolved?: number;
  resolved_by?: string;
  resolved_on?: string;
  read_by_supplier?: number;
  read_by_procurement?: number;
};

export type DiscussionViewer = "supplier" | "procurement";

function mapSectionIdToTag(sectionId: string): DiscussionSectionTag {
  const id = String(sectionId || "").toLowerCase();
  if (id === "company") return "Company";
  if (id === "contact") return "Contact";
  if (id === "business") return "Business";
  if (id === "type_details" || id === "plant_capacity" || id.includes("plant")) {
    return "Plant & Capacity";
  }
  if (id === "bank") return "Bank";
  if (id === "documents") return "Documents";
  if (id === "review") return "Review";
  const hit = DISCUSSION_SECTION_TAGS.find(
    (t) => t.toLowerCase() === String(sectionId || "").toLowerCase(),
  );
  return (hit as DiscussionSectionTag) || "";
}

function discussionRowFromAny(raw: Record<string, unknown>): DiscussionMessage | null {
  const messageId = String(raw.message_id || raw.id || "").trim();
  const message = String(raw.message || raw.text || "").trim();
  if (!messageId && !message) return null;
  const roleRaw = String(raw.sender_role || raw.role || "").toLowerCase();
  const sender_role: "Supplier" | "Procurement" = roleRaw.includes("procure")
    ? "Procurement"
    : "Supplier";
  return {
    message_id: messageId || randomBytes(8).toString("hex"),
    sender_role,
    sender_name: String(raw.sender_name || raw.author || sender_role),
    message,
    sent_on: String(raw.sent_on || raw.at || nowIso()),
    section_tag: String(raw.section_tag || "") || "",
    file_url: String(raw.file_url || "") || undefined,
    file_name: String(raw.file_name || "") || undefined,
    resolved: Number(raw.resolved || 0) ? 1 : 0,
    resolved_by: String(raw.resolved_by || "") || undefined,
    resolved_on: String(raw.resolved_on || "") || undefined,
    read_by_supplier: Number(raw.read_by_supplier || 0) ? 1 : 0,
    read_by_procurement: Number(raw.read_by_procurement || 0) ? 1 : 0,
  };
}

function sortDiscussionMessages(list: DiscussionMessage[]): DiscussionMessage[] {
  return [...list].sort((a, b) => {
    const parse = (v: string) => {
      const normalized = /Z$/i.test(v)
        ? v
        : v.includes("T")
          ? `${v}Z`
          : `${v.replace(" ", "T")}Z`;
      return new Date(normalized).getTime();
    };
    const aMs = parse(String(a.sent_on || ""));
    const bMs = parse(String(b.sent_on || ""));
    if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return aMs - bMs;
    return String(a.sent_on || "").localeCompare(String(b.sent_on || ""));
  });
}

function readDiscussionMessages(doc: OnboardingDoc): DiscussionMessage[] {
  const fromChild = asArray<Record<string, unknown>>(doc.discussion)
    .map((r) => discussionRowFromAny(r))
    .filter((x): x is DiscussionMessage => !!x);
  const portal = getPortalMeta(doc);
  const fromPortal = (portal.discussion || [])
    .map((r) => discussionRowFromAny(r as unknown as Record<string, unknown>))
    .filter((x): x is DiscussionMessage => !!x);

  // Prefer the richer source; merge by message_id
  const byId = new Map<string, DiscussionMessage>();
  for (const m of [...fromPortal, ...fromChild]) {
    byId.set(m.message_id, m);
  }

  // One-time bridge from legacy portal.comments
  if (byId.size === 0 && portal.comments?.length) {
    for (const c of portal.comments) {
      const id = String(c.id || randomBytes(8).toString("hex"));
      byId.set(id, {
        message_id: id,
        sender_role: c.role === "procurement" ? "Procurement" : "Supplier",
        sender_name: c.author || (c.role === "procurement" ? "Procurement" : "Supplier"),
        message: c.text,
        sent_on: c.at,
        section_tag: "",
        resolved: 0,
        read_by_supplier: c.role === "supplier" ? 1 : 0,
        read_by_procurement: c.role === "procurement" ? 1 : 0,
      });
    }
  }

  return sortDiscussionMessages([...byId.values()]);
}

function countUnread(messages: DiscussionMessage[], viewer: DiscussionViewer): number {
  return messages.filter((m) => {
    if (m.sender_role === (viewer === "supplier" ? "Supplier" : "Procurement")) return false;
    if (viewer === "supplier") return !m.read_by_supplier;
    return !m.read_by_procurement;
  }).length;
}

function writeDiscussionMessages(doc: OnboardingDoc, messages: DiscussionMessage[]) {
  const sorted = sortDiscussionMessages(messages);
  doc.discussion = sorted.map((m) => ({
    doctype: "Onboarding Discussion",
    message_id: m.message_id,
    sender_role: m.sender_role,
    sender_name: m.sender_name,
    message: m.message,
    sent_on: m.sent_on,
    section_tag: m.section_tag || "",
    file_url: m.file_url || "",
    file_name: m.file_name || "",
    resolved: m.resolved ? 1 : 0,
    resolved_by: m.resolved_by || "",
    resolved_on: m.resolved_on || "",
    read_by_supplier: m.read_by_supplier ? 1 : 0,
    read_by_procurement: m.read_by_procurement ? 1 : 0,
  }));
  doc.unread_for_procurement = countUnread(sorted, "procurement");
  doc.unread_for_supplier = countUnread(sorted, "supplier");

  const portal = getPortalMeta(doc);
  setPortalMeta(doc, {
    ...portal,
    discussion: sorted,
    notify_procurement: countUnread(sorted, "procurement") > 0,
    notify_supplier: countUnread(sorted, "supplier") > 0,
  });
}

function buildDiscussionPayload(doc: OnboardingDoc, viewer: DiscussionViewer) {
  const messages = readDiscussionMessages(doc);
  return {
    messages,
    unread_count: countUnread(messages, viewer),
    unread_for_procurement: countUnread(messages, "procurement"),
    unread_for_supplier: countUnread(messages, "supplier"),
    notify:
      viewer === "supplier"
        ? !!getPortalMeta(doc).notify_supplier
        : !!getPortalMeta(doc).notify_procurement,
    section_tags: [...DISCUSSION_SECTION_TAGS],
  };
}

function getPortalMeta(doc: OnboardingDoc): PortalMeta {
  return { ...(parseFormData(doc.form_data).portal || {}) };
}

function writeFormData(
  doc: OnboardingDoc,
  fields: Record<string, unknown>,
  portal?: PortalMeta,
) {
  const current = parseFormData(doc.form_data);
  doc.form_data = JSON.stringify({
    version: 1,
    fields,
    portal: portal !== undefined ? portal : current.portal,
  });
}

function setPortalMeta(doc: OnboardingDoc, portal: PortalMeta) {
  const current = parseFormData(doc.form_data);
  writeFormData(doc, current.fields, portal);
}

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = hashPassword(password, salt);
  try {
    const a = Buffer.from(actual, "hex");
    const b = Buffer.from(expectedHash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function stripFrappeNoise(raw: string): string {
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isPasswordPolicyError(msg: string): boolean {
  return /password|Policy|must include|at least|weak|invalid.*password|PasswordPolicy/i.test(
    msg,
  );
}

/**
 * Cryptographically secure temporary password.
 * Never derived from company / contact / email / year / supplier code.
 * Meets typical ERPNext policy: length + upper + lower + digit + special.
 */
function makeTempPassword(length = 16): string {
  const len = Math.min(PORTAL_PASSWORD_MAX_LEN, Math.max(PORTAL_PASSWORD_MIN_LEN, length));
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%^&*-_=+";
  const all = upper + lower + digits + special;

  const pick = (alphabet: string) => alphabet[randomBytes(1)[0]! % alphabet.length]!;

  // Guarantee one of each required class, then fill randomly
  const required = [pick(upper), pick(lower), pick(digits), pick(special)];
  const rest: string[] = [];
  for (let i = required.length; i < len; i++) {
    rest.push(pick(all));
  }

  // Fisher–Yates shuffle using crypto bytes
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return chars.join("");
}

function meetsPasswordPolicy(password: string): boolean {
  return validatePortalPassword(password).ok;
}

async function createOrResetPortalUser(
  cfg: ErpAdminConfig,
  email: string,
  firstName: string,
  maxAttempts = 4,
): Promise<{ password: string; created: boolean }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const password = makeTempPassword(12 + (attempt % 5)); // within 8–32 policy
    if (!meetsPasswordPolicy(password)) continue;

    try {
      await erpFetch(cfg, "resource/User", {
        method: "POST",
        body: {
          email,
          first_name: firstName,
          new_password: password,
          send_welcome_email: 0,
          roles: [{ role: "Supplier" }],
        },
      });
      return { password, created: true };
    } catch (err) {
      lastErr = err;
      const msg = stripFrappeNoise(err instanceof Error ? err.message : String(err));

      if (/already exists|Duplicate|UniqueValidationError/i.test(msg)) {
        // Existing user — reset password with retries on policy failure
        for (let resetAttempt = 0; resetAttempt < maxAttempts; resetAttempt++) {
          const resetPassword = makeTempPassword(12 + (resetAttempt % 5));
          try {
            await erpFetch(cfg, `resource/User/${encodeURIComponent(email)}`, {
              method: "PUT",
              body: { new_password: resetPassword },
            });
            return { password: resetPassword, created: false };
          } catch (resetErr) {
            lastErr = resetErr;
            const resetMsg = stripFrappeNoise(
              resetErr instanceof Error ? resetErr.message : String(resetErr),
            );
            if (!isPasswordPolicyError(resetMsg)) {
              throw new OnboardingError(
                "Could not update the portal user password. Please try again or contact support.",
                502,
              );
            }
          }
        }
        throw new OnboardingError(
          "Could not set a temporary password that meets ERPNext password policy. Please try again.",
          502,
        );
      }

      if (isPasswordPolicyError(msg)) {
        continue; // retry with a new password
      }

      throw new OnboardingError(
        "Could not create the supplier portal user. Please try again or contact support.",
        502,
      );
    }
  }

  const friendly = stripFrappeNoise(
    lastErr instanceof Error ? lastErr.message : String(lastErr || ""),
  );
  throw new OnboardingError(
    isPasswordPolicyError(friendly)
      ? "Could not set a temporary password that meets ERPNext password policy. Please try again."
      : "Could not create the supplier portal user. Please try again or contact support.",
    502,
  );
}

/**
 * Best-effort password setup / reset link so the supplier can choose their own password.
 * Falls back to portal login URL when ERPNext does not return a key.
 */
async function generatePasswordSetupLink(
  cfg: ErpAdminConfig,
  email: string,
  origin?: string,
): Promise<string> {
  const base = (origin || "").replace(/\/$/, "") || cfg.baseUrl.replace(/\/$/, "");
  const portalLogin = `${base}/supplier/login`;

  const tryExtractKey = (result: unknown): string | null => {
    if (!result) return null;
    if (typeof result === "string" && result.length > 8 && !result.includes(" ")) {
      return result;
    }
    if (typeof result === "object" && result !== null) {
      const obj = result as Record<string, unknown>;
      for (const key of ["message", "key", "reset_key", "data"]) {
        const val = obj[key];
        if (typeof val === "string" && val.length > 8 && !/<html/i.test(val)) {
          return val;
        }
        if (val && typeof val === "object" && "key" in (val as object)) {
          const nested = (val as { key?: unknown }).key;
          if (typeof nested === "string" && nested.length > 8) return nested;
        }
      }
    }
    return null;
  };

  const methods = [
    "method/frappe.core.doctype.user.user.reset_password",
    "method/frappe.utils.password.reset_password",
  ];

  for (const method of methods) {
    try {
      const result = await erpFetch(cfg, method, {
        method: "POST",
        body: { user: email, send_email: 0 },
      });
      const key = tryExtractKey(result);
      if (key) {
        return `${cfg.baseUrl.replace(/\/$/, "")}/update-password?key=${encodeURIComponent(key)}`;
      }
    } catch {
      /* try next */
    }
  }

  return portalLogin;
}

function formDataEquals(
  a: { version: number; fields: Record<string, unknown> },
  b: { version: number; fields: Record<string, unknown> },
): boolean {
  return JSON.stringify(a.fields ?? {}) === JSON.stringify(b.fields ?? {});
}

function normalizeScalar(v: unknown): string {
  if (v === true || v === 1 || v === "1") return "1";
  if (v === false || v === 0 || v === "0") return "0";
  if (v == null) return "";
  return String(v).trim();
}

function timelineRow(event: string, actor: string, notes = "") {
  return {
    doctype: "Supplier Onboarding Timeline",
    event,
    event_on: nowIso(),
    actor: actor || "System",
    notes,
  };
}

/** One-shot timeline events — never duplicate on the same document. */
const UNIQUE_TIMELINE_EVENTS = new Set([
  "Created",
  "Credentials Generated",
  "Link Generated",
  "Opened",
  "First Login",
  "Password Changed",
  "Submitted",
  "Under Review",
  "Procurement Review",
  "Supplier Created",
  "Contact Created",
  "Address Created",
  "Portal User Created",
  "Password Link Generated",
  "Approved",
  "Rejected",
  "Expired",
]);

function hasTimelineEvent(doc: OnboardingDoc, event: string): boolean {
  return (doc.timeline || []).some((t) => String(t.event || "") === event);
}

/** True when another finalize is actively running (timeline-based; not approval_status). */
function isFinalizeInFlight(doc: OnboardingDoc): boolean {
  if (doc.status === "Approved") return false;
  const events = doc.timeline || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = String(events[i].event || "");
    if (e === "Approved" || e === "Supplier Creation Failed") return false;
    if (e === "Supplier Creation Started") return true;
  }
  return false;
}

function pushTimeline(
  doc: OnboardingDoc,
  event: string,
  actor: string,
  notes = "",
  opts?: { allowDuplicate?: boolean },
): boolean {
  if (!opts?.allowDuplicate) {
    if (UNIQUE_TIMELINE_EVENTS.has(event) && hasTimelineEvent(doc, event)) {
      return false;
    }
    // "Changes Requested" / "Draft Saved" / "Resubmitted" / "Supplier Creation Started"
    // may repeat when the action genuinely occurs again
  }
  const timeline = [...(doc.timeline || [])];
  timeline.push(timelineRow(event, actor, notes));
  doc.timeline = timeline;
  return true;
}

export type OnboardingDoc = Record<string, unknown> & {
  name?: string;
  status?: string;
  modified?: string;
  secure_token?: string;
  token_expires_on?: string;
  supplier_type?: string;
  supplier_category?: string;
  erp_supplier_group?: string;
  company_name?: string;
  form_data?: string;
  timeline?: Array<Record<string, unknown>>;
  documents?: Array<Record<string, unknown>>;
  approvals?: Array<Record<string, unknown>>;
  discussion?: Array<Record<string, unknown>>;
  unread_for_procurement?: number;
  unread_for_supplier?: number;
  linked_supplier?: string;
};

async function getDoc(cfg: ErpAdminConfig, name: string): Promise<OnboardingDoc> {
  return erpFetch(cfg, `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`);
}

async function findByToken(cfg: ErpAdminConfig, token: string): Promise<OnboardingDoc | null> {
  const list = await erpFetch(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}?` +
      new URLSearchParams({
        filters: JSON.stringify([["secure_token", "=", token]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: "1",
      }).toString(),
  );
  const rows = asArray<{ name: string }>(list);
  if (!rows[0]?.name) return null;
  return getDoc(cfg, rows[0].name);
}

function isExpired(doc: OnboardingDoc): boolean {
  if (!doc.token_expires_on) return false;
  const exp = new Date(String(doc.token_expires_on).replace(" ", "T"));
  return Number.isFinite(exp.getTime()) && exp.getTime() < Date.now();
}

function isConflictError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /QueryDeadlockError|TimestampMismatchError|Document has been modified|Record has changed since last read|modified after you have loaded|Deadlock/i.test(
    msg,
  );
}

export function toFriendlyOnboardingError(err: unknown): OnboardingError {
  if (err instanceof OnboardingError) return err;
  if (isConflictError(err)) {
    return new OnboardingError(
      "Onboarding already updated. Please refresh and try again.",
      409,
    );
  }
  const msg = stripFrappeNoise(err instanceof Error ? err.message : String(err));
  if (/Link Expired|expired/i.test(msg)) {
    return new OnboardingError("Link expired.", 410);
  }
  if (/Invalid Link/i.test(msg)) {
    return new OnboardingError("Invalid Link", 404);
  }
  if (/Supplier Group/i.test(msg)) {
    return new OnboardingError(
      /not configured|does not exist/i.test(msg)
        ? msg.slice(0, 400)
        : "Supplier Group not configured. Contact your administrator.",
      400,
    );
  }
  if (isPasswordPolicyError(msg)) {
    return new OnboardingError(PORTAL_PASSWORD_POLICY_MESSAGE, 400);
  }
  if (/QueryDeadlockError|TimestampMismatchError|Record has changed/i.test(msg)) {
    return new OnboardingError(
      "Onboarding already updated. Please refresh and try again.",
      409,
    );
  }
  // Avoid leaking raw Frappe/HTML exception pages
  if (/<html|Traceback|frappe\.exceptions/i.test(msg)) {
    return new OnboardingError(
      "Something went wrong while talking to ERPNext. Please try again.",
      502,
    );
  }
  return new OnboardingError(msg.slice(0, 400), 400);
}

function friendlyConflictMessage(err: unknown): OnboardingError {
  return toFriendlyOnboardingError(err);
}

async function saveDoc(
  cfg: ErpAdminConfig,
  doc: OnboardingDoc,
): Promise<OnboardingDoc> {
  if (!doc.name) throw new OnboardingError("Missing document name.");
  try {
    return await erpFetch(cfg, `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(doc.name)}`, {
      method: "PUT",
      body: doc,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Child table may not exist until setup script is run — keep portal.discussion in form_data.
    if (
      /discussion|Onboarding Discussion|unread_for_procurement|unread_for_supplier|MandatoryError|Field.*not permitted|Could not find/i.test(
        msg,
      )
    ) {
      const {
        discussion: _d,
        unread_for_procurement: _u1,
        unread_for_supplier: _u2,
        ...rest
      } = doc;
      return await erpFetch(
        cfg,
        `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(doc.name)}`,
        { method: "PUT", body: rest },
      );
    }
    throw err;
  }
}

/**
 * Reload → apply mutations in memory → single PUT.
 * Retries on deadlock / timestamp mismatch with exponential backoff.
 * `apply` may return false to skip the save (no-op).
 */
export async function saveDocWithRetry(
  cfg: ErpAdminConfig,
  name: string,
  apply: (fresh: OnboardingDoc) => void | boolean,
  retries = 3,
): Promise<OnboardingDoc> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    const fresh = await getDoc(cfg, name);
    const shouldSave = apply(fresh);
    if (shouldSave === false) return fresh;
    try {
      return await saveDoc(cfg, fresh);
    } catch (err) {
      lastErr = err;
      if (!isConflictError(err) || attempt === retries - 1) {
        throw friendlyConflictMessage(err);
      }
      const delay = 80 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw friendlyConflictMessage(lastErr);
}

async function resolveSupplierGroup(
  cfg: ErpAdminConfig,
  preferred?: string,
): Promise<string> {
  const preferredName = (
    preferred ||
    process.env.DEFAULT_SUPPLIER_GROUP ||
    process.env.VITE_DEFAULT_SUPPLIER_GROUP ||
    ""
  ).trim();

  let groups: Array<{ name: string; is_group?: number }> = [];
  try {
    const raw = await erpFetch(
      cfg,
      `resource/Supplier%20Group?` +
        new URLSearchParams({
          fields: JSON.stringify(["name", "is_group"]),
          limit_page_length: "200",
          order_by: "name asc",
        }).toString(),
    );
    groups = asArray<{ name: string; is_group?: number }>(raw);
  } catch {
    throw new OnboardingError(
      "Supplier Group not configured. Could not load Supplier Groups from ERPNext.",
      502,
    );
  }

  const leaves = groups.filter((g) => g.name && g.is_group !== 1);
  const pool = leaves.length > 0 ? leaves : groups.filter((g) => g.name);

  if (preferredName) {
    const hit = pool.find((g) => g.name === preferredName);
    if (!hit) {
      throw new OnboardingError(
        `Supplier Group "${preferredName}" does not exist in ERPNext. Configure DEFAULT_SUPPLIER_GROUP or create the group.`,
        400,
      );
    }
    return hit.name;
  }

  if (!pool[0]) {
    throw new OnboardingError(
      "Supplier Group not configured. Create a Supplier Group in ERPNext (is_group = 0).",
      400,
    );
  }
  return pool[0].name;
}

/* ── Categories ─────────────────────────────────────────────────────────── */

export async function listCategories(supplierType?: string) {
  const cfg = readErpAdminConfig();
  const filters: Array<[string, string, string | number]> = [["is_active", "=", 1]];
  const list = await erpFetch(
    cfg,
    `resource/${encodeURIComponent(CATEGORY_DOCTYPE)}?` +
      new URLSearchParams({
        filters: JSON.stringify(filters),
        fields: JSON.stringify([
          "name",
          "category_name",
          "supplier_type_scope",
          "is_active",
          "sort_order",
        ]),
        limit_page_length: "200",
        order_by: "sort_order asc",
      }).toString(),
  );
  let rows = asArray<{
    name: string;
    category_name?: string;
    supplier_type_scope?: string;
    sort_order?: number;
  }>(list);
  if (supplierType === "Direct" || supplierType === "Indirect") {
    rows = rows.filter(
      (r) =>
        !r.supplier_type_scope ||
        r.supplier_type_scope === "Both" ||
        r.supplier_type_scope === supplierType,
    );
  }
  return rows.map((r) => ({
    name: r.name,
    category_name: r.category_name || r.name,
    supplier_type_scope: r.supplier_type_scope || "Both",
    sort_order: r.sort_order ?? 100,
  }));
}

/* ── Procurement create / draft / link ──────────────────────────────────── */

export async function createOnboarding(input: {
  company_name: string;
  contact_person: string;
  email: string;
  mobile_no?: string;
  supplier_type: string;
  supplier_category: string;
  plant?: string;
  remarks?: string;
  created_by_user?: string;
}) {
  const cfg = readErpAdminConfig();
  const company = (input.company_name || "").trim();
  const contact = (input.contact_person || "").trim();
  const email = (input.email || "").trim();
  if (!company || !contact || !email) {
    throw new OnboardingError("Company Name, Contact Person and Email are required.");
  }
  if (!input.supplier_type || !input.supplier_category) {
    throw new OnboardingError("Supplier Type and Category are required.");
  }

  const doc = await erpFetch<OnboardingDoc>(cfg, `resource/${encodeURIComponent(DOCTYPE)}`, {
    method: "POST",
    body: {
      company_name: company,
      contact_person: contact,
      email,
      mobile_no: input.mobile_no || "",
      supplier_type: input.supplier_type,
      supplier_category: input.supplier_category,
      plant: input.plant || "",
      remarks: input.remarks || "",
      created_by_user: input.created_by_user || "",
      status: "Draft",
      approval_status: "Pending",
      form_data: JSON.stringify({ version: 1, fields: {} }),
      timeline: [timelineRow("Created", input.created_by_user || "Procurement")],
      documents: [],
      approvals: [],
    },
  });
  return { success: true as const, record: doc };
}

export async function updateProcurementDraft(input: {
  name: string;
  company_name?: string;
  contact_person?: string;
  email?: string;
  mobile_no?: string;
  supplier_type?: string;
  supplier_category?: string;
  plant?: string;
  remarks?: string;
  actor?: string;
}) {
  const cfg = readErpAdminConfig();
  const fields = [
    "company_name",
    "contact_person",
    "email",
    "mobile_no",
    "supplier_type",
    "supplier_category",
    "plant",
    "remarks",
  ] as const;

  const saved = await saveDocWithRetry(cfg, input.name, (doc) => {
    if (doc.status !== "Draft" && doc.status !== "Link Generated") {
      throw new OnboardingError(
        "Only Draft / Link Generated records can be edited by Procurement.",
      );
    }
    let changed = false;
    for (const key of fields) {
      if (input[key] === undefined) continue;
      if (normalizeScalar(doc[key]) !== normalizeScalar(input[key])) {
        (doc as Record<string, unknown>)[key] = input[key];
        changed = true;
      }
    }
    if (!changed) return false;
    pushTimeline(doc, "Draft Saved", input.actor || "Procurement", "", {
      allowDuplicate: true,
    });
  });
  return { success: true as const, record: saved };
}

export async function generateLink(input: {
  name: string;
  actor?: string;
  origin?: string;
}) {
  // Legacy alias — portal account generation replaces public onboarding links.
  return generateSupplierAccount(input);
}

/**
 * Generate Supplier Portal account (username + temporary password).
 * No public /onboarding/:token page — supplier logs into the portal.
 */
export async function generateSupplierAccount(input: {
  name: string;
  actor?: string;
  origin?: string;
}) {
  const cfg = readErpAdminConfig();
  const sessionSeed = randomBytes(24).toString("hex");

  const peek = await getDoc(cfg, input.name);
  const email = String(peek.email || "").trim().toLowerCase();
  if (!email) throw new OnboardingError("Email is required to create a portal account.");
  if (!["Draft", "Link Generated", "Expired"].includes(String(peek.status))) {
    throw new OnboardingError(`Cannot generate portal account when status is ${peek.status}.`);
  }

  const firstName = String(peek.contact_person || peek.company_name || email).trim() || email;

  // Create ERP User with policy-compliant random password (retry on policy rejection).
  // Supplier Master is still created only on approval.
  let userResult: { password: string; created: boolean };
  try {
    userResult = await createOrResetPortalUser(cfg, email, firstName);
  } catch (err) {
    throw err instanceof OnboardingError ? err : toFriendlyOnboardingError(err);
  }

  const tempPassword = userResult.password;
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(tempPassword, salt);

  const origin = (input.origin || "").replace(/\/$/, "");
  const loginPath = "/supplier/login";
  const loginUrl = origin ? `${origin}${loginPath}` : loginPath;

  // Long-term: password setup / reset link so supplier can choose their own password
  let setPasswordLink = loginUrl;
  try {
    setPasswordLink = await generatePasswordSetupLink(cfg, email, origin);
    if (!setPasswordLink) setPasswordLink = loginUrl;
  } catch {
    setPasswordLink = loginUrl;
  }

  const saved = await saveDocWithRetry(cfg, input.name, (doc) => {
    if (!["Draft", "Link Generated", "Expired"].includes(String(doc.status))) {
      throw new OnboardingError(`Cannot generate portal account when status is ${doc.status}.`);
    }
    doc.portal_user = email;
    doc.set_password_link = setPasswordLink;
    doc.secure_token = sessionSeed;
    doc.status = "Link Generated";
    const portal: PortalMeta = {
      ...getPortalMeta(doc),
      password_hash: passwordHash,
      password_salt: salt,
      temp_password: tempPassword,
      first_login: true,
      unlocked: false,
      session_token: undefined,
      comments: getPortalMeta(doc).comments || [],
    };
    setPortalMeta(doc, portal);
    pushTimeline(doc, "Credentials Generated", input.actor || "Procurement", email, {
      allowDuplicate: true,
    });
    if (userResult.created) {
      pushTimeline(doc, "Portal User Created", input.actor || "Procurement", email);
    }
    if (setPasswordLink && setPasswordLink !== loginUrl) {
      pushTimeline(doc, "Password Link Generated", input.actor || "Procurement", setPasswordLink);
    }
  });

  return {
    success: true as const,
    record: sanitizePublic(saved),
    username: email,
    temporary_password: tempPassword,
    login_path: loginPath,
    login_url: loginUrl,
    set_password_link: setPasswordLink,
  };
}

/* ── Public token flow ──────────────────────────────────────────────────── */

function buildTokenResponse(doc: OnboardingDoc) {
  const steps = getOnboardingSteps(
    String(doc.supplier_type || "Direct"),
    String(doc.supplier_category || ""),
  );
  const formData = parseFormData(doc.form_data);
  const locked = ["Submitted", "Under Review", "Approved"].includes(String(doc.status));
  const changeSections = parseChangeSections(doc.requested_change_sections);
  return {
    state: "ok" as const,
    record: sanitizePublic(doc),
    steps,
    form_data_fields: formData.fields,
    locked: locked && doc.status !== "Changes Requested",
    editable_steps:
      doc.status === "Changes Requested" && changeSections.length
        ? changeSections
        : null,
  };
}

export async function getByToken(token: string) {
  const cfg = readErpAdminConfig();
  let doc = await findByToken(cfg, token);
  if (!doc) throw new OnboardingError("Invalid Link", 404);

  if (doc.status === "Approved") {
    return { state: "already_completed" as const, record: sanitizePublic(doc) };
  }
  if (doc.status === "Rejected") {
    return { state: "rejected" as const, record: sanitizePublic(doc) };
  }
  if (doc.status === "Expired" || isExpired(doc)) {
    if (doc.status !== "Expired" && doc.name) {
      doc = await saveDocWithRetry(cfg, doc.name, (fresh) => {
        if (fresh.status === "Expired") return false;
        fresh.status = "Expired";
        pushTimeline(fresh, "Expired", "System");
      });
    }
    return { state: "expired" as const, record: sanitizePublic(doc) };
  }

  // Mark Opened only once — if already Opened/In Progress/etc., read-only
  if (doc.status === "Link Generated" && doc.name) {
    doc = await saveDocWithRetry(cfg, doc.name, (fresh) => {
      if (fresh.status !== "Link Generated") return false;
      fresh.status = "Opened";
      pushTimeline(fresh, "Opened", "Supplier");
    });
  }

  return buildTokenResponse(doc);
}

function parseChangeSections(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : raw.split(",").map((s) => s.trim()).filter(Boolean);
    } catch {
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function sanitizePublic(doc: OnboardingDoc) {
  const { secure_token: _t, ...rest } = doc;
  return rest;
}

const PUBLIC_EDITABLE = new Set([
  "Draft",
  "Link Generated",
  "Opened",
  "In Progress",
  "Changes Requested",
]);

const DRAFT_COMPARE_COLUMNS = [
  "company_name",
  "contact_person",
  "email",
  "mobile_no",
  "gst_number",
  "pan",
  "business_registration_number",
  "website",
  "address_line",
  "country",
  "state",
  "city",
  "postal_code",
  "designation",
  "phone",
  "alternate_phone",
  "years_in_business",
  "employee_count",
  "annual_turnover",
  "preferred_currency",
  "payment_terms",
  "bank_name",
  "bank_account_number",
  "bank_ifsc",
  "bank_branch",
  "manufacturing_plant",
  "factory_address",
  "production_capacity",
  "monthly_capacity",
  "lead_time",
  "moq",
  "quality_certifications",
  "iso_certified",
  "iatf_certified",
  "production_process",
  "machine_list",
  "material_categories",
  "countries_exported",
  "business_type",
  "service_area",
  "delivery_coverage",
  "support_availability",
  "amc_available",
  "sla_available",
  "contract_duration",
] as const;

function applySupplierValues(
  doc: OnboardingDoc,
  values: Record<string, unknown>,
  formDataFields?: Record<string, unknown>,
): boolean {
  const { columns, formDataFields: inferred } = splitPayload(values);
  let changed = false;
  for (const [k, v] of Object.entries(columns)) {
    if (normalizeScalar(doc[k]) !== normalizeScalar(v)) {
      (doc as Record<string, unknown>)[k] = v;
      changed = true;
    }
  }
  const current = parseFormData(doc.form_data);
  const merged = {
    ...current.fields,
    ...inferred,
    ...(formDataFields || {}),
  };
  const next = { version: 1, fields: merged, portal: current.portal };
  if (!formDataEquals(current, { version: 1, fields: merged })) {
    doc.form_data = JSON.stringify(next);
    changed = true;
  }
  return changed;
}

function draftWouldChange(
  doc: OnboardingDoc,
  values: Record<string, unknown>,
  formDataFields?: Record<string, unknown>,
  documents?: Array<{ document_type: string; file_url: string; file_name?: string }>,
): boolean {
  if (documents?.length) return true;
  const { columns, formDataFields: inferred } = splitPayload(values);
  for (const key of DRAFT_COMPARE_COLUMNS) {
    if (columns[key] === undefined) continue;
    if (normalizeScalar(doc[key]) !== normalizeScalar(columns[key])) return true;
  }
  for (const [k, v] of Object.entries(columns)) {
    if (normalizeScalar(doc[k]) !== normalizeScalar(v)) return true;
  }
  const current = parseFormData(doc.form_data);
  const merged = { ...current.fields, ...inferred, ...(formDataFields || {}) };
  return !formDataEquals(current, { version: 1, fields: merged });
}

export async function supplierSaveDraft(input: {
  token: string;
  values?: Record<string, unknown>;
  form_data_fields?: Record<string, unknown>;
  documents?: Array<{ document_type: string; file_url: string; file_name?: string }>;
}) {
  const cfg = readErpAdminConfig();
  const existing = await findByToken(cfg, input.token);
  if (!existing?.name) throw new OnboardingError("Invalid Link", 404);
  if (isExpired(existing)) throw new OnboardingError("Link expired.", 410);
  if (!PUBLIC_EDITABLE.has(String(existing.status))) {
    throw new OnboardingError("This onboarding is locked and cannot be edited.");
  }

  // Fast path: no changes → no save, no timeline, no modified bump
  if (
    !draftWouldChange(
      existing,
      input.values || {},
      input.form_data_fields,
      input.documents,
    )
  ) {
    return { success: true as const, record: sanitizePublic(existing), unchanged: true };
  }

  const saved = await saveDocWithRetry(cfg, existing.name, (doc) => {
    if (isExpired(doc)) throw new OnboardingError("Link expired.", 410);
    if (!PUBLIC_EDITABLE.has(String(doc.status))) {
      throw new OnboardingError("This onboarding is locked and cannot be edited.");
    }

    const changed = applySupplierValues(doc, input.values || {}, input.form_data_fields);
    let docsChanged = false;
    if (input.documents?.length) {
      const currentDocs = [...(doc.documents || [])];
      for (const d of input.documents) {
        const dup = currentDocs.some(
          (x) => x.file_url === d.file_url && x.document_type === d.document_type,
        );
        if (dup) continue;
        currentDocs.push({
          doctype: "Supplier Onboarding Document",
          document_type: d.document_type,
          file_url: d.file_url,
          file_name: d.file_name || "",
          uploaded_on: nowIso(),
        });
        docsChanged = true;
      }
      doc.documents = currentDocs;
    }

    if (!changed && !docsChanged) return false;

    if (doc.status === "Opened" || doc.status === "Link Generated") {
      doc.status = "In Progress";
    }
    pushTimeline(doc, "Draft Saved", "Supplier", "", { allowDuplicate: true });
  });

  return { success: true as const, record: sanitizePublic(saved), unchanged: false };
}

export async function supplierSubmit(input: {
  token: string;
  values?: Record<string, unknown>;
  form_data_fields?: Record<string, unknown>;
}) {
  const cfg = readErpAdminConfig();
  const existing = await findByToken(cfg, input.token);
  if (!existing?.name) throw new OnboardingError("Invalid Link", 404);
  if (isExpired(existing)) throw new OnboardingError("Link expired.", 410);
  if (!PUBLIC_EDITABLE.has(String(existing.status))) {
    throw new OnboardingError("Already submitted or locked.");
  }

  const saved = await saveDocWithRetry(cfg, existing.name, (doc) => {
    if (isExpired(doc)) throw new OnboardingError("Link expired.", 410);
    if (!PUBLIC_EDITABLE.has(String(doc.status))) {
      throw new OnboardingError("Already submitted or locked.");
    }
    applySupplierValues(doc, input.values || {}, input.form_data_fields);
    if (!(doc.company_name || "").toString().trim()) {
      throw new OnboardingError("Company Name is required before submit.");
    }

    const wasChanges = doc.status === "Changes Requested";
    doc.requested_change_sections = "";
    doc.approvals = ONBOARDING_APPROVAL_STAGES.map((s) => ({
      doctype: "Supplier Onboarding Approval",
      stage: s.id,
      stage_order: s.order,
      status: "Pending",
      comments: "",
    }));
    doc.approval_stage = ONBOARDING_APPROVAL_STAGES[0].id;
    doc.approval_status = "Pending";
    doc.status = "Under Review";

    if (wasChanges) {
      pushTimeline(doc, "Resubmitted", "Supplier", "", { allowDuplicate: true });
    } else {
      pushTimeline(doc, "Submitted", "Supplier");
    }
    pushTimeline(doc, "Under Review", "Supplier");
    pushTimeline(doc, "Procurement Review", "System");
  });

  return { success: true as const, record: sanitizePublic(saved) };
}

/* ── Procurement list / get / stats ─────────────────────────────────────── */

const LIST_CORE_FIELDS = [
  "name",
  "company_name",
  "contact_person",
  "email",
  "supplier_type",
  "supplier_category",
  "status",
  "created_by_user",
  "creation",
  "modified",
  "linked_supplier",
] as const;

const LIST_OPTIONAL_UNREAD_FIELDS = [
  "unread_for_procurement",
  "unread_for_supplier",
] as const;

function normalizeListRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    unread_for_procurement: Number(row.unread_for_procurement || 0) || 0,
    unread_for_supplier: Number(row.unread_for_supplier || 0) || 0,
  };
}

export async function listOnboardings(opts?: {
  status?: string;
  supplier_type?: string;
  supplier_category?: string;
  search?: string;
  limit?: number;
}) {
  const cfg = readErpAdminConfig();
  const filters: Array<[string, string, string | number]> = [];
  if (opts?.status) filters.push(["status", "=", opts.status]);
  if (opts?.supplier_type) filters.push(["supplier_type", "=", opts.supplier_type]);
  if (opts?.supplier_category) {
    filters.push(["supplier_category", "=", opts.supplier_category]);
  }

  const fetchList = async (fields: readonly string[]) =>
    erpFetch(
      cfg,
      `resource/${encodeURIComponent(DOCTYPE)}?` +
        new URLSearchParams({
          filters: JSON.stringify(filters),
          fields: JSON.stringify([...fields]),
          limit_page_length: String(opts?.limit ?? 100),
          order_by: "modified desc",
        }).toString(),
    );

  let list: unknown;
  try {
    // Prefer unread counters when DocType has them; never fail the list if missing.
    list = await fetchList([...LIST_CORE_FIELDS, ...LIST_OPTIONAL_UNREAD_FIELDS]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unread_for_|Field not permitted|Unknown column|does not exist/i.test(msg)) {
      // eslint-disable-next-line no-console
      console.warn(
        "[listOnboardings] optional unread fields unavailable; falling back to core fields",
        msg.slice(0, 200),
      );
      try {
        list = await fetchList(LIST_CORE_FIELDS);
      } catch (coreErr) {
        // eslint-disable-next-line no-console
        console.error("[listOnboardings] core list failed", coreErr);
        return [];
      }
    } else {
      // eslint-disable-next-line no-console
      console.error("[listOnboardings] failed", err);
      return [];
    }
  }

  let rows = asArray<Record<string, unknown>>(list).map(normalizeListRow);
  const q = (opts?.search || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.company_name,
        r.contact_person,
        r.email,
        r.supplier_category,
        r.name,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }
  return rows;
}

export async function getOnboarding(name: string) {
  const cfg = readErpAdminConfig();
  const doc = await getDoc(cfg, name);
  const steps: OnboardingStepDef[] = getOnboardingSteps(
    String(doc.supplier_type || "Direct"),
    String(doc.supplier_category || ""),
  );
  let discussion;
  try {
    discussion = buildDiscussionPayload(doc, "procurement");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[getOnboarding] discussion payload skipped", err);
    discussion = {
      messages: [],
      unread_count: 0,
      unread_for_procurement: 0,
      unread_for_supplier: 0,
      notify: false,
      section_tags: [...DISCUSSION_SECTION_TAGS],
    };
  }
  return {
    success: true as const,
    record: doc,
    steps,
    form_data_fields: parseFormData(doc.form_data).fields,
    approval_stages: ONBOARDING_APPROVAL_STAGES,
    discussion,
  };
}

export async function getStats() {
  try {
    const rows = await listOnboardings({ limit: 500 });
    const count = (status: string) => rows.filter((r) => r.status === status).length;
    return {
      total: rows.length,
      draft: count("Draft"),
      generated: count("Link Generated"),
      submitted: count("Submitted") + count("Under Review"),
      pending_review: count("Under Review") + count("Changes Requested"),
      approved: count("Approved"),
      rejected: count("Rejected"),
      expired: count("Expired"),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[getStats] failed; returning zeros", err);
    return {
      total: 0,
      draft: 0,
      generated: 0,
      submitted: 0,
      pending_review: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
    };
  }
}

/* ── Review actions ─────────────────────────────────────────────────────── */

export async function requestChanges(input: {
  name: string;
  sections: string[];
  comments?: string;
  actor?: string;
}) {
  const cfg = readErpAdminConfig();
  const saved = await saveDocWithRetry(cfg, input.name, (doc) => {
    if (!["Under Review", "Submitted"].includes(String(doc.status))) {
      throw new OnboardingError("Request Changes is only allowed while under review.");
    }
    doc.status = "Changes Requested";
    doc.requested_change_sections = JSON.stringify(input.sections || []);
    pushTimeline(
      doc,
      "Changes Requested",
      input.actor || "Procurement",
      input.comments || "",
      { allowDuplicate: true },
    );
    if (input.comments?.trim()) {
      const messages = readDiscussionMessages(doc);
      messages.push({
        message_id: randomBytes(8).toString("hex"),
        sender_role: "Procurement",
        sender_name: input.actor || "Procurement",
        message: input.comments.trim(),
        sent_on: nowIso(),
        section_tag: (input.sections?.[0]
          ? mapSectionIdToTag(input.sections[0])
          : "Review") as DiscussionSectionTag,
        resolved: 0,
        read_by_procurement: 1,
        read_by_supplier: 0,
      });
      writeDiscussionMessages(doc, messages);
      pushTimeline(doc, "Discussion Message", input.actor || "Procurement", "New message for supplier", {
        allowDuplicate: true,
      });

      // Keep legacy portal.comments in sync for older UI
      const portal = getPortalMeta(doc);
      const comments = sortPortalComments(portal.comments);
      comments.push({
        id: randomBytes(8).toString("hex"),
        author: input.actor || "Procurement",
        role: "procurement",
        text: input.comments.trim(),
        at: nowIso(),
      });
      setPortalMeta(doc, { ...getPortalMeta(doc), comments });
    }
  });
  return { success: true as const, record: saved };
}

export async function rejectOnboarding(input: {
  name: string;
  comments?: string;
  actor?: string;
}) {
  const cfg = readErpAdminConfig();
  const saved = await saveDocWithRetry(cfg, input.name, (doc) => {
    if (doc.status === "Approved") {
      throw new OnboardingError("Cannot reject an approved onboarding.");
    }
    if (doc.status === "Rejected") return false;
    doc.status = "Rejected";
    doc.approval_status = "Rejected";
    const approvals = [...(doc.approvals || [])];
    for (const a of approvals) {
      if (a.status === "Pending") {
        a.status = "Rejected";
        a.acted_by = input.actor || "Procurement";
        a.acted_on = nowIso();
        a.comments = input.comments || "";
      }
    }
    doc.approvals = approvals;
    pushTimeline(doc, "Rejected", input.actor || "Procurement", input.comments || "");
  });
  return { success: true as const, record: saved };
}

export async function approveStage(input: {
  name: string;
  stage?: string;
  comments?: string;
  actor?: string;
  origin?: string;
}) {
  const cfg = readErpAdminConfig();

  // First pass: mark stage approved in a single save (or detect already done)
  let needsFinalize = false;
  let intermediate = await saveDocWithRetry(cfg, input.name, (doc) => {
    if (!["Under Review", "Submitted"].includes(String(doc.status))) {
      throw new OnboardingError("Approve is only allowed while under review.");
    }
    if (doc.status === "Approved" && doc.linked_supplier) {
      throw new OnboardingError("Supplier Master already created for this onboarding.");
    }

    // Resume finalize after a partial ERP create (still Under Review / In Progress)
    if (doc.linked_supplier && doc.status === "Under Review") {
      needsFinalize = true;
      return false;
    }

    const stageId = input.stage || String(doc.approval_stage || "procurement");
    const approvals = [...(doc.approvals || [])];
    const row = approvals.find((a) => a.stage === stageId);
    if (!row) throw new OnboardingError(`Unknown approval stage: ${stageId}`);
    if (row.status === "Approved") {
      needsFinalize = ONBOARDING_APPROVAL_STAGES.every((s) => {
        const r = approvals.find((a) => a.stage === s.id);
        return r && r.status === "Approved";
      });
      return false;
    }
    row.status = "Approved";
    row.acted_by = input.actor || "Procurement";
    row.acted_on = nowIso();
    row.comments = input.comments || "";
    doc.approvals = approvals;

    pushTimeline(
      doc,
      `Stage Approved: ${stageId}`,
      input.actor || "Procurement",
      input.comments || "",
      { allowDuplicate: true },
    );

    const allApproved = ONBOARDING_APPROVAL_STAGES.every((s) => {
      const r = approvals.find((a) => a.stage === s.id);
      return r && r.status === "Approved";
    });

    if (!allApproved) {
      const next = ONBOARDING_APPROVAL_STAGES.find((s) => {
        const r = approvals.find((a) => a.stage === s.id);
        return !r || r.status === "Pending";
      });
      if (next) doc.approval_stage = next.id;
      doc.approval_status = "In Progress";
      needsFinalize = false;
      return;
    }

    // All stages approved — Approval Status stays within allowed values only
    doc.approval_status = "In Progress";
    pushTimeline(doc, "Under Review", input.actor || "Procurement");
    needsFinalize = true;
  });

  if (!needsFinalize) {
    return { success: true as const, finalized: false, record: intermediate };
  }

  const finalized = await finalizeApproval(
    cfg,
    intermediate.name!,
    input.actor || "Procurement",
    input.origin,
  );
  return { success: true as const, finalized: true, ...finalized };
}

async function finalizeApproval(
  cfg: ErpAdminConfig,
  name: string,
  actor: string,
  origin?: string,
) {
  // Approval Status may only be: Pending | In Progress | Approved | Rejected.
  // Progress is recorded in Timeline only — never temporary approval_status values.
  // Never use supplier_category as ERP Supplier Group.
  const peek = await getDoc(cfg, name);
  if (peek.status === "Approved" && peek.linked_supplier) {
    return {
      record: peek,
      supplier_name: String(peek.linked_supplier),
      portal_user: String(peek.portal_user || ""),
      set_password_link: String(peek.set_password_link || ""),
    };
  }

  const preferredGroup =
    typeof peek.erp_supplier_group === "string" ? peek.erp_supplier_group : undefined;
  const supplierGroup = await resolveSupplierGroup(cfg, preferredGroup);

  const supplierName = String(peek.company_name || "").trim();
  if (!supplierName) {
    throw new OnboardingError("Company Name is required to create Supplier.");
  }

  // Claim via timeline (not approval_status). Keep status Under Review + approval In Progress.
  let claimed = false;
  await saveDocWithRetry(cfg, name, (doc) => {
    if (doc.status === "Approved" && doc.linked_supplier) return false;
    if (isFinalizeInFlight(doc)) return false;

    const allApproved = ONBOARDING_APPROVAL_STAGES.every((s) => {
      const r = (doc.approvals || []).find((a) => a.stage === s.id);
      return r && r.status === "Approved";
    });
    if (!allApproved) {
      throw new OnboardingError("Cannot finalize until all approval stages are approved.");
    }

    doc.status = "Under Review";
    doc.approval_status = "In Progress";
    pushTimeline(doc, "Under Review", actor);
    pushTimeline(doc, "Supplier Creation Started", actor, "", { allowDuplicate: true });
    claimed = true;
  });

  if (!claimed) {
    const again = await getDoc(cfg, name);
    if (again.status === "Approved" && again.linked_supplier) {
      return {
        record: again,
        supplier_name: String(again.linked_supplier),
        portal_user: String(again.portal_user || ""),
        set_password_link: String(again.set_password_link || ""),
      };
    }
    await new Promise((r) => setTimeout(r, 600));
    const third = await getDoc(cfg, name);
    if (third.status === "Approved" && third.linked_supplier) {
      return {
        record: third,
        supplier_name: String(third.linked_supplier),
        portal_user: String(third.portal_user || ""),
        set_password_link: String(third.set_password_link || ""),
      };
    }
    throw new OnboardingError(
      "Onboarding already updated. Please refresh and try again.",
      409,
    );
  }

  const fresh = await getDoc(cfg, name);
  let supplierId = String(fresh.linked_supplier || "").trim();
  let portalUser = String(fresh.portal_user || "").trim();
  let setPasswordLink = String(fresh.set_password_link || "").trim();

  /** Pending timeline notes applied on success or failure save (one PUT). */
  const pendingEvents: Array<{ event: string; notes?: string }> = [];

  try {
    if (!supplierId) {
      try {
        const supplier = await erpFetch<{ name?: string; supplier_name?: string }>(
          cfg,
          "resource/Supplier",
          {
            method: "POST",
            body: {
              supplier_name: supplierName,
              supplier_group: supplierGroup,
              supplier_type: fresh.supplier_type === "Indirect" ? "Services" : "Company",
              // Procurement-selected classification — written once at Supplier creation
              custom_sourcing_type: String(fresh.supplier_type || "").trim() || undefined,
              custom_supplier_category:
                String(fresh.supplier_category || "").trim() || undefined,
              country: fresh.country || undefined,
              tax_id: fresh.gst_number || fresh.pan || undefined,
              payment_terms: fresh.payment_terms || undefined,
              email_id: fresh.email || undefined,
              mobile_no: fresh.mobile_no || fresh.phone || undefined,
            },
          },
        );
        supplierId = supplier?.name || supplierName;
        pendingEvents.push({
          event: "Supplier Created",
          notes: `${supplierId} (group: ${supplierGroup})`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Supplier Group|LinkValidationError/i.test(msg)) {
          throw new OnboardingError(
            "Supplier Group not configured. Choose a valid ERP Supplier Group before approval.",
            400,
          );
        }
        throw new OnboardingError(`Failed to create Supplier Master: ${msg.slice(0, 300)}`, 502);
      }
    } else if (!hasTimelineEvent(fresh, "Supplier Created")) {
      pendingEvents.push({
        event: "Supplier Created",
        notes: `${supplierId} (group: ${supplierGroup})`,
      });
    }

    // Write-once: copy Procurement classification onto Supplier Master if empty
    if (supplierId) {
      await saveSupplierCustomProfileFields(cfg, supplierId, {
        custom_sourcing_type: String(fresh.supplier_type || "").trim(),
        custom_supplier_category: String(fresh.supplier_category || "").trim(),
      }).catch(() => undefined);
    }

    if ((fresh.contact_person || fresh.email) && !hasTimelineEvent(fresh, "Contact Created")) {
      try {
        await erpFetch(cfg, "resource/Contact", {
          method: "POST",
          body: {
            first_name: fresh.contact_person || supplierName,
            email_id: fresh.email || "",
            mobile_no: fresh.mobile_no || fresh.phone || "",
            links: [{ link_doctype: "Supplier", link_name: supplierId }],
          },
        });
        pendingEvents.push({ event: "Contact Created" });
      } catch (err) {
        throw new OnboardingError(
          `Failed to create Contact: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
          502,
        );
      }
    }

    if ((fresh.address_line || fresh.city) && !hasTimelineEvent(fresh, "Address Created")) {
      try {
        await erpFetch(cfg, "resource/Address", {
          method: "POST",
          body: {
            address_title: supplierName,
            address_type: "Billing",
            address_line1: fresh.address_line || supplierName,
            city: fresh.city || "—",
            state: fresh.state || "",
            country: fresh.country || "India",
            pincode: fresh.postal_code || "",
            links: [{ link_doctype: "Supplier", link_name: supplierId }],
          },
        });
        pendingEvents.push({ event: "Address Created" });
      } catch (err) {
        throw new OnboardingError(
          `Failed to create Address: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
          502,
        );
      }
    }

    const email = String(fresh.email || fresh.portal_user || "").trim();
    // Portal user is usually created at "Generate Supplier Account" — only create if missing
    if (email && !portalUser) {
      try {
        await createOrResetPortalUser(
          cfg,
          email,
          String(fresh.contact_person || supplierName || email),
        );
        portalUser = email;
        pendingEvents.push({ event: "Portal User Created", notes: email });
      } catch (err) {
        throw err instanceof OnboardingError ? err : toFriendlyOnboardingError(err);
      }
    } else if (portalUser && !hasTimelineEvent(fresh, "Portal User Created")) {
      pendingEvents.push({ event: "Portal User Created", notes: portalUser });
    }

    if (portalUser) {
      const base = (origin || "").replace(/\/$/, "") || "";
      setPasswordLink = `${base || ""}/supplier/login`.replace(/([^:]\/)\/+/g, "$1");
      if (!hasTimelineEvent(fresh, "Password Link Generated")) {
        pendingEvents.push({ event: "Password Link Generated" });
      }
    }

    // Success — single save: links + timeline + Approved + unlock portal modules
    const saved = await saveDocWithRetry(cfg, name, (doc) => {
      if (doc.status === "Approved" && doc.linked_supplier) return false;
      doc.linked_supplier = supplierId;
      doc.portal_user = portalUser;
      doc.set_password_link = setPasswordLink;
      doc.status = "Approved";
      doc.approval_status = "Approved";
      const portal = getPortalMeta(doc);
      setPortalMeta(doc, { ...portal, unlocked: true, temp_password: undefined });
      for (const ev of pendingEvents) {
        pushTimeline(doc, ev.event, actor, ev.notes || "");
      }
      pushTimeline(doc, "Approved", actor, `Supplier Master: ${supplierId}`);
    });

    return {
      record: saved,
      supplier_name: supplierId,
      portal_user: portalUser,
      set_password_link: setPasswordLink,
    };
  } catch (err) {
    // Failure — keep Under Review + In Progress; record progress + failure in timeline only
    const failMsg =
      err instanceof OnboardingError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    await saveDocWithRetry(cfg, name, (doc) => {
      if (doc.status === "Approved") return false;
      doc.status = "Under Review";
      doc.approval_status = "In Progress";
      if (supplierId) doc.linked_supplier = supplierId;
      if (portalUser) doc.portal_user = portalUser;
      if (setPasswordLink) doc.set_password_link = setPasswordLink;
      for (const ev of pendingEvents) {
        pushTimeline(doc, ev.event, actor, ev.notes || "");
      }
      pushTimeline(doc, "Supplier Creation Failed", actor, failMsg.slice(0, 400), {
        allowDuplicate: true,
      });
    }).catch(() => undefined);

    throw err instanceof OnboardingError ? err : toFriendlyOnboardingError(err);
  }
}

/** Resolve onboarding name for file upload after token check */
export async function resolveDocnameForToken(token: string): Promise<string> {
  const cfg = readErpAdminConfig();
  const doc = await findByToken(cfg, token);
  if (!doc?.name) throw new OnboardingError("Invalid Link", 404);
  if (isExpired(doc)) throw new OnboardingError("Link expired.", 410);
  if (!PUBLIC_EDITABLE.has(String(doc.status)) && doc.status !== "Changes Requested") {
    throw new OnboardingError("Uploads are locked for this onboarding.");
  }
  return doc.name;
}

/* ── Portal session onboarding (replaces public /onboarding/:token) ───── */

async function findByPortalUser(cfg: ErpAdminConfig, email: string): Promise<OnboardingDoc | null> {
  const normalized = email.trim().toLowerCase();
  const list = await erpFetch(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}?` +
      new URLSearchParams({
        filters: JSON.stringify([["portal_user", "=", normalized]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: "1",
        order_by: "modified desc",
      }).toString(),
  );
  let rows = asArray<{ name: string }>(list);
  if (!rows[0]?.name) {
    const byEmail = await erpFetch(
      cfg,
      `resource/${encodeURIComponent(DOCTYPE)}?` +
        new URLSearchParams({
          filters: JSON.stringify([["email", "=", normalized]]),
          fields: JSON.stringify(["name"]),
          limit_page_length: "1",
          order_by: "modified desc",
        }).toString(),
    );
    rows = asArray<{ name: string }>(byEmail);
  }
  if (!rows[0]?.name) return null;
  return getDoc(cfg, rows[0].name);
}

function parseSessionExpiry(raw: unknown): number | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  // Stored as "YYYY-MM-DD HH:mm:ss" UTC from addDaysIso / nowIso
  const normalized = /Z$/i.test(text)
    ? text
    : text.includes("T")
      ? `${text}Z`
      : `${text.replace(" ", "T")}Z`;
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sortPortalComments(comments: PortalComment[] | undefined): PortalComment[] {
  return [...(comments || [])].sort((a, b) => {
    const aMs = parseSessionExpiry(a.at) ?? new Date(String(a.at || "").replace(" ", "T") + "Z").getTime();
    const bMs = parseSessionExpiry(b.at) ?? new Date(String(b.at || "").replace(" ", "T") + "Z").getTime();
    if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return aMs - bMs;
    return String(a.at || "").localeCompare(String(b.at || ""));
  });
}

async function findByPortalMetaSession(
  cfg: ErpAdminConfig,
  sessionToken: string,
): Promise<OnboardingDoc | null> {
  // form_data Long Text LIKE — finds sessions stored only in portal meta JSON
  const list = await erpFetch(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}?` +
      new URLSearchParams({
        filters: JSON.stringify([["form_data", "like", `%${sessionToken}%`]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: "10",
        order_by: "modified desc",
      }).toString(),
  );
  for (const row of asArray<{ name: string }>(list)) {
    if (!row?.name) continue;
    const doc = await getDoc(cfg, row.name);
    const meta = getPortalMeta(doc);
    if (String(meta.session_token || "") === sessionToken) return doc;
  }
  return null;
}

async function findBySessionToken(
  cfg: ErpAdminConfig,
  sessionToken: string,
): Promise<OnboardingDoc | null> {
  const token = String(sessionToken || "").trim();
  if (!token) return null;

  // 1) Primary: secure_token column (set on portal login)
  let doc = await findByToken(cfg, token);

  // 2) Fallback: portal.session_token inside form_data (survives secure_token drift)
  if (!doc) {
    doc = await findByPortalMetaSession(cfg, token);
  }
  if (!doc) return null;

  const meta = getPortalMeta(doc);
  const matchesSecure = String(doc.secure_token || "") === token;
  const matchesMeta = String(meta.session_token || "") === token;
  if (!matchesSecure && !matchesMeta) return null;

  const expMs = parseSessionExpiry(meta.session_expires);
  if (expMs != null && expMs < Date.now()) {
    return null;
  }

  // Heal drift: keep secure_token aligned with the active portal session
  if (matchesMeta && !matchesSecure && doc.name) {
    try {
      await saveDocWithRetry(cfg, doc.name, (fresh) => {
        fresh.secure_token = token;
        const m = getPortalMeta(fresh);
        setPortalMeta(fresh, { ...m, session_token: token });
      });
      doc = await getDoc(cfg, doc.name);
    } catch {
      // Non-fatal — session is still valid via meta match
    }
  }

  return doc;
}

/** Prefer body.session_token; also accept X-Supplier-Session / Authorization Bearer. */
export function extractPortalSessionToken(
  body: Record<string, unknown> | null | undefined,
  headers?: Headers | Record<string, string | string[] | undefined> | null,
): string {
  const fromBody = String(body?.session_token ?? body?.sessionToken ?? "").trim();
  if (fromBody) return fromBody;

  if (!headers) return "";

  const read = (key: string): string => {
    if (typeof (headers as Headers).get === "function") {
      return String((headers as Headers).get(key) || "").trim();
    }
    const raw = (headers as Record<string, string | string[] | undefined>)[key]
      ?? (headers as Record<string, string | string[] | undefined>)[key.toLowerCase()];
    if (Array.isArray(raw)) return String(raw[0] || "").trim();
    return String(raw || "").trim();
  };

  const headerToken =
    read("x-supplier-session") ||
    read("X-Supplier-Session");
  if (headerToken) return headerToken;

  const auth = read("authorization") || read("Authorization");
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer?.[1]) return bearer[1].trim();

  return "";
}

async function loadSupplierCustomProfileFields(
  cfg: ErpAdminConfig,
  linkedSupplier: string,
): Promise<{ custom_sourcing_type: string; custom_supplier_category: string }> {
  const name = String(linkedSupplier || "").trim();
  if (!name) return { custom_sourcing_type: "", custom_supplier_category: "" };
  try {
    const supplier = (await erpFetch(
      cfg,
      `resource/Supplier/${encodeURIComponent(name)}?fields=${encodeURIComponent(
        JSON.stringify([
          "name",
          "custom_sourcing_type",
          "custom_supplier_category",
        ]),
      )}`,
    )) as Record<string, unknown>;
    return {
      custom_sourcing_type: String(supplier.custom_sourcing_type || "").trim(),
      custom_supplier_category: String(supplier.custom_supplier_category || "").trim(),
    };
  } catch {
    return { custom_sourcing_type: "", custom_supplier_category: "" };
  }
}

/**
 * Classification is owned by Procurement (onboarding.supplier_type /
 * supplier_category). Suppliers may only fill empty legacy gaps once; ERP
 * Supplier custom fields are never overwritten after the first write.
 */
function resolveClassification(
  doc: OnboardingDoc,
  formFields?: Record<string, unknown>,
  erp?: { custom_sourcing_type: string; custom_supplier_category: string } | null,
) {
  const fromOnboardingType = String(doc.supplier_type || "").trim();
  const fromOnboardingCategory = String(doc.supplier_category || "").trim();
  const fromFormType = String(formFields?.custom_sourcing_type ?? "").trim();
  const fromFormCategory = String(formFields?.custom_supplier_category ?? "").trim();
  const fromErpType = String(erp?.custom_sourcing_type || "").trim();
  const fromErpCategory = String(erp?.custom_supplier_category || "").trim();

  // Priority: onboarding (Procurement) → ERP (already locked) → form (legacy only)
  const custom_sourcing_type = fromOnboardingType || fromErpType || fromFormType;
  const custom_supplier_category =
    fromOnboardingCategory || fromErpCategory || fromFormCategory;

  return {
    custom_sourcing_type,
    custom_supplier_category,
    classification_locks: {
      custom_sourcing_type: !!(fromOnboardingType || fromErpType),
      custom_supplier_category: !!(fromOnboardingCategory || fromErpCategory),
    },
  };
}

/** Write Supplier Type / Category to ERP Supplier only when the field is empty. */
async function saveSupplierCustomProfileFields(
  cfg: ErpAdminConfig,
  linkedSupplier: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const name = String(linkedSupplier || "").trim();
  if (!name) return;

  const existing = await loadSupplierCustomProfileFields(cfg, name);
  const sourcing = String(fields.custom_sourcing_type ?? "").trim();
  const category = String(fields.custom_supplier_category ?? "").trim();
  if (!sourcing && !category) return;
  if (sourcing && sourcing !== "Direct" && sourcing !== "Indirect") {
    throw new OnboardingError("Supplier Type must be Direct or Indirect.");
  }

  const patch: Record<string, unknown> = {};
  // Write-once: never overwrite values already stored on Supplier Master
  if (sourcing && !existing.custom_sourcing_type) {
    patch.custom_sourcing_type = sourcing;
  }
  if (category && !existing.custom_supplier_category) {
    patch.custom_supplier_category = category;
  }
  if (!Object.keys(patch).length) return;

  try {
    await erpFetch(cfg, `resource/Supplier/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: patch,
    });
  } catch (err) {
    const msg = stripFrappeNoise(err instanceof Error ? err.message : String(err));
    throw new OnboardingError(
      `Could not save Supplier Type / Category on Supplier Master: ${msg.slice(0, 200)}`,
      400,
    );
  }
}

async function buildPortalProfileWithSupplierFields(
  cfg: ErpAdminConfig,
  doc: OnboardingDoc,
) {
  const base = buildPortalProfile(doc);
  const linked = String(doc.linked_supplier || "").trim();
  const erp = linked ? await loadSupplierCustomProfileFields(cfg, linked) : null;
  const resolved = resolveClassification(doc, base.form_data_fields, erp);
  const form_data_fields = {
    ...(base.form_data_fields || {}),
    custom_sourcing_type: resolved.custom_sourcing_type,
    custom_supplier_category: resolved.custom_supplier_category,
  };
  return {
    ...base,
    form_data_fields,
    classification_locks: resolved.classification_locks,
    record: {
      ...(base.record as Record<string, unknown>),
      custom_sourcing_type: form_data_fields.custom_sourcing_type,
      custom_supplier_category: form_data_fields.custom_supplier_category,
    },
  };
}

function buildPortalProfile(doc: OnboardingDoc) {
  const portal = getPortalMeta(doc);
  const steps = getOnboardingSteps(
    String(doc.supplier_type || "Direct"),
    String(doc.supplier_category || ""),
  );
  const formData = parseFormData(doc.form_data);
  const resolved = resolveClassification(doc, formData.fields, null);
  const form_data_fields = {
    ...formData.fields,
    custom_sourcing_type: resolved.custom_sourcing_type,
    custom_supplier_category: resolved.custom_supplier_category,
  };
  const changeSections = parseChangeSections(doc.requested_change_sections);
  const status = String(doc.status || "");
  const unlocked = !!portal.unlocked || status === "Approved";
  const locked =
    ["Submitted", "Under Review", "Approved"].includes(status) &&
    status !== "Changes Requested";

  return {
    success: true as const,
    record: sanitizePublic(doc),
    steps,
    form_data_fields,
    classification_locks: resolved.classification_locks,
    comments: sortPortalComments(portal.comments),
    discussion: buildDiscussionPayload(doc, "supplier"),
    first_login: !!portal.first_login,
    unlocked,
    locked: locked && status !== "Changes Requested",
    editable_steps:
      status === "Changes Requested" && changeSections.length ? changeSections : null,
    display_status:
      status === "Link Generated" || status === "Opened"
        ? "Onboarding Pending"
        : status,
    company_name: String(doc.company_name || ""),
    linked_supplier: String(doc.linked_supplier || ""),
    portal_user: String(doc.portal_user || doc.email || ""),
  };
}

const DEFAULT_LEGACY_PIN = "1234";
const LOGIN_HISTORY_LIMIT = 40;
const ACTIVE_SESSION_LIMIT = 12;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function normalizeClientMeta(raw?: PortalClientMeta | null): {
  browser: string;
  device: string;
  ip: string;
} {
  const ua = String(raw?.user_agent || "");
  const browser =
    String(raw?.browser || "").trim() ||
    (/Edg\//i.test(ua)
      ? "Edge"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : /Safari\//i.test(ua)
            ? "Safari"
            : ua
              ? "Browser"
              : "Unknown");
  const device =
    String(raw?.device || "").trim() ||
    (/Mobile|Android|iPhone|iPad/i.test(ua) ? "Mobile" : "Desktop");
  const ip = String(raw?.ip || "").trim() || "—";
  return { browser, device, ip };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pushLoginHistory(
  meta: PortalMeta,
  entry: Omit<PortalLoginHistoryEntry, "id">,
): PortalLoginHistoryEntry[] {
  const next: PortalLoginHistoryEntry = {
    id: randomBytes(8).toString("hex"),
    ...entry,
  };
  return [next, ...(meta.login_history || [])].slice(0, LOGIN_HISTORY_LIMIT);
}

function upsertActiveSession(
  meta: PortalMeta,
  sessionToken: string,
  client: { browser: string; device: string; ip: string },
): PortalActiveSession[] {
  const token_hash = hashToken(sessionToken);
  const now = nowIso();
  const rest = (meta.active_sessions || []).filter((s) => s.token_hash !== token_hash);
  const row: PortalActiveSession = {
    id: randomBytes(8).toString("hex"),
    token_hash,
    created_at: now,
    last_seen: now,
    browser: client.browser,
    device: client.device,
    ip: client.ip,
  };
  return [row, ...rest].slice(0, ACTIVE_SESSION_LIMIT);
}

async function findByLinkedSupplier(
  cfg: ErpAdminConfig,
  supplierName: string,
): Promise<OnboardingDoc | null> {
  const name = String(supplierName || "").trim();
  if (!name) return null;
  const list = await erpFetch(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}?` +
      new URLSearchParams({
        filters: JSON.stringify([["linked_supplier", "=", name]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: "1",
        order_by: "modified desc",
      }).toString(),
  );
  const rows = asArray<{ name: string }>(list);
  if (!rows[0]?.name) return null;
  return getDoc(cfg, rows[0].name);
}

function verifyPortalPin(pin: string, meta: PortalMeta): boolean {
  const value = String(pin || "").trim();
  if (!/^\d{4}$/.test(value)) return false;
  if (meta.pin_hash && meta.pin_salt) {
    return verifyPassword(value, meta.pin_salt, meta.pin_hash);
  }
  // Migration default until supplier sets a custom PIN
  return value === DEFAULT_LEGACY_PIN;
}

export async function portalLogin(input: {
  username: string;
  password: string;
  client?: PortalClientMeta;
}) {
  const cfg = readErpAdminConfig();
  const username = String(input.username || "").trim().toLowerCase();
  const password = String(input.password || "");
  const client = normalizeClientMeta(input.client);
  if (!username || !password) {
    throw new OnboardingError("Email and password are required.");
  }
  if (!username.includes("@")) {
    throw new OnboardingError("Enter a valid email address.");
  }

  const doc = await findByPortalUser(cfg, username);
  if (!doc?.name) {
    throw new OnboardingError("Invalid email or password.", 401);
  }

  // Confirm ERP User exists for this onboarding account
  try {
    await erpFetch(cfg, `resource/User/${encodeURIComponent(username)}?fields=${encodeURIComponent(JSON.stringify(["name", "email", "enabled"]))}`);
  } catch {
    throw new OnboardingError(
      "Portal account is not ready. Ask Procurement to generate credentials.",
      403,
    );
  }

  const portal = getPortalMeta(doc);
  if (!portal.password_hash || !portal.password_salt) {
    throw new OnboardingError(
      "Portal account is not ready. Ask Procurement to generate credentials.",
      403,
    );
  }
  if (!verifyPassword(password, portal.password_salt, portal.password_hash)) {
    await saveDocWithRetry(cfg, doc.name, (fresh) => {
      const meta = getPortalMeta(fresh);
      setPortalMeta(fresh, {
        ...meta,
        login_history: pushLoginHistory(meta, {
          at: nowIso(),
          ...client,
          status: "Failed",
          auth_mode: "account",
        }),
      });
    }).catch(() => undefined);
    throw new OnboardingError("Invalid email or password.", 401);
  }
  if (doc.status === "Rejected") {
    throw new OnboardingError("This onboarding was rejected. Contact Procurement.", 403);
  }

  const sessionToken = randomBytes(32).toString("hex");
  const sessionExpires = addDaysIso(7);
  const isFirst = !!portal.first_login;

  const saved = await saveDocWithRetry(cfg, doc.name, (fresh) => {
    fresh.secure_token = sessionToken;
    const meta = getPortalMeta(fresh);
    setPortalMeta(fresh, {
      ...meta,
      session_token: sessionToken,
      session_expires: sessionExpires,
      login_history: pushLoginHistory(meta, {
        at: nowIso(),
        ...client,
        status: "Success",
        auth_mode: "account",
      }),
      active_sessions: upsertActiveSession(meta, sessionToken, client),
    });
    if (isFirst) {
      pushTimeline(fresh, "First Login", String(fresh.portal_user || username));
    }
    if (fresh.status === "Link Generated") {
      fresh.status = "Opened";
    }
  });

  const profile = buildPortalProfile(saved);
  return {
    ...profile,
    session_token: sessionToken,
    first_login: isFirst,
    onboarding_status: String(saved.status || profile.display_status || ""),
  };
}

/**
 * Forgot password — OTP flow.
 * Generates a 6-digit OTP, stores a hash on the onboarding portal meta,
 * and returns the OTP to the client when outbound email is not configured
 * (same operational pattern as the previous reset-link response).
 */
export async function portalForgotPassword(input: {
  email: string;
  origin?: string;
}) {
  const cfg = readErpAdminConfig();
  const email = String(input.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new OnboardingError("Enter a valid email address.");
  }

  const doc = await findByPortalUser(cfg, email);
  // Always return a generic success shape when account is missing (no email enumeration)
  if (!doc?.name) {
    return {
      success: true as const,
      message:
        "If an account exists for this email, a one-time passcode was sent. Contact Procurement if you need help.",
    };
  }

  const otp = String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, "0");
  const otpSalt = randomBytes(16).toString("hex");
  const otpHash = hashPassword(otp, otpSalt);
  const otpExpires = new Date(Date.now() + OTP_TTL_MS)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");

  // Keep ERPNext reset link as a secondary recovery path for User desk password.
  const link = await generatePasswordSetupLink(cfg, email, input.origin).catch(() => "");

  await saveDocWithRetry(cfg, doc.name, (fresh) => {
    if (link) fresh.set_password_link = link;
    const meta = getPortalMeta(fresh);
    setPortalMeta(fresh, {
      ...meta,
      otp_hash: otpHash,
      otp_salt: otpSalt,
      otp_expires: otpExpires,
      otp_attempts: 0,
    });
    pushTimeline(fresh, "Password OTP Generated", "Supplier", "OTP issued for portal reset", {
      allowDuplicate: true,
    });
  }).catch(() => undefined);

  return {
    success: true as const,
    message:
      "A one-time passcode is ready. Enter the OTP and choose a new password to finish resetting.",
    otp,
    expires_in_minutes: 10,
    set_password_link: link || undefined,
  };
}

export async function portalResetPasswordWithOtp(input: {
  email: string;
  otp: string;
  new_password: string;
}) {
  const cfg = readErpAdminConfig();
  const email = String(input.email || "").trim().toLowerCase();
  const otp = String(input.otp || "").trim();
  const next = String(input.new_password || "");
  if (!email || !email.includes("@")) {
    throw new OnboardingError("Enter a valid email address.");
  }
  if (!/^\d{6}$/.test(otp)) {
    throw new OnboardingError("Enter the 6-digit OTP.");
  }
  const check = validatePortalPassword(next);
  if (!check.ok) {
    throw new OnboardingError(check.message || PORTAL_PASSWORD_POLICY_MESSAGE);
  }

  const doc = await findByPortalUser(cfg, email);
  if (!doc?.name) {
    throw new OnboardingError("Invalid OTP or email.", 400);
  }
  const portal = getPortalMeta(doc);
  if (!portal.otp_hash || !portal.otp_salt || !portal.otp_expires) {
    throw new OnboardingError("OTP is invalid or expired. Request a new code.", 400);
  }
  const expMs = parseSessionExpiry(portal.otp_expires);
  if (expMs != null && expMs < Date.now()) {
    throw new OnboardingError("OTP has expired. Request a new code.", 400);
  }
  if ((portal.otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    throw new OnboardingError("Too many OTP attempts. Request a new code.", 429);
  }
  if (!verifyPassword(otp, portal.otp_salt, portal.otp_hash)) {
    await saveDocWithRetry(cfg, doc.name, (fresh) => {
      const meta = getPortalMeta(fresh);
      setPortalMeta(fresh, { ...meta, otp_attempts: (meta.otp_attempts || 0) + 1 });
    }).catch(() => undefined);
    throw new OnboardingError("Invalid OTP or email.", 400);
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(next, salt);

  if (email) {
    let updated = false;
    for (let attempt = 0; attempt < 3 && !updated; attempt++) {
      try {
        await erpFetch(cfg, `resource/User/${encodeURIComponent(email)}`, {
          method: "PUT",
          body: { new_password: next },
        });
        updated = true;
      } catch (err) {
        const msg = stripFrappeNoise(err instanceof Error ? err.message : String(err));
        if (isPasswordPolicyError(msg)) {
          throw new OnboardingError(PORTAL_PASSWORD_POLICY_MESSAGE, 400);
        }
        if (attempt === 2) {
          throw new OnboardingError(
            "Could not update password in ERPNext. Please try again.",
            502,
          );
        }
      }
    }
  }

  await saveDocWithRetry(cfg, doc.name, (fresh) => {
    const meta = getPortalMeta(fresh);
    setPortalMeta(fresh, {
      ...meta,
      password_hash: passwordHash,
      password_salt: salt,
      temp_password: undefined,
      first_login: false,
      otp_hash: undefined,
      otp_salt: undefined,
      otp_expires: undefined,
      otp_attempts: 0,
      // Force re-login on all devices after reset
      session_token: undefined,
      session_expires: undefined,
      active_sessions: [],
    });
    fresh.secure_token = "";
    pushTimeline(fresh, "Password Reset via OTP", email || "Supplier");
  });

  return {
    success: true as const,
    message: "Password updated. Sign in with your new password.",
  };
}

export async function portalChangePassword(input: {
  session_token: string;
  current_password: string;
  new_password: string;
}) {
  const cfg = readErpAdminConfig();
  const doc = await findBySessionToken(cfg, input.session_token);
  if (!doc?.name) throw new OnboardingError("Session expired. Please sign in again.", 401);

  const portal = getPortalMeta(doc);
  if (!portal.password_hash || !portal.password_salt) {
    throw new OnboardingError("Password change is not available.", 400);
  }
  if (!verifyPassword(input.current_password, portal.password_salt, portal.password_hash)) {
    throw new OnboardingError("Current password is incorrect.", 400);
  }
  const next = String(input.new_password || "");
  const check = validatePortalPassword(next);
  if (!check.ok) {
    logPortalPasswordValidation("portalChangePassword", check, next.length);
    throw new OnboardingError(check.message || PORTAL_PASSWORD_POLICY_MESSAGE);
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(next, salt);
  const email = String(doc.portal_user || doc.email || "");

  if (email) {
    let updated = false;
    for (let attempt = 0; attempt < 3 && !updated; attempt++) {
      try {
        await erpFetch(cfg, `resource/User/${encodeURIComponent(email)}`, {
          method: "PUT",
          body: { new_password: next },
        });
        updated = true;
      } catch (err) {
        const msg = stripFrappeNoise(err instanceof Error ? err.message : String(err));
        if (isPasswordPolicyError(msg)) {
          throw new OnboardingError(PORTAL_PASSWORD_POLICY_MESSAGE, 400);
        }
        if (attempt === 2) {
          throw new OnboardingError(
            "Could not update password in ERPNext. Please try again.",
            502,
          );
        }
      }
    }
  }

  const saved = await saveDocWithRetry(cfg, doc.name, (fresh) => {
    const meta = getPortalMeta(fresh);
    setPortalMeta(fresh, {
      ...meta,
      password_hash: passwordHash,
      password_salt: salt,
      temp_password: undefined,
      first_login: false,
    });
    pushTimeline(fresh, "Password Changed", email || "Supplier");
  });

  return { ...buildPortalProfile(saved), first_login: false };
}

export async function portalGetSecurity(input: {
  session_token?: string;
  supplier_name?: string;
}) {
  const cfg = readErpAdminConfig();
  const sessionToken = String(input.session_token || "").trim();
  let doc: OnboardingDoc | null = null;
  if (sessionToken) {
    doc = await findBySessionToken(cfg, sessionToken);
  } else if (input.supplier_name) {
    doc = await findByLinkedSupplier(cfg, String(input.supplier_name));
  }
  if (!doc?.name) {
    throw new OnboardingError("Session expired. Please sign in again.", 401);
  }

  const meta = getPortalMeta(doc);
  const currentHash = sessionToken ? hashToken(sessionToken) : "";
  const sessions = (meta.active_sessions || []).map((s) => ({
    id: s.id,
    created_at: s.created_at,
    last_seen: s.last_seen,
    browser: s.browser,
    device: s.device,
    ip: s.ip,
    is_current: !!currentHash && s.token_hash === currentHash,
  }));

  return {
    success: true as const,
    auth_modes: {
      account: !!(meta.password_hash && meta.password_salt),
      pin: true,
      pin_customized: !!(meta.pin_hash && meta.pin_salt),
    },
    login_history: meta.login_history || [],
    active_sessions: sessions,
    portal_user: String(doc.portal_user || doc.email || ""),
    linked_supplier: String(doc.linked_supplier || ""),
  };
}

export async function portalChangePin(input: {
  session_token?: string;
  supplier_name?: string;
  current_pin: string;
  new_pin: string;
}) {
  const cfg = readErpAdminConfig();
  const sessionToken = String(input.session_token || "").trim();
  const supplierName = String(input.supplier_name || "").trim();
  const currentPin = String(input.current_pin || "").trim();
  const newPin = String(input.new_pin || "").trim();

  if (!/^\d{4}$/.test(newPin)) {
    throw new OnboardingError("New PIN must be exactly 4 digits.");
  }
  if (newPin === currentPin) {
    throw new OnboardingError("New PIN must be different from the current PIN.");
  }

  let doc: OnboardingDoc | null = null;
  if (sessionToken) {
    doc = await findBySessionToken(cfg, sessionToken);
  } else if (supplierName) {
    doc = await findByLinkedSupplier(cfg, supplierName);
  }
  if (!doc?.name) {
    throw new OnboardingError(
      "PIN change requires a linked Supplier Onboarding record. Contact Procurement.",
      400,
    );
  }

  // Authenticated owner only: session token (account) and/or matching supplier_name (PIN).
  if (!sessionToken && supplierName) {
    const linked = String(doc.linked_supplier || "").trim();
    if (linked && linked !== supplierName) {
      throw new OnboardingError("You can only change the PIN for your own supplier account.", 403);
    }
  }

  const meta = getPortalMeta(doc);
  if (!verifyPortalPin(currentPin, meta)) {
    throw new OnboardingError("Current PIN is incorrect.", 400);
  }

  const salt = randomBytes(16).toString("hex");
  const pinHash = hashPassword(newPin, salt);
  await saveDocWithRetry(cfg, doc.name, (fresh) => {
    const m = getPortalMeta(fresh);
    setPortalMeta(fresh, {
      ...m,
      pin_hash: pinHash,
      pin_salt: salt,
    });
    pushTimeline(fresh, "Portal PIN Changed", String(fresh.portal_user || fresh.linked_supplier || "Supplier"));
  });

  return { success: true as const, message: "Portal PIN updated successfully." };
}

export async function portalLogoutOtherSessions(input: { session_token: string }) {
  const cfg = readErpAdminConfig();
  const sessionToken = String(input.session_token || "").trim();
  if (!sessionToken) {
    throw new OnboardingError("Session expired. Please sign in again.", 401);
  }
  const doc = await findBySessionToken(cfg, sessionToken);
  if (!doc?.name) {
    throw new OnboardingError("Session expired. Please sign in again.", 401);
  }

  const currentHash = hashToken(sessionToken);
  await saveDocWithRetry(cfg, doc.name, (fresh) => {
    const meta = getPortalMeta(fresh);
    const current = (meta.active_sessions || []).find((s) => s.token_hash === currentHash);
    setPortalMeta(fresh, {
      ...meta,
      // Keep this device's session token; drop other device tokens from the roster
      active_sessions: current
        ? [{ ...current, last_seen: nowIso() }]
        : upsertActiveSession(meta, sessionToken, {
            browser: "This device",
            device: "Desktop",
            ip: "—",
          }),
      session_token: sessionToken,
    });
    fresh.secure_token = sessionToken;
    pushTimeline(
      fresh,
      "Logged Out Other Devices",
      String(fresh.portal_user || "Supplier"),
      undefined,
      { allowDuplicate: true },
    );
  });

  return {
    message: "All other devices have been signed out.",
    ...(await portalGetSecurity({ session_token: sessionToken })),
  };
}

/**
 * Server-side PIN authentication for legacy Company PIN login.
 * Verifies PIN (custom hash or default 1234), records login history when
 * an onboarding record is linked, and returns supplier identity for token issue.
 */
export async function portalAuthenticatePin(input: {
  supplier_name: string;
  pin: string;
  client?: PortalClientMeta;
}) {
  const cfg = readErpAdminConfig();
  const supplierName = String(input.supplier_name || "").trim();
  const pin = String(input.pin || "").trim();
  const client = normalizeClientMeta(input.client);
  if (!supplierName) {
    throw new OnboardingError("Supplier is required.", 400);
  }
  if (!/^\d{4}$/.test(pin)) {
    throw new OnboardingError("Portal PIN must be 4 digits.", 400);
  }

  const doc = await findByLinkedSupplier(cfg, supplierName);
  if (doc?.name) {
    const meta = getPortalMeta(doc);
    const ok = verifyPortalPin(pin, meta);
    await saveDocWithRetry(cfg, doc.name, (fresh) => {
      const m = getPortalMeta(fresh);
      setPortalMeta(fresh, {
        ...m,
        login_history: pushLoginHistory(m, {
          at: nowIso(),
          ...client,
          status: ok ? "Success" : "Failed",
          auth_mode: "pin",
        }),
      });
    }).catch(() => undefined);
    if (!ok) {
      throw new OnboardingError("Incorrect PIN.", 401);
    }
  } else if (pin !== DEFAULT_LEGACY_PIN) {
    throw new OnboardingError("Incorrect PIN.", 401);
  }

  return {
    success: true as const,
    supplier: supplierName,
  };
}

export async function portalGetProfile(sessionToken: string) {
  const cfg = readErpAdminConfig();
  const doc = await findBySessionToken(cfg, sessionToken);
  if (!doc) throw new OnboardingError("Session expired. Please sign in again.", 401);
  return buildPortalProfileWithSupplierFields(cfg, doc);
}

export async function portalSaveDraft(input: {
  session_token: string;
  values?: Record<string, unknown>;
  form_data_fields?: Record<string, unknown>;
  documents?: Array<{ document_type: string; file_url: string; file_name?: string }>;
}) {
  const cfg = readErpAdminConfig();
  const existing = await findBySessionToken(cfg, input.session_token);
  if (!existing?.name) throw new OnboardingError("Session expired. Please sign in again.", 401);

  const linked = String(existing.linked_supplier || "").trim();
  const erp = linked ? await loadSupplierCustomProfileFields(cfg, linked) : null;

  // Procurement-owned classification: supplier input only fills legacy gaps
  const resolved = resolveClassification(
    existing,
    { ...(input.form_data_fields || {}), ...(input.values || {}) },
    erp,
  );
  const classificationFields = {
    custom_sourcing_type: resolved.custom_sourcing_type,
    custom_supplier_category: resolved.custom_supplier_category,
  };
  const sanitizedFormData = {
    ...(input.form_data_fields || {}),
    ...classificationFields,
  };

  // Locked / approved: only allow write-once ERP classification fill (legacy)
  if (!PUBLIC_EDITABLE.has(String(existing.status))) {
    if (!linked) {
      throw new OnboardingError("This onboarding is locked and cannot be edited.");
    }
    if (!classificationFields.custom_sourcing_type) {
      throw new OnboardingError("Supplier Type is required.");
    }
    if (!classificationFields.custom_supplier_category) {
      throw new OnboardingError("Supplier Category is required.");
    }
    await saveSupplierCustomProfileFields(cfg, linked, classificationFields);
    await saveDocWithRetry(cfg, existing.name, (doc) => {
      const current = parseFormData(doc.form_data);
      // Never let supplier overwrite Procurement's supplier_type / category columns
      writeFormData(
        doc,
        {
          ...current.fields,
          ...classificationFields,
        },
        current.portal,
      );
    }).catch(() => undefined);
    const fresh = await getDoc(cfg, existing.name);
    return {
      ...(await buildPortalProfileWithSupplierFields(cfg, fresh)),
      unchanged: false,
    };
  }

  // Sync mandatory Supplier Master custom fields when linked (write-once)
  if (linked) {
    await saveSupplierCustomProfileFields(cfg, linked, classificationFields);
  }

  if (
    !draftWouldChange(
      existing,
      input.values || {},
      sanitizedFormData,
      input.documents,
    )
  ) {
    const fresh = linked ? await getDoc(cfg, existing.name) : existing;
    return {
      ...(await buildPortalProfileWithSupplierFields(cfg, fresh)),
      unchanged: true,
    };
  }

  const saved = await saveDocWithRetry(cfg, existing.name, (doc) => {
    if (!PUBLIC_EDITABLE.has(String(doc.status))) {
      throw new OnboardingError("This onboarding is locked and cannot be edited.");
    }
    const changeSections = parseChangeSections(doc.requested_change_sections);
    if (doc.status === "Changes Requested" && changeSections.length) {
      // Only allow fields belonging to requested steps — enforced lightly via values
    }

    // Strip supplier attempts to change Procurement-owned classification columns
    const safeValues = { ...(input.values || {}) };
    delete safeValues.supplier_type;
    delete safeValues.supplier_category;

    const changed = applySupplierValues(doc, safeValues, sanitizedFormData);

    // Legacy gap-fill: if Procurement never set classification, adopt the
    // supplier's first save onto the onboarding columns (then permanently locked).
    let classificationAdopted = false;
    if (
      !String(doc.supplier_type || "").trim() &&
      classificationFields.custom_sourcing_type
    ) {
      doc.supplier_type = classificationFields.custom_sourcing_type;
      classificationAdopted = true;
    }
    if (
      !String(doc.supplier_category || "").trim() &&
      classificationFields.custom_supplier_category
    ) {
      doc.supplier_category = classificationFields.custom_supplier_category;
      classificationAdopted = true;
    }

    let docsChanged = false;
    if (input.documents?.length) {
      const currentDocs = [...(doc.documents || [])];
      for (const d of input.documents) {
        const dup = currentDocs.some(
          (x) => x.file_url === d.file_url && x.document_type === d.document_type,
        );
        if (dup) continue;
        currentDocs.push({
          doctype: "Supplier Onboarding Document",
          document_type: d.document_type,
          file_url: d.file_url,
          file_name: d.file_name || "",
          uploaded_on: nowIso(),
        });
        docsChanged = true;
      }
      doc.documents = currentDocs;
    }
    if (!changed && !docsChanged && !classificationAdopted) return false;
    if (doc.status === "Opened" || doc.status === "Link Generated") {
      doc.status = "In Progress";
    }
    pushTimeline(doc, "Draft Saved", "Supplier", "", { allowDuplicate: true });
  });

  return {
    ...(await buildPortalProfileWithSupplierFields(cfg, saved)),
    unchanged: false,
  };
}

export async function portalSubmit(input: {
  session_token: string;
  values?: Record<string, unknown>;
  form_data_fields?: Record<string, unknown>;
}) {
  const cfg = readErpAdminConfig();
  const existing = await findBySessionToken(cfg, input.session_token);
  if (!existing?.name) throw new OnboardingError("Session expired. Please sign in again.", 401);
  if (!PUBLIC_EDITABLE.has(String(existing.status))) {
    throw new OnboardingError("Already submitted or locked.");
  }

  const saved = await saveDocWithRetry(cfg, existing.name, (doc) => {
    if (!PUBLIC_EDITABLE.has(String(doc.status))) {
      throw new OnboardingError("Already submitted or locked.");
    }
    applySupplierValues(doc, input.values || {}, input.form_data_fields);
    if (!(doc.company_name || "").toString().trim()) {
      throw new OnboardingError("Company Name is required before submit.");
    }
    const wasChanges = doc.status === "Changes Requested";
    doc.requested_change_sections = "";
    doc.approvals = ONBOARDING_APPROVAL_STAGES.map((s) => ({
      doctype: "Supplier Onboarding Approval",
      stage: s.id,
      stage_order: s.order,
      status: "Pending",
      comments: "",
    }));
    doc.approval_stage = ONBOARDING_APPROVAL_STAGES[0].id;
    doc.approval_status = "Pending";
    doc.status = "Under Review";
    if (wasChanges) {
      pushTimeline(doc, "Resubmitted", "Supplier", "", { allowDuplicate: true });
    } else {
      pushTimeline(doc, "Submitted", "Supplier");
    }
    pushTimeline(doc, "Under Review", "Supplier");
    pushTimeline(doc, "Procurement Review", "System");
  });

  return { ...buildPortalProfile(saved) };
}

export async function portalAddComment(input: {
  session_token?: string;
  sessionToken?: string;
  text: string;
  file_url?: string;
  file_name?: string;
  section_tag?: string;
}) {
  return addDiscussionMessage({
    session_token: String(input.session_token || input.sessionToken || ""),
    viewer: "supplier",
    text: input.text,
    file_url: input.file_url,
    file_name: input.file_name,
    section_tag: input.section_tag,
  });
}

export async function listDiscussion(input: {
  name?: string;
  session_token?: string;
  viewer: DiscussionViewer;
}) {
  const cfg = readErpAdminConfig();
  const viewer = input.viewer === "procurement" ? "procurement" : "supplier";
  let doc: OnboardingDoc | null = null;
  if (viewer === "procurement") {
    const name = String(input.name || "").trim();
    if (!name) throw new OnboardingError("Onboarding name is required.");
    doc = await getDoc(cfg, name);
  } else {
    const token = String(input.session_token || "").trim();
    doc = await findBySessionToken(cfg, token);
    if (!doc?.name) throw new OnboardingError("Session expired. Please sign in again.", 401);
  }
  // Persist migrated legacy comments into discussion storage when needed
  const before = readDiscussionMessages(doc);
  const portal = getPortalMeta(doc);
  if ((!doc.discussion || asArray(doc.discussion).length === 0) && before.length) {
    await saveDocWithRetry(cfg, doc.name!, (fresh) => {
      writeDiscussionMessages(fresh, readDiscussionMessages(fresh));
    }).catch(() => undefined);
    doc = await getDoc(cfg, doc.name!);
  } else if (portal.comments?.length && before.length && !portal.discussion?.length) {
    await saveDocWithRetry(cfg, doc.name!, (fresh) => {
      writeDiscussionMessages(fresh, readDiscussionMessages(fresh));
    }).catch(() => undefined);
    doc = await getDoc(cfg, doc.name!);
  }
  return { success: true as const, ...buildDiscussionPayload(doc, viewer) };
}

export async function addDiscussionMessage(input: {
  name?: string;
  session_token?: string;
  viewer: DiscussionViewer;
  text: string;
  actor?: string;
  section_tag?: string;
  file_url?: string;
  file_name?: string;
}) {
  const cfg = readErpAdminConfig();
  const text = String(input.text || "").trim();
  const fileUrl = String(input.file_url || "").trim();
  if (!text && !fileUrl) {
    throw new OnboardingError("Message text or attachment is required.");
  }
  const viewer = input.viewer === "procurement" ? "procurement" : "supplier";

  let docName = "";
  let existing: OnboardingDoc | null = null;
  if (viewer === "procurement") {
    docName = String(input.name || "").trim();
    if (!docName) throw new OnboardingError("Onboarding name is required.");
    existing = await getDoc(cfg, docName);
  } else {
    const token = String(input.session_token || "").trim();
    existing = await findBySessionToken(cfg, token);
    if (!existing?.name) throw new OnboardingError("Session expired. Please sign in again.", 401);
    docName = existing.name;
  }

  const sender_role = viewer === "procurement" ? "Procurement" : "Supplier";
  const sender_name =
    String(
      input.actor ||
        (viewer === "procurement"
          ? "Procurement"
          : existing?.portal_user || existing?.contact_person || existing?.company_name || "Supplier"),
    ).trim() || sender_role;

  let section_tag = String(input.section_tag || "").trim();
  if (viewer === "supplier") section_tag = ""; // suppliers cannot tag sections
  if (section_tag && !DISCUSSION_SECTION_TAGS.includes(section_tag as (typeof DISCUSSION_SECTION_TAGS)[number])) {
    section_tag = mapSectionIdToTag(section_tag);
  }

  const saved = await saveDocWithRetry(cfg, docName, (doc) => {
    const messages = readDiscussionMessages(doc);
    messages.push({
      message_id: randomBytes(8).toString("hex"),
      sender_role,
      sender_name,
      message: text || (fileUrl ? "Attachment" : ""),
      sent_on: nowIso(),
      section_tag: section_tag || "",
      file_url: fileUrl || undefined,
      file_name: String(input.file_name || "").trim() || undefined,
      resolved: 0,
      read_by_procurement: viewer === "procurement" ? 1 : 0,
      read_by_supplier: viewer === "supplier" ? 1 : 0,
    });
    writeDiscussionMessages(doc, messages);
    pushTimeline(
      doc,
      "Discussion Message",
      sender_name,
      viewer === "procurement" ? "Message sent to supplier" : "Message sent to procurement",
      { allowDuplicate: true },
    );

    // Legacy comments mirror
    const portal = getPortalMeta(doc);
    const comments = sortPortalComments(portal.comments);
    comments.push({
      id: randomBytes(8).toString("hex"),
      author: sender_name,
      role: viewer === "procurement" ? "procurement" : "supplier",
      text: text || (fileUrl ? "Attachment" : ""),
      at: nowIso(),
    });
    setPortalMeta(doc, { ...getPortalMeta(doc), comments });
  });

  return {
    success: true as const,
    ...buildDiscussionPayload(saved, viewer),
    ...(viewer === "supplier" ? buildPortalProfile(saved) : {}),
  };
}

export async function markDiscussionRead(input: {
  name?: string;
  session_token?: string;
  viewer: DiscussionViewer;
}) {
  const cfg = readErpAdminConfig();
  const viewer = input.viewer === "procurement" ? "procurement" : "supplier";
  let docName = "";
  if (viewer === "procurement") {
    docName = String(input.name || "").trim();
    if (!docName) throw new OnboardingError("Onboarding name is required.");
  } else {
    const token = String(input.session_token || "").trim();
    const existing = await findBySessionToken(cfg, token);
    if (!existing?.name) throw new OnboardingError("Session expired. Please sign in again.", 401);
    docName = existing.name;
  }

  const saved = await saveDocWithRetry(cfg, docName, (doc) => {
    const messages = readDiscussionMessages(doc).map((m) => {
      if (viewer === "supplier") return { ...m, read_by_supplier: 1 };
      return { ...m, read_by_procurement: 1 };
    });
    writeDiscussionMessages(doc, messages);
    const portal = getPortalMeta(doc);
    setPortalMeta(doc, {
      ...portal,
      notify_supplier: viewer === "supplier" ? false : portal.notify_supplier,
      notify_procurement: viewer === "procurement" ? false : portal.notify_procurement,
    });
  });

  return { success: true as const, ...buildDiscussionPayload(saved, viewer) };
}

export async function resolveDiscussionMessage(input: {
  name: string;
  message_id: string;
  actor?: string;
  resolved?: boolean;
}) {
  const cfg = readErpAdminConfig();
  const name = String(input.name || "").trim();
  const messageId = String(input.message_id || "").trim();
  if (!name) throw new OnboardingError("Onboarding name is required.");
  if (!messageId) throw new OnboardingError("Message id is required.");
  const markResolved = input.resolved !== false;

  const saved = await saveDocWithRetry(cfg, name, (doc) => {
    const messages = readDiscussionMessages(doc);
    const idx = messages.findIndex((m) => m.message_id === messageId);
    if (idx < 0) throw new OnboardingError("Discussion message not found.", 404);
    const row = messages[idx]!;
    messages[idx] = {
      ...row,
      resolved: markResolved ? 1 : 0,
      resolved_by: markResolved ? String(input.actor || "Procurement") : "",
      resolved_on: markResolved ? nowIso() : "",
    };
    writeDiscussionMessages(doc, messages);
    pushTimeline(
      doc,
      markResolved ? "Discussion Resolved" : "Discussion Reopened",
      input.actor || "Procurement",
      row.message.slice(0, 120),
      { allowDuplicate: true },
    );
  });

  return { success: true as const, ...buildDiscussionPayload(saved, "procurement") };
}

export async function resolveDocnameForSession(sessionToken: string): Promise<string> {
  const cfg = readErpAdminConfig();
  const doc = await findBySessionToken(cfg, sessionToken);
  if (!doc?.name) throw new OnboardingError("Session expired. Please sign in again.", 401);
  if (!PUBLIC_EDITABLE.has(String(doc.status)) && doc.status !== "Changes Requested") {
    throw new OnboardingError("Uploads are locked for this onboarding.");
  }
  return doc.name;
}
