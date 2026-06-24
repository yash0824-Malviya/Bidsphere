import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  FileText,
  Gavel,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  PieChart,
  Scale,
  Send,
  ShieldCheck,
  TrendingUp,
  User,
  Wallet,
  XCircle,
} from "lucide-react";

import { getRFQ, getSupplierQuotations } from "../../api/sourcing";
import {
  getApprovalState,
} from "../../api/rfqApprovalWorkflow";
import { updateFinanceReviewStatus, addFinanceComment } from "../../api/financeReviews";
import { getBudgetKpis, BUDGET_EXCEEDED_WARNING } from "../../api/budget";
import type { BudgetKpis } from "../../api/budget";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDate } from "../../utils/format";
import { Skeleton } from "../../components/Skeleton";
import type {
  RFQ,
  SupplierQuotation,
  AIRecommendation,
  FinanceReviewStatus,
} from "../../types/erpnext";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function readSavedAnalysis(rfqName: string): AIRecommendation | null {
  try {
    const raw = localStorage.getItem(`rfq_analysis_${rfqName}`);
    if (!raw) return null;
    const record = JSON.parse(raw) as { analysis?: AIRecommendation };
    return record?.analysis ?? null;
  } catch {
    return null;
  }
}

const CHECKLIST_ITEMS = [
  { id: "budget", label: "Budget Availability", description: "Verify sufficient budget allocation in the relevant cost center" },
  { id: "forecast", label: "Spend Forecast Impact", description: "Assess impact on quarterly and annual spend forecasts" },
  { id: "compliance", label: "Financial Compliance", description: "Confirm transaction meets financial policies and controls" },
  { id: "approval_limits", label: "Approval Limits", description: "Verify the amount is within delegated authority limits" },
  { id: "cost_allocation", label: "Cost Allocation", description: "Confirm correct GL accounts and cost center mapping" },
  { id: "payment_terms", label: "Payment Terms Review", description: "Validate payment terms align with cash flow requirements" },
];

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function FinanceReviewDetailPage() {
  const { rfqId } = useParams<{ rfqId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const decodedId = rfqId ? decodeURIComponent(rfqId) : "";

  // eslint-disable-next-line no-console
  console.log("[FinanceReviewDetail] Route loaded", { rawParam: rfqId, decodedId });

  /* ── RFQ data (fetches from Request for Quotation) ── */
  const rfqQuery = useQuery<RFQ>({
    queryKey: ["rfq", decodedId],
    queryFn: async () => {
      // eslint-disable-next-line no-console
      console.log("[FinanceReviewDetail] Fetching RFQ:", decodedId);
      const data = await getRFQ(decodedId);
      // eslint-disable-next-line no-console
      console.log("[FinanceReviewDetail] RFQ loaded:", data?.name);
      return data;
    },
    enabled: !!decodedId,
    retry: false,
  });

  const sqQuery = useQuery<SupplierQuotation[]>({
    queryKey: ["supplier-quotations", decodedId],
    queryFn: () => getSupplierQuotations(decodedId),
    enabled: !!decodedId && !!rfqQuery.data,
  });

  const budgetQuery = useQuery<BudgetKpis>({
    queryKey: ["budget-kpis"],
    queryFn: getBudgetKpis,
  });

  const rfq = rfqQuery.data;
  const quotations = sqQuery.data ?? [];
  const rfqItems = rfq?.items ?? [];

  const approvalState = useMemo(() => {
    if (!decodedId) return null;
    return getApprovalState(decodedId);
  }, [decodedId, rfq]); // eslint-disable-line react-hooks/exhaustive-deps

  const aiAnalysis = useMemo(() => readSavedAnalysis(decodedId), [decodedId]);

  const selectedSupplier = approvalState?.selected_supplier;
  const selectedQuote = useMemo(
    () =>
      quotations.find(
        (q) =>
          q.supplier === selectedSupplier ||
          q.supplier_name === selectedSupplier
      ),
    [quotations, selectedSupplier]
  );

  /* ── Checklist ── */
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const checklistComplete = CHECKLIST_ITEMS.every((c) => checklist[c.id]);

  /* ── Notes ── */
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionReason, setActionReason] = useState("");

  /* ── Expanded sections ── */
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    summary: true,
    supplier: true,
    legal: true,
    ai: false,
    budget: true,
    checklist: true,
    notes: true,
    timeline: false,
    actions: true,
  });

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  /* ── Submission state ── */
  const [submitting, setSubmitting] = useState<FinanceReviewStatus | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const currentFinanceStatus = approvalState?.finance_status ?? "Pending Finance Review";

  useEffect(() => {
    if (currentFinanceStatus === "Pending Finance Review") {
      setSubmitted(false);
    } else if (currentFinanceStatus) {
      setSubmitted(true);
    }
  }, [currentFinanceStatus]);

  /* ── Comments ── */
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);

  const canSubmit = (action: string) => {
    if (submitted) return false;
    if (!checklistComplete) return false;
    if (!actionReason.trim()) return false;
    if (action === "reject" && actionReason.trim().length < 10) return false;
    return true;
  };

  const handleAction = useCallback(
    async (action: "approve" | "reject") => {
      const statusMap: Record<string, FinanceReviewStatus> = {
        approve: "Budget Approved",
        reject: "Rejected",
      };
      const status = statusMap[action];
      setSubmitting(status);

      const fullComment = [
        reviewNotes.trim() ? `Review Notes: ${reviewNotes.trim()}` : "",
        actionReason.trim(),
      ]
        .filter(Boolean)
        .join("\n\n");

      try {
        if (action === "approve") {
          const { checkBudgetForRFQ } = await import("../../api/budget");
          const check = await checkBudgetForRFQ(
            selectedQuote?.grand_total ?? approvalState?.selected_supplier_total ?? 0
          );
          if (!check.withinBudget) {
            toast(check.warning ?? BUDGET_EXCEEDED_WARNING, {
              icon: "⚠️",
              duration: 8000,
            });
          }
        }
        await updateFinanceReviewStatus(decodedId, status, user?.email ?? "", fullComment);
        const labels = { approve: "budget approved", reject: "rejected" };
        toast.success(`RFQ ${decodedId} ${labels[action]}`);
        setSubmitted(true);
      } catch {
        toast.error("Failed to update review status");
      } finally {
        setSubmitting(null);
      }
    },
    [decodedId, user?.email, reviewNotes, actionReason, selectedQuote, approvalState]
  );

  const handleAddComment = useCallback(async () => {
    if (!newComment.trim()) return;
    setAddingComment(true);
    try {
      addFinanceComment(decodedId, {
        comment: newComment.trim(),
        comment_by: user?.email ?? "",
        comment_date: new Date().toISOString(),
        action: "Comment",
      });
      toast.success("Comment added");
      setNewComment("");
    } catch {
      toast.error("Failed to add comment");
    } finally {
      setAddingComment(false);
    }
  }, [decodedId, newComment, user?.email]);

  /* ── Loading / error states ── */
  if (rfqQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-[600px] rounded-xl" />
      </div>
    );
  }

  if (rfqQuery.isError || !rfq) {
    const errMsg =
      rfqQuery.error instanceof Error
        ? rfqQuery.error.message
        : String(rfqQuery.error ?? "Unknown error");
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="mb-4 h-12 w-12 text-danger-400" />
        <h2 className="text-lg font-bold text-neutral-900">RFQ Not Found</h2>
        <p className="mt-2 max-w-md text-center text-sm text-neutral-600">{errMsg}</p>
        <button
          type="button"
          onClick={() => navigate("/budget/pending-reviews")}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to RFQ Financial Review
        </button>
      </div>
    );
  }

  // eslint-disable-next-line no-console
  console.log("[FinanceReviewDetail] Page rendered", { rfqName: rfq.name });

  const comments = approvalState?.finance_comments ?? [];
  const rfqValue = selectedQuote?.grand_total ?? approvalState?.selected_supplier_total ?? 0;
  const budgetKpis = budgetQuery.data;
  const budgetExceeded =
    !!budgetKpis &&
    budgetKpis.totalBudget > 0 &&
    rfqValue > budgetKpis.remainingBudget &&
    currentFinanceStatus === "Pending Finance Review";

  return (
    <div className="mx-auto max-w-5xl">
      {/* ── Header ── */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate("/budget/pending-reviews")}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition hover:text-primary cursor-pointer bg-transparent border-none p-0"
        >
          <ArrowLeft className="h-4 w-4" /> Back to RFQ Financial Review
        </button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
                <Wallet className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-neutral-900">
                  Finance Review Workspace
                </h1>
                <p className="text-sm text-neutral-500">{decodedId}</p>
              </div>
            </div>
          </div>
          <FinanceStatusBadge status={currentFinanceStatus} />
        </div>
      </div>

      {budgetExceeded && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-bold text-amber-900">{BUDGET_EXCEEDED_WARNING}</p>
            <p className="mt-0.5 text-xs text-amber-800">
              RFQ value {formatCurrency(rfqValue)} exceeds remaining budget{" "}
              {formatCurrency(budgetKpis!.remainingBudget)}. Finance must review and
              approve before PO creation.
            </p>
          </div>
        </div>
      )}

      {/* ── Reviewer / Timestamp Banner ── */}
      {approvalState?.finance_reviewer && submitted && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <User className="h-4 w-4 text-neutral-400" />
          <div className="text-sm text-neutral-600">
            Reviewed by{" "}
            <span className="font-semibold text-neutral-900">
              {approvalState.finance_reviewer}
            </span>
            {approvalState.finance_review_date && (
              <> on {formatDate(approvalState.finance_review_date)}</>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* ═══════════════ Section: RFQ Summary ═══════════════ */}
        <CollapsibleSection
          id="summary"
          icon={FileText}
          title="RFQ Summary"
          expanded={expandedSections.summary}
          onToggle={toggleSection}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoField label="RFQ Number" value={rfq.name} />
            <InfoField label="Requested By" value={rfq.owner} />
            <InfoField label="Transaction Date" value={formatDate(rfq.transaction_date)} />
            <InfoField label="Status" value={rfq.status ?? "Draft"} />
            <InfoField label="Company" value={rfq.company ?? "—"} />
            <InfoField label="RFQ Value" value={formatCurrency(rfqValue)} highlight />
          </div>

          {rfqItems.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Items ({rfqItems.length})
              </p>
              <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/50">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">Item</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-500">Qty</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">UOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfqItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-neutral-50 last:border-0">
                        <td className="px-3 py-2">
                          <p className="font-medium text-neutral-900">{item.item_code}</p>
                          {item.item_name && item.item_name !== item.item_code && (
                            <p className="text-xs text-neutral-500">{item.item_name}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{item.qty}</td>
                        <td className="px-3 py-2 text-neutral-600">{item.uom ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: Supplier & Quotation ═══════════════ */}
        <CollapsibleSection
          id="supplier"
          icon={Building2}
          title="Selected Supplier"
          expanded={expandedSections.supplier}
          onToggle={toggleSection}
        >
          {selectedSupplier ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoField label="Supplier" value={selectedSupplier} highlight />
              <InfoField
                label="Quotation Value"
                value={selectedQuote?.grand_total != null ? formatCurrency(selectedQuote.grand_total) : formatCurrency(rfqValue)}
                highlight
              />
              <InfoField label="Submitted By" value={approvalState?.submitted_by ?? "—"} />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              No supplier has been selected for this RFQ yet.
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: Legal Approval Summary ═══════════════ */}
        <CollapsibleSection
          id="legal"
          icon={Gavel}
          title="Legal Approval Summary"
          expanded={expandedSections.legal}
          onToggle={toggleSection}
          badge={
            approvalState?.legal_status === "Approved" ? (
              <span className="rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700">
                Approved
              </span>
            ) : (
              <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-700">
                {approvalState?.legal_status ?? "Pending"}
              </span>
            )
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoField label="Legal Status" value={approvalState?.legal_status ?? "—"} />
            <InfoField label="Reviewed By" value={approvalState?.legal_reviewer ?? "—"} />
            <InfoField label="Review Date" value={approvalState?.legal_review_date ? formatDate(approvalState.legal_review_date) : "—"} />
          </div>
          {(approvalState?.legal_comments ?? []).length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Legal Review Notes
              </p>
              <div className="space-y-2">
                {(approvalState?.legal_comments ?? []).map((c, idx) => (
                  <div key={idx} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                    <p className="text-sm text-neutral-700">{c.comment}</p>
                    <p className="mt-1 text-xs text-neutral-400">{c.comment_by} · {c.comment_date ? formatDate(c.comment_date) : ""}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: AI Finance Analysis ═══════════════ */}
        <CollapsibleSection
          id="ai"
          icon={Bot}
          title="AI Finance Analysis"
          expanded={expandedSections.ai}
          onToggle={toggleSection}
          badge={
            aiAnalysis ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                Analysis Available
              </span>
            ) : undefined
          }
        >
          {aiAnalysis ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <Bot className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">
                      AI Recommends: {aiAnalysis.recommended_supplier}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-neutral-600">
                      {aiAnalysis.recommendation_summary}
                    </p>
                    <p className="mt-2 text-xs text-neutral-500">
                      Confidence: {aiAnalysis.confidence_score}%
                    </p>
                  </div>
                </div>
              </div>
              {(aiAnalysis.risk_flags ?? []).length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Financial Risk Flags
                  </p>
                  <div className="space-y-2">
                    {(aiAnalysis.risk_flags ?? []).map((flag, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${
                          flag.severity === "high"
                            ? "border-danger-200 bg-danger-50 text-danger-800"
                            : flag.severity === "medium"
                            ? "border-warning-200 bg-warning-50 text-warning-800"
                            : "border-neutral-200 bg-neutral-50 text-neutral-700"
                        }`}
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        <span>{flag.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg bg-neutral-50 px-4 py-6 text-sm text-neutral-500">
              <Info className="h-5 w-5 flex-shrink-0" />
              No AI analysis has been performed for this RFQ yet.
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: Budget & Spend Analysis ═══════════════ */}
        <CollapsibleSection
          id="budget"
          icon={PieChart}
          title="Budget Availability & Spend Forecast"
          expanded={expandedSections.budget}
          onToggle={toggleSection}
        >
          {budgetQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-24 rounded-lg" />
            </div>
          ) : budgetQuery.data && budgetQuery.data.totalBudget > 0 ? (
            <BudgetAnalysisCards kpis={budgetQuery.data} rfqValue={rfqValue} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <BudgetCard icon={DollarSign} label="RFQ Value" value={formatCurrency(rfqValue)} tone="neutral" />
              <BudgetCard icon={Wallet} label="Budget Available" value="Budget data unavailable" tone="success" />
              <BudgetCard icon={TrendingUp} label="Spend Forecast Impact" value="Budget data unavailable" tone="warning" />
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: Finance Checklist ═══════════════ */}
        <CollapsibleSection
          id="checklist"
          icon={ShieldCheck}
          title="Finance Review Checklist"
          expanded={expandedSections.checklist}
          onToggle={toggleSection}
          badge={
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                checklistComplete
                  ? "bg-success-100 text-success-700"
                  : "bg-warning-100 text-warning-700"
              }`}
            >
              {Object.values(checklist).filter(Boolean).length}/{CHECKLIST_ITEMS.length}
            </span>
          }
        >
          <div className="space-y-2">
            {CHECKLIST_ITEMS.map((item) => (
              <label
                key={item.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${
                  checklist[item.id]
                    ? "border-success-200 bg-success-50/50"
                    : "border-neutral-200 bg-white hover:border-neutral-300"
                } ${submitted ? "pointer-events-none opacity-70" : ""}`}
              >
                <div className="pt-0.5">
                  <input
                    type="checkbox"
                    checked={!!checklist[item.id]}
                    onChange={(e) =>
                      setChecklist((prev) => ({ ...prev, [item.id]: e.target.checked }))
                    }
                    disabled={submitted}
                    className="h-4 w-4 rounded border-neutral-300 text-success-600 focus:ring-success-500"
                  />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${checklist[item.id] ? "text-success-800" : "text-neutral-900"}`}>
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">{item.description}</p>
                </div>
                {checklist[item.id] && (
                  <Check className="ml-auto mt-0.5 h-4 w-4 flex-shrink-0 text-success-600" />
                )}
              </label>
            ))}
          </div>
          {!checklistComplete && !submitted && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-xs font-medium text-warning-700">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              Complete all checklist items before submitting your review.
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: Review Notes ═══════════════ */}
        <CollapsibleSection
          id="notes"
          icon={MessageSquare}
          title="Finance Notes & Reasoning"
          expanded={expandedSections.notes}
          onToggle={toggleSection}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Review Notes <span className="text-neutral-400">(optional)</span>
              </label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="General observations about budget, cost allocation, or spend impact…"
                rows={3}
                disabled={submitted}
                className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-neutral-100 disabled:text-neutral-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Decision Reason <span className="text-danger-500">*</span>
              </label>
              <textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="Provide the reason for your budget approval or rejection. This is mandatory."
                rows={4}
                disabled={submitted}
                className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-neutral-100 disabled:text-neutral-500"
              />
              {!submitted && !actionReason.trim() && (
                <p className="mt-1 text-xs text-neutral-400">
                  You must provide a reason before any action can be taken.
                </p>
              )}
            </div>
          </div>
        </CollapsibleSection>

        {/* ═══════════════ Section: Audit History ═══════════════ */}
        <CollapsibleSection
          id="timeline"
          icon={Clock}
          title="Audit History & Comments"
          expanded={expandedSections.timeline}
          onToggle={toggleSection}
          badge={
            comments.length > 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {comments.length}
              </span>
            ) : undefined
          }
        >
          {/* Workflow timeline */}
          <div className="mb-4 space-y-3">
            <TimelineStep
              icon={Layers}
              label="RFQ Submitted for Review"
              date={approvalState?.submitted_at}
              by={approvalState?.submitted_by}
              active
            />
            <TimelineStep
              icon={Scale}
              label="Legal Review"
              date={approvalState?.legal_review_date}
              by={approvalState?.legal_reviewer}
              active={approvalState?.legal_status === "Approved"}
              status={approvalState?.legal_status === "Approved" ? "Approved" : undefined}
            />
            <TimelineStep
              icon={Wallet}
              label="Finance Review"
              date={approvalState?.finance_review_date}
              by={approvalState?.finance_reviewer}
              status={currentFinanceStatus !== "Pending Finance Review" ? currentFinanceStatus : undefined}
              active={currentFinanceStatus !== "Pending Finance Review"}
            />
            <TimelineStep
              icon={FileText}
              label="PO Creation"
              active={approvalState?.workflow_step === "PO Created"}
              dimmed={approvalState?.workflow_step !== "PO Created" && approvalState?.workflow_step !== "Approved for PO"}
            />
          </div>

          {/* Comments */}
          {comments.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Comments
              </p>
              {comments.map((c, idx) => (
                <div key={idx} className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                        {(c.comment_by?.[0] ?? "?").toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-neutral-900">{c.comment_by}</p>
                        <p className="text-[10px] text-neutral-400">{c.comment_date ? formatDate(c.comment_date) : ""}</p>
                      </div>
                    </div>
                    {c.action && c.action !== "Comment" && (
                      <ActionBadge action={c.action} />
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-700">{c.comment}</p>
                </div>
              ))}
            </div>
          )}

          {/* Add comment */}
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Add Comment
            </p>
            <div className="flex gap-2">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment or note…"
                rows={2}
                className="flex-1 resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={handleAddComment}
                disabled={!newComment.trim() || addingComment}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center self-end rounded-lg bg-primary text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addingComment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </CollapsibleSection>

        {/* ═══════════════ Section: Finance Actions ═══════════════ */}
        <CollapsibleSection
          id="actions"
          icon={Wallet}
          title="Finance Decision"
          expanded={expandedSections.actions}
          onToggle={toggleSection}
        >
          {submitted ? (
            <div className={`flex items-center gap-3 rounded-xl border px-5 py-4 ${
              currentFinanceStatus === "Budget Approved"
                ? "border-success-200 bg-success-50"
                : "border-danger-200 bg-danger-50"
            }`}>
              <StatusIcon status={currentFinanceStatus} />
              <div>
                <p className={`font-semibold ${
                  currentFinanceStatus === "Budget Approved"
                    ? "text-success-800"
                    : "text-danger-800"
                }`}>
                  {currentFinanceStatus === "Budget Approved"
                    ? "Budget Approved — Ready for PO Creation"
                    : "Finance Rejected"}
                </p>
                <p className="mt-0.5 text-sm text-neutral-600">
                  This review has been submitted.{" "}
                  {currentFinanceStatus === "Budget Approved" && "The RFQ is now ready for Purchase Order creation."}
                  {currentFinanceStatus === "Rejected" && "Procurement may edit and resubmit from the Rejected tab."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Submission Requirements
                </p>
                <div className="space-y-1.5">
                  <RequirementRow met={checklistComplete} label="All checklist items completed" />
                  <RequirementRow met={!!actionReason.trim()} label="Decision reason provided" />
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => handleAction("approve")}
                  disabled={!canSubmit("approve") || !!submitting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-success-600 px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-success-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting === "Budget Approved" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Approve Budget
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("reject")}
                  disabled={!canSubmit("reject") || !!submitting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-danger-600 px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-danger-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting === "Rejected" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  Reject Budget
                </button>
              </div>
            </div>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function CollapsibleSection({
  id, icon: Icon, title, expanded, onToggle, badge, children,
}: {
  id: string; icon: typeof FileText; title: string; expanded: boolean;
  onToggle: (id: string) => void; badge?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <button type="button" onClick={() => onToggle(id)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100">
          <Icon className="h-4 w-4 text-neutral-600" />
        </div>
        <span className="flex-1 text-sm font-bold text-neutral-900">{title}</span>
        {badge}
        {expanded ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
      </button>
      {expanded && <div className="border-t border-neutral-100 px-5 py-4">{children}</div>}
    </div>
  );
}

function InfoField({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      <p className={`mt-0.5 text-sm ${highlight ? "font-bold text-emerald-700" : "font-medium text-neutral-900"}`}>
        {value || "—"}
      </p>
    </div>
  );
}

function BudgetCard({
  icon: Icon, label, value, tone, subtitle,
}: {
  icon: typeof DollarSign; label: string; value: string; tone: "neutral" | "success" | "warning";
  subtitle?: string;
}) {
  const tones = { neutral: "border-neutral-200", success: "border-success-200 bg-success-50/30", warning: "border-warning-200 bg-warning-50/30" };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4 text-neutral-400" />
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      </div>
      <p className="text-xl font-bold tabular-nums text-neutral-900">{value}</p>
      {subtitle && <p className="mt-1 text-[11px] text-neutral-400">{subtitle}</p>}
    </div>
  );
}

function BudgetAnalysisCards({ kpis, rfqValue }: { kpis: BudgetKpis; rfqValue: number }) {
  const forecastUtilization =
    kpis.totalBudget > 0
      ? ((kpis.consumedBudget + rfqValue) / kpis.totalBudget) * 100
      : 0;
  const forecastPct = Math.round(forecastUtilization * 10) / 10;
  const exceedsBudget = rfqValue > kpis.remainingBudget;

  const impact: { label: string; color: string; bg: string; border: string } =
    forecastPct > 90
      ? { label: "High Impact", color: "text-danger-700", bg: "bg-danger-50/30", border: "border-danger-200" }
      : forecastPct >= 70
      ? { label: "Medium Impact", color: "text-warning-700", bg: "bg-warning-50/30", border: "border-warning-200" }
      : { label: "Low Impact", color: "text-success-700", bg: "bg-success-50/30", border: "border-success-200" };

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <BudgetCard icon={DollarSign} label="Total Budget" value={formatCurrency(kpis.totalBudget)} tone="neutral" />
        <BudgetCard icon={TrendingUp} label="Consumed Budget" value={formatCurrency(kpis.consumedBudget)} tone="warning" subtitle={`RFQ ${formatCurrency(kpis.approvedRfqValue)} + PO ${formatCurrency(kpis.approvedPoValue)}`} />
        <BudgetCard icon={Wallet} label="Remaining Budget" value={formatCurrency(kpis.remainingBudget)} tone="success" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BudgetCard icon={DollarSign} label="RFQ Value" value={formatCurrency(rfqValue)} tone="neutral" />
        <BudgetCard
          icon={Wallet}
          label="Budget Available"
          value={formatCurrency(kpis.remainingBudget)}
          tone={exceedsBudget ? "warning" : "success"}
          subtitle={`of ${formatCurrency(kpis.totalBudget)} total budget`}
        />
        <BudgetCard
          icon={PieChart}
          label="Budget Utilization"
          value={`${kpis.utilizationPct}%`}
          tone={kpis.utilizationPct >= 90 ? "warning" : "neutral"}
          subtitle={`${formatCurrency(kpis.consumedBudget)} consumed`}
        />
        <div className={`rounded-lg border p-4 ${impact.border} ${impact.bg}`}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-neutral-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Spend Forecast Impact</p>
          </div>
          <p className={`text-xl font-bold tabular-nums ${impact.color}`}>
            {forecastPct}%
          </p>
          <p className={`mt-1 text-[11px] font-semibold ${impact.color}`}>
            {impact.label}
          </p>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold text-neutral-700">Current Utilization</span>
          <span className="font-bold text-neutral-900">{kpis.utilizationPct}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full rounded-full transition-all ${
              kpis.utilizationPct >= 90 ? "bg-red-500" : kpis.utilizationPct >= 70 ? "bg-amber-500" : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(kpis.utilizationPct, 100)}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="font-semibold text-neutral-700">Forecast After This RFQ</span>
          <span className={`font-bold ${impact.color}`}>{forecastPct}%</span>
        </div>
        <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full rounded-full transition-all ${
              forecastPct > 90 ? "bg-red-500" : forecastPct >= 70 ? "bg-amber-500" : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(forecastPct, 100)}%` }}
          />
        </div>
      </div>
    </>
  );
}

function FinanceStatusBadge({ status }: { status: FinanceReviewStatus }) {
  const config: Record<FinanceReviewStatus, { icon: typeof Clock; className: string; label: string }> = {
    "Pending Finance Review": { icon: Clock, className: "bg-warning-100 text-warning-700 ring-warning-200", label: "Pending Review" },
    "Budget Approved": { icon: CheckCircle2, className: "bg-success-100 text-success-700 ring-success-200", label: "Budget Approved" },
    Rejected: { icon: XCircle, className: "bg-danger-100 text-danger-700 ring-danger-200", label: "Finance Rejected" },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${c.className}`}>
      <Icon className="h-3.5 w-3.5" /> {c.label}
    </span>
  );
}

function StatusIcon({ status }: { status: FinanceReviewStatus }) {
  if (status === "Budget Approved") return <CheckCircle2 className="h-6 w-6 text-success-600" />;
  if (status === "Rejected") return <XCircle className="h-6 w-6 text-danger-600" />;
  return <Clock className="h-6 w-6 text-warning-600" />;
}

function ActionBadge({ action }: { action: FinanceReviewStatus | "Comment" | "Resubmit" }) {
  const cls =
    action === "Budget Approved" ? "bg-success-100 text-success-700"
    : action === "Rejected" ? "bg-danger-100 text-danger-700"
    : action === "Resubmit" ? "bg-primary-100 text-primary-700"
    : "bg-neutral-100 text-neutral-600";
  const label =
    action === "Budget Approved" ? "Approved"
    : action === "Resubmit" ? "Resubmit"
    : action;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      {label}
    </span>
  );
}

function TimelineStep({
  icon: Icon, label, date, by, status, active, dimmed,
}: {
  icon: typeof Clock; label: string; date?: string; by?: string;
  status?: string; active?: boolean; dimmed?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 ${dimmed ? "opacity-40" : ""}`}>
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
        active ? "bg-emerald-100 text-emerald-600" : "bg-neutral-100 text-neutral-400"
      }`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 pt-1">
        <p className="text-sm font-semibold text-neutral-900">{label}</p>
        {(date || by || status) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            {by && <span>{by}</span>}
            {date && <span>{formatDate(date)}</span>}
            {status && (
              <span className="rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700">
                {status === "Budget Approved" ? "Approved" : status}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RequirementRow({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {met ? <CheckCircle2 className="h-4 w-4 text-success-500" /> : <XCircle className="h-4 w-4 text-neutral-300" />}
      <span className={met ? "text-neutral-700" : "text-neutral-400"}>{label}</span>
    </div>
  );
}
