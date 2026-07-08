import { isSlaVisibleForRole } from "../config/slaAccess";
import { useAuthStore } from "../store/authStore";

/**
 * Whether the signed-in user may see/interact with the SLA module.
 *
 * Currently Admin-only (see `isSlaVisibleForRole`). All SLA UI surfaces gate on
 * this so non-admin users neither render SLA components nor trigger SLA APIs.
 */
export function useSlaVisible(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  return isSlaVisibleForRole(role);
}
