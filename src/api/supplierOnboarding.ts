/**
 * Client for Supplier Onboarding APIs.
 * Uses fetch with credentials omitted — never shares ERP Desk sid cookies.
 */

import type { OnboardingStepDef } from "../config/supplierOnboardingForm";

export type OnboardingStatus =
  | "Draft"
  | "Link Generated"
  | "Opened"
  | "In Progress"
  | "Submitted"
  | "Under Review"
  | "Changes Requested"
  | "Approved"
  | "Rejected"
  | "Expired";

export interface SupplierCategoryRow {
  name: string;
  category_name: string;
  supplier_type_scope: string;
  sort_order: number;
}

export interface OnboardingListRow {
  name: string;
  company_name?: string;
  contact_person?: string;
  email?: string;
  supplier_type?: string;
  supplier_category?: string;
  status?: OnboardingStatus | string;
  created_by_user?: string;
  creation?: string;
  modified?: string;
  linked_supplier?: string;
  unread_for_procurement?: number;
  unread_for_supplier?: number;
}

export interface OnboardingRecord extends OnboardingListRow {
  mobile_no?: string;
  plant?: string;
  remarks?: string;
  secure_token?: string;
  token_expires_on?: string;
  form_data?: string;
  gst_number?: string;
  pan?: string;
  business_registration_number?: string;
  website?: string;
  address_line?: string;
  country?: string;
  state?: string;
  city?: string;
  postal_code?: string;
  designation?: string;
  phone?: string;
  alternate_phone?: string;
  years_in_business?: string;
  employee_count?: string;
  annual_turnover?: string;
  preferred_currency?: string;
  payment_terms?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  bank_branch?: string;
  manufacturing_plant?: string;
  factory_address?: string;
  production_capacity?: string;
  monthly_capacity?: string;
  lead_time?: string;
  moq?: string;
  quality_certifications?: string;
  iso_certified?: number;
  iatf_certified?: number;
  production_process?: string;
  machine_list?: string;
  material_categories?: string;
  countries_exported?: string;
  business_type?: string;
  service_area?: string;
  delivery_coverage?: string;
  support_availability?: string;
  amc_available?: number;
  sla_available?: number;
  contract_duration?: string;
  approval_stage?: string;
  approval_status?: string;
  portal_user?: string;
  set_password_link?: string;
  requested_change_sections?: string;
  timeline?: Array<{
    event?: string;
    event_on?: string;
    actor?: string;
    notes?: string;
  }>;
  documents?: Array<{
    document_type?: string;
    file_url?: string;
    file_name?: string;
    uploaded_on?: string;
  }>;
  approvals?: Array<{
    stage?: string;
    stage_order?: number;
    status?: string;
    acted_by?: string;
    acted_on?: string;
    comments?: string;
  }>;
  [key: string]: unknown;
}

export interface OnboardingStats {
  total: number;
  draft: number;
  generated: number;
  submitted: number;
  pending_review: number;
  approved: number;
  rejected: number;
  expired: number;
}

