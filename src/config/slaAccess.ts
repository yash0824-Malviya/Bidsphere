import type { AppRole } from "./roles";

/**
 * SLA module access gate.
 *
 * The SLA module (dashboard, configuration, reports, countdown widgets, stage
 * badges and the background evaluation engine) is TEMPORARILY restricted to the
 * Admin role only. This is a UI/role-based hide — no SLA backend logic, DocTypes
 * or database tables are removed. To re-enable SLA for other roles later, widen
 * the check below (or return `true`); every SLA surface reads this single gate.
 */
export function isSlaVisibleForRole(role: AppRole | null | undefined): boolean {
  return role === "admin";
}
