/**
 * RFI (Request for Information) service — ERPNext-backed.
 *
 * Parent DocType: "RFI"
 * Invitation child table: "RFI Supplier"
 *
 * Supplier portal lists MUST resolve invitations via the RFI Supplier child
 * table only — never a supplier field on the RFI parent document.
 */

import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  COMPANY,
  isDocNotFoundError,
  withSilent,
  type Filter,
} from "./erpnext";
import { createNotification } from "./notifications";
import { getSupplier, resolveSupplierERPNextId } from "./supplier";
import {
  confirmUploadedErpFile,
  uploadFileToERPNextDetailed,
} from "./legalDocsStorage";
import { generateId } from "../utils/id";
import { nowERPNextDatetime } from "../utils/erpNextDate";
import {
  readAllResponses,
  upsertResponse,
} from "./rfiStorage";
import type {
  RFI,
  RfiCompanySnapshot,
  RfiCreateInput,
  RfiQuestion,
  RfiRequiredDocument,
  RfiResponse,
  RfiStatus,
  RfiSubmitResponseInput,
  RfiSupplierInvite,
  RfiUpdateInput,
  RfiUploadedFile,
  SupplierRfiFacingStatus,
} from "../types/rfi";

const LOG = "[SupplierPortal:RFI]";
const RFI_DOCTYPE = "RFI";
const RFI_SUPPLIER_DOCTYPE = "RFI Supplier";
const RFI_RESPONSE_DOCTYPE = "RFI Response";
const RFI_NAMING_SERIES = "RFI-.YYYY.-.#####";

const nowIso = () => new Date().toISOString();

/* ── ERP RFI Response sync (cross-browser procurement visibility) ────────── */

interface ErpRfiResponseDoc {
  name: string;
  rfi?: string;
  supplier?: string;
  supplier_name?: string;
  status?: string;
  submitted_at?: string;
  submitted_by?: string;
  documents_count?: number;
  completion_pct?: number;
  response_locked?: number | boolean;
  review_status?: string;
  additional_comments?: string;
  answers_json?: string;
  documents_json?: string;
  company_snapshot_json?: string;
  internal_notes?: string;
  creation?: string;
  modified?: string;
}

function mapErpResponseDoc(doc: ErpRfiResponseDoc): RfiResponse {
  const answers = parseJsonArray<RfiResponse["answers"][number]>(
    doc.answers_json,
  );
  const documents = parseJsonArray<RfiResponse["documents"][number]>(
    doc.documents_json,
  );
  let company_snapshot: RfiCompanySnapshot | undefined;
  try {
    if (doc.company_snapshot_json?.trim()) {
      company_snapshot = JSON.parse(doc.company_snapshot_json) as RfiCompanySnapshot;
    }
  } catch {
    company_snapshot = undefined;
  }
  const status =
    String(doc.status || "").toLowerCase() === "submitted"
      ? "Submitted"
      : "Pending";
  return {
    id: doc.name,
    rfi: String(doc.rfi || ""),
    supplier: String(doc.supplier || ""),
    supplier_name: doc.supplier_name || String(doc.supplier || ""),
    status,
    answers,
    documents,
    additional_comments: doc.additional_comments || "",
    company_snapshot,
    submitted_at: doc.submitted_at || undefined,
    submitted_by: doc.submitted_by || undefined,
    completion_pct:
      typeof doc.completion_pct === "number" ? doc.completion_pct : undefined,
    response_locked: Boolean(doc.response_locked) || status === "Submitted",
    review_status: (doc.review_status as RfiResponse["review_status"]) || undefined,
    internal_notes: doc.internal_notes || undefined,
    created_at: doc.creation || nowIso(),
    modified: doc.modified || nowIso(),
  };
}

function countUploadedDocuments(documents: RfiResponse["documents"] | undefined): number {
  return (documents ?? []).filter((d) => Boolean(d.file?.file_url)).length;
}

function responseToErpPayload(response: RfiResponse): Record<string, unknown> {
  const documents = response.documents ?? [];
  const locked = Boolean(response.response_locked) || response.status === "Submitted";
  return {
    rfi: response.rfi,
    supplier: response.supplier,
    supplier_name: response.supplier_name,
    status: response.status,
    submitted_by: response.submitted_by || "",
    documents_count: countUploadedDocuments(documents),
    completion_pct:
      typeof response.completion_pct === "number"
        ? response.completion_pct
        : response.status === "Submitted"
          ? 100
          : 0,
    response_locked: locked ? 1 : 0,
    review_status: response.review_status || "",
    additional_comments: response.additional_comments || "",
    answers_json: JSON.stringify(response.answers ?? []),
    documents_json: JSON.stringify(documents),
    company_snapshot_json: response.company_snapshot
      ? JSON.stringify(response.company_snapshot)
      : "",
    internal_notes: response.internal_notes || "",
  };
}

function isRfiResponseDoctypeMissing(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    isDocNotFoundError(err) ||
    /RFI Response|DoesNotExistError|404|not found|Unknown DocType/i.test(message)
  );
}

function toErpDatetime(isoOrErp: string | undefined): string | null {
  if (!isoOrErp) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(isoOrErp)) return isoOrErp;
  const d = new Date(isoOrErp);
  if (Number.isNaN(d.getTime())) return nowERPNextDatetime();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function findErpRfiResponse(
  rfiName: string,
  supplierId: string,
): Promise<ErpRfiResponseDoc | null> {
  try {
    const rows = await apiGet<ErpRfiResponseDoc[]>(
      buildResourceUrl(RFI_RESPONSE_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: ["name", "rfi", "supplier", "status", "modified"],
          filters: [
            ["rfi", "=", rfiName],
            ["supplier", "=", supplierId],
          ],
          limit_page_length: 5,
          order_by: "modified desc",
        }),
      ),
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.name) return null;
    return await apiGet<ErpRfiResponseDoc>(
      buildResourceUrl(RFI_RESPONSE_DOCTYPE, row.name),
      withSilent(),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "findErpRfiResponse failed", err);
    return null;
  }
}

async function listErpRfiResponses(rfiName: string): Promise<RfiResponse[]> {
  const rows = await apiGet<ErpRfiResponseDoc[]>(
    buildResourceUrl(RFI_RESPONSE_DOCTYPE),
    withSilent(
      buildListConfig({
        fields: [
          "name",
          "rfi",
          "supplier",
          "supplier_name",
          "status",
          "submitted_at",
          "submitted_by",
          "documents_count",
          "completion_pct",
          "response_locked",
          "review_status",
          "additional_comments",
          "answers_json",
          "documents_json",
          "company_snapshot_json",
          "internal_notes",
          "creation",
          "modified",
        ],
        filters: [["rfi", "=", rfiName]],
        limit_page_length: 500,
        order_by: "modified desc",
      }),
    ),
  );
  return (Array.isArray(rows) ? rows : []).map(mapErpResponseDoc);
}

