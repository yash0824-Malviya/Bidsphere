/**
 * RFP (Request for Proposal) service — ERPNext-backed.
 *
 * Parent DocType: "RFP"
 * Invitation child table: "RFP Supplier"
 *
 * Supplier portal lists resolve invitations via the RFP Supplier child table
 * only — never a supplier field on the RFP parent document.
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
import { resolveSupplierERPNextId } from "./supplier";
import {
  confirmUploadedErpFile,
  uploadFileToERPNextDetailed,
} from "./legalDocsStorage";
import { generateId } from "../utils/id";
import { nowERPNextDatetime } from "../utils/erpNextDate";
import {
  getRfpEnrichment,
  mergeRfpWithEnrichment,
  readAllRfpResponses,
  rfpNeedsNarrativeSync,
  upsertRfpResponse,
} from "./rfpStorage";
import type {
  RFP,
  RfpCreateInput,
  RfpDocumentUpload,
  RfpRequiredDocument,
  RfpResponse,
  RfpStatus,
  RfpSubmitResponseInput,
  RfpSupplierInvite,
  RfpUpdateInput,
  RfpUploadedFile,
  SupplierRfpFacingStatus,
} from "../types/rfp";

const LOG = "[SupplierPortal:RFP]";
const RFP_DOCTYPE = "RFP";
const RFP_SUPPLIER_DOCTYPE = "RFP Supplier";
const RFP_RESPONSE_DOCTYPE = "RFP Response";
const RFP_NAMING_SERIES = "RFP-.YYYY.-.#####";

const nowIso = () => new Date().toISOString();

interface ErpRfpDoc {
  name: string;
  title?: string;
  description?: string;
  submission_deadline?: string;
  status?: RfpStatus;
  required_documents_json?: string;
  scope_of_work?: string;
  business_objective?: string;
  technical_requirements?: string;
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

/** Normalize ERP Supplier link values that may be stored with extra quotes. */
function normalizeSupplierId(raw: string | undefined | null): string {
  return String(raw || "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .trim();
}

function supplierMatchKey(raw: string | undefined | null): string {
  return normalizeSupplierId(raw).toLowerCase();
}

function mapErpToRfp(doc: ErpRfpDoc): RFP {
  const required_documents = parseJsonArray<RfpRequiredDocument>(
    doc.required_documents_json,
  );
  const suppliers: RfpSupplierInvite[] = (doc.suppliers ?? [])
    .filter((s) => s.supplier)
    .map((s) => {
      const supplier = normalizeSupplierId(s.supplier);
      const supplier_name =
        normalizeSupplierId(s.supplier_name) || supplier;
      return { supplier, supplier_name };
    });

  return {
    name: doc.name,
    title: doc.title ?? "",
    description: stripHtml(doc.description) || doc.description || "",
    submission_deadline: doc.submission_deadline ?? "",
    status: (doc.status as RfpStatus) || "Draft",
    required_documents,
    suppliers,
    owner: doc.owner,
    company: doc.company,
    scope_of_work: String(doc.scope_of_work || "").trim() || undefined,
    business_objective:
      String(doc.business_objective || "").trim() || undefined,
    technical_requirements:
      String(doc.technical_requirements || "").trim() || undefined,
    internal_notes: doc.internal_notes,
    published_at: doc.published_at,
    closed_at: doc.closed_at,
    created_at: doc.creation ?? nowIso(),
    modified: doc.modified ?? nowIso(),
  };
}

function assertDraft(rfp: RFP): void {
  if (rfp.status !== "Draft") {
    throw new Error("Only draft RFPs can be edited.");
  }
}

function validateCreateInput(data: RfpCreateInput): void {
  if (!data.title?.trim()) throw new Error("Title is required.");
  if (!data.submission_deadline?.trim()) {
    throw new Error("Submission deadline is required.");
  }
  if (!data.suppliers?.length) {
    throw new Error("Select at least one supplier.");
  }
}

function buildDocuments(
  input: RfpCreateInput["required_documents"],
): RfpRequiredDocument[] {
  return (input ?? []).map((d) => ({
    id: generateId(),
    doc_type: d.doc_type,
    label: d.label,
    required: d.required !== false,
  }));
}

export async function resolvePortalSupplierIdForRfp(
  candidate: string,
): Promise<string> {
  const raw = String(candidate || "").trim();
  if (!raw) return "";
  const resolved = await resolveSupplierERPNextId(raw);
  return resolved || raw;
}

export async function listRfps(filters?: {
  status?: RfpStatus | RfpStatus[];
  search?: string;
}): Promise<RFP[]> {
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

  const raw = await apiGet<ErpRfpDoc[]>(
    buildResourceUrl(RFP_DOCTYPE),
    buildListConfig({
      fields: [
        "name",
        "title",
        "description",
        "scope_of_work",
        "business_objective",
        "technical_requirements",
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

  let rows = (Array.isArray(raw) ? raw : []).map(mapErpToRfp);

  if (filters?.search?.trim()) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }

  return rows;
}

export async function listRfpsPaged(options: {
  page: number;
  pageSize: number;
  status?: RfpStatus | RfpStatus[];
  search?: string;
}): Promise<{ data: RFP[]; total: number }> {
  const all = await listRfps({
    status: options.status,
    search: options.search,
  });
  const start = (options.page - 1) * options.pageSize;
  const pageRows = all.slice(start, start + options.pageSize);
  const data = await Promise.all(
    pageRows.map(async (r) => {
      try {
        return await getRfp(r.name);
      } catch {
        return r;
      }
    }),
  );
  return { data, total: all.length };
}

export async function getRfp(name: string): Promise<RFP> {
  const doc = await apiGet<ErpRfpDoc>(
    buildResourceUrl(RFP_DOCTYPE, name),
    withSilent(),
  );
  return mapErpToRfp(doc);
}

export async function createRfp(input: RfpCreateInput): Promise<RFP> {
  validateCreateInput(input);
  const required_documents = buildDocuments(input.required_documents);

  const created = await apiPost<ErpRfpDoc>(buildResourceUrl(RFP_DOCTYPE), {
    naming_series: RFP_NAMING_SERIES,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    submission_deadline: input.submission_deadline,
    status: "Draft",
    company: input.company || COMPANY || undefined,
    scope_of_work: (input.scope_of_work ?? "").trim(),
    business_objective: (input.business_objective ?? "").trim(),
    technical_requirements: (input.technical_requirements ?? "").trim(),
    required_documents_json: JSON.stringify(required_documents),
    suppliers: input.suppliers.map((s) => ({
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
    })),
    internal_notes: "",
  });
  return mapErpToRfp(created);
}

export async function updateRfp(
  name: string,
  patch: RfpUpdateInput,
): Promise<RFP> {
  const existing = await getRfp(name);
  assertDraft(existing);

  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.description !== undefined) {
    payload.description = patch.description.trim();
  }
  if (patch.submission_deadline !== undefined) {
    payload.submission_deadline = patch.submission_deadline;
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
  if (patch.scope_of_work !== undefined) {
    payload.scope_of_work = patch.scope_of_work.trim();
  }
  if (patch.business_objective !== undefined) {
    payload.business_objective = patch.business_objective.trim();
  }
  if (patch.technical_requirements !== undefined) {
    payload.technical_requirements = patch.technical_requirements.trim();
  }

  const updated = await apiPut<ErpRfpDoc>(
    buildResourceUrl(RFP_DOCTYPE, name),
    payload,
  );
  return mapErpToRfp(updated);
}

/**
 * Persist narrative fields to ERPNext even when the RFP is already published.
 * Used to backfill values previously kept only in browser local enrichment.
 */
export async function syncRfpNarrativeFields(
  name: string,
  fields: {
    scope_of_work?: string;
    business_objective?: string;
    technical_requirements?: string;
  },
): Promise<RFP> {
  const payload: Record<string, unknown> = {};
  if (fields.scope_of_work !== undefined) {
    payload.scope_of_work = String(fields.scope_of_work || "").trim();
  }
  if (fields.business_objective !== undefined) {
    payload.business_objective = String(fields.business_objective || "").trim();
  }
  if (fields.technical_requirements !== undefined) {
    payload.technical_requirements = String(
      fields.technical_requirements || "",
    ).trim();
  }
  if (!Object.keys(payload).length) {
    return getRfp(name);
  }
  // eslint-disable-next-line no-console
  console.log(LOG, "Syncing RFP narrative fields to ERP", {
    rfp: name,
    has_scope: Boolean(payload.scope_of_work),
    has_objective: Boolean(payload.business_objective),
    has_technical: Boolean(payload.technical_requirements),
  });
  const updated = await apiPut<ErpRfpDoc>(
    buildResourceUrl(RFP_DOCTYPE, name),
    payload,
    withSilent(),
  );
  return mapErpToRfp(updated);
}

/**
 * Push local enrichment narrative fields into ERP when the ERP document is empty.
 * Safe to call from procurement list/detail — no-op when nothing to sync.
 */
export async function syncLocalRfpEnrichmentToErp(name: string): Promise<RFP> {
  const erp = await getRfp(name);
  if (!rfpNeedsNarrativeSync(erp)) return mergeRfpWithEnrichment(erp);
  const e = getRfpEnrichment(name);
  const synced = await syncRfpNarrativeFields(name, {
    scope_of_work: e.scope_of_work || "",
    business_objective: e.business_objective || "",
    technical_requirements: e.technical_requirements || "",
  });
  return mergeRfpWithEnrichment(synced);
}

/* ── ERP RFP Response (Proposal Response) ──────────────────────────────── */

interface ErpRfpResponseDoc {
  name: string;
  rfp?: string;
  supplier?: string;
  supplier_name?: string;
  status?: string;
  submitted_at?: string;
  documents_count?: number;
  proposal_description?: string;
  additional_comments?: string;
  documents_json?: string;
  internal_notes?: string;
  creation?: string;
  modified?: string;
}

function toErpDatetime(isoOrErp: string | undefined): string | null {
  if (!isoOrErp) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(isoOrErp)) return isoOrErp;
  const d = new Date(isoOrErp);
  if (Number.isNaN(d.getTime())) return nowERPNextDatetime();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function countUploadedDocs(documents: RfpDocumentUpload[] | undefined): number {
  return (documents ?? []).filter((d) => Boolean(d.file?.file_url)).length;
}

function mapErpRfpResponseDoc(doc: ErpRfpResponseDoc): RfpResponse {
  const documents = parseJsonArray<RfpDocumentUpload>(doc.documents_json);
  const uploadedCount = countUploadedDocs(documents);
  const documents_count =
    typeof doc.documents_count === "number" && doc.documents_count > 0
      ? doc.documents_count
      : uploadedCount;
  const status =
    String(doc.status || "").toLowerCase() === "submitted"
      ? "Submitted"
      : "Pending";
  const reviewRaw = String(
    (doc as { review_status?: string }).review_status || "",
  ).trim();
  const review_status =
    reviewRaw === "Awarded" ||
    reviewRaw === "Rejected" ||
    reviewRaw === "Clarification Requested" ||
    reviewRaw === "Under Review"
      ? (reviewRaw as RfpResponse["review_status"])
      : undefined;
  const supplier = normalizeSupplierId(doc.supplier);
  const supplier_name =
    normalizeSupplierId(doc.supplier_name) || supplier;
  return {
    id: doc.name,
    rfp: String(doc.rfp || ""),
    supplier,
    supplier_name,
    status,
    proposal_description: doc.proposal_description || "",
    documents,
    documents_count,
    additional_comments: doc.additional_comments || "",
    submitted_at: doc.submitted_at || undefined,
    review_status,
    internal_notes: doc.internal_notes || undefined,
    created_at: doc.creation || nowIso(),
    modified: doc.modified || nowIso(),
  };
}

async function listErpRfpResponses(rfpName: string): Promise<RfpResponse[]> {
  const rows = await apiGet<ErpRfpResponseDoc[]>(
    buildResourceUrl(RFP_RESPONSE_DOCTYPE),
    withSilent(
      buildListConfig({
        fields: [
          "name",
          "rfp",
          "supplier",
          "supplier_name",
          "status",
          "submitted_at",
          "documents_count",
          "proposal_description",
          "additional_comments",
          "documents_json",
          "internal_notes",
          "creation",
          "modified",
        ],
        filters: [["rfp", "=", rfpName]],
        limit_page_length: 500,
        order_by: "modified desc",
      }),
    ),
  );
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r?.name && r.rfp)
    .map(mapErpRfpResponseDoc);
}

async function findErpRfpResponse(
  rfpName: string,
  supplierId: string,
): Promise<ErpRfpResponseDoc | null> {
  const normalized = normalizeSupplierId(supplierId);
  const candidates = Array.from(
    new Set([normalized, `"${normalized}"`, supplierId].filter(Boolean)),
  );
  try {
    for (const candidate of candidates) {
      const rows = await apiGet<ErpRfpResponseDoc[]>(
        buildResourceUrl(RFP_RESPONSE_DOCTYPE),
        withSilent(
          buildListConfig({
            fields: ["name", "rfp", "supplier", "status", "modified"],
            filters: [
              ["rfp", "=", rfpName],
              ["supplier", "=", candidate],
            ],
            limit_page_length: 5,
            order_by: "modified desc",
          }),
        ),
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row?.name) {
        return await apiGet<ErpRfpResponseDoc>(
          buildResourceUrl(RFP_RESPONSE_DOCTYPE, row.name),
          withSilent(),
        );
      }
    }

    // Fallback: list by RFP and match normalized supplier key in memory.
    const all = await listErpRfpResponses(rfpName);
    const match = all.find(
      (r) => supplierMatchKey(r.supplier) === supplierMatchKey(normalized),
    );
    if (!match?.id) return null;
    return await apiGet<ErpRfpResponseDoc>(
      buildResourceUrl(RFP_RESPONSE_DOCTYPE, match.id),
      withSilent(),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "findErpRfpResponse failed", err);
    return null;
  }
}

async function upsertErpRfpResponse(response: RfpResponse): Promise<RfpResponse> {
  const documents = response.documents ?? [];
  const supplier = normalizeSupplierId(response.supplier);
  const payload = {
    rfp: response.rfp,
    supplier,
    supplier_name:
      normalizeSupplierId(response.supplier_name) || supplier,
    status: response.status,
    submitted_at: toErpDatetime(response.submitted_at),
    documents_count: countUploadedDocs(documents),
    proposal_description: response.proposal_description || "",
    additional_comments: response.additional_comments || "",
    documents_json: JSON.stringify(documents),
    internal_notes: response.internal_notes || "",
  };

  const existing = await findErpRfpResponse(response.rfp, supplier);
  if (existing?.name) {
    const updated = await apiPut<ErpRfpResponseDoc>(
      buildResourceUrl(RFP_RESPONSE_DOCTYPE, existing.name),
      payload,
      withSilent(),
    );
    return mapErpRfpResponseDoc({ ...existing, ...updated, name: existing.name });
  }

  const created = await apiPost<ErpRfpResponseDoc>(
    buildResourceUrl(RFP_RESPONSE_DOCTYPE),
    {
      naming_series: "RFPR-.YYYY.-.#####",
      ...payload,
    },
    withSilent(),
  );
  if (!created?.name) {
    throw new Error("RFP Response was not created in ERPNext.");
  }
  return mapErpRfpResponseDoc(created);
}

async function updateRfpSupplierResponseRow(
  rfpName: string,
  supplierId: string,
  tracking: {
    response_status: "Pending" | "Submitted";
    submitted_on?: string | null;
    documents_count: number;
    response_ref: string;
  },
): Promise<void> {
  const doc = await apiGet<ErpRfpDoc & {
    suppliers?: Array<{
      name?: string;
      supplier?: string;
      supplier_name?: string;
      response_status?: string;
      submitted_on?: string;
      documents_count?: number;
      response_ref?: string;
    }>;
  }>(buildResourceUrl(RFP_DOCTYPE, rfpName), withSilent());

  const suppliers = Array.isArray(doc.suppliers) ? [...doc.suppliers] : [];
  const key = supplierMatchKey(supplierId);
  const idx = suppliers.findIndex(
    (s) => supplierMatchKey(s.supplier) === key,
  );
  if (idx < 0) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "RFP Supplier row not found for tracking update", {
      rfp: rfpName,
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

  await apiPut(
    buildResourceUrl(RFP_DOCTYPE, rfpName),
    { suppliers },
    withSilent(),
  );
}

async function attachFilesToRfpResponse(
  responseName: string,
  documents: RfpDocumentUpload[],
): Promise<void> {
  for (const doc of documents) {
    const fileId = String(doc.file?.file_id || "").trim();
    const fileUrl = String(doc.file?.file_url || "").trim();
    if (!fileId && !fileUrl) continue;
    try {
      if (fileId) {
        await apiPut(
          buildResourceUrl("File", fileId),
          {
            attached_to_doctype: RFP_RESPONSE_DOCTYPE,
            attached_to_name: responseName,
          },
          withSilent(),
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "Could not re-link file to RFP Response", {
        responseName,
        fileId,
        err,
      });
    }
  }
}

export async function deleteRfp(name: string): Promise<void> {
  const existing = await getRfp(name);
  assertDraft(existing);
  await apiDelete(buildResourceUrl(RFP_DOCTYPE, name));
}

export async function publishRfp(name: string): Promise<RFP> {
  const existing = await getRfp(name);
  if (existing.status !== "Draft") {
    throw new Error("Only draft RFPs can be published.");
  }
  if (!existing.suppliers.length) {
    throw new Error("Select at least one supplier before publishing.");
  }
  if (!existing.required_documents.length) {
    throw new Error("Add at least one required document before publishing.");
  }

  // Ensure local enrichment narrative fields are on ERP before suppliers see them.
  try {
    await syncLocalRfpEnrichmentToErp(name);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "Enrichment sync before publish failed", err);
  }

  const enrichment = getRfpEnrichment(name);
  const published = await apiPut<ErpRfpDoc>(
    buildResourceUrl(RFP_DOCTYPE, name),
    {
      status: "Published",
      published_at: nowERPNextDatetime(),
      scope_of_work:
        enrichment.scope_of_work?.trim() || existing.scope_of_work || "",
      business_objective:
        enrichment.business_objective?.trim() ||
        existing.business_objective ||
        "",
      technical_requirements:
        enrichment.technical_requirements?.trim() ||
        existing.technical_requirements ||
        "",
    },
  );
  const mapped = mapErpToRfp(published);

  for (const invite of mapped.suppliers) {
    const already = readAllRfpResponses().find(
      (r) =>
        r.rfp === mapped.name &&
        r.supplier.toLowerCase() === invite.supplier.toLowerCase(),
    );
    if (!already) {
      const now = nowIso();
      upsertRfpResponse({
        id: generateId(),
        rfp: mapped.name,
        supplier: invite.supplier,
        supplier_name: invite.supplier_name,
        status: "Pending",
        proposal_description: "",
        documents: [],
        created_at: now,
        modified: now,
      });
    }

    createNotification({
      title: "New RFP Invitation",
      description: `You have been invited to submit a proposal for ${mapped.name}: ${mapped.title}. Deadline: ${mapped.submission_deadline}.`,
      module: "RFP Invitation",
      event_type: "rfp_published",
      target_role: "supplier",
      supplier_id: invite.supplier,
      document_type: "RFP",
      document_name: mapped.name,
      route_path: `/supplier/rfps/${encodeURIComponent(mapped.name)}`,
    });
  }

  createNotification({
    title: "RFP Published",
    description: `${mapped.name} was published to ${mapped.suppliers.length} supplier(s).`,
    module: "RFP",
    event_type: "rfp_published",
    target_role: "procurement",
    document_type: "RFP",
    document_name: mapped.name,
    route_path: `/sourcing/rfp/${encodeURIComponent(mapped.name)}`,
  });

  return mapped;
}

export async function markRfpUnderReview(name: string): Promise<RFP> {
  const existing = await getRfp(name);
  if (existing.status === "Closed" || existing.status === "Under Review") {
    return existing;
  }
  if (existing.status === "Draft") {
    throw new Error("Publish the RFP before reviewing responses.");
  }
  const updated = await apiPut<ErpRfpDoc>(
    buildResourceUrl(RFP_DOCTYPE, name),
    { status: "Under Review" },
  );
  return mapErpToRfp(updated);
}

export async function closeRfp(name: string): Promise<RFP> {
  const existing = await getRfp(name);
  if (existing.status === "Draft") {
    throw new Error("Cannot close a draft RFP. Publish or delete it instead.");
  }
  if (existing.status === "Closed") return existing;

  const closed = await apiPut<ErpRfpDoc>(buildResourceUrl(RFP_DOCTYPE, name), {
    status: "Closed",
    closed_at: nowERPNextDatetime(),
  });
  const mapped = mapErpToRfp(closed);

  createNotification({
    title: "RFP Closed",
    description: `${mapped.name} has been closed.`,
    module: "RFP",
    event_type: "rfp_closed",
    target_role: "procurement",
    document_type: "RFP",
    document_name: mapped.name,
    route_path: `/sourcing/rfp/${encodeURIComponent(mapped.name)}`,
  });

  for (const invite of mapped.suppliers) {
    createNotification({
      title: "RFP Closed",
      description: `${mapped.name} (${mapped.title}) has been closed by procurement.`,
      module: "RFP Invitation",
      event_type: "rfp_closed",
      target_role: "supplier",
      supplier_id: invite.supplier,
      document_type: "RFP",
      document_name: mapped.name,
      route_path: `/supplier/rfps/${encodeURIComponent(mapped.name)}`,
    });
  }

  return mapped;
}

export async function updateRfpInternalNotes(
  name: string,
  notes: string,
): Promise<RFP> {
  const updated = await apiPut<ErpRfpDoc>(
    buildResourceUrl(RFP_DOCTYPE, name),
    { internal_notes: notes },
  );
  return mapErpToRfp(updated);
}

export interface SupplierRfpListRow {
  name: string;
  title: string;
  description: string;
  submission_deadline: string;
  status: RfpStatus;
  modified?: string;
  /** Joined supplier proposal fields. */
  response_status?: RfpResponse["status"] | null;
  submitted_at?: string | null;
  response_id?: string | null;
  review_status?: RfpResponse["review_status"] | null;
  documents_count?: number | null;
  has_local_draft?: boolean;
}

const SUPPLIER_VISIBLE_RFP_STATUSES: RfpStatus[] = [
  "Published",
  "Under Review",
  "Closed",
];

const RFP_LIST_FIELDS = [
  "name",
  "title",
  "description",
  "submission_deadline",
  "status",
  "modified",
] as const;

function normalizeSupplierRfpRow(r: SupplierRfpListRow): SupplierRfpListRow {
  return {
    ...r,
    description: stripHtml(r.description) || r.description || "",
    status: (r.status as RfpStatus) || "Published",
  };
}

function mergeSupplierRfpRows(
  ...groups: SupplierRfpListRow[][]
): SupplierRfpListRow[] {
  const map = new Map<string, SupplierRfpListRow>();
  for (const group of groups) {
    for (const row of group) {
      if (!row?.name) continue;
      const prev = map.get(row.name);
      map.set(
        row.name,
        prev ? { ...prev, ...normalizeSupplierRfpRow(row) } : normalizeSupplierRfpRow(row),
      );
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    String(b.modified || "").localeCompare(String(a.modified || "")),
  );
}

async function listErpRfpResponsesForSupplier(
  erpSupplierId: string,
): Promise<RfpResponse[]> {
  try {
    const rows = await apiGet<ErpRfpResponseDoc[]>(
      buildResourceUrl(RFP_RESPONSE_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: [
            "name",
            "rfp",
            "supplier",
            "supplier_name",
            "status",
            "submitted_at",
            "documents_count",
            "proposal_description",
            "documents_json",
            "creation",
            "modified",
          ],
          filters: [["supplier", "=", erpSupplierId]],
          limit_page_length: 500,
          order_by: "modified desc",
        }),
      ),
    );
    return (Array.isArray(rows) ? rows : []).map(mapErpRfpResponseDoc);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "listErpRfpResponsesForSupplier failed", err);
    return [];
  }
}

async function enrichSupplierRfpRows(
  rows: SupplierRfpListRow[],
  erpSupplierId: string,
): Promise<SupplierRfpListRow[]> {
  const localResponses = readAllRfpResponses().filter(
    (r) => supplierMatchKey(r.supplier) === supplierMatchKey(erpSupplierId),
  );
  const erpResponses = await listErpRfpResponsesForSupplier(erpSupplierId);

  return rows.map((row) => {
    const erp = erpResponses.find((r) => r.rfp === row.name) ?? null;
    const local = localResponses.find((r) => r.rfp === row.name) ?? null;
    const response =
      erp?.status === "Submitted"
        ? erp
        : local?.status === "Submitted"
          ? local
          : erp ?? local;

    let meta: { status?: "Draft" | "Submitted"; submitted_at?: string } = {};
    try {
      const raw = localStorage.getItem(
        `bidsphere:rfp-response-meta:${row.name}:${erpSupplierId}`,
      );
      if (raw) meta = JSON.parse(raw) as typeof meta;
    } catch {
      meta = {};
    }

    const submitted =
      response?.status === "Submitted" || meta.status === "Submitted";
    const hasDraft =
      !submitted &&
      (meta.status === "Draft" ||
        Boolean(local?.proposal_description?.trim()) ||
        countUploadedDocs(local?.documents) > 0);

    return {
      ...row,
      response_status:
        response?.status ?? (meta.status === "Submitted" ? "Submitted" : null),
      submitted_at: response?.submitted_at ?? meta.submitted_at ?? null,
      response_id: response?.id ?? null,
      review_status: response?.review_status ?? null,
      documents_count:
        typeof response?.documents?.length === "number"
          ? countUploadedDocs(response.documents)
          : null,
      has_local_draft: hasDraft,
    };
  });
}

/** Derive supplier-facing My RFPs status from RFP + proposal history. */
export function deriveSupplierRfpFacingStatus(
  row: Pick<
    SupplierRfpListRow,
    | "status"
    | "response_status"
    | "review_status"
    | "submitted_at"
    | "has_local_draft"
  >,
): SupplierRfpFacingStatus {
  if (row.status === "Closed") return "Closed";
  if (row.review_status === "Awarded") return "Awarded";
  if (row.review_status === "Rejected") return "Rejected";
  if (row.review_status === "Clarification Requested") {
    return "Clarification Requested";
  }
  if (row.response_status === "Submitted" || Boolean(row.submitted_at)) {
    // Prefer the supplier's proposal status; parent RFP "Under Review"
    // must not hide a successful submission from My RFPs.
    if (row.review_status === "Under Review") return "Under Review";
    return "Submitted";
  }
  if (row.status === "Under Review") return "Under Review";
  if (row.has_local_draft) return "Draft";
  return "New";
}

/**
 * Fetch ALL RFPs invited to the supplier (Published / Under Review / Closed).
 * Submission must never remove history — only the proposal status changes.
 */
export async function getSupplierRFPs(
  supplierCandidate: string,
): Promise<SupplierRfpListRow[]> {
  const erpSupplierId =
    await resolvePortalSupplierIdForRfp(supplierCandidate);

  // eslint-disable-next-line no-console
  console.log(LOG, "My RFPs query", {
    resolved_supplier: erpSupplierId,
    raw_candidate: supplierCandidate,
    doctype: RFP_DOCTYPE,
    child_table: RFP_SUPPLIER_DOCTYPE,
    status_filter: SUPPLIER_VISIBLE_RFP_STATUSES,
  });

  if (!erpSupplierId) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "My RFPs aborted — empty ERP supplier id");
    return [];
  }

  let scriptRows: SupplierRfpListRow[] = [];
  let resourceRows: SupplierRfpListRow[] = [];
  let getListRows: SupplierRfpListRow[] = [];

  try {
    const msg = await apiPost<{
      supplier?: string;
      count?: number;
      data?: SupplierRfpListRow[];
    }>(
      "/api/method/bidsphere_get_supplier_rfps",
      { supplier: erpSupplierId },
      withSilent(),
    );
    scriptRows = (Array.isArray(msg?.data) ? msg.data : []).map(
      normalizeSupplierRfpRow,
    );
    // eslint-disable-next-line no-console
    console.log(LOG, "Server script result", {
      resolved_supplier: msg?.supplier || erpSupplierId,
      assigned_rfp_count: msg?.count ?? scriptRows.length,
      statuses: Array.from(new Set(scriptRows.map((r) => r.status))),
      names: scriptRows.map((r) => r.name),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "bidsphere_get_supplier_rfps unavailable — fallback", err);
  }

  const filters: Filter[] = [
    [RFP_SUPPLIER_DOCTYPE, "supplier", "=", erpSupplierId],
    ["status", "in", SUPPLIER_VISIBLE_RFP_STATUSES],
  ];

  try {
    const raw = await apiGet<SupplierRfpListRow[]>(
      buildResourceUrl(RFP_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: [...RFP_LIST_FIELDS],
          filters,
          order_by: "modified desc",
          limit_page_length: 500,
        }),
      ),
    );
    resourceRows = (Array.isArray(raw) ? raw : []).map(normalizeSupplierRfpRow);
    // eslint-disable-next-line no-console
    console.log(LOG, "Resource API child-table result", {
      resolved_supplier: erpSupplierId,
      assigned_rfp_count: resourceRows.length,
      statuses: Array.from(new Set(resourceRows.map((r) => r.status))),
      names: resourceRows.map((r) => r.name),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "Resource API child-table filter failed", err);
  }

  if (!resourceRows.length) {
    try {
      const body = {
        doctype: RFP_DOCTYPE,
        fields: [...RFP_LIST_FIELDS],
        filters,
        order_by: "modified desc",
        limit_page_length: 500,
      };
      const raw = await apiPost<
        SupplierRfpListRow[] | { message?: SupplierRfpListRow[] }
      >("/api/method/frappe.client.get_list", body, withSilent());
      getListRows = (
        Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { message?: SupplierRfpListRow[] })?.message)
            ? (raw as { message: SupplierRfpListRow[] }).message
            : []
      ).map(normalizeSupplierRfpRow);
      // eslint-disable-next-line no-console
      console.log(LOG, "get_list POST child-table result", {
        resolved_supplier: erpSupplierId,
        assigned_rfp_count: getListRows.length,
        names: getListRows.map((r) => r.name),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(LOG, "get_list My RFPs fetch failed", err);
      if (!scriptRows.length && !resourceRows.length) {
        throw err instanceof Error
          ? err
          : new Error("Could not load assigned RFPs.");
      }
    }
  }

  const merged = mergeSupplierRfpRows(scriptRows, resourceRows, getListRows);
  const enriched = await enrichSupplierRfpRows(merged, erpSupplierId);

  // eslint-disable-next-line no-console
  console.log(LOG, "My RFPs merged history", {
    resolved_supplier: erpSupplierId,
    total: enriched.length,
    statuses: Array.from(new Set(enriched.map((r) => r.status))),
    names: enriched.map((r) => r.name),
  });

  return enriched;
}

