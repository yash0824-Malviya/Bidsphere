import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileQuestion,
  FileText,
  Gavel,
  LayoutDashboard,
  Lock,
  Receipt,
  ShoppingCart,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";

import BrandLogo from "../../components/BrandLogo";
import { APP_NAME, APP_SUPPLIER_PORTAL, COMPANY_NAME } from "../../config/branding";
import { isSupplierNavPathActive as isActive } from "./supplierPortalNavigation";

interface NavChild {
  labelKey: string;
  to: string;
  lockedUntilApproved?: boolean;
}

interface NavGroup {
  labelKey: string;
  icon: LucideIcon;
  to: string;
  lockedUntilApproved?: boolean;
  children?: NavChild[];
  sectionLabel?: string;
}

const NAV: NavGroup[] = [
  { labelKey: "supplierNav.dashboard", icon: LayoutDashboard, to: "/supplier/dashboard", sectionLabel: "Workspace" },
  { labelKey: "Contracts", icon: FileText, to: "/supplier/contracts", lockedUntilApproved: true },
  {
    labelKey: "supplierNav.rfqs",
    icon: Receipt,
    to: "/supplier/rfqs",
    lockedUntilApproved: true,
    sectionLabel: "Sourcing",
    children: [
      { labelKey: "supplierNav.myRfqs", to: "/supplier/rfqs", lockedUntilApproved: true },
      {
        labelKey: "supplierNav.submittedQuotations",
        to: "/supplier/quotations",
        lockedUntilApproved: true,
      },
    ],
  },
  {
    labelKey: "supplierNav.rfis",
    icon: FileQuestion,
    to: "/supplier/rfis",
    lockedUntilApproved: true,
    children: [
      { labelKey: "supplierNav.myRfis", to: "/supplier/rfis", lockedUntilApproved: true },
    ],
  },
  {
    labelKey: "supplierNav.rfps",
    icon: FileText,
    to: "/supplier/rfps",
    lockedUntilApproved: true,
    children: [
      { labelKey: "supplierNav.myRfps", to: "/supplier/rfps", lockedUntilApproved: true },
    ],
  },
  {
    labelKey: "supplierNav.liveAuctions",
    icon: Gavel,
    to: "/supplier/auctions",
    lockedUntilApproved: true,
  },
  {
    labelKey: "supplierNav.orders",
    icon: ShoppingCart,
    to: "/supplier/purchase-orders",
    lockedUntilApproved: true,
    sectionLabel: "Operations",
    children: [
      {
        labelKey: "supplierNav.purchaseOrders",
        to: "/supplier/purchase-orders",
        lockedUntilApproved: true,
      },
      {
        labelKey: "supplierNav.deliverySchedule",
        to: "/supplier/delivery-schedule",
        lockedUntilApproved: true,
      },
      { labelKey: "supplierNav.goodsReceipts", to: "/supplier/grn", lockedUntilApproved: true },
    ],
  },
  {
    labelKey: "supplierNav.finance",
    icon: CreditCard,
    to: "/supplier/vouchers",
    lockedUntilApproved: true,
    children: [
      { labelKey: "supplierNav.vouchers", to: "/supplier/vouchers", lockedUntilApproved: true },
      { labelKey: "supplierNav.invoices", to: "/supplier/invoices", lockedUntilApproved: true },
      { labelKey: "supplierNav.payments", to: "/supplier/payments", lockedUntilApproved: true },
    ],
  },
];

function groupActive(pathname: string, group: NavGroup): boolean {
  if (isActive(pathname, group.to)) return true;
  return group.children?.some((c) => isActive(pathname, c.to)) ?? false;
}

interface Props {
  supplierName: string;
  unlocked?: boolean;
  statusBadge?: string;
  className?: string;
  onNavigate?: () => void;
  /** Pin sidebar to viewport edge (desktop layout shell). */
  fixed?: boolean;
  onClose?: () => void;
}

