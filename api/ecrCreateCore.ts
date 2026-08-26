import { createHash } from "node:crypto";
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import {
  assertEcrProcurementRelationships,
  type EcrProcurementDocumentLoader,
} from "./ecrProcurementValidation.js";
import {
  requireRoles,
  type AccessPrincipal,
} from "./rbacAuth.js";

const ECR_DOCTYPE = "Engineering Change Request";
const MAX_AUTONAME_ATTEMPTS = 4;
const IDEMPOTENCY_FIELD = "bidsphere_create_idempotency_key";

export type EcrMasterReferenceKind =
  | "owner"
  | "department"
  | "plant"
  | "supplier"
  | "item";

export interface EcrMasterReferenceCandidate extends Record<string, unknown> {
  name?: string;
}

export type EcrMasterReferenceLoader = (
  kind: EcrMasterReferenceKind,
  value: string,
) => Promise<EcrMasterReferenceCandidate[]>;

export type InternalEcrCreatePrincipal = Extract<
  AccessPrincipal,
  { typ: "internal" }
>;

export interface CreatedEcrDocument extends Record<string, unknown> {
  name?: string;
  ecr_number?: string;
  ecr_owner?: string;
  select_pxfp?: string;
  docstatus?: number;
  approval_requirements?: unknown[];
  /** Transport metadata; never persisted in ERPNext. */
  create_replayed?: boolean;
}

export interface EcrCreateDependencies {
  company: string;
  loadMasterReferenceCandidates: EcrMasterReferenceLoader;
  loadProcurementDocument: EcrProcurementDocumentLoader;
  findEcrByIdempotencyKey: (key: string) => Promise<CreatedEcrDocument | null>;
  insertEcr: (payload: Record<string, unknown>) => Promise<CreatedEcrDocument>;
}

export class EcrCreateError extends Error {
  status: number;
  code: "validation" | "config" | "erp" | "conflict";
  fieldErrors?: Record<string, string>;
  details?: unknown;

