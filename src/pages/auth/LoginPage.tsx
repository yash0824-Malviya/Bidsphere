import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
  User,
} from "lucide-react";

import AuthShell from "../../components/auth/AuthShell";
import BrandLogo from "../../components/BrandLogo";
import { POST_LOGIN_DESTINATION } from "../../utils/authRedirect";
import { logMfaEnvDiagnostics } from "../../config/mfaConfig";
import { prefetchDashboardForRole } from "../../api/prefetchDashboard";
import { useAuthStore, setMfaRedirectPath } from "../../store/authStore";
import type { AppRole } from "../../config/roles";
import {
  detectAuthSource,
  getActivePortal,
  hasActiveSupplierSession,
  logPortalAuthDecision,
  portalForRole,
  portalPermissionDeniedMessage,
  PORTAL_LOGIN_PATH,
  replacePreviousStaffSession,
  replacePreviousSupplierSession,
  roleMatchesStaffPortal,
  setActivePortal,
  setLoginPortalAffinity,
  staffPortalLabel,
  type StaffLoginPortal,
} from "../../utils/portalAuth";

/*
 * Presentation lives in the shared `AuthShell` (background + branding). All
 * colours come from the Tailwind theme tokens defined in `tailwind.config.js`
 * (primary / neutral / danger) plus white-with-opacity glass surfaces — no
 * page-level hard-coded hex values. The only literal colours are inside the
 * official Microsoft / Google brand marks, which must use their trademarked
 * palettes.
 */

interface LoginPageProps {
  /** When set, only matching roles may complete sign-in on this page. */
  portal?: StaffLoginPortal;
}

