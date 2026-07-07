import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Package,
  Pencil,
  Send,
  Trash2,
  Truck,
  XCircle,
} from "lucide-react";

import {
  approveIndirectMaterialRequest,
  checkMaterialRequestStock,
  completeMaterialRequest,
  deleteMaterialRequestWorkflow,
  fetchMaterialRequestWorkflow,
  forwardMaterialRequestToProcurement,
  getMaterialRequestProcurementProgress,
  getMaterialRequestProcurementType,
  getMaterialRequestWorkflowStatus,
  getUserFullName,
  isMaterialRequestOwnedByUser,
  issueMaterialRequest,
  markMaterialRequestStockAvailable,
  rejectIndirectMaterialRequest,
  rejectMaterialRequest,
  submitMaterialRequestWorkflow,
  type MaterialRequestProcurementProgress,
  type MaterialRequestWorkflowRecord,
} from "../../api/materialRequestWorkflow";
import type { MaterialRequestWorkflowStatus } from "../../types/materialRequestWorkflow";
import { canCreateRfqFromMaterialRequest } from "../../api/createRFQFromMaterialRequest";
import { listTimersForReference } from "../../api/sla";
import { syncMaterialRequestSla } from "../../api/slaIntegration";
import SlaBadge from "../../components/sla/SlaBadge";
import PageHeader from "../../components/PageHeader";
import ProcurementTypeBadge from "../../components/ProcurementTypeBadge";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { Skeleton } from "../../components/Skeleton";
import { useAuthStore } from "../../store/authStore";
import {
  canCreateMaterialRequest,
  canCreateRfqFromMR,
  canDeleteMaterialRequest,
  canReviewIndirectMaterialRequest,
  canReviewMaterialRequest,
} from "../../config/materialRequestPermissions";
import { ROLE_LABELS } from "../../config/roles";
import { formatDate } from "../../utils/format";
import {
  computeRequestFulfillment,
  type RequestFulfillment,
} from "../../utils/materialRequestFulfillment";
import {
  FulfillmentBar,
  ItemStatusBadge,
  QtyChip,
} from "../../components/material-requests/FulfillmentUI";

/* ──────────────────────────────────────────────────────────────────────────
 * Status badge — the exact color scheme requested for the Department portal:
 *   Completed → Green · Issued → Blue · Pending → Orange
 *   Forwarded → Purple · Rejected → Red
 * ────────────────────────────────────────────────────────────────────────── */
const MR_BADGE: Record<
  MaterialRequestWorkflowStatus,
  { label: string; cls: string }
> = {
  Draft: { label: "Draft", cls: "bg-neutral-100 text-neutral-600" },
  Submitted: { label: "Submitted", cls: "bg-orange-100 text-orange-700" },
  "Admin Review": {
    label: "Admin Review",
    cls: "bg-purple-100 text-purple-700",
  },
  "Under Warehouse Review": {
    label: "Under Warehouse Review",
    cls: "bg-orange-100 text-orange-700",
  },
  "Stock Available": {
    label: "Stock Available",
    cls: "bg-orange-100 text-orange-700",
  },
  "Material Issued": {
    label: "Material Issued",
    cls: "bg-blue-100 text-blue-700",
  },
  "Procurement Required": {
    label: "Sent to Procurement",
    cls: "bg-purple-100 text-purple-700",
  },
  "RFQ Created": { label: "RFQ Created", cls: "bg-purple-100 text-purple-700" },
  Completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
  Cancelled: { label: "Cancelled", cls: "bg-red-100 text-red-700" },
};

/** Milestones that exist as live documents but not as MR workflow statuses. */
const STAGE_BADGE_EXTRA: Record<string, { label: string; cls: string }> = {
  "Purchase Ordered": {
    label: "Purchase Ordered",
    cls: "bg-indigo-100 text-indigo-700",
  },
  "Goods Received": {
    label: "Goods Received",
    cls: "bg-teal-100 text-teal-700",
  },
};

/**
 * Resolve the badge that best reflects the request's TRUE stage. For a
 * procurement request the stored status stalls at "RFQ Created", so the live
 * PO / GRN / Stock Entry milestones take precedence — the badge tracks the
 * same signal as the timeline.
 */
function resolveStageBadge(
  effectiveStatus: MaterialRequestWorkflowStatus,
  procurementInvolved: boolean,
  progress: MaterialRequestProcurementProgress | null | undefined,
  fullyIssued: boolean,
): { label: string; cls: string } {
  const fallback = MR_BADGE[effectiveStatus] ?? MR_BADGE.Draft;
  if (!procurementInvolved || !progress) return fallback;
  if (fullyIssued) return MR_BADGE.Completed;
  if (progress.stockEntries.length > 0) return MR_BADGE["Material Issued"];
  if (progress.goodsReceipts.length > 0) return STAGE_BADGE_EXTRA["Goods Received"];
  if (progress.purchaseOrders.length > 0)
    return STAGE_BADGE_EXTRA["Purchase Ordered"];
  return fallback;
}