  constructor(
    message: string,
    status = 400,
    code: EcrCreateError["code"] = "validation",
    options: {
      fieldErrors?: Record<string, string>;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "EcrCreateError";
    this.status = status;
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }
}

/** Internal signal used only when ERPNext's atomic naming series collides. */
export class EcrAutonameCollisionError extends Error {
  constructor(message = "ERPNext ECR autoname collision.") {
    super(message);
    this.name = "EcrAutonameCollisionError";
  }
}

const UI_CREATE_FIELDS = new Set([
  "ecr_title",
  "ecr_type",
  "priority",
  "ecr_owner",
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
  // Transport-only. The server scopes + hashes this before persistence.
  "idempotency_key",
]);

const SERVER_OWNED_FIELDS = new Set([
  "name",
  "doctype",
  "ecr_number",
  "amended_from",
  "status",
  "select_pxfp",
  "docstatus",
  "approval_requirements",
  "company",
  "owner",
  "creation",
  "modified",
  "modified_by",
  "idx",
  "parent",
  "parentfield",
  "parenttype",
  "purchase_requisition",
  "rfq",
  "supplier_quotation",
  "selected_supplier",
  "purchase_order",
  IDEMPOTENCY_FIELD,
]);

const CHILD_SERVER_OWNED_FIELDS = new Set([
  "name",
  "doctype",
  "owner",
  "creation",
  "modified",
  "modified_by",
  "docstatus",
  "idx",
  "parent",
  "parentfield",
  "parenttype",
]);

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validationError(fieldErrors: Record<string, string>): EcrCreateError {
  return new EcrCreateError(
    Object.values(fieldErrors)[0] || "Invalid ECR creation payload.",
    422,
    "validation",
    { fieldErrors },
  );
}

interface EcrMasterReferenceSpec {
  doctype: string;
  fields: string[];
  matchFields: string[];
  filters: unknown[];
}

const ECR_MASTER_REFERENCE_SPECS: Record<
  EcrMasterReferenceKind,
  EcrMasterReferenceSpec
> = {
  owner: {
    doctype: "User",
    fields: ["name", "email", "full_name", "enabled"],
    matchFields: ["name", "email", "full_name"],
    filters: [["enabled", "=", 1]],
  },
  department: {
    doctype: "Department",
    fields: ["name", "department_name", "company"],
    matchFields: ["name", "department_name"],
    filters: [],
  },
  plant: {
    doctype: "Plant Floor",
    fields: ["name", "floor_name", "company", "warehouse"],
    matchFields: ["name", "floor_name"],
    filters: [],
  },
  supplier: {
    doctype: "Supplier",
    fields: ["name", "supplier_name", "disabled"],
    matchFields: ["name", "supplier_name"],
    filters: [["disabled", "=", 0]],
  },
  item: {
    doctype: "Item",
    fields: ["name", "item_code", "item_name", "stock_uom", "disabled"],
    matchFields: ["name", "item_code", "item_name"],
    filters: [["disabled", "=", 0]],
  },
};

function isActiveMasterCandidate(
  kind: EcrMasterReferenceKind,
  candidate: EcrMasterReferenceCandidate,
): boolean {
  if (kind === "owner") {
    return candidate.enabled === 1 || candidate.enabled === "1" || candidate.enabled === true;
  }
  if (kind === "supplier" || kind === "item") {
    return candidate.disabled === 0 || candidate.disabled === "0" || candidate.disabled === false;
  }
  return true;
}

function canonicalMasterName(
  kind: EcrMasterReferenceKind,
  value: string,
  candidates: EcrMasterReferenceCandidate[],
): string | null {
  const normalizedValue = clean(value).toLowerCase();
  if (!normalizedValue) return null;

  const activeByName = new Map<string, EcrMasterReferenceCandidate>();
  for (const candidate of candidates) {
    const name = clean(candidate?.name);
    if (!name || !isActiveMasterCandidate(kind, candidate)) continue;
    activeByName.set(name.toLowerCase(), candidate);
  }

  const exactName = activeByName.get(normalizedValue);
  if (exactName) return clean(exactName.name);

  const spec = ECR_MASTER_REFERENCE_SPECS[kind];
  const matches = [...activeByName.values()].filter((candidate) =>
    spec.matchFields.some((field) =>
      clean(candidate[field]).toLowerCase() === normalizedValue
    )
  );
  return matches.length === 1 ? clean(matches[0]?.name) : null;
}

type MasterResolutionRequest = {
  field: string;
  kind: EcrMasterReferenceKind;
  value: string;
  missingMessage: string;
  unavailableMessage: string;
};

async function canonicalizeEcrMasterReferences(
  document: Record<string, unknown>,
  loadCandidates: EcrMasterReferenceLoader,
): Promise<Record<string, unknown>> {
  const owner = clean(document.ecr_owner);
  const department = clean(document.requesting_department);
  const plant = clean(document.plant);
  const supplier = clean(document.suggested_supplier);
  const parts = Array.isArray(document.affected_parts)
    ? document.affected_parts as Array<Record<string, unknown>>
    : [];
  const requests: MasterResolutionRequest[] = [
    {
      field: "ecr_owner",
      kind: "owner",
      value: owner,
      missingMessage: `Signed-in ERPNext user '${owner}' does not exist or is disabled.`,
      unavailableMessage: "Unable to validate the signed-in ERPNext user. Please try again.",
    },
    {
      field: "requesting_department",
      kind: "department",
      value: department,
      missingMessage: department
        ? `Department '${department}' does not exist. Please select a valid department.`
        : "Requesting Department is required.",
      unavailableMessage: "Unable to validate Requesting Department. Please try again.",
    },
    {
      field: "plant",
      kind: "plant",
      value: plant,
      missingMessage: plant
        ? `Plant Floor '${plant}' does not exist. Please select a valid plant.`
        : "Plant is required.",
      unavailableMessage: "Unable to validate Plant Floor. Please try again.",
    },
  ];
  if (supplier) {
    requests.push({
      field: "suggested_supplier",
      kind: "supplier",
      value: supplier,
      missingMessage: `Supplier '${supplier}' does not exist or is disabled. Please select a valid supplier.`,
      unavailableMessage: "Unable to validate Suggested Supplier. Please try again.",
    });
  }
  parts.forEach((part, index) => {
    const item = clean(part?.partitem);
    requests.push({
      field: `partitem.${index}`,
      kind: "item",
      value: item,
      missingMessage: item
        ? `Row #${index + 1}: Part/Item '${item}' does not exist or is disabled. Please select a valid item.`
        : `Row #${index + 1}: Part/Item is required.`,
      unavailableMessage: `Row #${index + 1}: Unable to validate Part/Item. Please try again.`,
    });
  });

  const lookupCache = new Map<string, Promise<EcrMasterReferenceCandidate[]>>();
  const resolutions = await Promise.all(requests.map(async (request) => {
    if (!request.value) return { request, canonical: null, unavailable: false };
    const cacheKey = `${request.kind}\0${request.value.toLowerCase()}`;
    let lookup = lookupCache.get(cacheKey);
    if (!lookup) {
      lookup = Promise.resolve().then(() =>
        loadCandidates(request.kind, request.value)
      );
      lookupCache.set(cacheKey, lookup);
    }
    try {
      const candidates = await lookup;
      return {
        request,
        canonical: canonicalMasterName(request.kind, request.value, candidates),
        unavailable: false,
      };
    } catch {
      return { request, canonical: null, unavailable: true };
    }
  }));

  const fieldErrors: Record<string, string> = {};
  const canonicalByField = new Map<string, string>();
  for (const resolution of resolutions) {
    if (!resolution.canonical) {
      fieldErrors[resolution.request.field] = resolution.unavailable
        ? resolution.request.unavailableMessage
        : resolution.request.missingMessage;
      continue;
    }
    canonicalByField.set(resolution.request.field, resolution.canonical);
  }
  if (Object.keys(fieldErrors).length > 0) throw validationError(fieldErrors);

  const canonical: Record<string, unknown> = {
    ...document,
    ecr_owner: canonicalByField.get("ecr_owner"),
    requesting_department: canonicalByField.get("requesting_department"),
    plant: canonicalByField.get("plant"),
    affected_parts: parts.map((part, index) => ({
      ...part,
      partitem: canonicalByField.get(`partitem.${index}`),
    })),
  };
  if (supplier) canonical.suggested_supplier = canonicalByField.get("suggested_supplier");
  return canonical;
}

function sanitizeChildRows(value: unknown, fieldname: string): unknown[] {
  if (!Array.isArray(value)) {
    throw validationError({ [fieldname]: `${fieldname} must be an array.` });
  }
  return value.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw validationError({
        [`${fieldname}.${index}`]: `${fieldname} row ${index + 1} must be an object.`,
      });
    }
    const record = row as Record<string, unknown>;
    const protectedFields = Object.keys(record).filter((field) =>
      CHILD_SERVER_OWNED_FIELDS.has(field),
    );
    if (protectedFields.length > 0) {
      throw validationError({
        [`${fieldname}.${index}`]:
          `Child-row workflow and audit fields are server-managed: ${protectedFields.join(", ")}.`,
      });
    }
    return { ...record };
  });
}

