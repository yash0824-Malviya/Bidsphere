import type { FormEvent } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { KeyRound, Loader2 } from "lucide-react";

import { portalChangePassword } from "../../api/supplierOnboarding";
import {
  useSupplierSession,
  writeSupplierSession,
  readSupplierSession,
} from "../../hooks/useSupplierSession";
import {
  PORTAL_PASSWORD_MAX_LEN,
  PORTAL_PASSWORD_MIN_LEN,
  PORTAL_PASSWORD_POLICY_MESSAGE,
  logPortalPasswordValidation,
  validatePortalPassword,
} from "../../utils/supplierPortalPassword";
import SupplierPortalLayout from "./SupplierPortalLayout";

export default function SupplierChangePasswordPage() {
  const navigate = useNavigate();
  const { supplierName, sessionToken, isReady, isAuthenticated } = useSupplierSession({
    requirePasswordChange: false,
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match.");
      return;
    }

    const check = validatePortalPassword(newPassword);
    if (!check.ok) {
      logPortalPasswordValidation(
        "SupplierChangePasswordPage",
        check,
        newPassword.length,
      );
      toast.error(check.message || PORTAL_PASSWORD_POLICY_MESSAGE);
      return;
    }

    setBusy(true);
    try {
      const res = await portalChangePassword({
        session_token: sessionToken,
        current_password: currentPassword,
        new_password: newPassword,
      });
      const current = readSupplierSession();
      if (current) {
        writeSupplierSession({
          ...current,
          firstLogin: false,
          unlocked: !!res.unlocked,
          displayStatus: res.display_status,
          linkedSupplier: res.linked_supplier || current.linkedSupplier,
        });
      }
      toast.success("Password updated successfully.");
      navigate("/supplier/security", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isReady || !isAuthenticated) return null;

  return (
    <SupplierPortalLayout supplierName={supplierName} statusBadge="Pending">
      <div className="mx-auto max-w-lg px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-full bg-amber-50 p-2 text-amber-700">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Change password</h1>
              <p className="text-sm text-slate-600">
                For security, set a new password before continuing to onboarding.
              </p>
            </div>
          </div>
          <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Current password</span>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                autoComplete="current-password"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">New password</span>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                autoComplete="new-password"
                minLength={PORTAL_PASSWORD_MIN_LEN}
                maxLength={PORTAL_PASSWORD_MAX_LEN}
              />
              <span className="mt-1 block text-xs text-slate-500">
                {PORTAL_PASSWORD_POLICY_MESSAGE}
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Confirm password</span>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                autoComplete="new-password"
                minLength={PORTAL_PASSWORD_MIN_LEN}
                maxLength={PORTAL_PASSWORD_MAX_LEN}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Update password
            </button>
          </form>
        </div>
      </div>
    </SupplierPortalLayout>
  );
}
