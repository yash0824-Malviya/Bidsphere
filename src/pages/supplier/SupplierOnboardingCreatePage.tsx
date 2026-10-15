import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Copy,
  ExternalLink,
  Factory,
  FileText,
  Key,
  Layers,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  createOnboarding,
  generateSupplierAccount,
  listSupplierCategories,
  type SupplierCategoryRow,
} from "../../api/supplierOnboarding";
import { useAuthStore } from "../../store/authStore";
import { queryClient } from "../../queryClient";
import { ONB } from "../../components/supplier-onboarding/enterprise/onboardingUi";

export default function SupplierOnboardingCreatePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const createdBy = user?.email || user?.full_name || "Procurement";

  const [companyName, setCompanyName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [supplierType, setSupplierType] = useState<"Direct" | "Indirect">("Direct");
  const [category, setCategory] = useState("");
  const [plant, setPlant] = useState("");
  const [remarks, setRemarks] = useState("");
  const [categories, setCategories] = useState<SupplierCategoryRow[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [savingMode, setSavingMode] = useState<"draft" | "account" | null>(null);

  const [credentials, setCredentials] = useState<{
    onboardingName: string;
    username: string;
    temporary_password: string;
    login_url: string;
    set_password_link?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingCategories(true);
    listSupplierCategories(supplierType)
      .then((rows) => {
        if (!cancelled) {
          setCategories(rows);
          setCategory((prev) =>
            rows.some((r) => r.name === prev) ? prev : rows[0]?.name || "",
          );
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load supplier categories.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCategories(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supplierType]);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isEmailValid = useMemo(() => !email.trim() || emailRegex.test(email.trim()), [email]);

  const canSubmit = useMemo(
    () =>
      companyName.trim().length > 0 &&
      contactPerson.trim().length > 0 &&
      email.trim().length > 0 &&
      emailRegex.test(email.trim()) &&
      Boolean(supplierType) &&
      Boolean(category),
    [companyName, contactPerson, email, supplierType, category],
  );

  async function handleSave(mode: "draft" | "account") {
    if (!canSubmit) {
      if (!isEmailValid && email.trim()) {
        toast.error("Please enter a valid email address.");
      } else {
        toast.error("Please fill in all required fields.");
      }
      return;
    }

    setSavingMode(mode);
    try {
      const created = await createOnboarding({
        company_name: companyName.trim(),
        contact_person: contactPerson.trim(),
        email: email.trim(),
        mobile_no: mobile.trim(),
        supplier_type: supplierType,
        supplier_category: category,
        plant: plant.trim(),
        remarks: remarks.trim(),
        created_by_user: createdBy,
      });

      const name = created.record.name!;
      void queryClient.invalidateQueries({ queryKey: ["onboarding-list"] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding-stats"] });

      if (mode === "draft") {
        toast.success(`Draft onboarding ${name} created successfully.`);
        navigate("/suppliers/onboarding");
        return;
      }

      const account = await generateSupplierAccount({
        name,
        actor: createdBy,
        origin: window.location.origin,
      });

      setCredentials({
        onboardingName: name,
        username: account.username,
        temporary_password: account.temporary_password,
        login_url: account.login_url,
        set_password_link: account.set_password_link,
      });

      toast.success(`Supplier portal account generated for ${companyName.trim()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create supplier onboarding.");
    } finally {
      setSavingMode(null);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      const text = [
        `Onboarding ID: ${credentials.onboardingName}`,
        `Login URL: ${credentials.login_url}`,
        `Username: ${credentials.username}`,
        `Temporary Password: ${credentials.temporary_password}`,
        credentials.set_password_link &&
        credentials.set_password_link !== credentials.login_url
          ? `Set Password Link: ${credentials.set_password_link}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      await navigator.clipboard.writeText(text);
      toast.success("Credentials copied to clipboard");
    } catch {
      toast.error("Could not copy credentials.");
    }
  }

  return (
    <div className="min-h-full pb-12" style={{ backgroundColor: ONB.bg }}>
      <div className="mx-auto w-full max-w-[1280px] space-y-6 px-4 py-5 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Link
                to="/suppliers/onboarding"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 shadow-sm transition-colors hover:bg-neutral-50 hover:text-neutral-900"
                title="Back to Supplier Onboarding"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <h1 className="text-2xl font-bold text-neutral-900">
                New Supplier Onboarding
              </h1>
            </div>
            <p className="mt-1 text-sm text-neutral-500">
              Create and submit a new supplier onboarding request.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/suppliers/onboarding"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50"
            >
              Cancel
            </Link>
          </div>
        </div>

        {/* Success / Credentials Generated View */}
        {credentials ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-6 sm:p-7 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-emerald-950">
                  Supplier Portal Account Generated
                </h3>
                <p className="mt-1 text-sm text-emerald-800">
                  Onboarding request <span className="font-semibold">{credentials.onboardingName}</span> has been created with direct portal credentials.
                </p>

                <div className="mt-5 rounded-lg border border-emerald-200 bg-white p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      Login Portal
                    </span>
                    <a
                      href={credentials.login_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
                    >
                      Open Link <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
                    <div>
                      <span className="text-xs text-neutral-500">Username</span>
                      <p className="font-semibold text-neutral-900">{credentials.username}</p>
                    </div>
                    <div>
                      <span className="text-xs text-neutral-500">Temporary Password</span>
                      <p className="font-mono font-semibold text-neutral-900">
                        {credentials.temporary_password}
                      </p>
                    </div>
                  </div>

                  {credentials.set_password_link &&
                    credentials.set_password_link !== credentials.login_url && (
                      <div className="pt-2 border-t border-neutral-100">
                        <span className="text-xs text-neutral-500">Direct Activation Link</span>
                        <p className="mt-0.5 break-all font-mono text-xs text-neutral-700">
                          {credentials.set_password_link}
                        </p>
                      </div>
                    )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void copyCredentials()}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Credentials
                  </button>
                  <Link
                    to={`/suppliers/onboarding/${encodeURIComponent(credentials.onboardingName)}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50"
                  >
                    <FileText className="h-4 w-4" />
                    View Onboarding Details
                  </Link>
                  <Link
                    to="/suppliers/onboarding"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-600 shadow-sm transition-colors hover:bg-neutral-50"
                  >
                    Return to Onboarding List
                  </Link>
                </div>

                <p className="mt-3 text-xs text-neutral-500">
                  Share these credentials securely with the supplier representative. No automated email is sent by default.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave("account");
            }}
            className="space-y-6"
          >
            {/* Section 1: Supplier Information */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 sm:p-7 shadow-xs">
              <div className="mb-4 flex items-center gap-2.5 border-b border-neutral-100 pb-3">
                <Building2 className="h-5 w-5 text-primary-600" />
                <h2 className="text-base font-semibold text-neutral-900">
                  Supplier Information
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Legal business or company name"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700">
                    Contact Person <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Primary contact full name"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="supplier.contact@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`mt-1.5 w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:ring-1 focus:outline-none ${
                      !isEmailValid
                        ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                        : "border-neutral-300 focus:border-primary-500 focus:ring-primary-500"
                    }`}
                  />
                  {!isEmailValid && (
                    <p className="mt-1 text-xs text-red-500">
                      Please provide a valid email format.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700">
                    Mobile / Phone Number
                  </label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Supplier Classification */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 sm:p-7 shadow-xs">
              <div className="mb-4 flex items-center gap-2.5 border-b border-neutral-100 pb-3">
                <Layers className="h-5 w-5 text-primary-600" />
                <h2 className="text-base font-semibold text-neutral-900">
                  Supplier Classification
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700">
                    Supplier Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={supplierType}
                    onChange={(e) =>
                      setSupplierType(e.target.value as "Direct" | "Indirect")
                    }
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  >
                    <option value="Direct">Direct</option>
                    <option value="Indirect">Indirect</option>
                  </select>
                  <p className="mt-1 text-xs text-neutral-500">
                    Direct (production materials/components) or Indirect (services/MRO).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700">
                    Supplier Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={category}
                    disabled={loadingCategories}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 disabled:bg-neutral-50 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  >
                    <option value="">
                      {loadingCategories ? "Loading categories..." : "Select category"}
                    </option>
                    {categories.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.category_name || c.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-neutral-500">
                    Industry category determining required compliance documents.
                  </p>
                </div>
              </div>
            </div>

            {/* Section 3: Location & Additional Information */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 sm:p-7 shadow-xs">
              <div className="mb-4 flex items-center gap-2.5 border-b border-neutral-100 pb-3">
                <Factory className="h-5 w-5 text-primary-600" />
                <h2 className="text-base font-semibold text-neutral-900">
                  Location & Additional Information
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700">
                    Plant / Location (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Pune Plant / Plant 1 / Primary Facility"
                    value={plant}
                    onChange={(e) => setPlant(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700">
                    Remarks / Internal Notes
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Any internal procurement remarks or onboarding instructions..."
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-neutral-200 pt-5">
              <Link
                to="/suppliers/onboarding"
                className="inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50"
              >
                Cancel
              </Link>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={savingMode !== null || !canSubmit}
                  onClick={() => void handleSave("draft")}
                  className="inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50 disabled:opacity-50"
                >
                  {savingMode === "draft" && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Draft
                </button>

                <button
                  type="submit"
                  disabled={savingMode !== null || !canSubmit}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1554D1] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingMode === "account" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Generating Account...</span>
                    </>
                  ) : (
                    <>
                      <Key className="h-4 w-4" />
                      <span>Generate Supplier Account</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
