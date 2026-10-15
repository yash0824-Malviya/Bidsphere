import { useCallback, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { NavItem, NavChild } from "../../utils/routes";
import { useAuthStore } from "../../store/authStore";
import { APP_SIDEBAR_TITLE, APP_SIDEBAR_TAGLINE, APP_NAME, COMPANY_NAME } from "../../config/branding";
import { getNavGroupsForRole, normalizeAppRole } from "../../config/roles";
import { translateNavLabel } from "../../i18n/navLabels";
import BrandLogo from "../BrandLogo";
import { isChildNavActive } from "./sidebarNavState";
import { useProcurementBadges } from "../../hooks/useProcurementBadges";
import { procurementSidebarGroups, type SidebarNavItem } from "./procurementSidebarNav";

export function isItemActive(pathname: string, to: string): boolean {
  if (!to) return false;
  const [toPath] = to.split("?");
  if (toPath === "/suppliers") {
    if (pathname.startsWith("/suppliers/onboarding")) return false;
    return pathname === "/suppliers" || pathname.startsWith("/suppliers/");
  }
  if (toPath === "/suppliers/onboarding") {
    return pathname === "/suppliers/onboarding" || pathname.startsWith("/suppliers/onboarding/");
  }
  if (toPath === "/material-requests/procurement" || toPath === "/material-requests") {
    return pathname === "/material-requests" || pathname.startsWith("/material-requests/");
  }
  if (pathname === to) return true;
  // Require a path boundary so `/sourcing/rfq` does not match
  // `/sourcing/rfq-templates` (and similar sibling prefixes).
  return pathname.startsWith(`${to}/`);
}

export function isParentNavActive(
  pathname: string,
  search: string,
  item: NavItem,
): boolean {
  if (item.children?.length) {
    return (
      isItemActive(pathname, item.to) ||
      item.children.some((child) =>
        isChildNavActive(pathname, search, child.to, child.label),
      )
    );
  }
  return isItemActive(pathname, item.to);
}

export type SidebarVariant = "full" | "compact" | "collapsed" | "drawer";

interface Props {
  variant?: SidebarVariant;
  onNavigate?: () => void;
  className?: string;
  /** Pin sidebar to viewport edge (desktop layout shell). */
  fixed?: boolean;
}

export default function Sidebar({
  variant = "full",
  onNavigate,
  className = "",
  fixed = false,
}: Props) {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const user = useAuthStore((s) => s.user);
  const role = normalizeAppRole(user?.role);
  const isProcurementWorkspace = role === "procurement_team" || role === "procurement";
  const roleGroups = getNavGroupsForRole(user?.role ?? "procurement");
  const navGroups = isProcurementWorkspace
    ? procurementSidebarGroups(roleGroups, role)
    : roleGroups;
  const badges = useProcurementBadges();
  const collapsed = variant === "collapsed";

  const widthClass = collapsed
    ? "w-16 min-w-16 max-w-16"
    : "w-[240px] min-w-[240px] max-w-[240px]";

  const mainGroups = navGroups.filter(
    (g) => g.label !== "Support" && g.label !== "Help",
  );
  const supportGroups = navGroups.filter(
    (g) => g.label === "Support" || g.label === "Help",
  );

  return (
    <aside
      className={`app-sidebar ${widthClass} bg-[#0B1630] border-r border-[#152449]/60 transition-[width] duration-200 ease-in-out select-none ${
        fixed ? "app-sidebar-fixed" : "h-[100vh] min-h-[100vh]"
      } ${className}`}
    >
      {/* Brand */}
      <div
        className={`flex h-[52px] flex-shrink-0 items-center border-b border-white/[0.08] px-3.5 ${
          collapsed ? "justify-center px-2" : "gap-2.5"
        }`}
      >
        <BrandLogo size="sm" markOnly className="h-7 w-7 rounded" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-bold tracking-wide text-white">
              {APP_SIDEBAR_TITLE}
            </div>
            <div className="truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#5D8EFA]">
              {APP_SIDEBAR_TAGLINE}
            </div>
          </div>
        )}
      </div>

      {/* Main nav */}
      <nav className="app-sidebar-nav scrollbar-hidden space-y-1 px-2 py-2">
        {mainGroups.map((group, gIdx) => (
          <div key={group.label || `main-${gIdx}`} className="pt-1 first:pt-0">
            {group.label && !collapsed ? (
              <p className="px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#64748B]">
                {translateNavLabel(t, group.label)}
              </p>
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarItem
                  key={item.to + item.label}
                  item={item}
                  pathname={pathname}
                  search={search}
                  collapsed={collapsed}
                  badges={badges}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Support / Help only at bottom */}
      {supportGroups.length > 0 ? (
        <div className="flex-shrink-0 border-t border-white/[0.08] px-2 py-1.5">
          {supportGroups.map((group, gIdx) => (
            <div key={group.label || `support-${gIdx}`}>
              {group.label && !collapsed ? (
                <p className="px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#64748B]">
                  {translateNavLabel(t, group.label)}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarItem
                    key={item.to + item.label}
                    item={item}
                    pathname={pathname}
                    search={search}
                    collapsed={collapsed}
                    badges={badges}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={`app-sidebar-footer border-t border-white/[0.08] py-2 px-3 text-[10px] text-slate-400 ${
          collapsed ? "px-1 text-center" : ""
        }`}
        title={collapsed ? `${COMPANY_NAME} · ${APP_NAME}` : undefined}
      >
        {collapsed ? (
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
            NL
          </span>
        ) : (
          <div className="flex items-center justify-between text-[10.5px] text-slate-400">
            <span>{COMPANY_NAME} · {APP_NAME}</span>
            <span className="text-[9px] text-slate-400">v6.0</span>
          </div>
        )}
      </div>
    </aside>
  );
}

interface SidebarItemProps {
  item: SidebarNavItem;
  pathname: string;
  search: string;
  collapsed: boolean;
  badges: ReturnType<typeof useProcurementBadges>;
  onNavigate?: () => void;
}

function SidebarItem({
  item,
  pathname,
  search,
  collapsed,
  badges,
  onNavigate,
}: SidebarItemProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const label = translateNavLabel(t, item.label);
  const hasChildren = (item.children?.length ?? 0) > 0;
  const active = item.childActiveState
    ? isChildNavActive(pathname, search, item.to, item.label, item.engineerNavigation, item.engineeringManagerNavigation)
    : isParentNavActive(pathname, search, item);
  const routeDrivenExpansion = item.to === "/ecr";
  const expansionKey = `${pathname}${search}`;
  const [manualExpansion, setManualExpansion] = useState<{
    key: string;
    open: boolean;
  } | null>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const expanded = routeDrivenExpansion
    ? active
    : manualExpansion?.key === expansionKey
      ? manualExpansion.open
      : active;

  const handleToggle = useCallback(() => {
    if (routeDrivenExpansion) {
      navigate(item.to);
      onNavigate?.();
      return;
    }

    setManualExpansion(() => {
      const next = !expanded;
      if (next) {
        requestAnimationFrame(() => {
          itemRef.current?.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
          });
        });
      }
      return { key: expansionKey, open: next };
    });
  }, [
    expanded,
    expansionKey,
    item.to,
    navigate,
    onNavigate,
    routeDrivenExpansion,
  ]);

  const Icon = item.icon;

  // Resolve badge count if badgeKey is specified
  const badgeCount =
    item.badgeKey === "rfqsToCreate" || item.badgeKey === "ecrsReadyForRfq"
      ? badges.rfqsToCreate
      : item.badgeKey === "rfqsPendingPublication"
        ? badges.rfqsPendingPublication
        : item.badgeKey === "supplierResponses"
          ? badges.supplierResponses
          : item.badgeKey === "quotesAwaitingEvaluation"
            ? badges.quotesAwaitingEvaluation
            : item.badgeKey === "approvalsPending"
              ? badges.approvalsPending
              : null;

  const badgeBg =
    item.badgeKey === "rfqsToCreate" || item.badgeKey === "ecrsReadyForRfq"
      ? "bg-[#DC2626]"
      : item.badgeKey === "rfqsPendingPublication"
        ? "bg-[#D97706]"
        : item.badgeKey === "supplierResponses"
          ? "bg-[#2563EB]"
          : item.badgeKey === "quotesAwaitingEvaluation"
            ? "bg-[#2563EB]"
            : "bg-[#DC2626]";

  const linkClass = (isActive: boolean) =>
    `group relative flex h-[36px] items-center rounded-lg text-[13px] font-medium transition-colors duration-150 ${
      collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"
    } ${
      isActive
        ? "bg-[#1554D1] text-white font-semibold shadow-sm"
        : "text-[#94A3B8] hover:bg-[#152449] hover:text-white"
    }`;

  const iconClass = (isActive: boolean) =>
    `h-[17px] w-[17px] flex-shrink-0 transition-colors ${
      isActive ? "text-white" : "text-[#94A3B8] group-hover:text-white"
    }`;

  if (!hasChildren) {
    return (
      <Link
        to={item.to}
        onClick={onNavigate}
        title={collapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={linkClass(active)}
      >
        <Icon className={iconClass(active)} />
        {!collapsed && <span className="truncate flex-1">{label}</span>}
        {!collapsed && badgeCount != null && badgeCount > 0 && (
          <span
            className={`min-w-[20px] h-[20px] px-1.5 flex items-center justify-center rounded-md text-[11px] font-bold text-white shadow-sm ${badgeBg}`}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </Link>
    );
  }

  if (collapsed) {
    return (
      <Link
        to={item.to}
        onClick={onNavigate}
        title={label}
        className={linkClass(active)}
      >
        <Icon className={iconClass(active)} />
      </Link>
    );
  }

  return (
    <div ref={itemRef}>
      <button
        type="button"
        onClick={handleToggle}
        className={`${linkClass(active)} w-full border-none bg-transparent text-left`}
      >
        <Icon className={iconClass(active)} />
        <span className="flex-1 truncate">{label}</span>
        {badgeCount != null && badgeCount > 0 && (
          <span
            className={`mr-1.5 min-w-[20px] h-[20px] px-1.5 flex items-center justify-center rounded-md text-[11px] font-bold text-white shadow-sm ${badgeBg}`}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 opacity-70" />
        )}
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {item.children ? (
            <div className="mt-0.5 mr-1 ml-4 border-l border-white/[0.12] pl-2">
              <div className="space-y-0.5 py-0.5">
                {item.children.map((child: NavChild) => {
                  const childActive = isChildNavActive(
                    pathname,
                    search,
                    child.to,
                    child.label,
                  );
                  const childBadgeCount =
                    child.badgeKey === "newPoQueue"
                      ? badges.newPoQueue
                      : child.badgeKey === "rfqsToCreate" || child.badgeKey === "ecrsReadyForRfq"
                        ? badges.rfqsToCreate
                        : child.badgeKey === "rfqsPendingPublication"
                          ? badges.rfqsPendingPublication
                          : child.badgeKey === "supplierResponses"
                            ? badges.supplierResponses
                            : child.badgeKey === "quotesAwaitingEvaluation"
                              ? badges.quotesAwaitingEvaluation
                              : child.badgeKey === "approvalsPending"
                                ? badges.approvalsPending
                                : null;

                  return (
                    <div key={child.to + child.label}>
                      {child.group && (
                        <p className="mb-0.5 mt-1 px-2 text-[9px] font-bold uppercase tracking-[0.1em] text-[#64748B] first:mt-0">
                          {translateNavLabel(t, child.group)}
                        </p>
                      )}
                      <Link
                        to={child.to}
                        onClick={onNavigate}
                        className={`flex h-[30px] items-center px-2 text-[12px] font-medium transition-[background-color] duration-150 ease-in-out ${
                          childActive
                            ? "rounded-md bg-[#1554D1] text-white font-semibold"
                            : "rounded-md text-[#94A3B8] hover:bg-[#152449] hover:text-white"
                        }`}
                      >
                        <span className="truncate flex-1">{translateNavLabel(t, child.label)}</span>
                        {childBadgeCount != null && childBadgeCount > 0 && (
                          <span
                            className={`ml-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded text-[10px] font-bold shadow-xs ${
                              childActive
                                ? "bg-white text-[#1554D1]"
                                : "bg-[#2563EB] text-white"
                            }`}
                          >
                            {childBadgeCount > 99 ? "99+" : childBadgeCount}
                          </span>
                        )}
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