/**
 * Upsert the live RFI Response DocType. Returns the ERP-backed response
 * (id = ERP document name).
 */
async function upsertErpRfiResponse(response: RfiResponse): Promise<RfiResponse> {
  const payload: Record<string, unknown> = {
    ...responseToErpPayload(response),
    submitted_at: toErpDatetime(response.submitted_at),
  };

  const existing = await findErpRfiResponse(response.rfi, response.supplier);
  if (existing?.name) {
    // eslint-disable-next-line no-console
    console.log(LOG, "Updating RFI Response", {
      name: existing.name,
      rfi: response.rfi,
      supplier: response.supplier,
      status: response.status,
      documents_count: payload.documents_count,
    });
    const updated = await apiPut<ErpRfiResponseDoc>(
      buildResourceUrl(RFI_RESPONSE_DOCTYPE, existing.name),
      payload,
      withSilent(),
    );
    return mapErpResponseDoc({ ...existing, ...updated, name: existing.name });
  }

  // eslint-disable-next-line no-console
  console.log(LOG, "Creating RFI Response", {
    rfi: response.rfi,
    supplier: response.supplier,
    status: response.status,
    documents_count: payload.documents_count,
  });
  const created = await apiPost<ErpRfiResponseDoc>(
    buildResourceUrl(RFI_RESPONSE_DOCTYPE),
    {
      naming_series: "RFIR-.YYYY.-.#####",
      ...payload,
    },
    withSilent(),
  );
  if (!created?.name) {
    throw new Error("RFI Response was not created in ERPNext.");
  }
  return mapErpResponseDoc(created);
}

/**
 * Update only the matching RFI Supplier child row tracking fields.
 */
async function updateRfiSupplierResponseRow(
  rfiName: string,
  supplierId: string,
  tracking: {
    response_status: "Pending" | "Submitted";
    submitted_on?: string | null;
    documents_count: number;
    response_ref: string;
  },
): Promise<void> {
  const doc = await apiGet<ErpRfiDoc & {
    suppliers?: Array<{
      name?: string;
      supplier?: string;
      supplier_name?: string;
      response_status?: string;
      submitted_on?: string;
      documents_count?: number;
      response_ref?: string;
    }>;
  }>(buildResourceUrl(RFI_DOCTYPE, rfiName), withSilent());

  const suppliers = Array.isArray(doc.suppliers) ? [...doc.suppliers] : [];
  const idx = suppliers.findIndex(
    (s) =>
      String(s.supplier || "").toLowerCase() === supplierId.toLowerCase(),
  );
  if (idx < 0) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "RFI Supplier row not found for tracking update", {
      rfi: rfiName,
      supplier: supplierId,
    });
    return;
  }

  suppliers[idx] = {
    ...suppliers[idx],
    response_status: tracking.response_status,
    submitted_on: tracking.submitted_on || undefined,
    documents_count: tracking.documents_count,
    response_ref: tracking.response_ref,
  };

  // eslint-disable-next-line no-console
  console.log(LOG, "Updating RFI Supplier tracking row", {
    rfi: rfiName,
    supplier: supplierId,
    child_name: suppliers[idx].name,
    ...tracking,
  });

  await apiPut(
    buildResourceUrl(RFI_DOCTYPE, rfiName),
    { suppliers },
    withSilent(),
  );
}

/* ── ERP ↔ app mapping ─────────────────────────────────────────────────── */

interface ErpRfiDoc {
  name: string;
  title?: string;
  category?: string;
  department?: string;
  description?: string;
  submission_deadline?: string;
  status?: RfiStatus;
  questions_json?: string;
  required_documents_json?: string;
  suppliers?: Array<{
    name?: string;
    supplier?: string;
    supplier_name?: string;
  }>;
  owner?: string;
  company?: string;
  internal_notes?: string;
  published_at?: string;
  closed_at?: string;
  creation?: string;
  modified?: string;
}

function parseJsonArray<T>(raw: string | undefined | null): T[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stripHtml(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function mapErpToRfi(doc: ErpRfiDoc): RFI {
  const questions = parseJsonArray<RfiQuestion>(doc.questions_json);
  const required_documents = parseJsonArray<RfiRequiredDocument>(
    doc.required_documents_json,
  );
  const suppliers: RfiSupplierInvite[] = (doc.suppliers ?? [])
    .filter((s) => s.supplier)
    .map((s) => ({
      supplier: String(s.supplier),
      supplier_name: s.supplier_name || String(s.supplier),
    }));

  return {
    name: doc.name,
    title: doc.title ?? "",
    category: doc.category ?? "",
    department: doc.department ?? "",
    description: stripHtml(doc.description) || doc.description || "",
    submission_deadline: doc.submission_deadline ?? "",
    status: (doc.status as RfiStatus) || "Draft",
    questions,
    required_documents,
    suppliers,
    owner: doc.owner,
    company: doc.company,
    internal_notes: doc.internal_notes,
    published_at: doc.published_at,
    closed_at: doc.closed_at,
    created_at: doc.creation ?? nowIso(),
    modified: doc.modified ?? nowIso(),
  };
}

function assertDraft(rfi: RFI): void {
  if (rfi.status !== "Draft") {
    throw new Error("Only draft RFIs can be edited.");
  }
}

function validateCreateInput(data: RfiCreateInput): void {
  if (!data.title?.trim()) throw new Error("Title is required.");
  if (!data.category?.trim()) throw new Error("Category is required.");
  if (!data.department?.trim()) throw new Error("Department is required.");
  if (!data.submission_deadline?.trim()) {
    throw new Error("Submission deadline is required.");
  }
  if (!data.suppliers?.length) {
    throw new Error("Select at least one supplier.");
  }
  for (const q of data.questions ?? []) {
    if (!q.title?.trim()) throw new Error("Every question needs a title.");
    if (
      (q.type === "dropdown" || q.type === "checkbox") &&
      (!q.options || q.options.filter((o) => o.trim()).length < 2)
    ) {
      throw new Error(
        `Question "${q.title}" needs at least two options for ${q.type}.`,
      );
    }
  }
}

function buildQuestions(input: RfiCreateInput["questions"]): RfiQuestion[] {
  return (input ?? []).map((q, i) => ({
    id: generateId(),
    title: q.title.trim(),
    type: q.type,
    required: !!q.required,
    options: (q.options ?? []).map((o) => o.trim()).filter(Boolean),
    sort_order: i,
    placeholder: q.placeholder?.trim() || undefined,
    help_text: q.help_text?.trim() || undefined,
  }));
}

function buildDocuments(
  input: RfiCreateInput["required_documents"],
): RfiRequiredDocument[] {
  return (input ?? []).map((d) => ({
    id: generateId(),
    doc_type: d.doc_type,
    label: d.label,
    required: d.required !== false,
    max_file_size_mb: d.max_file_size_mb,
    allowed_file_types: d.allowed_file_types,
  }));
}

/* ── Supplier identity ─────────────────────────────────────────────────── */

/**
 * Resolve the ERPNext Supplier.name for the current portal user.
 * Prefer the linked Supplier master id; never use a display-only label.
 */
export async function resolvePortalSupplierId(
  candidate: string,
): Promise<string> {
  const raw = String(candidate || "").trim();
  if (!raw) return "";
  const resolved = await resolveSupplierERPNextId(raw);
  return resolved || raw;
}

/* ── Procurement CRUD ──────────────────────────────────────────────────── */

export async function listRfis(filters?: {
  status?: RfiStatus | RfiStatus[];
  search?: string;
}): Promise<RFI[]> {
  const erpFilters: Filter[] = [];
  if (filters?.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    if (statuses.length === 1) {
      erpFilters.push(["status", "=", statuses[0]]);
    } else if (statuses.length > 1) {
      erpFilters.push(["status", "in", statuses]);
    }
  }

  const raw = await apiGet<ErpRfiDoc[]>(
    buildResourceUrl(RFI_DOCTYPE),
    buildListConfig({
      fields: [
        "name",
        "title",
        "category",
        "department",
        "description",
        "submission_deadline",
        "status",
        "owner",
        "company",
        "published_at",
        "closed_at",
        "creation",
        "modified",
      ],
      filters: erpFilters.length ? erpFilters : undefined,
      order_by: "modified desc",
      limit_page_length: 500,
    }),
  );

  let rows = (Array.isArray(raw) ? raw : []).map(mapErpToRfi);

  if (filters?.search?.trim()) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q),
    );
  }

  return rows;
}

