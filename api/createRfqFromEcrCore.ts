import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import type { InternalEcrPrincipal } from "./ecrWorkflowCore.js";
import {
  canonicalApprovalRole,
  canonicalWorkflowStatus,
} from "./ecrWorkflowPolicy.js";

const ECR_DOCTYPE = "Engineering Change Request";
const RFQ_DOCTYPE = "Request for Quotation";
export const ECR_RFQ_IDEMPOTENCY_FIELD = "custom_bidsphere_ecr_idempotency_key";

type EcrAffectedPart = {
  partitem?: string;
  part_description?: string;
  quantity?: number;
  uom?: string;
  plant?: string;
  change_required?: string;
  technical_notes?: string;
};

export type EcrApprovalRow = Record<string, unknown> & {
  name?: string;
  doctype?: string;
  approval_role?: string;
  approver?: string;
  required?: number;
  status?: string;
  approval_date?: string;
  comments?: string;
};

export interface DirectRfqSourceEcr extends Record<string, unknown> {
  name: string;
  modified?: string;
  docstatus?: number;
  select_pxfp?: string;
  status?: string;
  ecr_number?: string;
  ecr_title?: string;
  plant?: string;
  target_implementation_date?: string;
  supplier_response_required?: string;
  suggested_supplier?: string;
  procurement_reference_type?: string;
  existing_rfq_reference?: string;
  existing_purchase_order_reference?: string;
  purchase_requisition?: string;
  rfq?: string;
  purchase_order?: string;
  affected_parts?: EcrAffectedPart[];
  approval_requirements?: EcrApprovalRow[];
}

export interface DirectRfqTrace extends Record<string, unknown> {
  name: string;
  docstatus?: number;
  status?: string;
  custom_ecr_reference?: string;
  custom_bidsphere_ecr_idempotency_key?: string;
}

export interface CreateRfqFromEcrInput {
  ecrName: unknown;
  principal: InternalEcrPrincipal;
}

export interface CreateRfqFromEcrResult {
  success: true;
  newStatus: "RFQ";
  rfqName: string;
  created: boolean;
  replayed: boolean;
  message: string;
  approvalRequirements: EcrApprovalRow[];
}

export class CreateRfqFromEcrError extends Error {
  status: number;
  code: "validation" | "conflict" | "erp" | "config" | "partial";
  rfqName?: string;
  fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status = 400,
    code: CreateRfqFromEcrError["code"] = "validation",
    options: { rfqName?: string; fieldErrors?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "CreateRfqFromEcrError";
    this.status = status;
    this.code = code;
    this.rfqName = options.rfqName;
    this.fieldErrors = options.fieldErrors;
  }
}

class RfqIdempotencyCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RfqIdempotencyCollisionError";
  }
}

export interface CreateRfqFromEcrDependencies {
  loadEcr: (name: string) => Promise<DirectRfqSourceEcr>;
  loadRfq: (name: string) => Promise<DirectRfqTrace>;
  findRfqCandidates: (ecrName: string) => Promise<DirectRfqTrace[]>;
  assertSupplierExists: (name: string) => Promise<void>;
  resolveCompanyForPlant: (name: string) => Promise<string>;
  createRfq: (payload: Record<string, unknown>) => Promise<DirectRfqTrace>;
  updateRfq: (
    name: string,
    payload: Record<string, unknown>,
  ) => Promise<DirectRfqTrace>;
  commitEcrRfqTransition: (
    current: DirectRfqSourceEcr,
    rfqName: string,
    approvalRequirements: EcrApprovalRow[],
  ) => Promise<DirectRfqSourceEcr>;
  today: () => string;
  now: () => string;
}

type ErpConfig = { baseUrl: string; key: string; secret: string };

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function requestName(value: unknown): string {
  if (typeof value !== "string") {
    throw new CreateRfqFromEcrError("Engineering Change Request must be text.", 422);
  }
  const name = clean(value);
  if (!name) throw new CreateRfqFromEcrError("Engineering Change Request is required.", 422);
  if (name.length > 140) {
    throw new CreateRfqFromEcrError(
      "Engineering Change Request must be 140 characters or fewer.",
      422,
    );
  }
  return name;
}

