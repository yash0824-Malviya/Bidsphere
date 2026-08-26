import type { AppRole } from "../../config/roles";

export type ProcurementDashboardContent =
  | "manager-overview"
  | "team-ecr-queue"
  | null;

function normalizeRoleLabel(role: string): string {
  return role
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

const PROCUREMENT_MANAGER_ALIASES = new Set([
  "procurement",
  "procurement manager",
  "purchase manager",
]);

const PROCUREMENT_TEAM_ALIASES = new Set([
  "procurement team",
  "procurement user",
  "purchase user",
]);

/**
 * Keep Procurement Manager's overview separate from Procurement Team's ECR
 * queue. This intentionally uses a closed alias list: an unknown persisted
 * role must not silently acquire Procurement Manager dashboard access.
 */
export function getProcurementDashboardContent(
  role: AppRole | string | null | undefined,
): ProcurementDashboardContent {
  if (!role) return null;
  const normalized = normalizeRoleLabel(role);
  if (PROCUREMENT_MANAGER_ALIASES.has(normalized)) return "manager-overview";
  if (PROCUREMENT_TEAM_ALIASES.has(normalized)) return "team-ecr-queue";
  return null;
}
