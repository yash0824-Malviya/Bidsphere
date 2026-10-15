import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CircleHelp,
  KeyRound,
  LogOut,
  UserRound,
} from "lucide-react";

import { useAuthStore } from "../../store/authStore";
import {
  displayNameForAuthenticatedUser,
  ROLE_LABELS,
} from "../../config/roles";

/**
 * Header avatar + account dropdown.
 * Logout uses the existing auth store — no auth logic changes.
 */
export default function UserProfileMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const displayName = user ? displayNameForAuthenticatedUser(user) : "Procurement Manager";

  const isProcurementManager =
    user?.role === "procurement" ||
    user?.email?.toLowerCase().includes("procurement");

  const avatarText = isProcurementManager
    ? "PM"
    : displayName
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((p: string) => p[0]?.toUpperCase() ?? "")
        .join("") || "PM";

  const roleLabel = user?.role ? ROLE_LABELS[user.role] : "Procurement Manager";

  const handleLogout = useCallback(() => {
    setOpen(false);
    void logout().then(() => navigate("/login", { replace: true }));
  }, [logout, navigate]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("sidebar.accountMenu", "Account menu")}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E2E8F0] bg-white p-0 transition hover:border-[#1554D1] hover:ring-2 hover:ring-primary-100 focus:outline-none"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1554D1] text-[12px] font-bold text-white tracking-wide">
          {avatarText}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white py-1 shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
        >
          <div className="border-b border-[#E2E8F0] px-3.5 py-2.5 bg-[#F8FAFC]">
            <p className="truncate text-[13.5px] font-bold text-[#12213F]">
              {displayName}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-md bg-[#EEF4FF] px-1.5 py-0.5 text-[11px] font-semibold text-[#1554D1]">
                {roleLabel}
              </span>
            </div>
            <p className="mt-1 truncate text-[11.5px] text-[#64748B]">
              {user?.email ?? "—"}
            </p>
          </div>

          <div className="py-1">
            <MenuLink
              to="/account/profile"
              icon={UserRound}
              label="Profile"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              to="/account/change-password"
              icon={KeyRound}
              label="Account Settings"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              to="/account/profile?tab=preferences"
              icon={CircleHelp}
              label="Preferences"
              onNavigate={() => setOpen(false)}
            />
          </div>

          <div className="border-t border-[#E2E8F0] py-1">
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent px-3.5 py-2 text-left text-[13px] font-semibold text-[#DC2626] transition hover:bg-[#FEF2F2]"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("sidebar.logout", "Logout")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  to,
  icon: Icon,
  label,
  onNavigate,
}: {
  to: string;
  icon: typeof UserRound;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-neutral-700 no-underline transition hover:bg-[#F8FAFC] hover:text-neutral-900"
    >
      <Icon className="h-3.5 w-3.5 text-neutral-400" />
      {label}
    </Link>
  );
}