async function callApi<T>(
  action: string,
  body?: unknown,
  method: "GET" | "POST" = "POST",
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method === "POST") headers["Content-Type"] = "application/json";
  try {
    const token =
      sessionStorage.getItem("bidsphere-access-token") ||
      localStorage.getItem("bidsphere-access-token-remember");
    if (token) headers["X-Bidsphere-Access-Token"] = token;
  } catch {
    /* ignore */
  }
  const res = await fetch(`/api/supplier-onboarding/${action}`, {
    method,
    credentials: "omit",
    headers: Object.keys(headers).length ? headers : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  let json: { success?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok || json.success === false) {
    const err = new Error(
      (typeof json.error === "string" && json.error) ||
        `Onboarding request failed (${res.status}).`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

/** Portal-authenticated calls — always attach the live session token from sessionStorage. */
async function portalCallApi<T>(
  action: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let sessionToken = "";
  try {
    const raw = sessionStorage.getItem("supplier_session");
    if (raw) {
      const parsed = JSON.parse(raw) as { sessionToken?: string };
      sessionToken = String(parsed.sessionToken || "").trim();
    }
  } catch {
    sessionToken = "";
  }
  if (!sessionToken && typeof body?.session_token === "string") {
    sessionToken = String(body.session_token).trim();
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionToken) {
    headers["X-Supplier-Session"] = sessionToken;
  }
  try {
    const token =
      sessionStorage.getItem("bidsphere-access-token") ||
      localStorage.getItem("bidsphere-access-token-remember");
    if (token) headers["X-Bidsphere-Access-Token"] = token;
  } catch {
    /* ignore */
  }

  const res = await fetch(`/api/supplier-onboarding/${action}`, {
    method: "POST",
    credentials: "omit",
    headers,
    body: JSON.stringify({
      ...(body ?? {}),
      ...(sessionToken ? { session_token: sessionToken } : {}),
    }),
  });
  let json: { success?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok || json.success === false) {
    const err = new Error(
      (typeof json.error === "string" && json.error) ||
        `Onboarding request failed (${res.status}).`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export async function listSupplierCategories(supplierType?: string) {
  const data = await callApi<{ categories: SupplierCategoryRow[] }>("list-categories", {
    supplier_type: supplierType,
  });
  return data.categories ?? [];
}

export async function getOnboardingStats() {
  const data = await callApi<{ stats: OnboardingStats }>("stats", undefined, "GET");
  return data.stats;
}

export async function listOnboardings(filters?: {
  status?: string;
  supplier_type?: string;
  supplier_category?: string;
  search?: string;
}) {
  const data = await callApi<{ records: OnboardingListRow[] }>("list", filters ?? {});
  return data.records ?? [];
}

export async function getOnboardingDetail(name: string) {
  return callApi<{
    success: true;
    record: OnboardingRecord;
    steps: OnboardingStepDef[];
    form_data_fields: Record<string, unknown>;
    approval_stages: Array<{ id: string; label: string; order: number }>;
  }>("get", { name });
}

export async function createOnboarding(payload: {
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
  return callApi<{ success: true; record: OnboardingRecord }>("create", payload);
}

export async function saveOnboardingDraft(payload: Record<string, unknown>) {
  return callApi<{ success: true; record: OnboardingRecord }>("save-draft", payload);
}

export async function generateOnboardingLink(payload: {
  name: string;
  actor?: string;
  origin?: string;
}) {
  return generateSupplierAccount(payload);
}

export async function generateSupplierAccount(payload: {
  name: string;
  actor?: string;
  origin?: string;
}) {
  return callApi<{
    success: true;
    record: OnboardingRecord;
    username: string;
    temporary_password: string;
    login_path: string;
    login_url: string;
    set_password_link?: string;
  }>("generate-account", payload);
}

export type DiscussionViewer = "supplier" | "procurement";

export type DiscussionMessage = {
  message_id: string;
  sender_role: "Supplier" | "Procurement";
  sender_name: string;
  message: string;
  sent_on: string;
  section_tag?: string;
  file_url?: string;
  file_name?: string;
  resolved?: number;
  resolved_by?: string;
  resolved_on?: string;
  read_by_supplier?: number;
  read_by_procurement?: number;
};

export type DiscussionPayload = {
  success: true;
  messages: DiscussionMessage[];
  unread_count: number;
  unread_for_procurement: number;
  unread_for_supplier: number;
  notify?: boolean;
  section_tags: string[];
};

export type PortalProfileResponse = {
  success: true;
  record?: OnboardingRecord;
  steps?: OnboardingStepDef[];
  form_data_fields?: Record<string, unknown>;
  /** When true, supplier cannot edit that classification field. */
  classification_locks?: {
    custom_sourcing_type?: boolean;
    custom_supplier_category?: boolean;
  };
  comments?: Array<{
    id: string;
    author: string;
    role: "procurement" | "supplier";
    text: string;
    at: string;
  }>;
  discussion?: Omit<DiscussionPayload, "success">;
  first_login?: boolean;
  unlocked?: boolean;
  locked?: boolean;
  editable_steps?: string[] | null;
  display_status?: string;
  company_name?: string;
  linked_supplier?: string;
  portal_user?: string;
  session_token?: string;
  access_token?: string;
  unchanged?: boolean;
};

export type PortalClientMeta = {
  browser?: string;
  device?: string;
  ip?: string;
  user_agent?: string;
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

export type PortalActiveSessionRow = {
  id: string;
  created_at: string;
  last_seen: string;
  browser: string;
  device: string;
  ip: string;
  is_current: boolean;
};

export type PortalSecurityResponse = {
  success: true;
  auth_modes: { account: boolean; pin: boolean; pin_customized: boolean };
  login_history: PortalLoginHistoryEntry[];
  active_sessions: PortalActiveSessionRow[];
  portal_user?: string;
  linked_supplier?: string;
};

export async function portalLogin(payload: {
  username: string;
  password: string;
  client?: PortalClientMeta;
}) {
  return callApi<PortalProfileResponse & { onboarding_status?: string }>(
    "portal-login",
    payload,
  );
}

/**
 * Exchange a validated portal session_token for a supplier JWT.
 * Used when the Supplier Portal session exists but the access token is missing
 * (e.g. sessions created before portal-login issued tokens in Vite).
 */
export async function portalIssueAccessToken(sessionToken: string) {
  return portalCallApi<{
    success: true;
    access_token: string;
    supplier: string;
  }>("portal-access-token", { session_token: sessionToken });
}

export async function portalForgotPassword(payload: { email: string; origin?: string }) {
  return callApi<{
    success: true;
    message?: string;
    otp?: string;
    expires_in_minutes?: number;
    set_password_link?: string;
  }>("portal-forgot-password", payload);
}

export async function portalResetPasswordWithOtp(payload: {
  email: string;
  otp: string;
  new_password: string;
}) {
  return callApi<{ success: true; message?: string }>(
    "portal-reset-password-otp",
    payload,
  );
}

export async function portalChangePassword(payload: {
  session_token: string;
  current_password: string;
  new_password: string;
}) {
  return portalCallApi<PortalProfileResponse>("portal-change-password", payload);
}

export async function portalGetSecurity(payload: {
  session_token?: string;
  supplier_name?: string;
}) {
  if (payload.session_token) {
    return portalCallApi<PortalSecurityResponse>(
      "portal-security",
      payload as Record<string, unknown>,
    );
  }
  return callApi<PortalSecurityResponse>("portal-security", payload);
}

export async function portalChangePin(payload: {
  session_token?: string;
  supplier_name?: string;
  current_pin: string;
  new_pin: string;
}) {
  if (payload.session_token) {
    return portalCallApi<{ success: true; message?: string }>(
      "portal-change-pin",
      payload as Record<string, unknown>,
    );
  }
  return callApi<{ success: true; message?: string }>("portal-change-pin", payload);
}

export async function portalLogoutOtherSessions(payload: { session_token: string }) {
  return portalCallApi<PortalSecurityResponse & { message?: string }>(
    "portal-logout-others",
    payload as Record<string, unknown>,
  );
}

export async function portalGetProfile(sessionToken: string) {
  return portalCallApi<PortalProfileResponse>("portal-profile", {
    session_token: sessionToken,
  });
}

export async function portalSaveDraft(payload: {
  session_token: string;
  values?: Record<string, unknown>;
  form_data_fields?: Record<string, unknown>;
  documents?: Array<{ document_type: string; file_url: string; file_name?: string }>;
}) {
  return portalCallApi<PortalProfileResponse>("portal-save-draft", payload as Record<string, unknown>);
}

export async function portalSubmit(payload: {
  session_token: string;
  values?: Record<string, unknown>;
  form_data_fields?: Record<string, unknown>;
}) {
  return portalCallApi<PortalProfileResponse>("portal-submit", payload as Record<string, unknown>);
}

export async function portalAddComment(payload: {
  session_token: string;
  text: string;
  file_url?: string;
  file_name?: string;
  section_tag?: string;
}) {
  return portalCallApi<PortalProfileResponse>("portal-comment", payload);
}

export async function listOnboardingDiscussion(payload: {
  viewer: DiscussionViewer;
  name?: string;
  session_token?: string;
}) {
  if (payload.viewer === "supplier") {
    return portalCallApi<DiscussionPayload>("discussion-list", payload as Record<string, unknown>);
  }
  return callApi<DiscussionPayload>("discussion-list", payload);
}

export async function sendOnboardingDiscussion(payload: {
  viewer: DiscussionViewer;
  name?: string;
  session_token?: string;
  text: string;
  actor?: string;
  section_tag?: string;
  file_url?: string;
  file_name?: string;
}) {
  if (payload.viewer === "supplier") {
    return portalCallApi<DiscussionPayload>("discussion-send", payload as Record<string, unknown>);
  }
  return callApi<DiscussionPayload>("discussion-send", payload);
}

export async function markOnboardingDiscussionRead(payload: {
  viewer: DiscussionViewer;
  name?: string;
  session_token?: string;
}) {
  if (payload.viewer === "supplier") {
    return portalCallApi<DiscussionPayload>(
      "discussion-mark-read",
      payload as Record<string, unknown>,
    );
  }
  return callApi<DiscussionPayload>("discussion-mark-read", payload);
}

export async function resolveOnboardingDiscussion(payload: {
  name: string;
  message_id: string;
  actor?: string;
  resolved?: boolean;
}) {
  return callApi<DiscussionPayload>("discussion-resolve", payload);
}

/* ── TEMPORARY LEGACY MODE (PIN suppliers) ─────────────────────────────── */
// Remove after all suppliers migrate to Account Login.

export async function legacyPinGetProfile(supplierName: string) {
  return callApi<PortalProfileResponse & { legacy_pin?: boolean }>("legacy-pin-profile", {
    supplier_name: supplierName,
  });
}

/** Issue a BidSphere access token for legacy PIN portal sessions (server verifies PIN). */
export async function legacyPinIssueToken(
  supplierName: string,
  pin: string,
  client?: PortalClientMeta,
) {
  return callApi<{ success: true; access_token: string; supplier: string }>(
    "legacy-pin-token",
    { supplier_name: supplierName, pin, client },
  );
}

export async function legacyPinSaveProfile(payload: {
  supplier_name: string;
  values?: Record<string, unknown>;
}) {
  return callApi<PortalProfileResponse & { legacy_pin?: boolean }>("legacy-pin-save", payload);
}

export async function legacyPinResolveUpload(supplierName: string) {
  return callApi<{ success: true; doctype: string; docname: string }>(
    "legacy-pin-resolve-upload",
    { supplier_name: supplierName },
  );
}

export async function legacyPinListDiscussion(payload: {
  supplier_name: string;
  viewer?: DiscussionViewer;
}) {
  return callApi<DiscussionPayload>("legacy-pin-discussion-list", payload);
}

export async function legacyPinSendDiscussion(payload: {
  supplier_name: string;
  viewer?: DiscussionViewer;
  text: string;
  actor?: string;
  section_tag?: string;
  file_url?: string;
  file_name?: string;
}) {
  return callApi<DiscussionPayload>("legacy-pin-discussion-send", payload);
}

export async function legacyPinMarkDiscussionRead(payload: {
  supplier_name: string;
  viewer?: DiscussionViewer;
}) {
  return callApi<DiscussionPayload>("legacy-pin-discussion-mark-read", payload);
}

export async function resolveOnboardingUpload(tokenOrSession: {
  token?: string;
  session_token?: string;
}) {
  return callApi<{ success: true; doctype: string; docname: string }>(
    "resolve-upload",
    tokenOrSession,
  );
}

export async function requestOnboardingChanges(payload: {
  name: string;
  sections: string[];
  comments?: string;
  actor?: string;
}) {
  return callApi<{ success: true; record: OnboardingRecord }>("request-changes", payload);
}

export async function rejectOnboarding(payload: {
  name: string;
  comments?: string;
  actor?: string;
}) {
  return callApi<{ success: true; record: OnboardingRecord }>("reject", payload);
}

export async function approveOnboardingStage(payload: {
  name: string;
  stage?: string;
  comments?: string;
  actor?: string;
  origin?: string;
}) {
  return callApi<{
    success: true;
    finalized: boolean;
    record: OnboardingRecord;
    supplier_name?: string;
    portal_user?: string;
    set_password_link?: string;
  }>("approve-stage", payload);
}
