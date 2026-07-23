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
    <header className="sticky top-0 z-30 border-b border-[#E8EDF5] bg-white">
      <div className="flex h-14 items-center gap-3 px-6">
        {sidebarMode === "drawer" && (
          <button
            type="button"
            onClick={toggleMobileNav}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E8EDF5] bg-white text-neutral-700 hover:bg-neutral-50 md:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}

        {!onDashboard && (
          <div className="min-w-0 flex-1 md:flex-none">
            <nav
              aria-label="Breadcrumb"
              className="hidden items-center gap-1.5 text-[13px] text-neutral-500 sm:flex"
            >
              <Link
                to="/dashboard"
                className="flex items-center gap-1 transition-colors hover:text-primary"
              >
                <Home className="h-3 w-3" />
                <span>{t("common.home")}</span>
              </Link>
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                const crumbLabel = translateRouteTitle(t, crumb.label);
                return (
                  <span key={crumb.to} className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-neutral-300" />
                    {isLast ? (
                      <span className="font-medium text-neutral-700">
                        {crumbLabel}
                      </span>
                    ) : (
                      <Link
                        to={crumb.to}
                        className="transition-colors hover:text-primary"
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

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={toggleMobileSearch}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E8EDF5] bg-white text-neutral-700 hover:bg-neutral-50 md:hidden"
            aria-label={mobileSearchOpen ? "Close search" : "Open search"}
          >
            {mobileSearchOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </button>

          <div className="hidden w-[280px] md:block lg:w-[320px]">
            <GlobalSearch />
          </div>

          <LanguageSwitcher />
          <NotificationsBell />
          <UserProfileMenu />
        </div>
      </div>

      {mobileSearchOpen && (
        <div className="border-t border-[#E8EDF5] px-6 py-2.5 md:hidden">
          <GlobalSearch onSelect={() => setMobileSearchOpen(false)} />
        </div>
      )}
    </header>
  );
}