export async function getSupplierRfpAssignment(
  rfpName: string,
  supplierCandidate: string,
): Promise<{ rfp: RFP; response: RfpResponse }> {
  const erpSupplierId =
    await resolvePortalSupplierIdForRfp(supplierCandidate);

  // eslint-disable-next-line no-console
  console.log(LOG, "RFP detail access check", {
    rfp_name: rfpName,
    resolved_supplier: erpSupplierId,
  });

  if (!erpSupplierId) {
    throw new Error("Supplier session is not linked to a Supplier record.");
  }

  let rfp: RFP | null = null;

  try {
    const doc = await apiPost<ErpRfpDoc>(
      "/api/method/bidsphere_get_supplier_rfp",
      { rfp_name: rfpName, supplier: erpSupplierId },
      withSilent(),
    );
    rfp = mapErpToRfp(doc);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /not invited|PermissionError|permission/i.test(message) ||
      /403|401/.test(message)
    ) {
      throw new Error("You are not invited to this RFP.");
    }
    // eslint-disable-next-line no-console
    console.warn(LOG, "bidsphere_get_supplier_rfp unavailable — fallback", err);
  }

  if (!rfp) {
    try {
      rfp = await getRfp(rfpName);
    } catch (err) {
      if (isDocNotFoundError(err)) throw new Error("RFP not found.");
      throw err;
    }

    if (rfp.status === "Draft") {
      throw new Error("This RFP has not been published yet.");
    }

    const invited = rfp.suppliers.some(
      (s) => supplierMatchKey(s.supplier) === supplierMatchKey(erpSupplierId),
    );
    if (!invited) {
      const candidates = Array.from(
        new Set([
          normalizeSupplierId(erpSupplierId),
          `"${normalizeSupplierId(erpSupplierId)}"`,
          erpSupplierId,
        ].filter(Boolean)),
      );
      let ok = false;
      for (const candidate of candidates) {
        const childCheck = await apiGet<Array<{ name: string }>>(
          buildResourceUrl(RFP_DOCTYPE),
          withSilent(
            buildListConfig({
              fields: ["name"],
              filters: [
                ["name", "=", rfpName],
                [RFP_SUPPLIER_DOCTYPE, "supplier", "=", candidate],
              ],
              limit_page_length: 1,
            }),
          ),
        );
        if (Array.isArray(childCheck) && childCheck.length > 0) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        throw new Error("You are not invited to this RFP.");
      }
    }
  }

  // Always re-fetch full RFP for narrative fields (server script may be stale-cached).
  try {
    const fresh = await getRfp(rfp.name);
    rfp = {
      ...rfp,
      scope_of_work: fresh.scope_of_work || rfp.scope_of_work,
      business_objective: fresh.business_objective || rfp.business_objective,
      technical_requirements:
        fresh.technical_requirements || rfp.technical_requirements,
      description: fresh.description || rfp.description,
      required_documents: fresh.required_documents.length
        ? fresh.required_documents
        : rfp.required_documents,
    };
  } catch {
    /* keep assignment payload */
  }

  let erpResponse: RfpResponse | null = null;
  try {
    const erpDoc = await findErpRfpResponse(rfp.name, erpSupplierId);
    if (erpDoc) erpResponse = mapErpRfpResponseDoc(erpDoc);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "ERP RFP Response load failed", err);
  }

  const localResponse = readAllRfpResponses().find(
    (r) =>
      r.rfp === rfpName &&
      supplierMatchKey(r.supplier) === supplierMatchKey(erpSupplierId),
  );

  let response =
    erpResponse?.status === "Submitted"
      ? erpResponse
      : localResponse?.status === "Submitted"
        ? localResponse
        : erpResponse ?? localResponse ?? null;

  if (!response) {
    const invite =
      rfp.suppliers.find(
        (s) =>
          supplierMatchKey(s.supplier) === supplierMatchKey(erpSupplierId),
      ) ?? {
        supplier: normalizeSupplierId(erpSupplierId),
        supplier_name: normalizeSupplierId(erpSupplierId),
      };
    const ts = nowIso();
    response = {
      id: generateId(),
      rfp: rfp.name,
      supplier: invite.supplier,
      supplier_name: invite.supplier_name,
      status: "Pending",
      proposal_description: "",
      documents: [],
      created_at: ts,
      modified: ts,
    };
  }

  upsertRfpResponse(response);
  return { rfp: mergeRfpWithEnrichment(rfp), response };
}

