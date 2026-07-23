/**
 * Supplier Quotation — Cost Breakdown section.
 *
 * Manual grid + Excel template download / upload / preview / save.
 * Only rendered when the parent RFQ has Require Cost Breakdown enabled.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Calculator,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import {
  buildCostBreakdownTemplateBlob,
  downloadBlob,
  flattenBreakdownsToLines,
  lineTotal,
  listActiveCostHeads,
  listCostBreakdownsForRfqSupplier,
  parseCostBreakdownExcel,
  saveCostBreakdown,
  sumLines,
  validateLines,
} from "../../api/costBreakdown";
import type {
  CostBreakdownLineDraft,
  CostBreakdownUploadType,
  ExcelValidationIssue,
} from "../../types/costBreakdown";
import { generateId } from "../../utils/id";
import { formatCurrencyIn } from "../../utils/format";

export interface CostBreakdownPanelHandle {
  /** True when at least one valid line exists and there are no validation errors. */
  isReady: () => boolean;
  /** Persist current lines (Draft). Throws on failure. */
  save: (opts?: { status?: "Draft" | "Submitted" }) => Promise<void>;
  getLines: () => CostBreakdownLineDraft[];
  getGrandTotal: () => number;
}

export interface CostBreakdownPanelProps {
  rfqName: string;
  supplier: string;
  currency?: string;
  items: Array<{ item_code: string; item_name?: string }>;
  supplierQuotation?: string;
  readOnly?: boolean;
  onReadyChange?: (ready: boolean) => void;
}

function emptyLine(
  item: { item_code: string; item_name?: string },
  costHead = "",
): CostBreakdownLineDraft {
  return {
    id: generateId(),
    item_code: item.item_code,
    item_name: item.item_name || item.item_code,
    cost_head: costHead,
    description: "",
    quantity: 1,
    unit_cost: 0,
    total_cost: 0,
  };
}

const CostBreakdownPanel = forwardRef<
  CostBreakdownPanelHandle,
  CostBreakdownPanelProps
