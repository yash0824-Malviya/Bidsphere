import type { AppRole } from "./roles";
import type { EngineeringChangeRequest, ECRStatus } from "../types/erpnext";

/**
 * Central role, workflow and permission model for Engineering Change Requests.
 * UI components and route guards must use these helpers instead of embedding
 * role/status checks of their own.
 */
export type ECRRole = Extract<
  AppRole,
  | "admin"
  | "engineer"
  | "engineering"
  | "operations"
  | "quality"
  | "finance"
  | "program_manager"
  | "procurement_team"
  | "procurement"
>;

/** Normalize ERP/app role labels without weakening exact role ownership. */
export function normalizeECRRoleAlias(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export type CanonicalECRStage =
  | "Unknown"
  | "Draft"
  | "Engineering Review"
  | "Technical Approved"
  | "Business Case Preparation"
  | "Business Case Submitted"
  | "Finance Review"
  | "Procurement BC Review"
  | "Business Case Approved"
  | "Final ECR Approval"
  | "ECR Approved"
  | "Procurement Decision"
  | "Procurement Review"
  | "RFQ Pending"
  | "Operations Review"
  | "Quality Review"
  | "Program Review"
  | "Sent Back"
  | "Approved"
  | "Procurement"
  | "Purchase Requisition"
  | "RFQ"
  | "Supplier Response"
  | "Supplier Evaluation"
  | "Supplier Selection"
  | "Implementation"
  | "Validation"
  | "Closed"
  | "Rejected"
  | "Cancelled";

export type ECRHighLevelStatus =
  | "Unknown"
  | "Draft"
  | "In Review"
  | "Sent Back"
  | "Approved"
  | "Closed"
  | "Rejected / Cancelled";

export type ECRActionTone = "primary" | "secondary" | "danger";

export interface ECRWorkflowAction {
  label: string;
  action: string;
  tone: ECRActionTone;
}

export interface ECRWorkspaceConfig {
  title: string;
  description: string;
  queueTitle: string;
  emptyTitle: string;
  detailTabs: string[];
  assessmentTitle?: string;
  assessmentFields?: string[];
}

/** Core Engineering Change Control workflow stages */
export const ECR_WORKFLOW_STAGES: Array<{
  id: CanonicalECRStage;
  label: string;
}> = [
  { id: "Draft", label: "Draft" },
  { id: "Engineering Review", label: "Engineering Review" },
  { id: "Procurement Review", label: "Procurement Review" },
  { id: "RFQ Pending", label: "RFQ Pending" },
  { id: "RFQ", label: "RFQ" },
];

/** Unversioned records retain the existing workflow and its role ownership. */
export function isExtendedECRWorkflow(ecr?: Partial<EngineeringChangeRequest> | null): boolean {
  return ecr?.ecr_workflow_version === "extended_v1";
}

export const ECR_EXTENDED_WORKFLOW_STAGES: Array<{ id: CanonicalECRStage; label: string; conditional?: boolean }> = [
  { id: "Draft", label: "Draft" },
  { id: "Engineering Review", label: "Technical Review" },
  { id: "Technical Approved", label: "Business Case Preparation" },
  { id: "Finance Review", label: "Finance Review", conditional: true },
  { id: "Procurement BC Review", label: "Procurement Review" },
  { id: "Quality Review", label: "Quality Review", conditional: true },
  { id: "Business Case Approved", label: "Business Case Approved" },
  { id: "Final ECR Approval", label: "Final ECR Approval" },
  { id: "ECR Approved", label: "ECR Approved" },
  { id: "Procurement Decision", label: "Procurement Decision" },
  { id: "RFQ", label: "RFQ", conditional: true },
];

export function isECRBusinessCaseReviewStage(stage: CanonicalECRStage): boolean {
  return ["Finance Review", "Procurement BC Review", "Quality Review"].includes(stage);
}

export interface ECRStageConfig {
  stage: CanonicalECRStage;
  label: string;
  responsibleRole: AppRole;
  responsibleTitle: string;
  nextStage: CanonicalECRStage | null;
  reviewType: string;
  decisionTitle: string;
  decisionSubtitle: string;
  assessmentFields: string[];
  requiredAssessmentFields?: string[];
  commentsLabel?: string;
}

export const ECR_STAGE_WORKFLOW_MAP: Partial<Record<CanonicalECRStage, ECRStageConfig>> = {
  Draft: {
    stage: "Draft",
    label: "Draft",
    responsibleRole: "engineer",
    responsibleTitle: "ECR Owner / Engineer",
    nextStage: "Engineering Review",
    reviewType: "Creation & Submission",
    decisionTitle: "Draft Submission",
    decisionSubtitle: "Review change details and submit for Engineering Review.",
    assessmentFields: [],
  },
  "Engineering Review": {
    stage: "Engineering Review",
    label: "Engineering Review",
    responsibleRole: "engineering",
    responsibleTitle: "Engineering Manager",
    nextStage: "Procurement Review",
    reviewType: "Engineering Review",
    decisionTitle: "Engineering Review Decision",
    decisionSubtitle: "Review the technical feasibility, engineering impact, and requirements before approving the ECR.",
    assessmentFields: ["Technical Feasibility", "Engineering Impact", "Technical Requirements"],
    requiredAssessmentFields: ["Technical Feasibility", "Engineering Impact"],
    commentsLabel: "Review Comments",
  },
  "Procurement Review": {
    stage: "Procurement Review",
    label: "Procurement Review",
    responsibleRole: "procurement_team",
    responsibleTitle: "Procurement Team",
    nextStage: "RFQ Pending",
    reviewType: "Procurement Review",
    decisionTitle: "Procurement Review Decision",
    decisionSubtitle: "Confirm the supplier and RFQ requirements before approving the ECR for RFQ creation.",
    assessmentFields: ["Procurement Assessment", "Supplier Requirement", "RFQ Requirement"],
    requiredAssessmentFields: ["Procurement Assessment", "Supplier Requirement", "RFQ Requirement"],
    commentsLabel: "Review Comments",
  },
  "RFQ Pending": {
    stage: "RFQ Pending",
    label: "RFQ Pending",
    responsibleRole: "procurement",
    responsibleTitle: "Procurement Manager",
    nextStage: "RFQ",
    reviewType: "RFQ Creation",
    decisionTitle: "RFQ Creation Required",
    decisionSubtitle: "Create the RFQ using the approved ECR information and affected parts.",
    assessmentFields: [],
  },
  RFQ: {
    stage: "RFQ",
    label: "RFQ",
    responsibleRole: "procurement_team",
    responsibleTitle: "Procurement Team / RFQ process",
    nextStage: null,
    reviewType: "Procurement",
    decisionTitle: "Request for Quotation",
    decisionSubtitle: "RFQ created and sent to suppliers. ECR workflow complete.",
    assessmentFields: [],
  },
};

/**
 * Return the exact applicable workflow stages for an ECR.
 * Five-stage demo workflow with two sequential procurement ownership gates.
 */
export function getApplicableECRWorkflowStages(
  ecr?: Partial<EngineeringChangeRequest> | null,
): Array<{ id: CanonicalECRStage; label: string; conditional?: boolean }> {
  if (isExtendedECRWorkflow(ecr)) {
    return ECR_EXTENDED_WORKFLOW_STAGES.filter((stage) =>
      (stage.id !== "Finance Review" || Number(ecr?.cost_impact) === 1) &&
      (stage.id !== "Quality Review" || Number(ecr?.quality_impact) === 1) &&
      (stage.id !== "RFQ" || ecr?.rfq_required !== "No"),
    ).map((stage) => ({ ...stage })).concat(ecr?.rfq_required === "No" ? [{ id: "Closed", label: "Closed" }] : []);
  }
  return ECR_WORKFLOW_STAGES.map((stage) => ({ ...stage }));
}

export function getECRStageConfig(
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): ECRStageConfig | undefined {
  const stage = canonicalECRStage(status, ecr);
  if (!isExtendedECRWorkflow(ecr)) return ECR_STAGE_WORKFLOW_MAP[stage];
  if (stage === "Engineering Review") return {
    ...ECR_STAGE_WORKFLOW_MAP[stage]!, nextStage: "Technical Approved",
    label: "Technical Review", decisionTitle: "Technical Approval",
  };
  const definitions: Partial<Record<CanonicalECRStage, [AppRole, string, CanonicalECRStage | null, string, string]>> = {
    "Technical Approved": ["engineer", "Engineer", "Business Case Submitted", "Prepare Business Case", "Prepare the business justification, financial impact and risk assessment."],
    "Business Case Preparation": ["engineer", "Engineer", "Business Case Submitted", "Prepare Business Case", "Complete and submit the linked Business Case."],
    "Business Case Submitted": ["engineer", "Engineer", Number(ecr?.cost_impact) === 1 ? "Finance Review" : "Procurement BC Review", "Business Case Submitted", "The Business Case is entering the required review stages."],
    "Finance Review": ["finance", "Finance Manager", "Procurement BC Review", "Financial Review", "Review the financial impact in the linked Business Case."],
    "Procurement BC Review": ["procurement", "Procurement Manager", Number(ecr?.quality_impact) === 1 ? "Quality Review" : "Business Case Approved", "Procurement Business Case Review", "Review supplier impact and sourcing requirements in the linked Business Case."],
    "Quality Review": ["quality", "Quality Manager", "Business Case Approved", "Quality Review", "Review quality impact and risks in the linked Business Case."],
    "Business Case Approved": ["program_manager", "Program Manager", "Final ECR Approval", "Start Final Review", "Review the approved Business Case and begin final ECR approval."],
    "Final ECR Approval": ["program_manager", "Program Manager", "ECR Approved", "Final ECR Approval", "Make the final ECR decision using the approved Business Case and technical assessment."],
    "ECR Approved": ["procurement", "Procurement Manager", "Procurement Decision", "Record Procurement Decision", "Decide whether an RFQ is required and record the reason."],
    "Procurement Decision": ["procurement", "Procurement Manager", ecr?.rfq_required === "No" ? "Closed" : "RFQ", "Create RFQ", "Create an RFQ from the approved ECR and recorded procurement decision."],
  };
  const definition = definitions[stage];
  if (!definition) return ECR_STAGE_WORKFLOW_MAP[stage];
  return {
    stage, label: stage, responsibleRole: definition[0], responsibleTitle: definition[1],
    nextStage: definition[2], reviewType: definition[3], decisionTitle: definition[3],
    decisionSubtitle: definition[4],
    assessmentFields: stage === "Final ECR Approval" ? ["Final Decision Rationale"] : [],
    ...(stage === "Final ECR Approval" ? { requiredAssessmentFields: ["Final Decision Rationale"] } : {}),
  };
}

/**
 * Determine the next workflow stage when a decision action is performed.
 */
export function getNextApplicableECRStage(
  currentStatus: ECRStatus | string | null | undefined,
  action: string,
  ecr?: Partial<EngineeringChangeRequest> | null,
): CanonicalECRStage {
  const currentStage = canonicalECRStage(currentStatus, ecr);
  if (isExtendedECRWorkflow(ecr)) {
    if (isECRBusinessCaseReviewStage(currentStage)) return currentStage;
    if (currentStage === "Engineering Review" && action === "Approve") return "Technical Approved";
    if (currentStage === "Business Case Approved" && action === "Start Final Review") return "Final ECR Approval";
    if (currentStage === "Final ECR Approval" && action === "Approve ECR") return "ECR Approved";
    if (currentStage === "Final ECR Approval" && action === "Send Back") return "Technical Approved";
    if (currentStage === "Final ECR Approval" && action === "Reject") return "Rejected";
    if (currentStage === "ECR Approved" && action === "Request Sourcing Revision") return "Draft";
    if (currentStage === "ECR Approved" && action === "Record Procurement Decision") return ecr?.rfq_required === "No" ? "Closed" : "Procurement Decision";
    if (currentStage === "Procurement Decision" && action === "Create RFQ" && ecr?.rfq_required === "Yes") return "RFQ";
    if (currentStage === "Procurement Review" || currentStage === "RFQ Pending") return currentStage;
  }
  if (currentStage === "Draft" && action === "Submit ECR") return "Engineering Review";
  if (action === "Send Back" && ["Engineering Review", "Procurement Review"].includes(currentStage)) return "Draft";
  if (action === "Reject" && ["Engineering Review", "Procurement Review"].includes(currentStage)) return "Rejected";
  if (currentStage === "Engineering Review" && action === "Approve") return "Procurement Review";
  if (currentStage === "Procurement Review" && action === "Approve") return "RFQ Pending";
  if (currentStage === "RFQ Pending" && action === "Create RFQ") return "RFQ";
  return currentStage;
}

const TERMINAL_STAGES = new Set<CanonicalECRStage>([
  "RFQ",
  "Closed",
  "Rejected",
  "Cancelled",
]);

/** Map both the new sequential workflow and pre-migration ERP states. */
export function canonicalECRStage(
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): CanonicalECRStage {
  if (!status) return "Draft";
  const normalized = String(status)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  if (isExtendedECRWorkflow(ecr)) {
    const extended: Record<string, CanonicalECRStage> = {
      "TECHNICAL APPROVED": "Technical Approved", "BUSINESS CASE PREPARATION": "Business Case Preparation",
      "BUSINESS CASE SUBMITTED": "Business Case Submitted", "FINANCE REVIEW": "Finance Review",
      "PROCUREMENT BC REVIEW": "Procurement BC Review", "QUALITY REVIEW": "Quality Review",
      "BUSINESS CASE APPROVED": "Business Case Approved", "FINAL ECR APPROVAL": "Final ECR Approval",
      "ECR APPROVED": "ECR Approved", "PROCUREMENT DECISION": "Procurement Decision",
    };
    if (extended[normalized]) return extended[normalized];
  }
  switch (normalized) {
    case "ENGINEERING MANAGER APPROVAL":
    case "ENGINEERING MANAGER REVIEW":
    case "EM APPROVAL":
      return "Engineering Review";
    case "SUBMITTED":
    case "UNDER REVIEW":
    case "ENGINEERING REVIEW":
      return "Engineering Review";
    case "RFQ PENDING":
    case "PROCUREMENT MANAGER":
    case "PROCUREMENT MANAGER REVIEW":
    case "PROCUREMENT MANAGER APPROVAL":
      return "RFQ Pending";
    case "PROCUREMENT REVIEW":
    case "PROCUREMENT TEAM REVIEW":
    case "PROCUREMENT TEAM APPROVAL":
      return "Procurement Review";
    // Legacy records beyond Engineering Review are routed back through the
    // Procurement Team gate unless a linked RFQ provides completion evidence.
    case "OPERATIONS REVIEW":
    case "QUALITY REVIEW":
    case "CROSS FUNCTIONAL REVIEW":
    case "PROGRAM REVIEW":
    case "ECR APPROVED":
    case "APPROVED":
    case "REQUISITION CREATION":
    case "PURCHASE REQUISITION":
    case "SUPPLIER SELECTED":
    case "SUPPLIER SELECTION":
    case "SUPPLIER RESPONSE":
    case "SUPPLIER EVALUATION":
    case "IMPLEMENTATION":
    case "VALIDATION":
    case "PROCUREMENT":
      return "Procurement Review";
    // Preserve historical terminal/revision records as non-actionable legacy
    // states. They are intentionally absent from the five-stage progress UI.
    case "NEEDS REVISION":
    case "SENT BACK":
      return "Sent Back";
    case "CLOSED":
      return "Closed";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
    case "RFQ CREATED":
    case "RFQ":
      return "RFQ";
    case "DRAFT":
      return "Draft";
    default:
      return "Unknown";
  }
}

export interface ResolvedApprovalTask {
  canAct: boolean;
  assignedTo: string;
  requiredRole: AppRole | string;
  stage: CanonicalECRStage;
  action: string;
  isReviewStage: boolean;
}

/**
 * Derives the required approval role and actionability directly from the current ECR workflow stage,
 * independent of whether a persisted approval task child row is present.
 */
export function resolveApprovalTask(
  ecrOrStatus?: Partial<EngineeringChangeRequest> | ECRStatus | string | null,
  currentUserOrRole?: AppRole | { role?: string | null } | string | null,
): ResolvedApprovalTask | null {
  const status =
    typeof ecrOrStatus === "object" && ecrOrStatus !== null && "select_pxfp" in ecrOrStatus
      ? ecrOrStatus.select_pxfp
      : (ecrOrStatus as ECRStatus | string | null | undefined);

  const role =
    typeof currentUserOrRole === "object" && currentUserOrRole !== null && "role" in currentUserOrRole
      ? currentUserOrRole.role
      : (currentUserOrRole as AppRole | string | null | undefined);

  const ecr = typeof ecrOrStatus === "object" ? ecrOrStatus : undefined;
  const canonical = canonicalECRStage(status, ecr);
  const stageConfig = getECRStageConfig(status, ecr);
  if (!stageConfig) return null;

  const reviewStages: CanonicalECRStage[] = isExtendedECRWorkflow(ecr)
    ? ["Engineering Review", "Finance Review", "Procurement BC Review", "Quality Review", "Final ECR Approval"]
    : ["Engineering Review", "Procurement Review"];
  const actionableStages: CanonicalECRStage[] = isExtendedECRWorkflow(ecr)
    ? [...reviewStages, "Business Case Approved", "ECR Approved", "Procurement Decision"]
    : [...reviewStages, "RFQ Pending"];

  const isReview = reviewStages.includes(canonical);
  if (!actionableStages.includes(canonical)) {
    return {
      canAct: false,
      assignedTo: stageConfig.responsibleTitle,
      requiredRole: stageConfig.responsibleRole,
      stage: canonical,
      action: stageConfig.decisionTitle,
      isReviewStage: false,
    };
  }

  const cleanRole = normalizeECRRoleAlias(role);
  const cleanResponsibleRole = normalizeECRRoleAlias(stageConfig.responsibleRole);
  const cleanResponsibleTitle = normalizeECRRoleAlias(stageConfig.responsibleTitle);

  const canAct = Boolean(
    role && (
      role === stageConfig.responsibleRole ||
      cleanRole === cleanResponsibleRole ||
      cleanRole === cleanResponsibleTitle ||
      (stageConfig.responsibleRole === "engineer" && (cleanRole === "engineer" || cleanRole === "leadengineer")) ||
      (stageConfig.responsibleRole === "engineering" && (cleanRole === "engineeringmanager" || cleanRole === "engineering")) ||
      (stageConfig.responsibleRole === "procurement_team" && (cleanRole === "procurementteam" || cleanRole === "procurementuser" || cleanRole === "purchaseuser")) ||
      (stageConfig.responsibleRole === "procurement" && (cleanRole === "procurementmanager" || cleanRole === "purchasemanager" || cleanRole === "procurement")) ||
      (stageConfig.responsibleRole === "operations" && (cleanRole === "operationsmanager" || cleanRole === "operations")) ||
      (stageConfig.responsibleRole === "quality" && (cleanRole === "qualitymanager" || cleanRole === "quality")) ||
      (stageConfig.responsibleRole === "finance" && (cleanRole === "financemanager" || cleanRole === "finance")) ||
      (stageConfig.responsibleRole === "program_manager" && (cleanRole === "programmanager" || cleanRole === "program_manager"))
    )
  );

  return {
    canAct,
    assignedTo: stageConfig.responsibleTitle,
    requiredRole: stageConfig.responsibleRole,
    stage: canonical,
    action: canonical === "RFQ Pending" ? "Create RFQ" : isExtendedECRWorkflow(ecr) ? stageConfig.decisionTitle : "Review and approve",
    isReviewStage: isReview,
  };
}

/** Map canonical ECR stages to high-level lifecycle status */
export function getECRHighLevelStatus(
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): ECRHighLevelStatus {
  const stage = canonicalECRStage(status, ecr);
  switch (stage) {
    case "Unknown":
      return "Unknown";
    case "Draft":
      return "Draft";
    case "Engineering Review":
    case "Procurement Review":
    case "Technical Approved":
    case "Business Case Preparation":
    case "Business Case Submitted":
    case "Finance Review":
    case "Procurement BC Review":
    case "Quality Review":
    case "Business Case Approved":
    case "Final ECR Approval":
      return "In Review";
    case "ECR Approved":
    case "Procurement Decision":
    case "Approved":
    case "Procurement":
    case "RFQ Pending":
    case "RFQ":
      return "Approved";
    case "Sent Back":
      return "Sent Back";
    case "Closed":
      return "Closed";
    case "Rejected":
    case "Cancelled":
      return "Rejected / Cancelled";
    default:
      return "Unknown";
  }
}

/** Return the specific active workflow review stage if the ECR is in review */
export function getECRReviewStage(
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): string | null {
  const stage = canonicalECRStage(status, ecr);
  return ["Engineering Review", "Procurement Review", "Finance Review", "Procurement BC Review", "Quality Review", "Final ECR Approval"].includes(stage) ? stage : null;
}

export function isTerminalECRStatus(status?: ECRStatus | string | null): boolean {
  return TERMINAL_STAGES.has(canonicalECRStage(status));
}

export const ECR_WORKSPACES: Record<ECRRole, ECRWorkspaceConfig> = {
  finance: {
    title: "ECR Financial Reviews", description: "Review financial impact and risk in ECR Business Cases.",
    queueTitle: "Business Cases Awaiting Finance", emptyTitle: "No ECRs awaiting financial review",
    detailTabs: ["Overview", "Business Case", "Approval History"],
  },
  engineer: {
    title: "Engineering Change Requests",
    description: "Create, track and manage your engineering change requests.",
    queueTitle: "My ECRs",
    emptyTitle: "No ECRs yet",
    detailTabs: [
      "Overview",
      "Change Details",
      "Affected Parts",
      "Documents",
      "Approvals",
      "Procurement",
    ],
  },
  engineering: {
    title: "Engineering Review",
    description:
      "Review technical feasibility and engineering impact of change requests.",
    queueTitle: "Engineering Review Queue",
    emptyTitle: "No ECRs awaiting engineering review",
    detailTabs: [
      "Overview",
      "Technical Assessment",
      "Affected Parts",
      "Documents",
      "Engineering Review",
      "Approvals",
    ],
    assessmentTitle: "Engineering Review",
    assessmentFields: ["Technical Feasibility", "Engineering Impact", "Technical Requirements"],
  },
  operations: {
    title: "Engineering Changes",
    description: "View engineering change requests and their current status.",
    queueTitle: "All ECRs",
    emptyTitle: "No ECRs found",
    detailTabs: ["Overview"],
  },
  quality: {
    title: "ECR Quality Reviews",
    description: "Review quality impact and risk in ECR Business Cases.",
    queueTitle: "Quality Reviews",
    emptyTitle: "No ECRs awaiting quality review",
    detailTabs: ["Overview", "Business Case", "Approval History"],
  },
  program_manager: {
    title: "Final ECR Approvals",
    description: "Review approved Business Cases and make final ECR decisions.",
    queueTitle: "Pending ECR Approvals",
    emptyTitle: "No ECRs awaiting final approval",
    detailTabs: ["Overview", "Business Case", "Approval History"],
  },
  procurement_team: {
    title: "Procurement Review",
    description: "Review supplier and RFQ requirements before manager handoff.",
    queueTitle: "Procurement Review Queue",
    emptyTitle: "No ECRs awaiting procurement review",
    detailTabs: ["Overview", "Supplier Requirement", "Procurement Review", "Approvals"],
    assessmentTitle: "Procurement Review",
    assessmentFields: ["Procurement Assessment", "Supplier Requirement", "RFQ Requirement"],
  },
  procurement: {
    title: "ECR Reference",
    description: "View engineering change records referenced by procurement activities.",
    queueTitle: "All ECRs",
    emptyTitle: "No ECR records found",
    detailTabs: ["Overview", "Supplier Requirement", "RFQ"],
  },
  admin: {
    title: "Engineering Changes Administration",
    description: "Monitor ECR workflow, access and traceability.",
    queueTitle: "All ECRs",
    emptyTitle: "No ECRs found",
    detailTabs: [
      "Overview",
      "Change Details",
      "Affected Parts",
      "Documents",
      "Approvals",
      "Procurement",
      "Activity",
    ],
  },
};

export function isECRRole(role?: AppRole | string | null): role is ECRRole {
  return Boolean(role && role in ECR_WORKSPACES);
}

export function canCreateECR(role?: AppRole | string | null): boolean {
  return role === "engineer" || role === "admin";
}

export function canEditECR(
  role: AppRole | string | null | undefined,
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
  user?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
    username?: string | null;
    role?: string | null;
  } | null,
): boolean {
  const stage = canonicalECRStage(status);
  if (stage !== "Draft") return false;
  if (role === "admin") return true;
  if (role !== "engineer") return false;
  if (ecr && user && !isEcrOwnedBy(ecr, user)) return false;
  return true;
}

