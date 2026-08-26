import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import {
  assertEcrProcurementRelationships,
  EcrProcurementValidationError,
  type EcrProcurementDocument,
  type EcrProcurementDocumentLoader,
} from "./ecrProcurementValidation.js";
import {
  assertEcrWorkflowPermission,
  type AccessPrincipal,
} from "./rbacAuth.js";
import {
  activeApprovalRoleForStatus,
  appRoleForApprovalRole,
  canonicalApprovalRole,
  getEcrWorkflowTransition,
  requiredReviewAssessmentFieldsForStatus,
  reviewAssessmentAllowedValuesForStatus,
  reviewAssessmentFieldsForStatus,
  type EcrWorkflowTransition,
} from "./ecrWorkflowPolicy.js";

const ECR_DOCTYPE = "Engineering Change Request";
const APPROVAL_DOCTYPE = "ECR Approval";

export type InternalEcrPrincipal = Extract<AccessPrincipal, { typ: "internal" }>;

export interface EcrApprovalRequirement extends Record<string, unknown> {
  name?: string;
  doctype?: string;
  department?: string;
  approval_role?: string;
  approver?: string;
  required?: number;
  status?: string;
  approval_date?: string;
  comments?: string;
}

export interface EcrWorkflowDocument extends Record<string, unknown> {
  name: string;
  /** Frappe optimistic-lock timestamp; preserved in the workflow payload. */
  modified?: string;
  docstatus?: number;
  select_pxfp?: string;
  status?: string;
  ecr_owner?: string;
  amended_from?: string;
  owner?: string;
  supplier_response_required?: string;
  procurement_reference_type?: string;
  existing_rfq_reference?: string;
  existing_purchase_order_reference?: string;
  purchase_requisition?: string;
  rfq?: string;
  supplier_quotation?: string;
  selected_supplier?: string;
  purchase_order?: string;
  approval_requirements?: EcrApprovalRequirement[];
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function requestText(
  value: unknown,
  label: string,
  options: { required?: boolean; maxLength: number },
): string {
  if (value === undefined || value === null || value === "") {
    if (options.required) throw new EcrWorkflowError(`${label} is required.`);
    return "";
  }
  if (typeof value !== "string") {
    throw new EcrWorkflowError(`${label} must be text.`, 422, "validation");
  }
  const normalized = value.trim();
  if (options.required && !normalized) {
    throw new EcrWorkflowError(`${label} is required.`);
  }
  if (normalized.length > options.maxLength) {
    throw new EcrWorkflowError(
      `${label} must be ${options.maxLength} characters or fewer.`,
      422,
      "validation",
    );
  }
  return normalized;
}

function actorIdentity(principal: InternalEcrPrincipal): string {
  return clean(principal.sub) || clean(principal.email);
}

function isOwnedBy(
  document: EcrWorkflowDocument,
  principal: InternalEcrPrincipal,
): boolean {
  const identities = new Set(
    [principal.email, principal.sub]
      .map((value) => clean(value).toLowerCase())
      .filter(Boolean),
  );
  return [document.ecr_owner, document.amended_from, document.owner]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean)
    .some((value) => identities.has(value));
}

function decisionStatus(
  decision: EcrWorkflowTransition["decision"],
): "Approved" | "Rejected" | "Sent Back" | null {
  if (decision === "approved" || decision === "revision_completed") return "Approved";
  if (decision === "rejected") return "Rejected";
  if (decision === "sent_back") return "Sent Back";
  return null;
}

function isPendingApprovalTask(row: EcrApprovalRequirement): boolean {
  return clean(row.status).toUpperCase() === "PENDING";
}

/**
 * Close the current task and create only the next current-stage task. Any
 * legacy/future Pending rows are deliberately removed so they cannot appear
 * as actionable work before their stage is reached.
 */