export async function listRfisPaged(options: {
  page: number;
  pageSize: number;
  status?: RfiStatus | RfiStatus[];
  search?: string;
}): Promise<{ data: RFI[]; total: number }> {
  const all = await listRfis({
    status: options.status,
    search: options.search,
  });
  const start = (options.page - 1) * options.pageSize;
  const pageRows = all.slice(start, start + options.pageSize);
  // Hydrate current page only so supplier child counts are accurate.
  const data = await Promise.all(
    pageRows.map(async (r) => {
      try {
        return await getRfi(r.name);
      } catch {
        return r;
      }
    }),
  );
  return { data, total: all.length };
}

export async function getRfi(name: string): Promise<RFI> {
  const doc = await apiGet<ErpRfiDoc>(
    buildResourceUrl(RFI_DOCTYPE, name),
    withSilent(),
  );
  return mapErpToRfi(doc);
}

export async function createRfi(input: RfiCreateInput): Promise<RFI> {
  validateCreateInput(input);
  const questions = buildQuestions(input.questions);
  const required_documents = buildDocuments(input.required_documents);

  const payload = {
    naming_series: RFI_NAMING_SERIES,
    title: input.title.trim(),
    category: input.category.trim(),
    department: input.department.trim(),
    description: (input.description ?? "").trim(),
    submission_deadline: input.submission_deadline,
    status: "Draft" as const,
    company: input.company || COMPANY || undefined,
    questions_json: JSON.stringify(questions),
    required_documents_json: JSON.stringify(required_documents),
    suppliers: input.suppliers.map((s) => ({
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
    })),
    internal_notes: "",
  };

  const created = await apiPost<ErpRfiDoc>(
    buildResourceUrl(RFI_DOCTYPE),
    payload,
  );
  return mapErpToRfi(created);
}

export async function updateRfi(
  name: string,
  patch: RfiUpdateInput,
): Promise<RFI> {
  const existing = await getRfi(name);
  assertDraft(existing);

  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.category !== undefined) payload.category = patch.category.trim();
  if (patch.department !== undefined) {
    payload.department = patch.department.trim();
  }
  if (patch.description !== undefined) {
    payload.description = patch.description.trim();
  }
  if (patch.submission_deadline !== undefined) {
    payload.submission_deadline = patch.submission_deadline;
  }
  if (patch.questions !== undefined) {
    payload.questions_json = JSON.stringify(patch.questions);
  }
  if (patch.required_documents !== undefined) {
    payload.required_documents_json = JSON.stringify(patch.required_documents);
  }
  if (patch.suppliers !== undefined) {
    payload.suppliers = patch.suppliers.map((s) => ({
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
    }));
  }
  if (patch.internal_notes !== undefined) {
    payload.internal_notes = patch.internal_notes;
  }

  const updated = await apiPut<ErpRfiDoc>(
    buildResourceUrl(RFI_DOCTYPE, name),
    payload,
  );
  return mapErpToRfi(updated);
}

export async function deleteRfi(name: string): Promise<void> {
  const existing = await getRfi(name);
  assertDraft(existing);
  await apiDelete(buildResourceUrl(RFI_DOCTYPE, name));
}

export async function publishRfi(name: string): Promise<RFI> {
  const existing = await getRfi(name);
  if (existing.status !== "Draft") {
    throw new Error("Only draft RFIs can be published.");
  }
  if (!existing.suppliers.length) {
    throw new Error("Select at least one supplier before publishing.");
  }
  if (!existing.questions.length && !existing.required_documents.length) {
    throw new Error(
      "Add at least one questionnaire item or required document before publishing.",
    );
  }

  const ts = nowERPNextDatetime();
  const published = await apiPut<ErpRfiDoc>(
    buildResourceUrl(RFI_DOCTYPE, name),
    {
      status: "Published",
      published_at: ts,
    },
  );
  const mapped = mapErpToRfi(published);

  for (const invite of mapped.suppliers) {
    const now = nowIso();
    const pending: RfiResponse = {
      id: generateId(),
      rfi: mapped.name,
      supplier: invite.supplier,
      supplier_name: invite.supplier_name,
      status: "Pending",
      answers: [],
      documents: [],
      created_at: now,
      modified: now,
    };
    // Local cache (same-browser UX) + live ERP Response row for procurement.
    upsertResponse(pending);
    try {
      const erp = await upsertErpRfiResponse(pending);
      await updateRfiSupplierResponseRow(mapped.name, invite.supplier, {
        response_status: "Pending",
        submitted_on: null,
        documents_count: 0,
        response_ref: erp.id,
      });
      upsertResponse({ ...pending, id: erp.id });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "Failed to seed ERP RFI Response on publish", err);
    }

    createNotification({
      title: "New RFI Invitation",
      description: `You have been invited to respond to ${mapped.name}: ${mapped.title}. Deadline: ${mapped.submission_deadline}.`,
      module: "RFI Invitation",
      event_type: "rfi_published",
      target_role: "supplier",
      supplier_id: invite.supplier,
      document_type: "RFI",
      document_name: mapped.name,
      route_path: `/supplier/rfis/${encodeURIComponent(mapped.name)}`,
    });
  }

  createNotification({
    title: "RFI Published",
    description: `${mapped.name} was published to ${mapped.suppliers.length} supplier(s).`,
    module: "RFI",
    event_type: "rfi_published",
    target_role: "procurement",
    document_type: "RFI",
    document_name: mapped.name,
    route_path: `/sourcing/rfi/${encodeURIComponent(mapped.name)}`,
  });

  return mapped;
}

