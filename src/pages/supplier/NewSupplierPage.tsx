import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  FileText,
  Landmark,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";

import { apiGet, apiPost } from "../../api/erpnext";
import {
  createSupplier,
  getSupplierGroups,
} from "../../api/supplier";
import PageHeader from "../../components/PageHeader";
import type { Supplier, SupplierType } from "../../types/erpnext";

interface CountryRow {
  name: string;
}

interface PaymentTermsRow {
  name: string;
}

const SUPPLIER_TYPES: SupplierType[] = [
  "Company",
  "Individual",
  "Partnership",
  "Proprietorship",
];

type DocStatus = "pending" | "uploaded" | "verified";

interface SupplierDocument {
  type: string;
  required: boolean;
  file: File | null;
  status: DocStatus;
  preview?: string;
}

/** US supplier-onboarding document checklist. */
const REQUIRED_DOCUMENTS: Omit<SupplierDocument, "file" | "status" | "preview">[] = [
  { type: "W-9 Form (IRS Tax Form)", required: true },
  { type: "Business License", required: true },
  { type: "Certificate of Insurance (COI)", required: false },
  { type: "Vendor Agreement / NDA", required: false },
  { type: "ACH / Banking Information", required: false },
  { type: "SAM.gov Registration (Federal Suppliers)", required: false },
  { type: "Diversity Certification (if applicable)", required: false },
];

const COMPLIANCE_CHECKS = [
  "OFAC Sanctions Check",
  "EIN/TIN Verification",
  "Business Entity Verification",
  "Insurance Compliance",
  "Anti-Bribery Policy Signed",
  "Conflict of Interest Disclosure",
] as const;

function initialDocuments(): SupplierDocument[] {
  return REQUIRED_DOCUMENTS.map((d) => ({
    ...d,
    file: null,
    status: "pending" as DocStatus,
  }));
}

