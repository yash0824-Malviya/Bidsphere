import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import {
  applyEcrWorkflowActionCore,
  type InternalEcrPrincipal,
} from "./ecrWorkflowCore.js";

const ECR_DOCTYPE = "Engineering Change Request";
const PR_DOCTYPE = "Purchase Requisition";
export const ECR_PR_IDEMPOTENCY_FIELD = "custom_bidsphere_ecr_idempotency_key";

type EcrPart = {
  partitem?: string;
  part_description?: string;
  current_revision?: string;
  new_revision?: string;
  quantity?: number;
  uom?: string;
  plant?: string;
  proposed_supplier?: string;
  current_supplier?: string;
  change_required?: string;
  technical_notes?: string;
};

export interface SourceEcr extends Record<string, unknown> {
  name: string;
  modified?: string;
  ecr_number?: string;
  select_pxfp?: string;
  supplier_response_required?: string;
  procurement_reference_type?: string;
  existing_rfq_reference?: string;
  existing_purchase_order_reference?: string;
  purchase_requisition?: string;
  rfq?: string;
  purchase_order?: string;
  ecr_title?: string;
  ecr_owner?: string;
  amended_from?: string;
  owner?: string;
  requesting_department?: string;
  plant?: string;
  program?: string;
  project?: string;
  target_implementation_date?: string;
  priority?: string;
  chnage_description?: string;
  reason_for_change?: string;
  ecr_type?: string;
  business_justification?: string;
  suggested_supplier?: string;
  affected_parts?: EcrPart[];
}

export interface PurchaseRequisitionTrace extends Record<string, unknown> {
  name: string;
  status?: string;
  docstatus?: number;
  ecr_reference?: string;
  custom_bidsphere_ecr_idempotency_key?: string;
}

export interface CreatePrFromEcrInput {
  ecrName: string;
  principal: InternalEcrPrincipal;
}

export interface CreatePrFromEcrResult {
  success: true;
  prName: string;
  created: boolean;
  replayed: boolean;
  message: string;
}

export class CreatePrFromEcrError extends Error {
  status: number;
  code: "validation" | "conflict" | "erp" | "config" | "partial";
  prName?: string;
  fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status = 400,
    code: CreatePrFromEcrError["code"] = "validation",
    options: { prName?: string; fieldErrors?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "CreatePrFromEcrError";
    this.status = status;
    this.code = code;
    this.prName = options.prName;
    this.fieldErrors = options.fieldErrors;
  }
}

/** Internal signal for the ERP unique-key race; never returned to a caller. */
class PrIdempotencyCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrIdempotencyCollisionError";
  }
}

export interface CreatePrFromEcrDependencies {
  loadEcr: (name: string) => Promise<SourceEcr>;
  loadPr: (name: string) => Promise<PurchaseRequisitionTrace>;
  findPrCandidates: (ecrName: string) => Promise<PurchaseRequisitionTrace[]>;
  createPr: (payload: Record<string, unknown>) => Promise<PurchaseRequisitionTrace>;
  updatePr: (
    name: string,
    payload: Record<string, unknown>,
  ) => Promise<PurchaseRequisitionTrace>;
  updateEcr: (
    name: string,
    payload: Record<string, unknown>,
    current: SourceEcr,
  ) => Promise<SourceEcr>;
  advanceEcrWorkflow: (
    name: string,
    principal: InternalEcrPrincipal,
  ) => Promise<void>;
}

type ErpConfig = { baseUrl: string; key: string; secret: string };

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedState(value: unknown): string {
  return clean(value).toLowerCase();
}