/**
 * Whitelist the existing CreateECRPayload fields while rejecting every field
 * owned by Frappe, the workflow, or downstream procurement automation.
 */
export function sanitizeEcrCreatePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError({ request: "ECR creation requires a JSON object." });
  }
  const record = payload as Record<string, unknown>;
  const protectedFields = Object.keys(record).filter((field) =>
    SERVER_OWNED_FIELDS.has(field),
  );
  if (protectedFields.length > 0) {
    throw validationError(Object.fromEntries(
      protectedFields.map((field) => [
        field,
        `${field} is server-managed and cannot be supplied when creating an ECR.`,
      ]),
    ));
  }

  const unsupportedFields = Object.keys(record).filter((field) =>
    !UI_CREATE_FIELDS.has(field),
  );
  if (unsupportedFields.length > 0) {
    throw validationError(Object.fromEntries(
      unsupportedFields.map((field) => [field, `${field} is not a supported ECR creation field.`]),
    ));
  }

  const sanitized: Record<string, unknown> = {};
  for (const field of UI_CREATE_FIELDS) {
    if (
      field === "ecr_owner" ||
      field === "idempotency_key" ||
      !Object.prototype.hasOwnProperty.call(record, field)
    ) {
      continue;
    }
    const value = record[field];
    if (value === undefined) continue;
    sanitized[field] = field === "affected_parts" || field === "supplier_response_requirements"
      ? sanitizeChildRows(value, field)
      : value;
  }
  return sanitized;
}