export function buildSequentialApprovalRequirements(input: {
  rows?: EcrApprovalRequirement[];
  transition: EcrWorkflowTransition;
  actor: string;
  owner?: string;
  comment?: string;
  timestamp: string;
}): EcrApprovalRequirement[] {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const completed = rows
    .filter((row) => !isPendingApprovalTask(row))
    .map((row) => ({
      ...row,
      approval_role: canonicalApprovalRole(clean(row.approval_role)),
    }));
  const pending = rows.filter(isPendingApprovalTask);
  const currentRole = activeApprovalRoleForStatus(input.transition.currentStatus);
  const nextRole = activeApprovalRoleForStatus(input.transition.nextStatus);
  const decision = decisionStatus(input.transition.decision);
  const completionStatus = decision ??
    (currentRole && input.transition.action === "Create RFQ" ? "Completed" : null);

  if (completionStatus && currentRole) {
    const existingCurrent = pending.find(
      (row) => canonicalApprovalRole(clean(row.approval_role)) === currentRole,
    );
    completed.push({
      ...(existingCurrent ?? {}),
      doctype: clean(existingCurrent?.doctype) || APPROVAL_DOCTYPE,
      approval_role: currentRole,
      approver: input.actor,
      required: 1,
      status: completionStatus,
      approval_date: input.timestamp,
      comments:
        clean(input.comment) ||
        (input.transition.decision === "revision_completed"
          ? "Revision resubmitted."
          : ""),
    });
  }

  if (nextRole) {
    const existingNext = pending.find(
      (row) => canonicalApprovalRole(clean(row.approval_role)) === nextRole,
    );
    if (!existingNext) {
      completed.push({
        doctype: APPROVAL_DOCTYPE,
        approval_role: nextRole,
        approver: nextRole === "Engineer" ? clean(input.owner) : "",
        required: 1,
        status: "Pending",
        approval_date: "",
        comments: "",
      });
    } else {
      completed.push({
        ...existingNext,
        doctype: clean(existingNext.doctype) || APPROVAL_DOCTYPE,
        approval_role: nextRole,
        required: 1,
        status: "Pending",
      });
    }
  }

  return completed;
}

export class EcrWorkflowError extends Error {
  status: number;
  code: "validation" | "conflict" | "erp" | "config";
  fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status = 400,
    code: EcrWorkflowError["code"] = "validation",
  ) {
    super(message);
    this.name = "EcrWorkflowError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Validate that the principal role has permission to act on the current workflow stage.
 * Derives the required approval role directly from the current workflow stage.
 */
export function requireCurrentApprovalTask(input: {
  rows?: EcrApprovalRequirement[];
  currentStatus: string;
  principalRole: string;
}): EcrApprovalRequirement[] {
  const expectedApprovalRole = activeApprovalRoleForStatus(input.currentStatus);
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const pending = rows.filter(isPendingApprovalTask);
  if (!expectedApprovalRole) {
    if (pending.length > 0) {
      throw new EcrWorkflowError(
        `The ${input.currentStatus} stage must not have an active approval task.`,
        409,
        "conflict",
      );
    }
    return rows;
  }

  const expectedAppRole = appRoleForApprovalRole(expectedApprovalRole);
  if (!expectedAppRole || input.principalRole !== expectedAppRole) {
    throw new EcrWorkflowError(
      `The active ${expectedApprovalRole} task is not assigned to this role.`,
      403,
      "validation",
    );
  }

  const validCurrent = pending.filter(
    (row) =>
      canonicalApprovalRole(clean(row.approval_role)) === expectedApprovalRole &&
      Number(row.required || 0) === 1,
  );
  if (pending.length !== 1 || validCurrent.length !== 1) {
    throw new EcrWorkflowError(
      `The ECR must have exactly one active ${expectedApprovalRole} task before this action can be completed.`,
      409,
      "conflict",
    );
  }

  return rows;
}

export interface ApplyEcrWorkflowInput {
  name: unknown;
  action: unknown;
  comment?: unknown;
  reviewFields?: Record<string, unknown>;
  principal: InternalEcrPrincipal;
}

export interface ApplyEcrWorkflowResult {
  success: true;
  message: string;
  newStatus: string;
  approvalRequirements: EcrApprovalRequirement[];
}

export interface EcrWorkflowDependencies {
  loadEcr: (name: string) => Promise<EcrWorkflowDocument>;
  loadProcurementDocument: EcrProcurementDocumentLoader;
  /** Persist the full trusted document in one ERP transaction. */
  commitWorkflowDocument: (
    document: EcrWorkflowDocument,
  ) => Promise<EcrWorkflowDocument>;
  addTimelineComment: (
    name: string,
    content: string,
  ) => Promise<void>;
  now: () => string;
}

type ErpConfig = { baseUrl: string; key: string; secret: string };

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
    throw new EcrWorkflowError(
      "ECR workflow backend is missing ERPNext configuration.",
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
    const message = extractErpMessage(
      payload,
      text || `ERPNext request failed (${response.status}).`,
    );
    const optimisticConflict =
      /TimestampMismatchError|document has been modified|please refresh/i.test(message);
    throw new EcrWorkflowError(
      message,
      optimisticConflict ? 409 : response.status || 502,
      optimisticConflict ? "conflict" : "erp",
    );
  }
  const envelope = payload as { data?: T; message?: T };
  return envelope.data !== undefined
    ? envelope.data
    : envelope.message !== undefined
      ? envelope.message
      : payload as T;
}