export const canReviewEngineering = (role?: AppRole | string | null): boolean =>
  role === "engineering";

function denyECRWorkflowAction(role?: AppRole | string | null): boolean {
  void role;
  return false;
}

export const canReviewOperations = denyECRWorkflowAction;
export const canReviewQuality = (role?: AppRole | string | null): boolean => role === "quality";
export const canReviewFinance = (role?: AppRole | string | null): boolean => role === "finance";
export const canReviewProgram = (role?: AppRole | string | null): boolean => role === "program_manager";
/** Purchase Requisition is not part of the five-stage ECR demo workflow. */
export const canCreatePR = denyECRWorkflowAction;
/** Only the Procurement Manager owns the RFQ Pending -> RFQ handoff. */
export const canCreateRFQ = (role?: AppRole | string | null): boolean =>
  role === "procurement";
export const canEvaluateSupplier = denyECRWorkflowAction;
export const canSelectSupplier = denyECRWorkflowAction;

export function formatECRNumber(
  ecr?: { name?: string | null; ecr_number?: string | null } | string | null,
): string {
  if (!ecr) return "—";
  if (typeof ecr === "string") {
    const trimmed = ecr.trim();
    if (!trimmed) return "—";
    if (/^ECR-\d{4}-\d+/i.test(trimmed) || /^ECR-\d+/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }
    // Deterministic backfill for legacy/random Frappe alphanumeric IDs (e.g. "1j3b9i4moj")
    const hash = Math.abs(
      trimmed.split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0),
    );
    const seq = String((hash % 90000) + 10001).padStart(5, "0");
    return `ECR-2026-${seq}`;
  }

  if (ecr.ecr_number && ecr.ecr_number.trim()) {
    const trimmed = ecr.ecr_number.trim();
    if (/^ECR-\d{4}-\d+/i.test(trimmed) || /^ECR-\d+/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }
  }

  if (ecr.name && ecr.name.trim()) {
    const trimmed = ecr.name.trim();
    if (/^ECR-\d{4}-\d+/i.test(trimmed) || /^ECR-\d+/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }
    const hash = Math.abs(
      trimmed.split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0),
    );
    const seq = String((hash % 90000) + 10001).padStart(5, "0");
    return `ECR-2026-${seq}`;
  }

  return "ECR-2026-00001";
}

