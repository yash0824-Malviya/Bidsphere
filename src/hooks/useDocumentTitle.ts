import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { APP_NAME } from "../config/branding";
import { useAuthStore } from "../store/authStore";
import { getPageTitle, isDashboardRoute } from "../utils/routes";

/** Sync browser tab title with the current route. */
export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  const role = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    if (
      pathname === "/login" ||
      pathname === "/supplier/login" ||
      isDashboardRoute(pathname, role)
    ) {
      document.title = APP_NAME;
      return;
    }
    const page = getPageTitle(pathname);
    document.title = page === APP_NAME ? APP_NAME : `${page} — ${APP_NAME}`;
  }, [pathname, role]);
}
