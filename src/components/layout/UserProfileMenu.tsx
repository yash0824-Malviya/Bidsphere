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

  const displayName = user
    ? displayNameForAuthenticatedUser(user)
    : t("sidebar.signedOut", "Signed out");

  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

  const roleLabel = user?.role ? ROLE_LABELS[user.role] : "—";

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
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("sidebar.accountMenu", "Account menu")}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[#E8EDF5] bg-white p-0 transition hover:border-primary-200 hover:ring-2 hover:ring-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-white">
          {initials}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-[#E8EDF5] bg-white py-1 shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
        >
          <div className="border-b border-[#E8EDF5] px-3.5 py-3">
            <p className="truncate text-[14px] font-semibold text-neutral-900">
              {displayName}
            </p>
            <p className="mt-0.5 truncate text-[12px] font-medium text-primary-700">
              {roleLabel}
            </p>
            <p className="mt-0.5 truncate text-[12px] text-neutral-500">
              {user?.email ?? "—"}
            </p>
          </div>

          <div className="py-1">
            <MenuLink
              to="/account/profile"
              icon={UserRound}
              label="My Profile"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              to="/account/change-password"
              icon={KeyRound}
              label="Change Password"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              to="/support/help-desk"
              icon={CircleHelp}
              label="Help"
              onNavigate={() => setOpen(false)}
            />
          </div>

          <div className="border-t border-[#E8EDF5] py-1">
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent px-3.5 py-2 text-left text-[13px] font-medium text-rose-600 transition hover:bg-rose-50"
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