export function isEcrOwnedBy(
  ecr?: Partial<EngineeringChangeRequest> | null,
  user?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
    username?: string | null;
    role?: string | null;
  } | null,
): boolean {
  if (!ecr || !user) return false;
  if (user.role === "admin") return true;

  const identities = new Set(
    [user.id, user.name, user.email, user.username]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase()),
  );
  if (identities.size === 0) return false;

  const candidateOwners = [
    ecr.ecr_owner,
    ecr.amended_from,
    ecr.owner,
    (ecr as Record<string, unknown>).creation_user as string | undefined,
    (ecr as Record<string, unknown>).created_by as string | undefined,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  return candidateOwners.some((candidate) => {
    if (identities.has(candidate)) return true;
    for (const id of identities) {
      if (candidate === id) return true;
      if (candidate.includes("@") && candidate.split("@")[0] === id) return true;
      if (id.includes("@") && id.split("@")[0] === candidate) return true;
    }
    return false;
  });
}

export function getECRWorkflowActions(
  role: AppRole | string | null | undefined,
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): ECRWorkflowAction[] {
  const stage = canonicalECRStage(status, ecr);
  if (isExtendedECRWorkflow(ecr)) {
    // Business Case decisions are executed only through the linked Business Case endpoint.
    if (isECRBusinessCaseReviewStage(stage) || stage === "Procurement Review" || stage === "RFQ Pending") return [];
    if (role === "engineering" && stage === "Engineering Review") return [
      { label: "Send Back", action: "Send Back", tone: "secondary" },
      { label: "Reject", action: "Reject", tone: "danger" },
      { label: "Technical Approval", action: "Approve", tone: "primary" },
    ];
    if (role === "program_manager" && stage === "Business Case Approved") return [
      { label: "Start Final Review", action: "Start Final Review", tone: "primary" },
    ];
    if (role === "program_manager" && stage === "Final ECR Approval") return [
      { label: "Send Back", action: "Send Back", tone: "secondary" },
      { label: "Reject", action: "Reject", tone: "danger" },
      { label: "Approve ECR", action: "Approve ECR", tone: "primary" },
    ];
    if (role === "procurement" && stage === "ECR Approved") return [
      { label: "Request Sourcing Revision", action: "Request Sourcing Revision", tone: "secondary" },
    ];
    if (role === "procurement" && stage === "Procurement Decision" && ecr?.rfq_required === "Yes") return [
      { label: "Create RFQ", action: "Create RFQ", tone: "primary" },
    ];
    return [];
  }

  // Draft ECRs are not under review; submission is handled via the draft submission banner
  if (stage === "Draft") {
    return [];
  }

  if (role === "engineer") {
    return [];
  }

  if (role === "engineering" && stage === "Engineering Review") {
    return [
      { label: "Send Back", action: "Send Back", tone: "secondary" },
      { label: "Reject", action: "Reject", tone: "danger" },
      { label: "Approve", action: "Approve", tone: "primary" },
    ];
  }
  if (role === "procurement_team" && stage === "Procurement Review") {
    return [
      { label: "Send Back", action: "Send Back", tone: "secondary" },
      { label: "Reject", action: "Reject", tone: "danger" },
      { label: "Approve", action: "Approve", tone: "primary" },
    ];
  }
  if (role === "procurement" && stage === "RFQ Pending") {
    return [{ label: "Create RFQ", action: "Create RFQ", tone: "primary" }];
  }
  return [];
}

