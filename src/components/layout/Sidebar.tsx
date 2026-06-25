import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  LogOut,
} from "lucide-react";
import type { NavItem } from "../../utils/routes";
import { useAuthStore } from "../../store/authStore";
import { APP_SIDEBAR_TITLE, APP_SIDEBAR_TAGLINE } from "../../config/branding";
import { getNavGroupsForRole, ROLE_LABELS } from "../../config/roles";
import BrandLogo from "../BrandLogo";

function isItemActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export type SidebarVariant = "full" | "collapsed" | "drawer";

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
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navGroups = getNavGroupsForRole(user?.role ?? "procurement");
  const collapsed = variant === "collapsed";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = useCallback(() => {
    setMenuOpen(false);
    void logout().then(() => navigate("/login", { replace: true }));
  }, [logout, navigate]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("") || "?"
    : "?";

  const widthClass =
    variant === "collapsed"
      ? "w-[72px]"
      : "w-[240px]";

  return (
    <aside
      className={`flex flex-shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-text transition-[width] duration-300 ease-in-out ${widthClass} ${
        fixed ? "fixed left-0 top-0 z-40 h-[100dvh] min-h-screen" : "h-full min-h-0"
      } ${className}`}
    >
      <div
        className={`flex flex-shrink-0 items-center border-b border-white/5 py-4 ${
          collapsed ? "justify-center px-2" : "gap-3 px-4"
        }`}
      >
        <BrandLogo size="sm" markOnly />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-bold text-white">
              {APP_SIDEBAR_TITLE}
            </div>
            <div className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-primary-400">
              {APP_SIDEBAR_TAGLINE}
            </div>
          </div>
        )}
      </div>

      <nav className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain scroll-smooth px-2 py-3 md:px-3">
        {navGroups.map((group) => (
          <div key={group.label}>
            {group.label && !collapsed ? (
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
                {group.label}
              </p>
            ) : null}
            <div className="space-y-0.5">
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

      <div ref={menuRef} className="relative flex-shrink-0 border-t border-white/5 px-2 py-4 md:px-3">
        {/* Dropdown menu — positioned above the card */}
        {menuOpen && !collapsed && (
          <div className="absolute bottom-full left-2 right-2 mb-1.5 rounded-lg border border-white/10 bg-[#1e293b] py-1 shadow-xl md:left-3 md:right-3">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-red-400 transition hover:bg-white/5 hover:text-red-300 cursor-pointer bg-transparent border-none text-left"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        )}

        {/* User card — clickable to toggle dropdown */}
        <button
          type="button"
          onClick={() => {
            if (collapsed) {
              handleLogout();
            } else {
              setMenuOpen((v) => !v);
            }
          }}
          title={collapsed ? "Log out" : "Account menu"}
          className={`flex w-full items-center rounded-lg bg-white/[0.03] py-2.5 transition hover:bg-white/[0.07] cursor-pointer border-none text-left ${
            collapsed ? "justify-center px-1" : "gap-3 px-2.5"
          }`}
        >
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
            {initials}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-white">
                  {user?.full_name ?? "Signed out"}
                </div>
                <div className="truncate text-[11px] text-sidebar-text">
                  {user?.email ?? ""}
                </div>
                {user?.role ? (
                  <div className="truncate text-[10px] text-primary-400">
                    {ROLE_LABELS[user.role]}
                  </div>
                ) : null}
              </div>
              <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-sidebar-text transition-transform ${menuOpen ? "rotate-180" : ""}`} />
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

function isChildNavActive(
  pathname: string,
  search: string,
  to: string
): boolean {
  const [toPath, toQuery = ""] = to.split("?");
  if (pathname !== toPath) return false;

  const current = new URLSearchParams(search);
  if (toQuery) {
    const expected = new URLSearchParams(toQuery);
    for (const [key, value] of expected.entries()) {
      if (current.get(key) !== value) return false;
    }
    return true;
  }

  if (toPath === "/suppliers" && current.get("tab") === "performance") {
    return false;
  }

  return true;
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
  const active = isItemActive(pathname, item.to);
  const hasChildren = (item.children?.length ?? 0) > 0;
  const [open, setOpen] = useState(active && hasChildren);
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active && hasChildren) setOpen(true);
  }, [active, hasChildren]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        requestAnimationFrame(() => {
          itemRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      }
      return next;
    });
  }, []);

  const Icon = item.icon;

  const linkClass = (isActive: boolean) =>
    `group relative flex items-center rounded-lg text-[13px] font-medium transition-all duration-200 ${
      collapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-3 py-2"
    } ${
      isActive
        ? "bg-primary/15 text-white shadow-[inset_3px_0_0_0_#0ea5e9]"
        : "text-sidebar-text hover:bg-white/5 hover:text-white"
    }`;

  if (!hasChildren) {
    return (
      <Link
        to={item.to}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={linkClass(active)}
      >
        <Icon
          className={`h-4 w-4 flex-shrink-0 transition-colors ${
            active ? "text-primary-400" : "text-sidebar-text group-hover:text-white"
          }`}
        />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  }

  if (collapsed) {
    return (
      <Link
        to={item.to}
        onClick={onNavigate}
        title={item.label}
        className={linkClass(active)}
      >
        <Icon
          className={`h-4 w-4 flex-shrink-0 transition-colors ${
            active ? "text-primary-400" : "text-sidebar-text group-hover:text-white"
          }`}
        />
      </Link>
    );
  }

  return (
    <div ref={itemRef}>
      <button
        type="button"
        onClick={handleToggle}
        className={`${linkClass(active)} w-full text-left`}
      >
        <Icon
          className={`h-4 w-4 flex-shrink-0 transition-colors ${
            active ? "text-primary-400" : "text-sidebar-text group-hover:text-white"
          }`}
        />
        <span className="flex-1 truncate">{item.label}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 opacity-60" />
        )}
      </button>

      {open && item.children && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
          {item.children.map((child) => {
            const childActive = isChildNavActive(pathname, search, child.to);
            return (
              <div key={child.to}>
                {child.group && (
                  <p className="mb-0.5 mt-2 px-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-neutral-500 first:mt-0.5">
                    {child.group}
                  </p>
                )}
                <Link
                  to={child.to}
                  onClick={onNavigate}
                  className={`block rounded-md px-3 py-1.5 text-[13px] font-medium transition-all duration-200 ${
                    childActive
                      ? "bg-primary/15 text-white shadow-[inset_2px_0_0_0_#0ea5e9]"
                      : "text-sidebar-text hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {child.label}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