export async function markRfiUnderReview(name: string): Promise<RFI> {
  const existing = await getRfi(name);
  if (existing.status === "Closed") return existing;
  if (existing.status === "Draft") {
    throw new Error("Publish the RFI before reviewing responses.");
  }
  if (existing.status === "Under Review") return existing;
  const updated = await apiPut<ErpRfiDoc>(
    buildResourceUrl(RFI_DOCTYPE, name),
    { status: "Under Review" },
  );
  return mapErpToRfi(updated);
}

export async function closeRfi(name: string): Promise<RFI> {
  const existing = await getRfi(name);
  if (existing.status === "Draft") {
    throw new Error("Cannot close a draft RFI. Publish or delete it instead.");
  }
  if (existing.status === "Closed") return existing;

  const closed = await apiPut<ErpRfiDoc>(buildResourceUrl(RFI_DOCTYPE, name), {
    status: "Closed",
    closed_at: nowERPNextDatetime(),
  });
  const mapped = mapErpToRfi(closed);

  createNotification({
    title: "RFI Closed",
    description: `${mapped.name} has been closed.`,
    module: "RFI",
    event_type: "rfi_closed",
    target_role: "procurement",
    document_type: "RFI",
    document_name: mapped.name,
    route_path: `/sourcing/rfi/${encodeURIComponent(mapped.name)}`,
  });

  for (const invite of mapped.suppliers) {
    createNotification({
      title: "RFI Closed",
      description: `${mapped.name} (${mapped.title}) has been closed by procurement.`,
      module: "RFI Invitation",
      event_type: "rfi_closed",
      target_role: "supplier",
      supplier_id: invite.supplier,
      document_type: "RFI",
      document_name: mapped.name,
      route_path: `/supplier/rfis/${encodeURIComponent(mapped.name)}`,
    });
  }

  return mapped;
}

export async function updateRfiInternalNotes(
  name: string,
  notes: string,
): Promise<RFI> {
  const updated = await apiPut<ErpRfiDoc>(
    buildResourceUrl(RFI_DOCTYPE, name),
    { internal_notes: notes },
  );
  return mapErpToRfi(updated);
}

/* ── Supplier portal: child-table invitation queries ───────────────────── */

export interface SupplierRfiListRow {
  name: string;
  title: string;
  description: string;
  submission_deadline: string;
  status: RfiStatus;
  category?: string;
  department?: string;
  /** Buyer / RFI owner (ERP user). */
  owner?: string;
  modified?: string;
  /** Joined supplier response fields (local + meta). */
  response_status?: RfiResponse["status"] | null;
  submitted_at?: string | null;
  submitted_by?: string | null;
  completion_pct?: number | null;
  response_locked?: boolean;
  review_status?: RfiResponse["review_status"] | null;
  /** True when a local draft exists (not yet submitted). */
  has_local_draft?: boolean;
}

const SUPPLIER_VISIBLE_RFI_STATUSES: RfiStatus[] = [
  "Published",
  "Under Review",
  "Closed",
];

const LIST_FIELDS = [
  "name",
  "title",
  "description",
  "submission_deadline",
  "status",
  "category",
  "department",
  "owner",
  "modified",
] as const;

function normalizeListRow(r: SupplierRfiListRow): SupplierRfiListRow {
  return {
    ...r,
    description: stripHtml(r.description) || r.description || "",
    status: (r.status as RfiStatus) || "Published",
    owner: r.owner || undefined,
  };
}

function mergeRfiListRows(
  ...groups: SupplierRfiListRow[][]
): SupplierRfiListRow[] {
  const map = new Map<string, SupplierRfiListRow>();
  for (const group of groups) {
    for (const row of group) {
      if (!row?.name) continue;
      const prev = map.get(row.name);
      map.set(row.name, prev ? { ...prev, ...row } : normalizeListRow(row));
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    String(b.modified || "").localeCompare(String(a.modified || "")),
  );
}

async function listErpRfiResponsesForSupplier(
  erpSupplierId: string,
): Promise<RfiResponse[]> {
  try {
    const rows = await apiGet<ErpRfiResponseDoc[]>(
      buildResourceUrl(RFI_RESPONSE_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: [
            "name",
            "rfi",
            "supplier",
            "supplier_name",
            "status",
            "submitted_at",
            "submitted_by",
            "documents_count",
            "completion_pct",
            "response_locked",
            "review_status",
            "creation",
            "modified",
          ],
          filters: [["supplier", "=", erpSupplierId]],
          limit_page_length: 500,
          order_by: "modified desc",
        }),
      ),
    );
    return (Array.isArray(rows) ? rows : []).map(mapErpResponseDoc);
  } catch (err) {
    if (!isRfiResponseDoctypeMissing(err)) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "listErpRfiResponsesForSupplier failed", err);
    }
    return [];
  }
}