export default function LoginPage({ portal }: LoginPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const portalAffinity = portal ?? "staff";
  const loginPath = portal
    ? PORTAL_LOGIN_PATH[portal]
    : PORTAL_LOGIN_PATH.staff;

  useEffect(() => {
    setLoginPortalAffinity(portalAffinity);
    // Temporary diagnostics — confirms whether Demo MFA was baked into this bundle.
    // eslint-disable-next-line no-console
    console.log("VITE_DEMO_MFA =", import.meta.env.VITE_DEMO_MFA);
    // eslint-disable-next-line no-console
    console.log("DEMO_MFA =", (import.meta.env as { DEMO_MFA?: string }).DEMO_MFA);
    logMfaEnvDiagnostics("LoginPage");
  }, [portalAffinity]);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isVerifying = useAuthStore((s) => s.isVerifying);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const mfaPending = useAuthStore((s) => s.mfaPending);
  const sessionRestoreError = useAuthStore((s) => s.sessionRestoreError);
  const clearSessionRestoreError = useAuthStore((s) => s.clearSessionRestoreError);
  const login = useAuthStore((s) => s.login);
  const user = useAuthStore((s) => s.user);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionRestoreError) return;
    const timer = window.setTimeout(() => {
      setFormError(sessionRestoreError);
      toast.error(sessionRestoreError);
      clearSessionRestoreError();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sessionRestoreError, clearSessionRestoreError]);

  useEffect(() => {
    if (!hasHydrated || isVerifying) return;

    // Previous supplier session must not block staff credential entry — replace it.
    if (hasActiveSupplierSession()) {
      replacePreviousSupplierSession("replace-supplier-on-staff-login-page");
    }

    if (isAuthenticated && user) {
      const role = user.role as AppRole;
      // Matching role → continue into the portal. Mismatch → replace session
      // silently so the user can sign in with the correct account.
      if (!roleMatchesStaffPortal(role, portalAffinity)) {
        replacePreviousStaffSession("replace-staff-session-for-portal-login");
        return;
      }
      const target = POST_LOGIN_DESTINATION;
      const previousPortal = getActivePortal() ?? portalForRole(role);
      const newPortal = portalForRole(role) ?? portalAffinity;
      setActivePortal(newPortal);
      logPortalAuthDecision({
        username: user.name || user.email,
        requestedPortal: portalAffinity,
        erpRoles: user.erpnext_roles ?? null,
        previousPortal,
        newPortal,
        redirectTarget: target,
        currentUrl: location.pathname,
        currentRole: role,
        authSource: detectAuthSource(),
        reason: "authenticated-role-matched-portal-login",
      });
      navigate(target, { replace: true });
      return;
    }

    if (mfaPending && !isAuthenticated) {
      const pendingRole = mfaPending.user.role as AppRole;
      if (!roleMatchesStaffPortal(pendingRole, portalAffinity)) {
        replacePreviousStaffSession("replace-mfa-pending-for-portal-login");
        return;
      }
      navigate("/verify-otp", { replace: true });
    }
  }, [
    hasHydrated,
    isAuthenticated,
    isVerifying,
    mfaPending,
    navigate,
    user,
    portalAffinity,
    location.pathname,
  ]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setLoginPortalAffinity(portalAffinity);

    if (!username.trim() || !password) {
      const msg = t("login.enterCredentials");
      setFormError(msg);
      toast.error(msg);
      return;
    }

    const previousPortal =
      getActivePortal() ??
      portalForRole(useAuthStore.getState().user?.role as AppRole | undefined);

    try {
      // Always replace any prior portal session before minting a new one.
      replacePreviousSupplierSession("replace-supplier-before-staff-login");
      replacePreviousStaffSession("replace-staff-before-new-login");

      const outcome = await login(username.trim(), password, rememberMe, {
        requestedPortal: portalAffinity,
        previousPortal,
      });
      const requiresMFA = outcome === "mfa";
      const signedIn =
        useAuthStore.getState().user ??
        useAuthStore.getState().mfaPending?.user ??
        null;
      const role = (signedIn?.role ?? "procurement") as AppRole;
      const erpRoles = signedIn?.erpnext_roles ?? [];

      // Portal-scoped pages: deny when ERP roles do not grant access.
      if (!roleMatchesStaffPortal(role, portalAffinity)) {
        const denied = portalPermissionDeniedMessage(portalAffinity);
        replacePreviousStaffSession("login-denied-missing-portal-role");
        logPortalAuthDecision({
          username: username.trim(),
          requestedPortal: portalAffinity,
          erpRoles,
          previousPortal,
          newPortal: null,
          redirectTarget: loginPath,
          currentUrl: location.pathname,
          currentRole: role,
          reason: "login-denied-missing-portal-role",
        });
        setFormError(denied);
        toast.error(denied);
        return;
      }

      const newPortal = portalForRole(role) ?? portalAffinity;
      setActivePortal(newPortal);
      setLoginPortalAffinity(portalAffinity);

      const destination = requiresMFA
        ? "/verify-otp"
        : POST_LOGIN_DESTINATION;

      logPortalAuthDecision({
        username: username.trim(),
        requestedPortal: portalAffinity,
        erpRoles,
        previousPortal,
        newPortal,
        redirectTarget: destination,
        currentUrl: location.pathname,
        currentRole: role,
        authSource: detectAuthSource(),
        reason: requiresMFA ? "login-mfa-required" : "login-success-redirect",
      });

      if (outcome === "mfa") {
        setMfaRedirectPath(POST_LOGIN_DESTINATION);
        toast.success(t("login.credentialsVerified"));
        navigate("/verify-otp", { replace: true });
      } else {
        toast.success(t("login.signedInSuccess"));
        const signedInUser = useAuthStore.getState().user;
        if (signedInUser) {
          prefetchDashboardForRole(signedInUser.role);
          navigate(destination, { replace: true });
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("login.signInFailed");
      setFormError(message);
      toast.error(message);
    }
  };

  // TODO: Integrate Microsoft Entra ID (Azure AD)
  const handleMicrosoftSso = () => {
    toast(t("login.microsoftSoon"));
  };

  // TODO: Integrate Google Workspace OAuth
  const handleGoogleSso = () => {
    toast(t("login.googleSoon"));
  };

  // TODO: Wire up self-service password reset
  const handleForgotPassword = () => {
    toast(t("login.forgotPassword"));
  };

  if (!hasHydrated || isVerifying) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-900">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/15 bg-white/10 px-10 py-8 shadow-2xl backdrop-blur-xl">
          <Loader2 className="h-8 w-8 animate-spin text-primary-300" />
          <p className="text-sm font-medium tracking-wide text-white/80">
            {t("login.restoringSession")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <AuthShell>
      <div
        className="bsphere-rise mx-auto flex w-full max-w-[440px] flex-col items-center"
        style={{ animationDelay: "120ms" }}
      >
            <div className="flex w-full max-h-[min(720px,calc(100dvh-7.5rem))] flex-col overflow-hidden rounded-[24px] border border-white/40 bg-white/80 px-5 py-5 shadow-[0_18px_48px_-22px_rgba(3,32,71,0.55)] ring-1 ring-white/30 backdrop-blur-2xl">
              {/* Card header */}
              <div className="flex shrink-0 flex-col items-center text-center">
                <BrandLogo whiteBg size="md" />
                <h2 className="mt-3 text-xl font-semibold tracking-tight text-neutral-900">
                  {t("login.welcomeBack")}
                </h2>
                <p className="mt-1 text-sm leading-snug text-neutral-500">
                  {portal
                    ? `Sign in to the ${staffPortalLabel(portal)} portal`
                    : t("login.subtitle")}
                </p>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="mt-3 shrink-0 rounded-xl border border-danger-100 bg-danger-50/90 px-3 py-2 text-left text-sm text-danger-700"
                >
                  {formError}
                </div>
              )}

              <form
                onSubmit={handleSubmit}
                className={`space-y-2.5 ${formError ? "mt-2.5" : "mt-4"}`}
              >
                <GlassField
                  id="username"
                  label={t("login.usernameLabel")}
                  icon={<User className="h-4 w-4" />}
                  value={username}
                  onChange={(v) => {
                    setUsername(v);
                    setFormError(null);
                  }}
                  placeholder={t("login.usernamePlaceholder")}
                  autoComplete="username"
                  required
                  disabled={isLoading}
                />

                <PasswordField
                  label={t("login.passwordLabel")}
                  value={password}
                  onChange={(v) => {
                    setPassword(v);
                    setFormError(null);
                  }}
                  placeholder={t("login.passwordPlaceholder")}
                  disabled={isLoading}
                  show={showPassword}
                  onToggleShow={() => setShowPassword((v) => !v)}
                  showLabel={t("login.showPassword")}
                  hideLabel={t("login.hidePassword")}
                />

                <div className="flex items-center justify-between gap-3 pt-0.5">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      disabled={isLoading}
                      className="h-4 w-4 shrink-0 rounded border-neutral-300 text-primary focus:ring-primary/30"
                    />
                    {t("login.rememberMe")}
                  </label>

                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={isLoading}
                    className="shrink-0 text-sm font-medium text-primary-600 transition hover:text-primary-700 disabled:opacity-60"
                  >
                    {t("login.forgotPassword")}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-md shadow-primary/25 transition-all hover:bg-primary-600 hover:shadow-primary/35 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("login.signingIn")}
                    </>
                  ) : (
                    <>
                      {t("login.signIn")}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-3">
                <Divider label={t("login.or")} />

                <div className="mt-2.5 flex w-full flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-center">
                  <SsoButton
                    label="Microsoft"
                    icon={<MicrosoftIcon />}
                    onClick={handleMicrosoftSso}
                    disabled={isLoading}
                  />
                  <SsoButton
                    label="Google"
                    icon={<GoogleIcon />}
                    onClick={handleGoogleSso}
                    disabled={isLoading}
                  />
                </div>
              </div>
            </div>

            <p className="mt-2.5 flex shrink-0 items-center justify-center gap-1.5 text-xs text-white/70">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              {t("login.secureNotice")}
            </p>
      </div>
    </AuthShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Reusable presentational components                                        */
/* -------------------------------------------------------------------------- */

const glassInputCls =
  "h-11 w-full rounded-xl border border-white/70 bg-white/70 px-3.5 text-sm leading-none text-neutral-900 shadow-sm transition placeholder:text-neutral-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60";

interface GlassFieldProps {
  id: string;
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
}

function GlassField({
  id,
  label,
  icon,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  disabled,
}: GlassFieldProps) {
  return (
    <div className="w-full">
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-neutral-700"
      >
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-0 top-0 flex h-11 w-10 items-center justify-center text-neutral-400">
          {icon}
        </span>
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          className={`${glassInputCls} pl-10`}
        />
      </div>
    </div>
  );
}

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  show: boolean;
  onToggleShow: () => void;
  showLabel: string;
  hideLabel: string;
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  show,
  onToggleShow,
  showLabel,
  hideLabel,
}: PasswordFieldProps) {
  return (
    <div className="w-full">
      <label
        htmlFor="password"
        className="mb-1.5 block text-sm font-medium text-neutral-700"
      >
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-0 top-0 flex h-11 w-10 items-center justify-center text-neutral-400">
          <Lock className="h-4 w-4" />
        </span>
        <input
          id="password"
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="current-password"
          required
          disabled={disabled}
          className={`${glassInputCls} pl-10 pr-11`}
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-neutral-400 transition hover:text-neutral-700"
          aria-label={show ? hideLabel : showLabel}
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="relative flex items-center">
      <div className="flex-1 border-t border-neutral-300/70" />
      <span className="mx-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </span>
      <div className="flex-1 border-t border-neutral-300/70" />
    </div>
  );
}

interface SsoButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function SsoButton({ label, icon, onClick, disabled }: SsoButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2.5 rounded-xl border border-[#E5E7EB] bg-white px-3 text-[15px] font-medium text-neutral-800 transition duration-200 ease-out hover:border-primary hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-[190px] sm:max-w-[190px]"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-5 [&>svg]:w-5" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
