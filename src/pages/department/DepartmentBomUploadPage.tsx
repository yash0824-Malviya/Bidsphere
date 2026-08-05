import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  Package,
  Send,
  Upload,
} from "lucide-react";

import PageHeader from "../../components/PageHeader";
import BomProcessingStatusPanel, {
  buildBomProcessSteps,
} from "../../components/bom/BomProcessingStatusPanel";
import BomUploadHistoryPanel, {
  BomUploadSummaryCards,
  buildSessionHistoryRow,
  mapHistoryRow,
  type BomHistoryDisplayRow,
  type BomHistoryStatus,
} from "../../components/bom/BomUploadHistoryPanel";
import { ENV_DEFAULTS } from "../../api/erpnext";
import { useAuthStore } from "../../store/authStore";
import {
  downloadSampleBomTemplate,
  fileToBase64,
  getUploadedBomHistory,
  parseBomHistoryMeta,
  submitDepartmentBomFromUpload,
  uploadBomFile,
  type BomParsedRow,
  type BomUploadResult,
} from "../../api/uploadedBom";

type Step = "upload" | "preview" | "submit" | "done";

const PAGE_SIZE = 25;

function statusTone(status: BomParsedRow["status"]): string {
  switch (status) {
    case "exists":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "new":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "missing_uom":
      return "bg-primary-50 text-primary-800 border-primary-200";
    case "duplicate":
      return "bg-orange-50 text-orange-800 border-orange-200";
    case "invalid":
      return "bg-rose-50 text-rose-800 border-rose-200";
  }
}

function sessionStatusFromStep(
  step: Step,
  uploading: boolean,
  failed: boolean,
): BomHistoryStatus {
  if (failed) return "Failed";
  if (uploading) return "Parsing";
  if (step === "preview") return "Preview Ready";
  if (step === "submit") return "Validating";
  if (step === "done") return "Completed";
  return "Uploading";
}