async function enrichWithSupplierResponses(
  rows: SupplierRfiListRow[],
  erpSupplierId: string,
): Promise<SupplierRfiListRow[]> {
  const localResponses = readAllResponses().filter(
    (r) => r.supplier.toLowerCase() === erpSupplierId.toLowerCase(),
  );
  let erpResponses = await listErpRfiResponsesForSupplier(erpSupplierId);

  // Backfill any local-only Submitted responses so Procurement can see them.
  for (const local of localResponses) {
    if (local.status !== "Submitted") continue;
    const erp = erpResponses.find((r) => r.rfi === local.rfi);
    if (erp?.status === "Submitted") continue;
    try {
      const synced = await upsertErpRfiResponse(local);
      await updateRfiSupplierResponseRow(local.rfi, erpSupplierId, {
        response_status: "Submitted",
        submitted_on: toErpDatetime(local.submitted_at),
        documents_count: countUploadedDocuments(local.documents),
        response_ref: synced.id,
      });
      upsertResponse(synced);
      erpResponses = [
        synced,
        ...erpResponses.filter((r) => r.rfi !== local.rfi),
      ];
      // eslint-disable-next-line no-console
      console.log(LOG, "Backfilled Submitted response from My RFIs", {
        rfi: local.rfi,
        response: synced.id,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "My RFIs backfill failed", local.rfi, err);
    }
  }

  return rows.map((row) => {
    const erp = erpResponses.find((r) => r.rfi === row.name) ?? null;
    const local = localResponses.find((r) => r.rfi === row.name) ?? null;
    // Prefer live ERP; fall back to local cache / meta for same-browser drafts.
    const response =
      erp?.status === "Submitted"
        ? erp
        : local?.status === "Submitted"
          ? local
          : erp ?? local;
    let meta: {
      status?: "Draft" | "Submitted";
      submitted_at?: string;
      submitted_by?: string;
      completion_pct?: number;
    } = {};
    try {
      const raw = localStorage.getItem(
        `bidsphere:rfi-response-meta:${row.name}:${erpSupplierId}`,
      );
      if (raw) meta = JSON.parse(raw) as typeof meta;
    } catch {
      meta = {};
    }

    const submitted =
      response?.status === "Submitted" || meta.status === "Submitted";
    const hasDraft = !submitted && meta.status === "Draft";
    const completion =
      typeof response?.completion_pct === "number"
        ? response.completion_pct
        : typeof meta.completion_pct === "number"
          ? meta.completion_pct
          : submitted
            ? 100
            : hasDraft
              ? 25
              : null;

    return {
      ...row,
      response_status:
        response?.status ?? (meta.status === "Submitted" ? "Submitted" : null),
      submitted_at: response?.submitted_at ?? meta.submitted_at ?? null,
      submitted_by: response?.submitted_by ?? meta.submitted_by ?? null,
      completion_pct: completion,
      response_locked:
        Boolean(response?.response_locked) ||
        response?.status === "Submitted" ||
        meta.status === "Submitted",
      review_status: response?.review_status ?? null,
      has_local_draft: hasDraft,
    };
  });
}

/**
 * Fetch ALL RFIs invited to the supplier (Published / Under Review / Closed).
 * Submission must never remove history — only the response status changes.
 */
export async function getSupplierRFIs(
  supplierCandidate: string,
): Promise<SupplierRfiListRow[]> {
  const erpSupplierId = await resolvePortalSupplierId(supplierCandidate);

  // eslint-disable-next-line no-console
  console.log(LOG, "My RFIs query", {
    resolved_supplier: erpSupplierId,
    raw_candidate: supplierCandidate,
    doctype: RFI_DOCTYPE,
    child_table: RFI_SUPPLIER_DOCTYPE,
    status_filter: SUPPLIER_VISIBLE_RFI_STATUSES,
  });

  if (!erpSupplierId) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "My RFIs aborted — empty ERP supplier id");
    return [];
  }

  let scriptRows: SupplierRfiListRow[] = [];
  let resourceRows: SupplierRfiListRow[] = [];
  let getListRows: SupplierRfiListRow[] = [];

  // Strategy 1 — Server Script (may still be Published-only until setup is re-run)
  try {
    const msg = await apiPost<{
      supplier?: string;
      count?: number;
      data?: SupplierRfiListRow[];
    }>(
      "/api/method/bidsphere_get_supplier_rfis",
      { supplier: erpSupplierId },
      withSilent(),
    );
    scriptRows = (Array.isArray(msg?.data) ? msg.data : []).map(normalizeListRow);
    // eslint-disable-next-line no-console
    console.log(LOG, "Server script result", {
      resolved_supplier: msg?.supplier || erpSupplierId,
      assigned_rfi_count: msg?.count ?? scriptRows.length,
      statuses: Array.from(new Set(scriptRows.map((r) => r.status))),
      names: scriptRows.map((r) => r.name),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "bidsphere_get_supplier_rfis unavailable — fallback", err);
  }

  // Child-table invitation filter — include history statuses (not Draft).
  const filters: Filter[] = [
    [RFI_SUPPLIER_DOCTYPE, "supplier", "=", erpSupplierId],
    ["status", "in", SUPPLIER_VISIBLE_RFI_STATUSES],
  ];

  // Strategy 2 — Resource API (ensures Under Review / Closed remain visible)
  try {
    const raw = await apiGet<SupplierRfiListRow[]>(
      buildResourceUrl(RFI_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: [...LIST_FIELDS],
          filters,
          order_by: "modified desc",
          limit_page_length: 500,
        }),
      ),
    );
    resourceRows = (Array.isArray(raw) ? raw : []).map(normalizeListRow);
    // eslint-disable-next-line no-console
    console.log(LOG, "Resource API child-table result", {
      resolved_supplier: erpSupplierId,
      assigned_rfi_count: resourceRows.length,
      statuses: Array.from(new Set(resourceRows.map((r) => r.status))),
      names: resourceRows.map((r) => r.name),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "Resource API child-table filter failed", err);
  }

  // Strategy 3 — frappe.client.get_list POST
  if (!resourceRows.length) {
    try {
      const body = {
        doctype: RFI_DOCTYPE,
        fields: [...LIST_FIELDS],
        filters,
        order_by: "modified desc",
        limit_page_length: 500,
      };
      const raw = await apiPost<
        SupplierRfiListRow[] | { message?: SupplierRfiListRow[] }
      >("/api/method/frappe.client.get_list", body, withSilent());
      getListRows = (
        Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { message?: SupplierRfiListRow[] })?.message)
            ? ((raw as { message: SupplierRfiListRow[] }).message)
            : []
      ).map(normalizeListRow);
      // eslint-disable-next-line no-console
      console.log(LOG, "get_list POST child-table result", {
        resolved_supplier: erpSupplierId,
        assigned_rfi_count: getListRows.length,
        names: getListRows.map((r) => r.name),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(LOG, "get_list My RFIs fetch failed", err);
      if (!scriptRows.length && !resourceRows.length) {
        throw err instanceof Error
          ? err
          : new Error("Could not load assigned RFIs.");
      }
    }
  }

  const merged = mergeRfiListRows(scriptRows, resourceRows, getListRows);
  const enriched = await enrichWithSupplierResponses(merged, erpSupplierId);

  // eslint-disable-next-line no-console
  console.log(LOG, "My RFIs merged history", {
    resolved_supplier: erpSupplierId,
    total: enriched.length,
    statuses: Array.from(new Set(enriched.map((r) => r.status))),
    names: enriched.map((r) => r.name),
  });

  return enriched;
}

