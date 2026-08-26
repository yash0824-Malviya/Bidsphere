import { ChevronRight, Home, Menu, Search, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useLayout } from "../../contexts/LayoutContext";
import { useAuthStore } from "../../store/authStore";
import { translateRouteTitle } from "../../i18n/navLabels";
import { getBreadcrumbs, isDashboardRoute } from "../../utils/routes";
import GlobalSearch from "../GlobalSearch";
import LanguageSwitcher from "../LanguageSwitcher";
import NotificationsBell from "../NotificationsBell";
import UserProfileMenu from "./UserProfileMenu";

export default function Header() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const breadcrumbs = getBreadcrumbs(pathname);
  const onDashboard = isDashboardRoute(pathname, role);
  const {
    toggleMobileNav,
    sidebarMode,
    mobileSearchOpen,
    toggleMobileSearch,
    setMobileSearchOpen,
  } = useLayout();

  return (
    <header className="app-topbar z-30 shrink-0 border-b bg-white">
      <div className="flex h-[64px] min-w-0 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
        {sidebarMode === "drawer" && (
          <button
            type="button"
            onClick={toggleMobileNav}
            className="topbar-control inline-flex h-10 w-10 shrink-0 items-center justify-center border bg-white hover:bg-[var(--ds-paper)]"
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}

        {!onDashboard && (
          <div className="min-w-0 flex-1 overflow-hidden md:flex-none md:overflow-visible">
            <nav
              aria-label="Breadcrumb"
              className="hidden items-center gap-1.5 text-[13px] text-[var(--ds-text-soft)] sm:flex"
            >
              <Link
                to="/dashboard"
                className="flex items-center gap-1 transition-colors hover:text-[var(--ds-accent)]"
              >
                <Home className="h-3 w-3 shrink-0" />
                <span>{t("common.home")}</span>
              </Link>
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                const crumbLabel = translateRouteTitle(t, crumb.label);
                return (
                  <span key={crumb.to} className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="h-3 w-3 shrink-0 text-[var(--ds-text-faint)]" />
                    {isLast ? (
                      <span className="truncate font-medium text-[var(--ds-text)]">
                        {crumbLabel}
                      </span>
                    ) : (
                      <Link
                        to={crumb.to}
                        className="truncate transition-colors hover:text-[var(--ds-accent)]"
                      >
                        {crumbLabel}
                      </Link>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>
        )}

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
          <button
            type="button"
            onClick={toggleMobileSearch}
            className="topbar-control inline-flex h-10 w-10 items-center justify-center border bg-white hover:bg-[var(--ds-paper)] md:hidden"
            aria-label={mobileSearchOpen ? "Close search" : "Open search"}
          >
            {mobileSearchOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </button>

          <div className="hidden min-w-0 md:block md:w-[360px] lg:w-[400px]">
            <GlobalSearch />
          </div>

          <LanguageSwitcher />
          <NotificationsBell />
          <UserProfileMenu />
        </div>
      </div>

      {mobileSearchOpen && (
        <div className="border-t border-[var(--ds-border)] px-4 py-2.5 sm:px-5 md:hidden lg:px-8">
          <GlobalSearch onSelect={() => setMobileSearchOpen(false)} />
        </div>
      )}
    </header>
  );
}