export default function DepartmentBomUploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadSectionRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<BomUploadResult | null>(null);
  const [page, setPage] = useState(0);
  const [department, setDepartment] = useState(user?.department || "");
  const [bomVersion, setBomVersion] = useState("1.0");
  const [remarks, setRemarks] = useState("");
  const [createdMr, setCreatedMr] = useState<string | null>(null);
  const [submitSummary, setSubmitSummary] = useState<{
    tempItems: number;
    mrItems: number;
    status: string;
  } | null>(null);
  const [sessionId] = useState(() => `session-${Date.now()}`);

  const historyQuery = useQuery({
    queryKey: ["uploaded-bom-history"],
    queryFn: getUploadedBomHistory,
    staleTime: 60_000,
  });

  const rows = result?.rows ?? [];
  const summary = result?.summary;
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const newItemCount = rows.filter((r) => !r.exists_in_erp && r.status !== "invalid").length;
  const existingItemCount = rows.filter((r) => r.exists_in_erp).length;

  const processFile = useCallback(async (next: File) => {
    setUploading(true);
    setUploadError(null);
    setFile(next);
    try {
      const parsed = await uploadBomFile(next);
      setResult(parsed);
      setPage(0);
      const uiWarnings = (parsed.warnings ?? []).filter(
        (w) =>
          !/fallback|supplier group|BOM categor|active suppliers|mapped to/i.test(w),
      );
      uiWarnings.forEach((w) => toast(w, { icon: "⚠️" }));
      toast.success(`Validated ${parsed.summary.total_rows} row(s) from ${parsed.file_name}`);
      setStep("preview");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setUploadError(message);
      toast.error(message, { duration: 10_000 });
      setFile(null);
      setResult(null);
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void processFile(f);
  };

  const submitBom = async () => {
    if (!result) return;
    if (!department.trim()) {
      toast.error("Department is required.");
      return;
    }
    const invalid = result.rows.filter((r) => r.status === "invalid").length;
    if (invalid > 0) {
      toast.error(`Fix ${invalid} invalid row(s) before submitting.`);
      return;
    }

    setSubmitting(true);
    try {
      let file_base64: string | undefined;
      if (file) {
        try {
          file_base64 = await fileToBase64(file);
        } catch {
          /* optional */
        }
      }

      const created = await submitDepartmentBomFromUpload({
        rows: result.rows,
        uploaded_by: user?.email || user?.full_name || "Department",
        department: department.trim(),
        bom_version: bomVersion.trim() || "1.0",
        remarks,
        company: ENV_DEFAULTS.company || undefined,
        file_name: result.file_name,
        file_base64,
        file_mime: file?.type,
      });

      setCreatedMr(created.material_request ?? null);
      setSubmitSummary({
        tempItems: created.temporary_items_created,
        mrItems: created.existing_items_in_mr,
        status: created.status,
      });
      setStep("done");
      toast.success(created.status);
      void queryClient.invalidateQueries({ queryKey: ["uploaded-bom-history"] });
      void queryClient.invalidateQueries({ queryKey: ["temporary-items"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit Department BOM.");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setResult(null);
    setCreatedMr(null);
    setSubmitSummary(null);
    setRemarks("");
    setPage(0);
    setUploadError(null);
  };

  const scrollToUpload = () => {
    uploadSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (step === "upload") inputRef.current?.click();
  };

  const scrollToHistory = () => {
    document.getElementById("bom-upload-history")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const processSteps = buildBomProcessSteps({
    uploading,
    creating: submitting,
    wizardStep:
      step === "submit"
        ? "suppliers"
        : step === "done"
          ? "done"
          : step,
    failed: !!uploadError,
    workflow: "department",
  });

  const historyDisplayRows = useMemo((): BomHistoryDisplayRow[] => {
    const erpRows = (historyQuery.data ?? []).map((row) => {
      const mapped = mapHistoryRow(row);
      const meta = parseBomHistoryMeta(row.remarks || "");
      return {
        ...mapped,
        department: meta.department || mapped.department,
        bomName: meta.fileName || mapped.bomName,
        tempItems: meta.tempItems ?? mapped.tempItems,
        rfqCreated: !!meta.materialRequest,
        rfq: meta.materialRequest,
        progress: meta.materialRequest ? 100 : mapped.progress,
        status: meta.materialRequest
          ? "Completed"
          : (row.status as BomHistoryStatus) || mapped.status,
        validationResult: row.status || mapped.validationResult,
      };
    });

    if (!result || step === "upload") return erpRows;

    const sessionRow = buildSessionHistoryRow({
      id: sessionId,
      fileName: result.file_name,
      uploadedBy: user?.email || user?.full_name || "Department",
      totalItems: result.summary.total_rows,
      status: sessionStatusFromStep(step, uploading, !!uploadError),
      rfq: createdMr ?? undefined,
    });
    sessionRow.department = department || "—";
    return [sessionRow, ...erpRows.filter((r) => r.bomName !== result.file_name)];
  }, [
    historyQuery.data,
    result,
    step,
    uploading,
    uploadError,
    sessionId,
    user,
    createdMr,
    department,
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={scrollToHistory}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-sm font-medium text-[#334155] shadow-sm hover:bg-[#F8FAFC]"
            >
              <History className="h-4 w-4" />
              History
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  downloadSampleBomTemplate();
                  toast.success("Downloading sample template…");
                } catch {
                  toast.error("Could not download sample template.");
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-sm font-medium text-[#334155] shadow-sm hover:bg-[#F8FAFC]"
            >
              <Download className="h-4 w-4" />
              Download Sample BOM
            </button>
          </div>
        }
      />

      <div>
        <h1 className="text-xl font-semibold text-[#1E293B]">Department BOM Upload</h1>
        <p className="mt-1 max-w-3xl text-sm text-[#64748B]">
          Upload a Department BOM to validate parts, identify new items, create Temporary Items when
          required, and generate a Material Request. Shortages are forwarded to Procurement after
          warehouse review.
        </p>
      </div>

      <nav className="text-sm text-[#64748B]" aria-label="Breadcrumb">
        <Link to="/dashboard" className="text-[#1F3A6D] no-underline hover:underline">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link to="/department/upload-bom" className="text-[#1F3A6D] no-underline hover:underline">
          Department
        </Link>
        <span className="mx-2">/</span>
        <span className="font-medium text-[#1E293B]">Department BOM Upload</span>
      </nav>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(
            [
              ["upload", "1. Upload BOM"],
              ["preview", "2. Validate Items"],
              ["submit", "3. Create MR"],
              ["done", "4. Complete"],
            ] as const
          ).map(([id, label], idx) => {
            const active = step === id;
            const done =
              (id === "upload" && step !== "upload") ||
              (id === "preview" && (step === "submit" || step === "done")) ||
              (id === "submit" && step === "done");
            return (
              <div key={id} className="flex items-center gap-2">
                {idx > 0 && <span className="text-[#CBD5E1]">/</span>}
                <span
                  className={
                    active
                      ? "font-semibold text-[#1F3A6D]"
                      : done
                        ? "text-emerald-600"
                        : "text-[#94A3B8]"
                  }
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="w-full xl:max-w-[520px]">
          <BomUploadSummaryCards rows={historyDisplayRows} />
        </div>
      </div>

      <div ref={uploadSectionRef} className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          {step === "upload" && (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex min-h-[240px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 transition ${
                  dragging
                    ? "border-[#1F3A6D] bg-[#EEF3FA]/60"
                    : "border-[#E2E8F0] bg-[#F8FAFC]"
                }`}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-10 w-10 animate-spin text-[#1F3A6D]" />
                    <p className="mt-3 text-sm font-medium text-[#334155]">
                      Validating Excel…
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF3FA] text-[#1F3A6D]">
                      <Upload className="h-7 w-7" />
                    </div>
                    <p className="mt-4 text-base font-medium text-[#1E293B]">
                      Drag & drop your Department BOM Excel
                    </p>
                    <p className="mt-1 text-sm text-[#64748B]">
                      Supported: .xlsx, .xls · Max 20 MB
                    </p>
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#1F3A6D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#17315D]"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      Choose File
                    </button>
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void processFile(f);
                        e.target.value = "";
                      }}
                    />
                  </>
                )}
              </div>
              {uploadError ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  {uploadError}
                </div>
              ) : null}
            </div>
          )}

          {step === "preview" && result && summary && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Total Items", value: summary.total_rows, icon: Package },
                  { label: "ERP Items", value: existingItemCount, icon: CheckCircle2 },
                  { label: "New Items", value: newItemCount, icon: AlertTriangle },
                  { label: "Invalid", value: summary.invalid_rows, icon: AlertTriangle },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                      {s.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[#1E293B]">{s.value}</p>
                  </div>
                ))}
              </div>

              {newItemCount > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {newItemCount} item(s) are not in ERP Item Master. They will be sent to{" "}
                  <Link to="/department/temporary-items" className="font-semibold underline">
                    Temporary Item Store
                  </Link>{" "}
                  for Master Data review before procurement.
                </div>
              ) : null}

              <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF2F7] px-4 py-3">
                  <div>
                    <h2 className="text-base font-semibold text-[#1E293B]">Validation Preview</h2>
                    <p className="text-xs text-[#64748B]">{result.file_name}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={reset} className="rounded-xl border border-[#E2E8F0] px-3 py-2 text-sm">
                      Re-upload
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep("submit")}
                      disabled={summary.invalid_rows === summary.total_rows}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#1F3A6D] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Continue
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="max-h-[360px] overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 bg-[#F8FAFC] text-[10px] uppercase text-[#64748B]">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2">Qty</th>
                        <th className="px-3 py-2">UOM</th>
                        <th className="px-3 py-2">ERP</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r) => (
                        <tr key={`${r.row_number}-${r.item_code}`} className="border-t border-[#F1F5F9]">
                          <td className="px-3 py-2">{r.row_number}</td>
                          <td className="px-3 py-2">
                            <p className="font-medium">{r.item_name}</p>
                            <p className="text-xs text-[#64748B]">{r.item_code || "—"}</p>
                          </td>
                          <td className="px-3 py-2">{r.qty}</td>
                          <td className="px-3 py-2">{r.uom}</td>
                          <td className="px-3 py-2">{r.exists_in_erp ? "Yes" : "No"}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs ${statusTone(r.status)}`}>
                              {r.status_label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === "submit" && result && (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <h2 className="text-base font-semibold text-[#1E293B]">Submit Department BOM</h2>
              <p className="mt-1 text-sm text-[#64748B]">
                Validate items, route new parts to Temporary Item Store when required, create a
                Material Request, and forward shortages to Procurement via warehouse review.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-[#334155]">Department *</span>
                  <input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-[#334155]">BOM Version</span>
                  <input
                    value={bomVersion}
                    onChange={(e) => setBomVersion(e.target.value)}
                    className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2"
                  />
                </label>
              </div>
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium text-[#334155]">Remarks</span>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2"
                />
              </label>
              <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-[#EEF2F7] pt-4">
                <button type="button" onClick={() => setStep("preview")} className="rounded-xl border px-4 py-2 text-sm">
                  Back
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submitBom()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#1F3A6D] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Submit & Generate MR
                </button>
              </div>
            </div>
          )}

          {step === "done" && submitSummary && (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
              <h2 className="mt-4 text-xl font-semibold text-[#1E293B]">Department BOM Submitted</h2>
              <p className="mt-2 text-sm text-[#64748B]">{submitSummary.status}</p>
              <div className="mt-4 grid gap-2 text-sm text-[#475569] sm:grid-cols-2">
                <p>MR items: {submitSummary.mrItems}</p>
                <p>Temp items: {submitSummary.tempItems}</p>
              </div>
              <p className="mt-3 text-xs text-[#64748B]">
                Warehouse will issue available stock and forward any shortage to Procurement.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                {createdMr ? (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/material-requests/${encodeURIComponent(createdMr)}`)
                    }
                    className="rounded-xl bg-[#1F3A6D] px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    Open Material Request
                  </button>
                ) : null}
                <button type="button" onClick={reset} className="rounded-xl border px-4 py-2.5 text-sm">
                  Upload Another BOM
                </button>
              </div>
            </div>
          )}
        </div>

        {processSteps.visible ? (
          <BomProcessingStatusPanel
            fileName={file?.name ?? result?.file_name}
            steps={processSteps.steps}
            progressPct={processSteps.progressPct}
            failed={!!uploadError}
            errorMessage={uploadError}
          />
        ) : (
          <div className="hidden rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FAFBFC] p-6 xl:flex xl:min-h-[320px] xl:flex-col xl:justify-center">
            <p className="text-sm font-medium text-[#64748B]">Processing Status</p>
            <p className="mt-2 text-[13px] text-[#94A3B8]">
              Upload a Department BOM to track validation, Temporary Item routing, and Material Request generation.
            </p>
          </div>
        )}
      </div>

      <BomUploadHistoryPanel
        variant="department"
        rows={historyDisplayRows}
        loading={historyQuery.isLoading}
        error={historyQuery.isError}
        sessionRows={result?.rows}
        sessionFileName={result?.file_name}
        onUploadClick={scrollToUpload}
        onViewPreview={(row) => {
          if (row.rfq) {
            navigate(`/material-requests/${encodeURIComponent(row.rfq)}`);
            return;
          }
          if (result) setStep("preview");
          scrollToUpload();
        }}
        onContinue={(row) => {
          if (result && row.isActive) setStep(step === "preview" ? "submit" : "preview");
          else toast("Re-upload the BOM file to continue.", { icon: "ℹ️" });
          scrollToUpload();
        }}
        onCreateRfq={() => toast.error("Procurement RFQs start after warehouse confirms shortage.")}
        onRetry={reset}
      />
    </div>
  );
}