/**
 * @deprecated Prefer getSupplierRFIs — kept for call-site compatibility.
 * Returns Published RFIs assigned via RFI Supplier child table.
 */
export async function listSupplierRfis(supplierName: string): Promise<
  Array<{
    rfi: RFI;
    response: RfiResponse | null;
  }>
> {
  const rows = await getSupplierRFIs(supplierName);
  const erpSupplierId = await resolvePortalSupplierId(supplierName);
  const responses = readAllResponses().filter(
    (r) => r.supplier.toLowerCase() === erpSupplierId.toLowerCase(),
  );

  return rows.map((row) => {
    const rfi: RFI = {
      name: row.name,
      title: row.title,
      category: row.category ?? "",
      department: row.department ?? "",
      description: row.description ?? "",
      submission_deadline: row.submission_deadline,
      status: row.status,
      questions: [],
      required_documents: [],
      suppliers: [],
      created_at: row.modified ?? nowIso(),
      modified: row.modified ?? nowIso(),
    };
    return {
      rfi,
      response: responses.find((resp) => resp.rfi === row.name) ?? null,
    };
  });
}

/**
 * Load an RFI for the supplier portal with server-side invitation validation.
 * Suppliers cannot open RFIs they were not assigned to (URL tampering).
 */
export async function getSupplierRfiAssignment(
  rfiName: string,
  supplierCandidate: string,
): Promise<{ rfi: RFI; response: RfiResponse }> {
  const erpSupplierId = await resolvePortalSupplierId(supplierCandidate);

  // eslint-disable-next-line no-console
  console.log(LOG, "RFI detail access check", {
    rfi_name: rfiName,
    resolved_supplier: erpSupplierId,
  });

  if (!erpSupplierId) {
    throw new Error("Supplier session is not linked to a Supplier record.");
  }

  let rfi: RFI | null = null;

  // Strategy 1 — Server Script with PermissionError on non-invitees
  try {
    const doc = await apiPost<ErpRfiDoc>(
      "/api/method/bidsphere_get_supplier_rfi",
      { rfi_name: rfiName, supplier: erpSupplierId },
      withSilent(),
    );
    rfi = mapErpToRfi(doc);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /not invited|PermissionError|permission/i.test(message) ||
      /403|401/.test(message)
    ) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "Access denied by server script", {
        rfi_name: rfiName,
        resolved_supplier: erpSupplierId,
      });
      throw new Error("You are not invited to this RFI.");
    }
    // eslint-disable-next-line no-console
    console.warn(LOG, "bidsphere_get_supplier_rfi unavailable — fallback", err);
  }

  // Strategy 2 — Load parent + verify RFI Supplier child row exists
  if (!rfi) {
    try {
      rfi = await getRfi(rfiName);
    } catch (err) {
      if (isDocNotFoundError(err)) {
        throw new Error("RFI not found.");
      }
      throw err;
    }

    if (rfi.status === "Draft") {
      throw new Error("This RFI has not been published yet.");
    }

    const invited = rfi.suppliers.some(
      (s) => s.supplier.toLowerCase() === erpSupplierId.toLowerCase(),
    );
    if (!invited) {
      // Double-check via child-table resource query (not parent field filter)
      const childCheck = await apiGet<Array<{ name: string }>>(
        buildResourceUrl(RFI_DOCTYPE),
        withSilent(
          buildListConfig({
            fields: ["name"],
            filters: [
              ["name", "=", rfiName],
              [RFI_SUPPLIER_DOCTYPE, "supplier", "=", erpSupplierId],
            ],
            limit_page_length: 1,
          }),
        ),
      );
      const ok = Array.isArray(childCheck) && childCheck.length > 0;
      if (!ok) {
        // eslint-disable-next-line no-console
        console.warn(LOG, "Access denied — no RFI Supplier child row", {
          rfi_name: rfiName,
          resolved_supplier: erpSupplierId,
        });
        throw new Error("You are not invited to this RFI.");
      }
    }
  }

  const invite =
    rfi.suppliers.find(
      (s) => s.supplier.toLowerCase() === erpSupplierId.toLowerCase(),
    ) ?? {
      supplier: erpSupplierId,
      supplier_name: erpSupplierId,
    };

  let erpResponse: RfiResponse | null = null;
  try {
    const erpDoc = await findErpRfiResponse(rfi.name, erpSupplierId);
    if (erpDoc) erpResponse = mapErpResponseDoc(erpDoc);
  } catch (err) {
    if (!isRfiResponseDoctypeMissing(err)) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "ERP response load failed", err);
    }
  }

  const localResponse = readAllResponses().find(
    (r) =>
      r.rfi === rfiName &&
      r.supplier.toLowerCase() === erpSupplierId.toLowerCase(),
  );

  // Prefer live ERP; if local is Submitted and ERP is missing/Pending, backfill.
  let response = erpResponse ?? localResponse ?? null;
  if (
    localResponse?.status === "Submitted" &&
    (!erpResponse || erpResponse.status !== "Submitted")
  ) {
    try {
      const synced = await upsertErpRfiResponse(localResponse);
      await updateRfiSupplierResponseRow(rfi.name, erpSupplierId, {
        response_status: "Submitted",
        submitted_on: toErpDatetime(localResponse.submitted_at),
        documents_count: countUploadedDocuments(localResponse.documents),
        response_ref: synced.id,
      });
      response = synced;
      upsertResponse(synced);
      // eslint-disable-next-line no-console
      console.log(LOG, "Backfilled local Submitted response to ERP", {
        rfi: rfi.name,
        supplier: erpSupplierId,
        response: synced.id,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "Backfill Submitted response to ERP failed", err);
      response = localResponse;
    }
  }

  if (!response) {
    const ts = nowIso();
    const pending: RfiResponse = {
      id: generateId(),
      rfi: rfi.name,
      supplier: invite.supplier,
      supplier_name: invite.supplier_name,
      status: "Pending",
      answers: [],
      documents: [],
      created_at: ts,
      modified: ts,
    };
    try {
      response = await upsertErpRfiResponse(pending);
      await updateRfiSupplierResponseRow(rfi.name, invite.supplier, {
        response_status: "Pending",
        submitted_on: null,
        documents_count: 0,
        response_ref: response.id,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "Could not create ERP Pending response", err);
      response = pending;
    }
    upsertResponse(response);
  } else {
    upsertResponse(response);
  }

  return { rfi, response };
}

/* ── Responses (live ERP RFI Response DocType) ─────────────────────────── */

function pendingInviteResponse(
  rfiName: string,
  invite: RfiSupplierInvite,
): RfiResponse {
  const ts = nowIso();
  return {
    id: `pending:${rfiName}:${invite.supplier}`,
    rfi: rfiName,
    supplier: invite.supplier,
    supplier_name: invite.supplier_name,
    status: "Pending",
    answers: [],
    documents: [],
    created_at: ts,
    modified: ts,
  };
}

/**
 * Procurement Supplier Responses table — always prefers live RFI Response
 * DocType rows, seeded with Pending placeholders for invited suppliers.
 */
export async function listRfiResponses(rfiName: string): Promise<RfiResponse[]> {
  let invites: RfiSupplierInvite[] = [];
  try {
    const rfi = await getRfi(rfiName);
    invites = rfi.suppliers ?? [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "listRfiResponses: could not load RFI invites", err);
  }

  let erpRows: RfiResponse[] = [];
  try {
    erpRows = await listErpRfiResponses(rfiName);
  } catch (err) {
    if (!isRfiResponseDoctypeMissing(err)) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "listRfiResponses: ERP list failed", err);
    }
  }

  const bySupplier = new Map<string, RfiResponse>();
  for (const row of erpRows) {
    const key = row.supplier.toLowerCase();
    const prev = bySupplier.get(key);
    if (!prev || (row.status === "Submitted" && prev.status !== "Submitted")) {
      bySupplier.set(key, row);
    } else if (!prev) {
      bySupplier.set(key, row);
    }
  }

  // Same-browser fallback only — never the source of truth for procurement.
  for (const local of readAllResponses().filter((r) => r.rfi === rfiName)) {
    const key = local.supplier.toLowerCase();
    const prev = bySupplier.get(key);
    if (!prev) bySupplier.set(key, local);
    else if (local.status === "Submitted" && prev.status !== "Submitted") {
      bySupplier.set(key, local);
    }
  }

  const result: RfiResponse[] = [];
  const seen = new Set<string>();
  for (const invite of invites) {
    const key = invite.supplier.toLowerCase();
    seen.add(key);
    result.push(bySupplier.get(key) ?? pendingInviteResponse(rfiName, invite));
  }
  for (const [key, row] of bySupplier) {
    if (!seen.has(key)) result.push(row);
  }

  return result.sort((a, b) =>
    (b.modified || "").localeCompare(a.modified || ""),
  );
}