function assertAuthorizedPrincipal(principal: InternalEcrPrincipal): void {
  if (!principal || principal.typ !== "internal") {
    throw new CreateRfqFromEcrError("Internal authentication is required.", 401);
  }
  if (principal.role !== "procurement") {
    throw new CreateRfqFromEcrError(
      "Only Procurement Manager can create an RFQ from an ECR.",
      403,
    );
  }
}

function readConfig(): ErpConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  ).trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!baseUrl || !key || !secret) {
    throw new CreateRfqFromEcrError(
      "Direct ECR RFQ creation backend is missing ERPNext configuration.",
      500,
      "config",
    );
  }
  return { baseUrl, key, secret };
}

function extractErpMessage(payload: unknown, fallback: string): string {
  const value = (payload ?? {}) as {
    message?: string | { message?: string };
    exception?: string;
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
      // Fall through to other ERPNext error shapes.
    }
  }
  if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
  if (value.message && typeof value.message === "object" && value.message.message) {
    return value.message.message;
  }
  if (value.exception) return value.exception.replace(/^[^:]+:\s*/, "").trim();
  return fallback;
}

async function erpRequest<T>(
  config: ErpConfig,
  method: string,
  path: string,
  options: { body?: unknown; search?: Record<string, string> } = {},
): Promise<T> {
  const query = options.search
    ? `?${new URLSearchParams(options.search).toString()}`
    : "";
  const response = await fetch(`${config.baseUrl}/api/${path}${query}`, {
    method,
    headers: {
      Authorization: `token ${config.key}:${config.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: options.body === undefined
      ? undefined
      : JSON.stringify(sanitizeErpPayloadDates(options.body)),
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
    const message = extractErpMessage(
      payload,
      text || `ERPNext request failed (${response.status}).`,
    );
    if (
      /custom_bidsphere_ecr_idempotency_key|BidSphere ECR Idempotency/i.test(message) &&
      /DuplicateEntryError|UniqueValidationError|duplicate|unique/i.test(message)
    ) {
      throw new RfqIdempotencyCollisionError(message);
    }
    const conflict = /TimestampMismatchError|document has been modified|please refresh/i.test(message);
    throw new CreateRfqFromEcrError(
      message,
      conflict ? 409 : response.status || 502,
      conflict ? "conflict" : "erp",
    );
  }
  const envelope = payload as { data?: T; message?: T };
  return envelope.data !== undefined
    ? envelope.data
    : envelope.message !== undefined
      ? envelope.message
      : payload as T;
}

function createDefaultDependencies(): CreateRfqFromEcrDependencies {
  const config = readConfig();
  const resource = (doctype: string, name?: string) =>
    `resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`;
  const listRfqs = (filters: unknown[]) => erpRequest<DirectRfqTrace[]>(
    config,
    "GET",
    resource(RFQ_DOCTYPE),
    {
      search: {
        filters: JSON.stringify(filters),
        fields: JSON.stringify([
          "name",
          "docstatus",
          "status",
          "custom_ecr_reference",
          ECR_RFQ_IDEMPOTENCY_FIELD,
        ]),
        limit_page_length: "3",
      },
    },
  );
  return {
    loadEcr: async (name) => {
      try {
        return await erpRequest<DirectRfqSourceEcr>(
          config,
          "GET",
          resource(ECR_DOCTYPE, name),
        );
      } catch (error) {
        const rows = await erpRequest<Array<Pick<DirectRfqSourceEcr, "name">>>(
          config,
          "GET",
          resource(ECR_DOCTYPE),
          {
            search: {
              filters: JSON.stringify([["ecr_number", "=", name]]),
              fields: JSON.stringify(["name"]),
              limit_page_length: "2",
            },
          },
        ).catch(() => []);
        if (rows.length === 1 && rows[0]?.name) {
          return erpRequest<DirectRfqSourceEcr>(
            config,
            "GET",
            resource(ECR_DOCTYPE, rows[0].name),
          );
        }
        throw error;
      }
    },
    loadRfq: (name) => erpRequest(config, "GET", resource(RFQ_DOCTYPE, name)),
    findRfqCandidates: async (ecrName) => {
      const [byKey, byReference] = await Promise.all([
        listRfqs([[ECR_RFQ_IDEMPOTENCY_FIELD, "=", ecrName]]),
        listRfqs([["custom_ecr_reference", "=", ecrName]]),
      ]);
      return [...new Map(
        [...byKey, ...byReference]
          .filter((row) => clean(row.name))
          .map((row) => [clean(row.name), row]),
      ).values()];
    },
    assertSupplierExists: async (name) => {
      await erpRequest(config, "GET", resource("Supplier", name));
    },
    resolveCompanyForPlant: async (name) => {
      const plant = await erpRequest<{ company?: string }>(
        config,
        "GET",
        resource("Plant Floor", name),
      );
      return clean(plant.company);
    },
    createRfq: (payload) => erpRequest(
      config,
      "POST",
      resource(RFQ_DOCTYPE),
      { body: payload },
    ),
    updateRfq: (name, payload) => erpRequest(
      config,
      "PUT",
      resource(RFQ_DOCTYPE, name),
      { body: payload },
    ),
    commitEcrRfqTransition: (current, rfqName, approvalRequirements) => {
      if (!clean(current.modified)) {
        throw new CreateRfqFromEcrError(
          `ECR ${current.name} is missing its optimistic-lock timestamp.`,
          409,
          "conflict",
          { rfqName },
        );
      }
      return erpRequest<DirectRfqSourceEcr>(
        config,
        "POST",
        "method/frappe.client.save",
        {
          body: {
            doc: {
              ...current,
              doctype: ECR_DOCTYPE,
              name: current.name,
              modified: current.modified,
              rfq: rfqName,
              select_pxfp: "RFQ",
              ...(Object.prototype.hasOwnProperty.call(current, "status")
                ? { status: "RFQ" }
                : {}),
              docstatus: 1,
              approval_requirements: approvalRequirements,
            },
          },
        },
      );
    },
    today: () => new Date().toISOString().slice(0, 10),
    now: () => new Date().toISOString().slice(0, 19).replace("T", " "),
  };
}

function isActiveRfq(rfq: DirectRfqTrace): boolean {
  return [0, 1].includes(Number(rfq.docstatus)) &&
    !["cancelled", "canceled", "rejected"].includes(clean(rfq.status).toLowerCase());
}

function assertRfqBelongsToEcr(rfq: DirectRfqTrace, ecrName: string): void {
  if (!clean(rfq.name) || !isActiveRfq(rfq)) {
    throw new CreateRfqFromEcrError(
      `RFQ ${clean(rfq.name) || "record"} is missing, cancelled, rejected, or inactive.`,
      409,
      "conflict",
      { rfqName: clean(rfq.name) || undefined },
    );
  }
  const reference = clean(rfq.custom_ecr_reference);
  const key = clean(rfq[ECR_RFQ_IDEMPOTENCY_FIELD]);
  if (reference && reference !== ecrName) {
    throw new CreateRfqFromEcrError(
      `RFQ ${rfq.name} belongs to ECR ${reference}, not ${ecrName}.`,
      409,
      "conflict",
      { rfqName: rfq.name },
    );
  }
  if (key && key !== ecrName) {
    throw new CreateRfqFromEcrError(
      `RFQ ${rfq.name} has conflicting ECR idempotency traceability.`,
      409,
      "conflict",
      { rfqName: rfq.name },
    );
  }
}

function oneCandidate(
  candidates: DirectRfqTrace[],
  ecrName: string,
): DirectRfqTrace | null {
  const unique = [...new Map(
    candidates
      .filter((candidate) => clean(candidate.name))
      .map((candidate) => [clean(candidate.name), candidate]),
  ).values()];
  if (unique.length > 1) {
    throw new CreateRfqFromEcrError(
      `ECR ${ecrName} is linked to multiple RFQs (${unique.map((row) => row.name).join(", ")}). Resolve the duplicate records before retrying.`,
      409,
      "conflict",
    );
  }
  return unique[0] ?? null;
}

function approvalTaskSignature(row: EcrApprovalRow): Record<string, unknown> {
  return {
    name: clean(row.name),
    doctype: clean(row.doctype),
    approval_role: clean(row.approval_role),
    approver: clean(row.approver),
    required: Number(row.required || 0),
    status: clean(row.status),
    approval_date: clean(row.approval_date),
    comments: clean(row.comments),
  };
}

function sameApprovalTasks(
  expected: EcrApprovalRow[],
  actual?: EcrApprovalRow[],
): boolean {
  if (!Array.isArray(actual) || expected.length !== actual.length) return false;
  return JSON.stringify(expected.map(approvalTaskSignature)) ===
    JSON.stringify(actual.map(approvalTaskSignature));
}

function pendingApprovalTasks(ecr: DirectRfqSourceEcr): EcrApprovalRow[] {
  return (Array.isArray(ecr.approval_requirements)
    ? ecr.approval_requirements
    : []).filter((row) => clean(row.status).toUpperCase() === "PENDING");
}

function hasCompletedProcurementManagerTask(ecr: DirectRfqSourceEcr): boolean {
  return (Array.isArray(ecr.approval_requirements)
    ? ecr.approval_requirements
    : []).some((row) =>
      canonicalApprovalRole(clean(row.approval_role)) === "Procurement Manager" &&
      clean(row.status).toUpperCase() === "COMPLETED"
    );
}

function completeProcurementManagerTask(
  ecr: DirectRfqSourceEcr,
  principal: InternalEcrPrincipal,
  rfqName: string,
  timestamp: string,
): EcrApprovalRow[] {
  const rows = Array.isArray(ecr.approval_requirements)
    ? ecr.approval_requirements
    : [];
  const pending = pendingApprovalTasks(ecr);
  const task = pending[0];
  if (
    pending.length !== 1 ||
    canonicalApprovalRole(clean(task?.approval_role)) !== "Procurement Manager" ||
    Number(task?.required || 0) !== 1
  ) {
    throw new CreateRfqFromEcrError(
      "The ECR must have exactly one active Procurement Manager task before an RFQ can be created.",
      409,
      "conflict",
    );
  }
  const actor = clean(principal.sub) || clean(principal.email);
  return rows.map((row) => row === task
    ? {
        ...row,
        doctype: clean(row.doctype) || "ECR Approval",
        approval_role: "Procurement Manager",
        approver: actor,
        required: 1,
        status: "Completed",
        approval_date: timestamp,
        comments: `RFQ ${rfqName} created.`,
      }
    : row);
}

function validateEcrForDirectRfq(ecr: DirectRfqSourceEcr): void {
  const state = canonicalWorkflowStatus(clean(ecr.select_pxfp));
  if (!["RFQ Pending", "RFQ"].includes(state)) {
    throw new CreateRfqFromEcrError(
      `ECR must be in RFQ Pending before creating an RFQ. Current state: ${state || "Draft"}.`,
      409,
      "conflict",
    );
  }
  const validDocstatuses = state === "RFQ" ? [1] : [0, 1];
  if (!validDocstatuses.includes(Number(ecr.docstatus))) {
    throw new CreateRfqFromEcrError(
      state === "RFQ Pending"
        ? "ECR must be an active draft or a submitted legacy record until the Procurement Manager creates the RFQ."
        : "An ECR in RFQ stage must be submitted and active.",
      409,
      "conflict",
    );
  }
  if (!clean(ecr.modified)) {
    throw new CreateRfqFromEcrError(
      "ERPNext did not return an optimistic-lock timestamp for this ECR.",
      409,
      "conflict",
    );
  }
  const pendingTasks = pendingApprovalTasks(ecr);
  if (state === "RFQ Pending") {
    if (
      pendingTasks.length !== 1 ||
      canonicalApprovalRole(clean(pendingTasks[0]?.approval_role)) !== "Procurement Manager" ||
      Number(pendingTasks[0]?.required || 0) !== 1
    ) {
      throw new CreateRfqFromEcrError(
        "The ECR must have exactly one active Procurement Manager task before an RFQ can be created.",
        409,
        "conflict",
      );
    }
  } else if (pendingTasks.length > 0) {
    throw new CreateRfqFromEcrError(
      "An ECR in RFQ stage must not have an active workflow task.",
      409,
      "conflict",
    );
  }
  if (clean(ecr.supplier_response_required) !== "Yes") {
    throw new CreateRfqFromEcrError(
      "Supplier Required must be Yes before creating an RFQ.",
      422,
      "validation",
      { fieldErrors: { supplier_response_required: "Supplier Required must be Yes." } },
    );
  }
  if (!clean(ecr.suggested_supplier)) {
    throw new CreateRfqFromEcrError(
      "Suggested Supplier is required before creating an RFQ.",
      422,
      "validation",
      { fieldErrors: { suggested_supplier: "Suggested Supplier is required." } },
    );
  }
  // `existing_*_reference` fields identify source documents from which ECR
  // parts were selected. They are provenance, not downstream RFQ/PO output.
  if (clean(ecr.purchase_order)) {
    throw new CreateRfqFromEcrError(
      "An RFQ cannot be created because this ECR already references a Purchase Order.",
      409,
      "conflict",
    );
  }
  if (clean(ecr.purchase_requisition) && !clean(ecr.rfq)) {
    throw new CreateRfqFromEcrError(
      `ECR ${ecr.name} is explicitly configured through Purchase Requisition ${clean(ecr.purchase_requisition)}. Use the PR-based RFQ flow.`,
      409,
      "conflict",
    );
  }
}

function buildRfqPayload(
  ecr: DirectRfqSourceEcr,
  today: string,
  company: string,
): Record<string, unknown> {
  const errors: Record<string, string> = {};
  const scheduleDate = clean(ecr.target_implementation_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
    errors.target_implementation_date = "A valid target implementation date is required.";
  }
  const parts = Array.isArray(ecr.affected_parts) ? ecr.affected_parts : [];
  if (parts.length === 0) errors.affected_parts = "At least one affected part is required.";
  const items = parts.map((part, index) => {
    const itemCode = clean(part.partitem);
    const quantity = Number(part.quantity);
    const uom = clean(part.uom);
    if (!itemCode) errors[`affected_parts.${index}.partitem`] = "Item / Part is required.";
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors[`affected_parts.${index}.quantity`] = "Quantity must be greater than zero.";
    }
    if (!uom) errors[`affected_parts.${index}.uom`] = "UOM is required.";
    return {
      item_code: itemCode,
      description: clean(part.part_description) ||
        [clean(part.change_required), clean(part.technical_notes)].filter(Boolean).join("\n"),
      qty: quantity,
      uom,
      schedule_date: scheduleDate,
    };
  });
  if (Object.keys(errors).length > 0) {
    throw new CreateRfqFromEcrError(
      Object.values(errors)[0],
      422,
      "validation",
      { fieldErrors: errors },
    );
  }
  return {
    company,
    title: `RFQ for ${clean(ecr.ecr_title) || clean(ecr.ecr_number) || ecr.name}`,
    transaction_date: today,
    schedule_date: scheduleDate,
    suppliers: [{ supplier: clean(ecr.suggested_supplier) }],
    items,
    custom_ecr_reference: ecr.name,
    [ECR_RFQ_IDEMPOTENCY_FIELD]: ecr.name,
  };
}

async function ensureRfqTrace(
  rfq: DirectRfqTrace,
  ecrName: string,
  dependencies: CreateRfqFromEcrDependencies,
): Promise<DirectRfqTrace> {
  assertRfqBelongsToEcr(rfq, ecrName);
  const patch: Record<string, unknown> = {};
  if (!clean(rfq.custom_ecr_reference)) patch.custom_ecr_reference = ecrName;
  if (!clean(rfq[ECR_RFQ_IDEMPOTENCY_FIELD])) {
    patch[ECR_RFQ_IDEMPOTENCY_FIELD] = ecrName;
  }
  if (Object.keys(patch).length === 0) return rfq;
  try {
    await dependencies.updateRfq(rfq.name, patch);
    const verified = await dependencies.loadRfq(rfq.name);
    assertRfqBelongsToEcr(verified, ecrName);
    if (
      clean(verified.custom_ecr_reference) !== ecrName ||
      clean(verified[ECR_RFQ_IDEMPOTENCY_FIELD]) !== ecrName
    ) {
      throw new CreateRfqFromEcrError(
        `RFQ ${rfq.name} traceability could not be verified.`,
        409,
        "partial",
        { rfqName: rfq.name },
      );
    }
    return verified;
  } catch (error) {
    if (error instanceof CreateRfqFromEcrError) throw error;
    const candidate = oneCandidate(
      await dependencies.findRfqCandidates(ecrName),
      ecrName,
    );
    if (candidate?.name === rfq.name) {
      assertRfqBelongsToEcr(candidate, ecrName);
      return candidate;
    }
    throw new CreateRfqFromEcrError(
      `RFQ ${rfq.name} exists, but its ECR traceability could not be repaired.`,
      409,
      "partial",
      { rfqName: rfq.name },
    );
  }
}

async function resolveOrCreateRfq(
  ecr: DirectRfqSourceEcr,
  dependencies: CreateRfqFromEcrDependencies,
): Promise<{ rfq: DirectRfqTrace; created: boolean }> {
  const linkedName = clean(ecr.rfq);
  const candidate = oneCandidate(
    await dependencies.findRfqCandidates(ecr.name),
    ecr.name,
  );
  if (linkedName) {
    const linked = await dependencies.loadRfq(linkedName).catch(() => null);
    if (!linked) {
      throw new CreateRfqFromEcrError(
        `ECR ${ecr.name} references missing RFQ ${linkedName}.`,
        409,
        "conflict",
        { rfqName: linkedName },
      );
    }
    if (candidate && candidate.name !== linkedName) {
      throw new CreateRfqFromEcrError(
        `ECR ${ecr.name} references ${linkedName}, but idempotency traceability points to ${candidate.name}.`,
        409,
        "conflict",
      );
    }
    return {
      rfq: await ensureRfqTrace(linked, ecr.name, dependencies),
      created: false,
    };
  }
  if (candidate) {
    return {
      rfq: await ensureRfqTrace(candidate, ecr.name, dependencies),
      created: false,
    };
  }
  if (canonicalWorkflowStatus(clean(ecr.select_pxfp)) !== "RFQ Pending") {
    throw new CreateRfqFromEcrError(
      `ECR ${ecr.name} is already in RFQ state but has no persisted RFQ traceability.`,
      409,
      "conflict",
    );
  }

  const supplier = clean(ecr.suggested_supplier);
  try {
    // Resolve the persisted Link value exactly as stored on the ECR. The
    // request body is intentionally unable to supply or "correct" a supplier.
    await dependencies.assertSupplierExists(supplier);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const missing = (error instanceof CreateRfqFromEcrError && error.status === 404) ||
      /DoesNotExistError|does not exist|not found/i.test(message);
    if (!missing) throw error;
    const fieldMessage = `Supplier ${JSON.stringify(supplier)} does not exist in ERPNext. Correct Suggested Supplier on the ECR before retrying.`;
    throw new CreateRfqFromEcrError(
      fieldMessage,
      422,
      "validation",
      { fieldErrors: { suggested_supplier: fieldMessage } },
    );
  }
  const plant = clean(ecr.plant);
  if (!plant) {
    const fieldMessage = "Plant is required to resolve the RFQ company.";
    throw new CreateRfqFromEcrError(
      fieldMessage,
      422,
      "validation",
      { fieldErrors: { plant: fieldMessage } },
    );
  }
  const company = clean(await dependencies.resolveCompanyForPlant(plant));
  if (!company) {
    const fieldMessage = `Plant Floor ${JSON.stringify(plant)} does not define a company.`;
    throw new CreateRfqFromEcrError(
      fieldMessage,
      422,
      "validation",
      { fieldErrors: { plant: fieldMessage } },
    );
  }

  let created: DirectRfqTrace;
  try {
    created = await dependencies.createRfq(
      buildRfqPayload(ecr, dependencies.today(), company),
    );
  } catch (error) {
    if (!(error instanceof RfqIdempotencyCollisionError)) throw error;
    const raced = oneCandidate(
      await dependencies.findRfqCandidates(ecr.name),
      ecr.name,
    );
    if (!raced) {
      throw new CreateRfqFromEcrError(
        "ERPNext reported an ECR RFQ idempotency collision, but the existing RFQ could not be loaded.",
        409,
        "conflict",
      );
    }
    return {
      rfq: await ensureRfqTrace(raced, ecr.name, dependencies),
      created: false,
    };
  }
  return {
    rfq: await ensureRfqTrace(created, ecr.name, dependencies),
    created: true,
  };
}

async function ensureEcrRfqState(
  ecr: DirectRfqSourceEcr,
  rfqName: string,
  principal: InternalEcrPrincipal,
  dependencies: CreateRfqFromEcrDependencies,
): Promise<DirectRfqSourceEcr> {
  const linked = clean(ecr.rfq);
  const hasPersistedStatusField = Object.prototype.hasOwnProperty.call(
    ecr,
    "status",
  );
  if (linked && linked !== rfqName) {
    throw new CreateRfqFromEcrError(
      `ECR ${ecr.name} already references RFQ ${linked}.`,
      409,
      "conflict",
      { rfqName: linked },
    );
  }
  if (canonicalWorkflowStatus(clean(ecr.select_pxfp)) === "RFQ" && linked === rfqName) {
    if (pendingApprovalTasks(ecr).length > 0) {
      throw new CreateRfqFromEcrError(
        "An ECR in RFQ stage must not have an active workflow task.",
        409,
        "conflict",
        { rfqName },
      );
    }
    if (!hasPersistedStatusField || clean(ecr.status) === "RFQ") return ecr;
    const synchronized = await dependencies.commitEcrRfqTransition(
      ecr,
      rfqName,
      Array.isArray(ecr.approval_requirements) ? ecr.approval_requirements : [],
    );
    if (
      clean(synchronized.select_pxfp) !== "RFQ" ||
      (hasPersistedStatusField && clean(synchronized.status) !== "RFQ") ||
      clean(synchronized.rfq) !== rfqName ||
      pendingApprovalTasks(synchronized).length > 0
    ) {
      throw new CreateRfqFromEcrError(
        `ERPNext did not synchronize ECR status with RFQ ${rfqName}.`,
        409,
        "partial",
        { rfqName },
      );
    }
    return synchronized;
  }
  if (canonicalWorkflowStatus(clean(ecr.select_pxfp)) !== "RFQ Pending") {
    throw new CreateRfqFromEcrError(
      `ECR ${ecr.name} cannot move to RFQ from ${clean(ecr.select_pxfp) || "Draft"}.`,
      409,
      "conflict",
      { rfqName },
    );
  }
  const approvalRequirements = completeProcurementManagerTask(
    ecr,
    principal,
    rfqName,
    dependencies.now(),
  );
  try {
    const updated = await dependencies.commitEcrRfqTransition(
      ecr,
      rfqName,
      approvalRequirements,
    );
    if (
      clean(updated.select_pxfp) !== "RFQ" ||
      (hasPersistedStatusField && clean(updated.status) !== "RFQ") ||
      clean(updated.rfq) !== rfqName ||
      Number(updated.docstatus) !== 1 ||
      pendingApprovalTasks(updated).length !== 0 ||
      !hasCompletedProcurementManagerTask(updated) ||
      !sameApprovalTasks(approvalRequirements, updated.approval_requirements)
    ) {
      throw new CreateRfqFromEcrError(
        `ERPNext did not atomically persist RFQ ${rfqName}, the ECR RFQ stage, and the completed Procurement Manager task.`,
        409,
        "partial",
        { rfqName },
      );
    }
    return updated;
  } catch (error) {
    const concurrent = await dependencies.loadEcr(ecr.name).catch(() => null);
    if (
      clean(concurrent?.select_pxfp) === "RFQ" &&
      (!hasPersistedStatusField || clean(concurrent?.status) === "RFQ") &&
      clean(concurrent?.rfq) === rfqName &&
      Number(concurrent?.docstatus) === 1 &&
      pendingApprovalTasks(concurrent).length === 0 &&
      hasCompletedProcurementManagerTask(concurrent)
    ) {
      return concurrent;
    }
    if (error instanceof CreateRfqFromEcrError && error.code === "partial") {
      throw error;
    }
    throw new CreateRfqFromEcrError(
      `RFQ ${rfqName} exists, but the ECR RFQ link and workflow stage could not be committed. Retry to complete the handoff.`,
      409,
      "partial",
      { rfqName },
    );
  }
}

async function runCreateRfqFromEcr(
  input: CreateRfqFromEcrInput,
  dependencies: CreateRfqFromEcrDependencies,
): Promise<CreateRfqFromEcrResult> {
  assertAuthorizedPrincipal(input.principal);
  const requestedName = requestName(input.ecrName);
  const ecr = await dependencies.loadEcr(requestedName);
  if (!clean(ecr.name)) {
    throw new CreateRfqFromEcrError(
      "ERPNext returned an invalid Engineering Change Request.",
      502,
      "erp",
    );
  }
  validateEcrForDirectRfq(ecr);
  const resolved = await resolveOrCreateRfq(ecr, dependencies);
  const updatedEcr = await ensureEcrRfqState(
    ecr,
    resolved.rfq.name,
    input.principal,
    dependencies,
  );
  return {
    success: true,
    newStatus: "RFQ",
    rfqName: resolved.rfq.name,
    created: resolved.created,
    replayed: !resolved.created,
    message: resolved.created
      ? `RFQ ${resolved.rfq.name} created successfully.`
      : `RFQ ${resolved.rfq.name} is already linked to this ECR.`,
    approvalRequirements: Array.isArray(updatedEcr.approval_requirements)
      ? updatedEcr.approval_requirements
      : [],
  };
}

const inFlight = new Map<string, Promise<CreateRfqFromEcrResult>>();

export async function createRfqFromEcrCore(
  input: CreateRfqFromEcrInput,
  dependencies?: CreateRfqFromEcrDependencies,
): Promise<CreateRfqFromEcrResult> {
  // Authenticate and validate before consulting the shared in-flight map so
  // an unauthorized request cannot piggyback on an authorized operation.
  assertAuthorizedPrincipal(input.principal);
  const key = requestName(input.ecrName);
  const normalizedInput = { ...input, ecrName: key };
  const current = inFlight.get(key);
  if (current) {
    const result = await current;
    return {
      ...result,
      created: false,
      replayed: true,
      message: `RFQ ${result.rfqName} is already linked to this ECR.`,
    };
  }
  const operation = runCreateRfqFromEcr(
    normalizedInput,
    dependencies ?? createDefaultDependencies(),
  );
  inFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(key) === operation) inFlight.delete(key);
  }
}
