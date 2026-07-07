import type { MaterialRequestProcurementType } from "../types/materialRequestWorkflow";

/**
 * Departments that default to DIRECT procurement (manufacturing / production).
 * Everything else (HR, IT, Admin, Finance and other support functions) defaults
 * to INDIRECT. Matching is case-insensitive and substring-based so free-text
 * ERPNext department names like "Production - NL" still resolve correctly.
 */
export const DIRECT_PROCUREMENT_DEPARTMENTS = [
  "Production",
  "Manufacturing",
  "Plant",
  "Assembly",
  "Fabrication",
  "Operations",
  "Maintenance",
  "Quality",
  "Engineering",
  "Warehouse",
] as const;

/**
 * Resolve the default procurement type for a department. Production and other
 * manufacturing functions default to Direct; all support departments (HR, IT,
 * Admin, Finance, …) default to Indirect. The user can still override in the UI.
 */
export function defaultProcurementTypeForDepartment(
  department: string | null | undefined,
): MaterialRequestProcurementType {
  const dept = (department ?? "").trim().toLowerCase();
  if (!dept) return "Indirect";
  const isDirect = DIRECT_PROCUREMENT_DEPARTMENTS.some((d) =>
    dept.includes(d.toLowerCase()),
  );
  return isDirect ? "Direct" : "Indirect";
}

/** Tailwind badge classes — Direct = blue, Indirect = orange. */
export function procurementTypeBadgeClasses(
  type: MaterialRequestProcurementType,
): string {
  return type === "Direct"
    ? "bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-200"
    : "bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-200";
}