function createDefaultDependencies(): EcrWorkflowDependencies {
  const config = readConfig();
  const resource = (doctype: string, name?: string) =>
    `resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`;
  return {
    loadEcr: async (name) => {
      try {
        return await erpRequest<EcrWorkflowDocument>(
          config,
          "GET",
          resource(ECR_DOCTYPE, name),
        );
      } catch (err) {
        try {
          const filterParams = encodeURIComponent(
            JSON.stringify([["ecr_number", "=", name]]),
          );
          const listRes = await erpRequest<
            Array<EcrWorkflowDocument> | { data?: Array<EcrWorkflowDocument> }
          >(
            config,
            "GET",
            `resource/${encodeURIComponent(ECR_DOCTYPE)}?filters=${filterParams}&limit_page_length=1`,
          );
          const rows = Array.isArray(listRes) ? listRes : listRes?.data ?? [];
          if (rows[0]?.name) {
            return await erpRequest<EcrWorkflowDocument>(
              config,
              "GET",
              resource(ECR_DOCTYPE, rows[0].name),
            );
          }
        } catch {
          // Continue to throw original error
        }
        throw err;
      }
    },
    loadProcurementDocument: (doctype, name) => erpRequest(
      config,
      "GET",
      resource(doctype, name),
    ),
    commitWorkflowDocument: (document) => erpRequest<EcrWorkflowDocument>(
      config,
      "POST",
      "method/frappe.client.save",
      { doc: document },
    ),
    addTimelineComment: async (name, content) => {
      await erpRequest(
        config,
        "POST",
        resource("Comment"),
        {
          comment_type: "Workflow",
          reference_doctype: ECR_DOCTYPE,
          reference_name: name,
          content,
        },
      );
    },
    now: () => new Date().toISOString().slice(0, 19).replace("T", " "),
  };
}

function workflowDocstatus(
  status: string,
  currentDocstatus: unknown = 0,
): 0 | 1 | 2 {
  // Frappe forbids submitted (1) -> draft (0). Keep every review/action
  // stage on new ECRs as a draft and submit only once the RFQ is created.
  // Legacy ECRs that already reached Procurement as submitted documents must
  // remain submitted while moving between the canonical procurement stages.
  // That includes Send Back and Reject: Frappe cannot save a 1 -> 0 change,
  // while the canonical workflow stage remains explicit in select_pxfp.
  if (
    Number(currentDocstatus) === 1 &&
    ["Draft", "Procurement Review", "RFQ Pending", "RFQ", "Rejected"].includes(status)
  ) {
    return 1;
  }
  return status === "RFQ" ? 1 : 0;
}

