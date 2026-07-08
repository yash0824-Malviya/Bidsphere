import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import {
  fetchMaterialRequestWorkflow,
  getMaterialRequestProcurementProgress,
  getMaterialRequestWorkflowStatus,
  parseForwardedItemsFromMr,
  type MaterialRequestWorkflowRecord,
} from "../../api/materialRequestWorkflow";
import { getApprovalStateFromErp } from "../../api/legalReviews";
import ProcurementTimeline, {
  type TimelineStep,
} from "../supplier-portal/ProcurementTimeline";
import { formatDate, formatDateTime } from "../../utils/format";

/**
 * Read-only status tracker for a forwarded Material Request. Live ERPNext data
 * only — pulls the MR document + its linked procurement documents (RFQ / PO /
 * GRN) and renders the details grid + a stage timeline. No mock data.
 */
export default function MaterialRequestStatusModal({
  mrName,
  onClose,
}: {
  mrName: string;
  onClose: () => void;
}) {
  const mrQuery = useQuery({
    queryKey: ["mr-status", mrName],
    queryFn: () => fetchMaterialRequestWorkflow(mrName),
    staleTime: 30_000,
  });

  const mr = mrQuery.data;
  const linkedRfq = mr?.custom_linked_rfq ?? null;

  const progressQuery = useQuery({
    queryKey: ["mr-status-progress", mrName, linkedRfq],
    queryFn: () => getMaterialRequestProcurementProgress(mrName, linkedRfq),
    enabled: Boolean(mr),
    staleTime: 30_000,
  });

  const progress = progressQuery.data;

  const status = mr ? getMaterialRequestWorkflowStatus(mr) : "—";
  const forwarded = mr ? parseForwardedInfo(mr) : null;
  const rfqNumber = linkedRfq ?? progress?.rfqName ?? null;
  const poNumber = progress?.purchaseOrders?.[0] ?? null;
  const grnNumber = progress?.goodsReceipts?.[0] ?? null;

  // Live RFQ approval state (legal + finance) — best-effort; degrades to
  // inferring from a created PO when the RFQ workflow fields aren't readable.
  const approvalQuery = useQuery({
    queryKey: ["mr-status-approval", rfqNumber],
    queryFn: () => getApprovalStateFromErp(rfqNumber as string),
    enabled: Boolean(rfqNumber),
    staleTime: 30_000,
  });
  const approval = approvalQuery.data;

  const rfqCreated = Boolean(rfqNumber);
  const poCreated = (progress?.purchaseOrders?.length ?? 0) > 0;
  const grnReceived = (progress?.goodsReceipts?.length ?? 0) > 0;
  const quotationReceived = (progress?.supplierQuotations?.length ?? 0) > 0;
  const completed = status === "Completed";
  const forwardedDone =
    status === "Forwarded to Procurement" ||
    status === "RFQ Created" ||
    completed ||
    rfqCreated ||
    Boolean(forwarded);
  const warehouseReviewed =
    forwardedDone ||
    status === "Material Issued" ||
    status === "Procurement Required";
  // A submitted PO implies legal + finance already cleared, so treat as done
  // even if the workflow fields aren't directly readable.
  const legalDone = poCreated || approval?.legal_status === "Approved";
  const financeDone =
    poCreated || /approv|verif/i.test(approval?.finance_status ?? "");
  // A supplier is chosen via AI comparison / reverse bidding before legal review,
  // so a selected supplier (or any later stage) marks both steps complete.
  const supplierSelected =
    Boolean(approval?.selected_supplier) || legalDone || poCreated;

  const steps: TimelineStep[] = [
    {
      label: "Department Created",
      done: true,
      sublabel: mr?.transaction_date ? formatDate(mr.transaction_date) : undefined,
    },
    { label: "Warehouse Review", done: warehouseReviewed },
    {
      label: "Sent to Procurement",
      done: forwardedDone,
      sublabel: forwarded?.at ? formatDateTime(forwarded.at) : undefined,
    },
    { label: "RFQ Created", done: rfqCreated, sublabel: rfqNumber || undefined },
    { label: "Supplier Quotations", done: quotationReceived },
    { label: "Reverse Bidding", done: supplierSelected },
    { label: "AI Recommendation", done: supplierSelected },
    { label: "Legal Review", done: legalDone },
    { label: "Finance Review", done: financeDone },
    { label: "Purchase Order", done: poCreated, sublabel: poNumber || undefined },
    { label: "GRN", done: grnReceived, sublabel: grnNumber || undefined },
    { label: "Completed", done: completed },
  ];

  const procurementStatus = completed
    ? "Completed"
    : grnReceived
      ? "Goods Received"
      : poCreated
        ? "Purchase Ordered"
        : financeDone
          ? "Finance Approved"
          : legalDone
            ? "Legal Approved"
            : quotationReceived
              ? "Quotation Received"
              : rfqCreated
                ? "RFQ In Progress"
                : forwardedDone
                  ? "Forwarded"
                  : "Pending";

  const rfqStatus = poCreated
    ? "Converted to PO"
    : rfqCreated
      ? "In Progress"
      : "—";

  const department = mr?.custom_department || mr?.department || "—";
  const priority = mr?.custom_priority || "Medium";
  const warehouse =
    mr?.items?.find((i) => i.warehouse)?.warehouse ||
    (mr ? parseForwardedItemsFromMr(mr).find((i) => i.warehouse)?.warehouse : "") ||
    "—";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-neutral-900">
              Material Request Status
            </h2>
            <p className="text-xs text-neutral-500">{mrName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mrQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-neutral-500">
            Loading status…
          </div>
        ) : mrQuery.isError || !mr ? (
          <div className="p-8 text-center text-sm text-red-600">
            Could not load this Material Request. Please try again.
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="MR Number" value={mr.name} />
              <Field label="Current Status" value={status} />
              <Field label="Department" value={department} />
              <Field label="Warehouse" value={warehouse} />
              <Field label="Priority" value={priority} />
              <Field
                label="Current Owner"
                value={mr.custom_requested_by || mr.owner || "—"}
              />
              <Field
                label="Forwarded Date & Time"
                value={forwarded?.at ? formatDateTime(forwarded.at) : "—"}
              />
              <Field label="Procurement Status" value={procurementStatus} />
              <Field label="RFQ Number" value={rfqNumber || "Not created"} />
              <Field label="RFQ Status" value={rfqStatus} />
              <Field label="Purchase Order" value={poNumber || "Not created"} />
              <Field
                label="Last Updated"
                value={mr.modified ? formatDateTime(mr.modified) : "—"}
              />
            </dl>

            {progressQuery.isLoading ? (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-center text-xs text-neutral-500">
                Loading procurement progress…
              </div>
            ) : (
              <ProcurementTimeline steps={steps} title="Status Timeline" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-neutral-800">{value}</dd>
    </div>
  );
}

/** Parse the `[BidSphere:Forwarded:<by>|<iso>]` audit tag from MR remarks. */
function parseForwardedInfo(
  mr: MaterialRequestWorkflowRecord,
): { by: string; at: string } | null {
  if (mr.custom_forwarded_on) {
    return { by: mr.custom_forwarded_by || "", at: mr.custom_forwarded_on };
  }
  const raw = String(mr.custom_warehouse_remarks ?? mr.remarks ?? "");
  const match = raw.match(/\[BidSphere:Forwarded:([^|\]]*)\|([^\]]+)\]/);
  if (!match) return null;
  return { by: match[1]?.trim() || "", at: match[2]?.trim() || "" };
}
