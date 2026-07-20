import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  createOnboarding,
  generateSupplierAccount,
  listSupplierCategories,
  type SupplierCategoryRow,
} from "../../api/supplierOnboarding";

interface Props {
  open: boolean;
  onClose: () => void;
  createdBy: string;
  onCreated: (name: string, loginUrl?: string) => void;
}

export default function NewOnboardingModal({
  open,
  onClose,
  createdBy,
  onCreated,
}: Props) {
  const [companyName, setCompanyName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [supplierType, setSupplierType] = useState<"Direct" | "Indirect">("Direct");
  const [category, setCategory] = useState("");
  const [plant, setPlant] = useState("");
  const [remarks, setRemarks] = useState("");
  const [categories, setCategories] = useState<SupplierCategoryRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState<{
    username: string;
    temporary_password: string;
    login_url: string;
    set_password_link?: string;
  } | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
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
      });
    return () => {
      cancelled = true;
    };
  }, [open, supplierType]);

  useEffect(() => {
    if (!open) {
      setCompanyName("");
      setContactPerson("");
      setEmail("");
      setMobile("");
      setSupplierType("Direct");
      setCategory("");
      setPlant("");
      setRemarks("");
      setCredentials(null);
      setCreatedName(null);
    }
  }, [open]);

  const canSubmit = useMemo(
    () =>
      companyName.trim() &&
      contactPerson.trim() &&
      email.trim() &&
      supplierType &&
      category,
    [companyName, contactPerson, email, supplierType, category],
  );

  if (!open) return null;

  async function save(mode: "draft" | "account") {
    if (!canSubmit) {
      toast.error("Please fill required fields.");
      return;
    }
    setSaving(true);
    try {
      let name = createdName;
      if (!name) {
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
        name = created.record.name!;
        setCreatedName(name);
      }

      if (mode === "draft") {
        toast.success(`Draft ${name} saved`);
        onCreated(name);
        onClose();
        return;
      }

      const created = await generateSupplierAccount({
        name,
        actor: createdBy,
        origin: window.location.origin,
      });
      setCredentials({
        username: created.username,
        temporary_password: created.temporary_password,
        login_url: created.login_url,
        set_password_link: created.set_password_link,
      });
      toast.success("Supplier portal account generated");
      onCreated(name, created.login_url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save onboarding.");
    } finally {
      setSaving(false);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      const text = [
        `Login: ${credentials.login_url}`,
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
      toast.success("Credentials copied");
    } catch {
      toast.error("Could not copy credentials.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">New Onboarding</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <Field label="Company Name *" value={companyName} onChange={setCompanyName} />
          <Field label="Contact Person *" value={contactPerson} onChange={setContactPerson} />
          <Field label="Email *" value={email} onChange={setEmail} type="email" />
          <Field label="Mobile Number" value={mobile} onChange={setMobile} />

          <label className="block text-xs font-medium text-slate-600">
            Supplier Type *
            <select
              value={supplierType}
              onChange={(e) => setSupplierType(e.target.value as "Direct" | "Indirect")}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="Direct">Direct</option>
              <option value="Indirect">Indirect</option>
            </select>
          </label>

          <label className="block text-xs font-medium text-slate-600">
            Supplier Category *
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.category_name}
                </option>
              ))}
            </select>
          </label>

          <Field label="Plant (optional)" value={plant} onChange={setPlant} />
          <label className="block text-xs font-medium text-slate-600">
            Remarks
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          {credentials && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-900">Portal credentials</p>
              <p className="mt-1 break-all text-sm text-slate-800">Login: {credentials.login_url}</p>
              <p className="text-sm text-slate-800">Username: {credentials.username}</p>
              <p className="text-sm text-slate-800">
                Temporary password: {credentials.temporary_password}
              </p>
              {credentials.set_password_link &&
                credentials.set_password_link !== credentials.login_url && (
                  <p className="mt-1 break-all text-sm text-slate-800">
                    Set password link: {credentials.set_password_link}
                  </p>
                )}
              <button
                type="button"
                onClick={() => void copyCredentials()}
                className="mt-2 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white"
              >
                Copy Credentials
              </button>
              <p className="mt-2 text-xs text-slate-500">
                Share these credentials with the supplier. No email is sent automatically.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm text-slate-700"
          >
            {credentials ? "Close" : "Cancel"}
          </button>
          {!credentials && (
            <>
              <button
                type="button"
                disabled={saving || !canSubmit}
                onClick={() => void save("draft")}
                className="rounded-md border border-neutral-200 px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={saving || !canSubmit}
                onClick={() => void save("account")}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Generate Supplier Account
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  );
}