function approvalRowSignature(row: EcrApprovalRequirement): Record<string, unknown> {
  return {
    department: clean(row.department),
    approval_role: clean(row.approval_role),
    approver: clean(row.approver),
    required: Number(row.required || 0),
    status: clean(row.status),
    approval_date: clean(row.approval_date),
    comments: clean(row.comments),
  };
}

function sameApprovalRows(
  expected: EcrApprovalRequirement[],
  actual?: EcrApprovalRequirement[],
): boolean {
  if (!Array.isArray(actual) || expected.length !== actual.length) return false;
  return JSON.stringify(expected.map(approvalRowSignature)) ===
    JSON.stringify(actual.map(approvalRowSignature));
}

function isInactiveProcurementEvidence(document: EcrProcurementDocument): boolean {
  const status = clean(document.status).toLowerCase();
  return ![0, 1].includes(Number(document.docstatus)) ||
    ["cancelled", "canceled", "rejected"].includes(status);
}

async function loadActiveWorkflowEvidence(
  dependencies: EcrWorkflowDependencies,
  doctype: "Request for Quotation",
  name: string,
): Promise<EcrProcurementDocument> {
  let evidence: EcrProcurementDocument;
  try {
    evidence = await dependencies.loadProcurementDocument(doctype, name);
  } catch {
    throw new EcrWorkflowError(
      `${doctype} ${name} could not be verified. The ECR workflow was not advanced.`,
      409,
      "conflict",
    );
  }
  if (clean(evidence.name) !== name || isInactiveProcurementEvidence(evidence)) {
    throw new EcrWorkflowError(
      `${doctype} ${name} is missing, cancelled, rejected, or inactive. The ECR workflow was not advanced.`,
      409,
      "conflict",
    );
  }
  return evidence;
}

/**
 * The generic workflow endpoint may only record RFQ Pending -> RFQ after a
 * persisted RFQ is already linked. Normal UI creation uses the dedicated
 * atomic endpoint which creates the RFQ and advances the ECR together.
 */
async function assertDownstreamWorkflowEvidence(
  document: EcrWorkflowDocument,
  action: string,
  dependencies: EcrWorkflowDependencies,
): Promise<void> {
  if (action === "Create RFQ") {
    const rfqName = clean(document.rfq);
    if (!rfqName) {
      throw new EcrWorkflowError(
        `${action} requires a persisted RFQ linked to this ECR.`,
        409,
        "conflict",
      );
    }
    const rfq = await loadActiveWorkflowEvidence(
      dependencies,
      "Request for Quotation",
      rfqName,
    );
    if (clean(rfq.custom_ecr_reference) !== document.name) {
      throw new EcrWorkflowError(
        `RFQ ${rfqName} is not linked back to ECR ${document.name}.`,
        409,
        "conflict",
      );
    }
  }
}

