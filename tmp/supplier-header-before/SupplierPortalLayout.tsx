import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Bell, LogOut, Menu, User, X } from "lucide-react";

import { getNotificationsForViewer } from "../../api/notifications";
import { APP_SUPPLIER_PORTAL } from "../../config/branding";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import BrandLogo from "../../components/BrandLogo";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import PageContainer from "../../components/layout/PageContainer";
import {
  clearSupplierSession,
  readSupplierSession,
} from "../../hooks/useSupplierSession";
import { countUnread } from "../../utils/notificationAccess";
import SupplierPortalSidebar, {
  SupplierPortalMobileNav,
} from "./SupplierPortalSidebar";
import "./SupplierDashboardShell.css";

const SUPPLIER_SIDEBAR_WIDTH = 280;

interface Props {
  /** Optional override — defaults to the active supplier session display name. */
  supplierName?: string;
  statusBadge?: string;
  unlocked?: boolean;
  /** When omitted (route layout mode), renders `<Outlet />`. */
  children?: ReactNode;
}

const LOCKED_PATH_PREFIXES = [
  "/supplier/rfqs",
  "/supplier/rfis",
  "/supplier/rfps",
  "/supplier/quotations",
  "/supplier/quotation",
  "/supplier/auctions",
  "/supplier/purchase-orders",
  "/supplier/delivery-schedule",
  "/supplier/grn",
  "/supplier/invoices",
  "/supplier/payments",
  "/supplier/vouchers",
  "/supplier/po/",
];

function badgeClass(status?: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("approved")) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (s.includes("reject")) return "bg-rose-50 text-rose-700 ring-rose-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

function isLockedPath(pathname: string) {
  return LOCKED_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p),
  );
}

/**
 * Shared Supplier Portal chrome: Sidebar + Header + Page Content.
 * Mount once via React Router (Outlet). Page components render content only.
 */
