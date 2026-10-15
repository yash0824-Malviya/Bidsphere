import { canAccessECRRecord, canonicalECRStage, formatECRNumber, isExtendedECRWorkflow } from "../../config/ecrRoles";
import { getECRCurrentStage, getECRListActionLabel, type ECRQueueUser } from "../../config/ecrQueues";
import { parseECRBusinessCase, type ECRBusinessCaseAggregate } from "../../types/ecrBusinessCase";
import type { EngineeringChangeRequest } from "../../types/erpnext";

export interface EngineerBusinessCaseQueue {
  cases: Array<ECRBusinessCaseAggregate & { businessCase: NonNullable<ECRBusinessCaseAggregate["businessCase"]> }>;
  readyToPrepare: EngineeringChangeRequest[];
}

export interface BusinessCaseQueueFilters {
  search: string;
  status: string;
  department: string;
  priority: string;
  ecr: string;
  targetDate: string;
}

export const EMPTY_BUSINESS_CASE_FILTERS: BusinessCaseQueueFilters = {
  search: "", status: "all", department: "all", priority: "all", ecr: "all", targetDate: "",
};

/** List rows only carry Business Case data after detail hydration. Read missing
 * data through the existing endpoint, including cases on completed ECRs. */
export async function loadEngineerBusinessCaseQueue(
  ecrs: EngineeringChangeRequest[],
  user: ECRQueueUser | null | undefined,
  readBusinessCase: (name: string) => Promise<ECRBusinessCaseAggregate>,
  role: "engineer" | "engineering" = "engineer",
): Promise<EngineerBusinessCaseQueue> {
  const candidates = ecrs.filter((ecr) => canAccessECRRecord(role, ecr, user) && isExtendedECRWorkflow(ecr) && (
    Boolean(ecr.ecr_business_case) || !["Draft", "Engineering Review"].includes(canonicalECRStage(ecr.select_pxfp, ecr))
  ));
  const aggregates: ECRBusinessCaseAggregate[] = new Array(candidates.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (nextIndex < candidates.length) {
      const index = nextIndex++;
      const ecr = candidates[index];
      const businessCase = parseECRBusinessCase(ecr.ecr_business_case);
      const hasPersistedCase = businessCase?.ecr_reference === ecr.name;
      const hasKnownEmptyCase = ecr.ecr_business_case !== undefined && !ecr.ecr_business_case;
      aggregates[index] = hasPersistedCase || hasKnownEmptyCase
        ? { ecr, businessCase: hasPersistedCase ? businessCase : null }
        : await readBusinessCase(ecr.name);
    }
  }));

  const queue: EngineerBusinessCaseQueue = { cases: [], readyToPrepare: [] };
  for (const { ecr, businessCase } of aggregates) {
    if (!canAccessECRRecord(role, ecr, user) || !isExtendedECRWorkflow(ecr)) continue;
    if (businessCase?.name && businessCase.ecr_reference === ecr.name) {
      queue.cases.push({ ecr, businessCase });
    } else if (!businessCase && getECRListActionLabel(role, ecr, user) === "Prepare Business Case") {
      queue.readyToPrepare.push(ecr);
    }
  }
  return queue;
}

export function matchesBusinessCaseFilters(
  ecr: EngineeringChangeRequest,
  businessCase: ECRBusinessCaseAggregate["businessCase"],
  filters: BusinessCaseQueueFilters,
): boolean {
  const status = businessCase?.status || "Ready to prepare";
  if (filters.status !== "all" && filters.status !== status) return false;
  if (filters.department !== "all" && filters.department !== ecr.requesting_department) return false;
  if (filters.priority !== "all" && filters.priority !== ecr.priority) return false;
  if (filters.ecr !== "all" && filters.ecr !== ecr.name) return false;
  if (filters.targetDate && filters.targetDate !== ecr.target_implementation_date) return false;
  const term = filters.search.trim().toLowerCase();
  return !term || [businessCase?.business_case_id, businessCase?.name, ecr.name, formatECRNumber(ecr), ecr.ecr_title, ecr.requesting_department, status, getECRCurrentStage(ecr.select_pxfp, ecr)]
    .some((value) => String(value || "").toLowerCase().includes(term));
}