async function runApplyEcrWorkflowAction(
  input: ApplyEcrWorkflowInput,
  dependencies: EcrWorkflowDependencies,
): Promise<ApplyEcrWorkflowResult> {
  const name = requestText(input.name, "Engineering Change Request", {
    required: true,
    maxLength: 140,
  });
  const action = requestText(input.action, "Workflow action", {
    required: true,
    maxLength: 140,
  });
  const comment = requestText(input.comment, "Review comments", {
    maxLength: 4000,
  });

  // The current state and owner always come from ERPNext, never the browser.
  const document = await dependencies.loadEcr(name);
  const currentStatus = clean(document.select_pxfp) || "Draft";
  const transition = getEcrWorkflowTransition(currentStatus, action);
  if (!transition) {
    throw new EcrWorkflowError(
      `Action "${action}" is not valid while the ECR is in ${currentStatus}.`,
      409,
      "conflict",
    );
  }

  assertEcrWorkflowPermission(input.principal, action, currentStatus);
  try {
    // Re-check the live Supplier -> RFQ/PO -> Item relationship at every
    // transition. This closes the stale-Draft window if a source document is
    // cancelled or edited after the ECR was saved.
    await assertEcrProcurementRelationships(
      document,
      dependencies.loadProcurementDocument,
    );
  } catch (error) {
    if (!(error instanceof EcrProcurementValidationError)) throw error;
    const workflowError = new EcrWorkflowError(error.message, 422, "validation");
    workflowError.fieldErrors = error.fieldErrors;
    throw workflowError;
  }
  await assertDownstreamWorkflowEvidence(document, action, dependencies);
  if (
    input.principal.role !== "admin" &&
    action === "Submit ECR" &&
    !isOwnedBy(document, input.principal)
  ) {
    throw new EcrWorkflowError(
      "Only the ECR owner can submit or resubmit this change request.",
      403,
      "validation",
    );
  }
  if (transition.requiresComment && !comment) {
    throw new EcrWorkflowError(
      "Review comments are required when sending back or rejecting an ECR.",
      422,
      "validation",
    );
  }

  const rawRows = Array.isArray(document.approval_requirements)
    ? document.approval_requirements
    : [];
  const reconciledRows = requireCurrentApprovalTask({
    rows: rawRows,
    currentStatus,
    principalRole: input.principal.role,
  });

  if (
    transition.currentStatus === "Procurement Review" &&
    transition.decision === "approved" &&
    clean(document.supplier_response_required) !== "Yes"
  ) {
    const error = new EcrWorkflowError(
      "Supplier Required must be Yes before Procurement Team approval. Send the ECR back to the Engineer for correction.",
      422,
      "validation",
    );
    error.fieldErrors = {
      supplier_response_required: "Supplier Required must be Yes before approval.",
    };
    throw error;
  }

  const assessmentFields = reviewAssessmentFieldsForStatus(currentStatus);
  const requiredAssessmentFields = requiredReviewAssessmentFieldsForStatus(currentStatus);
  const allowedAssessmentValues = reviewAssessmentAllowedValuesForStatus(currentStatus);
  const reviewValues = Object.fromEntries(
    assessmentFields.map((field) => [
      field,
      requestText(input.reviewFields?.[field], field, { maxLength: 2000 }),
    ]),
  );
  if (transition.decision === "approved") {
    const missing = requiredAssessmentFields.filter((field) => !reviewValues[field]);
    if (missing.length > 0) {
      const error = new EcrWorkflowError(
        `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} required before approval.`,
        422,
        "validation",
      );
      error.fieldErrors = Object.fromEntries(
        missing.map((field) => [field, `${field} is required before approval.`]),
      );
      throw error;
    }
    const invalid = Object.entries(allowedAssessmentValues).filter(
      ([field, allowed]) => !allowed.includes(reviewValues[field]),
    );
    if (invalid.length > 0) {
      const error = new EcrWorkflowError(
        invalid
          .map(([field, allowed]) => `${field} must be one of: ${allowed.join(", ")}.`)
          .join(" "),
        422,
        "validation",
      );
      error.fieldErrors = Object.fromEntries(
        invalid.map(([field, allowed]) => [
          field,
          `${field} must be one of: ${allowed.join(", ")}.`,
        ]),
      );
      throw error;
    }
  }

  const decisionComment = transition.decision === "approved"
    ? [
        ...assessmentFields
          .filter((field) => reviewValues[field])
          .map((field) => `${field}: ${reviewValues[field]}`),
        ...(comment ? [`Review Comments: ${comment}`] : []),
      ].join("\n")
    : comment;

  const timestamp = dependencies.now();
  const preparedRows = buildSequentialApprovalRequirements({
    // Returned Drafts retain their completed audit history. The guarded Draft
    // invariant above guarantees no pending downstream task can be carried
    // into a fresh Engineering Review.
    rows: reconciledRows,
    transition,
    actor: actorIdentity(input.principal),
    owner: clean(document.ecr_owner) || clean(document.owner),
    comment: decisionComment,
    timestamp,
  });
  const hasPersistedStatusField = Object.prototype.hasOwnProperty.call(
    document,
    "status",
  );
  const preparedDocument: EcrWorkflowDocument = {
    ...document,
    select_pxfp: transition.nextStatus,
    ...(hasPersistedStatusField ? { status: transition.nextStatus } : {}),
    docstatus: workflowDocstatus(transition.nextStatus, document.docstatus),
    approval_requirements: preparedRows,
  };

  if (!clean(document.modified)) {
    throw new EcrWorkflowError(
      "ERPNext did not return an optimistic-lock timestamp for this ECR.",
      409,
      "conflict",
    );
  }

  // Frappe's apply_workflow reloads the document and discards caller-provided
  // child rows. A full frappe.client.save instead validates the configured
  // service-role transition, checks `modified`, and commits state + task rows
  // in the same document transaction.
  const updated = await dependencies.commitWorkflowDocument(preparedDocument);
  const newStatus = clean(updated.select_pxfp);
  if (newStatus !== transition.nextStatus) {
    throw new EcrWorkflowError(
      `ERPNext workflow mismatch: expected ${transition.nextStatus}, received ${newStatus}. Run the ECR workflow migration before retrying.`,
      409,
      "conflict",
    );
  }
  if (
    hasPersistedStatusField &&
    clean(updated.status) !== transition.nextStatus
  ) {
    throw new EcrWorkflowError(
      `ERPNext status mismatch after moving to ${transition.nextStatus}.`,
      409,
      "conflict",
    );
  }
  if (
    Number(updated.docstatus) !==
    workflowDocstatus(transition.nextStatus, document.docstatus)
  ) {
    throw new EcrWorkflowError(
      `ERPNext document-status mismatch after moving to ${transition.nextStatus}.`,
      409,
      "conflict",
    );
  }
  if (!sameApprovalRows(preparedRows, updated.approval_requirements)) {
    throw new EcrWorkflowError(
      "ERPNext did not persist the sequential approval task/history update. Refresh and retry after verifying the ECR schema migration.",
      409,
      "conflict",
    );
  }

  const auditContent = decisionComment
    ? `${action}\n${decisionComment}`
    : action;
  // The authoritative audit is already in approval_requirements. Timeline
  // comments are helpful but must not turn a committed transition into a false
  // failure if Comment creation is unavailable.
  await dependencies.addTimelineComment(name, auditContent).catch(() => undefined);

  return {
    success: true,
    message: `ECR moved to ${newStatus}.`,
    newStatus,
    approvalRequirements: Array.isArray(updated.approval_requirements)
      ? updated.approval_requirements
      : preparedRows,
  };
}

const inFlight = new Map<string, Promise<ApplyEcrWorkflowResult>>();

export async function applyEcrWorkflowActionCore(
  input: ApplyEcrWorkflowInput,
  dependencies?: EcrWorkflowDependencies,
): Promise<ApplyEcrWorkflowResult> {
  const key = typeof input.name === "string" ? input.name.trim() : "";
  if (!key) {
    throw new EcrWorkflowError(
      "Engineering Change Request is required.",
      422,
      "validation",
    );
  }
  const current = inFlight.get(key);
  if (current) {
    throw new EcrWorkflowError(
      "Another workflow action is already in progress for this ECR. Refresh before retrying.",
      409,
      "conflict",
    );
  }
  const operation = runApplyEcrWorkflowAction(
    input,
    dependencies ?? createDefaultDependencies(),
  );
  inFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(key) === operation) inFlight.delete(key);
  }
}
