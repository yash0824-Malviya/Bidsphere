import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  Package,
  Search,
  Send,
  Upload,
  Users,
  X,
} from "lucide-react";

import PageHeader from "../../components/PageHeader";
import { apiGet, ENV_DEFAULTS } from "../../api/erpnext";
import { useAuthStore } from "../../store/authStore";
import {
  createRfqFromUploadedBom,
  downloadSampleBomTemplate,
  fileToBase64,
  getUploadedBomHistory,
  uploadBomFile,
  type BomParsedRow,
  type BomUploadResult,
  type RecommendedSupplier,
} from "../../api/uploadedBom";
import type { Supplier } from "../../types/erpnext";

type Step = "upload" | "preview" | "suppliers" | "done";

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

export default function UploadBomPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<BomUploadResult | null>(null);
  const [page, setPage] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remarks, setRemarks] = useState("");
  const [createdRfq, setCreatedRfq] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const historyQuery = useQuery({
    queryKey: ["uploaded-bom-history"],
    queryFn: getUploadedBomHistory,
    enabled: showHistory,
    staleTime: 60_000,
  });

  const rows = result?.rows ?? [];
  const summary = result?.summary;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const filteredSuppliers = useMemo(() => {
    const list = result?.recommended_suppliers ?? [];
    const q = supplierSearch.trim().toLowerCase();
    return list.filter((s) => {
      if (categoryFilter && s.supplier_group !== categoryFilter) return false;
      if (!q) return true;
      return (
        s.supplier_name.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.supplier_group || "").toLowerCase().includes(q)
      );
    });
  }, [result, categoryFilter, supplierSearch]);

  const processFile = useCallback(async (next: File) => {
    setUploading(true);
    setUploadError(null);
    setFile(next);
    try {
      const parsed = await uploadBomFile(next);

      // Client-side safety net: if server returned zero suppliers, load active
      // suppliers the same way New RFQ does so the workflow can continue.
      if (!parsed.recommended_suppliers?.length) {
        try {
          const active = await apiGet<Supplier[]>("/api/resource/Supplier", {
            params: {
              filters: JSON.stringify([["disabled", "=", 0]]),
              fields: JSON.stringify([
                "name",
                "supplier_name",
                "supplier_group",
                "country",
                "disabled",
              ]),
              limit_page_length: 100,
              order_by: "supplier_name asc",
            },
          });
          const fallbackList: RecommendedSupplier[] = (active ?? []).map((s) => ({
            name: s.name,
            supplier_name: s.supplier_name || s.name,
            supplier_group: s.supplier_group || "",
            country: s.country,
            score: 40,
            reasons: ["Active supplier (client fallback)"],
          }));
          parsed.recommended_suppliers = fallbackList;
          parsed.supplier_categories = Array.from(
            new Set(fallbackList.map((s) => s.supplier_group).filter(Boolean)),
          ).sort();
          parsed.supplier_recommendation = {
            bom_categories: [],
            bom_commodities: [],
            bom_item_groups: [],
            supplier_groups_in_erp: parsed.supplier_categories,
            matched_supplier_groups: [],
            active_suppliers_queried: fallbackList.length,
            category_matched_suppliers: 0,
            returned_suppliers: fallbackList.length,
            fallback_used: true,
            fallback_reason:
              "Server returned no recommended suppliers. Loaded all active suppliers from ERPNext so you can continue.",
            query_notes: ["client_fallback_active_suppliers"],
          };
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.log(
              "[UploadBOM] Supplier recommendation (client fallback)",
              parsed.supplier_recommendation,
            );
          }
        } catch (fallbackErr) {
          // eslint-disable-next-line no-console
          console.warn("[UploadBOM] Client supplier fallback failed", fallbackErr);
        }
      }

      if (import.meta.env.DEV && parsed.supplier_recommendation) {
        // eslint-disable-next-line no-console
        console.log(
          "[UploadBOM] Supplier recommendation meta",
          parsed.supplier_recommendation,
        );
      }

      setResult(parsed);
      setPage(0);
      setSelected(new Set());
      setCategoryFilter("");
      setSupplierSearch("");
      // Parse/validation warnings only — never surface supplier matching/fallback debug text
      const uiWarnings = (parsed.warnings ?? []).filter(
        (w) =>
          !/fallback|supplier group|BOM categor|active suppliers|mapped to/i.test(w),
      );
      if (uiWarnings.length) {
        uiWarnings.forEach((w) => toast(w, { icon: "⚠️" }));
      }
      toast.success(`Parsed ${parsed.summary.total_rows} row(s) from ${parsed.file_name}`);
      setStep("preview");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Upload failed.";
      setUploadError(message);
      toast.error(message, {
        duration: 10_000,
        style: { whiteSpace: "pre-line", maxWidth: "28rem" },
      });
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

  const toggleSupplier = (s: RecommendedSupplier) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s.name)) next.delete(s.name);
      else next.add(s.name);
      return next;
    });
  };

  const createRfq = async () => {
    if (!result) return;
    if (selected.size < 1) {
      toast.error("Select at least one supplier.");
      return;
    }
    const invalid = result.rows.filter((r) => r.status === "invalid").length;
    if (invalid > 0) {
      toast.error(`Remove or fix ${invalid} invalid row(s) before creating an RFQ.`);
      return;
    }

    setCreating(true);
    try {
      const suppliers = (result.recommended_suppliers ?? [])
        .filter((s) => selected.has(s.name))
        .map((s) => ({ supplier: s.name, supplier_name: s.supplier_name }));

      // If filtered list hid some selected, still include by name
      if (suppliers.length < selected.size) {
        for (const name of selected) {
          if (!suppliers.some((s) => s.supplier === name)) {
            suppliers.push({ supplier: name, supplier_name: name });
          }
        }
      }

      let file_base64: string | undefined;
      if (file) {
        try {
          file_base64 = await fileToBase64(file);
        } catch {
          /* optional */
        }
      }

      const created = await createRfqFromUploadedBom({
        rows: result.rows,
        suppliers,
        uploaded_by: user?.email || user?.full_name || "Procurement",
        remarks,
        company: ENV_DEFAULTS.company || undefined,
        file_name: result.file_name,
        file_base64,
        file_mime: file?.type,
        message_for_supplier: `RFQ created from procurement BOM upload (${result.file_name}).`,
      });

      setCreatedRfq(created.rfq_name);
      setStep("done");
      toast.success(`RFQ ${created.rfq_name} created`);
      if (created.items_ensured?.length) {
        toast(
          `${created.items_ensured.length} new non-stock item(s) registered for this RFQ.`,
          { icon: "ℹ️" },
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create RFQ.");
    } finally {
      setCreating(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setResult(null);
    setSelected(new Set());
    setCreatedRfq(null);
    setRemarks("");
    setPage(0);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
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
              className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Download Sample BOM
            </button>
          </div>
        }
      />

      {/* Step indicator */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(
          [
            ["upload", "1. Upload"],
            ["preview", "2. Preview"],
            ["suppliers", "3. Suppliers"],
            ["done", "4. RFQ"],
          ] as const
        ).map(([id, label], idx) => {
          const active = step === id;
          const done =
            (id === "upload" && step !== "upload") ||
            (id === "preview" && (step === "suppliers" || step === "done")) ||
            (id === "suppliers" && step === "done");
          return (
            <div key={id} className="flex items-center gap-2">
              {idx > 0 && <span className="text-slate-300">/</span>}
              <span
                className={
                  active
                    ? "font-semibold text-primary-600"
                    : done
                      ? "text-emerald-600"
                      : "text-slate-400"
                }
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {showHistory && (
        <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Uploaded BOM History</h2>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {historyQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {historyQuery.isError && (
            <p className="text-sm text-rose-600">
              Could not load history. Run the Uploaded BOM DocType setup script if needed.
            </p>
          )}
          {historyQuery.data && historyQuery.data.length === 0 && (
            <p className="text-sm text-slate-500">No uploaded BOMs yet.</p>
          )}
          {historyQuery.data && historyQuery.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-2">BOM Number</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">By</th>
                    <th className="px-2 py-2">Items</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">RFQ</th>
                  </tr>
                </thead>
                <tbody>
                  {historyQuery.data.map((h) => (
                    <tr key={h.name} className="border-b border-slate-100">
                      <td className="px-2 py-2 font-medium text-slate-800">{h.bom_number}</td>
                      <td className="px-2 py-2 text-slate-600">{h.upload_date}</td>
                      <td className="px-2 py-2 text-slate-600">{h.uploaded_by}</td>
                      <td className="px-2 py-2 text-slate-600">{h.total_items}</td>
                      <td className="px-2 py-2 text-slate-600">{h.status}</td>
                      <td className="px-2 py-2">
                        {h.rfq ? (
                          <Link
                            to={`/sourcing/rfq/${encodeURIComponent(h.rfq)}`}
                            className="text-primary-600 hover:underline"
                          >
                            {h.rfq}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* UPLOAD */}
      {step === "upload" && (
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-card">
          <div className="mb-4">
            <h1 className="text-xl font-semibold text-slate-900">Upload BOM</h1>
            <p className="mt-1 text-sm text-slate-500">
              Procurement BOM reader — parse Excel and create an RFQ. Does not create
              Engineering or Manufacturing BOMs.
            </p>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex min-h-[260px] flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition ${
              dragging
                ? "border-primary-500 bg-primary-50/60"
                : "border-slate-200 bg-slate-50/80"
            }`}
          >
            {uploading ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-primary-600" />
                <p className="mt-3 text-sm font-medium text-slate-700">Reading Excel…</p>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary-600">
                  <Upload className="h-7 w-7" />
                </div>
                <p className="mt-4 text-base font-medium text-slate-800">
                  Drag & drop your BOM Excel here
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Supported: .xlsx, .xls · Max 20 MB
                </p>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Choose File
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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

          {uploadError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
            >
              <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
                {uploadError}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* PREVIEW */}
      {step === "preview" && result && summary && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total Rows", value: summary.total_rows, icon: Package },
              { label: "Existing Items", value: summary.existing_items, icon: CheckCircle2 },
              { label: "New Items", value: summary.new_items, icon: AlertTriangle },
              { label: "Warnings", value: summary.warnings, icon: AlertTriangle },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-neutral-200 bg-white p-4 shadow-card"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {s.label}
                  </p>
                  <s.icon className="h-4 w-4 text-primary-500" />
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">BOM Preview</h2>
                <p className="text-xs text-slate-500">{result.file_name}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md border border-neutral-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Re-upload
                </button>
                <button
                  type="button"
                  onClick={() => setStep("suppliers")}
                  disabled={summary.invalid_rows === summary.total_rows}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                >
                  Continue
                  <Users className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Item Code</th>
                    <th className="px-3 py-2">Item Name</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">UOM</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={`${r.row_number}-${r.item_code}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-500">{r.row_number}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.item_code || "—"}</td>
                      <td className="px-3 py-2 text-slate-800">{r.item_name}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-600" title={r.description}>
                        {r.description}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{r.qty}</td>
                      <td className="px-3 py-2 text-slate-700">{r.uom}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${statusTone(r.status)}`}
                          title={r.errors?.join("; ")}
                        >
                          {r.status_label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
                <span className="text-slate-500">
                  Page {page + 1} of {pageCount}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUPPLIERS */}
      {step === "suppliers" && result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-card">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Recommended Suppliers
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {filteredSuppliers.length > 0
                    ? `Showing ${filteredSuppliers.length} recommended supplier${filteredSuppliers.length === 1 ? "" : "s"}`
                    : "Select suppliers for the RFQ."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep("preview")}
                className="rounded-md border border-neutral-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Back to Preview
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="Search suppliers…"
                  className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
              >
                <option value="">All supplier categories</option>
                {(result.supplier_categories ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              {filteredSuppliers.length === 0 && (
                <div className="space-y-2 py-8 text-center text-sm">
                  <p className="text-slate-600">
                    No recommended suppliers found. Please adjust the filters or add
                    suppliers.
                  </p>
                  {(categoryFilter || supplierSearch.trim()) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryFilter("");
                        setSupplierSearch("");
                      }}
                      className="text-sm text-primary-600 hover:underline"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
              {filteredSuppliers.map((s) => {
                const on = selected.has(s.name);
                return (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => toggleSupplier(s)}
                    className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition ${
                      on
                        ? "border-primary-400 bg-primary-50/70"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        on
                          ? "border-primary-600 bg-primary-600 text-white"
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{s.supplier_name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          Score {s.score}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {s.supplier_group || "No group"}
                        {s.country ? ` · ${s.country}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{s.reasons.join(" · ")}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Remarks (optional)
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
                placeholder="Notes for this uploaded BOM…"
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">
                {selected.size} supplier{selected.size === 1 ? "" : "s"} selected
              </p>
              <button
                type="button"
                disabled={creating || selected.size < 1}
                onClick={() => void createRfq()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Create RFQ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DONE */}
      {step === "done" && createdRfq && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-card">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">RFQ Created</h2>
          <p className="mt-2 text-sm text-slate-600">
            Procurement BOM was converted into RFQ{" "}
            <span className="font-semibold text-slate-900">{createdRfq}</span>.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() =>
                navigate(`/sourcing/rfq/${encodeURIComponent(createdRfq)}`)
              }
              className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600"
            >
              Open RFQ
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-neutral-200 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Upload Another BOM
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