function scopedIdempotencyKey(
  payload: unknown,
  identity: string,
): string {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const raw = clean(record.idempotency_key);
  if (!raw) {
    throw validationError({
      idempotency_key: "An ECR creation idempotency key is required.",
    });
  }
  if (raw.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(raw)) {
    throw validationError({
      idempotency_key:
        "The ECR creation idempotency key must be 128 characters or fewer and contain only letters, numbers, '.', '_', ':', or '-'.",
    });
  }
  return createHash("sha256")
    .update(identity.toLowerCase())
    .update("\0")
    .update(raw)
    .digest("hex");
}

function normalizeCreatedEcr(
  created: CreatedEcrDocument,
  identity: string,
  replayed: boolean,
): CreatedEcrDocument {
  const name = clean(created?.name);
  if (!name) {
    throw new EcrCreateError(
      "ERPNext did not return the newly created ECR name.",
      502,
      "erp",
    );
  }
  const safe = { ...created };
  delete safe[IDEMPOTENCY_FIELD];
  return {
    ...safe,
    name,
    ecr_number: clean(created.ecr_number) || name,
    ecr_owner: clean(created.ecr_owner) || identity,
    create_replayed: replayed,
  };
}

function signedInIdentity(principal: InternalEcrCreatePrincipal): string {
  // ERP Link fields store User.name, which is the canonical token subject.
  // Email remains an alternate identity for ownership comparisons/display.
  const identity = clean(principal.sub) || clean(principal.email);
  if (!identity) {
    throw new EcrCreateError(
      "Unable to determine the signed-in ERPNext identity.",
      403,
      "validation",
    );
  }
  return identity.includes("@") ? identity.toLowerCase() : identity;
}

function extractErpMessage(payload: unknown, fallback: string): string {
  const value = (payload ?? {}) as {
    message?: string | { message?: string };
    exception?: string;
    exc_type?: string;
    _server_messages?: string;
  };
  if (value._server_messages) {
    try {
      const messages = JSON.parse(value._server_messages) as string[];
      const first = messages[0]
        ? JSON.parse(messages[0]) as { message?: string }
        : null;
      if (first?.message) return first.message;
    } catch {
      // Fall through to other Frappe error shapes.
    }
  }
  if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
  if (value.message && typeof value.message === "object" && value.message.message) {
    return value.message.message;
  }
  if (value.exception) return value.exception.replace(/^[^:]+:\s*/, "").trim();
  if (value.exc_type) return value.exc_type;
  return fallback;
}

function isDuplicateEntryError(error: unknown): boolean {
  if (!(error instanceof EcrCreateError)) return false;
  let detail = error.message;
  try {
    detail += ` ${JSON.stringify(error.details)}`;
  } catch {
    // The message alone is still sufficient for standard Frappe errors.
  }
  return /DuplicateEntryError|UniqueValidationError|duplicate\s+entry|duplicate\s+key|already\s+exists|must\s+be\s+unique|unique\s+constraint/i.test(detail);
}

type ErpConfig = { baseUrl: string; key: string; secret: string; company: string };

function readConfig(): ErpConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  ).trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  const company = (
    process.env.COMPANY ??
    process.env.VITE_COMPANY ??
    "Netlink"
  ).trim() || "Netlink";
  if (!baseUrl || !key || !secret) {
    throw new EcrCreateError(
      "ECR creation backend is missing ERPNext configuration.",
      500,
      "config",
    );
  }
  return { baseUrl, key, secret, company };
}

async function erpRequest<T>(
  config: ErpConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${config.baseUrl}/api/${path}`, {
    method,
    headers: {
      Authorization: `token ${config.key}:${config.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined
      ? undefined
      : JSON.stringify(sanitizeErpPayloadDates(body)),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new EcrCreateError(
      extractErpMessage(payload, text || `ERPNext request failed (${response.status}).`),
      response.status || 502,
      "erp",
      { details: payload },
    );
  }
  const envelope = payload as { data?: T; message?: T };
  return envelope.data !== undefined
    ? envelope.data
    : envelope.message !== undefined
      ? envelope.message
      : payload as T;
}

