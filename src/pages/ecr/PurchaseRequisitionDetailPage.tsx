import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";

import {
  fetchPR,
  applyPRWorkflowAction,
  createRFQFromPR,
} from "../../api/purchaseRequisition";
import { formatECRNumber } from "../../config/ecrRoles";
import { useAuthStore } from "../../store/authStore";

const STATUS_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  Draft: { bg: "bg-neutral-100", text: "text-neutral-700", border: "border-neutral-200" },
  Submitted: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  "Needs Revision": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  "Under Review": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  Approved: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "RFQ Created": { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
  Closed: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300" },
  Rejected: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
  Cancelled: { bg: "bg-neutral-100", text: "text-neutral-500", border: "border-neutral-200" },
};

export default function PurchaseRequisitionDetailPage() {
  const { name } = useParams<{ name: string }>();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [rfqSuppliersInput, setRfqSuppliersInput] = useState("");
  const [rfqLoading, setRfqLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "warning" | "error"; msg: string } | null>(null);

  const {
    data: pr,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["custom-pr", name],
    queryFn: () => fetchPR(name!),
    enabled: !!name,
  });

  const workflowMutation = useMutation({
    mutationFn: ({ action, cmt }: { action: string; cmt?: string }) =>
      applyPRWorkflowAction(name!, action, cmt),
    onSuccess: (res) => {
      if (res.success) {
        setFeedback({ type: "success", msg: res.message || "Workflow action executed successfully." });
        void qc.invalidateQueries({ queryKey: ["custom-pr", name] });
        void qc.invalidateQueries({ queryKey: ["custom-pr-list"] });
      } else {
        setFeedback({ type: "error", msg: res.message || "Failed to execute workflow action." });
      }
    },
  });

  async function handleCreateRFQ() {
    if (!name || !pr) return;
    const isRepair = Boolean(pr.rfq);
    const suppliers = rfqSuppliersInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const targetSuppliers = suppliers.length > 0
      ? suppliers
      : pr.suggested_supplier
      ? [pr.suggested_supplier]
      : [];

    if (!isRepair && targetSuppliers.length === 0) {
      setFeedback({
        type: "error",
        msg: "Select at least one existing supplier before creating an RFQ.",
      });
      return;
    }

    setRfqLoading(true);
    setFeedback(null);
    const res = await createRFQFromPR(name, {
      suppliers: isRepair ? [] : targetSuppliers,
    });
    if (res.success) {
      setFeedback(res.needsRepair
        ? {
            type: "warning",
            msg: `${res.message || "RFQ exists, but one or more links or workflow steps still need repair."} Use Verify & Repair Links to retry safely.`,
          }
        : {
            type: "success",
            msg: res.message || (isRepair ? "RFQ links and workflow state verified." : "RFQ created successfully."),
          });
      void qc.invalidateQueries({ queryKey: ["custom-pr", name] });
      void qc.invalidateQueries({ queryKey: ["custom-pr-list"] });
    } else {
      setFeedback({
        type: res.needsRepair ? "warning" : "error",
        msg: `${res.message || "Failed to create or verify the RFQ."}${
          res.needsRepair
            ? " Retry this action; the server will verify any existing RFQ before creating another."
            : ""
        }`,
      });
      if (res.needsRepair) {
        void qc.invalidateQueries({ queryKey: ["custom-pr", name] });
        void qc.invalidateQueries({ queryKey: ["custom-pr-list"] });
      }
    }
    setRfqLoading(false);
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-xs text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin text-primary-600 mr-2" />
        Loading Purchase Requisition...
      </div>
    );
  }

  if (isError || !pr) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
          <AlertCircle className="h-8 w-8 text-rose-500" />
          <h2 className="text-sm font-bold text-rose-900">Unable to load PR {name}</h2>
          <p className="text-xs text-rose-600">{error instanceof Error ? error.message : "Record not found."}</p>
          <Link
            to="/ecr/purchase-requisitions"
            className="mt-2 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            Back to PR List
          </Link>
        </div>
      </div>
    );
  }

  const isProcurement = user?.role === "procurement" || user?.role === "procurement_team" || user?.role === "admin";
  const isProcurementManager = user?.role === "procurement" || user?.role === "admin";
  const canCreateRFQ = isProcurement && pr.status === "Approved" && !pr.rfq;
  const canRepairRFQ = isProcurement && Boolean(pr.rfq) && ["Approved", "RFQ Created"].includes(pr.status);
  const canManageRFQ = canCreateRFQ || canRepairRFQ;
  const statusStyle = STATUS_BADGE[pr.status] || STATUS_BADGE.Draft;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-neutral-500">
          <Link to="/ecr" className="hover:text-primary-700 font-medium">
            Engineering Changes
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
          <Link to="/ecr/purchase-requisitions" className="hover:text-primary-700 font-medium">
            Requisitions
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
          <span className="font-mono text-neutral-800 font-semibold">{pr.name}</span>
        </div>

        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin text-primary-600" : "text-neutral-400"}`} />
          Refresh
        </button>
      </div>

      {/* ── Header ── */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-bold text-primary-700">{pr.name}</span>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
              >
                {pr.status}
              </span>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                {pr.priority || "Medium"} Priority
              </span>
              <span className="rounded px-2 py-0.5 text-xs font-medium bg-neutral-100 text-neutral-700">
                Source: {pr.source_type || "ECR"}
              </span>
            </div>

            <h1 className="text-lg font-bold text-neutral-900 leading-snug">{pr.requisition_title}</h1>

            <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500 pt-0.5">
              {pr.ecr_reference && (
                <span>
                  ECR Ref:{" "}
                  <Link to={`/ecr/${encodeURIComponent(formatECRNumber(pr.ecr_reference))}`} className="font-mono font-bold text-primary-700 hover:underline">
                    {formatECRNumber(pr.ecr_reference)}
                  </Link>
                </span>
              )}
              <span>Requester: <strong className="text-neutral-700">{pr.requester || "—"}</strong></span>
              <span>Dept: <strong className="text-neutral-700">{pr.requesting_department || "—"}</strong></span>
              <span>Required Date: <strong className="text-neutral-700">{pr.required_date || "—"}</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pr.rfq && (
              <Link
                to={`/sourcing/rfq/${encodeURIComponent(pr.rfq)}`}
                className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100"
              >
                <span>Linked RFQ: {pr.rfq}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}

            {isProcurement && pr.status === "Draft" && (
              <button
                type="button"
                onClick={() => workflowMutation.mutate({ action: "Submit Requisition" })}
                disabled={workflowMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60 shadow-xs"
              >
                Submit PR
              </button>
            )}

            {isProcurement && pr.status === "Needs Revision" && (
              <button
                type="button"
                onClick={() => workflowMutation.mutate({ action: "Re-Submit after Revision" })}
                disabled={workflowMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60 shadow-xs"
              >
                Re-submit PR
              </button>
            )}

            {isProcurementManager && pr.status === "Submitted" && (
              <button
                type="button"
                onClick={() => workflowMutation.mutate({ action: "Start Review" })}
                disabled={workflowMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60 shadow-xs"
              >
                Start Review
              </button>
            )}

            {isProcurementManager && pr.status === "Under Review" && (
              <button
                type="button"
                onClick={() => workflowMutation.mutate({ action: "Approve Requisition" })}
                disabled={workflowMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 shadow-xs"
              >
                Approve PR
              </button>
            )}

            {isProcurementManager && pr.status === "Under Review" && (
              <button
                type="button"
                onClick={() => workflowMutation.mutate({ action: "Reject Requisition" })}
                disabled={workflowMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              >
                Reject
              </button>
            )}
          </div>
        </div>

        {feedback && (
          <div
            className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
              feedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : feedback.type === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            ) : feedback.type === "warning" ? (
              <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
            )}
            <span className="flex-1">{feedback.msg}</span>
            <button type="button" onClick={() => setFeedback(null)} className="text-neutral-400 hover:text-neutral-600">
              ✕
            </button>
          </div>
        )}
      </div>

      {/* ── Downstream RFQ creation and idempotent repair ── */}
      {canManageRFQ && (
        <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-teal-900">
                {canRepairRFQ
                  ? "Verify RFQ Links and Workflow State"
                  : "Ready for Sourcing: Generate Request for Quotation"}
              </h3>
              <p className="text-[11px] text-teal-700">
                {canRepairRFQ
                  ? `Safely verify and repair the links for ${pr.rfq}; no duplicate RFQ will be created.`
                  : "This Purchase Requisition is approved. Create an RFQ and invite the selected suppliers."}
              </p>
            </div>
            <span className="rounded-full bg-teal-100 text-teal-800 px-2.5 py-0.5 text-xs font-semibold">
              {canRepairRFQ ? "Repair Available" : "Action Required"}
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center pt-2 border-t border-teal-100">
            {!canRepairRFQ && (
              <input
                type="text"
                value={rfqSuppliersInput}
                onChange={(e) => setRfqSuppliersInput(e.target.value)}
                placeholder={pr.suggested_supplier
                  ? `Supplier names (comma separated, e.g. ${pr.suggested_supplier})`
                  : "Supplier names (comma separated)"}
                className="flex-1 rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
              />
            )}
            <button
              type="button"
              onClick={() => void handleCreateRFQ()}
              disabled={rfqLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60 shadow-xs transition-colors"
            >
              {rfqLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : canRepairRFQ
                  ? <RefreshCw className="h-3.5 w-3.5" />
                  : <Sparkles className="h-3.5 w-3.5" />}
              {canRepairRFQ ? "Verify & Repair Links" : "Create & Link RFQ"}
            </button>
          </div>
        </div>
      )}

      {/* ── Requisition Items ── */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-800">
            Requisition Items ({pr.requisition_items?.length ?? 0})
          </h2>
          <span className="text-[11px] text-neutral-500">Auto-populated from ECR Affected Parts</span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full text-left text-xs text-neutral-700">
            <thead className="bg-neutral-50 font-semibold uppercase text-[10px] text-neutral-500 border-b border-neutral-200">
              <tr>
                <th className="px-3 py-2">Item Code</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-2 py-2 text-center">Rev</th>
                <th className="px-2 py-2 text-center">Qty / UOM</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Technical Requirement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(pr.requisition_items ?? []).map((item, idx) => (
                <tr key={idx} className="hover:bg-neutral-50/50">
                  <td className="px-3 py-2 font-mono font-semibold text-primary-700">{item.partitem || "—"}</td>
                  <td className="px-3 py-2 text-neutral-800">{item.description || "—"}</td>
                  <td className="px-2 py-2 text-center font-mono font-bold text-emerald-700">{item.revision || "—"}</td>
                  <td className="px-2 py-2 text-center font-medium">{item.quantity} {item.uom || ""}</td>
                  <td className="px-3 py-2 text-neutral-600">{item.supplier || pr.suggested_supplier || "—"}</td>
                  <td className="px-3 py-2 text-neutral-700 max-w-[280px] whitespace-pre-wrap leading-relaxed">
                    {item.technical_requirement || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Purpose & Technical Justification ── */}
      {pr.purpose__requirement && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
            Purpose & Technical Justification
          </h3>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50/40 p-3 text-xs text-neutral-800 whitespace-pre-wrap leading-relaxed">
            {pr.purpose__requirement}
          </div>
        </div>
      )}
    </div>
  );
}