export async function getRfiResponse(responseId: string): Promise<RfiResponse> {
  // Synthetic pending placeholders are not ERP documents.
  if (responseId.startsWith("pending:")) {
    const local = readAllResponses().find((r) => r.id === responseId);
    if (local) return local;
    throw new Error("RFI response not found.");
  }

  try {
    const doc = await apiGet<ErpRfiResponseDoc>(
      buildResourceUrl(RFI_RESPONSE_DOCTYPE, responseId),
      withSilent(),
    );
    if (doc?.name) {
      const mapped = mapErpResponseDoc(doc);
      upsertResponse(mapped);
      return mapped;
    }
  } catch (err) {
    if (!isRfiResponseDoctypeMissing(err) && !isDocNotFoundError(err)) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "getRfiResponse ERP load failed", err);
    }
  }

  const local = readAllResponses().find((r) => r.id === responseId);
  if (!local) throw new Error("RFI response not found.");
  return local;
}

export async function fetchSupplierCompanySnapshot(
  supplierName: string,
): Promise<RfiCompanySnapshot> {
  const id = (await resolvePortalSupplierId(supplierName)) || supplierName;
  try {
    const s = await getSupplier(id);
    return {
      supplier: s.name,
      supplier_name: s.supplier_name || s.name,
      supplier_group: s.supplier_group,
      country: s.country,
      email: s.email_id,
      mobile_no: s.mobile_no,
      website: s.website,
      tax_id: s.tax_id,
    };
  } catch {
    return { supplier: id, supplier_name: id };
  }
}