export default function SupplierPortalLayout({
  supplierName: supplierNameProp,
  statusBadge: statusBadgeProp,
  unlocked: unlockedProp,
  children,
}: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const mainRef = useRef<HTMLElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const mobileNavToggleRef = useRef<HTMLButtonElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useDocumentTitle();

  const isDashboardPage = pathname === "/supplier/dashboard";
  const isRfqQuotationPage = /^\/supplier\/rfq\/[^/]+$/.test(pathname);

  useEffect(() => {
    setMobileNavOpen(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!isDashboardPage || !mobileNavOpen) return;
    const drawer = mobileNavRef.current;
    const toggle = mobileNavToggleRef.current;
    const focusable = () => Array.from(
      drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
    ).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavOpen(false);
      }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileNavOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      desktop.removeEventListener("change", closeOnDesktop);
      toggle?.focus();
    };
  }, [isDashboardPage, mobileNavOpen]);

  const session = readSupplierSession();
  const supplierName =
    (supplierNameProp ||
      session?.companyName ||
      session?.supplierName ||
      "").trim();
  const statusBadge =
    statusBadgeProp ??
    session?.displayStatus ??
    (session?.unlocked || session?.authMode === "pin" ? "Approved" : undefined);
  const unlocked =
    unlockedProp ??
    (!!session?.unlocked ||
      session?.authMode === "pin" ||
      session?.displayStatus === "Approved");
  const erpSupplierId = (
    session?.linkedSupplier ||
    session?.supplierName ||
    ""
  ).trim();

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      supplierName ? `${isDashboardPage ? 256 : SUPPLIER_SIDEBAR_WIDTH}px` : "0px",
    );
    return () => {
      document.documentElement.style.removeProperty("--sidebar-width");
    };
  }, [supplierName, isDashboardPage]);

  const notificationsQuery = useQuery({
    queryKey: ["supplier-portal-notifications", erpSupplierId],
    queryFn: () =>
      getNotificationsForViewer({
        role: "supplier",
        supplierId: erpSupplierId,
      }),
    enabled: !!erpSupplierId,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
  const unreadCount = countUnread(notificationsQuery.data ?? []);

  function handleLogout() {
    clearSupplierSession();
    navigate("/supplier/login", { replace: true });
  }

  const lockedRedirect =
    !!supplierName && !unlocked && isLockedPath(pathname) ? (
      <Navigate to="/supplier/locked" replace state={{ title: "Module" }} />
    ) : null;

  const content = lockedRedirect ?? children ?? <Outlet />;

  return (
    <div className={`supplier-portal-layout app-shell min-w-0 bg-[#f8fafb]${isDashboardPage ? " supplier-dashboard-shell" : ""}`}>
      {supplierName ? (
        <SupplierPortalSidebar
          className="hidden lg:flex"
          fixed
          supplierName={supplierName}
          unlocked={unlocked}
          statusBadge={statusBadge}
          dashboard={isDashboardPage}
        />
      ) : null}

      {supplierName && mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation menu"
            className="fixed inset-0 z-40 bg-neutral-900/40 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            ref={mobileNavRef}
            id="supplier-mobile-navigation"
            role={isDashboardPage ? "dialog" : undefined}
            aria-modal={isDashboardPage ? true : undefined}
            aria-label={isDashboardPage ? "Supplier navigation" : undefined}
            className={`fixed inset-y-0 left-0 z-50 max-w-[100vw] transform transition-transform duration-300 ease-in-out lg:hidden ${
              mobileNavOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <SupplierPortalSidebar
              supplierName={supplierName}
              unlocked={unlocked}
              statusBadge={statusBadge}
              className="app-drawer-panel shadow-2xl"
              onNavigate={() => setMobileNavOpen(false)}
              dashboard={isDashboardPage}
              onClose={isDashboardPage ? () => setMobileNavOpen(false) : undefined}
            />
          </div>
        </>
      ) : null}

      <div
        className={`app-shell-main relative z-[1] transition-[margin,width] duration-300 ease-in-out ${
          supplierName
            ? isDashboardPage ? "lg:ml-[256px] lg:w-[calc(100%-256px)]" : "lg:ml-[280px] lg:w-[calc(100%-280px)]"
            : "w-full"
        }`}
      >
        <header className="supplier-portal-header relative z-30 shrink-0 bg-white border-b border-neutral-200/80 shadow-sm">
            <div
              className={`supplier-portal-header-inner flex min-w-0 items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:px-5 ${
                isRfqQuotationPage ? "lg:px-6" : "lg:px-8"
              }`}
            >
              <div className="supplier-portal-header-brand flex min-w-0 items-center gap-2">
                {supplierName ? (
                  <button
                    type="button"
                    ref={mobileNavToggleRef}
                    onClick={() => setMobileNavOpen((v) => !v)}
                    className="supplier-portal-menu-toggle inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 lg:hidden"
                    aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
                    aria-expanded={mobileNavOpen}
                    aria-controls="supplier-mobile-navigation"
                  >
                    {mobileNavOpen ? (
                      <X className="h-4 w-4" />
                    ) : (
                      <Menu className="h-4 w-4" />
                    )}
                  </button>
                ) : null}
                <Link
                  to={supplierName ? "/supplier/dashboard" : "/supplier/login"}
                  className="supplier-portal-mobile-brand flex min-w-0 items-center gap-2 lg:hidden"
                >
                  <BrandLogo markOnly />
                  <span className="truncate text-sm font-semibold text-neutral-900">
                    {APP_SUPPLIER_PORTAL}
                  </span>
                </Link>
                {isDashboardPage && (
                  <div className="supplier-dashboard-page-label">
                    <span>{t("supplierNav.dashboard", "Dashboard")}</span>
                    <span className="supplier-dashboard-page-context">Supplier workspace</span>
                  </div>
                )}
              </div>

              {supplierName ? (
                <div className="supplier-portal-header-actions ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
                  <LanguageSwitcher />
                  <Link
                    to="/supplier/dashboard"
                    className="supplier-portal-notifications relative rounded-full border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50"
                    aria-label={
                      unreadCount > 0
                        ? `Notifications, ${unreadCount} unread`
                        : "Notifications"
                    }
                  >
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold leading-none text-white">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </Link>
                  {statusBadge && (
                    <span
                      className={`supplier-portal-account-status hidden rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset sm:inline ${badgeClass(statusBadge)}`}
                    >
                      {statusBadge}
                    </span>
                  )}
                  {isDashboardPage ? (
                    <Link to="/supplier/profile" className="supplier-dashboard-profile" aria-label={`${t("supplierNav.profile", "Profile")}: ${supplierName}`} title={supplierName}>
                      <span className="supplier-dashboard-avatar"><User className="h-4 w-4" /></span>
                      <span className="supplier-dashboard-profile-name">{supplierName}</span>
                    </Link>
                  ) : (
                    <span className="hidden items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700 ring-1 ring-inset ring-accent-200 sm:inline-flex">
                      <User className="h-3 w-3 shrink-0" />
                      <span className="max-w-[100px] truncate md:max-w-[140px]">
                        {supplierName}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    aria-label={t("supplierNav.logout")}
                    className="supplier-portal-logout btn-touch inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t("supplierNav.logout")}</span>
                  </button>
                </div>
              ) : (
                <div className="ml-auto flex items-center gap-2 sm:gap-3">
                  <LanguageSwitcher />
                  <span className="text-xs text-neutral-500">
                    {t("supplierNav.supplierSignIn")}
                  </span>
                </div>
              )}
            </div>
            {supplierName && !isDashboardPage ? <SupplierPortalMobileNav unlocked={unlocked} /> : null}
          </header>

          <main ref={mainRef} className="app-shell-scroll">
            <PageContainer
              bare={pathname === "/supplier/dashboard" || isRfqQuotationPage}
              className={isRfqQuotationPage ? "supplier-rfq-page-container" : undefined}
            >
              {content}
            </PageContainer>
          </main>
      </div>
    </div>
  );
}
