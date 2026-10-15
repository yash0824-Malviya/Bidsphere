/** CLM entry points; record access and reviewer assignments are enforced by the API. */
export const CLM_INTERNAL_ROLES = ["admin", "procurement", "procurement_team", "finance", "finance_executive", "legal", "engineer", "engineering", "quality", "program_manager"];
export function canAccessClmPath(role: string, path: string): boolean {
  path = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (!CLM_INTERNAL_ROLES.includes(role)) return false;
  if (path === "/contracts/settings") return ["admin", "legal", "procurement"].includes(role);
  if (path === "/contracts/new" || path === "/contract-requests/new") return ["admin", "procurement_team", "procurement"].includes(role);
  if (path === "/contract-requests" || path.startsWith("/contract-requests/")) return ["admin", "procurement_team", "procurement"].includes(role);
  return path === "/contracts" || path.startsWith("/contracts/");
}