>(function CostBreakdownPanel(
  {
    rfqName,
    supplier,
    currency,
    items,
    supplierQuotation,
    readOnly = false,
    onReadyChange,
  },
  ref,
) {
  const [lines, setLines] = useState<CostBreakdownLineDraft[]>([]);
  const [uploadType, setUploadType] =
    useState<CostBreakdownUploadType>("Manual");
  const [search, setSearch] = useState("");
  const [itemFilter, setItemFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [issues, setIssues] = useState<ExcelValidationIssue[]>([]);
  const [previewMode, setPreviewMode] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const PAGE_SIZE = 10;

  const headsQuery = useQuery({
    queryKey: ["cost-head-master-active"],
    queryFn: listActiveCostHeads,
    staleTime: 5 * 60_000,
  });

  const existingQuery = useQuery({
    queryKey: ["cost-breakdown", rfqName, supplier],
    queryFn: () => listCostBreakdownsForRfqSupplier(rfqName, supplier),
    enabled: !!rfqName && !!supplier,
  });

  useEffect(() => {
    if (loaded || !existingQuery.data) return;
    if (existingQuery.data.length > 0) {
      setLines(flattenBreakdownsToLines(existingQuery.data));
      const ut = existingQuery.data[0]?.upload_type;
      if (ut) setUploadType(ut);
    } else if (items.length > 0 && lines.length === 0) {
      const firstHead = headsQuery.data?.[0]?.name ?? "";
      setLines([emptyLine(items[0], firstHead)]);
    }
    setLoaded(true);
  }, [existingQuery.data, headsQuery.data, items, loaded, lines.length]);

  const headSet = useMemo(
    () => new Set((headsQuery.data ?? []).map((h) => h.name)),
    [headsQuery.data],
  );
  const itemSet = useMemo(
    () => new Set(items.map((i) => i.item_code)),
    [items],
  );

  const liveIssues = useMemo(
    () => validateLines(lines, headSet, itemSet),
    [lines, headSet, itemSet],
  );

  const ready = useMemo(() => {
    if (lines.length === 0) return false;
    if (liveIssues.some((i) => i.severity === "error")) return false;
    return lines.every(
      (l) =>
        l.item_code &&
        l.cost_head &&
        Number.isFinite(l.quantity) &&
        Number.isFinite(l.unit_cost) &&
        l.quantity >= 0 &&
        l.unit_cost >= 0,
    );
  }, [lines, liveIssues]);

  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  const grandTotal = useMemo(() => sumLines(lines), [lines]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (itemFilter !== "all" && l.item_code !== itemFilter) return false;
      if (!q) return true;
      return (
        l.item_code.toLowerCase().includes(q) ||
        (l.item_name ?? "").toLowerCase().includes(q) ||
        l.cost_head.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q)
      );
    });
  }, [lines, search, itemFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (pageSafe - 1) * PAGE_SIZE,
    pageSafe * PAGE_SIZE,
  );

  const patchLine = useCallback(
    (id: string, patch: Partial<CostBreakdownLineDraft>) => {
      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          const next = { ...l, ...patch };
          next.total_cost = lineTotal(next.quantity, next.unit_cost);
          return next;
        }),
      );
      setPreviewMode(false);
    },
    [],
  );

  const addRow = () => {
    const item = items[0] ?? { item_code: "", item_name: "" };
    const firstHead = headsQuery.data?.[0]?.name ?? "";
    setLines((prev) => [...prev, emptyLine(item, firstHead)]);
    setUploadType("Manual");
    setPreviewMode(false);
  };

  const removeRow = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const persist = useCallback(
    async (opts?: { status?: "Draft" | "Submitted" }) => {
      if (!ready) {
        throw new Error(
          "Cost breakdown is incomplete or has validation errors.",
        );
      }
      setSaving(true);
      try {
        await saveCostBreakdown({
          rfq: rfqName,
          supplier,
          supplier_quotation: supplierQuotation,
          currency,
          upload_type: uploadType,
          status: opts?.status ?? "Draft",
          lines: lines.map((l) => ({
            item_code: l.item_code,
            item_name: l.item_name,
            cost_head: l.cost_head,
            description: l.description,
            quantity: l.quantity,
            unit_cost: l.unit_cost,
          })),
        });
        toast.success("Cost breakdown saved.");
        void existingQuery.refetch();
      } finally {
        setSaving(false);
      }
    },
    [
      ready,
      rfqName,
      supplier,
      supplierQuotation,
      currency,
      uploadType,
      lines,
      existingQuery,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      isReady: () => ready,
      save: persist,
      getLines: () => lines,
      getGrandTotal: () => grandTotal,
    }),
    [ready, persist, lines, grandTotal],
  );

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      const blob = await buildCostBreakdownTemplateBlob({
        rfqName,
        items,
      });
      downloadBlob(blob, `Cost_Breakdown_${rfqName}.xlsx`);
      toast.success("Excel template downloaded.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to download template.",
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadProgress(15);
    setIssues([]);
    try {
      setUploadProgress(45);
      const result = await parseCostBreakdownExcel(file, {
        allowedItemCodes: items.map((i) => i.item_code),
        itemNames: Object.fromEntries(
          items.map((i) => [i.item_code, i.item_name || i.item_code]),
        ),
      });
      setUploadProgress(85);
      setIssues(result.issues);
      if (!result.ok) {
        toast.error("Excel validation failed. Review the issues below.");
        setUploadProgress(100);
        return;
      }
      setLines(result.lines);
      setUploadType("Excel");
      setPreviewMode(true);
      setPage(1);
      toast.success(
        `Imported ${result.lines.length} row${result.lines.length === 1 ? "" : "s"}. Preview and save.`,
      );
      setUploadProgress(100);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to read Excel file.",
      );
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 800);
    }
  };

  const displayIssues = previewMode ? issues : liveIssues;
  const errorIssues = displayIssues.filter((i) => i.severity === "error");

  if (headsQuery.isLoading || existingQuery.isLoading) {
    return (
      <section className="scroll-mt-24 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-40 rounded bg-neutral-100" />
          <div className="h-9 w-full rounded bg-neutral-100" />
          <div className="h-32 w-full rounded bg-neutral-50" />
        </div>
      </section>
    );
  }

  return (
    <section
      id="section-cost-breakdown"
      className="scroll-mt-24 rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary-600" />
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Cost Breakdown
            </h2>
            <p className="text-[11px] text-neutral-500">
              Manual entry or Excel upload — required for this RFQ
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {previewMode && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-100">
              Preview
            </span>
          )}
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
            {uploadType}
          </span>
          <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-700">
            {formatCurrencyIn(grandTotal, currency)}
          </span>
        </div>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap gap-2 border-b border-neutral-100 px-3.5 py-2.5">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Manual Entry
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={() => void handleDownloadTemplate()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download Excel Template
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Upload Excel
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleUpload(f);
            }}
          />
          <button
            type="button"
            disabled={saving || !ready}
            onClick={() =>
              void persist().catch((err) =>
                toast.error(
                  err instanceof Error ? err.message : "Save failed.",
                ),
              )
            }
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save Cost Breakdown
          </button>
        </div>
      )}

      {uploadProgress > 0 && (
        <div className="px-3.5 pt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-primary-500 transition-all"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search cost lines…"
            className="input-field pl-8 text-xs"
          />
        </div>
        <select
          value={itemFilter}
          onChange={(e) => {
            setItemFilter(e.target.value);
            setPage(1);
          }}
          className="input-field max-w-[200px] text-xs"
        >
          <option value="all">All items</option>
          {items.map((it) => (
            <option key={it.item_code} value={it.item_code}>
              {it.item_name || it.item_code}
            </option>
          ))}
        </select>
      </div>

      {errorIssues.length > 0 && (
        <div className="mx-3.5 mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            Validation ({errorIssues.length})
          </p>
          <ul className="max-h-28 list-disc space-y-0.5 overflow-y-auto pl-4">
            {errorIssues.slice(0, 12).map((iss, i) => (
              <li key={`${iss.row}-${iss.column}-${i}`}>
                {iss.row > 0 ? `Row ${iss.row}: ` : ""}
                {iss.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lines.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <FileSpreadsheet className="h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">
            No cost breakdown lines yet
          </p>
          <p className="max-w-sm text-xs text-neutral-500">
            Add rows manually or download the Excel template, fill it offline,
            and upload.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto px-2 pb-2">
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="sticky top-0 z-10 bg-neutral-50">
                {[
                  "Item",
                  "Cost Head",
                  "Description",
                  "Qty",
                  "Unit Cost",
                  "Total",
                  "",
                ].map((h) => (
                  <th
                    key={h || "actions"}
                    className="border-b border-neutral-200 px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-neutral-50/80">
                  <td className="border-b border-neutral-100 px-2 py-1.5">
                    {readOnly ? (
                      <span className="font-medium text-neutral-800">
                        {row.item_name || row.item_code}
                      </span>
                    ) : (
                      <select
                        value={row.item_code}
                        onChange={(e) => {
                          const it = items.find(
                            (i) => i.item_code === e.target.value,
                          );
                          patchLine(row.id, {
                            item_code: e.target.value,
                            item_name: it?.item_name || e.target.value,
                          });
                        }}
                        className="input-field py-1 text-xs"
                      >
                        {items.map((it) => (
                          <option key={it.item_code} value={it.item_code}>
                            {it.item_name || it.item_code}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="border-b border-neutral-100 px-2 py-1.5">
                    {readOnly ? (
                      row.cost_head
                    ) : (
                      <select
                        value={row.cost_head}
                        onChange={(e) =>
                          patchLine(row.id, { cost_head: e.target.value })
                        }
                        className="input-field py-1 text-xs"
                      >
                        <option value="">Select…</option>
                        {(headsQuery.data ?? []).map((h) => (
                          <option key={h.name} value={h.name}>
                            {h.cost_head_name || h.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="border-b border-neutral-100 px-2 py-1.5">
                    {readOnly ? (
                      row.description || "—"
                    ) : (
                      <input
                        value={row.description}
                        onChange={(e) =>
                          patchLine(row.id, { description: e.target.value })
                        }
                        className="input-field py-1 text-xs"
                        placeholder="Optional"
                      />
                    )}
                  </td>
                  <td className="border-b border-neutral-100 px-2 py-1.5">
                    {readOnly ? (
                      row.quantity
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={row.quantity}
                        onChange={(e) =>
                          patchLine(row.id, {
                            quantity: Number(e.target.value),
                          })
                        }
                        className="input-field w-20 py-1 text-xs tabular-nums"
                      />
                    )}
                  </td>
                  <td className="border-b border-neutral-100 px-2 py-1.5">
                    {readOnly ? (
                      formatCurrencyIn(row.unit_cost, currency)
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={row.unit_cost}
                        onChange={(e) =>
                          patchLine(row.id, {
                            unit_cost: Number(e.target.value),
                          })
                        }
                        className="input-field w-24 py-1 text-xs tabular-nums"
                      />
                    )}
                  </td>
                  <td className="border-b border-neutral-100 px-2 py-1.5 font-semibold tabular-nums text-neutral-800">
                    {formatCurrencyIn(row.total_cost, currency)}
                  </td>
                  <td className="border-b border-neutral-100 px-2 py-1.5">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="rounded p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-neutral-50">
                <td
                  colSpan={5}
                  className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
                >
                  Grand Total
                </td>
                <td className="px-2 py-2 text-sm font-bold tabular-nums text-neutral-900">
                  {formatCurrencyIn(grandTotal, currency)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-neutral-100 px-3.5 py-2 text-xs text-neutral-600">
          <span>
            {(pageSafe - 1) * PAGE_SIZE + 1}–
            {Math.min(pageSafe * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={pageSafe <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={pageSafe >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
});

export default CostBreakdownPanel;
