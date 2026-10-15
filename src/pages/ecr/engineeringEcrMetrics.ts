import type { ECRQueueSummary, ECRQueueUser } from "../../config/ecrQueues";
import type { EngineeringChangeRequest } from "../../types/erpnext";
import { matchesVisibleQueueFilter } from "./ecrListPresentation";

/** Manager KPIs and tabs use the existing list's definitions, including legacy status aliases. */
export function getEngineeringECRMetrics(
  records: EngineeringChangeRequest[],
  user: ECRQueueUser | null | undefined,
): ECRQueueSummary & { all: number } {
  const count = (filter: string) => records.filter((ecr) => matchesVisibleQueueFilter(filter, "engineering", ecr, user)).length;
  return {
    all: count("all"),
    mine: count("mine"),
    pending: count("pending-approval"),
    sentBack: count("sent-back"),
    approved: count("approved"),
    closed: count("closed"),
  };
}
