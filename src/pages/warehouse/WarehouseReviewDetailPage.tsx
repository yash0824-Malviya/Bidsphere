import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Truck,
  XCircle,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

import {
  getMaterialRequestDetail,
  rejectMaterialRequest,
} from "../../services/warehouseService";
import {
  updateMaterialRequestWorkflowStatus,
  createWarehouseReview,
} from "../../api/materialRequestWorkflow";
import { apiGet, apiPost, buildListConfig, COMPANY } from "../../api/erpnext";
import ErrorState from "../../components/ErrorState";
import { validateWarehouseBelongsToCompany } from "../../utils/warehouseValidation";
import { sanitizeFrappeError } from "../../utils/friendlyError";
import { useAuthStore } from "../../store/authStore";

/** Read-only summary of a completed warehouse decision (session-scoped). */
interface ProcessedSummary {
  issuedItems: number;
  forwardedItems: number;
  issuedQty: number;
  forwardedQty: number;
  processedBy: string;
  processedOn: string;
  remarks: string;
  outcome: "issued" | "forwarded" | "partial";
  purchaseMR?: string;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BinRow {
  warehouse: string;
  actual_qty: number;
}

type ItemDecisionType =
  "issue_local" | "issue_transfer" | "forward_procurement";

interface ItemStockResult {
  totalQty: number;
  localQty: number;
  bestWarehouse: string;
  bestWarehouseQty: number;
  allBins: BinRow[];
  canIssueLocally: boolean;
  canIssueWithTransfer: boolean;
  cannotFulfill: boolean;
  shortage: number;
  decision: ItemDecisionType;
}

interface SEResponse {
  name: string;
  modified?: string;
  [key: string]: unknown;
}

interface MRResponse {
  name: string;
  [key: string]: unknown;
}

// ─── API helpers ───────────────────────────────────────────────────────────────

async function checkItemAcrossAllWarehouses(
  itemCode: string,
  requestedQty: number,
  netlinkWhNames: string[],
): Promise<ItemStockResult> {
  if (netlinkWhNames.length === 0) {
    return {
      totalQty: 0,
      localQty: 0,
      bestWarehouse: "",
      bestWarehouseQty: 0,
      allBins: [],
      canIssueLocally: false,
      canIssueWithTransfer: false,
      cannotFulfill: true,
      shortage: requestedQty,
      decision: "forward_procurement",
    };
  }

  const bins = await apiGet<BinRow[]>(
    "/api/resource/Bin",
    buildListConfig({
      filters: [
        ["item_code", "=", itemCode],
        ["warehouse", "in", netlinkWhNames],
      ],
      fields: ["warehouse", "actual_qty"],
      limit_page_length: 50,
    }),
  );

  const rows: BinRow[] = Array.isArray(bins) ? bins : [];

  const totalQty = rows.reduce((sum, b) => sum + (b.actual_qty || 0), 0);
  const sorted = [...rows].sort(
    (a, b) => (b.actual_qty || 0) - (a.actual_qty || 0),
  );
  const bestBin = sorted[0];
  const localBin = rows.find((b) =>
    b.warehouse.toLowerCase().includes("stores"),
  );
  const localQty = localBin?.actual_qty ?? 0;

  // canIssueWithTransfer only when a single non-local warehouse has enough
  // (the transfer step moves from one warehouse — multi-source is not supported).
  const bestBinQty = bestBin?.actual_qty ?? 0;
  const canIssueLocally = localQty >= requestedQty;
  const canIssueWithTransfer = !canIssueLocally && bestBinQty >= requestedQty;
  const cannotFulfill = !canIssueLocally && !canIssueWithTransfer;

  let decision: ItemDecisionType;
  if (canIssueLocally) decision = "issue_local";
  else if (canIssueWithTransfer) decision = "issue_transfer";
  else decision = "forward_procurement";

  return {
    totalQty,
    localQty,
    bestWarehouse: bestBin?.warehouse ?? "",
    bestWarehouseQty: bestBin?.actual_qty ?? 0,
    allBins: sorted,
    canIssueLocally,
    canIssueWithTransfer,
    cannotFulfill,
    shortage: Math.max(0, requestedQty - totalQty),
    decision,
  };
}

/** Best-effort audit comment on a Material Request. Never throws. */
async function addMRComment(mrName: string, message: string): Promise<void> {
  try {
    await apiPost("/api/method/frappe.client.save", {
      doc: {
        doctype: "Comment",
        comment_type: "Comment",
        reference_doctype: "Material Request",
        reference_name: mrName,
        content: message,
      },
    });
  } catch {
    /* non-critical */
  }
}

/**
 * Create and submit a Stock Entry via frappe.client.save (reliable, server-side
 * defaults fill valuation rates) then frappe.client.submit.
 * Throws on any failure — callers must handle rollback.
 */
async function createAndSubmitStockEntry(
  doc: Record<string, unknown>,
): Promise<string> {
  // frappe.client.save lets ERPNext compute basic_rate, valuation_rate, etc.
  const saved = await apiPost<SEResponse>("/api/method/frappe.client.save", {
    doc,
  });
  const seName = saved?.name;
  if (!seName) {
    throw new Error(
      "Stock Entry creation failed — ERPNext did not return a document name.",
    );
  }

  await apiPost("/api/method/frappe.client.submit", {
    doc: saved,
  });

  return seName;
}

/** Cancel a submitted Stock Entry (best-effort rollback). Never throws. */
async function cancelStockEntry(
  seName: string,
): Promise<"cancelled" | "failed"> {
  try {
    await apiPost("/api/method/frappe.client.cancel", {
      doctype: "Stock Entry",
      name: seName,
    });
    return "cancelled";
  } catch {
    return "failed";
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function DecisionBadge({ decision }: { decision: ItemDecisionType }) {
  if (decision === "issue_local") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
        ✓ Issue Locally
      </span>
    );
  }
  if (decision === "issue_transfer") {
    return (
      <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
        🔄 Transfer + Issue
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
      → Procurement
    </span>
  );
}

function MrStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    "Under Warehouse Review": "border-amber-200 bg-amber-50 text-amber-800",
    "Stock Available": "border-teal-200 bg-teal-50 text-teal-800",
    "Material Issued": "border-emerald-200 bg-emerald-50 text-emerald-800",
    "Procurement Required":
      "border-indigo-200 bg-indigo-50 text-indigo-800",
    Completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
    Cancelled: "border-rose-200 bg-rose-50 text-rose-800",
    Submitted: "border-slate-200 bg-slate-50 text-slate-700",
  };
  const cls = colorMap[status] ?? "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {status}
    </span>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function WarehouseReviewDetailPage() {
  const { mrNumber } = useParams<{ mrNumber: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [warehouseRemarks, setWarehouseRemarks] = useState("");
  const [showRejectPanel, setShowRejectPanel] = useState(false);
  const [rejectRemarks, setRejectRemarks] = useState("");

  // Per-item multi-warehouse stock check results
  const [itemDecisions, setItemDecisions] = useState<
    Record<string, ItemStockResult>
  >({});
  // Per-item action overrides — warehouse can change auto-detected decision
  const [itemActions, setItemActions] = useState<
    Record<string, ItemDecisionType>
  >({});
  const [checkingStock, setCheckingStock] = useState(false);
  const [processing, setProcessing] = useState(false);
  // Set the instant processing succeeds. Makes the page read-only for the rest
  // of the session (independent of the async status refetch) and blocks a
  // second submission of the same Material Request.
  const [processedResult, setProcessedResult] = useState<ProcessedSummary | null>(
    null,
  );

  const currentUser = useAuthStore((s) => s.user);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const detailQuery = useQuery({
    queryKey: ["warehouse", "mr-detail", mrNumber],
    queryFn: () => getMaterialRequestDetail(mrNumber ?? ""),
    enabled: !!mrNumber,
  });

  const mr = detailQuery.data;
  const mrItems = mr?.items ?? [];

  // ── Load stock across ALL warehouses for each item ───────────────────────────
  // ── Per-item multi-warehouse stock check ───────────────────────────────────────

  // Shared logic for both the auto-effect and the manual Refresh button.
  // All setState calls are inside the async callback — never synchronously
  // at the top level of the effect — to satisfy the React Compiler rule.
  const runStockCheck = () => {
    if (!mrItems.length) return;

    void (async () => {
      setCheckingStock(true);
      setItemDecisions({});
      setItemActions({});

      try {
        // Fetch valid Netlink warehouses first
        let netlinkWhNames: string[] = [];
        try {
          const list = await apiGet<any[]>("/api/resource/Warehouse", {
            params: {
              filters: JSON.stringify([
                ["company", "=", COMPANY],
                ["is_group", "=", 0],
                ["disabled", "=", 0],
              ]),
              fields: JSON.stringify(["name"]),
              limit_page_length: 500,
            },
          });
          netlinkWhNames = Array.isArray(list) ? list.map((w) => w.name) : [];
        } catch (err) {
          console.error("Failed to fetch Netlink warehouses for stock check:", err);
        }

        const results: Record<string, ItemStockResult> = {};
        for (const item of mrItems) {
          try {
            results[item.item_code] = await checkItemAcrossAllWarehouses(
              item.item_code,
              item.required_qty,
              netlinkWhNames,
            );
          } catch {
            results[item.item_code] = {
              totalQty: 0,
              localQty: 0,
              bestWarehouse: "",
              bestWarehouseQty: 0,
              allBins: [],
              canIssueLocally: false,
              canIssueWithTransfer: false,
              cannotFulfill: true,
              shortage: item.required_qty,
              decision: "forward_procurement",
            };
          }
        }
        setItemDecisions(results);
      } finally {
        // Always reset loading state, even on an unexpected error above —
        // never leave the "Checking stock…" spinner stuck.
        setCheckingStock(false);
      }
    })();
  };

  // Run automatically when MR items are first available.
  useEffect(() => {
    if (mr?.name && mrItems.length > 0) runStockCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mr?.name]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const getFinalDecision = (itemCode: string): ItemDecisionType =>
    (itemActions[itemCode] as ItemDecisionType | undefined) ??
    itemDecisions[itemCode]?.decision ??
    "forward_procurement";

  const decisionsReady =
    !checkingStock &&
    mrItems.length > 0 &&
    Object.keys(itemDecisions).length >= mrItems.length;

  const issueLocalItems = mrItems.filter(
    (i) => getFinalDecision(i.item_code) === "issue_local",
  );
  const issueTransferItems = mrItems.filter(
    (i) => getFinalDecision(i.item_code) === "issue_transfer",
  );
  const procurementItems = mrItems.filter(
    (i) => getFinalDecision(i.item_code) === "forward_procurement",
  );

  // ── Reject mutation ──────────────────────────────────────────────────────────

  const rejectMutation = useMutation({
    mutationFn: () => rejectMaterialRequest(mrNumber ?? "", rejectRemarks),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouse"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-dashboard-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-procurement-queue"] });
      toast.success("Material request rejected.");
      navigate("/warehouse/material-requests/pending");
    },
    onError: (err: unknown) => {
      toast.error(
        sanitizeFrappeError(
          err,
          "Unable to update the Material Request. Please try again.",
          "WarehouseReview.reject",
        ).message,
      );
    },
  });

  // ── Process all decisions ────────────────────────────────────────────────────

  const handleProcessAll = async () => {
    if (!mrNumber || !mr) return;
    // Never process the same Material Request twice.
    if (processing || processedResult) return;
    setProcessing(true);

    const today = new Date().toISOString().split("T")[0];

    try {
      // Fetch Netlink warehouses for fallback & validation
      let netlinkWhNames: string[] = [];
      try {
        const list = await apiGet<any[]>("/api/resource/Warehouse", {
          params: {
            filters: JSON.stringify([
              ["company", "=", COMPANY],
              ["is_group", "=", 0],
              ["disabled", "=", 0],
            ]),
            fields: JSON.stringify(["name"]),
            limit_page_length: 500,
          },
        });
        netlinkWhNames = Array.isArray(list) ? list.map((w) => w.name) : [];
      } catch (err) {
        console.error("Failed to fetch Netlink warehouses for verification:", err);
      }

      // ─── Validation Step BEFORE calling ERPNext ─────────────────────────────
      if (issueLocalItems.length > 0) {
        for (const item of issueLocalItems) {
          const d = itemDecisions[item.item_code];
          const sourceWh =
            d?.allBins.find((b) =>
              b.warehouse.toLowerCase().includes("stores"),
            )?.warehouse ??
            netlinkWhNames.find((w) => w.toLowerCase().includes("stores")) ??
            netlinkWhNames[0] ??
            "";

          if (!sourceWh) {
            throw new Error(`Validation failed: No Stores warehouse resolved for item "${item.item_code}".`);
          }
          const isValid = await validateWarehouseBelongsToCompany(sourceWh, COMPANY);
          if (!isValid) {
            throw new Error(
              `Validation failed: Warehouse "${sourceWh}" does not belong to company "${COMPANY}".`
            );
          }
        }
      }

      if (issueTransferItems.length > 0) {
        const storesWarehouse =
          issueTransferItems
            .flatMap((i) => itemDecisions[i.item_code]?.allBins ?? [])
            .find((b) => b.warehouse.toLowerCase().includes("stores"))
            ?.warehouse ??
          netlinkWhNames.find((w) => w.toLowerCase().includes("stores")) ??
          netlinkWhNames[0] ??
          "";

        if (!storesWarehouse) {
          throw new Error("Validation failed: Target Stores warehouse could not be resolved.");
        }
        const isTargetValid = await validateWarehouseBelongsToCompany(storesWarehouse, COMPANY);
        if (!isTargetValid) {
          throw new Error(
            `Validation failed: Target warehouse "${storesWarehouse}" does not belong to company "${COMPANY}".`
          );
        }

        for (const item of issueTransferItems) {
          const d = itemDecisions[item.item_code];
          const sourceWh = d?.bestWarehouse ?? "";
          if (!sourceWh) {
            throw new Error(`Validation failed: No source warehouse resolved for item "${item.item_code}".`);
          }
          const isSourceValid = await validateWarehouseBelongsToCompany(sourceWh, COMPANY);
          if (!isSourceValid) {
            throw new Error(
              `Validation failed: Source warehouse "${sourceWh}" does not belong to company "${COMPANY}".`
            );
          }
        }
      }

      // ─── Branch A: Issue directly from local Stores ─────────────────────────
      if (issueLocalItems.length > 0) {
        const doc = {
          doctype: "Stock Entry",
          stock_entry_type: "Material Issue",
          purpose: "Material Issue",
          company: COMPANY,
          posting_date: today,
          items: issueLocalItems.map((item) => {
            const d = itemDecisions[item.item_code];
            const sourceWh =
              d?.allBins.find((b) =>
                b.warehouse.toLowerCase().includes("stores"),
              )?.warehouse ??
              netlinkWhNames.find((w) => w.toLowerCase().includes("stores")) ??
              netlinkWhNames[0] ??
              "";
            return {
              doctype: "Stock Entry Detail",
              item_code: item.item_code,
              qty: item.required_qty,
              s_warehouse: sourceWh,
              uom: item.uom || "Nos",
              stock_uom: item.uom || "Nos",
              conversion_factor: 1,
            };
          }),
        };

        const seName = await createAndSubmitStockEntry(doc);
        await addMRComment(
          mrNumber,
          `Issued ${issueLocalItems.length} item(s) directly from Stores. Stock Entry: ${seName}`,
        );
        toast.success(
          `✅ ${issueLocalItems.length} item(s) issued from Stores (${seName})`,
        );
      }

      // ─── Branch B: Transfer from remote warehouse → Stores, then issue ───────
      // This is the "Transfer + Issue" flow. Both steps must succeed or the
      // transfer is cancelled (rolled back) before the error is reported.
      if (issueTransferItems.length > 0) {
        const sources = issueTransferItems
          .map((i) => itemDecisions[i.item_code]?.bestWarehouse)
          .filter(Boolean)
          .join(", ");

        const storesWarehouse =
          issueTransferItems
            .flatMap((i) => itemDecisions[i.item_code]?.allBins ?? [])
            .find((b) => b.warehouse.toLowerCase().includes("stores"))
            ?.warehouse ??
          netlinkWhNames.find((w) => w.toLowerCase().includes("stores")) ??
          netlinkWhNames[0] ??
          "";

        // ── Step 1: Material Transfer ──────────────────────────────────────────
        const transferDoc = {
          doctype: "Stock Entry",
          stock_entry_type: "Material Transfer",
          purpose: "Material Transfer",
          company: COMPANY,
          posting_date: today,
          items: issueTransferItems.map((item) => {
            const d = itemDecisions[item.item_code];
            return {
              doctype: "Stock Entry Detail",
              item_code: item.item_code,
              qty: item.required_qty,
              s_warehouse: d?.bestWarehouse ?? "",
              t_warehouse: storesWarehouse,
              uom: item.uom || "Nos",
              stock_uom: item.uom || "Nos",
              conversion_factor: 1,
            };
          }),
        };

        let transferSEName: string;
        try {
          transferSEName = await createAndSubmitStockEntry(transferDoc);
        } catch (transferErr) {
          const tMsg =
            transferErr instanceof Error
              ? transferErr.message
              : String(transferErr);
          throw new Error(
            `Material Transfer from [${sources}] to Stores failed. No stock was moved. ${tMsg}`,
            { cause: transferErr },
          );
        }

        toast(
          `Step 1 ✔ Transfer SE ${transferSEName} submitted. Starting issue step…`,
          { icon: "🔄" },
        );

        // ── Step 2: Material Issue from Stores ────────────────────────────────
        // If this fails we cancel the transfer so inventory is restored.
        const issueDoc = {
          doctype: "Stock Entry",
          stock_entry_type: "Material Issue",
          purpose: "Material Issue",
          company: COMPANY,
          posting_date: today,
          items: issueTransferItems.map((item) => ({
            doctype: "Stock Entry Detail",
            item_code: item.item_code,
            qty: item.required_qty,
            s_warehouse: storesWarehouse,
            uom: item.uom || "Nos",
            stock_uom: item.uom || "Nos",
            conversion_factor: 1,
          })),
        };

        let issueSEName: string;
        try {
          issueSEName = await createAndSubmitStockEntry(issueDoc);
        } catch (issueErr) {
          // Issue failed — try to cancel the transfer to restore inventory.
          const rollback = await cancelStockEntry(transferSEName);
          const rollbackMsg =
            rollback === "cancelled"
              ? `Transfer SE ${transferSEName} was automatically reversed — inventory restored.`
              : `⚠️ Transfer SE ${transferSEName} could NOT be reversed automatically. ` +
                `Please cancel it manually in ERPNext to restore inventory.`;
          const iMsg =
            issueErr instanceof Error ? issueErr.message : String(issueErr);
          throw new Error(
            `Material Issue from Stores failed. ${rollbackMsg} Issue error: ${iMsg}`,
            { cause: issueErr },
          );
        }

        // Both steps confirmed — write audit comment and notify.
        await addMRComment(
          mrNumber,
          `Transfer + Issue completed for ${issueTransferItems.length} item(s). ` +
            `Source: [${sources}]. ` +
            `Transfer SE: ${transferSEName}. Issue SE: ${issueSEName}.`,
        );
        toast.success(
          `🔄 ${issueTransferItems.length} item(s) transferred and issued (Transfer: ${transferSEName} / Issue: ${issueSEName})`,
        );
      }

      // ─── Branch C: Create Purchase MR for shortfall items ─────────────────
      let newProcurementMR: string | undefined;
      if (procurementItems.length > 0) {
        const purchaseMRDoc = {
          doctype: "Material Request",
          material_request_type: "Purchase",
          transaction_date: today,
          schedule_date: today,
          company: COMPANY,
          items: procurementItems.map((item, idx) => ({
            doctype: "Material Request Item",
            idx: idx + 1,
            item_code: item.item_code,
            item_name: item.description || item.item_code,
            description: `${item.description || item.item_code} [Shortfall from ${mrNumber}]`,
            qty: item.required_qty,
            uom: item.uom || "Nos",
            stock_uom: item.uom || "Nos",
            conversion_factor: 1,
            schedule_date: today,
          })),
        };

        const purchaseMR = await apiPost<MRResponse>(
          "/api/method/frappe.client.save",
          { doc: purchaseMRDoc },
        );
        newProcurementMR = purchaseMR?.name;

        if (newProcurementMR) {
          await addMRComment(
            mrNumber,
            `${procurementItems.length} item(s) have no stock — Purchase MR created for procurement: ${newProcurementMR}`,
          );
          await addMRComment(
            newProcurementMR,
            `Created from warehouse decision on ${mrNumber}. Items requiring procurement sourcing.`,
          );
          toast.success(
            `📋 ${procurementItems.length} item(s) forwarded — Purchase MR ${newProcurementMR} created`,
          );
        }
      }

      // ─── Update original MR workflow status ───────────────────────────────
      const hasIssued =
        issueLocalItems.length > 0 || issueTransferItems.length > 0;
      const hasForwarded = procurementItems.length > 0;

      try {
        if (hasForwarded) {
          // Tag the ORIGINAL MR with the exact shortfall items/quantities in
          // the same [BidSphere:ForwardedItems:...] format the Procurement
          // Queue and RFQ-from-MR flow parse (see parseForwardedItemsFromMr).
          // Without this, those readers fall back to the MR's FULL original
          // item quantities — over-stating what's actually left to procure
          // whenever some items were issued locally alongside a forward.
          const forwardingData = JSON.stringify(
            procurementItems.map((item) => ({
              item_code: item.item_code,
              item_name: item.description || item.item_code,
              requested_qty: item.required_qty,
              issued_qty: 0,
              forward_qty: item.required_qty,
              uom: item.uom || "Nos",
              warehouse: "",
            })),
          );
          const remarksLines = [
            warehouseRemarks.trim(),
            newProcurementMR
              ? `Purchase MR for shortfall: ${newProcurementMR}`
              : "",
            `[BidSphere:ForwardedItems:${forwardingData}]`,
          ].filter(Boolean);
          const remarksText = remarksLines.length > 0 ? remarksLines.join("\n") : undefined;

          await updateMaterialRequestWorkflowStatus(
            mrNumber,
            "Procurement Required",
            {
              custom_warehouse_remarks: remarksText,
            },
          );
          await createWarehouseReview({
            material_request: mrNumber,
            warehouse_remarks: remarksText,
            decision: hasIssued ? "Partially Issued" : "Forwarded to Procurement",
            issued_qty: issueLocalItems.reduce((sum, i) => sum + i.required_qty, 0) + issueTransferItems.reduce((sum, i) => sum + i.required_qty, 0),
            forwarded_qty: procurementItems.reduce((sum, i) => sum + i.required_qty, 0),
          });
        } else if (hasIssued) {
          const remarksText = warehouseRemarks.trim() || undefined;
          await updateMaterialRequestWorkflowStatus(
            mrNumber,
            "Material Issued",
            {
              custom_warehouse_remarks: remarksText,
            },
          );
          await createWarehouseReview({
            material_request: mrNumber,
            warehouse_remarks: remarksText,
            decision: "Material Issued",
            issued_qty: issueLocalItems.reduce((sum, i) => sum + i.required_qty, 0) + issueTransferItems.reduce((sum, i) => sum + i.required_qty, 0),
          });
        }
      } catch {
        // Status update failure is non-critical if stock entries were already processed
      }

      // ─── Invalidate every affected query key so UI refreshes without reload ──
      // Warehouse queues / issued / forwarded pages
      void queryClient.invalidateQueries({ queryKey: ["warehouse"] });
      // Department User dashboard cards and recent requests
      void queryClient.invalidateQueries({ queryKey: ["mr-dashboard-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-dashboard-counts"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-dashboard-recent"] });
      // Procurement queue
      void queryClient.invalidateQueries({
        queryKey: ["mr-procurement-queue"],
      });
      // MR list / issued tab
      void queryClient.invalidateQueries({ queryKey: ["mr-issued"] });
      void queryClient.invalidateQueries({
        queryKey: ["material-requests-workflow"],
      });
      // Individual MR detail cache
      if (mrNumber) {
        void queryClient.invalidateQueries({
          queryKey: ["material-request-workflow", mrNumber],
        });
      }

      // Flip the page to its read-only, post-processing state and render the
      // decision summary. We intentionally do NOT auto-navigate away — the
      // Warehouse Manager should see the confirmation on this page.
      const issuedQty =
        issueLocalItems.reduce((sum, i) => sum + i.required_qty, 0) +
        issueTransferItems.reduce((sum, i) => sum + i.required_qty, 0);
      const forwardedQty = procurementItems.reduce(
        (sum, i) => sum + i.required_qty,
        0,
      );
      setProcessedResult({
        issuedItems: issueLocalItems.length + issueTransferItems.length,
        forwardedItems: procurementItems.length,
        issuedQty,
        forwardedQty,
        processedBy:
          currentUser?.full_name ||
          currentUser?.email ||
          currentUser?.name ||
          "Warehouse",
        processedOn: new Date().toISOString(),
        remarks: warehouseRemarks.trim(),
        outcome:
          hasIssued && hasForwarded
            ? "partial"
            : hasForwarded
              ? "forwarded"
              : "issued",
        purchaseMR: newProcurementMR,
      });
    } catch (err: unknown) {
      // Never surface a raw Frappe/Python exception; log it and toast a clean
      // message. Non-Frappe errors (e.g. our own enriched rollback notes) pass
      // through with their existing text.
      toast.error(
        sanitizeFrappeError(
          err,
          "Unable to update the Material Request. Please try again.",
          "WarehouseReview.handleProcessAll",
        ).message,
      );
    } finally {
      setProcessing(false);
    }
  };

  // ── Loading / Error guards ────────────────────────────────────────────────────

  if (detailQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary-600" />
          <p className="text-sm font-medium text-slate-500">
            Loading material request…
          </p>
        </div>
      </div>
    );
  }

  if (detailQuery.isError || !mr) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load request details"
            description={`Could not load ${mrNumber ?? "this material request"}.`}
            onRetry={() => void detailQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  // Pending only while the MR is still awaiting a warehouse decision AND we
  // haven't just processed it this session. `processedResult` guarantees the
  // page goes read-only immediately, even if the async status refetch lags.
  const isPendingReview =
    !processedResult &&
    (mr.status === "Under Warehouse Review" || mr.status === "Stock Available");

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8 animate-in fade-in duration-300">
      {/* Back + status toolbar (no page title — content starts at the card below) */}
      <div className="flex items-center gap-3">
        <Link
          to="/warehouse/material-requests/pending"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50"
          aria-label="Back to pending requests"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <MrStatusBadge status={mr.status} />
      </div>

      {/* MR header card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {(
            [
              { label: "MR Number", value: mr.name },
              { label: "Department", value: mr.department },
              { label: "Requested By", value: mr.requested_by },
              { label: "Request Date", value: mr.request_date },
              { label: "Required Date", value: mr.required_date },
              { label: "Priority", value: mr.priority },
              { label: "Status", value: mr.status },
            ] as { label: string; value: string }[]
          ).map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {label}
              </dt>
              <dd
                className="mt-0.5 truncate text-sm font-semibold text-slate-800"
                title={value}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Stock Decision Grid */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              Stock Decision Grid
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Checks all Netlink warehouses for available stock. Override any
              row's decision using the dropdown.
            </p>
          </div>
          {decisionsReady && (
            <button
              type="button"
              onClick={runStockCheck}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh Stock
            </button>
          )}
        </div>

        {checkingStock ? (
          <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
            <span className="text-sm font-medium">
              Checking all warehouses for {mrItems.length} item(s)…
            </span>
          </div>
        ) : mrItems.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-500">
            No items found in this material request.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="whitespace-nowrap px-5 py-3.5">Item Code</th>
                  <th className="whitespace-nowrap px-5 py-3.5">Item Name</th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-center">
                    UOM
                  </th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-right">
                    Requested Qty
                  </th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-right">
                    Local Warehouse Stock
                  </th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-right">
                    Other Warehouse Stock
                  </th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-right">
                    Available Qty
                  </th>
                  <th className="whitespace-nowrap px-5 py-3.5">Best Source</th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-right">
                    Shortage
                  </th>
                  <th className="whitespace-nowrap px-5 py-3.5">Decision</th>
                  <th className="whitespace-nowrap px-5 py-3.5 text-center">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mrItems.map((item) => {
                  const d = itemDecisions[item.item_code];
                  const finalDecision = getFinalDecision(item.item_code);

                  if (!d) {
                    return (
                      <tr
                        key={item.item_code}
                        className="transition-colors hover:bg-slate-50/25"
                      >
                        <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-900">
                          {item.item_code}
                        </td>
                        <td
                          colSpan={10}
                          className="px-5 py-4 text-xs text-slate-400"
                        >
                          <span className="flex items-center gap-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Checking all warehouses…
                          </span>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={item.item_code}
                      className="transition-colors hover:bg-slate-50/25"
                    >
                      <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-900">
                        {item.item_code}
                      </td>
                      <td
                        className="max-w-[14rem] truncate px-5 py-4 text-slate-600"
                        title={item.description}
                      >
                        {item.description || item.item_code}
                      </td>
                      <td className="px-5 py-4 text-center text-slate-500">
                        {item.uom || "Nos"}
                      </td>
                      <td className="px-5 py-4 text-right font-medium tabular-nums text-slate-800">
                        {item.required_qty}
                      </td>

                      {/* Local Stores qty */}
                      <td
                        className={`px-5 py-4 text-right tabular-nums ${
                          d.localQty > 0 ? "text-emerald-700" : "text-slate-400"
                        }`}
                      >
                        {d.localQty}
                      </td>

                      {/* Other warehouses (total − local) */}
                      <td
                        className={`px-5 py-4 text-right tabular-nums ${
                          d.totalQty - d.localQty > 0
                            ? "text-slate-700"
                            : "text-slate-400"
                        }`}
                      >
                        {Math.max(0, d.totalQty - d.localQty)}
                      </td>

                      {/* Available across ALL warehouses */}
                      <td
                        className={`px-5 py-4 text-right font-bold tabular-nums ${
                          d.totalQty >= item.required_qty
                            ? "text-emerald-700"
                            : "text-rose-600"
                        }`}
                      >
                        {d.totalQty}
                      </td>

                      {/* Best source description */}
                      <td className="px-5 py-4 text-xs text-slate-600">
                        {finalDecision === "issue_local"
                          ? "Stores (local)"
                          : finalDecision === "issue_transfer"
                            ? `${d.bestWarehouse} (transfer needed)`
                            : "None"}
                      </td>

                      {/* Shortage */}
                      <td
                        className={`px-5 py-4 text-right font-bold tabular-nums ${
                          d.shortage > 0 ? "text-rose-600" : "text-slate-300"
                        }`}
                      >
                        {d.shortage > 0 ? d.shortage : "—"}
                      </td>

                      {/* Per-item decision override */}
                      <td className="px-5 py-4">
                        <select
                          value={itemActions[item.item_code] ?? d.decision}
                          onChange={(e) =>
                            setItemActions((prev) => ({
                              ...prev,
                              [item.item_code]: e.target
                                .value as ItemDecisionType,
                            }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
                        >
                          {d.canIssueLocally && (
                            <option value="issue_local">
                              Issue from Stores
                            </option>
                          )}
                          {d.canIssueWithTransfer && (
                            <option value="issue_transfer">
                              Transfer + Issue from {d.bestWarehouse}
                            </option>
                          )}
                          <option value="forward_procurement">
                            Forward to Procurement
                          </option>
                        </select>
                      </td>

                      <td className="px-5 py-4 text-center">
                        <DecisionBadge decision={finalDecision} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending review: summary + action buttons */}
      {isPendingReview && (
        <>
          {/* Decision Summary */}
          {decisionsReady && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="mb-3 text-sm font-bold text-slate-800">
                Decision Summary
              </p>
              <div className="space-y-2">
                {issueLocalItems.length > 0 && (
                  <p className="text-sm text-emerald-700">
                    ✅ {issueLocalItems.length} item(s) will be issued directly
                    from local Stores stock
                  </p>
                )}
                {issueTransferItems.length > 0 && (
                  <p className="text-sm text-blue-700">
                    🔄 {issueTransferItems.length} item(s) will be transferred
                    from another warehouse, then issued from Stores
                  </p>
                )}
                {procurementItems.length > 0 && (
                  <p className="text-sm text-rose-700">
                    📋 {procurementItems.length} item(s) will be forwarded to
                    Procurement (no stock anywhere — Purchase MR will be
                    created)
                  </p>
                )}
                {mrItems.length > 0 &&
                  issueLocalItems.length === 0 &&
                  issueTransferItems.length === 0 &&
                  procurementItems.length === 0 && (
                    <p className="text-sm text-slate-500">
                      Stock check in progress…
                    </p>
                  )}
              </div>
            </div>
          )}

          {/* Remarks + Confirm button */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <label
                htmlFor="warehouse-remarks"
                className="block text-sm font-semibold text-slate-700"
              >
                Warehouse Remarks{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                id="warehouse-remarks"
                value={warehouseRemarks}
                onChange={(e) => setWarehouseRemarks(e.target.value)}
                placeholder="Add notes saved with this material request…"
                rows={3}
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>

            {!checkingStock && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={
                    processing || !decisionsReady || rejectMutation.isPending
                  }
                  onClick={() => void handleProcessAll()}
                  style={{ background: "#2D6A4F" }}
                  className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {processing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Confirm &amp; Process All Decisions
                    </>
                  )}
                </button>

                <span
                  className="hidden h-9 w-px bg-slate-200 sm:block"
                  aria-hidden
                />

                <button
                  type="button"
                  disabled={processing || rejectMutation.isPending}
                  onClick={() => setShowRejectPanel((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 active:scale-95 disabled:opacity-40"
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </button>
              </div>
            )}

            {/* Inline reject panel */}
            {showRejectPanel && (
              <div className="mt-1 space-y-3 rounded-xl border border-rose-100 bg-rose-50/50 p-4 animate-in slide-in-from-top-1 duration-200">
                <p className="text-sm font-semibold text-rose-800">
                  Confirm Rejection
                </p>
                <p className="text-xs text-rose-600">
                  Remarks are required. The requesting department will see these
                  notes.
                </p>
                <textarea
                  value={rejectRemarks}
                  onChange={(e) => setRejectRemarks(e.target.value)}
                  placeholder="Reason for rejection…"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-rose-200 bg-white p-3 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={rejectMutation.isPending}
                    onClick={() => {
                      setShowRejectPanel(false);
                      setRejectRemarks("");
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!rejectRemarks.trim() || rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
                  >
                    {rejectMutation.isPending && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Confirm Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Read-only decision summary — shown immediately after processing */}
      {processedResult && (
        <div className="space-y-5 rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm animate-in fade-in duration-300">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Warehouse Decision Processed
              </h3>
              <p className="mt-0.5 text-sm font-semibold text-emerald-700">
                {processedResult.outcome === "issued"
                  ? "Material Issued Successfully"
                  : processedResult.outcome === "forwarded"
                    ? "Purchase Material Request Created"
                    : "Partially Issued and Remaining Items Forwarded to Procurement"}
              </p>
            </div>
          </div>

          <dl className="grid gap-x-6 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Items Issued
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800 tabular-nums">
                {processedResult.issuedItems} item(s)
                {processedResult.issuedItems > 0
                  ? ` · ${processedResult.issuedQty} qty`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Items Forwarded to Procurement
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800 tabular-nums">
                {processedResult.forwardedItems} item(s)
                {processedResult.forwardedItems > 0
                  ? ` · ${processedResult.forwardedQty} qty`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Processed By
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-800">
                {processedResult.processedBy}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Processed On
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-800">
                {new Date(processedResult.processedOn).toLocaleString()}
              </dd>
            </div>
            {processedResult.purchaseMR && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Purchase Material Request
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-800">
                  {processedResult.purchaseMR}
                </dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Remarks
              </dt>
              <dd className="mt-1 whitespace-pre-line text-sm text-slate-700">
                {processedResult.remarks || "—"}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
            <Link
              to="/warehouse/material-requests/pending"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 no-underline shadow-sm transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Pending Reviews
            </Link>
            <Link
              to={
                processedResult.outcome === "issued"
                  ? "/warehouse/material-requests/issued"
                  : "/warehouse/material-requests/forwarded"
              }
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white no-underline shadow-sm transition hover:opacity-90"
              style={{ background: "#2D6A4F" }}
            >
              {processedResult.outcome === "issued"
                ? "View Issued History"
                : "View Procurement Queue"}
            </Link>
          </div>
        </div>
      )}

      {/* Outcome card (re-opened, already-processed MR) */}
      {!isPendingReview && !processedResult && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {mr.status === "Material Issued" ? (
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Material Issued</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Stock Entries were submitted in ERPNext and inventory was
                  deducted.
                </p>
              </div>
            </div>
          ) : mr.status === "Procurement Required" ? (
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">
                  Procurement Required
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  A Purchase Material Request was created for items with
                  insufficient stock. Procurement will handle sourcing.
                </p>
              </div>
            </div>
          ) : mr.status === "Cancelled" ? (
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <XCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Request Rejected</h3>
                <p className="mt-1 text-sm text-slate-500">
                  This material request was rejected by the warehouse team.
                  Check warehouse remarks for the reason.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">
                  Status: {mr.status}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  This request is no longer pending warehouse review.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
