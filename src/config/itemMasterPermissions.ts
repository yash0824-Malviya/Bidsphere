import type { AppRole } from "./roles";

/** Roles that may override Item Master fields (UOM) on transactional forms. */
export function canEditItemMasterFields(role: AppRole | undefined): boolean {
  return role === "admin" || role === "warehouse";
}
