export interface EcrWorkflowTransition {
  action: string;
  currentStatus: string;
  nextStatus: string;
  roles: string[];
  decision: "none" | "approved" | "sent_back" | "rejected" | "revision_completed";
  requiresComment?: boolean;
}

/** Shared server-side sequential ECR demo state machine. */
export const ECR_WORKFLOW_TRANSITIONS: readonly EcrWorkflowTransition[] = [
  { currentStatus: "Draft", action: "Submit ECR", nextStatus: "Engineering Review", roles: ["engineer"], decision: "none" },
  { currentStatus: "Engineering Review", action: "Send Back", nextStatus: "Draft", roles: ["engineering"], decision: "sent_back", requiresComment: true },
  { currentStatus: "Engineering Review", action: "Reject", nextStatus: "Rejected", roles: ["engineering"], decision: "rejected", requiresComment: true },
  { currentStatus: "Engineering Review", action: "Approve", nextStatus: "Procurement Review", roles: ["engineering"], decision: "approved" },
  { currentStatus: "Procurement Review", action: "Send Back", nextStatus: "Draft", roles: ["procurement_team"], decision: "sent_back", requiresComment: true },
  { currentStatus: "Procurement Review", action: "Reject", nextStatus: "Rejected", roles: ["procurement_team"], decision: "rejected", requiresComment: true },
  { currentStatus: "Procurement Review", action: "Approve", nextStatus: "RFQ Pending", roles: ["procurement_team"], decision: "approved" },
  { currentStatus: "RFQ Pending", action: "Create RFQ", nextStatus: "RFQ", roles: ["procurement"], decision: "none" },

] as const;

export const EXTENDED_ECR_WORKFLOW_VERSION = "extended_v1";
export function isExtendedEcr(document: { ecr_workflow_version?: unknown }): boolean {
  return document.ecr_workflow_version === EXTENDED_ECR_WORKFLOW_VERSION;
}

