import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
  XCircle,
} from "lucide-react";

import {
  downloadItemImportErrorReport,
  downloadItemImportTemplate,
  importItemsToErp,
  ITEM_IMPORT_EXISTING_MODES,
  ITEM_IMPORT_MAX_ROWS,
  itemImportExistingModeLabel,
  itemImportOutcomeLabel,
  loadItemImportContext,
  parseItemImportFile,
  type ItemImportExistingMode,
  type ItemImportOutcome,
  type ItemImportProgress,
  type ItemImportSummary,
} from "../../../api/itemMasterImport";
import { useAuthStore } from "../../../store/authStore";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported?: (summary: ItemImportSummary) => void;
}

type Phase = "idle" | "parsing" | "importing" | "done";

function outcomeClass(outcome: ItemImportOutcome): string {
  switch (outcome) {
    case "created":
      return "text-emerald-700";
    case "updated":
      return "text-sky-800";
    case "skipped":
      return "text-amber-700";
    case "failed":
      return "text-rose-700";
  }
}

export default function ItemMasterImportDialog({
  open,
  onClose,
  onImported,
}: Props) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");
  const [existingMode, setExistingMode] =
    useState<ItemImportExistingMode>("skip");
  const [autoCreateUom, setAutoCreateUom] = useState(true);
  const [progress, setProgress] = useState<ItemImportProgress | null>(null);
  const [summary, setSummary] = useState<ItemImportSummary | null>(null);
  const [error, setError] = useState("");

  if (!open) return null;

  function reset() {
    setPhase("idle");
    setFileName("");
    setProgress(null);
    setSummary(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    if (phase === "importing" || phase === "parsing") return;
    reset();
    onClose();
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setError("");
    setSummary(null);
    setFileName(file.name);
    setPhase("parsing");

    try {
      const rows = await parseItemImportFile(file);
      if (rows.length === 0) {
        throw new Error("No data rows found in the file.");
      }
      if (rows.length > ITEM_IMPORT_MAX_ROWS) {
        throw new Error(
          `File has ${rows.length} rows. Please import at most ${ITEM_IMPORT_MAX_ROWS} items per upload.`,
        );
      }

      setPhase("importing");
      setProgress({
        processed: 0,
        total: rows.length,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        masters: {
          categoriesCreated: 0,
          itemGroupsCreated: 0,
          brandsCreated: 0,
          manufacturersCreated: 0,
          uomsCreated: 0,
          categoryNames: [],
          itemGroupNames: [],
          brandNames: [],
          manufacturerNames: [],
          uomNames: [],
        },
      });

      const context = await loadItemImportContext();
      const result = await importItemsToErp({
        rows,
        fileName: file.name,
        importedBy:
          user?.full_name || user?.email || user?.name || "Warehouse User",
        context,
        existingMode,
        autoCreateMasters: true,
        autoCreateUom,
        concurrency: rows.length > 1000 ? 3 : 4,
        onProgress: setProgress,
      });

      setSummary(result);
      setPhase("done");
      void queryClient.invalidateQueries({ queryKey: ["item-master-list"] });
      void queryClient.invalidateQueries({ queryKey: ["item-master-codes"] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-items"] });
      void queryClient.invalidateQueries({ queryKey: ["item-groups"] });

      if (result.failed === 0 && (result.created > 0 || result.updated > 0)) {
        toast.success(
          `${result.created} created · ${result.updated} updated in Item Master.`,
        );
      } else if (
        result.created === 0 &&
        result.updated === 0 &&
        result.failed === 0 &&
        result.skipped > 0
      ) {
        toast.success("All rows were skipped.");
      } else if (result.failed > 0) {
        toast.error("Import finished with errors. Review the summary.");
      } else {
        toast(
          `Import finished: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`,
        );
      }
      onImported?.(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not import items.";
      // eslint-disable-next-line no-console
      console.error("[ItemMasterImport] dialog error", err);
      setError(message);
      setPhase("idle");
      toast.error(message);
    }
  }

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  const issueRows =
    summary?.results.filter(
      (r) => r.outcome === "skipped" || r.outcome === "failed",
    ) ?? [];

  const busy = phase === "importing" || phase === "parsing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Import Items</h2>
            <p className="text-sm text-slate-500">
              Create and update Item Master records from Excel or CSV.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase !== "done" && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Existing Item Codes
                  </label>
                  <select
                    value={existingMode}
                    disabled={busy}
                    onChange={(e) =>
                      setExistingMode(e.target.value as ItemImportExistingMode)
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {ITEM_IMPORT_EXISTING_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {itemImportExistingModeLabel(mode)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    New Item Codes are always created. This setting only applies
                    when the code already exists.
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 sm:col-span-1">
                  <p className="font-semibold text-slate-800">
                    Auto-create masters (always on)
                  </p>
                  <p className="mt-0.5">
                    Missing Procurement Categories, Item Groups, Brands, and
                    Manufacturers are created automatically.
                  </p>
                </div>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={autoCreateUom}
                    disabled={busy}
                    onChange={(e) => setAutoCreateUom(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">Auto-create UOM</span>
                    <span className="block text-xs text-slate-500">
                      When off, unknown UOMs fail the row. Categories and Item
                      Groups are still auto-created.
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => downloadItemImportTemplate()}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />
                  Download Sample Template
                </button>
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center hover:border-primary-300 hover:bg-primary-50/40">
                <FileSpreadsheet className="h-8 w-8 text-primary-600" />
                <span className="text-sm font-semibold text-slate-800">
                  {fileName || "Choose Excel (.xlsx) or CSV file"}
                </span>
                <span className="text-xs text-slate-500">
                  Supports {ITEM_IMPORT_MAX_ROWS.toLocaleString()} rows · writes
                  directly to Item Master
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) =>
                    void handleFile(e.target.files?.[0] ?? null)
                  }
                />
              </label>

              {busy && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-2 font-semibold text-slate-800">
                      <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                      {phase === "parsing"
                        ? "Parsing file…"
                        : "Writing items…"}
                    </span>
                    {progress && (
                      <span className="tabular-nums text-slate-500">
                        {progress.processed}/{progress.total} ({pct}%)
                      </span>
                    )}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-primary-600 transition-all duration-300"
                      style={{ width: `${phase === "parsing" ? 15 : pct}%` }}
                    />
                  </div>
                  {progress && (
                    <p className="mt-2 text-xs text-slate-500">
                      Created {progress.created} · Updated {progress.updated} ·
                      Skipped {progress.skipped} · Failed {progress.failed}
                      {progress.currentItemCode
                        ? ` · Current: ${progress.currentItemCode}`
                        : ""}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </div>
              )}
            </div>
          )}

          {phase === "done" && summary && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <CheckCircle2 className="h-5 w-5" />
                  Import Summary
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Total Rows
                    </dt>
                    <dd className="font-bold text-slate-900">
                      {summary.totalRows}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      New Items Created
                    </dt>
                    <dd className="font-bold text-emerald-700">
                      {summary.created}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Existing Items Updated
                    </dt>
                    <dd className="font-bold text-sky-800">{summary.updated}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Failed Rows
                    </dt>
                    <dd className="font-bold text-rose-700">{summary.failed}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      New Categories Created
                    </dt>
                    <dd className="font-bold text-slate-900">
                      {summary.masters.categoriesCreated}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      New Item Groups Created
                    </dt>
                    <dd className="font-bold text-slate-900">
                      {summary.masters.itemGroupsCreated}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      New Brands Created
                    </dt>
                    <dd className="font-bold text-slate-900">
                      {summary.masters.brandsCreated}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      New Manufacturers Created
                    </dt>
                    <dd className="font-bold text-slate-900">
                      {summary.masters.manufacturersCreated}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      File / Mode
                    </dt>
                    <dd className="truncate font-medium text-slate-800">
                      {summary.fileName} ·{" "}
                      {itemImportExistingModeLabel(summary.existingMode)}
                      {summary.skipped > 0
                        ? ` · ${summary.skipped} skipped`
                        : ""}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Imported By / When
                    </dt>
                    <dd className="text-slate-800">
                      {summary.importedBy} ·{" "}
                      {new Date(summary.importedAt).toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </div>

              {issueRows.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">
                      Row-level issues
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        downloadItemImportErrorReport(
                          summary.results,
                          `Item_Import_Issues_${Date.now()}.xlsx`,
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Issue Report
                    </button>
                  </div>
                  <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Row</th>
                          <th className="px-3 py-2">Code</th>
                          <th className="px-3 py-2">Outcome</th>
                          <th className="px-3 py-2">Issue</th>
                          <th className="px-3 py-2">Suggestion</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {issueRows.slice(0, 100).map((r) => (
                          <tr key={`${r.rowNumber}-${r.item_code}`}>
                            <td className="px-3 py-2 tabular-nums align-top">
                              {r.rowNumber}
                            </td>
                            <td className="px-3 py-2 font-mono align-top">
                              {r.item_code || "—"}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <span
                                className={`inline-flex items-center gap-1 font-semibold ${outcomeClass(r.outcome)}`}
                              >
                                {r.outcome === "failed" && (
                                  <XCircle className="h-3.5 w-3.5" />
                                )}
                                {itemImportOutcomeLabel(r.outcome)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-700 align-top">
                              {r.error || "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-500 align-top">
                              {r.suggestion || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {issueRows.length > 100 && (
                      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                        Showing first 100 of {issueRows.length}. Download the
                        issue report for the full list.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {phase === "done" ? (
            <>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Upload className="h-4 w-4" />
                Import Another File
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
              >
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
