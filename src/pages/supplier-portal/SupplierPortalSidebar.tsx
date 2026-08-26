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
  HelpCircle,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  Mail,
  Receipt,
  ShoppingCart,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";

import BrandLogo from "../../components/BrandLogo";
import { APP_NAME, APP_SUPPLIER_PORTAL, COMPANY_NAME } from "../../config/branding";

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
}

const NAV: NavGroup[] = [
  { labelKey: "supplierNav.dashboard", icon: LayoutDashboard, to: "/supplier/dashboard" },
  {
    labelKey: "supplierNav.profile",
    icon: UserRound,
    to: "/supplier/profile",
    children: [
      { labelKey: "supplierNav.profileDetails", to: "/supplier/profile" },
      { labelKey: "supplierNav.documents", to: "/supplier/profile?tab=documents" },
      { labelKey: "supplierNav.security", to: "/supplier/security" },
    ],
  },
  {
    labelKey: "supplierNav.rfqs",
    icon: Receipt,
    to: "/supplier/rfqs",
    lockedUntilApproved: true,
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
  {
    labelKey: "supplierNav.support",
    icon: LifeBuoy,
    to: "/supplier/help-desk",
    children: [
      { labelKey: "supplierNav.help", to: "/supplier/help-desk" },
      { labelKey: "supplierNav.contactSupport", to: "/supplier/contact-support" },
    ],
  },
];

function isActive(pathname: string, to: string): boolean {
  const pathOnly = to.split("?")[0];
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

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
}

export default function SupplierPortalSidebar({
  supplierName,
  unlocked = true,
  className = "",
  onNavigate,
  fixed = false,
}: Props) {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  return (
    <aside
      className={`app-sidebar w-[280px] min-w-[280px] max-w-[280px] border-r border-neutral-800 ${
        fixed ? "app-sidebar-fixed z-[100]" : "h-[100vh] min-h-[100vh]"
      } ${className}`}
    >
      <div className="flex h-[52px] shrink-0 items-center border-b border-white/5 px-4">
        <Link
          to="/supplier/dashboard"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5"
        >
          <BrandLogo size="xs" markOnly />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{APP_SUPPLIER_PORTAL}</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-slate-500">
              {supplierName}
            </p>
          </div>
        </Link>
      </div>

      <nav className="app-sidebar-nav space-y-1 px-3 py-4">
        {NAV.map((group) => (
          <SidebarGroup
            key={group.labelKey}
            group={group}
            pathname={pathname}
            t={t}
            unlocked={unlocked}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="app-sidebar-footer">
        {COMPANY_NAME} · {APP_NAME}
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
}: {
  group: NavGroup;
  pathname: string;
  t: TFunction;
  unlocked: boolean;
  onNavigate?: () => void;
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

  if (!hasChildren) {
    return (
      <Link
        to={locked ? "/supplier/locked" : group.to}
        state={locked ? { title: t(group.labelKey) } : undefined}
        onClick={onNavigate}
        className={`relative flex h-10 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium transition ${
          active
            ? "bg-white/[0.10] text-white shadow-sm before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-primary"
            : "text-sidebar-text hover:bg-white/[0.06] hover:text-white"
        } ${locked ? "opacity-70" : ""}`}
      >
        {label}
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[13px] font-medium transition ${
          active
            ? "bg-white/[0.10] text-white shadow-sm before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-primary"
            : "text-sidebar-text hover:bg-white/[0.06] hover:text-white"
        }`}
      >
        {label}
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 opacity-60" />
        )}
      </button>
      {open && (
        <div className="mt-1.5 mr-2 ml-5 border-l border-white/10 pl-3">
          <div className="space-y-1">
            {group.children!.map((child) => {
              const childActive = isActive(pathname, child.to);
              const childLocked = !!child.lockedUntilApproved && !unlocked;
              return (
                <Link
                  key={child.to}
                  to={childLocked ? "/supplier/locked" : child.to}
                  state={childLocked ? { title: t(child.labelKey) } : undefined}
                  onClick={onNavigate}
                  className={`relative mx-1 flex h-8 items-center justify-between px-2 text-[12px] font-medium transition ${
                    childActive
                      ? "rounded-[10px] bg-white/[0.10] text-white"
                      : "rounded-lg text-sidebar-text hover:bg-white/[0.06] hover:text-white"
                  } ${childLocked ? "opacity-70" : ""}`}
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

export function SupplierPortalMobileNav({ unlocked = true }: { unlocked?: boolean }) {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const tabs = [
    { label: t("supplierNav.home"), to: "/supplier/dashboard", icon: LayoutDashboard },
    { label: t("supplierNav.profile", "Profile"), to: "/supplier/profile", icon: UserRound },
    {
      label: t("supplierNav.rfqs"),
      to: unlocked ? "/supplier/rfqs" : "/supplier/locked",
      icon: Receipt,
      locked: !unlocked,
    },
    {
      label: t("supplierNav.auctions"),
      to: unlocked ? "/supplier/auctions" : "/supplier/locked",
      icon: Gavel,
      locked: !unlocked,
    },
    {
      label: t("supplierNav.orders"),
      to: unlocked ? "/supplier/purchase-orders" : "/supplier/locked",
      icon: ShoppingCart,
      locked: !unlocked,
    },
    {
      label: t("supplierNav.finance"),
      to: unlocked ? "/supplier/vouchers" : "/supplier/locked",
      icon: CreditCard,
      locked: !unlocked,
    },
    { label: t("supplierNav.help"), to: "/supplier/help-desk", icon: HelpCircle },
  ];

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-2 py-2 lg:hidden">
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.to);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.to + tab.label}
            to={tab.to}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
              active
                ? "bg-primary-50 text-primary-700"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
            {"locked" in tab && tab.locked ? <Lock className="h-3 w-3" /> : null}
          </Link>
        );
      })}
      <Link
        to="/supplier/contact-support"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
      >
        <Mail className="h-3.5 w-3.5" />
        {t("supplierNav.contact")}
      </Link>
    </div>
  );
}
