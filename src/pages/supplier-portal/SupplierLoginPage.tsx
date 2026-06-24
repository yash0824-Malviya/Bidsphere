import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import SupplierLoginHeroPanel from "../../components/supplier-portal/SupplierLoginHeroPanel";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

const SUPPLIER_PINS: Record<string, string> = {};
const DEFAULT_PIN = "1234";

const SUPPORT_EMAIL = "support@netlink.com";

interface SupplierOption {
  name: string;
  supplier_name?: string;
}

function validateLogin(supplierName: string, pin: string): boolean {
  const expected = SUPPLIER_PINS[supplierName] ?? DEFAULT_PIN;
  return pin === expected;
}

export default function SupplierLoginPage() {
  const navigate = useNavigate();
  useDocumentTitle();
  const [supplierName, setSupplierName] = useState("");
  const [supplierCode, setSupplierCode] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("supplier_session");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { loggedIn?: boolean };
      if (parsed.loggedIn) navigate("/supplier/dashboard", { replace: true });
    } catch {
      sessionStorage.removeItem("supplier_session");
    }
  }, [navigate]);

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
  });

  const suppliers = useMemo(() => {
    return [...(suppliersQuery.data ?? [])].sort((a, b) =>
      (a.supplier_name || a.name).localeCompare(b.supplier_name || b.name)
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
        (s.supplier_name ?? "").toLowerCase() === code.trim().toLowerCase()
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
        (s.supplier_name ?? "").toLowerCase() === code.toLowerCase()
    );
  }

  function handleSubmit(e: FormEvent) {
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

    setSubmitting(true);

    setTimeout(() => {
      if (!validateLogin(supplier.name, pin)) {
        toast.error("Incorrect PIN. Contact support if you need assistance.");
        setSubmitting(false);
        return;
      }

      sessionStorage.setItem(
        "supplier_session",
        JSON.stringify({
          supplierName: supplier.name,
          loggedIn: true,
          loginTime: new Date().toISOString(),
        })
      );

      toast.success(`Welcome, ${supplier.supplier_name || supplier.name}`);
      navigate("/supplier/dashboard", { replace: true });
    }, 250);
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <SupplierLoginHeroPanel />

      <aside className="relative flex w-full flex-col justify-center bg-white px-6 py-10 lg:w-[35%] lg:min-h-screen lg:px-10 lg:py-12">
        <div className="relative mx-auto w-full max-w-[400px]">
          <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm sm:p-8">
            <div className="mb-7">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#0ea5e9] text-white shadow-md shadow-[#0ea5e9]/25">
                <Building2 className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
                Welcome, Supplier
              </h2>
              <p className="mt-1.5 text-sm text-neutral-500">
                Sign in to access your collaboration portal
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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
                disabled={submitting || suppliersQuery.isLoading}
                className="supplier-login-submit mt-1 w-full disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {submitting ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-primary-100 bg-primary-50/60 px-3 py-2.5">
              <ShieldCheck className="h-4 w-4 flex-shrink-0 text-primary" />
              <span className="text-xs font-medium text-primary-700">
                Secure supplier portal access
              </span>
            </div>

            <div className="mt-6 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3.5">
              <p className="text-xs font-semibold text-neutral-800">
                Contact Support
              </p>
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
