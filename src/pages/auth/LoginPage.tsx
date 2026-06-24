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

import { useAuthStore } from "../../store/authStore";



interface LocationState {

  from?: { pathname?: string };

}



export default function LoginPage() {

  const navigate = useNavigate();

  const location = useLocation();

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const isVerifying = useAuthStore((s) => s.isVerifying);

  const isLoading = useAuthStore((s) => s.isLoading);

  const login = useAuthStore((s) => s.login);

  const user = useAuthStore((s) => s.user);



  const [username, setUsername] = useState("");

  const [password, setPassword] = useState("");

  const [rememberMe, setRememberMe] = useState(true);

  const [showPassword, setShowPassword] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);



  const fromPath =

    (location.state as LocationState | null)?.from?.pathname ??

    (user?.role ? getRoleHome(user.role) : "/dashboard");



  useEffect(() => {

    if (!isVerifying && isAuthenticated) {

      navigate(fromPath, { replace: true });

    }

  }, [isAuthenticated, isVerifying, fromPath, navigate]);



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

      await login(username.trim(), password, rememberMe);

      toast.success("Welcome back!");

      const stored = useAuthStore.getState().user;

      navigate(

        stored?.role ? getRoleHome(stored.role) : fromPath,

        { replace: true }

      );

    } catch (err) {

      const message =

        err instanceof Error

          ? err.message

          : "We couldn't sign you in. Please try again.";

      setFormError(message);

      toast.error(message);

    }

  };



  if (isVerifying) {

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

          </div>

        </div>

      </aside>

    </div>

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