function StageBadge({ label, cls }: { label: string; cls: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Dynamic workflow — the visible steps depend on the actual path a Material
 * Request took. When stock covered the request the procurement stages are
 * hidden entirely; only when Procurement was actually involved do they appear.
 * ────────────────────────────────────────────────────────────────────────── */
const STOCK_PATH_STEPS = [
  "Request Submitted",
  "Warehouse Review",
  "Material Issued",
  "Completed",
];

const PROCUREMENT_PATH_STEPS = [
  "Request Submitted",
  "Warehouse Review",
  "Sent to Procurement",
  "RFQ Created",
  "Purchase Ordered",
  "Goods Received",
  "Material Issued",
  "Completed",
];

/** Indirect procurement path — Admin approval replaces warehouse review. */
const INDIRECT_PATH_STEPS = [
  "Request Submitted",
  "Admin Review",
  "Sent to Procurement",
  "RFQ Created",
  "Purchase Ordered",
  "Goods Received",
  "Material Issued",
  "Completed",
];

/** Whether Procurement has actually handled this request (drives the timeline). */
function isProcurementInvolved(
  mr: MaterialRequestWorkflowRecord,
  fulfillment: RequestFulfillment,
): boolean {
  return (
    Boolean(mr.custom_linked_rfq) ||
    Boolean(mr.custom_procurement_remarks?.trim()) ||
    fulfillment.totals.procurement > 0 ||
    fulfillment.workflowStatus === "Procurement Required" ||
    fulfillment.workflowStatus === "RFQ Created"
  );
}

function resolveTimeline(
  status: MaterialRequestWorkflowStatus,
  procurementInvolved: boolean,
  progress?: MaterialRequestProcurementProgress | null,
  fullyIssued?: boolean,
  isIndirect?: boolean,
): { steps: string[]; currentIndex: number } {
  // Indirect requests use a fixed 8-step path where Admin Review replaces the
  // warehouse review stage. Steps 4–6 (PO / GRN / Material Issued) advance from
  // live linked documents just like the direct procurement path.
  if (isIndirect) {
    let index = (() => {
      switch (status) {
        case "Submitted":
          return 0;
        case "Admin Review":
          return 1;
        case "Procurement Required":
          return 2;
        case "RFQ Created":
          return 3;
        case "Material Issued":
          return 6;
        case "Completed":
          return 7;
        default:
          return 0;
      }
    })();
    if (progress) {
      if (progress.purchaseOrders.length > 0) index = Math.max(index, 4);
      if (progress.goodsReceipts.length > 0) index = Math.max(index, 5);
      if (progress.stockEntries.length > 0) index = Math.max(index, 6);
    }
    if (fullyIssued) index = 7;
    return { steps: INDIRECT_PATH_STEPS, currentIndex: index };
  }

  if (procurementInvolved) {
    // Base index from the stored workflow status…
    let index = (() => {
      switch (status) {
        case "Submitted":
          return 0;
        case "Under Warehouse Review":
        case "Stock Available":
          return 1;
        case "Procurement Required":
          return 2;
        case "RFQ Created":
          return 3;
        case "Material Issued":
          return 6;
        case "Completed":
          return 7;
        default:
          return 0;
      }
    })();

    // …then advance it from LIVE linked documents. `custom_bidsphere_status`
    // stops at "RFQ Created", so the PO / GRN / Stock Entry milestones (steps
    // 4–6) are driven entirely by whether the submitted document exists. Using
    // Math.max also prevents a status regression (e.g. an MR moved back to
    // "Stock Available" after goods arrived) from rewinding the bar.
    if (progress) {
      if (progress.purchaseOrders.length > 0) index = Math.max(index, 4);
      if (progress.goodsReceipts.length > 0) index = Math.max(index, 5);
      if (progress.stockEntries.length > 0) index = Math.max(index, 6);
    }
    if (fullyIssued) index = 7;

    return { steps: PROCUREMENT_PATH_STEPS, currentIndex: index };
  }

  const index = (() => {
    switch (status) {
      case "Submitted":
        return 0;
      case "Under Warehouse Review":
      case "Stock Available":
        return 1;
      case "Material Issued":
        return 2;
      case "Completed":
        return 3;
      default:
        return 0;
    }
  })();
  return { steps: STOCK_PATH_STEPS, currentIndex: index };
}

function WorkflowTimeline({
  status,
  procurementInvolved,
  progress,
  fullyIssued,
  isIndirect,
}: {
  status: MaterialRequestWorkflowStatus;
  procurementInvolved: boolean;
  progress?: MaterialRequestProcurementProgress | null;
  fullyIssued?: boolean;
  isIndirect?: boolean;
}) {
  if (status === "Draft") {
    return (
      <TimelineShell>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          Draft — Submit to start the approval workflow.
        </div>
      </TimelineShell>
    );
  }

  if (status === "Cancelled") {
    return (
      <TimelineShell>
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">This Material Request was cancelled.</p>
            <p className="mt-1 text-red-600">
              Review the remarks below for more information.
            </p>
          </div>
        </div>
      </TimelineShell>
    );
  }

  const { steps, currentIndex } = resolveTimeline(
    status,
    procurementInvolved,
    progress,
    fullyIssued,
    isIndirect,
  );
  const stepCount = steps.length;
  const lastIndex = stepCount - 1;
  const inset = 100 / (2 * stepCount);
  const activeTrackWidth = `${Math.max(0, currentIndex) * (100 / stepCount)}%`;

  return (
    <TimelineShell>
      <div className="relative overflow-x-auto">
        <div
          className="absolute top-4 h-0.5 bg-neutral-200"
          style={{ left: `${inset}%`, right: `${inset}%` }}
        />
        <div
          className="absolute top-4 h-0.5 bg-emerald-400 transition-all duration-500"
          style={{ left: `${inset}%`, width: activeTrackWidth }}
        />

        <div
          className="grid gap-2"
          style={{
            minWidth: `${stepCount * 88}px`,
            gridTemplateColumns: `repeat(${stepCount}, minmax(0, 1fr))`,
          }}
        >
          {steps.map((step, index) => {
            const isCurrent = currentIndex < lastIndex && index === currentIndex;
            const isCompleted =
              currentIndex >= lastIndex
                ? index <= currentIndex
                : index < currentIndex;
            const isPending = index > currentIndex;

            return (
              <div key={step} className="flex flex-col items-center text-center">
                <div
                  className={[
                    "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white",
                    isCompleted
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : isCurrent
                        ? "border-primary-500 bg-white text-primary-600"
                        : "border-neutral-300 bg-white text-neutral-400",
                  ].join(" ")}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : isCurrent ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
                  ) : (
                    <span className="text-xs font-semibold">{index + 1}</span>
                  )}
                </div>
                <p
                  className={[
                    "mt-2 text-[11px] leading-tight",
                    isCompleted
                      ? "font-medium text-emerald-700"
                      : isCurrent
                        ? "font-semibold text-primary-700"
                        : isPending
                          ? "font-medium text-neutral-400"
                          : "font-medium text-neutral-500",
                  ].join(" ")}
                >
                  {step}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </TimelineShell>
  );
}

function TimelineShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="card mb-6 p-5">
      <div className="mb-4 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-primary-600" />
        <h3 className="text-sm font-bold text-neutral-900">Workflow Progress</h3>
      </div>
      {children}
    </div>
  );
}

/**
 * Strip the machine-only `[BidSphere:ForwardedItems:[…]]` snapshot that the
 * warehouse workflow embeds inside the remarks field so users never see raw
 * JSON. Returns the human-readable remainder (may be empty).
 */
function cleanRemarks(raw?: string): string {
  if (!raw) return "";
  return raw
    .replace(/\[BidSphere:ForwardedItems:\[.*?\]\]/gs, "")
    .replace(/\[BidSphere:[^\]]*\]/gs, "")
    .trim();
}

export default function MaterialRequestDetailPage() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const { t } = useTranslation();
  // Department users must never see warehouse inventory. The "Available" column
  // and its live stock fetch are gated to warehouse / procurement / admin.
  const showStock = role !== "department";

  const [warehouseRemarks, setWarehouseRemarks] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // Set the instant a delete succeeds. Disables the detail query so React Query
  // can NEVER refetch the now-deleted record (which would 404 with "Reference
  // Name … does not exist") while the page unmounts and the redirect happens.
  const [deleted, setDeleted] = useState(false);
  // ERPNext's status field has no "Stock Available" option, so a successful
  // stock check is persisted as "Under Warehouse Review". This session flag
  // keeps the "Issue Material" action unlocked right after the check without
  // relying on a status value ERPNext can't store.
  const [stockConfirmedLocal, setStockConfirmedLocal] = useState(false);

  const {
    data: mr,
    isLoading,
    isError,
  } = useQuery<MaterialRequestWorkflowRecord>({
    queryKey: ["material-request-workflow", name],
    queryFn: () => fetchMaterialRequestWorkflow(name),
    // Once deleted, keep the query permanently disabled so neither cache
    // removal nor window-focus can trigger a refetch of the missing record.
    enabled: !!name && !deleted,
    refetchOnWindowFocus: !deleted,
  });

  // Keep the SLA timer for this MR's current stage in sync, then surface it.
  useEffect(() => {
    if (mr) void syncMaterialRequestSla(mr);
  }, [mr]);

  const slaTimersQuery = useQuery({
    queryKey: ["sla-timers-ref", "Material Request", name],
    queryFn: () => listTimersForReference("Material Request", name),
    enabled: !!name && !deleted,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const activeSlaTimer = useMemo(() => {
    const timers = slaTimersQuery.data ?? [];
    return (
      timers.find(
        (t) => t.sla_status === "Running" || t.sla_status === "Due Soon"
      ) ??
      timers.find((t) => t.sla_status === "Breached") ??
      null
    );
  }, [slaTimersQuery.data]);

  // Live stock levels from ERPNext Bin for the Available column. Read-only —
  // `checkMaterialRequestStock` only queries Bin, it never mutates the MR.
  const stockQuery = useQuery({
    queryKey: ["material-request-live-stock", name],
    queryFn: () => checkMaterialRequestStock(name),
    enabled: !!name && !deleted && showStock,
    staleTime: 30_000,
    refetchOnWindowFocus: !deleted,
  });

  // Live procurement milestones (submitted PO → GRN → Stock Entry) read
  // straight from the linked ERPNext documents. This is what advances the
  // Track Request timeline past "RFQ Created" — the stored MR status never
  // does. Enabled once the request is on the procurement path.
  const procurementPath =
    !!mr &&
    (Boolean(mr.custom_linked_rfq) ||
      Boolean(mr.custom_procurement_remarks?.trim()) ||
      getMaterialRequestWorkflowStatus(mr) === "Procurement Required" ||
      getMaterialRequestWorkflowStatus(mr) === "RFQ Created");

  const progressQuery = useQuery({
    queryKey: ["material-request-progress", name],
    queryFn: () =>
      getMaterialRequestProcurementProgress(name, mr?.custom_linked_rfq),
    enabled: !!name && !deleted && procurementPath,
    staleTime: 30_000,
    refetchOnWindowFocus: !deleted,
  });

  const availableByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of stockQuery.data?.lines ?? []) {
      map.set(line.item_code, line.available_qty);
    }
    return map;
  }, [stockQuery.data]);

  // Resolve the requester's real name (never an email). Falls back to the
  // logged-in user's own full name when they are the requester.
  const requesterIdentifier =
    mr?.custom_requested_by || mr?.requested_by || mr?.owner || "";
  const { data: resolvedRequesterName } = useQuery({
    queryKey: ["mr-requester-name", requesterIdentifier],
    queryFn: () => getUserFullName(requesterIdentifier),
    enabled: !!requesterIdentifier && requesterIdentifier.includes("@"),
    staleTime: 5 * 60_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ["material-request-workflow", name],
    });
    queryClient.invalidateQueries({
      queryKey: ["material-request-progress", name],
    });
    queryClient.invalidateQueries({
      queryKey: ["material-request-live-stock", name],
    });
    queryClient.invalidateQueries({ queryKey: ["material-requests-workflow"] });
    queryClient.invalidateQueries({ queryKey: ["mr-dashboard-counts"] });
    queryClient.invalidateQueries({ queryKey: ["mr-dashboard-recent"] });
    queryClient.invalidateQueries({ queryKey: ["mr-dashboard-rows"] });
  };

  const submitMutation = useMutation({
    mutationFn: () => submitMaterialRequestWorkflow(name),
    onSuccess: () => {
      toast.success("Submitted — assigned to Warehouse for review");
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Submit failed"),
  });

  // Live stock check against ERPNext Bin. When all lines are sufficient the MR
  // is moved to "Stock Available" (persisted in ERPNext), which unlocks Issue
  // Material for every reviewer/device.
  const checkStockMutation = useMutation({
    mutationFn: async () => {
      const result = await checkMaterialRequestStock(name);
      if (result.all_sufficient) {
        await markMaterialRequestStockAvailable(
          name,
          warehouseRemarks || undefined,
        );
      }
      return result;
    },
    onSuccess: (result) => {
      if (result.all_sufficient) {
        setStockConfirmedLocal(true);
        toast.success("Stock available — you can now issue material");
      } else {
        toast("Insufficient stock — send this request to Procurement", {
          icon: "⚠️",
        });
      }
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Stock check failed"),
  });

  const issueMutation = useMutation({
    mutationFn: () =>
      issueMaterialRequest(name, { warehouse_remarks: warehouseRemarks }),
    onSuccess: (res) => {
      toast.success(`Material issued — Stock Entry ${res.stock_entry}`);
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Issue failed"),
  });

  const completeMutation = useMutation({
    mutationFn: () => completeMaterialRequest(name, warehouseRemarks || undefined),
    onSuccess: () => {
      toast.success("Material Request marked as Completed");
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Complete failed"),
  });

  const forwardMutation = useMutation({
    mutationFn: () =>
      forwardMaterialRequestToProcurement(name, warehouseRemarks),
    onSuccess: () => {
      toast.success("Sent to Procurement");
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Send to Procurement failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectMaterialRequest(name, warehouseRemarks),
    onSuccess: () => {
      toast.success("Material Request cancelled");
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Cancel failed"),
  });

  // Admin approval gate for Indirect Material Requests.
  const adminApproveMutation = useMutation({
    mutationFn: () =>
      approveIndirectMaterialRequest(name, warehouseRemarks || undefined),
    onSuccess: () => {
      toast.success(t("adminReview.approved"));
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Approve failed"),
  });

  const adminRejectMutation = useMutation({
    mutationFn: () =>
      rejectIndirectMaterialRequest(name, warehouseRemarks || undefined),
    onSuccess: () => {
      toast.success(t("adminReview.rejected"));
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Reject failed"),
  });

  const backPath =
    role === "department" ? "/material-requests/list" : "/material-requests";

  const deleteMutation = useMutation({
    mutationFn: () =>
      deleteMaterialRequestWorkflow(name, {
        email: user?.email,
        name: user?.name,
        role: role ? ROLE_LABELS[role] : undefined,
      }),
    onSuccess: () => {
      // 1. Disable the detail query FIRST so nothing can refetch the deleted
      //    record (cache removal / window-focus / invalidation).
      setDeleted(true);
      setShowDeleteModal(false);

      // 2. Abort any in-flight fetch for this record, then drop it from cache.
      void queryClient.cancelQueries({
        queryKey: ["material-request-workflow", name],
      });
      queryClient.removeQueries({
        queryKey: ["material-request-workflow", name],
      });

      // 3. Refresh the lists/dashboards (these never touch the deleted doc).
      queryClient.invalidateQueries({
        queryKey: ["material-requests-workflow"],
      });
      queryClient.invalidateQueries({ queryKey: ["mr-dashboard-counts"] });
      queryClient.invalidateQueries({ queryKey: ["mr-dashboard-recent"] });
      queryClient.invalidateQueries({ queryKey: ["mr-dashboard-rows"] });

      // 4. One success toast, then redirect to the list (no back-nav to a 404).
      toast.success("Material Request deleted successfully.");
      navigate(backPath, { replace: true });
    },
    onError: (e) => {
      // Delete failed — stay on the page and surface the actual backend error.
      setShowDeleteModal(false);
      toast.error(e instanceof Error ? e.message : "Delete failed");
    },
  });

  // Just deleted — the redirect is in flight; render nothing so the removed
  // record never flashes a "not found" state on the way out.
  if (deleted) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !mr) {
    return (
      <div className="py-16 text-center text-neutral-500">
        Material Request not found.
        <Link to={backPath} className="mt-2 block text-primary-600">
          Back to Request History
        </Link>
      </div>
    );
  }

  const workflowStatus = getMaterialRequestWorkflowStatus(mr);
  const fulfillment = computeRequestFulfillment(mr);
  const procurementInvolved = isProcurementInvolved(mr, fulfillment);
  const progress = progressQuery.data ?? null;

  // Auto-complete for display: once every requested unit is issued from stock
  // (Remaining = 0 and Issued = Requested) the request is effectively Completed,
  // so the badge and the final workflow step reflect that — not "Material
  // Issued". Only derived off the stock path; a procurement-pending MR is never
  // auto-completed.
  const requestedTotal = fulfillment.totals.requested;
  const liveIssuedQty = progress?.issuedQty ?? 0;
  const isFullyIssued =
    requestedTotal > 0 &&
    ((fulfillment.totals.remaining === 0 &&
      fulfillment.totals.issued === requestedTotal) ||
      liveIssuedQty >= requestedTotal);
  const hasStockEntry = (progress?.stockEntries.length ?? 0) > 0;
  const effectiveStatus: MaterialRequestWorkflowStatus =
    isFullyIssued &&
    (workflowStatus === "Material Issued" ||
      workflowStatus === "Completed" ||
      hasStockEntry)
      ? "Completed"
      : workflowStatus;

  // Badge that reflects the true live stage (PO / GRN / Issue), not the stalled
  // stored status.
  const stageBadge = resolveStageBadge(
    effectiveStatus,
    procurementInvolved,
    progress,
    isFullyIssued,
  );

  // Requested By — a real name, never an email. Prefer a stored human name,
  // then the ERPNext User lookup, then the logged-in user's own name, and
  // finally a friendly role fallback.
  const rawRequester = (mr.custom_requested_by || mr.requested_by || "").trim();
  const requesterName =
    (rawRequester && !rawRequester.includes("@") ? rawRequester : "") ||
    resolvedRequesterName ||
    (mr.owner && user?.email && mr.owner === user.email ? user.full_name : "") ||
    "Department User";

  // The warehouse the material was (or would be) issued from — live ERPNext
  // value, used to auto-populate the warehouse remark after an issue.
  const warehouseName =
    stockQuery.data?.lines.find((l) => l.warehouse && l.warehouse !== "—")
      ?.warehouse ||
    fulfillment.items.find((i) => i.warehouse && i.warehouse !== "—")?.warehouse ||
    "";

  const isDraft = (mr.docstatus ?? 0) === 0;
  // MRs are created through the shared integration token, so `owner` is the API
  // user — the real requester is tracked in custom_requested_by/requested_by.
  // Match against all three so Submit/Edit/Delete render for the requester.
  const isOwner = isMaterialRequestOwnedByUser(mr, {
    email: user?.email,
    name: user?.name,
    fullName: user?.full_name,
  });
  // Draft actions (Edit / Submit / Delete) are gated on ROLE, not ownership.
  // MRs are created through the shared integration token, so `owner` is the API
  // user and never matches a real login — an owner-based gate hid the whole
  // action bar. Drafts only appear in the requester's own views, and every
  // delete is audit-logged with the acting user, so role-based gating is safe.
  const canSubmit =
    isDraft && workflowStatus === "Draft" && canCreateMaterialRequest(role);
  const isSubmitted = (mr.docstatus ?? 0) === 1;
  const procurementType = getMaterialRequestProcurementType(mr);
  const canWarehouseAct =
    canReviewMaterialRequest(role) &&
    (workflowStatus === "Under Warehouse Review" ||
      workflowStatus === "Stock Available") &&
    isSubmitted;
  // Admin approve/reject is only for Indirect MRs sitting in "Admin Review".
  const canAdminReview =
    canReviewIndirectMaterialRequest(role) &&
    procurementType === "Indirect" &&
    workflowStatus === "Admin Review" &&
    isSubmitted;
  // Issue Material is only unlocked once stock has been confirmed available.
  const stockConfirmed =
    workflowStatus === "Stock Available" || stockConfirmedLocal;
  // Once fully issued the request auto-shows as Completed, so the manual
  // "Mark as Completed" action is only offered while it is still Material
  // Issued but not yet fully fulfilled.
  const canComplete =
    effectiveStatus === "Material Issued" &&
    isSubmitted &&
    (canReviewMaterialRequest(role) || isOwner);
  const canRfq =
    mr && canCreateRfqFromMR(role) && canCreateRfqFromMaterialRequest(mr);
  // Edit is available on a Draft to the roles that can author MRs (Department
  // User, Admin).
  const canEditDraft =
    isDraft && workflowStatus === "Draft" && canCreateMaterialRequest(role);
  // Delete is offered on a Draft to Department User, Procurement, or Admin. It
  // is blocked ONLY when an RFQ has already been created from this MR. Note:
  // `material_request_type` defaults to "Purchase" for every requisition, so it
  // is NOT evidence of a started purchase flow and must never block deletion —
  // that previous check disabled the button for every draft. Downstream docs
  // (RFQ / PO / Stock Entry) are re-verified on the server before removal.
  const hasLinkedRfq = Boolean(mr.custom_linked_rfq);
  const showDelete =
    isDraft &&
    workflowStatus === "Draft" &&
    canDeleteMaterialRequest(role, true);
  const deleteBlocked = hasLinkedRfq;
  const busy =
    submitMutation.isPending ||
    checkStockMutation.isPending ||
    issueMutation.isPending ||
    completeMutation.isPending ||
    forwardMutation.isPending ||
    rejectMutation.isPending ||
    adminApproveMutation.isPending ||
    adminRejectMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div>
      <Link
        to={backPath}
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 no-underline hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Request History
      </Link>

      <PageHeader
        title="Material Request Details"
        description={cleanRemarks(mr.custom_purpose) || cleanRemarks(mr.remarks) || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StageBadge label={stageBadge.label} cls={stageBadge.cls} />
            {activeSlaTimer ? <SlaBadge timer={activeSlaTimer} /> : null}
            {canEditDraft ? (
              <Link
                to={`/material-requests/new?edit=${encodeURIComponent(mr.name)}`}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 no-underline hover:bg-neutral-50"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            ) : null}
            {canSubmit ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => submitMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit
              </button>
            ) : null}
            {canAdminReview ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => adminApproveMutation.mutate()}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {adminApproveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {t("adminReview.approve")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => adminRejectMutation.mutate()}
                  className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                >
                  {adminRejectMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {t("adminReview.reject")}
                </button>
              </>
            ) : null}
            {showDelete ? (
              <button
                type="button"
                disabled={busy || deleteBlocked}
                onClick={() => setShowDeleteModal(true)}
                title={
                  deleteBlocked
                    ? "Cannot delete because an RFQ has already been created."
                    : undefined
                }
                className="inline-flex items-center gap-2 rounded-lg border border-danger bg-white px-3 py-2 text-sm font-semibold text-danger hover:bg-danger-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            ) : null}
            {canComplete ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => completeMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
              >
                {completeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Mark as Completed
              </button>
            ) : null}
            {canRfq ? (
              <Link
                to={`/sourcing/rfq/new?mr=${encodeURIComponent(mr.name)}`}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white no-underline"
              >
                <Truck className="h-4 w-4" />
                Create RFQ from MR
              </Link>
            ) : null}
            {mr.custom_linked_rfq ? (
              <Link
                to={`/sourcing/rfq/${encodeURIComponent(mr.custom_linked_rfq)}`}
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary-600 no-underline"
              >
                View RFQ {mr.custom_linked_rfq}{" "}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        }
      />

      {/* MR number — the header title is generic, so surface the identifier. */}
      <div className="-mt-3 mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500">
        <span className="font-mono font-semibold text-neutral-800">
          {mr.name}
        </span>
        <ProcurementTypeBadge type={procurementType} />
        {mr.custom_department ? (
          <>
            <span className="text-neutral-300">•</span>
            <span>{mr.custom_department}</span>
          </>
        ) : null}
      </div>

      <WorkflowTimeline
        status={effectiveStatus}
        procurementInvolved={procurementInvolved}
        progress={progress}
        fullyIssued={isFullyIssued}
        isIndirect={procurementType === "Indirect"}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {[
          { label: "Request Date", value: formatDate(mr.transaction_date) },
          { label: "Required Date", value: formatDate(mr.schedule_date) },
          { label: "Requested By", value: requesterName },
          { label: "Department", value: mr.custom_department },
          { label: t("procurementType.label"), value: t(
            procurementType === "Direct"
              ? "procurementType.direct"
              : "procurementType.indirect",
          ) },
          { label: "Priority", value: mr.custom_priority },
          { label: "Company", value: mr.company },
        ]
          .filter((f) => f.value && String(f.value).trim() && f.value !== "—")
          .map((f) => (
            <Info key={f.label} label={f.label} value={String(f.value)} />
          ))}
      </div>

      <div className="card mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <h3 className="text-sm font-bold">Requested Items</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <QtyChip label="Requested" value={fulfillment.totals.requested} tone="requested" />
            <QtyChip label="Issued" value={fulfillment.totals.issued} tone="issued" />
            <QtyChip label="Remaining" value={fulfillment.totals.remaining} tone="remaining" />
            {procurementInvolved ? (
              <QtyChip label="Procurement" value={fulfillment.totals.procurement} tone="procurement" />
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2 text-left">Item Code</th>
                <th className="px-4 py-2 text-left">Item Name</th>
                <th className="px-4 py-2 text-right">Requested</th>
                {showStock ? (
                  <th className="px-4 py-2 text-right">Available</th>
                ) : null}
                <th className="px-4 py-2 text-right">Issued</th>
                <th className="px-4 py-2 text-right">Remaining</th>
                {procurementInvolved ? (
                  <th className="px-4 py-2 text-right">Procurement</th>
                ) : null}
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {fulfillment.items.map((it) => {
                const liveAvailable = availableByItem.get(it.item_code);
                const availableQty =
                  liveAvailable ?? (it.available != null ? it.available : null);
                return (
                  <tr key={it.item_code}>
                    <td className="px-4 py-2 font-mono font-medium text-neutral-800">
                      {it.item_code}
                    </td>
                    <td className="px-4 py-2 text-neutral-700">
                      <div>{it.item_name}</div>
                      <FulfillmentBar
                        className="mt-1.5 max-w-[160px]"
                        requested={it.requested}
                        issued={it.issued}
                        procurement={it.procurement}
                      />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {it.requested} {it.uom}
                    </td>
                    {showStock ? (
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                        {availableQty == null ? (
                          stockQuery.isLoading ? (
                            <span className="text-neutral-400">…</span>
                          ) : (
                            `0 ${it.uom}`
                          )
                        ) : (
                          `${availableQty} ${it.uom}`
                        )}
                      </td>
                    ) : null}
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-emerald-700">
                      {it.issued} {it.uom}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-orange-700">
                      {it.remaining} {it.uom}
                    </td>
                    {procurementInvolved ? (
                      <td className="px-4 py-2 text-right tabular-nums text-blue-700">
                        {it.procurement > 0 ? `${it.procurement} ${it.uom}` : "—"}
                      </td>
                    ) : null}
                    <td className="px-4 py-2">
                      <ItemStatusBadge status={it.status} />
                    </td>
                  </tr>
                );
              })}
              {fulfillment.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      (procurementInvolved ? 8 : 7) - (showStock ? 0 : 1)
                    }
                    className="px-4 py-8 text-center text-neutral-500"
                  >
                    No items on this request.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {(() => {
        const warehouseRemarkText =
          cleanRemarks(mr.custom_warehouse_remarks) ||
          (effectiveStatus === "Material Issued" || effectiveStatus === "Completed"
            ? `Issued successfully${
                warehouseName ? ` from ${warehouseName}` : ""
              }.`
            : "");
        const procurementRemarkText = cleanRemarks(mr.custom_procurement_remarks);
        const showProcurementRemarks =
          procurementInvolved && Boolean(procurementRemarkText);

        if (!warehouseRemarkText && !showProcurementRemarks) return null;

        return (
          <div
            className={`mb-6 grid gap-4 ${
              warehouseRemarkText && showProcurementRemarks
                ? "lg:grid-cols-2"
                : "grid-cols-1"
            }`}
          >
            {warehouseRemarkText ? (
              <div className="card p-5">
                <h3 className="mb-2 text-sm font-bold">Warehouse Remarks</h3>
                <p className="text-sm text-neutral-700">{warehouseRemarkText}</p>
              </div>
            ) : null}
            {showProcurementRemarks ? (
              <div className="card p-5">
                <h3 className="mb-2 text-sm font-bold">Procurement Remarks</h3>
                <p className="text-sm text-neutral-700">{procurementRemarkText}</p>
              </div>
            ) : null}
          </div>
        );
      })()}

      {canWarehouseAct ? (
        <div className="card border-amber-200 bg-amber-50/30 p-5">
          <h3 className="mb-3 text-sm font-bold text-amber-900">
            Warehouse Actions
          </h3>
          <textarea
            rows={2}
            value={warehouseRemarks}
            onChange={(e) => setWarehouseRemarks(e.target.value)}
            placeholder="Warehouse remarks (optional)"
            className="mb-4 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            disabled={busy}
          />
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => checkStockMutation.mutate()}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold"
            >
              {checkStockMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Check Stock
            </button>
            <button
              type="button"
              disabled={busy || !stockConfirmed}
              title={
                stockConfirmed
                  ? undefined
                  : "Run a stock check first — Issue Material unlocks once stock is confirmed available."
              }
              onClick={() => issueMutation.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Package className="h-4 w-4" />
              Issue Material
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => forwardMutation.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
            >
              <Truck className="h-4 w-4" />
              Send to Procurement
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => rejectMutation.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white"
            >
              <XCircle className="h-4 w-4" />
              Cancel Request
            </button>
          </div>
          {checkStockMutation.data ? (
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-left">Warehouse</th>
                    <th className="px-3 py-2 text-right">Required</th>
                    <th className="px-3 py-2 text-right">Available</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {checkStockMutation.data.lines.map((line) => (
                    <tr
                      key={`${line.item_code}-${line.warehouse}`}
                      className="border-t border-neutral-100"
                    >
                      <td className="px-3 py-2">{line.item_code}</td>
                      <td className="px-3 py-2">{line.warehouse}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.required_qty}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.available_qty}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            line.sufficient
                              ? "text-emerald-700"
                              : "font-semibold text-red-600"
                          }
                        >
                          {line.sufficient ? "OK" : "Insufficient"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!checkStockMutation.data.all_sufficient ? (
                <p className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Insufficient stock. Send this request to Procurement.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={showDeleteModal}
        onClose={() => {
          if (!deleteMutation.isPending) setShowDeleteModal(false);
        }}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete Material Request"
        description="Are you sure you want to permanently delete this Material Request? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase text-neutral-500">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}
