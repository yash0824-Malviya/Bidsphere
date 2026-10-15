import { formatECRNumber, getECRHighLevelStatus } from "../../config/ecrRoles";
import { getECRCurrentStage } from "../../config/ecrQueues";
import type { EngineeringChangeRequest } from "../../types/erpnext";
import { activeQueueValue, matchesVisibleQueueFilter } from "./ecrListPresentation";
import type { useAuthStore } from "../../store/authStore";

export const ENGINEER_MY_ECR_TABS = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Pending Approval", value: "pending-approval" },
  { label: "Sent Back", value: "sent-back" },
  { label: "Approved", value: "approved" },
  { label: "Closed", value: "closed" },
];

export function engineerMyECRTab(filter: string): string {
  const active = activeQueueValue(filter, "engineer");
  return active === "mine" ? "all" : active;
}

export function filterEngineerMyECRs(
  ecrs: EngineeringChangeRequest[],
  params: URLSearchParams,
  user: ReturnType<typeof useAuthStore.getState>["user"],
  search = params.get("q") || "",
): EngineeringChangeRequest[] {
  const term = search.trim().toLowerCase();
  const filter = params.get("filter") || "all";
  const matches = (key: string, value?: string | null) => !params.get(key) || params.get(key) === "all" || params.get(key) === value;
  return ecrs.filter((ecr) =>
    matchesVisibleQueueFilter(filter, "engineer", ecr, user) &&
    matches("status", getECRHighLevelStatus(ecr.select_pxfp, ecr)) &&
    matches("priority", ecr.priority) &&
    matches("department", ecr.requesting_department) &&
    matches("supplier", ecr.supplier_response_required) &&
    matches("type", ecr.ecr_type) &&
    matches("target-date", ecr.target_implementation_date) &&
    (!term || [ecr.name, formatECRNumber(ecr), ecr.ecr_title, ecr.requesting_department, ecr.program, getECRCurrentStage(ecr.select_pxfp, ecr)].some((value) => String(value || "").toLowerCase().includes(term))),
  );
}
