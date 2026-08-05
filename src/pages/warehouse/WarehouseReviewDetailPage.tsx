import { Fragment, useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Truck,
  XCircle,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

import StockDecisionAttachmentChip from "../../components/warehouse/StockDecisionAttachmentChip";
import {
  formatStockDecisionsTag,
  persistStockDecisionAudit,
  type StockDecisionAction,
  type StockDecisionAuditRow,
} from "../../api/stockDecisionAudit";
import {
  getMaterialRequestDetail,
  rejectMaterialRequest,
} from "../../services/warehouseService";
import {
  updateMaterialRequestWorkflowStatus,
  createWarehouseReview,
  forwardMaterialRequestToProcurement,
} from "../../api/materialRequestWorkflow";
import { apiPost } from "../../api/erpnext";
import {
  forwardToProcurement,
  invalidateForwardCaches,
} from "../../services/warehouseService";
import { AppLoading, EnterpriseError } from "../../components/enterprise";
import { sanitizeFrappeError } from "../../utils/friendlyError";
import { useAuthStore } from "../../store/authStore";
import { logMrWorkflowStage } from "../../utils/mrWorkflowDebug";
import { engineeringCustomFieldsForErp } from "../../utils/materialRequestItemFiles";
import { nonNegativeQty } from "../../utils/inventoryStock";
import { WAREHOUSE_POLICY } from "../../config/warehousePolicy";
import {
  assertCanIssueQuantity,
  buildWarehouseReviewAuditLines,
  computeIssueAndForwardQty,
  isIssueAction,
  resolveLineActionPlan,
  validateWarehouseLineAction,
  warehouseActionLabel,
} from "../../utils/warehouseStockActionRules";
import {
  assertMaterialRequestIsWarehouseCompany,
  assertNetlinkWarehouse,
  logWarehouseCompanyDiagnostics,
  resolveNetlinkIssueSourceWarehouse,
  resolveNetlinkStoresWarehouse,
  resolveNetlinkWarehouses,
  resolvePurchaseWarehouseForCompany,
  resolveWarehouseStockCompany,
} from "../../api/warehouseCompany";
import {
  applyCostCentersToStockEntryDoc,
  fetchMrItemCostCenters,
} from "../../api/stockEntryCostCenter";
import { createMaterialIssueReceipt } from "../../api/materialIssueReceipt";
import {
  fetchStockCheck,
  StockCheckApiError,
} from "../../api/stockCheck";
import {
  isWarehouseCompanyMismatchError,
  SELECTED_WAREHOUSE_OTHER_COMPANY_MESSAGE,
  WAREHOUSE_COMPANY_MISMATCH_REASON,
} from "../../utils/warehouseValidation";

function extractSavedDocName(saved: unknown): string | undefined {
  if (!saved || typeof saved !== "object") return undefined;
  const doc = saved as Record<string, unknown>;
  if (typeof doc.name === "string" && doc.name) return doc.name;
  const message = doc.message;
  if (message && typeof message === "object") {
    const inner = message as Record<string, unknown>;
    if (typeof inner.name === "string" && inner.name) return inner.name;
  }
  return undefined;
}

/** Per-line outcome after Process Selected (session-scoped). */
interface ProcessedLineResult {
  item_code: string;
  status: "issued" | "forwarded" | "forward_failed";
  reason?: string;
  reasonCode?: "warehouse_company_mismatch" | "other";
}

/** Read-only summary of a completed warehouse decision (session-scoped). */
interface ProcessedSummary {
  issuedItems: number;
  forwardedItems: number;
  failedItems: number;
  issuedQty: number;
  forwardedQty: number;
  processedBy: string;
  processedOn: string;
  remarks: string;
  outcome: "issued" | "forwarded" | "partial";
  purchaseMR?: string;
  lineResults: ProcessedLineResult[];
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BinRow {
  warehouse: string;
  actual_qty: number;
  reserved_qty: number;
  /** max(0, actual - reserved) — used for Available Qty / decisions. */
  available_qty: number;
}

type ItemDecisionType =
  "issue_local" | "issue_transfer" | "forward_procurement";

interface ItemStockResult {
  /** Total available across warehouses (never negative). */
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
  opts?: { mrName?: string },
): Promise<string> {
  // Cost Center must match Stock Entry company (never Main - B on Netlink).
  const mrCostCenters = opts?.mrName
    ? await fetchMrItemCostCenters(opts.mrName)
    : undefined;
  const costCenter = await applyCostCentersToStockEntryDoc(
    doc as {
      company?: string;
      cost_center?: string;
      from_warehouse?: string;
      items?: Array<Record<string, unknown>>;
    },
    { mrItemCostCenters: mrCostCenters },
  );
  const company = String(doc.company || "");
  const warehouse = String(
    doc.from_warehouse ||
      (Array.isArray(doc.items) &&
        (doc.items[0] as { s_warehouse?: string } | undefined)?.s_warehouse) ||
      "",
  );
  // eslint-disable-next-line no-console
  console.log("[Process Selected] Stock Entry before save", {
    company,
    costCenter,
    warehouse,
  });
  // eslint-disable-next-line no-console
  console.log("[Process Selected] Stock Entry ERP request", doc);
  // frappe.client.save lets ERPNext compute basic_rate, valuation_rate, etc.
  let saved: SEResponse;
  try {
    saved = await apiPost<SEResponse>("/api/method/frappe.client.save", {
      doc,
    });
  } catch (err) {
    const ax = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    // eslint-disable-next-line no-console
    console.error("[frappe.client.save] Material Issue failed — complete response", {
      status: ax.response?.status,
      completeResponse: ax.response?.data,
      message: ax.message,
      requestDoc: doc,
    });
    throw err;
  }
  // eslint-disable-next-line no-console
  console.log("[Process Selected] Stock Entry ERP save response", saved);
  const seName = saved?.name;
  if (!seName) {
    throw new Error(
      "Stock Entry creation failed — the server did not return a document name.",
    );
  }

  try {
    const submitted = await apiPost("/api/method/frappe.client.submit", {
      doc: saved,
    });
    // eslint-disable-next-line no-console
    console.log("[Process Selected] Stock Entry ERP submit response", {
      stock_entry: seName,
      submitted,
    });
  } catch (err) {
    const ax = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    // eslint-disable-next-line no-console
    console.error("[frappe.client.submit] Material Issue failed — complete response", {
      status: ax.response?.status,
      completeResponse: ax.response?.data,
      message: ax.message,
      stock_entry: seName,
    });
    throw err;
  }

  return seName;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function RecommendationBadge({
  availableQty,
  requestedQty,
  uom = "Nos",
  recommendation,
  bestWarehouse,
  localAvailableQty,
}: {
  availableQty: number;
  requestedQty: number;
  uom?: string;
  recommendation?:
    | "Issue Material"
    | "Stock available in another warehouse"
    | "Issue Partial Stock"
    | "Forward to Procurement";
  bestWarehouse?: string;
  localAvailableQty?: number;
}) {
  // availableQty is aggregated company stock (Inventory-aligned).
  const available = Math.max(0, Number(availableQty) || 0);
  const requested = Math.max(0, Number(requestedQty) || 0);
  const local = Math.max(0, Number(localAvailableQty) || 0);
  const shortage = Math.max(0, requested - available);
  const plan = resolveLineActionPlan(
    available,
    requested,
    WAREHOUSE_POLICY.partialIssuePolicy,
  );
  const stockElsewhere =
    recommendation === "Stock available in another warehouse" ||
    (shortage === 0 && local < requested && available >= requested);
  const noInventory = plan.stockCase === "none";
  const partialStock = plan.stockCase === "partial";

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {noInventory ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[12px] font-semibold text-rose-800">
          ⚠ No inventory available
        </span>
      ) : shortage === 0 && !stockElsewhere ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">
          ✅ Recommended: Ready to Issue
        </span>
      ) : stockElsewhere ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[12px] font-semibold text-sky-800">
          📦 Stock available in another warehouse
        </span>
      ) : partialStock ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-800">
          ⚠ Partial stock — issue available / forward remaining
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[12px] font-semibold text-orange-800">
          ⚠ Procurement Required
        </span>
      )}
      <span className="space-y-0.5 text-[11px] tabular-nums leading-snug text-slate-500">
        <span className="block">
          Requested: {requested} {uom}
        </span>
        <span className="block">
          Available (all warehouses): {available} {uom}
        </span>
        {stockElsewhere && bestWarehouse ? (
          <span className="block font-medium text-sky-700">
            Best source: {bestWarehouse}
          </span>
        ) : null}
        {noInventory ? (
          <span className="block font-medium text-rose-700">
            This request must be forwarded to Procurement.
          </span>
        ) : null}
        {partialStock ? (
          <span className="block font-medium text-amber-700">
            Issue {plan.issueQty} {uom} · Forward {plan.forwardQty} {uom}
          </span>
        ) : null}
        {shortage > 0 && !noInventory && !partialStock ? (
          <span className="block font-medium text-orange-700">
            Shortage: {shortage} {uom}
          </span>
        ) : null}
      </span>
    </span>
  );
}

type RowWorkflowStatus =
  | "ready_to_issue"
  | "sent_to_procurement"
  | "processing"
  | "issued"
  | "forwarded"
  | "forward_failed"
  | "completed";