export async function submitRfiResponse(
  rfiName: string,
  supplierName: string,
  input: RfiSubmitResponseInput,
): Promise<RfiResponse> {
  const { rfi, response } = await getSupplierRfiAssignment(
    rfiName,
    supplierName,
  );

  if (rfi.status === "Closed") {
    throw new Error("This RFI is closed. Responses are no longer accepted.");
  }
  if (response.status === "Submitted") {
    throw new Error("Response already submitted and cannot be edited.");
  }

  for (const q of rfi.questions) {
    if (!q.required) continue;
    const ans = input.answers.find((a) => a.question_id === q.id);
    if (!ans) throw new Error(`Please answer: ${q.title}`);
    if (q.type === "checkbox") {
      if (!ans.values?.length) throw new Error(`Please answer: ${q.title}`);
    } else if (q.type === "file_upload") {
      if (!ans.file?.file_url) {
        throw new Error(`Please upload a file for: ${q.title}`);
      }
    } else if (
      ans.value === undefined ||
      ans.value === null ||
      ans.value === ""
    ) {
      throw new Error(`Please answer: ${q.title}`);
    }
  }

  for (const doc of rfi.required_documents) {
    if (!doc.required) continue;
    const uploaded = input.documents.find((d) => d.document_id === doc.id);
    if (!uploaded?.file?.file_url) {
      throw new Error(`Please upload: ${doc.label || doc.doc_type}`);
    }
  }

  const ts = nowIso();
  const completion_pct = 100;
  const supplierId = response.supplier || (await resolvePortalSupplierId(supplierName)) || supplierName;
  const documents_count = countUploadedDocuments(input.documents);

  const draftSubmitted: RfiResponse = {
    ...response,
    supplier: supplierId,
    status: "Submitted",
    answers: input.answers,
    documents: input.documents,
    additional_comments: input.additional_comments?.trim() || "",
    company_snapshot: input.company_snapshot ?? response.company_snapshot,
    submitted_at: ts,
    submitted_by: response.supplier_name || supplierName,
    completion_pct,
    response_locked: true,
    review_status: "Under Review",
    modified: ts,
  };

  // Live ERP write — source of truth for Procurement Response Tracking.
  let submitted: RfiResponse;
  try {
    submitted = await upsertErpRfiResponse(draftSubmitted);
    await updateRfiSupplierResponseRow(rfi.name, supplierId, {
      response_status: "Submitted",
      submitted_on: toErpDatetime(submitted.submitted_at || ts),
      documents_count,
      response_ref: submitted.id,
    });
    // eslint-disable-next-line no-console
    console.log(LOG, "RFI Response synced to ERP + supplier row", {
      rfi: rfi.name,
      supplier: supplierId,
      response: submitted.id,
      documents_count,
      status: submitted.status,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(LOG, "Failed to persist RFI Response to ERP", err);
    throw new Error(
      err instanceof Error
        ? err.message
        : "Could not save RFI response to ERPNext. Please try again.",
    );
  }

  // Mirror locally for supplier-portal UX / offline meta.
  upsertResponse(submitted);
  try {
    localStorage.setItem(
      `bidsphere:rfi-response-meta:${rfi.name}:${supplierId}`,
      JSON.stringify({
        status: "Submitted",
        submitted_at: submitted.submitted_at || ts,
        submitted_by: submitted.submitted_by,
        completion_pct,
        response_locked: true,
        updated_at: ts,
      }),
    );
  } catch {
    /* ignore */
  }

  // Move parent RFI into buyer review — MUST remain visible on My RFIs.
  if (rfi.status === "Published") {
    try {
      await markRfiUnderReview(rfi.name);
    } catch {
      /* non-blocking for supplier submit */
    }
  }

  createNotification({
    title: "RFI Response Submitted",
    description: `${submitted.supplier_name} submitted a response to ${rfi.name}.`,
    module: "RFI",
    event_type: "rfi_response_submitted",
    target_role: "procurement",
    document_type: "RFI Response",
    document_name: submitted.id,
    route_path: `/sourcing/rfi/${encodeURIComponent(rfi.name)}/responses/${encodeURIComponent(submitted.id)}`,
  });

  return submitted;
}

/** Derive supplier-facing My RFIs status from RFI + response history. */
export function deriveSupplierRfiFacingStatus(
  row: Pick<
    SupplierRfiListRow,
    | "status"
    | "response_status"
    | "response_locked"
    | "review_status"
    | "completion_pct"
    | "submitted_at"
    | "has_local_draft"
  >,
): SupplierRfiFacingStatus {
  if (row.status === "Closed") return "Closed";
  if (row.review_status === "Approved") return "Approved";
  if (row.review_status === "Rejected") return "Rejected";
  if (
    row.response_status === "Submitted" ||
    row.response_locked ||
    row.submitted_at
  ) {
    if (row.review_status === "Under Review" || row.status === "Under Review") {
      return "Under Review";
    }
    return "Submitted";
  }
  if (
    row.has_local_draft ||
    (typeof row.completion_pct === "number" && row.completion_pct > 0)
  ) {
    return "In Progress";
  }
  return "Draft";
}

export async function updateResponseInternalNotes(
  responseId: string,
  notes: string,
): Promise<RfiResponse> {
  const existing = await getRfiResponse(responseId);
  const next: RfiResponse = {
    ...existing,
    internal_notes: notes,
    modified: nowIso(),
  };
  try {
    if (!responseId.startsWith("pending:")) {
      const saved = await upsertErpRfiResponse(next);
      upsertResponse(saved);
      return saved;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "updateResponseInternalNotes ERP save failed", err);
  }
  return upsertResponse(next);
}

export type UploadRfiFileOptions = {
  /** Attach File to this RFI (preferred over Supplier). */
  rfiName?: string;
  /** Optional Attach fieldname on the target document. */
  fieldname?: string;
};

/**
 * Upload an RFI supplier attachment to ERPNext File DocType.
 *
 * Flow: upload_file → File row → attachment link → verify readable → return.
 * Does NOT enable View/Download until file-proxy confirms bytes are available.
 * Never attaches to invented custom fieldnames (that caused false "not found" toasts).
 */
export async function uploadRfiFile(
  file: File,
  supplierName: string,
  options?: UploadRfiFileOptions,
): Promise<RfiUploadedFile> {
  const uploaded_at = nowIso();
  const supplierId =
    (await resolvePortalSupplierId(supplierName)) || supplierName;
  const rfiName = String(options?.rfiName || "").trim();
  const attachDoctype = rfiName ? RFI_DOCTYPE : "Supplier";
  const attachName = rfiName || supplierId;
  // Only pass fieldname when explicitly provided AND non-synthetic.
  // Values like `required_doc_<uuid>` are not RFI DocType fields and make
  // Frappe fail after File creation → global toast remaps to "document not available".
  const rawField = String(options?.fieldname || "").trim();
  const fieldname =
    rawField && !rawField.startsWith("required_doc_") && !rawField.startsWith("question_")
      ? rawField
      : undefined;

  // eslint-disable-next-line no-console
  console.log("[RFI:upload] started", {
    file_name: file.name,
    file_size: file.size,
    supplier: supplierId,
    rfi: rfiName || null,
    attach_doctype: attachDoctype,
    attach_name: attachName,
  });

  try {
    const uploaded = await uploadFileToERPNextDetailed(
      file,
      attachDoctype,
      attachName,
      {
        folder: "Home",
        fieldname,
        isPrivate: true,
      },
    );

    if (!uploaded.file_url?.trim()) {
      throw new Error("Upload succeeded but file_url is missing.");
    }

    const confirmed = await confirmUploadedErpFile(uploaded);

    // eslint-disable-next-line no-console
    console.log("[RFI:upload] response returned", {
      success: true,
      documentId: confirmed.file_id,
      fileUrl: confirmed.file_url,
      attachmentId: confirmed.file_id,
      file_name: confirmed.file_name,
      file_size: confirmed.file_size,
      attached_to_doctype: confirmed.attached_to_doctype,
      attached_to_name: confirmed.attached_to_name,
      attached_to_field: confirmed.attached_to_field ?? null,
    });

    return {
      file_name: confirmed.file_name,
      file_url: confirmed.file_url,
      file_id: confirmed.file_id,
      file_size: confirmed.file_size,
      uploaded_at,
      attached_to_doctype: confirmed.attached_to_doctype,
      attached_to_name: confirmed.attached_to_name,
      attached_to_field: confirmed.attached_to_field,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "File upload failed.";
    // eslint-disable-next-line no-console
    console.error("[RFI:upload] failed", { message, err });
    throw new Error(message);
  }
}

export async function getRfiStats(): Promise<{
  draft: number;
  published: number;
  underReview: number;
  closed: number;
  total: number;
}> {
  const all = await listRfis();
  return {
    draft: all.filter((r) => r.status === "Draft").length,
    published: all.filter((r) => r.status === "Published").length,
    underReview: all.filter((r) => r.status === "Under Review").length,
    closed: all.filter((r) => r.status === "Closed").length,
    total: all.length,
  };
}
