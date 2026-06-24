import { Navigate } from "react-router-dom";

import { getFirstP2PRoute } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";

/** Role-aware landing when visiting /p2p — sends users to their first
 * accessible P2P module so they never hit a route they cannot view. */
export default function P2PIndexRedirect() {
  const role = useAuthStore((s) => s.user?.role ?? "procurement");
  return <Navigate to={getFirstP2PRoute(role)} replace />;
}
