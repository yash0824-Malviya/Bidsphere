import { getECRCurrentStage, matchesECRQueueFilter } from "../../config/ecrQueues";
import { formatECRNumber } from "../../config/ecrRoles";
import type { EngineeringChangeRequest } from "../../types/erpnext";

export const ENGINEERING_LIST_FILTER_KEYS = ["priority", "department", "supplier", "type", "target-date"];

/** Presentation filters only; the action queue is scoped by the existing role predicate first. */
export function filterEngineeringECRRows(
  ecrs: EngineeringChangeRequest[],
  params: URLSearchParams,
  search: string,
): EngineeringChangeRequest[] {
  const term = search.trim().toLowerCase();
  return ecrs.filter((ecr) => {
    const fields = {
      priority: ecr.priority,
      department: ecr.requesting_department,
      supplier: ecr.supplier_response_required,
      type: ecr.ecr_type,
      "target-date": ecr.target_implementation_date?.slice(0, 10),
    };
    for (const [key, value] of Object.entries(fields)) {
      const selected = params.get(key);
      if (selected && selected !== "all" && selected !== value) return false;
    }
    return !term || [ecr.name, formatECRNumber(ecr), ecr.ecr_title, ecr.requesting_department,
      getECRCurrentStage(ecr.select_pxfp, ecr)]
      .some((value) => String(value || "").toLowerCase().includes(term));
  });
}

/** A creation date is not an approval date. Show only a saved, successful approval decision. */
export function getEngineeringECRApprovedOn(ecr: EngineeringChangeRequest): string {
  if (!matchesECRQueueFilter("approved", "engineering", ecr)) return "—";
  const dates = (ecr.approval_requirements ?? [])
    .filter((row) => row.status === "Approved" && row.approval_date)
    .map((row) => row.approval_date!)
    .sort();
  return dates.at(-1)?.slice(0, 10) || "—";
}
