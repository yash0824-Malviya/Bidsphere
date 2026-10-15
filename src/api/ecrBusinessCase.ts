import { apiGet, apiPost, withoutNetworkRetry } from "./erpnext";
import { extractECRErrorMessage, resolveECRName } from "./ecr";
import { createNotification, upsertNotification } from "./notifications";
import { formatECRNumber } from "../config/ecrRoles";
import type { EngineeringChangeRequest } from "../types/erpnext";
import type { NotificationTargetRole } from "../types/notification";
import type { ECRBusinessCaseAggregate, ECRBusinessCasePayload, ECRBusinessCaseReviewRole } from "../types/ecrBusinessCase";

function unwrapAggregate(response: ECRBusinessCaseAggregate | { data: ECRBusinessCaseAggregate }): ECRBusinessCaseAggregate {
  const aggregate = response && "data" in response ? response.data : response;
  if (!aggregate?.ecr?.name || !("businessCase" in aggregate)) throw new Error("The server returned an incomplete Business Case. Reload the ECR and try again.");
  return aggregate;
}

export async function fetchECRBusinessCase(ecrName: string): Promise<ECRBusinessCaseAggregate> {
  const resolved = await resolveECRName(ecrName);
  const response = await apiGet<ECRBusinessCaseAggregate | { data: ECRBusinessCaseAggregate }>(`/api/ecr-business-case?ecr=${encodeURIComponent(resolved)}`);
  return unwrapAggregate(response);
}

export type ECRBusinessCaseAction = "save" | "submit" | "approve" | "send_back" | "reject";
export async function applyECRBusinessCaseAction(
  ecr: Pick<EngineeringChangeRequest, "name" | "modified">,
  action: ECRBusinessCaseAction,
  options: { payload?: ECRBusinessCasePayload; comment?: string; role?: ECRBusinessCaseReviewRole; rfq_required?: "Yes" | "No"; rfq_decision_reason?: string } = {},
): Promise<ECRBusinessCaseAggregate> {
  if (!ecr.modified) throw new Error("Refresh the ECR before saving or reviewing its Business Case.");
  try {
    const response = await apiPost<ECRBusinessCaseAggregate | { data: ECRBusinessCaseAggregate }>("/api/ecr-business-case", {
      ecr_name: ecr.name,
      expected_modified: ecr.modified,
      action,
      ...options,
    }, withoutNetworkRetry());
    const aggregate = unwrapAggregate(response);
    if (action !== "save") notifyECRStageChange(aggregate.ecr);
    return aggregate;
  } catch (error) { throw new Error(extractECRErrorMessage(error)); }
}

export const createECRBusinessCase = (ecr: Pick<EngineeringChangeRequest, "name" | "modified">, payload: ECRBusinessCasePayload) => applyECRBusinessCaseAction(ecr, "save", { payload });
export const submitECRBusinessCase = (ecr: Pick<EngineeringChangeRequest, "name" | "modified">, payload: ECRBusinessCasePayload) => applyECRBusinessCaseAction(ecr, "submit", { payload });
export const approveECRBusinessCaseByRole = (ecr: Pick<EngineeringChangeRequest, "name" | "modified">, role: ECRBusinessCaseReviewRole, comment: string) => applyECRBusinessCaseAction(ecr, "approve", { role, comment });
export const sendBackECRBusinessCase = (ecr: Pick<EngineeringChangeRequest, "name" | "modified">, role: ECRBusinessCaseReviewRole, comment: string) => applyECRBusinessCaseAction(ecr, "send_back", { role, comment });
export const rejectECRBusinessCase = (ecr: Pick<EngineeringChangeRequest, "name" | "modified">, role: ECRBusinessCaseReviewRole, comment: string) => applyECRBusinessCaseAction(ecr, "reject", { role, comment });

/** Mirrors persisted assignments into the existing in-app notification store. */
export function notifyECRStageChange(ecr: Partial<EngineeringChangeRequest>, preserveReadState = false) {
  if (ecr.ecr_workflow_version !== "extended_v1" || !ecr.name || typeof localStorage === "undefined") return;
  const stage = ecr.select_pxfp || ecr.status || "";
  const recipient: Partial<Record<string, NotificationTargetRole>> = {
    "Engineering Review": "engineering", "Technical Approved": "engineer",
    "Finance Review": "finance", "Procurement BC Review": "procurement", "Quality Review": "quality",
    "Business Case Approved": "program_manager", "Final ECR Approval": "program_manager",
    "ECR Approved": "procurement", "Procurement Decision": "procurement", "Rejected": "engineer", "Closed": "engineer",
  };
  const role = recipient[stage];
  if (!role) return;
  const businessCaseStage = ["Technical Approved", "Finance Review", "Procurement BC Review", "Quality Review"].includes(stage);
  try {
    (preserveReadState ? upsertNotification : createNotification)({
      title: `${formatECRNumber(ecr)} · ${stage}`,
      description: stage === "Technical Approved" ? "Prepare or revise the linked Business Case." : `Engineering change ${formatECRNumber(ecr)} is now at ${stage}.`,
      module: "Engineering Change", event_type: `ecr_${stage.toLowerCase().replaceAll(" ", "_")}_${ecr.modified || ""}`,
      target_role: role, ...(role === "engineer" ? { target_user: ecr.ecr_owner || ecr.owner } : {}),
      document_type: "Engineering Change Request", document_name: ecr.name,
      route_path: `/ecr/${encodeURIComponent(formatECRNumber(ecr))}${businessCaseStage ? "/business-case" : ""}`,
    });
  } catch { /* Persisted ECR state remains authoritative when browser storage is unavailable. */ }
}
