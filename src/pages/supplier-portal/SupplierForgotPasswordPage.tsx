import type { FormEvent } from "react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, KeyRound, Loader2, Mail } from "lucide-react";

import {
  portalForgotPassword,
  portalResetPasswordWithOtp,
} from "../../api/supplierOnboarding";
import {
  PORTAL_PASSWORD_MAX_LEN,
  PORTAL_PASSWORD_MIN_LEN,
  PORTAL_PASSWORD_POLICY_MESSAGE,
  validatePortalPassword,
} from "../../utils/supplierPortalPassword";
import { APP_SUPPLIER_PORTAL } from "../../config/branding";
import SupplierLoginHeroPanel from "../../components/supplier-portal/SupplierLoginHeroPanel";

export default function SupplierForgotPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState(() => params.get("email") || "");
  const [otp, setOtp] = useState("");
  const [issuedOtp, setIssuedOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onRequestOtp(e: FormEvent) {
    e.preventDefault();
    const username = email.trim().toLowerCase();
    if (!username.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await portalForgotPassword({
        email: username,
        origin: window.location.origin,
      });
      if (res.otp) {
        setIssuedOtp(res.otp);
        setOtp(res.otp);
      }
      toast.success(res.message || "If an account exists, an OTP was issued.");
      setStep("reset");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start password reset");
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match.");
      return;
    }
    const check = validatePortalPassword(newPassword);
    if (!check.ok) {
      toast.error(check.message || PORTAL_PASSWORD_POLICY_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const res = await portalResetPasswordWithOtp({
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
        new_password: newPassword,
      });
      toast.success(res.message || "Password updated. Please sign in.");
      navigate("/supplier/login", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Password reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <SupplierLoginHeroPanel />
      <aside className="relative flex w-full flex-col justify-center bg-white px-6 py-10 lg:w-[35%] lg:min-h-screen lg:px-10 lg:py-12">
        <div className="relative mx-auto w-full max-w-[400px]">
          <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm sm:p-8">
            <Link
              to="/supplier/login"
              className="mb-5 inline-flex items-center gap-1 text-xs font-semibold text-[#146CE8] no-underline hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </Link>
            <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-[#0ea5e9] text-white shadow-md shadow-[#0ea5e9]/25">
              {step === "request" ? (
                <Mail className="h-5 w-5" />
              ) : (
                <KeyRound className="h-5 w-5" />
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
              {step === "request" ? "Forgot password" : "Reset with OTP"}
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              {step === "request"
                ? `Request a one-time passcode for your ${APP_SUPPLIER_PORTAL} account.`
                : "Enter the OTP and choose a new password that meets the security policy."}
            </p>

            {step === "request" ? (
              <form className="mt-6 space-y-4" onSubmit={(e) => void onRequestOtp(e)}>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-neutral-700">Email</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                    autoComplete="email"
                    placeholder="you@company.com"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0B3D91] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Send OTP
                </button>
              </form>
            ) : (
              <form className="mt-6 space-y-4" onSubmit={(e) => void onReset(e)}>
                {issuedOtp ? (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                    Demo / no SMTP: your OTP is{" "}
                    <span className="font-mono font-bold tracking-widest">{issuedOtp}</span>
                    . It expires in 10 minutes.
                  </div>
                ) : null}
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-neutral-700">Email</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                    autoComplete="email"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-neutral-700">
                    One-time passcode (OTP)
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 font-mono text-sm tracking-[0.3em]"
                    autoComplete="one-time-code"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-neutral-700">New password</span>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                    autoComplete="new-password"
                    minLength={PORTAL_PASSWORD_MIN_LEN}
                    maxLength={PORTAL_PASSWORD_MAX_LEN}
                  />
                  <span className="mt-1 block text-xs text-neutral-500">
                    {PORTAL_PASSWORD_POLICY_MESSAGE}
                  </span>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-neutral-700">
                    Confirm password
                  </span>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                    autoComplete="new-password"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0B3D91] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Reset password
                </button>
                <button
                  type="button"
                  className="w-full text-center text-xs font-semibold text-[#146CE8]"
                  onClick={() => setStep("request")}
                >
                  Request a new OTP
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