function createDefaultDependencies(): EcrCreateDependencies {
  const config = readConfig();
  const resource = (doctype: string, name?: string) =>
    `resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`;
  return {
    company: config.company,
    loadMasterReferenceCandidates: async (kind, value) => {
      const spec = ECR_MASTER_REFERENCE_SPECS[kind];
      const query = new URLSearchParams({
        fields: JSON.stringify(spec.fields),
        filters: JSON.stringify(spec.filters),
        or_filters: JSON.stringify(
          spec.matchFields.map((field) => [field, "=", value]),
        ),
        limit_page_length: "50",
      });
      return erpRequest<EcrMasterReferenceCandidate[]>(
        config,
        "GET",
        `${resource(spec.doctype)}?${query.toString()}`,
      );
    },
    loadProcurementDocument: (doctype, name) => erpRequest(
      config,
      "GET",
      resource(doctype, name),
    ),
    findEcrByIdempotencyKey: async (key) => {
      const query = new URLSearchParams({
        fields: JSON.stringify(["name"]),
        filters: JSON.stringify([[IDEMPOTENCY_FIELD, "=", key]]),
        limit_page_length: "1",
      });
      const rows = await erpRequest<Array<{ name?: string }>>(
        config,
        "GET",
        `${resource(ECR_DOCTYPE)}?${query.toString()}`,
      );
      const name = clean(rows?.[0]?.name);
      if (!name) return null;
      return erpRequest<CreatedEcrDocument>(
        config,
        "GET",
        resource(ECR_DOCTYPE, name),
      );
    },
    insertEcr: async (payload) => {
      try {
        return await erpRequest<CreatedEcrDocument>(
          config,
          "POST",
          resource(ECR_DOCTYPE),
          payload,
        );
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          throw new EcrAutonameCollisionError(
            error instanceof Error ? error.message : undefined,
          );
        }
        throw error;
      }
    },
  };
}

/**
 * Trusted Draft creation. ERPNext's disjoint `ECR-.YYYY.-1.#####` autoname is the
 * atomic business-number allocator; no browser-supplied or scan/max number is
 * accepted. A rare naming-series collision is retried at the unique boundary.
 */
export async function createEcrDraftCore(
  input: {
    payload: unknown;
    principal: InternalEcrCreatePrincipal;
  },
  dependencies?: EcrCreateDependencies,
): Promise<CreatedEcrDocument> {
  requireRoles(input.principal, ["engineer", "admin"]);
  const deps = dependencies ?? createDefaultDependencies();
  const identity = signedInIdentity(input.principal);
  const idempotencyKey = scopedIdempotencyKey(input.payload, identity);
  const payload = sanitizeEcrCreatePayload(input.payload);
  const existing = await deps.findEcrByIdempotencyKey(idempotencyKey);
  if (existing) return normalizeCreatedEcr(existing, identity, true);
  const unvalidatedDocument: Record<string, unknown> = {
    ...payload,
    ecr_owner: identity,
    company: deps.company,
    status: "Draft",
    select_pxfp: "Draft",
    docstatus: 0,
    approval_requirements: [],
    [IDEMPOTENCY_FIELD]: idempotencyKey,
  };
  const document = await canonicalizeEcrMasterReferences(
    unvalidatedDocument,
    deps.loadMasterReferenceCandidates,
  );
  const canonicalOwner = clean(document.ecr_owner) || identity;

  await assertEcrProcurementRelationships(document, deps.loadProcurementDocument);

  for (let attempt = 1; attempt <= MAX_AUTONAME_ATTEMPTS; attempt += 1) {
    try {
      const created = await deps.insertEcr(document);
      return normalizeCreatedEcr(created, canonicalOwner, false);
    } catch (error) {
      if (!(error instanceof EcrAutonameCollisionError)) throw error;
      const replay = await deps.findEcrByIdempotencyKey(idempotencyKey);
      if (replay) return normalizeCreatedEcr(replay, canonicalOwner, true);
      if (attempt === MAX_AUTONAME_ATTEMPTS) {
        throw new EcrCreateError(
          "Unable to allocate a unique ECR business number. Please try again.",
          409,
          "conflict",
        );
      }
    }
  }

  throw new EcrCreateError(
    "Unable to allocate a unique ECR business number. Please try again.",
    409,
    "conflict",
  );
}
