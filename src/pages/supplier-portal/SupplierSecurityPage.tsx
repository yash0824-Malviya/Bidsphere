import type { FormEvent, InputHTMLAttributes } from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  History,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";

import {
  portalChangePassword,
  portalChangePin,
  portalGetSecurity,
  portalLogoutOtherSessions,
} from "../../api/supplierOnboarding";
import { Skeleton, TableSkeleton } from "../../components/Skeleton";
import {
  useSupplierSession,
  readSupplierSession,
  writeSupplierSession,
} from "../../hooks/useSupplierSession";
import {
  PORTAL_PASSWORD_MAX_LEN,
  PORTAL_PASSWORD_MIN_LEN,
  PORTAL_PASSWORD_POLICY_MESSAGE,
  validatePortalPassword,
} from "../../utils/supplierPortalPassword";
import { formatDateTime } from "../../utils/format";

export default function SupplierSecurityPage() {
  const queryClient = useQueryClient();
  const {
    supplierName,
    erpSupplierName,
    sessionToken,
    authMode,
    isReady,
    isAuthenticated,
    displayStatus,
  } = useSupplierSession({ requirePasswordChange: false });

  const securityQuery = useQuery({
    queryKey: ["portal-security", sessionToken || erpSupplierName],
    queryFn: () =>
      portalGetSecurity(
        sessionToken
          ? { session_token: sessionToken }
          : { supplier_name: erpSupplierName },
      ),
    enabled: isAuthenticated && !!(sessionToken || erpSupplierName),
    retry: 1,
  });

  /* ── Change password ─────────────────────────────────────────────────── */
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (!sessionToken) throw new Error("Account login required to change password.");
      if (newPassword !== confirmPassword) {
        throw new Error("New password and confirmation do not match.");
      }
      const check = validatePortalPassword(newPassword);
      if (!check.ok) throw new Error(check.message || PORTAL_PASSWORD_POLICY_MESSAGE);
      return portalChangePassword({
        session_token: sessionToken,
        current_password: currentPassword,
        new_password: newPassword,
      });
    },
    onSuccess: (res) => {
      const current = readSupplierSession();
      if (current) {
        writeSupplierSession({
          ...current,
          firstLogin: false,
          unlocked: !!res.unlocked,
          displayStatus: res.display_status || current.displayStatus,
        });
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated successfully.");
      void queryClient.invalidateQueries({ queryKey: ["portal-security"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Password change failed");
    },
  });

  /* ── Change PIN ──────────────────────────────────────────────────────── */
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const pinMutation = useMutation({
    mutationFn: async () => {
      if (!/^\d{4}$/.test(newPin)) throw new Error("New PIN must be exactly 4 digits.");
      if (newPin !== confirmPin) throw new Error("New PIN and confirmation do not match.");
      return portalChangePin({
        session_token: sessionToken || undefined,
        supplier_name: erpSupplierName || undefined,
        current_pin: currentPin,
        new_pin: newPin,
      });
    },
    onSuccess: (res) => {
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      toast.success(res.message || "Portal PIN updated successfully.");
      void queryClient.invalidateQueries({ queryKey: ["portal-security"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "PIN change failed");
    },
  });

  const logoutOthersMutation = useMutation({
    mutationFn: async () => {
      if (!sessionToken) throw new Error("Account session required.");
      return portalLogoutOtherSessions({ session_token: sessionToken });
    },
    onSuccess: (res) => {
      toast.success(res.message || "Other devices signed out.");
      void queryClient.invalidateQueries({ queryKey: ["portal-security"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not sign out other devices");
    },
  });

  const history = securityQuery.data?.login_history ?? [];
  const sessions = securityQuery.data?.active_sessions ?? [];
  const otherSessions = useMemo(
    () => sessions.filter((s) => !s.is_current),
    [sessions],
  );

  if (!isReady || !isAuthenticated) return null;

  return (
    
      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              to="/supplier/profile"
              className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-[#146CE8] no-underline hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Profile
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0B3D91] to-[#146CE8] text-white shadow-sm">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
                  Account Security
                </h1>
                <p className="text-sm text-slate-500">
                  Manage password, portal PIN, sessions, and login history
                </p>
              </div>
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
            {authMode === "pin" ? "PIN session" : "Account session"}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Change password */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#146CE8]" />
              <h2 className="text-sm font-semibold text-slate-900">Change Password</h2>
            </div>
            {!sessionToken ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Sign in with Account Login to change your portal password. PIN sessions
                can update the Portal PIN below.
              </p>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  passwordMutation.mutate();
                }}
              >
                <Field
                  label="Current Password"
                  type="password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  autoComplete="current-password"
                  required
                />
                <Field
                  label="New Password"
                  type="password"
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                  required
                  minLength={PORTAL_PASSWORD_MIN_LEN}
                  maxLength={PORTAL_PASSWORD_MAX_LEN}
                  hint={PORTAL_PASSWORD_POLICY_MESSAGE}
                />
                <Field
                  label="Confirm Password"
                  type="password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                  required
                  minLength={PORTAL_PASSWORD_MIN_LEN}
                  maxLength={PORTAL_PASSWORD_MAX_LEN}
                />
                <button
                  type="submit"
                  disabled={passwordMutation.isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0B3D91] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#146CE8] disabled:opacity-60"
                >
                  {passwordMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  Update Password
                </button>
              </form>
            )}
          </section>

          {/* Change PIN */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#146CE8]" />
              <h2 className="text-sm font-semibold text-slate-900">Change Portal PIN</h2>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Used for Company PIN login. Default PIN is{" "}
              <span className="font-semibold">1234</span> until customized.
              {securityQuery.data?.auth_modes.pin_customized
                ? " A custom PIN is currently active."
                : ""}
            </p>
            <form
              className="space-y-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                pinMutation.mutate();
              }}
            >
              <Field
                label="Current PIN"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={currentPin}
                onChange={setCurrentPin}
                required
              />
              <Field
                label="New PIN"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={newPin}
                onChange={setNewPin}
                required
                hint="Exactly 4 digits"
              />
              <Field
                label="Confirm PIN"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={confirmPin}
                onChange={setConfirmPin}
                required
              />
              <button
                type="submit"
                disabled={pinMutation.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#0B3D91] bg-white px-4 py-2.5 text-sm font-semibold text-[#0B3D91] shadow-sm transition hover:bg-[#0B3D91]/5 disabled:opacity-60"
              >
                {pinMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Update PIN
              </button>
            </form>
          </section>
        </div>

        {/* Active sessions */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 text-[#146CE8]" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Active Sessions</h2>
                <p className="text-[11px] text-slate-500">
                  Devices currently signed in to your portal account
                </p>
              </div>
            </div>
            {sessionToken && (
              <button
                type="button"
                disabled={logoutOthersMutation.isPending || otherSessions.length === 0}
                onClick={() => logoutOthersMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
              >
                {logoutOthersMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5" />
                )}
                Logout All Other Devices
              </button>
            )}
          </div>
          {securityQuery.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              {sessionToken
                ? "No tracked sessions yet. Sign in again to register this device."
                : "Active session tracking is available for Account Login sessions."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {s.browser} · {s.device}
                      {s.is_current && (
                        <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          This device
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      IP {s.ip} · Last seen {formatDateTime(s.last_seen)}
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Started {formatDateTime(s.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Login history */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
            <History className="h-4 w-4 text-[#146CE8]" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Login History</h2>
              <p className="text-[11px] text-slate-500">
                Recent sign-in attempts for your supplier account
              </p>
            </div>
          </div>
          {securityQuery.isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : history.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              No login history recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Login Date &amp; Time</th>
                    <th className="px-3 py-2.5">Browser</th>
                    <th className="px-3 py-2.5">Device</th>
                    <th className="px-3 py-2.5">IP Address</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 tabular-nums text-slate-700">
                        {formatDateTime(row.at)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{row.browser}</td>
                      <td className="px-3 py-2.5 text-slate-700">{row.device}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                        {row.ip}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                            row.status === "Success"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : "bg-rose-50 text-rose-700 ring-rose-200"
                          }`}
                        >
                          {row.status}
                          {row.auth_mode === "pin" ? " · PIN" : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  ...rest
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none ring-[#146CE8]/30 focus:border-[#146CE8] focus:ring-2"
      />
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}