function WorkflowStatusBadge({
  status,
  reason,
}: {
  status: RowWorkflowStatus;
  reason?: string;
}) {
  const map: Record<
    RowWorkflowStatus,
    { label: string; className: string }
  > = {
    ready_to_issue: {
      label: "Ready to Issue",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    sent_to_procurement: {
      // Pre-process: selected Forward action (not yet submitted).
      label: "Forward to Procurement",
      className: "border-orange-200 bg-orange-50 text-orange-800",
    },
    processing: {
      label: "Processing…",
      className: "border-slate-200 bg-slate-50 text-slate-600",
    },
    issued: {
      label: "Issued",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    forwarded: {
      label: "Forwarded",
      className: "border-slate-200 bg-slate-100 text-slate-700",
    },
    forward_failed: {
      label: "Forward Failed",
      className: "border-rose-200 bg-rose-50 text-rose-800",
    },
    completed: {
      label: "Completed",
      className: "border-slate-200 bg-slate-100 text-slate-700",
    },
  };
  const cfg = map[status];
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[12px] font-medium ${cfg.className}`}
      >
        {cfg.label}
      </span>
      {status === "forward_failed" && reason ? (
        <span className="text-[11px] font-medium text-rose-700">
          Reason: {reason}
        </span>
      ) : null}
    </span>
  );
}

/** Action control — only valid inventory actions are offered. */
function LineActionPicker({
  selected,
  allowedActions,
  disabled,
  menuOpen,
  fullWidth,
  onToggleMenu,
  onSelect,
}: {
  selected: StockDecisionAction;
  allowedActions: StockDecisionAction[];
  disabled?: boolean;
  menuOpen: boolean;
  fullWidth?: boolean;
  onToggleMenu: () => void;
  onSelect: (action: StockDecisionAction) => void;
}) {
  const actions =
    allowedActions.length > 0 ? allowedActions : (["forward"] as const);
  const active = actions.includes(selected) ? selected : actions[0]!;
  const isIssue = isIssueAction(active);
  const primaryClass = isIssue
    ? "bg-primary-600 hover:bg-primary-700 border-primary-500"
    : "bg-orange-500 hover:bg-orange-600 border-orange-400";
  const singleAction = actions.length === 1;

  if (singleAction) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(actions[0]!)}
        className={`inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${primaryClass} ${fullWidth ? "w-full" : ""}`}
      >
        {warehouseActionLabel(actions[0]!)}
      </button>
    );
  }

  return (
    <div className={`relative inline-flex ${fullWidth ? "w-full" : ""}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(active)}
        className={`inline-flex h-9 items-center justify-center rounded-l-lg px-3 text-[13px] font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${primaryClass} ${fullWidth ? "flex-1" : ""}`}
      >
        {warehouseActionLabel(active)}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggleMenu}
        className={`inline-flex h-9 items-center justify-center rounded-r-lg border-l px-2 text-white shadow-sm transition disabled:opacity-60 ${primaryClass}`}
        aria-label="More actions"
        aria-expanded={menuOpen}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {menuOpen ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {actions.map((action) => {
            const issueLike = isIssueAction(action);
            return (
              <button
                key={action}
                type="button"
                className={`flex w-full px-3 py-2 text-left text-[13px] font-medium hover:bg-slate-50 ${
                  active === action
                    ? issueLike
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-orange-50 text-orange-800"
                    : issueLike
                      ? "text-slate-700"
                      : "text-orange-700"
                }`}
                onClick={() => onSelect(action)}
              >
                {action === "forward" && actions.includes("issue_partial")
                  ? "Forward Entire Request"
                  : warehouseActionLabel(action)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface ItemActionSelection {
  action: StockDecisionAction;
  recommended: StockDecisionAction;
  reason?: string;
  selectedAt: string;
  selectedBy: string;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-[13px] font-medium text-slate-700">{value}</p>
    </div>
  );
}

function MrStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    "Under Warehouse Review": "border-amber-200 bg-amber-50 text-amber-800",
    "Stock Available": "border-teal-200 bg-teal-50 text-teal-800",
    "Material Issued": "border-emerald-200 bg-emerald-50 text-emerald-800",
    "Pending Department Acceptance":
      "border-amber-200 bg-amber-50 text-amber-800",
    "Procurement Required":
      "border-orange-200 bg-orange-50 text-orange-800",
    "Forwarded to Procurement":
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

  /** Optional warehouse remark per item (saved with that line only). */
  const [itemRemarks, setItemRemarks] = useState<Record<string, string>>({});
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [returnRemarks, setReturnRemarks] = useState("");

  // Per-item multi-warehouse stock check results
  const [itemDecisions, setItemDecisions] = useState<
    Record<string, ItemStockResult>
  >({});
  const [checkingStock, setCheckingStock] = useState(false);
  /** Set when stock API fails — stops spinner and shows Retry. */
  const [stockCheckError, setStockCheckError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  /** Per-item recommendation + manual override selection. */
  const [itemSelections, setItemSelections] = useState<
    Record<string, ItemActionSelection>
  >({});
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);
  const [forwardDialog, setForwardDialog] = useState<{
    itemCode: string;
    hasAvailableStock: boolean;
  } | null>(null);
  const [forwardReason, setForwardReason] = useState("");
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
    // Review page runs its own Stock Decision check — skip nested stock pass.
    queryFn: () =>
      getMaterialRequestDetail(mrNumber ?? "", { includeStockCheck: false }),
    enabled: !!mrNumber,
  });

  const mr = detailQuery.data;
  const mrItems = mr?.items ?? [];

  // ── Load stock across ALL warehouses for each item ───────────────────────────
  // ── Per-item multi-warehouse stock check ───────────────────────────────────────

  const emptyDecision = (requestedQty: number): ItemStockResult => ({
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
  });

  // Shared logic for both the auto-effect and the manual Refresh button.
  // All setState calls are inside the async callback — never synchronously
  // at the top level of the effect — to satisfy the React Compiler rule.
  const runStockCheck = () => {
    if (!mrItems.length) return;

    void (async () => {
      setCheckingStock(true);
      setStockCheckError(null);
      setItemDecisions({});

      const actor =
        currentUser?.full_name ||
        currentUser?.email ||
        currentUser?.name ||
        "Warehouse";

      try {
        // Stock company = Netlink when MR.company is Bidsphere (common ERP default).
        // Do not hard-block Review — that was the regression.
        const companyCtx = resolveWarehouseStockCompany(mr?.company);
        const stockCompany = companyCtx.stockCompany;
        const companyWarehouses = await resolveNetlinkWarehouses(stockCompany);
        const preferredWarehouse =
          (await resolveNetlinkStoresWarehouse(stockCompany)) ||
          companyWarehouses.find((w) => /stores\s*-\s*nsgai/i.test(w)) ||
          companyWarehouses[0] ||
          "";

        if (!preferredWarehouse) {
          throw new StockCheckApiError(
            "Warehouse Stores - NSGAI not found.",
            404,
            "warehouse_not_found",
          );
        }

        await logWarehouseCompanyDiagnostics({
          mrNumber: mr?.name || mrNumber,
          mrCompany: companyCtx.mrCompany,
          warehouse: preferredWarehouse,
          user: actor,
        });

        const payload = {
          mr_number: mr?.name || mrNumber || "",
          company: stockCompany,
          mr_company: companyCtx.mrCompany,
          warehouse: preferredWarehouse,
          warehouses: companyWarehouses,
          items: mrItems.map((i) => ({
            item_code: i.item_code,
            requested_qty: Number(i.required_qty) || 0,
            mr_warehouse: i.warehouse || undefined,
          })),
          user: actor,
        };

        // eslint-disable-next-line no-console
        console.log("[StockDecision] Calling /api/stock-check", {
          ...payload,
          selectedWarehouse: preferredWarehouse,
          inventoryScope: "all company warehouses (aggregated)",
        });
        if (companyCtx.notice) {
          // eslint-disable-next-line no-console
          console.info("[StockDecision] Company notice:", companyCtx.notice);
        }

        const result = await fetchStockCheck(payload);
        if (result.notice) {
          // eslint-disable-next-line no-console
          console.info("[StockDecision] Backend company notice:", result.notice);
        }

        const results: Record<string, ItemStockResult> = {};
        const selections: Record<string, ItemActionSelection> = {};
        const selectedAt = new Date().toISOString();

        for (const line of result.lines) {
          const available = nonNegativeQty(line.available_qty);
          const localQty = nonNegativeQty(
            line.local_available_qty ??
              line.by_warehouse?.find((b) => b.warehouse === line.warehouse)
                ?.available_qty,
          );
          const shortage = nonNegativeQty(line.shortage_qty);
          const requested = nonNegativeQty(line.requested_qty);
          const bestWarehouse = line.best_warehouse || line.warehouse;
          const bestWarehouseQty = nonNegativeQty(
            line.best_warehouse_qty ?? available,
          );
          const canIssueLocally = localQty + 1e-9 >= requested;
          const canIssueWithTransfer =
            !canIssueLocally && available + 1e-9 >= requested;
          const cannotFulfill = !canIssueLocally && !canIssueWithTransfer;

          // eslint-disable-next-line no-console
          console.log("[StockDecision] Line mapped", {
            item_code: line.item_code,
            selectedWarehouse: line.warehouse,
            warehouseFromMR: line.mr_warehouse,
            warehouseFromItem: line.item_default_warehouse,
            erpAvailableQty: available,
            localAvailableQty: localQty,
            erpWarehouseName: bestWarehouse,
            by_warehouse: line.by_warehouse,
            recommendation: line.recommendation,
          });

          results[line.item_code] = {
            totalQty: available,
            localQty,
            bestWarehouse,
            bestWarehouseQty,
            allBins: (line.by_warehouse || []).map((b) => ({
              warehouse: b.warehouse,
              actual_qty: b.available_qty,
              reserved_qty: b.reserved_qty,
              available_qty: b.available_qty,
            })),
            canIssueLocally,
            canIssueWithTransfer,
            cannotFulfill,
            shortage,
            decision: canIssueLocally
              ? "issue_local"
              : canIssueWithTransfer
                ? "issue_transfer"
                : "forward_procurement",
          };
          // Business rules: issue / issue_partial / forward based on availability.
          const plan = resolveLineActionPlan(
            available,
            requested,
            WAREHOUSE_POLICY.partialIssuePolicy,
          );
          const recommended: StockDecisionAction = plan.defaultAction;
          selections[line.item_code] = {
            action: recommended,
            recommended,
            selectedAt,
            selectedBy: actor,
          };
        }

        // Ensure every MR line has a decision row even if API omitted it.
        for (const item of mrItems) {
          if (!results[item.item_code]) {
            results[item.item_code] = emptyDecision(item.required_qty);
            selections[item.item_code] = {
              action: "forward",
              recommended: "forward",
              selectedAt,
              selectedBy: actor,
            };
          }
        }

        setStockCheckError(null);
        setItemDecisions(results);
        setItemSelections(selections);
      } catch (err) {
        const msg =
          err instanceof StockCheckApiError || err instanceof Error
            ? err.message
            : "Unable to fetch stock availability.";
        // eslint-disable-next-line no-console
        console.error("[StockDecision] Stock check failed", err);
        setStockCheckError(msg);
        const fallback: Record<string, ItemStockResult> = {};
        for (const item of mrItems) {
          fallback[item.item_code] = emptyDecision(item.required_qty);
        }
        setItemDecisions(fallback);
        toast.error(msg);
      } finally {
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

  const getLinePlan = (itemCode: string, requestedQty: number) => {
    const d = itemDecisions[itemCode];
    const available = Math.max(0, d?.totalQty ?? 0);
    return resolveLineActionPlan(
      available,
      requestedQty,
      WAREHOUSE_POLICY.partialIssuePolicy,
    );
  };

  const getRecommendedAction = (
    itemCode: string,
    requestedQty: number,
  ): StockDecisionAction => getLinePlan(itemCode, requestedQty).defaultAction;

  const getSelectedAction = (
    itemCode: string,
    requestedQty: number,
  ): StockDecisionAction => {
    const plan = getLinePlan(itemCode, requestedQty);
    const selected =
      itemSelections[itemCode]?.action ?? getRecommendedAction(itemCode, requestedQty);
    return plan.allowedActions.includes(selected)
      ? selected
      : plan.defaultAction;
  };

  /**
   * Maps the user's selected action to an ERP processing path.
   * Issue actions with zero availability are forced to forward.
   */
  const getFinalDecision = (itemCode: string): ItemDecisionType => {
    const item = mrItems.find((i) => i.item_code === itemCode);
    const requestedQty = item?.required_qty ?? 0;
    const selected = getSelectedAction(itemCode, requestedQty);
    const d = itemDecisions[itemCode];
    const available = Math.max(0, d?.totalQty ?? 0);
    if (selected === "forward" || available <= 0) return "forward_procurement";
    if (d?.canIssueLocally || selected === "issue_partial") {
      // Partial issues from aggregate stock use the best available source path.
      return d?.canIssueLocally ? "issue_local" : "issue_transfer";
    }
    // Full issue from another warehouse (transfer) or best available source.
    return d?.canIssueWithTransfer ? "issue_transfer" : "issue_local";
  };

  const getLineProcessResult = (
    itemCode: string,
  ): ProcessedLineResult | undefined =>
    processedResult?.lineResults?.find((r) => r.item_code === itemCode);

  const getRowWorkflowStatus = (
    itemCode: string,
    requestedQty: number,
  ): RowWorkflowStatus => {
    if (processing) return "processing";
    const line = getLineProcessResult(itemCode);
    if (line) {
      if (line.status === "issued") return "issued";
      if (line.status === "forwarded") return "forwarded";
      if (line.status === "forward_failed") return "forward_failed";
    }
    const selected = getSelectedAction(itemCode, requestedQty);
    if (processedResult) {
      // Fallback if lineResults missing — never mark failed forward as Issued.
      if (isIssueAction(selected)) return "issued";
      return "forward_failed";
    }
    if (mr?.status === "Material Issued" || mr?.status === "Completed") {
      return "completed";
    }
    // Per-line workflow follows the current selected action (not MR-level status),
    // so mixed Issue + Forward selections display correctly before Process.
    return isIssueAction(selected) ? "ready_to_issue" : "sent_to_procurement";
  };

  const buildAuditRows = (
    selections: Record<string, ItemActionSelection> = itemSelections,
  ): StockDecisionAuditRow[] =>
    mrItems.map((item) => {
      const sel = selections[item.item_code];
      const recommended = getRecommendedAction(
        item.item_code,
        item.required_qty,
      );
      return {
        item_code: item.item_code,
        recommended_action: sel?.recommended ?? recommended,
        selected_action: sel?.action ?? recommended,
        selected_by:
          sel?.selectedBy ||
          currentUser?.full_name ||
          currentUser?.email ||
          currentUser?.name ||
          "Warehouse",
        selected_at: sel?.selectedAt || new Date().toISOString(),
        reason: sel?.reason,
      };
    });

  const applyItemSelection = (
    itemCode: string,
    action: StockDecisionAction,
    reason?: string,
  ) => {
    const item = mrItems.find((i) => i.item_code === itemCode);
    const requestedQty = item?.required_qty ?? 0;
    const available = Math.max(0, itemDecisions[itemCode]?.totalQty ?? 0);
    const validationError = validateWarehouseLineAction(
      available,
      requestedQty,
      action,
      WAREHOUSE_POLICY.partialIssuePolicy,
    );
    if (validationError) {
      toast.error(validationError);
      setActionMenuOpen(null);
      return;
    }
    const recommended = getRecommendedAction(itemCode, requestedQty);
    const actor =
      currentUser?.full_name ||
      currentUser?.email ||
      currentUser?.name ||
      "Warehouse";
    const selectedAt = new Date().toISOString();
    const next = {
      ...itemSelections,
      [itemCode]: {
        action,
        recommended,
        reason: reason?.trim() || undefined,
        selectedAt,
        selectedBy: actor,
      },
    };
    setItemSelections(next);
    setActionMenuOpen(null);
    void persistStockDecisionAudit(mrNumber ?? "", buildAuditRows(next));
  };

  const requestForwardSelection = (itemCode: string, requestedQty: number) => {
    const plan = getLinePlan(itemCode, requestedQty);
    // Asking for a reason only when overriding full-stock Issue → Forward.
    if (
      plan.stockCase === "full" &&
      plan.allowedActions.includes("forward") === false
    ) {
      // Case 1: Forward is hidden — do not allow override.
      toast.error(
        "Stock is fully available. Use Issue Material for this line.",
      );
      setActionMenuOpen(null);
      return;
    }
    if (plan.stockCase === "partial" && plan.defaultAction === "issue_partial") {
      // Option A: forwarding entire request is allowed without override reason.
      applyItemSelection(itemCode, "forward");
      return;
    }
    applyItemSelection(itemCode, "forward");
  };

  const confirmForwardDialog = () => {
    if (!forwardDialog) return;
    applyItemSelection(
      forwardDialog.itemCode,
      "forward",
      forwardReason.trim() || undefined,
    );
    setForwardDialog(null);
    setForwardReason("");
  };

  const toggleRowExpanded = (itemCode: string) => {
    setExpandedRows((prev) => ({ ...prev, [itemCode]: !prev[itemCode] }));
  };

  const decisionsReady =
    !checkingStock &&
    mrItems.length > 0 &&
    Object.keys(itemDecisions).length >= mrItems.length;

  // Footer + Process Selected group by validated selected actions.
  const issueSelectedItems = mrItems.filter((i) =>
    isIssueAction(getSelectedAction(i.item_code, i.required_qty)),
  );
  const procurementItems = mrItems.filter((i) => {
    const action = getSelectedAction(i.item_code, i.required_qty);
    const available = Math.max(0, itemDecisions[i.item_code]?.totalQty ?? 0);
    const { forwardQty } = computeIssueAndForwardQty(
      available,
      i.required_qty,
      action,
    );
    return forwardQty > 0;
  });
  const issueLocalItems = issueSelectedItems.filter(
    (i) => getFinalDecision(i.item_code) === "issue_local",
  );
  const issueTransferItems = issueSelectedItems.filter(
    (i) => getFinalDecision(i.item_code) === "issue_transfer",
  );

  // ── Reject mutation ──────────────────────────────────────────────────────────

  const composeItemRemarks = () =>
    mrItems
      .map((item) => {
        const note = itemRemarks[item.item_code]?.trim();
        if (!note) return null;
        return `${item.item_code}: ${note}`;
      })
      .filter(Boolean)
      .join("\n");

  const rejectMutation = useMutation({
    mutationFn: () => rejectMaterialRequest(mrNumber ?? "", returnRemarks),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouse"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-dashboard-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-procurement-queue"] });
      toast.success("Material request returned to requester.");
      setShowReturnDialog(false);
      setReturnRemarks("");
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

  /**
   * Legacy MRs stuck on "Procurement Required" (old two-step flow): one Confirm
   * click forwards them — same final action label, no second Send button.
   */
  const handleLegacyForwardOnly = async () => {
    if (!mrNumber || processing || processedResult) return;
    setProcessing(true);
    try {
      const forwardedBy =
        currentUser?.full_name ||
        currentUser?.email ||
        currentUser?.name ||
        "Warehouse";
      await forwardToProcurement(mrNumber, forwardedBy);
      invalidateForwardCaches(queryClient);
      void queryClient.invalidateQueries({
        queryKey: ["warehouse", "mr-detail", mrNumber],
      });
      void queryClient.invalidateQueries({
        queryKey: ["material-request-workflow", mrNumber],
      });
      void queryClient.refetchQueries({ queryKey: ["mr-procurement-queue"] });
      setProcessedResult({
        issuedItems: 0,
        forwardedItems: mrItems.length,
        failedItems: 0,
        issuedQty: 0,
        forwardedQty: mrItems.reduce((s, i) => s + i.required_qty, 0),
        processedBy: forwardedBy,
        processedOn: new Date().toISOString(),
        remarks: composeItemRemarks(),
        outcome: "forwarded",
        lineResults: mrItems.map((i) => ({
          item_code: i.item_code,
          status: "forwarded" as const,
        })),
      });
      toast.success(`${mrNumber} forwarded to the Procurement Queue.`);
    } catch (err: unknown) {
      toast.error(
        sanitizeFrappeError(
          err,
          "Unable to forward this Material Request. Please try again.",
          "WarehouseReview.legacyForward",
        ).message,
      );
    } finally {
      setProcessing(false);
    }
  };

  // ── Process all decisions ────────────────────────────────────────────────────

  const handleProcessAll = async () => {
    if (!mrNumber || !mr) return;
    // Never process the same Material Request twice.
    if (processing || processedResult) return;

    // Pre-validate every line against live decision qty before any ERP write.
    for (const item of mrItems) {
      const available = Math.max(0, itemDecisions[item.item_code]?.totalQty ?? 0);
      const selected = getSelectedAction(item.item_code, item.required_qty);
      const validationError = validateWarehouseLineAction(
        available,
        item.required_qty,
        selected,
        WAREHOUSE_POLICY.partialIssuePolicy,
      );
      if (validationError) {
        toast.error(`${item.item_code}: ${validationError}`);
        return;
      }
      const { issueQty } = computeIssueAndForwardQty(
        available,
        item.required_qty,
        selected,
      );
      try {
        assertCanIssueQuantity(item.item_code, available, issueQty);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    setProcessing(true);

    const today = new Date().toISOString().split("T")[0];
    const createdStockEntries: string[] = [];
    let newProcurementMR: string | undefined;
    const failedItems: Array<{ item_code: string; reason: string }> = [];
    let issuedOk = false;
    let forwardedOk = false;

    const qtyFor = (itemCode: string, requested: number) => {
      const available = Math.max(0, itemDecisions[itemCode]?.totalQty ?? 0);
      const selected = getSelectedAction(itemCode, requested);
      return computeIssueAndForwardQty(available, requested, selected);
    };

    // Snapshot groups from current selections (do not re-read mid-process).
    // Drop any issue selection that resolved to zero qty (defensive).
    const localIssue = issueLocalItems.filter(
      (i) => qtyFor(i.item_code, i.required_qty).issueQty > 0,
    );
    const transferIssue = issueTransferItems.filter(
      (i) => qtyFor(i.item_code, i.required_qty).issueQty > 0,
    );
    const forwardLines = procurementItems.filter(
      (i) => qtyFor(i.item_code, i.required_qty).forwardQty > 0,
    );

    const processPayload = mrItems.map((item) => {
      const d = itemDecisions[item.item_code];
      const selected = getSelectedAction(item.item_code, item.required_qty);
      const available = Math.max(0, d?.totalQty ?? 0);
      const { issueQty, forwardQty } = qtyFor(item.item_code, item.required_qty);
      const shortage = Math.max(0, (Number(item.required_qty) || 0) - available);
      const recommendation = warehouseActionLabel(
        getRecommendedAction(item.item_code, item.required_qty),
      );
      return {
        item_code: item.item_code,
        selected_action: warehouseActionLabel(selected),
        available_qty: available,
        shortage_qty: shortage,
        issue_qty: issueQty,
        forward_qty: forwardQty,
        recommendation,
        process_path: getFinalDecision(item.item_code),
      };
    });

    // Required pre-submit log shape (also includes process_path for debugging).
    // eslint-disable-next-line no-console
    console.log(
      "[Process Selected] request payload",
      processPayload.map(
        ({
          item_code,
          selected_action,
          available_qty,
          shortage_qty,
          recommendation,
        }) => ({
          item_code,
          selected_action,
          available_qty,
          shortage_qty,
          recommendation,
        }),
      ),
    );
    // eslint-disable-next-line no-console
    console.log("[Process Selected] full request payload", processPayload);
    // eslint-disable-next-line no-console
    console.log("[Process Selected] groups", {
      issueLocal: localIssue.map((i) => i.item_code),
      issueTransfer: transferIssue.map((i) => i.item_code),
      forward: forwardLines.map((i) => i.item_code),
    });

    try {
      // Netlink only — never Company Bidsphere warehouses.
      const mrCompany = assertMaterialRequestIsWarehouseCompany(mr.company);
      const companyWarehouses = await resolveNetlinkWarehouses(mrCompany);
      const preferredWarehouse =
        (await resolveNetlinkStoresWarehouse(mrCompany)) ||
        companyWarehouses[0] ||
        "";

      if (!preferredWarehouse) {
        throw new Error(
          `No warehouse found for Company ${mrCompany}. ` +
            `Configure Finished Goods / Stores under Company ${mrCompany}.`,
        );
      }

      // Pre-resolve Netlink source warehouses (Finished Goods preferred when stocked).
      // Use planned issue qty (not full requested) so partial stock can resolve.
      const sourceByItem = new Map<string, string>();
      for (const item of [...localIssue, ...transferIssue]) {
        try {
          const issueQty = qtyFor(item.item_code, item.required_qty).issueQty;
          const sourceWh = await resolveNetlinkIssueSourceWarehouse(
            item.item_code,
            issueQty,
          );
          sourceByItem.set(item.item_code, sourceWh);
          await assertNetlinkWarehouse(sourceWh, "Source");
        } catch (srcErr) {
          const reason =
            srcErr instanceof Error
              ? srcErr.message
              : "Failed to resolve source warehouse.";
          failedItems.push({ item_code: item.item_code, reason });
        }
      }

      const localIssueReady = localIssue.filter(
        (i) => !failedItems.some((f) => f.item_code === i.item_code),
      );
      const transferIssueReady = transferIssue.filter(
        (i) => !failedItems.some((f) => f.item_code === i.item_code),
      );

      if (transferIssueReady.length > 0) {
        await assertNetlinkWarehouse(preferredWarehouse, "Target");
      }

      // ─── Branch A: Issue from Netlink warehouse (dynamic, never Bidsphere) ───
      if (localIssueReady.length > 0) {
        try {
          const doc = {
            doctype: "Stock Entry",
            stock_entry_type: "Material Issue",
            purpose: "Material Issue",
            company: mrCompany,
            posting_date: today,
            items: localIssueReady.map((item) => {
              const sourceWh =
                sourceByItem.get(item.item_code) || preferredWarehouse;
              const issueQty = qtyFor(item.item_code, item.required_qty).issueQty;
              assertCanIssueQuantity(
                item.item_code,
                itemDecisions[item.item_code]?.totalQty ?? 0,
                issueQty,
              );
              return {
                doctype: "Stock Entry Detail",
                item_code: item.item_code,
                qty: issueQty,
                s_warehouse: sourceWh,
                uom: item.uom || "Nos",
                stock_uom: item.uom || "Nos",
                conversion_factor: 1,
              };
            }),
          };

          // eslint-disable-next-line no-console
          console.log("[Process Selected] Issue Material ERP request", doc);
          const seName = await createAndSubmitStockEntry(doc, {
            mrName: mrNumber,
          });
          // eslint-disable-next-line no-console
          console.log("[Process Selected] Issue Material ERP response", {
            stock_entry: seName,
          });
          createdStockEntries.push(seName);
          issuedOk = true;
          const localAudit = buildWarehouseReviewAuditLines(
            localIssueReady.map((item) => ({
              item_code: item.item_code,
              available_qty: Math.max(
                0,
                itemDecisions[item.item_code]?.totalQty ?? 0,
              ),
              requested_qty: item.required_qty,
              action: getSelectedAction(item.item_code, item.required_qty),
              uom: item.uom || "Nos",
            })),
          );
          await addMRComment(
            mrNumber,
            `${localAudit.join(" ")} Stock Entry: ${seName}`,
          );
          toast.success(
            `✅ ${localIssueReady.length} item(s) issued (${seName})`,
          );
        } catch (issueErr) {
          const reason =
            issueErr instanceof Error
              ? issueErr.message
              : "Material Issue failed.";
          // eslint-disable-next-line no-console
          console.error("[Process Selected] Issue Material failed", issueErr);
          for (const item of localIssueReady) {
            failedItems.push({ item_code: item.item_code, reason });
          }
        }
      }

      // ─── Branch B: Transfer Netlink WH → Netlink Stores (dynamic), then issue
      if (transferIssueReady.length > 0) {
        const sources = transferIssueReady
          .map((i) => sourceByItem.get(i.item_code))
          .filter(Boolean)
          .join(", ");

        const storesWarehouse = preferredWarehouse;

        try {
          const transferDoc = {
            doctype: "Stock Entry",
            stock_entry_type: "Material Transfer",
            purpose: "Material Transfer",
            company: mrCompany,
            posting_date: today,
            items: transferIssueReady.map((item) => {
              const sourceWh =
                sourceByItem.get(item.item_code) || preferredWarehouse;
              const issueQty = qtyFor(item.item_code, item.required_qty).issueQty;
              assertCanIssueQuantity(
                item.item_code,
                itemDecisions[item.item_code]?.totalQty ?? 0,
                issueQty,
              );
              return {
                doctype: "Stock Entry Detail",
                item_code: item.item_code,
                qty: issueQty,
                s_warehouse: sourceWh,
                t_warehouse: storesWarehouse,
                uom: item.uom || "Nos",
                stock_uom: item.uom || "Nos",
                conversion_factor: 1,
              };
            }),
          };

          // eslint-disable-next-line no-console
          console.log("[Process Selected] Transfer ERP request", transferDoc);
          const transferSEName = await createAndSubmitStockEntry(transferDoc, {
            mrName: mrNumber,
          });
          createdStockEntries.push(transferSEName);

          toast(
            `Step 1 ✔ Transfer SE ${transferSEName} submitted. Starting issue step…`,
            { icon: "🔄" },
          );

          const issueDoc = {
            doctype: "Stock Entry",
            stock_entry_type: "Material Issue",
            purpose: "Material Issue",
            company: mrCompany,
            posting_date: today,
            items: transferIssueReady.map((item) => {
              const issueQty = qtyFor(item.item_code, item.required_qty).issueQty;
              return {
                doctype: "Stock Entry Detail",
                item_code: item.item_code,
                qty: issueQty,
                s_warehouse: storesWarehouse,
                uom: item.uom || "Nos",
                stock_uom: item.uom || "Nos",
                conversion_factor: 1,
              };
            }),
          };

          // eslint-disable-next-line no-console
          console.log(
            "[Process Selected] Transfer→Issue ERP request",
            issueDoc,
          );
          const issueSEName = await createAndSubmitStockEntry(issueDoc, {
            mrName: mrNumber,
          });
          createdStockEntries.push(issueSEName);
          issuedOk = true;

          await addMRComment(
            mrNumber,
            `Transfer + Issue completed for ${transferIssueReady.length} item(s). ` +
              `Source: [${sources}]. ` +
              `Transfer SE: ${transferSEName}. Issue SE: ${issueSEName}.`,
          );
          toast.success(
            `🔄 ${transferIssueReady.length} item(s) transferred and issued (Transfer: ${transferSEName} / Issue: ${issueSEName})`,
          );
        } catch (transferErr) {
          const reason =
            transferErr instanceof Error
              ? transferErr.message
              : "Transfer/Issue failed.";
          // eslint-disable-next-line no-console
          console.error(
            "[Process Selected] Transfer/Issue failed (no rollback of other successes)",
            transferErr,
          );
          for (const item of transferIssueReady) {
            failedItems.push({ item_code: item.item_code, reason });
          }
        }
      }

      // ─── Branch C: Purchase MR for shortfall + forward to Procurement ──────
      const forwardedBy =
        currentUser?.full_name ||
        currentUser?.email ||
        currentUser?.name ||
        "Warehouse";
      // Purchase warehouse must belong to stock company (never "Stores - B").
      let forwardWarehouse = preferredWarehouse;

      if (forwardLines.length > 0) {
        try {
          // Resolve once for the Purchase MR — validate company before ERP save.
          const purchaseWh = await resolvePurchaseWarehouseForCompany({
            mrCompany: mr.company,
            candidateWarehouse:
              forwardLines.find((i) => i.warehouse)?.warehouse ||
              preferredWarehouse,
            itemCode: forwardLines[0]?.item_code,
          });
          forwardWarehouse = purchaseWh.warehouse;

          // eslint-disable-next-line no-console
          console.log("[Process Selected] Purchase warehouse resolved", {
            materialRequestCompany: mr.company,
            stockCompany: mrCompany,
            selectedWarehouse: purchaseWh.warehouse,
            warehouseCompany: purchaseWh.warehouseCompany,
            purchaseWarehouse: purchaseWh.warehouse,
            why: purchaseWh.reason,
            rejectedCandidate: purchaseWh.rejectedCandidate || null,
            rejectedCandidateCompany:
              purchaseWh.rejectedCandidateCompany || null,
          });

          if (purchaseWh.warehouseCompany !== mrCompany) {
            throw new Error(SELECTED_WAREHOUSE_OTHER_COMPANY_MESSAGE);
          }

          const purchaseMRDoc = {
            doctype: "Material Request",
            material_request_type: "Purchase",
            custom_bidsphere_status: "Draft",
            custom_procurement_type: mr.procurement_type,
            custom_request_mode: mr.request_mode,
            custom_department: mr.department,
            custom_priority: mr.priority,
            custom_requested_by: mr.requested_by,
            transaction_date: today,
            schedule_date: today,
            company: mrCompany,
            items: forwardLines.map((item, idx) => {
              // Carry Department engineering attachment URL refs onto the Purchase
              // MR (no File re-upload). RFQ / Supplier resolve these same URLs.
              const eng = engineeringCustomFieldsForErp({
                part_name: item.part_name,
                drawing_2d_url: item.drawing_2d_url,
                attachments: item.attachments,
              });
              const { forwardQty } = qtyFor(item.item_code, item.required_qty);
              return {
                doctype: "Material Request Item",
                idx: idx + 1,
                item_code: item.item_code,
                item_name: item.description || item.item_code,
                description: `${item.description || item.item_code} [Shortfall from ${mrNumber}]`,
                qty: forwardQty,
                uom: item.uom || "Nos",
                stock_uom: item.uom || "Nos",
                conversion_factor: 1,
                schedule_date: today,
                // Always use company-validated purchase warehouse — never MR
                // item warehouse when it belongs to another company.
                warehouse: forwardWarehouse,
                ...eng,
              };
            }),
          };

          // eslint-disable-next-line no-console
          console.log("[Process Selected] ERP Request Payload", {
            materialRequestCompany: mr.company,
            stockCompany: mrCompany,
            selectedWarehouse: forwardWarehouse,
            warehouseCompany: purchaseWh.warehouseCompany,
            purchaseWarehouse: forwardWarehouse,
            payload: purchaseMRDoc,
          });

          const purchaseMR = await apiPost<MRResponse>(
            "/api/method/frappe.client.save",
            { doc: purchaseMRDoc },
          );
          // eslint-disable-next-line no-console
          console.log(
            "[Process Selected] Forward Purchase MR ERP response",
            purchaseMR,
          );
          newProcurementMR = extractSavedDocName(purchaseMR);
          if (!newProcurementMR) {
            throw new Error("Purchase Material Request was not created.");
          }
          logMrWorkflowStage("Warehouse Review → Purchase MR created", {
            name: newProcurementMR,
            material_request_type: "Purchase",
            custom_bidsphere_status: "Draft",
            docstatus: 0,
          });
        } catch (createErr) {
          // Do NOT roll back successful Issue Material stock entries.
          const raw =
            createErr instanceof Error ? createErr.message : String(createErr);
          const msg = isWarehouseCompanyMismatchError(raw)
            ? SELECTED_WAREHOUSE_OTHER_COMPANY_MESSAGE
            : raw;
          // eslint-disable-next-line no-console
          console.error(
            "[Process Selected] Purchase MR create failed (keeping issued stock)",
            {
              error: createErr,
              userMessage: msg,
              materialRequestCompany: mr.company,
              stockCompany: mrCompany,
              selectedWarehouse: forwardWarehouse,
            },
          );
          for (const item of forwardLines) {
            failedItems.push({
              item_code: item.item_code,
              reason: msg,
            });
          }
        }

        if (newProcurementMR) {
          await addMRComment(
            mrNumber,
            `${forwardLines.length} item(s) short — Purchase MR ${newProcurementMR} created and forwarded to Procurement.`,
          );
          await addMRComment(
            newProcurementMR,
            `Created from warehouse review of ${mrNumber}. Automatically forwarded to the Procurement Queue.`,
          );
        }
      }

      const forwardSucceeded =
        forwardLines.length > 0 &&
        Boolean(newProcurementMR) &&
        forwardLines.every(
          (i) => !failedItems.some((f) => f.item_code === i.item_code),
        );

      if (forwardSucceeded && newProcurementMR) {
        // Single final step: forward to Procurement Queue + history + audit.
        // No intermediate "Procurement Required" / second Send click.
        const forwardingData = JSON.stringify(
          forwardLines.map((item) => {
            const d = itemDecisions[item.item_code];
            const available = Math.max(0, d?.totalQty ?? 0);
            const requested = Number(item.required_qty) || 0;
            const { issueQty, forwardQty } = qtyFor(item.item_code, requested);
            const shortage = Math.max(0, requested - available);
            return {
              item_code: item.item_code,
              item_name: item.description || item.item_code,
              requested_qty: requested,
              available_qty: available,
              shortage_qty: shortage,
              issued_qty: issueQty,
              /* Forward remaining shortage (or full qty when zero stock / Option B). */
              forward_qty: forwardQty,
              uom: item.uom || "Nos",
              warehouse: item.warehouse || forwardWarehouse || "",
              warehouse_remark: itemRemarks[item.item_code]?.trim() || undefined,
            };
          }),
        );
        const forwardAudit = buildWarehouseReviewAuditLines(
          forwardLines.map((item) => ({
            item_code: item.item_code,
            available_qty: Math.max(
              0,
              itemDecisions[item.item_code]?.totalQty ?? 0,
            ),
            requested_qty: item.required_qty,
            action: getSelectedAction(item.item_code, item.required_qty),
            uom: item.uom || "Nos",
          })),
        );
        await addMRComment(mrNumber, forwardAudit.join(" "));
        const auditRows = buildAuditRows();
        const remarksLines = [
          composeItemRemarks(),
          newProcurementMR
            ? `Purchase MR for shortfall: ${newProcurementMR}`
            : "",
          `[BidSphere:ForwardedItems:${forwardingData}]`,
          formatStockDecisionsTag(auditRows),
        ].filter(Boolean);
        const remarksText = remarksLines.join("\n");

        try {
          await persistStockDecisionAudit(mrNumber, auditRows);
          if (issuedOk) {
            await createWarehouseReview({
              material_request: mrNumber,
              warehouse_remarks: remarksText,
              decision: "Partially Issued",
              issued_qty:
                localIssue
                  .filter(
                    (i) =>
                      !failedItems.some((f) => f.item_code === i.item_code),
                  )
                  .reduce(
                    (sum, i) =>
                      sum + qtyFor(i.item_code, i.required_qty).issueQty,
                    0,
                  ) +
                transferIssue
                  .filter(
                    (i) =>
                      !failedItems.some((f) => f.item_code === i.item_code),
                  )
                  .reduce(
                    (sum, i) =>
                      sum + qtyFor(i.item_code, i.required_qty).issueQty,
                    0,
                  ),
              forwarded_qty: forwardLines.reduce(
                (sum, i) =>
                  sum + qtyFor(i.item_code, i.required_qty).forwardQty,
                0,
              ),
              warehouse_user: forwardedBy,
            });
          }

          await forwardMaterialRequestToProcurement(mrNumber, remarksText, {
            forwardedBy,
            skipStockCheck: true,
          });
          forwardedOk = true;
          logMrWorkflowStage(
            "Warehouse Review → Forwarded to Procurement (single step)",
            { name: mrNumber, purchaseMR: newProcurementMR },
          );
          toast.success(
            newProcurementMR
              ? `${forwardLines.length} item(s) forwarded to Procurement — Purchase MR ${newProcurementMR} created.`
              : `${forwardLines.length} item(s) forwarded to the Procurement Queue.`,
          );
        } catch (forwardErr) {
          // Keep successful issues — do not cancel Stock Entries.
          const msg =
            forwardErr instanceof Error
              ? forwardErr.message
              : "Failed to forward Material Request to Procurement.";
          // eslint-disable-next-line no-console
          console.error(
            "[Process Selected] Forward failed (keeping issued items)",
            forwardErr,
          );
          for (const item of forwardLines) {
            if (!failedItems.some((f) => f.item_code === item.item_code)) {
              failedItems.push({ item_code: item.item_code, reason: msg });
            }
          }
        }
      } else if (issuedOk && !forwardSucceeded) {
        // Finalize successful Issue lines even when Forward failed (partial).
        const auditRows = buildAuditRows();
        const failNotes = failedItems
          .map((f) => `${f.item_code}: ${f.reason}`)
          .join("; ");
        const remarksText = [
          composeItemRemarks(),
          formatStockDecisionsTag(auditRows),
          failNotes
            ? `Forward failed (issued items kept): ${failNotes}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
        const issuedItems = [...localIssue, ...transferIssue].filter(
          (i) => !failedItems.some((f) => f.item_code === i.item_code),
        );
        const issuedQty = issuedItems.reduce(
          (sum, i) => sum + qtyFor(i.item_code, i.required_qty).issueQty,
          0,
        );
        // Prefer the last Material Issue Stock Entry (not the transfer).
        const issueStockEntry =
          createdStockEntries[createdStockEntries.length - 1] || "";
        try {
          await persistStockDecisionAudit(mrNumber, auditRows);
          await createWarehouseReview({
            material_request: mrNumber,
            warehouse_remarks: remarksText || undefined,
            decision:
              forwardLines.length > 0 ? "Partially Issued" : "Material Issued",
            issued_qty: issuedQty,
          });

          // Issue-only success → MIR + navigate. Partial (forward failed) stays
          // on this page so Forward Failed workflow is visible for AP003 etc.
          if (
            issueStockEntry &&
            issuedItems.length > 0 &&
            forwardLines.length === 0
          ) {
            const preferredWh =
              (await resolveNetlinkStoresWarehouse(mrCompany)) ||
              (await resolveNetlinkWarehouses(mrCompany))[0] ||
              "";
            const receipt = await createMaterialIssueReceipt({
              stock_entry: issueStockEntry,
              mr_name: mrNumber,
              department: mr.department || "General",
              warehouse: preferredWh,
              issued_by:
                currentUser?.full_name ||
                currentUser?.email ||
                currentUser?.name ||
                "Warehouse",
              receiver: "Department User",
              issue_type: "Full Issue",
              remarks: remarksText,
              lines: issuedItems.map((i) => ({
                item_code: i.item_code,
                item_name: i.description || i.item_code,
                required_qty: i.required_qty,
                issued_qty: i.required_qty,
                uom: i.uom || "Nos",
              })),
            });
            invalidateForwardCaches(queryClient);
            void queryClient.invalidateQueries({ queryKey: ["warehouse"] });
            void queryClient.invalidateQueries({
              queryKey: ["material-issue-receipts"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["department-issued-items"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["mr-dashboard-rows"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["material-request"],
            });
            toast.success(
              `Material Issue Receipt ${receipt.issue_number} created — sign to continue.`,
            );
            navigate(
              `/warehouse/material-issue-receipts/${encodeURIComponent(receipt.issue_number)}`,
            );
            return;
          }

          await updateMaterialRequestWorkflowStatus(
            mrNumber,
            "Pending Department Acceptance",
            { custom_warehouse_remarks: remarksText || undefined },
          );
        } catch (statusErr) {
          // Keep submitted Stock Entries — do not roll them back.
          const msg =
            statusErr instanceof Error
              ? statusErr.message
              : "Failed to create Material Issue Receipt.";
          // eslint-disable-next-line no-console
          console.error(
            "[Process Selected] Post-issue status/receipt failed",
            statusErr,
          );
          toast.error(msg);
        }
      }

      // eslint-disable-next-line no-console
      console.log("[Process Selected] result summary", {
        issuedOk,
        forwardedOk,
        failedItems,
        stockEntries: createdStockEntries,
        purchaseMR: newProcurementMR,
      });

      if (failedItems.length > 0) {
        const detail = failedItems
          .map((f) => `${f.item_code}: ${f.reason}`)
          .join(" | ");
        toast.error(
          issuedOk || forwardedOk
            ? `Partial success. Failed: ${detail}`
            : `Process failed. ${detail}`,
        );
      }

      if (!issuedOk && !forwardedOk) {
        if (failedItems.length === 0) {
          toast.error("Nothing was processed. Check item actions and retry.");
        }
        return;
      }

      // Invalidate every MR-related cache so Warehouse + Procurement refresh.
      invalidateForwardCaches(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["mr-dashboard-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-dashboard-counts"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-dashboard-recent"] });
      void queryClient.invalidateQueries({ queryKey: ["mr-issued"] });
      void queryClient.invalidateQueries({
        queryKey: ["warehouse", "procurement-required-persisted"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["warehouse", "pending-requests"],
      });
      if (mrNumber) {
        void queryClient.invalidateQueries({
          queryKey: ["material-request-workflow", mrNumber],
        });
        void queryClient.invalidateQueries({
          queryKey: ["warehouse", "mr-detail", mrNumber],
        });
      }
      if (newProcurementMR) {
        void queryClient.invalidateQueries({
          queryKey: ["material-request-workflow", newProcurementMR],
        });
      }
      // Force procurement queue refetch immediately (don't wait for observers).
      void queryClient.refetchQueries({ queryKey: ["mr-procurement-queue"] });
      void queryClient.refetchQueries({ queryKey: ["warehouse"] });

      const successfulIssue = [...localIssue, ...transferIssue].filter(
        (i) => !failedItems.some((f) => f.item_code === i.item_code),
      );
      const successfulForward = forwardLines.filter(
        (i) => !failedItems.some((f) => f.item_code === i.item_code),
      );
      const failedForward = forwardLines.filter((i) =>
        failedItems.some((f) => f.item_code === i.item_code),
      );
      const issuedQty = successfulIssue.reduce(
        (sum, i) => sum + i.required_qty,
        0,
      );
      const forwardedQty = successfulForward.reduce(
        (sum, i) => sum + i.required_qty,
        0,
      );
      const lineResults: ProcessedLineResult[] = [
        ...successfulIssue.map((i) => ({
          item_code: i.item_code,
          status: "issued" as const,
        })),
        ...successfulForward.map((i) => ({
          item_code: i.item_code,
          status: "forwarded" as const,
        })),
        ...failedForward.map((i) => {
          const fail = failedItems.find((f) => f.item_code === i.item_code);
          const mismatch = isWarehouseCompanyMismatchError(fail?.reason || "");
          return {
            item_code: i.item_code,
            status: "forward_failed" as const,
            reason: mismatch
              ? WAREHOUSE_COMPANY_MISMATCH_REASON
              : fail?.reason || "Forward failed",
            reasonCode: mismatch
              ? ("warehouse_company_mismatch" as const)
              : ("other" as const),
          };
        }),
      ];

      // eslint-disable-next-line no-console
      console.log("[Process Selected] success/failure summary", {
        issued: successfulIssue.map((i) => i.item_code),
        forwarded: successfulForward.map((i) => i.item_code),
        failed: failedItems,
        lineResults,
        purchaseMR: newProcurementMR,
      });

      setProcessedResult({
        issuedItems: successfulIssue.length,
        forwardedItems: successfulForward.length,
        failedItems: failedItems.length,
        issuedQty,
        forwardedQty,
        processedBy:
          currentUser?.full_name ||
          currentUser?.email ||
          currentUser?.name ||
          "Warehouse",
        processedOn: new Date().toISOString(),
        remarks: composeItemRemarks(),
        outcome:
          successfulIssue.length > 0 &&
          (successfulForward.length > 0 || failedForward.length > 0)
            ? "partial"
            : successfulForward.length > 0
              ? "forwarded"
              : "issued",
        purchaseMR: newProcurementMR,
        lineResults,
      });
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Process Selected] unexpected failure", err);
      const raw =
        err instanceof Error
          ? err.message
          : "Unable to process selected warehouse decisions.";
      // Prefer the concrete message; only sanitize obvious Frappe tracebacks.
      const safe = /Traceback|frappe\.exceptions|pymysql/i.test(raw)
        ? sanitizeFrappeError(
            err,
            "Unable to process selected warehouse decisions. Please try again.",
            "WarehouseReview.handleProcessAll",
          ).message
        : raw;
      toast.error(safe);
    } finally {
      setProcessing(false);
    }
  };

  // ── Loading / Error guards ────────────────────────────────────────────────────

  if (detailQuery.isLoading) {
    return <AppLoading variant="document" />;
  }

  if (detailQuery.isError || !mr) {
    return (
      <EnterpriseError
        error={detailQuery.error ?? new Error("not found")}
        onRetry={() => void detailQuery.refetch()}
        onBack={() => window.history.back()}
      />
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
    <div className="flex w-full flex-col gap-6 animate-in fade-in duration-300">
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
      <div className="overflow-hidden rounded-[12px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              Stock Decision Grid
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              System recommends an action from stock. Override when needed, then
              confirm processing below.
            </p>
          </div>
          {(decisionsReady || stockCheckError) && isPendingReview && (
            <button
              type="button"
              onClick={runStockCheck}
              disabled={processing || checkingStock}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {stockCheckError ? "Retry" : "Refresh Stock"}
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
        ) : stockCheckError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-semibold text-slate-800">
              Unable to fetch stock availability
            </p>
            <p className="max-w-lg text-sm font-medium text-rose-700">
              ❌ {stockCheckError}
            </p>
            <p className="max-w-md text-xs text-slate-500">
              Fix the issue above, then retry. Server logs show STOCK CHECK /
              ERP REQUEST / ERP RESPONSE details.
            </p>
            <button
              type="button"
              onClick={runStockCheck}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        ) : mrItems.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-500">
            No items found in this material request.
          </div>
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead className="sticky top-0 z-[1]">
                  <tr className="border-b border-slate-200 bg-slate-50 text-[13px] font-semibold text-slate-600">
                    <th className="w-8 px-3 py-3" aria-label="Expand" />
                    <th className="px-3 py-3">Item</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right">
                      Requested Qty
                    </th>
                    <th className="whitespace-nowrap px-3 py-3 text-right">
                      Available Qty
                    </th>
                    <th className="whitespace-nowrap px-3 py-3 text-right">
                      Shortage Qty
                    </th>
                    <th className="whitespace-nowrap px-3 py-3">
                      Recommendation
                    </th>
                    <th className="whitespace-nowrap px-3 py-3">Action</th>
                    <th className="whitespace-nowrap px-3 py-3">
                      Current Workflow
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mrItems.map((item) => {
                    const d = itemDecisions[item.item_code];
                    const expanded = !!expandedRows[item.item_code];
                    const availableQty = Math.max(0, d?.totalQty ?? 0);
                    const shortageQty = Math.max(
                      0,
                      (Number(item.required_qty) || 0) - availableQty,
                    );
                    const stockEnough = d ? shortageQty === 0 : false;
                    const selected = getSelectedAction(
                      item.item_code,
                      item.required_qty,
                    );
                    const workflow = getRowWorkflowStatus(
                      item.item_code,
                      item.required_qty,
                    );
                    const lineResult = getLineProcessResult(item.item_code);
                    const finalDecision = getFinalDecision(item.item_code);
                    const otherQty = d
                      ? Math.max(0, availableQty - Math.max(0, d.localQty))
                      : 0;
                    const bestSource =
                      finalDecision === "issue_local"
                        ? "Stores (local)"
                        : finalDecision === "issue_transfer"
                          ? `${d?.bestWarehouse || "—"} (transfer needed)`
                          : "None — forward to Procurement";
                    const menuOpen = actionMenuOpen === item.item_code;
                    const selection = itemSelections[item.item_code];

                    if (!d) {
                      return (
                        <tr key={item.item_code} className="min-h-[56px]">
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2">
                            <p className="font-mono text-[13px] font-semibold text-slate-900">
                              {item.item_code}
                            </p>
                            <p className="truncate text-[14px] text-slate-600">
                              {item.description || item.item_code}
                            </p>
                          </td>
                          <td
                            colSpan={5}
                            className="px-3 py-2 text-[13px] text-slate-500"
                          >
                            {checkingStock ? (
                              <span className="inline-flex items-center gap-2 text-slate-400">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Checking stock…
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-2 text-amber-700">
                                Stock unavailable — use Retry above.
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <Fragment key={item.item_code}>
                        <tr className="min-h-[56px] transition-colors hover:bg-slate-50/80">
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => toggleRowExpanded(item.item_code)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              aria-expanded={expanded}
                              aria-label={
                                expanded ? "Collapse details" : "Expand details"
                              }
                            >
                              {expanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                          <td className="max-w-[220px] px-3 py-2">
                            <p className="font-mono text-[13px] font-semibold text-slate-900">
                              {item.item_code}
                            </p>
                            <p
                              className="truncate text-[14px] text-slate-700"
                              title={item.description}
                            >
                              {item.description || item.item_code}
                            </p>
                            {item.part_name?.trim() ? (
                              <p
                                className="mt-0.5 truncate text-[12px] text-slate-500"
                                title={item.part_name}
                              >
                                Part: {item.part_name}
                              </p>
                            ) : null}
                            <div className="mt-1.5">
                              <StockDecisionAttachmentChip
                                url={item.drawing_2d_url}
                                attachments={item.attachments}
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className="text-[15px] font-semibold tabular-nums text-slate-800">
                              {item.required_qty}
                            </span>
                            <span className="ml-1 text-[12px] text-slate-400">
                              {item.uom || "Nos"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span
                              className={`text-[15px] font-semibold tabular-nums ${
                                stockEnough
                                  ? "text-emerald-700"
                                  : "text-orange-700"
                              }`}
                            >
                              {d ? availableQty : "—"}
                            </span>
                            {d ? (
                              <span className="ml-1 text-[12px] text-slate-400">
                                {item.uom || "Nos"}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {d && shortageQty > 0 ? (
                              <>
                                <span className="text-[15px] font-semibold tabular-nums text-orange-700">
                                  {shortageQty}
                                </span>
                                <span className="ml-1 text-[12px] text-slate-400">
                                  {item.uom || "Nos"}
                                </span>
                              </>
                            ) : (
                              <span className="text-[13px] text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {d ? (
                              <RecommendationBadge
                                availableQty={availableQty}
                                requestedQty={item.required_qty}
                                uom={item.uom || "Nos"}
                                localAvailableQty={d.localQty}
                                bestWarehouse={d.bestWarehouse}
                                recommendation={
                                  d.canIssueLocally
                                    ? "Issue Material"
                                    : d.canIssueWithTransfer
                                      ? "Stock available in another warehouse"
                                      : getLinePlan(
                                            item.item_code,
                                            item.required_qty,
                                          ).stockCase === "partial"
                                        ? "Issue Partial Stock"
                                        : "Forward to Procurement"
                                }
                              />
                            ) : (
                              <span className="text-[12px] text-slate-400">
                                Checking…
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isPendingReview ? (
                              <div className="space-y-1.5">
                                <LineActionPicker
                                  selected={selected}
                                  allowedActions={getLinePlan(
                                    item.item_code,
                                    item.required_qty,
                                  ).allowedActions}
                                  disabled={processing || !decisionsReady}
                                  menuOpen={menuOpen}
                                  onToggleMenu={() =>
                                    setActionMenuOpen((prev) =>
                                      prev === item.item_code
                                        ? null
                                        : item.item_code,
                                    )
                                  }
                                  onSelect={(action) => {
                                    if (action === "forward") {
                                      requestForwardSelection(
                                        item.item_code,
                                        item.required_qty,
                                      );
                                      return;
                                    }
                                    applyItemSelection(item.item_code, action);
                                  }}
                                />
                                {availableQty <= 0 ? (
                                  <p className="text-[11px] font-medium text-rose-700">
                                    ⚠ No inventory available. This request must
                                    be forwarded to Procurement.
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-[12px] text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <WorkflowStatusBadge
                              status={workflow}
                              reason={lineResult?.reason}
                            />
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={7} className="px-5 py-4">
                              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                <DetailField
                                  label="Local Warehouse Stock"
                                  value={String(d.localQty)}
                                />
                                <DetailField
                                  label="Other Warehouse Stock"
                                  value={String(otherQty)}
                                />
                                <DetailField
                                  label="Best Source"
                                  value={bestSource}
                                />
                                <DetailField
                                  label="Selected Action"
                                  value={warehouseActionLabel(selected)}
                                />
                                <DetailField
                                  label="Override Reason"
                                  value={selection?.reason?.trim() || "—"}
                                />
                                <div className="sm:col-span-2 lg:col-span-1">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    Attachment Preview
                                  </p>
                                  <div className="mt-1.5">
                                    <StockDecisionAttachmentChip
                                      url={item.drawing_2d_url}
                                      attachments={item.attachments}
                                    />
                                  </div>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <label
                                    htmlFor={`wh-remark-${item.item_code}`}
                                    className="text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                                  >
                                    Warehouse Remark{" "}
                                    <span className="normal-case font-normal">
                                      (optional)
                                    </span>
                                  </label>
                                  <textarea
                                    id={`wh-remark-${item.item_code}`}
                                    value={itemRemarks[item.item_code] ?? ""}
                                    onChange={(e) =>
                                      setItemRemarks((prev) => ({
                                        ...prev,
                                        [item.item_code]: e.target.value,
                                      }))
                                    }
                                    rows={2}
                                    disabled={!isPendingReview || processing}
                                    placeholder="Note for this item only…"
                                    className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50"
                                  />
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    Audit History
                                  </p>
                                  <ul className="mt-1.5 space-y-1 text-[13px] text-slate-600">
                                    <li>
                                      Stock checked — Local{" "}
                                      {Math.max(0, d.localQty)}, Other{" "}
                                      {otherQty}, Available{" "}
                                      {Math.max(0, d.totalQty)}
                                      {d.shortage > 0
                                        ? `, Shortage ${d.shortage}`
                                        : ""}
                                    </li>
                                    <li>
                                      Recommended:{" "}
                                      {stockEnough
                                        ? "Issue from Warehouse"
                                        : "Procurement Required"}
                                    </li>
                                    <li>
                                      Selected: {warehouseActionLabel(selected)}
                                      {selection?.selectedBy
                                        ? ` by ${selection.selectedBy}`
                                        : ""}
                                    </li>
                                    {processedResult && (
                                      <li>
                                        Processed by {processedResult.processedBy}{" "}
                                        on{" "}
                                        {new Date(
                                          processedResult.processedOn,
                                        ).toLocaleString()}
                                      </li>
                                    )}
                                  </ul>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 p-4 md:hidden">
              {mrItems.map((item) => {
                const d = itemDecisions[item.item_code];
                const expanded = !!expandedRows[item.item_code];
                const availableQty = Math.max(0, d?.totalQty ?? 0);
                const shortageQty = Math.max(
                  0,
                  (Number(item.required_qty) || 0) - availableQty,
                );
                const stockEnough = d ? shortageQty === 0 : false;
                const selected = getSelectedAction(
                  item.item_code,
                  item.required_qty,
                );
                const workflow = getRowWorkflowStatus(
                  item.item_code,
                  item.required_qty,
                );
                const lineResult = getLineProcessResult(item.item_code);
                const finalDecision = getFinalDecision(item.item_code);
                const otherQty = d
                  ? Math.max(0, availableQty - Math.max(0, d.localQty))
                  : 0;
                const bestSource =
                  finalDecision === "issue_local"
                    ? "Stores (local)"
                    : finalDecision === "issue_transfer"
                      ? `${d?.bestWarehouse || "—"} (transfer needed)`
                      : "None — forward to Procurement";
                const menuOpen = actionMenuOpen === item.item_code;

                return (
                  <div
                    key={item.item_code}
                    className="rounded-[12px] border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-[13px] font-semibold text-slate-900">
                          {item.item_code}
                        </p>
                        <p className="text-[14px] text-slate-700">
                          {item.description || item.item_code}
                        </p>
                        {item.part_name?.trim() ? (
                          <p className="mt-0.5 text-[12px] text-slate-500">
                            Part: {item.part_name}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleRowExpanded(item.item_code)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                        aria-expanded={expanded}
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] font-semibold text-slate-400">
                          Requested
                        </p>
                        <p className="text-[15px] font-semibold tabular-nums text-slate-800">
                          {item.required_qty}{" "}
                          <span className="text-[12px] font-normal text-slate-400">
                            {item.uom || "Nos"}
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-slate-400">
                          Available
                        </p>
                        <p
                          className={`text-[15px] font-semibold tabular-nums ${
                            stockEnough ? "text-emerald-700" : "text-orange-700"
                          }`}
                        >
                          {d ? availableQty : "—"}{" "}
                          {d ? (
                            <span className="text-[12px] font-normal text-slate-400">
                              {item.uom || "Nos"}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      {d && shortageQty > 0 ? (
                        <div className="col-span-2">
                          <p className="text-[11px] font-semibold text-slate-400">
                            Shortage
                          </p>
                          <p className="text-[15px] font-semibold tabular-nums text-orange-700">
                            {shortageQty}{" "}
                            <span className="text-[12px] font-normal text-slate-400">
                              {item.uom || "Nos"}
                            </span>
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {d ? (
                        <RecommendationBadge
                          availableQty={availableQty}
                          requestedQty={item.required_qty}
                          uom={item.uom || "Nos"}
                          localAvailableQty={d.localQty}
                          bestWarehouse={d.bestWarehouse}
                          recommendation={
                            d.canIssueLocally
                              ? "Issue Material"
                              : d.canIssueWithTransfer
                                ? "Stock available in another warehouse"
                                : getLinePlan(
                                      item.item_code,
                                      item.required_qty,
                                    ).stockCase === "partial"
                                  ? "Issue Partial Stock"
                                  : "Forward to Procurement"
                          }
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[12px] text-slate-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Checking…
                        </span>
                      )}
                      <WorkflowStatusBadge
                        status={workflow}
                        reason={lineResult?.reason}
                      />
                    </div>

                    <div className="mt-3">
                      <StockDecisionAttachmentChip
                        url={item.drawing_2d_url}
                        attachments={item.attachments}
                      />
                    </div>

                    {isPendingReview && d && (
                      <div className="relative mt-3 space-y-2">
                        <LineActionPicker
                          selected={selected}
                          allowedActions={getLinePlan(
                            item.item_code,
                            item.required_qty,
                          ).allowedActions}
                          disabled={processing || !decisionsReady}
                          menuOpen={menuOpen}
                          fullWidth
                          onToggleMenu={() =>
                            setActionMenuOpen((prev) =>
                              prev === item.item_code ? null : item.item_code,
                            )
                          }
                          onSelect={(action) => {
                            if (action === "forward") {
                              requestForwardSelection(
                                item.item_code,
                                item.required_qty,
                              );
                              return;
                            }
                            applyItemSelection(item.item_code, action);
                          }}
                        />
                        {availableQty <= 0 ? (
                          <p className="text-[11px] font-medium text-rose-700">
                            ⚠ No inventory available. This request must be
                            forwarded to Procurement.
                          </p>
                        ) : null}
                        <p className="text-[11px] text-slate-500">
                          Selected: {warehouseActionLabel(selected)}
                        </p>
                      </div>
                    )}

                    {expanded && d && (
                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        <DetailField
                          label="Local Warehouse Stock"
                          value={String(d.localQty)}
                        />
                        <DetailField
                          label="Other Warehouse Stock"
                          value={String(otherQty)}
                        />
                        <DetailField label="Best Source" value={bestSource} />
                        <DetailField
                          label="Selected Action"
                          value={warehouseActionLabel(selected)}
                        />
                        <div>
                          <label
                            htmlFor={`wh-remark-m-${item.item_code}`}
                            className="text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                          >
                            Warehouse Remark{" "}
                            <span className="normal-case font-normal">
                              (optional)
                            </span>
                          </label>
                          <textarea
                            id={`wh-remark-m-${item.item_code}`}
                            value={itemRemarks[item.item_code] ?? ""}
                            onChange={(e) =>
                              setItemRemarks((prev) => ({
                                ...prev,
                                [item.item_code]: e.target.value,
                              }))
                            }
                            rows={2}
                            disabled={!isPendingReview || processing}
                            placeholder="Note for this item only…"
                            className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50"
                          />
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Audit History
                          </p>
                          <p className="mt-1 text-[13px] text-slate-600">
                            Recommended:{" "}
                            {warehouseActionLabel(
                              getRecommendedAction(
                                item.item_code,
                                item.required_qty,
                              ),
                            )}
                            . Selected: {warehouseActionLabel(selected)}.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {forwardDialog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
            onClick={() => {
              setForwardDialog(null);
              setForwardReason("");
            }}
          />
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-bold text-slate-900">
                Forward Material Request?
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
                This request has available stock but will be forwarded to
                Procurement instead of issuing from Warehouse.
              </p>
            </div>
            <div className="px-5 py-4">
              <label
                htmlFor="forward-override-reason"
                className="block text-[13px] font-semibold text-slate-700"
              >
                Reason{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                id="forward-override-reason"
                value={forwardReason}
                onChange={(e) => setForwardReason(e.target.value)}
                rows={3}
                placeholder="Why are you forwarding despite available stock?"
                className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setForwardDialog(null);
                  setForwardReason("");
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmForwardDialog}
                className="rounded-lg bg-orange-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-orange-600"
              >
                Forward
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky bottom action bar — pending decisions only */}
      {isPendingReview && decisionsReady && !checkingStock && (
        <>
          <div className="h-16" aria-hidden />
          <div className="sticky bottom-0 z-30 -mx-1 border border-b-0 border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur supports-[backdrop-filter]:bg-white/90 rounded-t-xl">
            <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
                <span className="font-semibold tabular-nums text-slate-800">
                  Selected Items: {mrItems.length}
                </span>
                <span className="tabular-nums text-emerald-700">
                  Issue / Partial: {issueSelectedItems.length}
                </span>
                <span className="tabular-nums text-orange-700">
                  Forward: {procurementItems.length}
                </span>
                {import.meta.env.DEV ? (
                  <span className="hidden text-[10px] text-slate-400 lg:inline">
                    (
                    {mrItems
                      .map(
                        (i) =>
                          `${i.item_code}=${getSelectedAction(i.item_code, i.required_qty)}`,
                      )
                      .join(", ")}
                    )
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={processing || rejectMutation.isPending}
                  onClick={() =>
                    navigate("/warehouse/material-requests/pending")
                  }
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={processing || rejectMutation.isPending}
                  onClick={() => setShowReturnDialog(true)}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Return to Requester
                </button>
                <button
                  type="button"
                  disabled={
                    processing || !decisionsReady || rejectMutation.isPending
                  }
                  onClick={() => void handleProcessAll()}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {processing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Processing…
                    </>
                  ) : (
                    "Process Selected"
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {showReturnDialog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
            onClick={() => {
              if (rejectMutation.isPending) return;
              setShowReturnDialog(false);
              setReturnRemarks("");
            }}
          />
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-bold text-slate-900">
                Return to Requester?
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
                This Material Request will be returned to the requesting
                department. A reason is required.
              </p>
            </div>
            <div className="px-5 py-4">
              <label
                htmlFor="return-to-requester-reason"
                className="block text-[13px] font-semibold text-slate-700"
              >
                Reason <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="return-to-requester-reason"
                value={returnRemarks}
                onChange={(e) => setReturnRemarks(e.target.value)}
                rows={3}
                placeholder="Why is this being returned?"
                className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                disabled={rejectMutation.isPending}
                onClick={() => {
                  setShowReturnDialog(false);
                  setReturnRemarks("");
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!returnRemarks.trim() || rejectMutation.isPending}
                onClick={() => rejectMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {rejectMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Return to Requester
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Read-only decision summary — shown immediately after processing */}
      {processedResult && (
        <div
          className={`space-y-5 rounded-2xl border bg-white p-6 shadow-sm animate-in fade-in duration-300 ${
            processedResult.failedItems > 0
              ? "border-amber-200"
              : "border-emerald-200"
          }`}
        >
          <div className="flex items-start gap-4">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                processedResult.failedItems > 0
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-600"
              }`}
            >
              {processedResult.failedItems > 0 ? (
                <AlertTriangle className="h-6 w-6" />
              ) : (
                <CheckCircle2 className="h-6 w-6" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Warehouse Decision Processed
              </h3>
              <p
                className={`mt-0.5 text-sm font-semibold ${
                  processedResult.failedItems > 0
                    ? "text-amber-700"
                    : "text-emerald-700"
                }`}
              >
                {processedResult.failedItems > 0
                  ? "Partial success — some items failed"
                  : processedResult.outcome === "issued"
                    ? "Material Issued Successfully"
                    : processedResult.outcome === "forwarded"
                      ? "Shortage Items Forwarded to Procurement"
                      : "Partially Issued — Remaining Items Forwarded to Procurement"}
              </p>
            </div>
          </div>

          <ul className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
            {processedResult.lineResults.map((line) => (
              <li
                key={line.item_code}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
              >
                <span className="font-mono font-semibold text-slate-900">
                  {line.item_code}
                </span>
                <span
                  className={
                    line.status === "issued"
                      ? "font-semibold text-emerald-700"
                      : line.status === "forwarded"
                        ? "font-semibold text-indigo-700"
                        : "font-semibold text-rose-700"
                  }
                >
                  {line.status === "issued"
                    ? "Issued"
                    : line.status === "forwarded"
                      ? "Forwarded"
                      : "Forward Failed"}
                </span>
                {line.reason ? (
                  <span className="text-rose-700">· Reason: {line.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>

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
                {processedResult.failedItems > 0
                  ? ` · ${processedResult.failedItems} failed`
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
                {(() => {
                  const d = processedResult.processedOn
                    ? new Date(processedResult.processedOn)
                    : null;
                  return d && !Number.isNaN(d.getTime())
                    ? d.toLocaleString()
                    : "—";
                })()}
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
                  : "/warehouse/material-requests/history"
              }
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white no-underline shadow-sm transition hover:opacity-90"
              style={{ background: "#2D6A4F" }}
            >
              {processedResult.outcome === "issued"
                ? "View Issued History"
                : "View Forwarded History"}
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
                  Stock entries were submitted and inventory was
                  deducted.
                </p>
              </div>
            </div>
          ) : mr.status === "Procurement Required" ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                <Truck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-slate-800">
                  Awaiting Final Warehouse Processing
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Shortage was recorded earlier. Confirm below to forward this
                  request to the Procurement Queue in one step — no separate
                  Send action.
                </p>
                <button
                  type="button"
                  disabled={processing}
                  onClick={() => void handleLegacyForwardOnly()}
                  className="mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {processing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Processing…
                    </>
                  ) : (
                    "Process Selected"
                  )}
                </button>
              </div>
            </div>
          ) : mr.status === "Forwarded to Procurement" ? (
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">
                  Forwarded to Procurement
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  This request has been sent to Procurement, which will handle
                  sourcing.
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