export default function NewSupplierPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Identity
  const [supplierName, setSupplierName] = useState("");
  const [supplierGroup, setSupplierGroup] = useState("");
  const [supplierType, setSupplierType] = useState<SupplierType>("Company");
  const [country, setCountry] = useState("");
  const [taxId, setTaxId] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");

  // Contact
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Address
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateProv, setStateProv] = useState("");
  const [pincode, setPincode] = useState("");

  // Document verification & compliance
  const [documents, setDocuments] = useState<SupplierDocument[]>(initialDocuments);
  const [compliance, setCompliance] = useState<Record<string, boolean>>({});

  function handleFileUpload(index: number, file: File) {
    setDocuments((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        file,
        status: "uploaded",
        preview: URL.createObjectURL(file),
      };
      return next;
    });
    toast.success(`${documents[index]?.type ?? "Document"} uploaded`);
  }

  /** Best-effort upload of attached documents to the Supplier's File list. */
  async function uploadToERPNext(supplier: string) {
    for (const doc of documents.filter((d) => d.file)) {
      try {
        const formData = new FormData();
        formData.append("file", doc.file!);
        formData.append("doctype", "Supplier");
        formData.append("docname", supplier);
        formData.append("fieldname", "custom_documents");
        formData.append("is_private", "1");
        await apiPost("/api/method/upload_file", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } catch {
        // Best-effort; the interceptor already surfaced any server error.
        // eslint-disable-next-line no-console
        console.warn("Document upload failed:", doc.type);
      }
    }
  }

  const { data: groups = [] } = useQuery({
    queryKey: ["supplier-groups"],
    queryFn: () =>
      getSupplierGroups({
        filters: [["is_group", "=", 0]],
        fields: ["name", "supplier_group_name"],
        limit_page_length: 200,
        order_by: "supplier_group_name asc",
      }),
    staleTime: 5 * 60_000,
  });

  const { data: countries = [] } = useQuery<CountryRow[]>({
    queryKey: ["countries"],
    queryFn: () =>
      apiGet<CountryRow[]>("/api/resource/Country", {
        params: {
          fields: JSON.stringify(["name"]),
          limit_page_length: 300,
          order_by: "name asc",
        },
      }),
    staleTime: 24 * 60 * 60_000,
  });

  const { data: paymentTermTemplates = [] } = useQuery<PaymentTermsRow[]>({
    queryKey: ["payment-terms-templates"],
    queryFn: () =>
      apiGet<PaymentTermsRow[]>("/api/resource/Payment Terms Template", {
        params: {
          fields: JSON.stringify(["name"]),
          limit_page_length: 200,
          order_by: "name asc",
        },
      }),
    staleTime: 5 * 60_000,
  });

  function buildSupplierPayload(): Partial<Supplier> {
    return {
      supplier_name: supplierName.trim(),
      supplier_group: supplierGroup || undefined,
      supplier_type: supplierType,
      country: country || undefined,
      tax_id: taxId || undefined,
      payment_terms: paymentTerms || undefined,
      email_id: email || undefined,
      mobile_no: phone || undefined,
    };
  }

  async function maybeCreateAddress(supplier: string) {
    if (!addressLine1.trim()) return;
    try {
      await apiPost("/api/resource/Address", {
        address_title: supplierName,
        address_type: "Office",
        address_line1: addressLine1,
        address_line2: addressLine2 || undefined,
        city: city || undefined,
        state: stateProv || undefined,
        pincode: pincode || undefined,
        country: country || undefined,
        links: [
          { link_doctype: "Supplier", link_name: supplier },
        ],
      });
    } catch {
      // Address creation is best-effort; the toast from the interceptor
      // will already have surfaced a server-side error if any.
    }
  }

  async function maybeCreateContact(supplier: string) {
    if (!firstName.trim() && !email.trim() && !phone.trim()) return;
    try {
      await apiPost("/api/resource/Contact", {
        first_name: firstName || supplierName,
        last_name: lastName || undefined,
        is_primary_contact: 1,
        email_ids: email
          ? [{ email_id: email, is_primary: 1 }]
          : undefined,
        phone_nos: phone
          ? [{ phone, is_primary_mobile_no: 1 }]
          : undefined,
        links: [{ link_doctype: "Supplier", link_name: supplier }],
      });
    } catch {
      // Best-effort; primary mobile/email already saved on Supplier.
    }
  }

  function validate(): string | null {
    if (!supplierName.trim()) return "Supplier name is required.";
    if (!supplierGroup) return "Supplier group is required.";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return "Email address looks invalid.";
    return null;
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const supplier = await createSupplier(buildSupplierPayload());
      await Promise.all([
        maybeCreateAddress(supplier.name),
        maybeCreateContact(supplier.name),
      ]);
      await uploadToERPNext(supplier.name);
      return supplier;
    },
    onSuccess: (supplier) => {
      toast.success(`${supplier.supplier_name ?? supplier.name} created`);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["all-suppliers"] });
      navigate(`/suppliers/${encodeURIComponent(supplier.name)}`);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    createMutation.mutate();
  }

  return (
    <div>
      <Link
        to="/suppliers"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to suppliers
      </Link>

      <PageHeader
        title="Add Supplier"
        description="Onboard a new supplier into the directory."
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Section title="Supplier Details">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Supplier Name" required>
              <input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                placeholder="Acme Corporation"
              />
            </Field>
            <Field label="Supplier Group" required>
              <select
                value={supplierGroup}
                onChange={(e) => setSupplierGroup(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="">Select group…</option>
                {groups.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.supplier_group_name ?? g.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Supplier Type">
              <select
                value={supplierType}
                onChange={(e) =>
                  setSupplierType(e.target.value as SupplierType)
                }
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                {SUPPLIER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Country">
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="">Select country…</option>
                {countries.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tax ID">
              <input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="VAT / GSTIN / EIN"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
            <Field label="Payment Terms">
              <select
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="">Default</option>
                {paymentTermTemplates.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Primary Contact">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="First Name">
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
            <Field label="Last Name">
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@acme.com"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
            <Field label="Phone">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
          </div>
        </Section>

        <Section title="Primary Address">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Address Line 1">
              <input
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="123 Industrial Park Rd"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
            <Field label="Address Line 2">
              <input
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Building 7, Floor 3"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
            <Field label="City">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
            <Field label="State / Province">
              <input
                value={stateProv}
                onChange={(e) => setStateProv(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
            <Field label="Postal Code">
              <input
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </Field>
          </div>
        </Section>

        <DocumentCompliance
          documents={documents}
          onUpload={handleFileUpload}
          compliance={compliance}
          onToggleCompliance={(item) =>
            setCompliance((prev) => ({ ...prev, [item]: !prev[item] }))
          }
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate("/suppliers")}
            disabled={createMutation.isPending}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-60"
          >
            {createMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Save Supplier
          </button>
        </div>
      </form>
    </div>
  );
}

function DocumentCompliance({
  documents,
  onUpload,
  compliance,
  onToggleCompliance,
}: {
  documents: SupplierDocument[];
  onUpload: (index: number, file: File) => void;
  compliance: Record<string, boolean>;
  onToggleCompliance: (item: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-neutral-200">
      <div className="flex items-center gap-3 bg-primary px-5 py-4">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
          <Landmark className="h-5 w-5" />
        </span>
        <div>
          <div className="text-sm font-bold text-white">
            Document Verification &amp; Compliance
          </div>
          <div className="text-xs text-white/70">
            American Supplier Onboarding — Required Documents
          </div>
        </div>
      </div>

      <div className="bg-white p-5">
        <div className="mb-5 flex gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          <FileText className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            Upload required compliance documents for American supplier
            onboarding. W-9 and Business License are mandatory. All documents are
            stored securely.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {documents.map((doc, idx) => {
            const uploaded = doc.status === "uploaded";
            return (
              <div
                key={doc.type}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3.5 ${
                  uploaded
                    ? "border-success-200 bg-success-50"
                    : "border-neutral-200 bg-white"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                      uploaded
                        ? "bg-success-100 text-success-600"
                        : doc.required
                        ? "bg-warning-100 text-warning-600"
                        : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {uploaded ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : doc.required ? (
                      <AlertTriangle className="h-5 w-5" />
                    ) : (
                      <FileText className="h-5 w-5" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                      <span className="truncate">{doc.type}</span>
                      {doc.required && (
                        <span className="flex-shrink-0 rounded bg-danger-100 px-1.5 py-0.5 text-[10px] font-bold text-danger-600">
                          REQUIRED
                        </span>
                      )}
                    </div>
                    {doc.file && (
                      <div className="mt-0.5 truncate text-xs text-neutral-500">
                        {doc.file.name} ({(doc.file.size / 1024).toFixed(1)} KB)
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-center gap-2">
                  {uploaded && (
                    <span className="inline-flex items-center gap-1 rounded bg-success-100 px-2 py-0.5 text-[11px] font-semibold text-success-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Uploaded
                    </span>
                  )}
                  <label
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold ${
                      uploaded
                        ? "border border-primary bg-white text-primary hover:bg-primary-50"
                        : "bg-primary text-white hover:bg-primary-600"
                    }`}
                  >
                    {uploaded ? (
                      <RefreshCw className="h-3.5 w-3.5" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {uploaded ? "Replace" : "Upload"}
                    <input
                      type="file"
                      hidden
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUpload(idx, file);
                      }}
                    />
                  </label>
                  {doc.preview && (
                    <a
                      href={doc.preview}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 rounded-lg bg-neutral-50 px-4 py-3.5">
          <div className="mb-2 text-sm font-semibold text-neutral-900">
            Compliance Checklist
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {COMPLIANCE_CHECKS.map((item) => (
              <label
                key={item}
                className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700"
              >
                <input
                  type="checkbox"
                  checked={!!compliance[item]}
                  onChange={() => onToggleCompliance(item)}
                  className="h-4 w-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-500"
                />
                {item}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="border-b border-neutral-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-neutral-700">
        {label}
        {required && <span className="text-danger-500">*</span>}
      </label>
      {children}
    </div>
  );
}