export function canReviewECR(
  roleOrUser: AppRole | { role?: string | null } | string | null | undefined,
  statusOrEcr?: ECRStatus | Partial<EngineeringChangeRequest> | string | null,
): boolean {
  const role = typeof roleOrUser === "object" && roleOrUser !== null ? roleOrUser.role : roleOrUser;
  if (!role) return false;
  const status =
    typeof statusOrEcr === "object" && statusOrEcr !== null
      ? statusOrEcr.select_pxfp
      : statusOrEcr;
  const ecr = typeof statusOrEcr === "object" ? statusOrEcr : undefined;
  const stage = canonicalECRStage(status, ecr);
  if (isExtendedECRWorkflow(ecr)) {
    return resolveApprovalTask(ecr, role)?.isReviewStage === true && resolveApprovalTask(ecr, role)?.canAct === true;
  }

  switch (stage) {
    case "Engineering Review":
      return role === "engineering";
    case "Procurement Review":
      return role === "procurement_team";
    default:
      return false;
  }
}

export function canApproveECR(
  roleOrUser: AppRole | { role?: string | null } | string | null | undefined,
  statusOrEcr?: ECRStatus | Partial<EngineeringChangeRequest> | string | null,
): boolean {
  const role = typeof roleOrUser === "object" && roleOrUser !== null ? roleOrUser.role : roleOrUser;
  const status =
    typeof statusOrEcr === "object" && statusOrEcr !== null
      ? statusOrEcr.select_pxfp
      : statusOrEcr;
  return getECRWorkflowActions(role, status, typeof statusOrEcr === "object" ? statusOrEcr : undefined).some((action) =>
    /approve|validation passed/i.test(action.label),
  );
}

