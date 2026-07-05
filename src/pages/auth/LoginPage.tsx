import { useEffect, useState } from "react";

import type { FormEvent } from "react";

import { useLocation, useNavigate } from "react-router-dom";

import toast from "react-hot-toast";

import {

  Eye,

  EyeOff,

  Loader2,

  Lock,

  Mail,

} from "lucide-react";



import LoginHeroPanel from "../../components/auth/LoginHeroPanel";

import BrandLogo from "../../components/BrandLogo";

import { getRoleHome } from "../../config/roles";

import { APP_NAME } from "../../config/branding";

import { useAuthStore, setMfaRedirectPath } from "../../store/authStore";



interface LocationState {

  from?: { pathname?: string };

}



export default function LoginPage() {

  const navigate = useNavigate();

  const location = useLocation();

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

  const savedFromPath =
    (location.state as LocationState | null)?.from?.pathname ?? null;

  useEffect(() => {
    if (sessionRestoreError) {
      setFormError(sessionRestoreError);
      toast.error(sessionRestoreError);
      clearSessionRestoreError();
    }
  }, [sessionRestoreError, clearSessionRestoreError]);

  useEffect(() => {
    if (!hasHydrated || isVerifying) return;
    if (isAuthenticated && user) {
      const target = savedFromPath ?? getRoleHome(user.role);
      navigate(target, { replace: true });
      return;
    }
    if (mfaPending && !isAuthenticated) {
      navigate("/verify-otp", { replace: true });
    }
  }, [
    hasHydrated,
    isAuthenticated,
    isVerifying,
    mfaPending,
    savedFromPath,
    navigate,
    user,
  ]);



  const handleSubmit = async (e: FormEvent) => {

    e.preventDefault();

    setFormError(null);



    if (!username.trim() || !password) {

      const msg = "Please enter your username and password.";

      setFormError(msg);

      toast.error(msg);

      return;

    }



    try {
      const outcome = await login(username.trim(), password, rememberMe);
      if (outcome === "mfa") {
        setMfaRedirectPath(
          savedFromPath ??
            getRoleHome(
              useAuthStore.getState().mfaPending?.user.role ?? "procurement"
            )
        );
        toast.success("Credentials verified — enter your security code.");
        navigate("/verify-otp", { replace: true });
      } else {
        toast.success("Signed in successfully.");
        const signedInUser = useAuthStore.getState().user;
        if (signedInUser) {
          navigate(
            savedFromPath ?? getRoleHome(signedInUser.role),
            { replace: true }
          );
        }
      }
    } catch (err) {

      const message =

        err instanceof Error

          ? err.message

          : "We couldn't sign you in. Please try again.";

      setFormError(message);

      toast.error(message);

    }

  };



  // TODO: Integrate Microsoft Entra ID (Azure AD)

  const handleMicrosoftSso = () => {

    toast("Microsoft SSO will be available in production.");

  };



  // TODO: Integrate Google Workspace OAuth

  const handleGoogleSso = () => {

    toast("Google Workspace SSO coming soon.");

  };



  if (!hasHydrated || isVerifying) {

    return (

      <div className="flex min-h-screen items-center justify-center bg-white">

        <div className="flex flex-col items-center gap-4 rounded-2xl border border-neutral-200 bg-white px-10 py-8 shadow-sm">

          <Loader2 className="h-8 w-8 animate-spin text-primary" />

          <p className="text-sm font-medium tracking-wide text-neutral-600">

            Restoring your session…

          </p>

        </div>

      </div>

    );

  }



  return (

    <div className="flex min-h-screen flex-col lg:flex-row">

      <LoginHeroPanel />



      <aside className="relative flex w-full flex-col justify-center bg-white px-6 py-10 lg:w-[42%] lg:min-h-screen lg:px-12 lg:py-12">

        <div className="relative mx-auto w-full max-w-[400px]">

          <div className="rounded-[28px] border border-neutral-200/70 bg-white p-8 shadow-[0_40px_100px_-32px_rgba(15,23,42,0.16),0_12px_32px_-18px_rgba(15,23,42,0.10)] ring-1 ring-neutral-100/80 sm:p-10">

            <div className="mb-7 text-center lg:text-left">

              <div className="mb-5 flex items-center justify-center gap-3 lg:justify-start">

                <BrandLogo whiteBg size="sm" />

                <div className="text-left leading-tight">

                  <div className="text-sm font-semibold text-neutral-900">

                    {APP_NAME}

                  </div>

                  <div className="text-[11px] font-medium text-neutral-400">

                    Procurement Workspace

                  </div>

                </div>

              </div>

              <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">

                Welcome back

              </h2>

              <p className="mt-1.5 text-sm text-neutral-500">

                Sign in to your procurement workspace

              </p>

            </div>



            {formError && (

              <div

                role="alert"

                className="mb-5 rounded-xl border border-danger-100 bg-danger-50/90 px-4 py-3 text-sm text-danger-700"

              >

                {formError}

              </div>

            )}



            <form onSubmit={handleSubmit} className="space-y-5">

              <Field

                id="username"

                label="Username / Email"

                icon={<Mail className="h-4 w-4" />}

                value={username}

                onChange={(v) => {

                  setUsername(v);

                  setFormError(null);

                }}

                placeholder="you@company.com"

                autoComplete="username"

                required

                disabled={isLoading}

              />



              <div>

                <label

                  htmlFor="password"

                  className="mb-1.5 block text-sm font-medium text-neutral-700"

                >

                  Password

                </label>

                <div className="relative">

                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">

                    <Lock className="h-4 w-4" />

                  </span>

                  <input

                    id="password"

                    type={showPassword ? "text" : "password"}

                    value={password}

                    onChange={(e) => {

                      setPassword(e.target.value);

                      setFormError(null);

                    }}

                    placeholder="Enter your password"

                    autoComplete="current-password"

                    required

                    disabled={isLoading}

                    className="input-field pl-9 pr-10"

                  />

                  <button

                    type="button"

                    onClick={() => setShowPassword((v) => !v)}

                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-neutral-400 hover:text-neutral-700"

                    aria-label={showPassword ? "Hide password" : "Show password"}

                    tabIndex={-1}

                  >

                    {showPassword ? (

                      <EyeOff className="h-4 w-4" />

                    ) : (

                      <Eye className="h-4 w-4" />

                    )}

                  </button>

                </div>

              </div>



              <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600">

                <input

                  type="checkbox"

                  checked={rememberMe}

                  onChange={(e) => setRememberMe(e.target.checked)}

                  disabled={isLoading}

                  className="h-4 w-4 rounded border-neutral-300 text-primary focus:ring-primary/30"

                />

                Remember me

              </label>



              <button

                type="submit"

                disabled={isLoading}

                className="btn-primary mt-1 w-full justify-center py-2.5 shadow-md shadow-primary/25 disabled:cursor-not-allowed disabled:opacity-60"

              >

                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}

                {isLoading ? "Signing in…" : "Sign In"}

              </button>

            </form>



            <div className="mt-6">

              <SsoDivider />



              <div className="mt-5 space-y-3">

                <SsoButton

                  label="Continue with Microsoft"

                  icon={<MicrosoftIcon />}

                  onClick={handleMicrosoftSso}

                  disabled={isLoading}

                />

                <SsoButton

                  label="Continue with Google"

                  icon={<GoogleIcon />}

                  onClick={handleGoogleSso}

                  disabled={isLoading}

                />

              </div>

            </div>

          </div>

        </div>

      </aside>

    </div>

  );

}



