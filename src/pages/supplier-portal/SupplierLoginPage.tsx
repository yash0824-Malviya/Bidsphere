import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Building2,
  ChevronDown,
  Hash,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  ShieldCheck,
} from "lucide-react";

import { apiGet, buildResourceUrl } from "../../api/erpnext";
import { portalLogin, legacyPinIssueToken } from "../../api/supplierOnboarding";
import {
  writeSupplierAccessToken,
  clearSupplierAccessToken,
  clearAccessToken,
} from "../../utils/accessToken";
import SupplierLoginHeroPanel from "../../components/supplier-portal/SupplierLoginHeroPanel";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  readSupplierSession,
  writeSupplierSession,
} from "../../hooks/useSupplierSession";
import { buildPortalClientMeta } from "../../utils/supplierClientMeta";
import { useAuthStore } from "../../store/authStore";
import {
  detectAuthSource,
  getActivePortal,
  logPortalAuthDecision,
  PORTAL_LOGIN_PATH,
  replacePreviousStaffSession,
  setActivePortal,
  setLoginPortalAffinity,
} from "../../utils/portalAuth";

const SUPPORT_EMAIL = "support@netlink.com";
const TAB_STORAGE_KEY = "supplier_login_tab";

type LoginTab = "account" | "pin";

interface SupplierOption {
  name: string;
  supplier_name?: string;
}

function readStoredTab(): LoginTab {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    if (raw === "pin" || raw === "account") return raw;
  } catch {
    /* ignore */
  }
  return "account";
}

function postAccountLoginPath(session: {
  firstLogin?: boolean;
  unlocked?: boolean;
  displayStatus?: string;
}): string {
  if (session.firstLogin) return "/supplier/change-password";
  const status = String(session.displayStatus || "");
  if (session.unlocked || status === "Approved") return "/supplier/dashboard";
  return "/supplier/profile";
}