export default function SupplierPortalSidebar({
  supplierName,
  unlocked = true,
  className = "",
  onNavigate,
  fixed = false,
  onClose,
}: Props) {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  return (
    <aside
      className={`app-sidebar supplier-portal-sidebar border-r border-neutral-800 ${
        fixed ? "app-sidebar-fixed z-[100]" : "h-[100vh] min-h-[100vh]"
      } ${className}`}
    >
      <div className="supplier-sidebar-brand flex h-[52px] shrink-0 items-center border-b border-white/5 px-4">
        <Link
          to="/supplier/dashboard"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5"
        >
          <BrandLogo size="xs" markOnly />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{APP_SUPPLIER_PORTAL}</p>
          </div>
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} className="supplier-sidebar-close" aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="supplier-sidebar-company">
        <span className="supplier-sidebar-company-label">Supplier account</span>
        <span className="supplier-sidebar-company-name" title={supplierName}>{supplierName}</span>
      </div>

      <nav aria-label="Supplier navigation" className="app-sidebar-nav space-y-1 px-3 py-4">
        {NAV.map((group) => (
          <SidebarGroup
            key={group.labelKey}
            group={group}
            pathname={pathname}
            t={t}
            unlocked={unlocked}
            onNavigate={onNavigate}
            sectionLabel={group.sectionLabel}
          />
        ))}
      </nav>

      <div className="app-sidebar-footer">
        <span>{COMPANY_NAME} · {APP_NAME}</span>
        <span className="supplier-sidebar-version">v6.0</span>
      </div>
    </aside>
  );
}

function SidebarGroup({
  group,
  pathname,
  t,
  unlocked,
  onNavigate,
  sectionLabel,
}: {
  group: NavGroup;
  pathname: string;
  t: TFunction;
  unlocked: boolean;
  onNavigate?: () => void;
  sectionLabel?: string;
}) {
  const hasChildren = (group.children?.length ?? 0) > 0;
  const active = groupActive(pathname, group);
  const [open, setOpen] = useState(active && hasChildren);
  const locked = !!group.lockedUntilApproved && !unlocked;
  const Icon = group.icon;

  useEffect(() => {
    if (active && hasChildren) setOpen(true);
  }, [active, hasChildren]);

  const label = (
    <>
      <Icon className="h-5 w-5 shrink-0" />
      <span className="flex-1">{t(group.labelKey, group.labelKey.replace("supplierNav.", ""))}</span>
      {locked && <Lock className="h-3.5 w-3.5 opacity-70" />}
    </>
  );

  const itemClass = `supplier-sidebar-nav-item flex w-full items-center${active ? " is-active" : ""}${locked ? " opacity-70" : ""}`;
  const destination = locked ? "/supplier/locked" : group.to;
  const lockedState = locked ? { title: t(group.labelKey) } : undefined;

  if (!hasChildren) {
    return (
      <>
        {sectionLabel && <p className="supplier-sidebar-section-label">{sectionLabel}</p>}
        <Link
          to={destination}
          state={lockedState}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={itemClass}
        >
          {label}
        </Link>
      </>
    );
  }

  return (
    <div>
      {sectionLabel && <p className="supplier-sidebar-section-label">{sectionLabel}</p>}
      <div className={`supplier-sidebar-nav-row${active ? " is-active" : ""}`}>
        <Link
          to={destination}
          state={lockedState}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={itemClass}
        >
          {label}
        </Link>
        <button
          type="button"
          className="supplier-sidebar-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${t(group.labelKey)} navigation`}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && (
        <div className="supplier-sidebar-children border-l border-white/10">
          <div>
            {group.children!.map((child) => {
              const childActive = isActive(pathname, child.to);
              const childLocked = !!child.lockedUntilApproved && !unlocked;
              return (
                <Link
                  key={child.to}
                  to={childLocked ? "/supplier/locked" : child.to}
                  state={childLocked ? { title: t(child.labelKey) } : undefined}
                  onClick={onNavigate}
                  aria-current={childActive ? "page" : undefined}
                  className={`flex items-center justify-between px-2 font-medium${childLocked ? " opacity-70" : ""}`}
                >
                  <span>{t(child.labelKey)}</span>
                  {childLocked && <Lock className="h-3 w-3" />}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
