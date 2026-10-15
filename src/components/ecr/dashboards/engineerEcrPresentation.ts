import { Archive, CheckCircle2, ClipboardList, Clock3, FileSearch, RotateCcw } from "lucide-react";
import { getECRQueueSummary, matchesECRQueueFilter } from "../../../config/ecrQueues";
import type { useAuthStore } from "../../../store/authStore";
import type { EngineeringChangeRequest } from "../../../types/erpnext";

type EngineerUser = ReturnType<typeof useAuthStore.getState>["user"];
export function engineerECRMetrics(ecrs: EngineeringChangeRequest[], user: EngineerUser) {
  const summary = getECRQueueSummary("engineer", ecrs, user);
  return [
    { label: "My ECRs", value: summary.mine, hint: "ECRs created by me", icon: ClipboardList, filter: "mine", tone: "blue" },
    { label: "Business Cases to Prepare", value: ecrs.filter((ecr) => matchesECRQueueFilter("business-case-preparation", "engineer", ecr, user)).length, hint: "Technically approved ECRs", icon: FileSearch, filter: "business-case-preparation", tone: "purple" },
    { label: "Pending Approval", value: summary.pending, hint: "Only your current review stage", icon: Clock3, filter: "pending-approval", tone: "amber" },
    { label: "Sent Back", value: summary.sentBack, hint: "Returned to me for revision", icon: RotateCcw, filter: "sent-back", tone: "orange" },
    { label: "Approved", value: summary.approved, hint: "Ready for downstream work", icon: CheckCircle2, filter: "approved", tone: "green" },
    { label: "Closed", value: summary.closed, hint: "Completed ECR records", icon: Archive, filter: "closed", tone: "gray" },
  ];
}