/** Only trusted generic actions. Business Case reviews use their dedicated endpoint. */
export const ECR_EXTENDED_WORKFLOW_TRANSITIONS: readonly EcrWorkflowTransition[] = [
  ...ECR_WORKFLOW_TRANSITIONS.filter((transition) =>
    transition.currentStatus === "Draft" ||
    (transition.currentStatus === "Engineering Review" && transition.action !== "Approve")),
  { currentStatus: "Engineering Review", action: "Approve", nextStatus: "Technical Approved", roles: ["engineering"], decision: "approved" },
  // ── Extended workflow: Technical Approval → Business Case → Multi-role review → Final ECR Approval ──
  // Engineering Manager approves to Technical Approved (extended flow)
  { currentStatus: "Engineering Review", action: "Approve Technical", nextStatus: "Technical Approved", roles: ["engineering"], decision: "approved" },
  // The following Business Case transitions are used for schema migration only.
  // getEcrWorkflowTransition excludes them from the generic endpoint.
  { currentStatus: "Technical Approved", action: "Submit Business Case", nextStatus: "Business Case Submitted", roles: ["engineer"], decision: "none" },
  // Business Case review: Finance Manager
  { currentStatus: "Business Case Submitted", action: "Start Finance Review", nextStatus: "Finance Review", roles: ["finance"], decision: "none" },
  { currentStatus: "Finance Review", action: "Approve Finance", nextStatus: "Procurement BC Review", roles: ["finance"], decision: "approved" },
  { currentStatus: "Finance Review", action: "Send Back Finance", nextStatus: "Technical Approved", roles: ["finance"], decision: "sent_back", requiresComment: true },
  { currentStatus: "Finance Review", action: "Reject Finance", nextStatus: "Rejected", roles: ["finance"], decision: "rejected", requiresComment: true },
  // Business Case review: Procurement Manager
  { currentStatus: "Procurement BC Review", action: "Approve Procurement", nextStatus: "Quality Review", roles: ["procurement"], decision: "approved" },
  { currentStatus: "Procurement BC Review", action: "Send Back Procurement", nextStatus: "Technical Approved", roles: ["procurement"], decision: "sent_back", requiresComment: true },
  { currentStatus: "Procurement BC Review", action: "Reject Procurement", nextStatus: "Rejected", roles: ["procurement"], decision: "rejected", requiresComment: true },
  // Business Case review: Quality Manager
  { currentStatus: "Quality Review", action: "Approve Quality", nextStatus: "Business Case Approved", roles: ["quality"], decision: "approved" },
  { currentStatus: "Quality Review", action: "Send Back Quality", nextStatus: "Technical Approved", roles: ["quality"], decision: "sent_back", requiresComment: true },
  { currentStatus: "Quality Review", action: "Reject Quality", nextStatus: "Rejected", roles: ["quality"], decision: "rejected", requiresComment: true },
  // Final ECR Approval by Program Manager (Final ECR Approver)
  { currentStatus: "Business Case Approved", action: "Start Final Review", nextStatus: "Final ECR Approval", roles: ["program_manager"], decision: "none" },
  { currentStatus: "Final ECR Approval", action: "Approve ECR", nextStatus: "ECR Approved", roles: ["program_manager"], decision: "approved" },
  { currentStatus: "Final ECR Approval", action: "Send Back ECR", nextStatus: "Technical Approved", roles: ["program_manager"], decision: "sent_back", requiresComment: true },
  { currentStatus: "Final ECR Approval", action: "Reject ECR", nextStatus: "Rejected", roles: ["program_manager"], decision: "rejected", requiresComment: true },
  // Procurement Decision after ECR Approved
  { currentStatus: "ECR Approved", action: "Record Procurement Decision", nextStatus: "Procurement Decision", roles: ["procurement"], decision: "none" },
  { currentStatus: "ECR Approved", action: "Request Sourcing Revision", nextStatus: "Draft", roles: ["procurement"], decision: "sent_back", requiresComment: true },
  { currentStatus: "Procurement Decision", action: "Create RFQ", nextStatus: "RFQ", roles: ["procurement"], decision: "none" },
] as const;

/**
 * Canonical reviewer assessments accepted by the trusted workflow endpoint.
 * Required fields are declared separately so each role-specific review card
 * and the trusted endpoint share the same validation contract.
 */
const REVIEW_ASSESSMENT_FIELDS_BY_STATUS: Readonly<Record<string, readonly string[]>> = {
  "Engineering Review": [
    "Technical Feasibility",
    "Engineering Impact",
    "Technical Requirements",
  ],
  "Procurement Review": [
    "Procurement Assessment",
    "Supplier Requirement",
    "RFQ Requirement",
  ],
  "Finance Review": [
    "Financial Justification",
    "Budget Impact",
    "ROI Assessment",
  ],
  "Procurement BC Review": [
    "Supplier Impact Assessment",
    "RFQ Required",
    "Commercial Impact",
  ],
  "Quality Review": [
    "Quality Impact Assessment",
    "Testing Required",
    "Compliance Impact",
  ],
  "Final ECR Approval": [
    "Technical Review",
    "Business Case Summary",
    "Final Decision Rationale",
  ],
};

const REQUIRED_REVIEW_ASSESSMENT_FIELDS_BY_STATUS: Readonly<Record<string, readonly string[]>> = {
  "Engineering Review": ["Technical Feasibility", "Engineering Impact"],
  "Procurement Review": [
    "Procurement Assessment",
    "Supplier Requirement",
    "RFQ Requirement",
  ],
  "Finance Review": ["Financial Justification", "Budget Impact"],
  "Procurement BC Review": ["Supplier Impact Assessment", "RFQ Required"],
  "Quality Review": ["Quality Impact Assessment"],
  "Final ECR Approval": ["Final Decision Rationale"],
};

