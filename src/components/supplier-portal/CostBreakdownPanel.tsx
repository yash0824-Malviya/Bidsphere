/**
 * Supplier Quotation — Item-wise Cost Breakdown.
 *
 * One expandable card per RFQ item with predefined cost heads (amount + description).
 * Manual entry + Excel upload (one Excel row per item). Scalable via search + pagination.
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
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Save,
  Search,
  Upload,
} from "lucide-react";

import {
  buildCostBreakdownTemplateBlob,
  buildItemDrafts,
  downloadBlob,
  flattenBreakdownsToLines,
  isItemBalanced,
  isItemComplete,
  itemBalanceDiff,
  itemBreakdownTotal,
  itemDraftsToLines,
  listActiveCostHeads,
  listCostBreakdownsForRfqSupplier,
  parseCostBreakdownExcel,
  resolveCostHeadName,
  roundMoney,
  saveCostBreakdown,
  validateItemDrafts,
} from "../../api/costBreakdown";
import type {
  CostBreakdownLineDraft,
  CostBreakdownUploadType,
  ExcelValidationIssue,
  ItemCostBreakdownDraft,
  ItemCostHeadEntry,
} from "../../types/costBreakdown";
import { formatCurrencyIn } from "../../utils/format";

const LOG = "[CostBreakdown UI]";

/** Merge user-entered amounts/descriptions onto a freshly built draft structure. */
function mergeItemDraftAmounts(
  next: ItemCostBreakdownDraft[],
  prev: ItemCostBreakdownDraft[],
): ItemCostBreakdownDraft[] {
  if (!prev.length) return next;
  const prevByCode = new Map(prev.map((i) => [i.item_code, i]));
  return next.map((item) => {
    const p = prevByCode.get(item.item_code);
    if (!p) return item;
    const byKey = new Map<string, ItemCostHeadEntry>();
    for (const h of p.heads ?? []) {
      const costKey = String(h.cost_head || "").trim();
      const labelKey = String(h.label || "").trim();
      if (costKey) byKey.set(costKey, h);
      if (labelKey) byKey.set(labelKey, h);
    }
    return {
      ...item,
      excel_row: p.excel_row ?? item.excel_row,
      heads: (item.heads ?? []).map((h) => {
        const old =
          byKey.get(String(h.cost_head || "").trim()) ||
          byKey.get(String(h.label || "").trim());
        if (!old) return h;
        return {
          ...h,
          amount: Number(old.amount) || 0,
          description: old.description || "",
        };
      }),
    };
  });
}

export interface CostBreakdownPanelHandle {
  isReady: () => boolean;
  save: (opts?: { status?: "Draft" | "Submitted" }) => Promise<void>;
  getLines: () => CostBreakdownLineDraft[];
  getGrandTotal: () => number;
}

export interface CostBreakdownPanelItem {
  item_code: string;
  item_name?: string;
  qty?: number;
  unit_price?: number;
}

export interface CostBreakdownPanelProps {
  rfqName: string;
  supplier: string;
  currency?: string;
  items: CostBreakdownPanelItem[];
  supplierQuotation?: string;
  readOnly?: boolean;
  onReadyChange?: (ready: boolean) => void;
}

type ItemFilter = "all" | "completed" | "pending" | "unbalanced";

