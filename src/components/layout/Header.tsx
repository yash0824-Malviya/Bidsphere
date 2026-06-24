import { ChevronRight, Home, Menu, Search, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { useLayout } from "../../contexts/LayoutContext";
import {
  getBreadcrumbs,
  getPageTitle,
  isDashboardRoute,
} from "../../utils/routes";
import GlobalSearch from "../GlobalSearch";
import NotificationsBell from "../NotificationsBell";

export default function Header() {
  const { pathname } = useLocation();
  const title = getPageTitle(pathname);
  const breadcrumbs = getBreadcrumbs(pathname);
  const onDashboard = isDashboardRoute(pathname);
  const {
    toggleMobileNav,
    sidebarMode,
    mobileSearchOpen,
    toggleMobileSearch,
    setMobileSearchOpen,
    hasPageHeader,
  } = useLayout();

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3 px-6 py-3.5">
        {sidebarMode === "drawer" && (
          <button
            type="button"
            onClick={toggleMobileNav}
            className="btn-icon-touch inline-flex items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 md:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        {!onDashboard && (
          <div className="min-w-0 flex-1 md:flex-none">
            {!hasPageHeader && (
              <h1 className="heading-page truncate">{title}</h1>
            )}
            <nav
              aria-label="Breadcrumb"
              className={`${
                hasPageHeader ? "" : "mt-0.5"
              } hidden items-center gap-1 text-xs text-neutral-500 sm:flex`}
            >
              <Link
                to="/dashboard"
                className="flex items-center gap-1 transition-colors hover:text-primary"
              >
                <Home className="h-3 w-3" />
                <span>Home</span>
              </Link>
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <span key={crumb.to} className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-neutral-300" />
                    {isLast ? (
                      <span className="font-medium text-neutral-700">
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        to={crumb.to}
                        className="transition-colors hover:text-primary"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={toggleMobileSearch}
            className="btn-icon-touch inline-flex items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 md:hidden"
            aria-label={mobileSearchOpen ? "Close search" : "Open search"}
          >
            {mobileSearchOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Search className="h-5 w-5" />
            )}
          </button>

          <div className="hidden flex-1 justify-end md:flex md:max-w-md lg:max-w-lg">
            <GlobalSearch />
          </div>

          <NotificationsBell />
        </div>
      </div>

      {mobileSearchOpen && (
        <div className="border-t border-neutral-100 px-6 py-3 md:hidden">
          <GlobalSearch onSelect={() => setMobileSearchOpen(false)} />
        </div>
      )}
    </header>
  );
}