export default function SupplierLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  useDocumentTitle();
  const [tab, setTab] = useState<LoginTab>(() => readStoredTab());

  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  // Account login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountSubmitting, setAccountSubmitting] = useState(false);

  // Company PIN login (legacy)
  const [supplierName, setSupplierName] = useState("");
  const [supplierCode, setSupplierCode] = useState("");
  const [pin, setPin] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);

  useEffect(() => {
    setLoginPortalAffinity("supplier");
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    // Internal staff sessions must not auto-enter Supplier — replace silently.
    if (isAuthenticated && user) {
      const previousPortal = getActivePortal();
      replacePreviousStaffSession("replace-staff-on-supplier-login");
      logPortalAuthDecision({
        username: user.name || user.email,
        requestedPortal: "supplier",
        previousPortal,
        newPortal: null,
        redirectTarget: PORTAL_LOGIN_PATH.supplier,
        currentUrl: location.pathname,
        currentRole: user.role,
        reason: "replace-staff-on-supplier-login",
      });
      return;
    }

    const existing = readSupplierSession();
    if (!existing?.loggedIn) return;

    const destination =
      existing.authMode === "account"
        ? postAccountLoginPath(existing)
        : "/supplier/dashboard";
    setActivePortal("supplier");
    logPortalAuthDecision({
      username:
        existing.portalUser ??
        existing.companyName ??
        existing.supplierName ??
        null,
      requestedPortal: "supplier",
      previousPortal: getActivePortal(),
      newPortal: "supplier",
      redirectTarget: destination,
      currentUrl: location.pathname,
      currentRole: "supplier",
      authSource: detectAuthSource(),
      reason: "supplier-session-on-supplier-login",
    });
    navigate(destination, { replace: true });
  }, [
    hasHydrated,
    isAuthenticated,
    user,
    navigate,
    location.pathname,
  ]);

  function selectTab(next: LoginTab) {
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const suppliersQuery = useQuery<SupplierOption[]>({
    queryKey: ["supplier-portal-supplier-list"],
    queryFn: () =>
      apiGet<SupplierOption[]>(buildResourceUrl("Supplier"), {
        params: {
          fields: JSON.stringify([
            "name",
            "supplier_name",
            "supplier_group",
            "country",
          ]),
          filters: JSON.stringify([["disabled", "=", 0]]),
          limit_page_length: 100,
        },
      }),
    enabled: tab === "pin",
  });

  const suppliers = useMemo(() => {
    return [...(suppliersQuery.data ?? [])].sort((a, b) =>
      (a.supplier_name || a.name).localeCompare(b.supplier_name || b.name),
    );
  }, [suppliersQuery.data]);

  function handleCompanyChange(name: string) {
    setSupplierName(name);
    setSupplierCode(name);
  }

  function handleSupplierCodeChange(code: string) {
    setSupplierCode(code);
    const match = suppliers.find(
      (s) =>
        s.name.toLowerCase() === code.trim().toLowerCase() ||
        (s.supplier_name ?? "").toLowerCase() === code.trim().toLowerCase(),
    );
    if (match) setSupplierName(match.name);
    else if (!code.trim()) setSupplierName("");
  }

  function resolveSupplier(): SupplierOption | undefined {
    if (supplierName) {
      return suppliers.find((s) => s.name === supplierName);
    }
    const code = supplierCode.trim();
    if (!code) return undefined;
    return suppliers.find(
      (s) =>
        s.name.toLowerCase() === code.toLowerCase() ||
        (s.supplier_name ?? "").toLowerCase() === code.toLowerCase(),
    );
  }

  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    const username = email.trim().toLowerCase();
    if (!username || !username.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (!password) {
      toast.error("Enter your password.");
      return;
    }

    setAccountSubmitting(true);
    try {
      // Never keep a staff session alongside a supplier session.
      if (useAuthStore.getState().isAuthenticated) {
        replacePreviousStaffSession("replace-staff-before-supplier-login");
      }
      const res = await portalLogin({
        username,
        password,
        client: buildPortalClientMeta(),
      });
      if (!res.access_token) {
        clearSupplierAccessToken();
        throw new Error(
          "Sign-in succeeded but no access token was issued. Please try again or contact support.",
        );
      }
      writeSupplierAccessToken(res.access_token);
      const session = {
        supplierName: res.linked_supplier || res.company_name || username,
        companyName: res.company_name || username,
        linkedSupplier: res.linked_supplier || "",
        portalUser: res.portal_user || username,
        onboardingName: res.record?.name,
        sessionToken: res.session_token,
        firstLogin: !!res.first_login,
        unlocked: !!res.unlocked,
        displayStatus: res.display_status || res.record?.status,
        authMode: "account" as const,
        loggedIn: true,
        loginTime: new Date().toISOString(),
      };
      writeSupplierSession(session);
      setActivePortal("supplier");
      toast.success(`Welcome, ${res.company_name || username}`);
      navigate(postAccountLoginPath(session), { replace: true });
    } catch (err) {
      clearSupplierAccessToken();
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setAccountSubmitting(false);
    }
  }

  function handleForgotPassword() {
    const q = email.trim() ? `?email=${encodeURIComponent(email.trim())}` : "";
    navigate(`/supplier/forgot-password${q}`);
  }

  function handlePinSubmit(e: FormEvent) {
    e.preventDefault();

    const supplier = resolveSupplier();

    if (!supplier) {
      toast.error("Please select your company or enter a valid supplier code.");
      return;
    }
    if (!pin || pin.length !== 4) {
      toast.error("Portal PIN must be 4 digits.");
      return;
    }

    setPinSubmitting(true);

    void (async () => {
      try {
        if (useAuthStore.getState().isAuthenticated) {
          replacePreviousStaffSession("replace-staff-before-supplier-pin-login");
        }
        const tokenRes = await legacyPinIssueToken(
          supplier.name,
          pin,
          buildPortalClientMeta(),
        );
        if (!tokenRes.access_token) {
          throw new Error(
            "Sign-in succeeded but no access token was issued. Please try again.",
          );
        }
        writeSupplierAccessToken(tokenRes.access_token);
      } catch (err) {
        clearSupplierAccessToken();
        clearAccessToken();
        const message =
          err instanceof Error ? err.message : "Could not start supplier session. Please try again.";
        toast.error(message);
        setPinSubmitting(false);
        return;
      }

      writeSupplierSession({
        supplierName: supplier.name,
        companyName: supplier.supplier_name || supplier.name,
        linkedSupplier: supplier.name,
        authMode: "pin",
        unlocked: true,
        firstLogin: false,
        displayStatus: "Approved",
        loggedIn: true,
        loginTime: new Date().toISOString(),
      });
      setActivePortal("supplier");

      toast.success(`Welcome, ${supplier.supplier_name || supplier.name}`);
      navigate("/supplier/dashboard", { replace: true });
      setPinSubmitting(false);
    })();
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <SupplierLoginHeroPanel />

      <aside className="relative flex w-full flex-col justify-center bg-white px-6 py-10 lg:w-[35%] lg:min-h-screen lg:px-10 lg:py-12">
        <div className="relative mx-auto w-full max-w-[400px]">
          <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm sm:p-8">
            <div className="mb-7">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#0098EA] text-white shadow-md shadow-[#0098EA]/25">
                <Building2 className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
                Welcome, Supplier
              </h2>
              <p className="mt-1.5 text-sm text-neutral-500">
                Sign in to access your collaboration portal
              </p>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 text-sm">
              <button
                type="button"
                onClick={() => selectTab("account")}
                className={`rounded-md px-3 py-2 font-medium transition ${
                  tab === "account"
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-600 hover:text-neutral-800"
                }`}
              >
                Account Login
              </button>
              <button
                type="button"
                onClick={() => selectTab("pin")}
                className={`rounded-md px-3 py-2 font-medium transition ${
                  tab === "pin"
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-600 hover:text-neutral-800"
                }`}
              >
                Company PIN Login
              </button>
            </div>

            {tab === "account" ? (
              <form
                onSubmit={(e) => void handleAccountSubmit(e)}
                className="space-y-4"
              >
                <div>
                  <label
                    htmlFor="supplier-email"
                    className="mb-1.5 block text-sm font-medium text-neutral-700"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">
                      <Mail className="h-4 w-4" />
                    </span>
                    <input
                      id="supplier-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="supplier@company.com"
                      autoComplete="username"
                      required
                      className="input-field pl-9 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label
                      htmlFor="supplier-password"
                      className="block text-sm font-medium text-neutral-700"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Forgot Password
                    </button>
                  </div>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <input
                      id="supplier-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                      className="input-field pl-9 text-sm"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={accountSubmitting}
                  className="supplier-login-submit mt-1 w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {accountSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  {accountSubmitting ? "Signing in…" : "Sign In"}
                </button>
              </form>
            ) : (
              <form onSubmit={handlePinSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="supplier-select"
                    className="mb-1.5 block text-sm font-medium text-neutral-700"
                  >
                    Company
                  </label>
                  <div className="relative">
                    <select
                      id="supplier-select"
                      value={supplierName}
                      onChange={(e) => handleCompanyChange(e.target.value)}
                      disabled={suppliersQuery.isLoading}
                      className="input-field appearance-none pr-9"
                    >
                      <option value="">
                        {suppliersQuery.isLoading
                          ? "Loading companies…"
                          : "— Select your company —"}
                      </option>
                      {suppliers.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.supplier_name || s.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    {suppliersQuery.isFetching && !suppliersQuery.isLoading && (
                      <Loader2 className="absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-neutral-400" />
                    )}
                  </div>
                  {suppliersQuery.isError && (
                    <p className="mt-1.5 text-xs text-danger-600">
                      Could not load companies. Refresh or contact support.
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="supplier-code"
                    className="mb-1.5 block text-sm font-medium text-neutral-700"
                  >
                    Supplier Code
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">
                      <Hash className="h-4 w-4" />
                    </span>
                    <input
                      id="supplier-code"
                      type="text"
                      value={supplierCode}
                      onChange={(e) => handleSupplierCodeChange(e.target.value)}
                      placeholder="e.g. SUP-00001"
                      autoComplete="organization"
                      disabled={suppliersQuery.isLoading}
                      className="input-field pl-9 font-mono text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="portal-pin"
                    className="mb-1.5 block text-sm font-medium text-neutral-700"
                  >
                    Portal PIN
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <input
                      id="portal-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{4}"
                      maxLength={4}
                      value={pin}
                      onChange={(e) =>
                        setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                      }
                      placeholder="• • • •"
                      className="input-field pl-9 text-center font-mono tracking-[0.45em]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={pinSubmitting || suppliersQuery.isLoading}
                  className="supplier-login-submit mt-1 w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pinSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  {pinSubmitting ? "Signing in…" : "Sign In"}
                </button>
              </form>
            )}

            <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-primary-100 bg-primary-50/60 px-3 py-2.5">
              <ShieldCheck className="h-4 w-4 flex-shrink-0 text-primary" />
              <span className="text-xs font-medium text-primary-700">
                Secure supplier portal access
              </span>
            </div>

            <div className="mt-6 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3.5">
              <p className="text-xs font-semibold text-neutral-800">Contact Support</p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                Need help with access, quotations, or payments?
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Mail className="h-3.5 w-3.5" />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
