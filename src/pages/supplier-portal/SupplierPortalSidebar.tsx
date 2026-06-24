import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Receipt,
  ShoppingCart,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import BrandLogo from "../../components/BrandLogo";
import { APP_NAME, APP_SUPPLIER_PORTAL, COMPANY_NAME } from "../../config/branding";

interface NavChild {
  label: string;
  to: string;
}

interface NavGroup {
  label: string;
  icon: LucideIcon;
  to: string;
  children?: NavChild[];
}

const NAV: NavGroup[] = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/supplier/dashboard" },
  {
    label: "RFQs",
    icon: Receipt,
    to: "/supplier/rfqs",
    children: [
      { label: "My RFQs", to: "/supplier/rfqs" },
      { label: "Submitted Quotations", to: "/supplier/quotations" },
    ],
  },
  {
    label: "Orders",
    icon: ShoppingCart,
    to: "/supplier/purchase-orders",
    children: [
      { label: "Purchase Orders", to: "/supplier/purchase-orders" },
      { label: "Delivery Schedule", to: "/supplier/delivery-schedule" },
      { label: "Goods Receipts (GRN)", to: "/supplier/grn" },
    ],
  },
  {
    label: "Finance",
    icon: CreditCard,
    to: "/supplier/vouchers",
    children: [
      { label: "Vouchers", to: "/supplier/vouchers" },
      { label: "Invoices", to: "/supplier/invoices" },
      { label: "Payments", to: "/supplier/payments" },
    ],
  },
  {
    label: "Support",
    icon: LifeBuoy,
    to: "/supplier/help-desk",
    children: [
      { label: "Help", to: "/supplier/help-desk" },
      { label: "Contact Support", to: "/supplier/contact-support" },
    ],
  },
];

function isActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function groupActive(pathname: string, group: NavGroup): boolean {
  if (isActive(pathname, group.to)) return true;
  return group.children?.some((c) => isActive(pathname, c.to)) ?? false;
}

interface Props {
  supplierName: string;
}

export default function SupplierPortalSidebar({ supplierName }: Props) {
  const { pathname } = useLocation();

  return (
    <aside className="hidden h-full w-[260px] shrink-0 flex-col border-r border-neutral-200 bg-slate-900 text-slate-300 lg:flex">
      <div className="border-b border-white/5 px-4 py-5">
        <Link to="/supplier/dashboard" className="flex items-center gap-2.5">
          <BrandLogo size="xs" markOnly />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">{APP_SUPPLIER_PORTAL}</p>
            <p className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-slate-500">
              {supplierName}
            </p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV.map((group) => (
          <SidebarGroup key={group.label} group={group} pathname={pathname} />
        ))}
      </nav>

      <div className="border-t border-white/5 px-4 py-3 text-[10px] text-slate-500">
        {COMPANY_NAME} · {APP_NAME}
      </div>
    </aside>
  );
}

function SidebarGroup({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const hasChildren = (group.children?.length ?? 0) > 0;
  const active = groupActive(pathname, group);
  const [open, setOpen] = useState(active && hasChildren);

  useEffect(() => {
    if (active && hasChildren) setOpen(true);
  }, [active, hasChildren]);

  const Icon = group.icon;

  if (!hasChildren) {
    return (
      <Link
        to={group.to}
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
          active
            ? "bg-primary/20 text-white shadow-[inset_3px_0_0_0_#0ea5e9]"
            : "text-slate-400 hover:bg-slate-800 hover:text-white"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {group.label}
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition ${
          active
            ? "bg-primary/15 text-white"
            : "text-slate-400 hover:bg-slate-800 hover:text-white"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1">{group.label}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 opacity-60" />
        )}
      </button>
      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
          {group.children!.map((child) => {
            const childActive = isActive(pathname, child.to);
            return (
              <Link
                key={child.to}
                to={child.to}
                className={`block rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                  childActive
                    ? "bg-primary/25 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SupplierPortalMobileNav() {
  const { pathname } = useLocation();
  const tabs = [
    { label: "Home", to: "/supplier/dashboard", icon: LayoutDashboard },
    { label: "RFQs", to: "/supplier/rfqs", icon: Receipt },
    { label: "Orders", to: "/supplier/purchase-orders", icon: ShoppingCart },
    { label: "GRN", to: "/supplier/grn", icon: Truck },
    { label: "Finance", to: "/supplier/vouchers", icon: CreditCard },
    { label: "Help", to: "/supplier/help-desk", icon: HelpCircle },
  ];

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-2 py-2 lg:hidden">
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.to);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
              active
                ? "bg-primary-50 text-primary-700"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </Link>
        );
      })}
      <Link
        to="/supplier/contact-support"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
      >
        <Mail className="h-3.5 w-3.5" />
        Contact
      </Link>
    </div>
  );
}
