import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { getLegalDocs, updateLegalDocs } from "../../api/legalDocs";
import { uploadFileToERPNext } from "../../api/legalDocsStorage";
import type { LegalDocumentSet } from "../../api/legalDocs";
import SupplierPortalLayout from "./SupplierPortalLayout";

type DocField = "terms" | "warranty" | "insurance";

export default function SupplierLegalUploadPage() {
  const { sqName } = useParams<{ sqName: string }>();
  const navigate = useNavigate();
  const supplierSession = JSON.parse(sessionStorage.getItem("supplier_session") || "{}");
  const supplierName = supplierSession.supplierName || "";

  const [docs, setDocs] = useState<LegalDocumentSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!sqName) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        // Legal Document Review is only ever created by the backend when a
        // Procurement Manager selects this quotation as the RFQ's winner —
        // never speculatively from this page. If none exists yet, that
        // means this quotation hasn't been selected (or won't be), so we
        // show an empty state instead of fabricating a premature record.
        const record = await getLegalDocs(sqName);
        setDocs(record);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load documents");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [sqName, supplierName]);

  const handleUpload = async (field: DocField, file: File) => {
    if (!sqName || !docs?.name) {
      toast.error("Document record not ready");
      return;
    }
    const MAX_SIZE_MB = 15;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`File too large. Max size is ${MAX_SIZE_MB}MB`);
      return;
    }

    setUploading(field);
    try {
      const fileUrl = await uploadFileToERPNext(file, "Supplier Quotation", sqName);
      const updated = await updateLegalDocs(docs.name, {
        [`${field}_file_url`]: fileUrl,
        [`${field}_file_name`]: file.name,
      } as Partial<LegalDocumentSet>);
      setDocs(updated);
      toast.success(`${file.name} uploaded to server`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Upload failed: " + msg);
    } finally {
      setUploading(null);
    }
  };

  const handleNoteChange = async (
    field: "terms_note" | "warranty_note" | "insurance_note",
    value: string
  ) => {
    if (!docs?.name) return;
    try {
      const updated = await updateLegalDocs(docs.name, { [field]: value });
      setDocs(updated);
    } catch {
      toast.error("Could not save note");
    }
  };

  const allDocsUploaded = !!(
    docs?.terms_file_url &&
    docs?.warranty_file_url &&
    docs?.insurance_file_url
  );

  if (loading) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <p className="py-12 text-center text-sm text-neutral-500">Loading documents…</p>
      </SupplierPortalLayout>
    );
  }

  if (!docs) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <p className="py-12 text-center text-sm text-neutral-500">
          Legal document review isn&apos;t available for this quotation yet. It becomes available once
          Procurement selects it as the winning quotation for the RFQ.
        </p>
      </SupplierPortalLayout>
    );
  }

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <div className="mb-4">
        <Link
          to="/supplier/quotations"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-accent-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to quotations
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-accent-600" />
          Upload Legal &amp; Compliance Documents
        </h1>
        <p className="text-sm text-neutral-600">
          Attach legal documents for Supplier Quotation <strong className="text-neutral-900">{sqName}</strong>.
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h3 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "12px", color: "#111" }}>
            📋 Legal &amp; Compliance Documents
          </h3>
          <p style={{ fontSize: "12px", color: "#6b7280", marginBottom: "14px" }}>
            Upload PDF documents (max 15 MB each). These will be reviewed by Netlink&apos;s legal team.
          </p>

          {(
            [
              { key: "terms" as const, label: "Terms & Conditions", icon: "📄" },
              { key: "warranty" as const, label: "Warranty Document", icon: "🛡️" },
              { key: "insurance" as const, label: "Insurance Certificate", icon: "🏥" },
            ] as const
          ).map(({ key, label, icon }) => {
            const fileUrl = docs[`${key}_file_url` as keyof LegalDocumentSet];
            const fileName = docs[`${key}_file_name` as keyof LegalDocumentSet] as string | undefined;
            const noteKey = `${key}_note` as keyof LegalDocumentSet;
            const uploaded = !!fileUrl;

            return (
              <div
                key={key}
                style={{
                  border: `1px solid ${uploaded ? "#86efac" : "#e5e7eb"}`,
                  borderRadius: "10px",
                  padding: "14px",
                  marginBottom: "10px",
                  background: uploaded ? "#f0fdf4" : "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                    {icon} {label}
                  </span>
                  <label
                    style={{
                      padding: "5px 12px",
                      background: uploaded ? "white" : "#2D6A4F",
                      color: uploaded ? "#2D6A4F" : "white",
                      border: uploaded ? "1px solid #2D6A4F" : "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    {uploading === key ? "⏳ Uploading..." : uploaded ? "🔄 Replace" : "📤 Upload PDF"}
                    <input
                      type="file"
                      accept=".pdf"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleUpload(key, file);
                      }}
                    />
                  </label>
                </div>
                {fileName && (
                  <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "6px" }}>
                    📎 {fileName}
                  </div>
                )}
                <textarea
                  placeholder={`Notes about ${label.toLowerCase()}...`}
                  defaultValue={(docs[noteKey] as string) || ""}
                  onBlur={(e) => void handleNoteChange(`${key}_note`, e.target.value)}
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "6px",
                    fontSize: "13px",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              </div>
            );
          })}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-neutral-100 pt-4">
            <div>
              {allDocsUploaded ? (
                <p className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  All required documents have been uploaded.
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-xs font-medium text-warning-700">
                  <AlertTriangle className="h-4 w-4" />
                  Some documents are still missing.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                toast.success("Documents saved successfully!");
                navigate("/supplier/quotations");
              }}
              className="btn-touch inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-700"
            >
              Done &amp; Save
            </button>
          </div>
        </div>
      </div>
    </SupplierPortalLayout>
  );
}