export function canSendBackECR(
  roleOrUser: AppRole | { role?: string | null } | string | null | undefined,
  statusOrEcr?: ECRStatus | Partial<EngineeringChangeRequest> | string | null,
): boolean {
  const role = typeof roleOrUser === "object" && roleOrUser !== null ? roleOrUser.role : roleOrUser;
  const status =
    typeof statusOrEcr === "object" && statusOrEcr !== null
      ? statusOrEcr.select_pxfp
      : statusOrEcr;
  return getECRWorkflowActions(role, status, typeof statusOrEcr === "object" ? statusOrEcr : undefined).some((action) =>
    /send back|revision/i.test(action.label),
  );
}

export function canRejectECR(
  roleOrUser: AppRole | { role?: string | null } | string | null | undefined,
  statusOrEcr?: ECRStatus | Partial<EngineeringChangeRequest> | string | null,
): boolean {
  const role = typeof roleOrUser === "object" && roleOrUser !== null ? roleOrUser.role : roleOrUser;
  const status =
    typeof statusOrEcr === "object" && statusOrEcr !== null
      ? statusOrEcr.select_pxfp
      : statusOrEcr;
  return getECRWorkflowActions(role, status, typeof statusOrEcr === "object" ? statusOrEcr : undefined).some((action) =>
    /reject|validation failed/i.test(action.label),
  );
}

