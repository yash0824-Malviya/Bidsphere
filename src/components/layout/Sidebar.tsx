import { useCallback, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { NavItem } from "../../utils/routes";
import { useAuthStore } from "../../store/authStore";
import { APP_SIDEBAR_TITLE, APP_SIDEBAR_TAGLINE, APP_NAME, COMPANY_NAME } from "../../config/branding";
import { getNavGroupsForRole } from "../../config/roles";
import { translateNavLabel } from "../../i18n/navLabels";
import BrandLogo from "../BrandLogo";
import { isChildNavActive } from "./sidebarNavState";

function isItemActive(pathname: string, to: string): boolean {
  if (!to) return false;
  if (pathname === to) return true;
  // Require a path boundary so `/sourcing/rfq` does not match
  // `/sourcing/rfq-templates` (and similar sibling prefixes).
  return pathname.startsWith(`${to}/`);
}

function isParentNavActive(
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
  const navGroups = getNavGroupsForRole(user?.role ?? "procurement");
  const collapsed = variant === "collapsed";

  const widthClass = collapsed
    ? "w-16 min-w-16 max-w-16"
    : "w-[280px] min-w-[280px] max-w-[280px]";

  const mainGroups = navGroups.filter(
    (g) => g.label !== "Support" && g.label !== "Help",
  );
  const supportGroups = navGroups.filter(
    (g) => g.label === "Support" || g.label === "Help",
  );

  return (
    <aside
      className={`app-sidebar ${widthClass} transition-[width] duration-300 ease-in-out ${
        fixed ? "app-sidebar-fixed" : "h-[100vh] min-h-[100vh]"
      } ${className}`}
    >
      {/* Brand */}
      <div
        className={`flex h-[52px] flex-shrink-0 items-center border-b border-white/5 ${
          collapsed ? "justify-center px-2" : "gap-2.5 px-3"
        }`}
      >
        <BrandLogo size="sm" markOnly />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold text-white">
              {APP_SIDEBAR_TITLE}
            </div>
            <div className="truncate text-[10px] font-medium uppercase tracking-[0.1em] text-primary-400">
              {APP_SIDEBAR_TAGLINE}
            </div>
          </div>
        )}
      </div>

      {/* Main nav */}
      <nav className="app-sidebar-nav scrollbar-hidden space-y-2 px-2 py-1.5">
        {mainGroups.map((group) => (
          <div key={group.label || "main"}>
            {group.label && !collapsed ? (
              <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
                {translateNavLabel(t, group.label)}
              </p>
            ) : null}
            <div className="space-y-px">
              {group.items.map((item) => (
                <SidebarItem
                  key={item.to}
                  item={item}
                  pathname={pathname}
                  search={search}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Support / Help only at bottom */}
      {supportGroups.length > 0 ? (
        <div className="flex-shrink-0 border-t border-white/5 px-2 py-2">
          {supportGroups.map((group) => (
            <div key={group.label || "support"}>
              {group.label && !collapsed ? (
                <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
                  {translateNavLabel(t, group.label)}
                </p>
              ) : null}
              <div className="space-y-px">
                {group.items.map((item) => (
                  <SidebarItem
                    key={item.to}
                    item={item}
                    pathname={pathname}
                    search={search}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={`app-sidebar-footer ${collapsed ? "px-2 text-center" : ""}`}
        title={collapsed ? `${COMPANY_NAME} · ${APP_NAME}` : undefined}
      >
        {collapsed ? (
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            NL
          </span>
        ) : (
          <>
            {COMPANY_NAME} · {APP_NAME}
          </>
        )}
      </div>
    </aside>
  );
}

interface SidebarItemProps {
  item: NavItem;
  pathname: string;
  search: string;
  collapsed: boolean;
  onNavigate?: () => void;
}

function SidebarItem({
  item,
  pathname,
  search,
  collapsed,
  onNavigate,
}: SidebarItemProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const label = translateNavLabel(t, item.label);
  const hasChildren = (item.children?.length ?? 0) > 0;
  const active = isParentNavActive(pathname, search, item);
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

  const linkClass = (isActive: boolean) =>
    `group relative flex h-10 items-center rounded-xl text-[13px] font-medium transition-colors duration-150 ${
      collapsed ? "justify-center px-2" : "gap-2.5 px-3"
    } ${
      isActive
        ? "bg-white/[0.10] text-white"
        : "text-sidebar-text hover:bg-white/[0.06] hover:text-white"
    }`;

  const iconClass = (isActive: boolean) =>
    `h-5 w-5 flex-shrink-0 transition-colors ${
      isActive ? "text-white" : "text-sidebar-text group-hover:text-white"
    }`;

  if (!hasChildren) {
    return (
      <Link
        to={item.to}
        onClick={onNavigate}
        title={collapsed ? label : undefined}
        className={linkClass(active)}
      >
        <Icon className={iconClass(active)} />
        {!collapsed && <span className="truncate">{label}</span>}
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
        {expanded ? (
          <ChevronDown className="h-3 w-3 opacity-70" />
        ) : (
          <ChevronRight className="h-3 w-3 opacity-70" />
        )}
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {item.children ? (
            <div className="mt-1 mr-2 ml-5 border-l border-white/15 pl-2.5">
              <div className="space-y-0.5">
                {item.children.map((child) => {
                  const childActive = isChildNavActive(
                    pathname,
                    search,
                    child.to,
                    child.label,
                  );
                  return (
                    <div key={child.to}>
                      {child.group && (
                        <p className="mb-0.5 mt-1 px-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-500 first:mt-0">
                          {translateNavLabel(t, child.group)}
                        </p>
                      )}
                      <Link
                        to={child.to}
                        onClick={onNavigate}
                        className={`mx-1 flex h-8 items-center px-2 text-[12px] font-medium transition-[background-color] duration-150 ease-in-out ${
                          childActive
                            ? "rounded-[10px] bg-white/[0.10] text-white"
                            : "rounded-lg text-sidebar-text hover:bg-white/[0.06] hover:text-white"
                        }`}
                      >
                        {translateNavLabel(t, child.label)}
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