const REVIEW_ASSESSMENT_ALLOWED_VALUES_BY_STATUS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  "Procurement Review": {
    "Supplier Requirement": ["Yes", "No"],
    "RFQ Requirement": ["Required", "Not Required"],
  },
  "Procurement BC Review": {
    "RFQ Required": ["Yes", "No"],
  },
};

const APPROVAL_ROLE_BY_STATUS: Readonly<Record<string, string>> = {
  "Engineering Review": "Engineering Manager",
  "Procurement Review": "Procurement Team",
  "RFQ Pending": "Procurement Manager",
  // Extended workflow
  "Technical Approved": "Engineer",
  "Business Case Submitted": "Finance Manager",
  "Finance Review": "Finance Manager",
  "Procurement BC Review": "Procurement Manager",
  "Quality Review": "Quality Manager",
  "Business Case Approved": "Program Manager",
  "Final ECR Approval": "Program Manager",
  "ECR Approved": "Procurement Manager",
  "Procurement Decision": "Procurement Manager",
};

const APP_ROLE_BY_APPROVAL_ROLE: Readonly<Record<string, string>> = {
  "Engineering Manager": "engineering",
  "Procurement Team": "procurement_team",
  "Procurement Manager": "procurement",
  // Extended workflow
  "Engineer": "engineer",
  "Finance Manager": "finance",
  "Quality Manager": "quality",
  "Program Manager": "program_manager",
};

export function getEcrWorkflowTransition(
  currentStatus: string,
  action: string,
  workflowVersion?: unknown,
): EcrWorkflowTransition | null {
  const canonicalStatus = canonicalWorkflowStatus(currentStatus);
  const extended = workflowVersion === EXTENDED_ECR_WORKFLOW_VERSION;
  if (extended && ["Technical Approved", "Business Case Submitted", "Finance Review", "Procurement BC Review", "Quality Review"].includes(canonicalStatus)) return null;
  return (extended ? ECR_EXTENDED_WORKFLOW_TRANSITIONS : ECR_WORKFLOW_TRANSITIONS).find(
    (transition) =>
      transition.currentStatus === canonicalStatus && transition.action === action,
  ) ?? null;
}

export function activeApprovalRoleForStatus(status: string): string | null {
  const canonicalStatus = canonicalWorkflowStatus(status);
  return APPROVAL_ROLE_BY_STATUS[canonicalStatus] ?? null;
}

export function appRoleForApprovalRole(approvalRole: string): string | null {
  return APP_ROLE_BY_APPROVAL_ROLE[canonicalApprovalRole(approvalRole)] ?? null;
}

export function reviewAssessmentFieldsForStatus(status: string): readonly string[] {
  const canonicalStatus = canonicalWorkflowStatus(status);
  return REVIEW_ASSESSMENT_FIELDS_BY_STATUS[canonicalStatus] ?? [];
}

export function requiredReviewAssessmentFieldsForStatus(status: string): readonly string[] {
  const canonicalStatus = canonicalWorkflowStatus(status);
  return REQUIRED_REVIEW_ASSESSMENT_FIELDS_BY_STATUS[canonicalStatus] ?? [];
}

export function reviewAssessmentAllowedValuesForStatus(
  status: string,
): Readonly<Record<string, readonly string[]>> {
  const canonicalStatus = canonicalWorkflowStatus(status);
  return REVIEW_ASSESSMENT_ALLOWED_VALUES_BY_STATUS[canonicalStatus] ?? {};
}

function normalizedWorkflowToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function canonicalApprovalRole(approvalRole: string): string {
  const normalized = normalizedWorkflowToken(approvalRole);
  if ([
    "ENGINEERING MANAGER",
    "ENGINEERING MANAGER APPROVAL",
    "ENGINEERING MANAGER REVIEW",
    "ENGINEERING",
  ].includes(normalized)) {
    return "Engineering Manager";
  }
  if ([
    "PROCUREMENT TEAM",
    "PROCUREMENT TEAM APPROVAL",
    "PROCUREMENT TEAM REVIEW",
    "PROCUREMENT USER",
    "PURCHASE USER",
  ].includes(normalized)) {
    return "Procurement Team";
  }
  if ([
    "PROCUREMENT MANAGER",
    "PROCUREMENT MANAGER APPROVAL",
    "PROCUREMENT MANAGER REVIEW",
    "PURCHASE MANAGER",
    "PROCUREMENT",
  ].includes(normalized)) {
    return "Procurement Manager";
  }
  if (["FINANCE MANAGER", "FINANCE", "ACCOUNTS MANAGER"].includes(normalized)) {
    return "Finance Manager";
  }
  if (["QUALITY MANAGER", "QUALITY"].includes(normalized)) {
    return "Quality Manager";
  }
  if (["PROGRAM MANAGER", "PROGRAM_MANAGER", "FINAL ECR APPROVER", "FINAL APPROVER"].includes(normalized)) {
    return "Program Manager";
  }
  if (["ENGINEER", "ECR OWNER"].includes(normalized)) {
    return "Engineer";
  }
  return String(approvalRole ?? "").trim();
}

export function canonicalWorkflowStatus(status: string): string {
  const normalized = normalizedWorkflowToken(status);
  if ([
    "ENGINEERING REVIEW",
    "ENGINEERING MANAGER APPROVAL",
    "ENGINEERING MANAGER REVIEW",
    "EM APPROVAL",
    "SUBMITTED",
    "UNDER REVIEW",
  ].includes(normalized)) {
    return "Engineering Review";
  }
  if (normalized === "DRAFT") return "Draft";
  if ([
    "PROCUREMENT",
    "PROCUREMENT REVIEW",
    "PROCUREMENT TEAM",
    "PROCUREMENT TEAM REVIEW",
  ].includes(normalized)) {
    return "Procurement Review";
  }
  if (["RFQ PENDING", "PROCUREMENT MANAGER"].includes(normalized)) {
    return "RFQ Pending";
  }
  if (normalized === "RFQ" || normalized === "RFQ CREATED") return "RFQ";
  // Extended workflow statuses
  if (["TECHNICAL APPROVED", "TECHNICAL APPROVAL"].includes(normalized)) return "Technical Approved";
  if (["BUSINESS CASE PREPARATION", "BUSINESS CASE PREP", "BC PREP"].includes(normalized)) return "Technical Approved";
  if (["BUSINESS CASE SUBMITTED", "BC SUBMITTED"].includes(normalized)) return "Business Case Submitted";
  if (["FINANCE REVIEW", "FINANCIAL REVIEW", "FINANCE APPROVAL"].includes(normalized)) return "Finance Review";
  if (["PROCUREMENT BC REVIEW", "PROCUREMENT BUSINESS CASE REVIEW", "PROCUREMENT REVIEW BC"].includes(normalized)) return "Procurement BC Review";
  if (["QUALITY REVIEW", "QUALITY APPROVAL", "QUALITY CHECK"].includes(normalized)) return "Quality Review";
  if (["BUSINESS CASE APPROVED", "BC APPROVED"].includes(normalized)) return "Business Case Approved";
  if (["FINAL ECR APPROVAL", "FINAL APPROVAL", "PROGRAM REVIEW", "FINAL ECR REVIEW"].includes(normalized)) return "Final ECR Approval";
  if (["ECR APPROVED", "APPROVED", "ECR APPROVAL"].includes(normalized)) return "ECR Approved";
  if (["PROCUREMENT DECISION", "RFQ DECISION"].includes(normalized)) return "Procurement Decision";
  if (["NEEDS REVISION", "SENT BACK"].includes(normalized)) return "Sent Back";
  if (normalized === "CLOSED") return "Closed";
  if (normalized === "REJECTED") return "Rejected";
  if (normalized === "CANCELLED") return "Cancelled";
  return String(status ?? "").trim();
}
