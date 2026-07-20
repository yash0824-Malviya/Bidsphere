/**
 * TEMPORARY LEGACY MODE
 * Remove after all suppliers migrate to Account Login.
 *
 * Company PIN users load/edit Profile + Documents from ERPNext Supplier Master
 * when ENABLE_LEGACY_PIN_PROFILE is enabled. No Supplier Onboarding draft required.
 */

import { randomBytes } from "node:crypto";
import {
  getOnboardingSteps,
  type OnboardingStepDef,
} from "../src/config/supplierOnboardingForm.js";
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import {
  DISCUSSION_SECTION_TAGS,
  OnboardingError,
  type DiscussionMessage,
  type DiscussionViewer,
  readErpAdminConfig,
  type ErpAdminConfig,
} from "./supplierOnboardingCore.js";

// Re-export flag helper for handlers
export function isLegacyPinProfileEnabledServer(): boolean {
  // TEMPORARY LEGACY MODE — default ON
  const raw = String(
    process.env.ENABLE_LEGACY_PIN_PROFILE ??
      process.env.VITE_ENABLE_LEGACY_PIN_PROFILE ??
      "true",
  )
    .trim()
    .toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function assertLegacyEnabled() {
  if (!isLegacyPinProfileEnabledServer()) {
    throw new OnboardingError(
      "Legacy PIN profile access is disabled. Use Account Login.",
      403,
    );
  }
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `token ${cfg.key}:${cfg.secret}`,
    Accept: "application/json",
  };
  let body: BodyInit | undefined;
  if (init?.body !== undefined) {
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

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/** Map Supplier Master → onboarding-shaped profile fields. */
function supplierToProfileValues(supplier: Record<string, unknown>) {
  const customSourcing = String(supplier.custom_sourcing_type || "").trim();
  const customCategory = String(supplier.custom_supplier_category || "").trim();
  const supplierTypeRaw = String(supplier.supplier_type || "");
  // Steps still need a Direct/Indirect hint; do NOT fake-fill the custom field
  // (empty custom_sourcing_type stays empty so legacy fill dropdowns can appear).
  const supplier_type =
    customSourcing === "Direct" || customSourcing === "Indirect"
      ? customSourcing
      : /service/i.test(supplierTypeRaw) || /indirect/i.test(supplierTypeRaw)
        ? "Indirect"
        : "Direct";

  return {
    company_name: String(supplier.supplier_name || supplier.name || ""),
    email: String(supplier.email_id || ""),
    mobile_no: String(supplier.mobile_no || ""),
    website: String(supplier.website || ""),
    country: String(supplier.country || ""),
    gst_number: String(supplier.tax_id || supplier.gstin || ""),
    pan: String(supplier.pan || ""),
    // Only real ERP custom fields — empty means legacy editable once
    custom_sourcing_type: customSourcing,
    custom_supplier_category: customCategory,
    supplier_type: customSourcing || supplier_type,
    supplier_category: customCategory,
    contact_person: String(
      supplier.supplier_primary_contact || supplier.contact_person || "",
    ),
    phone: String(supplier.mobile_no || ""),
    address_line: String(supplier.supplier_primary_address || ""),
  };
}

/** Safe Supplier Master fields we may write from the legacy profile form. */
const SUPPLIER_WRITABLE: Record<string, string> = {
  company_name: "supplier_name",
  email: "email_id",
  mobile_no: "mobile_no",
  website: "website",
  country: "country",
  gst_number: "tax_id",
  custom_sourcing_type: "custom_sourcing_type",
  custom_supplier_category: "custom_supplier_category",
};

async function getSupplierDoc(
  cfg: ErpAdminConfig,
  supplierName: string,
): Promise<Record<string, unknown>> {
  const name = String(supplierName || "").trim();
  if (!name) throw new OnboardingError("Supplier name is required.", 400);
  try {
    return (await erpFetch(
      cfg,
      `resource/Supplier/${encodeURIComponent(name)}`,
    )) as Record<string, unknown>;
  } catch {
    throw new OnboardingError("Supplier not found.", 404);
  }
}

async function listSupplierFiles(cfg: ErpAdminConfig, supplierName: string) {
  const list = await erpFetch(
    cfg,
    `resource/File?` +
      new URLSearchParams({
        filters: JSON.stringify([
          ["attached_to_doctype", "=", "Supplier"],
          ["attached_to_name", "=", supplierName],
        ]),
        fields: JSON.stringify([
          "name",
          "file_name",
          "file_url",
          "file_size",
          "creation",
        ]),
        limit_page_length: "100",
        order_by: "creation desc",
      }).toString(),
  );
  return asArray<Record<string, unknown>>(list).map((f) => ({
    document_type: "Attachment",
    file_url: String(f.file_url || ""),
    file_name: String(f.file_name || ""),
    uploaded_on: String(f.creation || ""),
  }));
}

const LEGACY_DISC_PREFIX = "__LEGACY_PIN_DISC__:";

type LegacyDiscPayload = {
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

function parseLegacyComment(content: string): LegacyDiscPayload | null {
  const raw = String(content || "");
  if (!raw.startsWith(LEGACY_DISC_PREFIX)) return null;
  try {
    return JSON.parse(raw.slice(LEGACY_DISC_PREFIX.length)) as LegacyDiscPayload;
  } catch {
    return null;
  }
}

async function listLegacyDiscussion(
  cfg: ErpAdminConfig,
  supplierName: string,
): Promise<DiscussionMessage[]> {
  const list = await erpFetch(
    cfg,
    `resource/Comment?` +
      new URLSearchParams({
        filters: JSON.stringify([
          ["reference_doctype", "=", "Supplier"],
          ["reference_name", "=", supplierName],
          ["comment_type", "=", "Comment"],
        ]),
        fields: JSON.stringify(["name", "content", "creation", "comment_email", "owner"]),
        limit_page_length: "200",
        order_by: "creation asc",
      }).toString(),
  ).catch(() => []);

  const messages: DiscussionMessage[] = [];
  for (const row of asArray<Record<string, unknown>>(list)) {
    const parsed = parseLegacyComment(String(row.content || ""));
    if (parsed?.message_id) {
      messages.push({
        message_id: parsed.message_id,
        sender_role: parsed.sender_role,
        sender_name: parsed.sender_name,
        message: parsed.message,
        sent_on: parsed.sent_on || String(row.creation || nowIso()),
        section_tag: parsed.section_tag || "",
        file_url: parsed.file_url,
        file_name: parsed.file_name,
        resolved: parsed.resolved ? 1 : 0,
        resolved_by: parsed.resolved_by,
        resolved_on: parsed.resolved_on,
        read_by_supplier: parsed.read_by_supplier ? 1 : 0,
        read_by_procurement: parsed.read_by_procurement ? 1 : 0,
      });
    }
  }
  return messages.sort((a, b) => String(a.sent_on).localeCompare(String(b.sent_on)));
}

function countUnread(messages: DiscussionMessage[], viewer: DiscussionViewer): number {
  return messages.filter((m) => {
    if (m.sender_role === (viewer === "supplier" ? "Supplier" : "Procurement")) return false;
    if (viewer === "supplier") return !m.read_by_supplier;
    return !m.read_by_procurement;
  }).length;
}

export async function legacyPinGetProfile(input: { supplier_name: string }) {
  assertLegacyEnabled();
  const cfg = readErpAdminConfig();
  const supplierName = String(input.supplier_name || "").trim();
  const supplier = await getSupplierDoc(cfg, supplierName);
  const values = supplierToProfileValues(supplier);
  const documents = await listSupplierFiles(cfg, supplierName).catch(() => []);
  const steps: OnboardingStepDef[] = getOnboardingSteps(
    values.supplier_type || "Direct",
    values.supplier_category || "",
  );
  const messages = await listLegacyDiscussion(cfg, supplierName).catch(() => []);

  return {
    success: true as const,
    legacy_pin: true,
    company_name: values.company_name,
    linked_supplier: String(supplier.name || supplierName),
    portal_user: values.email || "",
    first_login: false,
    unlocked: true,
    locked: false,
    editable_steps: null,
    display_status: "Approved",
    steps,
    form_data_fields: {
      custom_sourcing_type: values.custom_sourcing_type,
      custom_supplier_category: values.custom_supplier_category,
    },
    // Lock once ERP custom fields are set — suppliers never re-edit
    classification_locks: {
      custom_sourcing_type: !!values.custom_sourcing_type,
      custom_supplier_category: !!values.custom_supplier_category,
    },
    record: {
      name: `LEGACY-${supplierName}`,
      company_name: values.company_name,
      contact_person: values.contact_person,
      email: values.email,
      mobile_no: values.mobile_no,
      supplier_type: values.supplier_type,
      supplier_category: values.supplier_category,
      custom_sourcing_type: values.custom_sourcing_type,
      custom_supplier_category: values.custom_supplier_category,
      website: values.website,
      country: values.country,
      gst_number: values.gst_number,
      pan: values.pan,
      phone: values.phone,
      address_line: values.address_line,
      status: "Approved",
      linked_supplier: supplierName,
      documents,
    },
    discussion: {
      messages,
      unread_count: countUnread(messages, "supplier"),
      unread_for_procurement: countUnread(messages, "procurement"),
      unread_for_supplier: countUnread(messages, "supplier"),
      notify: countUnread(messages, "supplier") > 0,
      section_tags: [...DISCUSSION_SECTION_TAGS],
    },
  };
}

export async function legacyPinSaveProfile(input: {
  supplier_name: string;
  values?: Record<string, unknown>;
}) {
  assertLegacyEnabled();
  const cfg = readErpAdminConfig();
  const supplierName = String(input.supplier_name || "").trim();
  const current = await getSupplierDoc(cfg, supplierName);

  const values = input.values || {};
  const patch: Record<string, unknown> = {};
  for (const [formKey, supplierKey] of Object.entries(SUPPLIER_WRITABLE)) {
    if (formKey === "custom_sourcing_type" || formKey === "custom_supplier_category") {
      continue; // handled below (write-once)
    }
    if (values[formKey] === undefined) continue;
    const next = String(values[formKey] ?? "").trim();
    if (next) patch[supplierKey] = next;
  }

  const existingSourcing = String(current.custom_sourcing_type || "").trim();
  const existingCategory = String(current.custom_supplier_category || "").trim();

  // Write-once: suppliers may fill empty legacy fields; never overwrite
  if (!existingSourcing && values.custom_sourcing_type !== undefined) {
    const v = String(values.custom_sourcing_type ?? "").trim();
    if (!v) throw new OnboardingError("Supplier Type is required.");
    if (v !== "Direct" && v !== "Indirect") {
      throw new OnboardingError("Supplier Type must be Direct or Indirect.");
    }
    patch.custom_sourcing_type = v;
  } else if (existingSourcing && values.custom_sourcing_type !== undefined) {
    const attempted = String(values.custom_sourcing_type ?? "").trim();
    if (attempted && attempted !== existingSourcing) {
      throw new OnboardingError("Supplier Type is locked and cannot be changed.");
    }
  }

  if (!existingCategory && values.custom_supplier_category !== undefined) {
    const v = String(values.custom_supplier_category ?? "").trim();
    if (!v) throw new OnboardingError("Supplier Category is required.");
    patch.custom_supplier_category = v;
  } else if (existingCategory && values.custom_supplier_category !== undefined) {
    const attempted = String(values.custom_supplier_category ?? "").trim();
    if (attempted && attempted !== existingCategory) {
      throw new OnboardingError("Supplier Category is locked and cannot be changed.");
    }
  }

  if (Object.keys(patch).length > 0) {
    await erpFetch(cfg, `resource/Supplier/${encodeURIComponent(supplierName)}`, {
      method: "PUT",
      body: patch,
    });
  }

  return legacyPinGetProfile({ supplier_name: supplierName });
}

export async function legacyPinResolveUpload(input: { supplier_name: string }) {
  assertLegacyEnabled();
  const cfg = readErpAdminConfig();
  const supplierName = String(input.supplier_name || "").trim();
  await getSupplierDoc(cfg, supplierName);
  return {
    success: true as const,
    doctype: "Supplier",
    docname: supplierName,
  };
}

export async function legacyPinListDiscussion(input: {
  supplier_name: string;
  viewer?: DiscussionViewer;
}) {
  assertLegacyEnabled();
  const cfg = readErpAdminConfig();
  const supplierName = String(input.supplier_name || "").trim();
  await getSupplierDoc(cfg, supplierName);
  const viewer = input.viewer === "procurement" ? "procurement" : "supplier";
  const messages = await listLegacyDiscussion(cfg, supplierName);
  return {
    success: true as const,
    messages,
    unread_count: countUnread(messages, viewer),
    unread_for_procurement: countUnread(messages, "procurement"),
    unread_for_supplier: countUnread(messages, "supplier"),
    notify: countUnread(messages, viewer) > 0,
    section_tags: [...DISCUSSION_SECTION_TAGS],
  };
}

export async function legacyPinSendDiscussion(input: {
  supplier_name: string;
  viewer?: DiscussionViewer;
  text: string;
  actor?: string;
  section_tag?: string;
  file_url?: string;
  file_name?: string;
}) {
  assertLegacyEnabled();
  const cfg = readErpAdminConfig();
  const supplierName = String(input.supplier_name || "").trim();
  await getSupplierDoc(cfg, supplierName);
  const viewer = input.viewer === "procurement" ? "procurement" : "supplier";
  const text = String(input.text || "").trim();
  const fileUrl = String(input.file_url || "").trim();
  if (!text && !fileUrl) throw new OnboardingError("Message text or attachment is required.");

  const payload: LegacyDiscPayload = {
    message_id: randomBytes(8).toString("hex"),
    sender_role: viewer === "procurement" ? "Procurement" : "Supplier",
    sender_name:
      String(input.actor || (viewer === "procurement" ? "Procurement" : supplierName)).trim() ||
      "Supplier",
    message: text || (fileUrl ? "Attachment" : ""),
    sent_on: nowIso(),
    section_tag: viewer === "procurement" ? String(input.section_tag || "") : "",
    file_url: fileUrl || undefined,
    file_name: String(input.file_name || "").trim() || undefined,
    resolved: 0,
    read_by_procurement: viewer === "procurement" ? 1 : 0,
    read_by_supplier: viewer === "supplier" ? 1 : 0,
  };

  await erpFetch(cfg, "resource/Comment", {
    method: "POST",
    body: {
      comment_type: "Comment",
      reference_doctype: "Supplier",
      reference_name: supplierName,
      content: `${LEGACY_DISC_PREFIX}${JSON.stringify(payload)}`,
    },
  });

  return legacyPinListDiscussion({ supplier_name: supplierName, viewer });
}

export async function legacyPinMarkDiscussionRead(input: {
  supplier_name: string;
  viewer?: DiscussionViewer;
}) {
  assertLegacyEnabled();
  // TEMPORARY LEGACY MODE — Comment rows are immutable for bulk read flags;
  // unread is computed as "from other party". Marking read is a no-op refresh.
  return legacyPinListDiscussion(input);
}