function pendingInviteRfpResponse(
  rfpName: string,
  invite: RfpSupplierInvite,
): RfpResponse {
  const ts = nowIso();
  return {
    id: `pending:${rfpName}:${invite.supplier}`,
    rfp: rfpName,
    supplier: invite.supplier,
    supplier_name: invite.supplier_name,
    status: "Pending",
    proposal_description: "",
    documents: [],
    documents_count: 0,
    created_at: ts,
    modified: ts,
  };
}

/**
 * Procurement Supplier Responses — live RFP Response DocType rows,
 * seeded with Pending placeholders for invited suppliers.
 */
export async function listRfpResponses(rfpName: string): Promise<RfpResponse[]> {
  let invites: RfpSupplierInvite[] = [];
  try {
    const rfp = await getRfp(rfpName);
    invites = rfp.suppliers ?? [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "listRfpResponses: could not load RFP invites", err);
  }

  let erpRows: RfpResponse[] = [];
  try {
    erpRows = await listErpRfpResponses(rfpName);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "listRfpResponses: ERP list failed", err);
  }

  const bySupplier = new Map<string, RfpResponse>();
  for (const row of erpRows) {
    const key = supplierMatchKey(row.supplier);
    if (!key) continue;
    const prev = bySupplier.get(key);
    if (!prev || (row.status === "Submitted" && prev.status !== "Submitted")) {
      bySupplier.set(key, row);
    }
  }

  // Same-browser fallback only — never the source of truth for procurement.
  for (const local of readAllRfpResponses().filter((r) => r.rfp === rfpName)) {
    const key = supplierMatchKey(local.supplier);
    if (!key) continue;
    const prev = bySupplier.get(key);
    if (!prev) bySupplier.set(key, local);
    else if (local.status === "Submitted" && prev.status !== "Submitted") {
      bySupplier.set(key, local);
    }
  }

  const result: RfpResponse[] = [];
  const seen = new Set<string>();
  for (const invite of invites) {
    const key = supplierMatchKey(invite.supplier);
    seen.add(key);
    result.push(
      bySupplier.get(key) ?? pendingInviteRfpResponse(rfpName, invite),
    );
  }
  for (const [key, row] of bySupplier) {
    if (!seen.has(key)) result.push(row);
  }

  return result.sort((a, b) =>
    (b.modified || "").localeCompare(a.modified || ""),
  );
}