const PAGE_SIZE = 25;

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
  const [itemDrafts, setItemDrafts] = useState<ItemCostBreakdownDraft[]>([]);
  const [uploadType, setUploadType] =
    useState<CostBreakdownUploadType>("Manual");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ItemFilter>("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [issues, setIssues] = useState<ExcelValidationIssue[]>([]);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** True once we have hydrated drafts from ERP (or empty master) for this RFQ. */
  const hydratedRef = useRef(false);
  /** Keep latest drafts for save/logging without stale closures. */
  const itemDraftsRef = useRef<ItemCostBreakdownDraft[]>([]);
  itemDraftsRef.current = itemDrafts;

  // New RFQ/supplier → allow re-hydration from ERPNext.
  useEffect(() => {
    hydratedRef.current = false;
  }, [rfqName, supplier]);

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

  const itemsSyncKey = useMemo(
    () =>
      items
        .map(
          (i) =>
            `${i.item_code}\t${i.item_name ?? ""}\t${i.qty ?? 0}\t${i.unit_price ?? 0}`,
        )
        .join("|"),
    [items],
  );

  /** Stable master identity — avoid wiping drafts on new array references. */
  const masterKey = useMemo(
    () =>
      (headsQuery.data ?? [])
        .map((h) => `${h.name}:${h.sort_order ?? 0}:${h.is_active ?? 1}`)
        .join("|"),
    [headsQuery.data],
  );

  // Rebuild draft *structure* when RFQ items / masters change.
  // Always merge previously entered amounts so typing is never wiped.
  useEffect(() => {
    if (!items.length) {
      setItemDrafts([]);
      hydratedRef.current = false;
      setLoaded(true);
      return;
    }
    if (headsQuery.isLoading || existingQuery.isLoading) return;

    const master = headsQuery.data ?? [];

    setItemDrafts((prev) => {
      const hasLocalAmounts = prev.some((i) => itemBreakdownTotal(i) > 0);
      const useServer =
        !hydratedRef.current &&
        !hasLocalAmounts &&
        !!existingQuery.data?.length;

      const existingLines = useServer
        ? flattenBreakdownsToLines(existingQuery.data ?? [])
        : [];

      const next = buildItemDrafts({
        items,
        heads: master,
        existingLines,
      });

      const merged = hasLocalAmounts || prev.length
        ? mergeItemDraftAmounts(next, prev)
        : next;

      // eslint-disable-next-line no-console
      console.info(LOG, "Synced item drafts", {
        items: merged.length,
        masters: master.length,
        masterKey,
        usedServer: useServer,
        preservedAmounts: hasLocalAmounts,
        totals: merged.map((i) => ({
          item: i.item_code,
          total: itemBreakdownTotal(i),
          heads: (i.heads ?? []).length,
        })),
      });

      hydratedRef.current = true;
      return merged;
    });

    if (!loaded && existingQuery.data?.[0]?.upload_type) {
      setUploadType(existingQuery.data[0].upload_type);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on stable keys
  }, [
    itemsSyncKey,
    masterKey,
    headsQuery.isLoading,
    existingQuery.isLoading,
    existingQuery.dataUpdatedAt,
  ]);

  const liveIssues = useMemo(() => {
    const all = validateItemDrafts(itemDrafts, headsQuery.data ?? []);
    // Live UI: only surface problems for items the user has started filling.
    // Empty-item "Enter at least one…" is enforced on Save, not while typing.
    return all.filter((issue) => {
      if (issue.message === "Enter at least one cost-head amount.") return false;
      if (!issue.item_code) return true;
      const item = itemDrafts.find((i) => i.item_code === issue.item_code);
      return !!item && itemBreakdownTotal(item) > 0;
    });
  }, [itemDrafts, headsQuery.data]);
  const displayIssues = issues.length > 0 ? issues : liveIssues;
  const errorIssues = displayIssues.filter((i) => i.severity === "error");

  const completedCount = useMemo(
    () => itemDrafts.filter(isItemComplete).length,
    [itemDrafts],
  );
  const pendingCount = itemDrafts.length - completedCount;
  const grandTotal = useMemo(
    () =>
      roundMoney(
        itemDrafts.reduce((s, item) => s + itemBreakdownTotal(item), 0),
      ),
    [itemDrafts],
  );

  const ready = useMemo(() => {
    if (!itemDrafts.length) return false;
    if (!(headsQuery.data ?? []).length) return false;
    if (liveIssues.some((i) => i.severity === "error")) return false;
    return itemDrafts.every(isItemComplete);
  }, [itemDrafts, headsQuery.data, liveIssues]);

  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return itemDrafts.filter((item) => {
      if (statusFilter === "completed" && !isItemComplete(item)) return false;
      if (statusFilter === "pending" && isItemComplete(item)) return false;
      if (statusFilter === "unbalanced") {
        const total = itemBreakdownTotal(item);
        if (!(total > 0) || isItemBalanced(item)) return false;
      }
      if (!q) return true;
      return (
        item.item_code.toLowerCase().includes(q) ||
        item.item_name.toLowerCase().includes(q)
      );
    });
  }, [itemDrafts, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (pageSafe - 1) * PAGE_SIZE,
    pageSafe * PAGE_SIZE,
  );

  const toggleExpanded = (code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const opening = !next.has(code);
      if (opening) next.add(code);
      else next.delete(code);
      const item = itemDraftsRef.current.find((i) => i.item_code === code);
      // eslint-disable-next-line no-console
      console.info(LOG, opening ? "Expanded item" : "Collapsed item", {
        item: code,
        heads: (item?.heads ?? []).length,
        amounts: (item?.heads ?? []).map((h) => ({
          cost_head: h.cost_head,
          label: h.label,
          amount: h.amount,
        })),
        breakdownTotal: item ? itemBreakdownTotal(item) : 0,
      });
      return next;
    });
  };

  const patchHead = useCallback(
    (
      itemCode: string,
      costHeadName: string,
      patch: Partial<{ description: string; amount: number }>,
    ) => {
      setIssues([]);
      setUploadType("Manual");
      const master = headsQuery.data ?? [];

      // Synchronous update — startTransition was deferring amounts so validation
      // and save still saw $0 while the input briefly showed typed digits.
      setItemDrafts((prev) => {
        let matched = false;
        const next = prev.map((item) => {
          if (item.item_code !== itemCode) return item;
          return {
            ...item,
            heads: (item.heads ?? []).map((h) => {
              const sameHead =
                h.cost_head === costHeadName || h.label === costHeadName;
              if (!sameHead) return h;
              matched = true;
              const updated: ItemCostHeadEntry = { ...h, ...patch };
              updated.cost_head =
                resolveCostHeadName(h.cost_head, master) ||
                resolveCostHeadName(costHeadName, master) ||
                resolveCostHeadName(h.label, master) ||
                h.cost_head ||
                "";
              // eslint-disable-next-line no-console
              console.info(LOG, "Amount/description patched", {
                item: itemCode,
                cost_head: updated.cost_head,
                label: updated.label,
                amount: updated.amount,
                description: updated.description,
              });
              return updated;
            }),
          };
        });

        if (!matched) {
          // eslint-disable-next-line no-console
          console.warn(LOG, "patchHead: no matching cost head row", {
            itemCode,
            costHeadName,
            available: prev
              .find((i) => i.item_code === itemCode)
              ?.heads?.map((h) => ({
                cost_head: h.cost_head,
                label: h.label,
              })),
          });
        } else {
          const item = next.find((i) => i.item_code === itemCode);
          // eslint-disable-next-line no-console
          console.info(LOG, "Item state after patch", {
            item: itemCode,
            breakdownTotal: item ? itemBreakdownTotal(item) : 0,
            heads: (item?.heads ?? [])
              .filter((h) => (Number(h.amount) || 0) > 0)
              .map((h) => ({
                cost_head: h.cost_head,
                label: h.label,
                amount: h.amount,
              })),
          });
        }
        return next;
      });
    },
    [headsQuery.data],
  );

  const persist = useCallback(
    async (opts?: { status?: "Draft" | "Submitted" }) => {
      const masterHeads = headsQuery.data ?? [];
      const drafts = itemDraftsRef.current;

      // eslint-disable-next-line no-console
      console.info(LOG, "Save requested — current state", {
        itemCount: drafts.length,
        masters: masterHeads.map((h) => h.name),
        items: drafts.map((i) => ({
          item: i.item_code,
          quoted: i.quoted_unit_price,
          total: itemBreakdownTotal(i),
          heads: (i.heads ?? []).map((h) => ({
            cost_head: h.cost_head,
            label: h.label,
            amount: h.amount,
          })),
        })),
      });

      if (!masterHeads.length) {
        throw new Error(
          "No active Cost Head Master records found. Ask an administrator to seed Cost Head Master and set is_active = 1.",
        );
      }

      const validation = validateItemDrafts(drafts, masterHeads);
      const errors = validation.filter((i) => i.severity === "error");
      if (errors.length) {
        setIssues(errors);
        // eslint-disable-next-line no-console
        console.warn(LOG, "Save blocked by validation", errors);
        throw new Error(
          errors.some((e) => e.message === "Invalid Cost Head")
            ? "Invalid Cost Head. Fix highlighted items before saving."
            : "Cost breakdown is incomplete or unbalanced. Review the issues below.",
        );
      }
      const lines = itemDraftsToLines(drafts, masterHeads);
      if (!lines.length) {
        throw new Error("Add cost amounts for at least one item.");
      }

      const payloadLines = lines.map((l) => ({
        item_code: l.item_code,
        item_name: l.item_name,
        cost_head: l.cost_head,
        description: l.description,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
      }));

      // eslint-disable-next-line no-console
      console.info(LOG, "Payload sent to ERPNext", {
        rfq: rfqName,
        supplier,
        supplier_quotation: supplierQuotation,
        lineCount: payloadLines.length,
        lines: payloadLines,
      });

      setSaving(true);
      try {
        const saved = await saveCostBreakdown({
          rfq: rfqName,
          supplier,
          supplier_quotation: supplierQuotation,
          currency,
          upload_type: uploadType,
          status: opts?.status ?? "Draft",
          lines: payloadLines,
        });

        // eslint-disable-next-line no-console
        console.info(LOG, "API response after save", {
          parents: saved.map((d) => ({
            name: d.name,
            item: d.item,
            grand_total: d.grand_total,
            details: d.details?.map((r) => ({
              cost_head: r.cost_head,
              unit_cost: r.unit_cost,
              total_cost: r.total_cost,
            })),
          })),
        });

        // Reload drafts from what ERP stored so totals/status reflect saved rows.
        const reloaded = buildItemDrafts({
          items,
          heads: masterHeads,
          existingLines: flattenBreakdownsToLines(saved),
        });
        setItemDrafts(reloaded);
        setIssues([]);
        toast.success("Cost breakdown saved.");
        void existingQuery.refetch();
      } finally {
        setSaving(false);
      }
    },
    [
      items,
      rfqName,
      supplier,
      supplierQuotation,
      currency,
      uploadType,
      headsQuery.data,
      existingQuery,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      isReady: () => ready,
      save: persist,
      getLines: () => itemDraftsToLines(itemDrafts, headsQuery.data ?? []),
      getGrandTotal: () => grandTotal,
    }),
    [ready, persist, itemDrafts, grandTotal, headsQuery.data],
  );

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      const blob = await buildCostBreakdownTemplateBlob({
        rfqName,
        items: items.map((i) => ({
          item_code: i.item_code,
          item_name: i.item_name,
        })),
      });
      downloadBlob(blob, `Cost_Breakdown_${rfqName}.xlsx`);
      toast.success("Excel template downloaded (one row per item).");
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
        rfqItems: items,
      });
      setUploadProgress(85);
      setIssues(result.issues);

      // eslint-disable-next-line no-console
      console.info("[CostBreakdown Excel] Upload handler", {
        ok: result.ok,
        items: result.items,
        failedRows: result.failed_rows,
        issues: result.issues,
      });

      if (result.items?.length) {
        setItemDrafts(result.items);
        setUploadType("Excel");
        setPage(1);
        // Expand first unbalanced / first item for quick review
        const focus =
          result.items.find((i) => !isItemBalanced(i))?.item_code ||
          result.items[0]?.item_code;
        if (focus) setExpanded(new Set([focus]));
      }

      const errorCount = result.issues.filter((i) => i.severity === "error").length;
      if (!result.ok) {
        toast.error(
          `Excel validation failed (${errorCount} issue${errorCount === 1 ? "" : "s"}). Review details below.`,
        );
      } else {
        toast.success(
          `Imported cost breakdown for ${result.items?.length ?? 0} item${(result.items?.length ?? 0) === 1 ? "" : "s"}.`,
        );
      }
      setUploadProgress(100);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[CostBreakdown Excel] Upload failed", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to read Excel file.",
      );
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 800);
    }
  };

  if (headsQuery.isLoading || existingQuery.isLoading || !loaded) {
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary-600" />
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Cost Breakdown
            </h2>
            <p className="text-[11px] text-neutral-500">
              Item-wise amounts — must balance with Quoted Unit Price
            </p>
          </div>
        </div>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
          {uploadType}
        </span>
      </div>

      {(headsQuery.isError || !(headsQuery.data ?? []).length) && (
        <div className="mx-3.5 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Cost Head Master unavailable</p>
            <p className="mt-0.5 opacity-90">
              Active Cost Head records could not be loaded. Ask an
              administrator to seed Cost Head Master, set{" "}
              <code className="rounded bg-amber-100 px-1">is_active = 1</code>,
              and grant Supplier read access (e.g. run{" "}
              <code className="rounded bg-amber-100 px-1">
                scripts/setup-cost-breakdown-doctype.mjs
              </code>
              ).
            </p>
          </div>
        </div>
      )}

      {/* Summary panel */}
      <div className="grid grid-cols-2 gap-2 border-b border-neutral-100 px-3.5 py-2.5 sm:grid-cols-4">
        <SummaryStat
          label="Items Completed"
          value={String(completedCount)}
          tone="good"
        />
        <SummaryStat
          label="Items Pending"
          value={String(pendingCount)}
          tone={pendingCount > 0 ? "warn" : "neutral"}
        />
        <SummaryStat
          label="Grand Total"
          value={formatCurrencyIn(grandTotal, currency)}
          tone="neutral"
        />
        <SummaryStat
          label="Validation Errors"
          value={String(errorIssues.length)}
          tone={errorIssues.length > 0 ? "bad" : "good"}
        />
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className="flex flex-wrap gap-2 border-b border-neutral-100 px-3.5 py-2.5">
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

      {/* Validation details */}
      {errorIssues.length > 0 && (
        <div className="mx-3.5 mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
          <p className="mb-2 flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Validation — {errorIssues.length} issue
            {errorIssues.length === 1 ? "" : "s"}
          </p>
          <ul className="max-h-40 space-y-2 overflow-y-auto">
            {errorIssues.slice(0, 40).map((iss, i) => (
              <li
                key={`${iss.row}-${iss.column}-${iss.item_code}-${i}`}
                className="rounded-md border border-rose-100 bg-white/70 px-2.5 py-1.5"
              >
                {iss.row > 0 ? (
                  <p className="font-semibold">Row {iss.row}:</p>
                ) : null}
                {iss.item_code ? <p>Item = {iss.item_code}</p> : null}
                {iss.column ? <p>Column = {iss.column}</p> : null}
                <p>Error = {iss.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search items…"
            className="input-field pl-8 text-xs"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as ItemFilter);
            setPage(1);
          }}
          className="input-field max-w-[180px] text-xs"
        >
          <option value="all">All items</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="unbalanced">Unbalanced</option>
        </select>
        <span className="text-[11px] text-neutral-500">
          Showing {pageItems.length} of {filtered.length}
          {filtered.length !== itemDrafts.length
            ? ` (${itemDrafts.length} total)`
            : ""}
        </span>
      </div>

      {/* Item cards */}
      {itemDrafts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <FileSpreadsheet className="h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">
            No RFQ items for cost breakdown
          </p>
        </div>
      ) : (
        <div className="space-y-2 px-3 pb-3">
          {pageItems.map((item) => {
            const open = expanded.has(item.item_code);
            const total = itemBreakdownTotal(item);
            const balanced = isItemBalanced(item);
            const diff = itemBalanceDiff(item);
            const lineTotal = roundMoney(
              (Number(item.qty) || 0) * (Number(item.quoted_unit_price) || 0),
            );

            return (
              <article
                key={item.item_code}
                className={`overflow-hidden rounded-xl border ${
                  balanced
                    ? "border-emerald-200 bg-emerald-50/20"
                    : total > 0
                      ? "border-rose-200 bg-rose-50/10"
                      : "border-neutral-200 bg-white"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(item.item_code)}
                  className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-neutral-50/80"
                >
                  {open ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-neutral-900">
                        {item.item_name || item.item_code}
                      </h3>
                      {balanced ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" />
                          Balanced
                        </span>
                      ) : total > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                          <AlertTriangle className="h-3 w-3" />
                          Diff {formatCurrencyIn(diff, currency)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                          Pending
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-neutral-600 sm:grid-cols-4">
                      <Meta label="Item Code" value={item.item_code} />
                      <Meta
                        label="RFQ Quantity"
                        value={String(item.qty || 0)}
                      />
                      <Meta
                        label="Quoted Unit Price"
                        value={formatCurrencyIn(
                          item.quoted_unit_price,
                          currency,
                        )}
                      />
                      <Meta
                        label="Line Total"
                        value={formatCurrencyIn(lineTotal, currency)}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                      Breakdown
                    </p>
                    <p className="text-sm font-bold tabular-nums text-neutral-900">
                      {formatCurrencyIn(total, currency)}
                    </p>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-neutral-100 bg-white px-3 py-3">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                            <th className="pb-2 pr-2">Cost Head</th>
                            <th className="pb-2 pr-2">Description</th>
                            <th className="pb-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(item.heads ?? []).map((head) => {
                            const master = headsQuery.data ?? [];
                            const headInvalid =
                              (Number(head.amount) || 0) > 0 &&
                              !resolveCostHeadName(head.cost_head, master);
                            const headKey = head.cost_head || head.label;
                            return (
                              <tr
                                key={headKey}
                                className="border-t border-neutral-50"
                              >
                                <td className="py-1.5 pr-2 font-medium text-neutral-800">
                                  {head.label}
                                  {headInvalid && (
                                    <p className="mt-0.5 text-[10px] font-semibold text-rose-600">
                                      Invalid Cost Head
                                    </p>
                                  )}
                                </td>
                                <td className="py-1.5 pr-2">
                                  {readOnly ? (
                                    head.description || "—"
                                  ) : (
                                    <input
                                      value={head.description}
                                      onChange={(e) =>
                                        patchHead(item.item_code, headKey, {
                                          description: e.target.value,
                                        })
                                      }
                                      placeholder="Optional"
                                      className="input-field py-1 text-xs"
                                    />
                                  )}
                                </td>
                                <td className="py-1.5 text-right">
                                  {readOnly ? (
                                    <span className="tabular-nums font-semibold">
                                      {formatCurrencyIn(head.amount, currency)}
                                    </span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      value={
                                        Number.isFinite(head.amount) &&
                                        head.amount > 0
                                          ? head.amount
                                          : ""
                                      }
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const amount =
                                          raw === "" ? 0 : Number(raw);
                                        // eslint-disable-next-line no-console
                                        console.info(LOG, "Input change", {
                                          item: item.item_code,
                                          cost_head: head.cost_head,
                                          label: head.label,
                                          raw,
                                          amount: Number.isFinite(amount)
                                            ? amount
                                            : 0,
                                        });
                                        patchHead(item.item_code, headKey, {
                                          amount: Number.isFinite(amount)
                                            ? amount
                                            : 0,
                                        });
                                      }}
                                      className="input-field ml-auto w-28 py-1 text-right text-xs tabular-nums"
                                    />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-neutral-200">
                            <td
                              colSpan={2}
                              className="pt-2 text-right text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
                            >
                              Item Cost Breakdown Total
                            </td>
                            <td className="pt-2 text-right text-sm font-bold tabular-nums text-neutral-900">
                              {formatCurrencyIn(total, currency)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <div
                      className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                        balanced
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border border-rose-200 bg-rose-50 text-rose-900"
                      }`}
                    >
                      {balanced ? (
                        <>
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-semibold">
                              ✓ Cost Breakdown Balanced
                            </p>
                            <p className="mt-0.5 opacity-90">
                              Breakdown total matches Quoted Unit Price (
                              {formatCurrencyIn(
                                item.quoted_unit_price,
                                currency,
                              )}
                              ).
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-semibold">Not balanced</p>
                            <p className="mt-0.5 opacity-90">
                              Breakdown{" "}
                              {formatCurrencyIn(total, currency)} vs Quoted{" "}
                              {formatCurrencyIn(
                                item.quoted_unit_price,
                                currency,
                              )}
                              . Difference ={" "}
                              {formatCurrencyIn(diff, currency)}.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-neutral-100 px-3.5 py-2 text-xs text-neutral-600">
          <span>
            Page {pageSafe} of {totalPages}
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

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
      : tone === "warn"
        ? "bg-amber-50 text-amber-800 ring-amber-100"
        : tone === "bad"
          ? "bg-rose-50 text-rose-800 ring-rose-100"
          : "bg-neutral-50 text-neutral-800 ring-neutral-100";
  return (
    <div className={`rounded-lg px-2.5 py-2 ring-1 ring-inset ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="truncate font-medium text-neutral-800">{value}</p>
    </div>
  );
}

export default CostBreakdownPanel;