function requestName(value: unknown): string {
  const name = clean(value);
  if (!name) throw new CreatePrFromEcrError("Engineering Change Request is required.");
  if (name.length > 140) {
    throw new CreatePrFromEcrError(
      "Engineering Change Request must be 140 characters or fewer.",
      422,
      "validation",
    );
  }
  return name;
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
    throw new CreatePrFromEcrError(
      "Purchase Requisition creation backend is missing ERPNext configuration.",
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
      // Fall through to the other ERPNext error shapes.
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
      /custom_bidsphere_ecr_idempotency_key|BidSphere ECR Idempotency|idempotency/i.test(message) &&
      /DuplicateEntryError|UniqueValidationError|duplicate|unique/i.test(message)
    ) {
      throw new PrIdempotencyCollisionError(message);
    }
    const conflict = /TimestampMismatchError|document has been modified|please refresh/i.test(message);
    throw new CreatePrFromEcrError(
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

function createDefaultDependencies(): CreatePrFromEcrDependencies {
  const config = readConfig();
  const resource = (doctype: string, name?: string) =>
    `resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`;
  const listPrs = async (filters: unknown[]): Promise<PurchaseRequisitionTrace[]> =>
    erpRequest<PurchaseRequisitionTrace[]>(config, "GET", resource(PR_DOCTYPE), {
      search: {
        filters: JSON.stringify(filters),
        fields: JSON.stringify([
          "name",
          "status",
          "docstatus",
          "ecr_reference",
          ECR_PR_IDEMPOTENCY_FIELD,
        ]),
        limit_page_length: "3",
      },
    });

  return {
    loadEcr: async (name) => {
      try {
        return await erpRequest<SourceEcr>(config, "GET", resource(ECR_DOCTYPE, name));
      } catch (error) {
        const rows = await erpRequest<Array<Pick<SourceEcr, "name">>>(
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
          return erpRequest<SourceEcr>(
            config,
            "GET",
            resource(ECR_DOCTYPE, rows[0].name),
          );
        }
        throw error;
      }
    },
    loadPr: (name) => erpRequest(config, "GET", resource(PR_DOCTYPE, name)),
    findPrCandidates: async (ecrName) => {
      const byKey = await listPrs([[ECR_PR_IDEMPOTENCY_FIELD, "=", ecrName]]);
      const byReference = await listPrs([["ecr_reference", "=", ecrName]]);
      return [...new Map(
        [...byKey, ...byReference]
          .filter((row) => clean(row.name))
          .map((row) => [clean(row.name), row]),
      ).values()];
    },
    createPr: (payload) => erpRequest(
      config,
      "POST",
      resource(PR_DOCTYPE),
      { body: payload },
    ),
    updatePr: (name, payload) => erpRequest(
      config,
      "PUT",
      resource(PR_DOCTYPE, name),
      { body: payload },
    ),
    updateEcr: (name, payload, current) => {
      if (!clean(current.modified)) {
        throw new CreatePrFromEcrError(
          `ECR ${name} is missing its optimistic-lock timestamp.`,
          409,
          "conflict",
        );
      }
      return erpRequest<SourceEcr>(
        config,
        "POST",
        "method/frappe.client.save",
        {
          body: {
            doc: {
              ...current,
              ...payload,
              doctype: ECR_DOCTYPE,
              name,
              modified: current.modified,
            },
          },
        },
      );
    },
    advanceEcrWorkflow: async (name, principal) => {
      await applyEcrWorkflowActionCore({
        name,
        action: "Create Requisition",
        principal,
      });
    },
  };
}

const TRANSITION_STATES = new Set([
  "approved",
  "ecr approved",
  "procurement",
]);

const REQUISITION_STATES = new Set([
  "purchase requisition",
  "requisition creation",
  "procurement review",
]);

const POST_REQUISITION_STATES = new Set([
  "rfq",
  "rfq created",
  "supplier response",
  "supplier evaluation",
  "supplier selection",
  "supplier selected",
  "implementation",
  "validation",
  "closed",
]);

function validateCreationState(ecr: SourceEcr): void {
  const state = normalizedState(ecr.select_pxfp || "Draft");
  if (TRANSITION_STATES.has(state) || REQUISITION_STATES.has(state)) return;
  if (POST_REQUISITION_STATES.has(state) && clean(ecr.purchase_requisition)) return;
  throw new CreatePrFromEcrError(
    `ECR must be Approved before creating a Purchase Requisition. Current state: ${clean(ecr.select_pxfp) || "Draft"}.`,
    409,
    "conflict",
  );
}

function validateProcurementPath(ecr: SourceEcr): void {
  const fieldErrors: Record<string, string> = {};
  if (clean(ecr.supplier_response_required) !== "Yes") {
    fieldErrors.supplier_response_required =
      "Supplier Required must be Yes before creating a Purchase Requisition.";
  }
  const referenceType = clean(ecr.procurement_reference_type) || "None";
  if (referenceType !== "None") {
    fieldErrors.procurement_reference_type =
      "A Purchase Requisition can be created only when no existing RFQ or Purchase Order is selected.";
  }
  if (clean(ecr.existing_rfq_reference) || clean(ecr.rfq)) {
    fieldErrors.existing_rfq_reference =
      "This ECR already has an RFQ source or downstream RFQ.";
  }
  if (clean(ecr.existing_purchase_order_reference) || clean(ecr.purchase_order)) {
    fieldErrors.existing_purchase_order_reference =
      "This ECR already has a Purchase Order source or downstream Purchase Order.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new CreatePrFromEcrError(
      Object.values(fieldErrors)[0],
      422,
      "validation",
      { fieldErrors },
    );
  }
}

function buildPrPayload(ecr: SourceEcr): Record<string, unknown> {
  const errors: Record<string, string> = {};
  const requester = clean(ecr.ecr_owner) || clean(ecr.amended_from) || clean(ecr.owner);
  if (!requester) errors.requester = "The ECR owner is required.";
  if (!clean(ecr.requesting_department)) {
    errors.requesting_department = "The requesting department is required.";
  }
  if (!clean(ecr.plant)) errors.plant = "The plant is required.";
  if (!clean(ecr.target_implementation_date)) {
    errors.required_date = "The target implementation date is required.";
  }

  const parts = Array.isArray(ecr.affected_parts) ? ecr.affected_parts : [];
  if (parts.length === 0) errors.requisition_items = "At least one affected part is required.";
  const requisitionItems = parts.map((part, index) => {
    const item = clean(part.partitem);
    if (!item) errors[`requisition_items.${index}.partitem`] = "Item / Part is required.";
    const quantity = Number(part.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors[`requisition_items.${index}.quantity`] = "Quantity must be greater than zero.";
    }
    const uom = clean(part.uom) || "Nos";
    return {
      partitem: item,
      description: clean(part.part_description),
      revision: clean(part.new_revision) || clean(part.current_revision),
      quantity,
      uom,
      plant: clean(part.plant) || clean(ecr.plant),
      supplier: clean(part.proposed_supplier) || clean(part.current_supplier),
      technical_requirement: clean(part.change_required)
        ? `${clean(part.change_required)}${clean(part.technical_notes) ? `\n${clean(part.technical_notes)}` : ""}`
        : clean(part.technical_notes),
      ecr_change_required: 1,
    };
  });
  if (Object.keys(errors).length > 0) {
    throw new CreatePrFromEcrError(
      Object.values(errors)[0],
      422,
      "validation",
      { fieldErrors: errors },
    );
  }

  return {
    requisition_title: `PR for ${clean(ecr.ecr_title) || clean(ecr.ecr_number) || ecr.name}`,
    source_type: "ECR",
    ecr_reference: ecr.name,
    requester,
    requesting_department: clean(ecr.requesting_department),
    plant: clean(ecr.plant),
    program: clean(ecr.program),
    project: clean(ecr.project),
    required_date: clean(ecr.target_implementation_date),
    priority: clean(ecr.priority) || "Medium",
    purpose__requirement: [clean(ecr.chnage_description), clean(ecr.reason_for_change)]
      .filter(Boolean)
      .join("\n\n"),
    procurement_category: clean(ecr.ecr_type),
    procurement_notes: clean(ecr.business_justification),
    requisition_items: requisitionItems,
    suggested_supplier: clean(ecr.suggested_supplier),
    status: "Draft",
    [ECR_PR_IDEMPOTENCY_FIELD]: ecr.name,
  };
}

function assertPrBelongsToEcr(pr: PurchaseRequisitionTrace, ecrName: string): void {
  if (!clean(pr.name)) {
    throw new CreatePrFromEcrError(
      "ERPNext did not return the created Purchase Requisition name.",
      502,
      "erp",
    );
  }
  if (Number(pr.docstatus) === 2 || normalizedState(pr.status) === "cancelled") {
    throw new CreatePrFromEcrError(
      `Purchase Requisition ${pr.name} is cancelled and cannot be reused.`,
      409,
      "conflict",
      { prName: pr.name },
    );
  }
  const reference = clean(pr.ecr_reference);
  const key = clean(pr[ECR_PR_IDEMPOTENCY_FIELD]);
  if (reference && reference !== ecrName) {
    throw new CreatePrFromEcrError(
      `Purchase Requisition ${pr.name} belongs to ECR ${reference}, not ${ecrName}.`,
      409,
      "conflict",
      { prName: pr.name },
    );
  }
  if (key && key !== ecrName) {
    throw new CreatePrFromEcrError(
      `Purchase Requisition ${pr.name} has conflicting ECR idempotency traceability.`,
      409,
      "conflict",
      { prName: pr.name },
    );
  }
}

function oneCandidate(
  candidates: PurchaseRequisitionTrace[],
  ecrName: string,
): PurchaseRequisitionTrace | null {
  const unique = [...new Map(
    candidates
      .filter((candidate) => clean(candidate.name))
      .map((candidate) => [clean(candidate.name), candidate]),
  ).values()];
  if (unique.length > 1) {
    throw new CreatePrFromEcrError(
      `ECR ${ecrName} is linked to multiple Purchase Requisitions (${unique.map((row) => row.name).join(", ")}). Resolve the duplicate records before retrying.`,
      409,
      "conflict",
    );
  }
  return unique[0] ?? null;
}

async function ensurePrTrace(
  pr: PurchaseRequisitionTrace,
  ecrName: string,
  dependencies: CreatePrFromEcrDependencies,
): Promise<PurchaseRequisitionTrace> {
  assertPrBelongsToEcr(pr, ecrName);
  const patch: Record<string, unknown> = {};
  if (!clean(pr.ecr_reference)) patch.ecr_reference = ecrName;
  if (!clean(pr[ECR_PR_IDEMPOTENCY_FIELD])) patch[ECR_PR_IDEMPOTENCY_FIELD] = ecrName;
  if (Object.keys(patch).length === 0) return pr;
  try {
    const updated = await dependencies.updatePr(pr.name, patch);
    const verified = await dependencies.loadPr(pr.name);
    assertPrBelongsToEcr(verified, ecrName);
    if (
      clean(verified.ecr_reference) !== ecrName ||
      clean(verified[ECR_PR_IDEMPOTENCY_FIELD]) !== ecrName
    ) {
      throw new CreatePrFromEcrError(
        `Purchase Requisition ${pr.name} traceability could not be verified.`,
        409,
        "partial",
        { prName: pr.name },
      );
    }
    return { ...updated, ...verified };
  } catch (error) {
    if (error instanceof CreatePrFromEcrError) throw error;
    const candidate = oneCandidate(await dependencies.findPrCandidates(ecrName), ecrName);
    if (candidate?.name === pr.name) {
      assertPrBelongsToEcr(candidate, ecrName);
      return candidate;
    }
    throw new CreatePrFromEcrError(
      `Purchase Requisition ${pr.name} was found, but its ECR traceability could not be repaired.`,
      409,
      "partial",
      { prName: pr.name },
    );
  }
}

async function resolveOrCreatePr(
  ecr: SourceEcr,
  dependencies: CreatePrFromEcrDependencies,
): Promise<{ pr: PurchaseRequisitionTrace; created: boolean }> {
  const linkedName = clean(ecr.purchase_requisition);
  const candidates = await dependencies.findPrCandidates(ecr.name);
  const candidate = oneCandidate(candidates, ecr.name);
  if (linkedName) {
    const linked = await dependencies.loadPr(linkedName).catch(() => null);
    if (!linked) {
      throw new CreatePrFromEcrError(
        `ECR ${ecr.name} references missing Purchase Requisition ${linkedName}.`,
        409,
        "conflict",
        { prName: linkedName },
      );
    }
    if (candidate && candidate.name !== linkedName) {
      throw new CreatePrFromEcrError(
        `ECR ${ecr.name} references ${linkedName}, but idempotency traceability points to ${candidate.name}.`,
        409,
        "conflict",
      );
    }
    return {
      pr: await ensurePrTrace(linked, ecr.name, dependencies),
      created: false,
    };
  }
  if (candidate) {
    return {
      pr: await ensurePrTrace(candidate, ecr.name, dependencies),
      created: false,
    };
  }

  let created: PurchaseRequisitionTrace;
  try {
    created = await dependencies.createPr(buildPrPayload(ecr));
  } catch (error) {
    if (!(error instanceof PrIdempotencyCollisionError)) throw error;
    const raced = oneCandidate(await dependencies.findPrCandidates(ecr.name), ecr.name);
    if (!raced) {
      throw new CreatePrFromEcrError(
        "ERPNext reported an ECR idempotency collision, but the existing Purchase Requisition could not be loaded.",
        409,
        "conflict",
      );
    }
    return {
      pr: await ensurePrTrace(raced, ecr.name, dependencies),
      created: false,
    };
  }
  return {
    pr: await ensurePrTrace(created, ecr.name, dependencies),
    created: true,
  };
}

async function ensureEcrBacklink(
  ecr: SourceEcr,
  prName: string,
  dependencies: CreatePrFromEcrDependencies,
): Promise<SourceEcr> {
  const existing = clean(ecr.purchase_requisition);
  if (existing && existing !== prName) {
    throw new CreatePrFromEcrError(
      `ECR ${ecr.name} already references Purchase Requisition ${existing}.`,
      409,
      "conflict",
      { prName: existing },
    );
  }
  if (!existing) {
    try {
      if (!clean(ecr.modified)) {
        throw new CreatePrFromEcrError(
          `ECR ${ecr.name} is missing its optimistic-lock timestamp.`,
          409,
          "conflict",
          { prName },
        );
      }
      await dependencies.updateEcr(
        ecr.name,
        { purchase_requisition: prName },
        ecr,
      );
    } catch {
      const concurrent = await dependencies.loadEcr(ecr.name).catch(() => null);
      if (clean(concurrent?.purchase_requisition) !== prName) {
        throw new CreatePrFromEcrError(
          `Purchase Requisition ${prName} was created, but the ECR backlink could not be saved. Retry to repair the traceability link.`,
          409,
          "partial",
          { prName },
        );
      }
    }
  }
  const verified = await dependencies.loadEcr(ecr.name);
  if (clean(verified.purchase_requisition) !== prName) {
    throw new CreatePrFromEcrError(
      `Purchase Requisition ${prName} exists, but the ECR backlink could not be verified.`,
      409,
      "partial",
      { prName },
    );
  }
  return verified;
}

async function ensureWorkflowAdvanced(
  ecr: SourceEcr,
  prName: string,
  principal: InternalEcrPrincipal,
  dependencies: CreatePrFromEcrDependencies,
): Promise<void> {
  const state = normalizedState(ecr.select_pxfp);
  if (!TRANSITION_STATES.has(state)) return;
  try {
    await dependencies.advanceEcrWorkflow(ecr.name, principal);
  } catch {
    const concurrent = await dependencies.loadEcr(ecr.name).catch(() => null);
    if (
      concurrent &&
      clean(concurrent.purchase_requisition) === prName &&
      !TRANSITION_STATES.has(normalizedState(concurrent.select_pxfp))
    ) {
      return;
    }
    throw new CreatePrFromEcrError(
      `Purchase Requisition ${prName} is linked, but the ECR workflow could not be advanced. Retry to complete the workflow transition.`,
      409,
      "partial",
      { prName },
    );
  }
}

export async function createPrFromEcrCore(
  input: CreatePrFromEcrInput,
  dependencies?: CreatePrFromEcrDependencies,
): Promise<CreatePrFromEcrResult> {
  const requestedName = requestName(input.ecrName);
  const deps = dependencies ?? createDefaultDependencies();
  const ecr = await deps.loadEcr(requestedName);
  if (!clean(ecr.name)) {
    throw new CreatePrFromEcrError("ERPNext returned an invalid Engineering Change Request.", 502, "erp");
  }
  validateCreationState(ecr);
  // Once a verified PR backlink exists this endpoint is a read/repair replay,
  // even if the ECR has since advanced to RFQ or PO. Creation-only source-path
  // rules must not make a previously successful request non-idempotent.
  if (!clean(ecr.purchase_requisition)) validateProcurementPath(ecr);

  const resolved = await resolveOrCreatePr(ecr, deps);
  const linked = await ensureEcrBacklink(ecr, resolved.pr.name, deps);
  await ensureWorkflowAdvanced(linked, resolved.pr.name, input.principal, deps);

  return {
    success: true,
    prName: resolved.pr.name,
    created: resolved.created,
    replayed: !resolved.created,
    message: resolved.created
      ? `Purchase Requisition ${resolved.pr.name} created successfully.`
      : `Purchase Requisition ${resolved.pr.name} is already linked to this ECR.`,
  };
}