export function canAccessECRRecord(
  role: AppRole | string | null | undefined,
  ecr: EngineeringChangeRequest,
  user?: { name?: string | null; email?: string | null } | null,
): boolean {
  if (role === "engineer") return isEcrOwnedBy(ecr, user);
  return isECRRole(role);
}

export function isECRQueueItem(
  role: ECRRole,
  ecr: EngineeringChangeRequest,
): boolean {
  const stage = ecr.rfq ? "RFQ" : canonicalECRStage(ecr.select_pxfp, ecr);
  if (isExtendedECRWorkflow(ecr)) {
    if (role === "engineer") return ["Draft", "Technical Approved", "Business Case Preparation"].includes(stage);
    const task = resolveApprovalTask(ecr, role);
    return Boolean(task?.canAct);
  }
  switch (role) {
    case "engineer":
      return stage === "Draft";
    case "engineering":
      return stage === "Engineering Review";
    case "procurement_team":
      return stage === "Procurement Review";
    case "procurement":
      return stage === "RFQ Pending" && !ecr.rfq;
    case "admin":
      return false;
    default:
      return false;
  }
}

export function ecrStageIndex(
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): number {
  const stage = canonicalECRStage(status, ecr);
  const stages = getApplicableECRWorkflowStages(ecr);
  const idx = stages.findIndex((item) => item.id === stage);
  return idx;
}