function SsoDivider() {

  return (

    <div className="relative flex items-center">

      <div className="flex-1 border-t border-neutral-200" />

      <span className="mx-4 text-xs font-semibold uppercase tracking-wider text-neutral-400">

        Or

      </span>

      <div className="flex-1 border-t border-neutral-200" />

    </div>

  );

}



interface SsoButtonProps {

  label: string;

  icon: React.ReactNode;

  onClick: () => void;

  disabled?: boolean;

}



function SsoButton({ label, icon, onClick, disabled }: SsoButtonProps) {

  return (

    <button

      type="button"

      onClick={onClick}

      disabled={disabled}

      className="flex w-full items-center justify-center gap-3 rounded-xl border border-neutral-200/90 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 shadow-sm ring-1 ring-neutral-100/80 transition hover:border-neutral-300 hover:bg-neutral-50 hover:shadow focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"

    >

      <span className="flex h-5 w-5 shrink-0 items-center justify-center">

        {icon}

      </span>

      {label}

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



interface FieldProps {

  id: string;

  label: string;

  icon: React.ReactNode;

  value: string;

  onChange: (value: string) => void;

  placeholder?: string;

  autoComplete?: string;

  required?: boolean;

  disabled?: boolean;

}



function Field({

  id,

  label,

  icon,

  value,

  onChange,

  placeholder,

  autoComplete,

  required,

  disabled,

}: FieldProps) {

  return (

    <div>

      <label

        htmlFor={id}

        className="mb-1.5 block text-sm font-medium text-neutral-700"

      >

        {label}

      </label>

      <div className="relative">

        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">

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

          className="input-field pl-9"

        />

      </div>

    </div>

  );

}


