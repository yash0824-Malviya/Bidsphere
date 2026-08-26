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
};

const REQUIRED_REVIEW_ASSESSMENT_FIELDS_BY_STATUS: Readonly<Record<string, readonly string[]>> = {
  "Engineering Review": ["Technical Feasibility", "Engineering Impact"],
  "Procurement Review": [
    "Procurement Assessment",
    "Supplier Requirement",
    "RFQ Requirement",
  ],
};

const REVIEW_ASSESSMENT_ALLOWED_VALUES_BY_STATUS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  "Procurement Review": {
    "Supplier Requirement": ["Yes", "No"],
    "RFQ Requirement": ["Required", "Not Required"],
  },
};

const APPROVAL_ROLE_BY_STATUS: Readonly<Record<string, string>> = {
  "Engineering Review": "Engineering Manager",
  "Procurement Review": "Procurement Team",
  "RFQ Pending": "Procurement Manager",
};

const APP_ROLE_BY_APPROVAL_ROLE: Readonly<Record<string, string>> = {
  "Engineering Manager": "engineering",
  "Procurement Team": "procurement_team",
  "Procurement Manager": "procurement",
};

export function getEcrWorkflowTransition(
  currentStatus: string,
  action: string,
): EcrWorkflowTransition | null {
  const canonicalStatus = canonicalWorkflowStatus(currentStatus);
  return ECR_WORKFLOW_TRANSITIONS.find(
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
  return String(status ?? "").trim();
}