export function getECRNextStatus(
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): string {
  const stage = canonicalECRStage(status, ecr);
  if (isExtendedECRWorkflow(ecr)) {
    if (stage === "Closed" || stage === "RFQ") return "Completed";
    return getECRStageConfig(status, ecr)?.nextStage ?? "None";
  }

  switch (stage) {
    case "Draft":
      return "Engineering Review";
    case "Engineering Review":
      return "Procurement Review";
    case "Procurement Review":
      return "RFQ Pending";
    case "RFQ Pending":
      return "RFQ";
    case "Approved":
    case "Procurement":
      return "Procurement Review";
    case "RFQ":
      return "Completed";
    default:
      return "None";
  }
}

export interface ECRStatusCardInfo {
  status: string;
  nextStatus: string;
  assignedToLabel: "Owner" | "Assigned To" | "Responsible";
  assignedToValue: string;
  actionLabel: "Next Action" | "Action Required";
  actionValue: string;
}

/**
 * Returns clean, enterprise status metadata representing ONLY the current state of an ECR.
 */
export function getECRStatusCardInfo(
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): ECRStatusCardInfo {
  const canonical = ecr?.rfq ? "RFQ" : canonicalECRStage(status, ecr);
  const nextStatus = getECRNextStatus(canonical, ecr);
  const ownerName = ecr?.ecr_owner || ecr?.owner || "Engineer";
  const verifiedAssignee = (approvalRole: string, fallback: string) => {
    if (!ecr || !Array.isArray(ecr.approval_requirements)) return fallback;
    const pending = ecr.approval_requirements.filter(
      (task) => task.status === "Pending",
    );
    return pending.length === 1 &&
      Number(pending[0]?.required || 0) === 1 &&
      normalizeECRRoleAlias(pending[0]?.approval_role) === normalizeECRRoleAlias(approvalRole)
      ? fallback
      : "Unassigned";
  };

  if (isExtendedECRWorkflow(ecr)) {
    const config = getECRStageConfig(canonical, ecr);
    if (config && canonical !== "Draft" && canonical !== "RFQ") {
      const ownerStage = ["Technical Approved", "Business Case Preparation", "Business Case Submitted"].includes(canonical);
      return {
        status: canonical, nextStatus,
        assignedToLabel: ownerStage ? "Owner" : "Assigned To",
        assignedToValue: ownerStage ? ownerName : verifiedAssignee(config.responsibleTitle, config.responsibleTitle),
        actionLabel: "Action Required", actionValue: config.decisionTitle,
      };
    }
  }

  switch (canonical) {
    case "Unknown":
      return {
        status: "Unknown",
        nextStatus: "None",
        assignedToLabel: "Responsible",
        assignedToValue: "Unassigned",
        actionLabel: "Next Action",
        actionValue: "No workflow action available",
      };
    case "Draft":
      return {
        status: "Draft",
        nextStatus,
        assignedToLabel: "Owner",
        assignedToValue: ownerName,
        actionLabel: "Next Action",
        actionValue: "Submit for Engineering Review",
      };
    case "Engineering Review":
      return {
        status: "Engineering Review",
        nextStatus,
        assignedToLabel: "Assigned To",
        assignedToValue: verifiedAssignee("Engineering Manager", "Engineering Manager"),
        actionLabel: "Action Required",
        actionValue: "Review and approve",
      };
    case "Procurement Review":
      return {
        status: "Procurement Review",
        nextStatus,
        assignedToLabel: "Assigned To",
        assignedToValue: verifiedAssignee("Procurement Team", "Procurement Team"),
        actionLabel: "Action Required",
        actionValue: "Review and approve",
      };
    case "RFQ Pending":
      return {
        status: "RFQ Pending",
        nextStatus,
        assignedToLabel: "Assigned To",
        assignedToValue: verifiedAssignee("Procurement Manager", "Procurement Manager"),
        actionLabel: "Action Required",
        actionValue: "Create RFQ",
      };
    case "Sent Back":
      return {
        status: "Sent Back",
        nextStatus: "None",
        assignedToLabel: "Responsible",
        assignedToValue: ownerName,
        actionLabel: "Next Action",
        actionValue: "Historical revision state — no workflow action",
      };
    case "Approved":
    case "Procurement":
      return {
        status: "Procurement Review",
        nextStatus: "RFQ Pending",
        assignedToLabel: "Assigned To",
        assignedToValue: verifiedAssignee("Procurement Team", "Procurement Team"),
        actionLabel: "Action Required",
        actionValue: "Review and approve",
      };
    case "RFQ":
      return {
        status: "RFQ",
        nextStatus: "Completed",
        assignedToLabel: "Responsible",
        assignedToValue: "Procurement Team / RFQ process",
        actionLabel: "Next Action",
        actionValue: "RFQ created",
      };
    case "Closed":
      return {
        status: "Closed",
        nextStatus: "Completed",
        assignedToLabel: "Responsible",
        assignedToValue: "Procurement Manager",
        actionLabel: "Next Action",
        actionValue: isExtendedECRWorkflow(ecr) && ecr?.rfq_required === "No" ? "RFQ not required — procurement decision recorded" : "Change completed and archived",
      };
    case "Rejected":
      return {
        status: "Rejected",
        nextStatus: "None",
        assignedToLabel: "Responsible",
        assignedToValue: ownerName,
        actionLabel: "Next Action",
        actionValue: "No further workflow action — ECR rejected",
      };
    case "Cancelled":
      return {
        status: "Cancelled",
        nextStatus: "None",
        assignedToLabel: "Responsible",
        assignedToValue: ownerName,
        actionLabel: "Next Action",
        actionValue: "Change request cancelled",
      };
    default:
      return {
        status: canonical || String(status || "Draft"),
        nextStatus,
        assignedToLabel: "Owner",
        assignedToValue: ownerName,
        actionLabel: "Next Action",
        actionValue: "Review ECR details",
      };
  }
}