export async function getRfpResponse(responseId: string): Promise<RfpResponse> {
  if (responseId.startsWith("pending:")) {
    const local = readAllRfpResponses().find((r) => r.id === responseId);
    if (local) return local;
    throw new Error("RFP response not found.");
  }

  try {
    const doc = await apiGet<ErpRfpResponseDoc>(
      buildResourceUrl(RFP_RESPONSE_DOCTYPE, responseId),
      withSilent(),
    );
    if (doc?.name) {
      const mapped = mapErpRfpResponseDoc(doc);
      upsertRfpResponse(mapped);
      return mapped;
    }
  } catch (err) {
    if (!isDocNotFoundError(err)) {
      // eslint-disable-next-line no-console
      console.warn(LOG, "getRfpResponse ERP load failed", err);
    }
  }

  const local = readAllRfpResponses().find((r) => r.id === responseId);
  if (!local) throw new Error("RFP response not found.");
  return local;
}

export async function submitRfpResponse(
  rfpName: string,
  supplierName: string,
  input: RfpSubmitResponseInput,
): Promise<RfpResponse> {
  const { rfp, response } = await getSupplierRfpAssignment(
    rfpName,
    supplierName,
  );

  if (rfp.status === "Closed") {
    throw new Error("This RFP is closed. Proposals are no longer accepted.");
  }
  if (response.status === "Submitted") {
    throw new Error("Proposal already submitted and cannot be edited.");
  }
  if (!input.proposal_description?.trim()) {
    throw new Error("Proposal description is required.");
  }

  for (const doc of rfp.required_documents) {
    if (!doc.required) continue;
    const uploaded = input.documents.find((d) => d.document_id === doc.id);
    if (!uploaded?.file?.file_url) {
      throw new Error(`Please upload: ${doc.label || doc.doc_type}`);
    }
  }

  const ts = nowIso();
  const supplierId = normalizeSupplierId(
    response.supplier ||
      (await resolvePortalSupplierIdForRfp(supplierName)) ||
      supplierName,
  );
  const draft: RfpResponse = {
    ...response,
    supplier: supplierId,
    supplier_name:
      normalizeSupplierId(response.supplier_name) ||
      supplierId,
    status: "Submitted",
    proposal_description: input.proposal_description.trim(),
    documents: input.documents,
    additional_comments: input.additional_comments?.trim() || "",
    submitted_at: ts,
    modified: ts,
  };

  let submitted: RfpResponse;
  try {
    submitted = await upsertErpRfpResponse(draft);
    await attachFilesToRfpResponse(submitted.id, input.documents);
    await updateRfpSupplierResponseRow(rfp.name, supplierId, {
      response_status: "Submitted",
      submitted_on: toErpDatetime(submitted.submitted_at || ts),
      documents_count: countUploadedDocs(input.documents),
      response_ref: submitted.id,
    });
    // eslint-disable-next-line no-console
    console.log(LOG, "RFP Response persisted to ERP", {
      rfp: rfp.name,
      supplier: supplierId,
      response: submitted.id,
      documents_count: countUploadedDocs(input.documents),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(LOG, "Failed to persist RFP Response to ERP", err);
    throw new Error(
      err instanceof Error
        ? err.message
        : "Could not save proposal response to ERPNext. Please try again.",
    );
  }

  upsertRfpResponse(submitted);

  // Persist list-meta so My RFPs history stays correct even before refetch.
  try {
    localStorage.setItem(
      `bidsphere:rfp-response-meta:${rfp.name}:${supplierId}`,
      JSON.stringify({
        status: "Submitted",
        submitted_at: submitted.submitted_at || ts,
        updated_at: ts,
      }),
    );
  } catch {
    /* ignore */
  }

  if (rfp.status === "Published") {
    try {
      await markRfpUnderReview(rfp.name);
    } catch {
      /* non-blocking */
    }
  }

  createNotification({
    title: "RFP Proposal Submitted",
    description: `${submitted.supplier_name} submitted a proposal for ${rfp.name}.`,
    module: "RFP",
    event_type: "rfp_response_submitted",
    target_role: "procurement",
    document_type: "RFP Response",
    document_name: submitted.id,
    route_path: `/sourcing/rfp/${encodeURIComponent(rfp.name)}/responses/${encodeURIComponent(submitted.id)}`,
  });

  return submitted;
}

export async function updateRfpResponseInternalNotes(
  responseId: string,
  notes: string,
): Promise<RfpResponse> {
  const existing = await getRfpResponse(responseId);
  return upsertRfpResponse({
    ...existing,
    internal_notes: notes,
    modified: nowIso(),
  });
}

export type UploadRfpFileOptions = {
  /** Attach File to this RFP (preferred over Supplier). */
  rfpName?: string;
  /** Optional Attach fieldname on the target document. */
  fieldname?: string;
};

/**
 * Upload an RFP supplier attachment to ERPNext File DocType.
 * Same commit-gated flow as RFI: upload → link → verify readable → return.
 */
export async function uploadRfpFile(
  file: File,
  supplierName: string,
  options?: UploadRfpFileOptions,
): Promise<RfpUploadedFile> {
  const uploaded_at = nowIso();
  const supplierId =
    (await resolvePortalSupplierIdForRfp(supplierName)) || supplierName;
  const rfpName = String(options?.rfpName || "").trim();
  const attachDoctype = rfpName ? RFP_DOCTYPE : "Supplier";
  const attachName = rfpName || supplierId;
  const rawField = String(options?.fieldname || "").trim();
  const fieldname =
    rawField && !rawField.startsWith("required_doc_") && !rawField.startsWith("question_")
      ? rawField
      : undefined;

  // eslint-disable-next-line no-console
  console.log("[RFP:upload] started", {
    file_name: file.name,
    file_size: file.size,
    supplier: supplierId,
    rfp: rfpName || null,
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
    console.log("[RFP:upload] response returned", {
      success: true,
      documentId: confirmed.file_id,
      fileUrl: confirmed.file_url,
      attachmentId: confirmed.file_id,
      file_name: confirmed.file_name,
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
    console.error("[RFP:upload] failed", { message, err });
    throw new Error(message);
  }
}

export async function getRfpStats(): Promise<{
  draft: number;
  published: number;
  underReview: number;
  closed: number;
  total: number;
}> {
  const all = await listRfps();
  return {
    draft: all.filter((r) => r.status === "Draft").length,
    published: all.filter((r) => r.status === "Published").length,
    underReview: all.filter((r) => r.status === "Under Review").length,
    closed: all.filter((r) => r.status === "Closed").length,
    total: all.length,
  };
}
