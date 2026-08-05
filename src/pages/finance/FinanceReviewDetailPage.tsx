import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Plus,
  Scale,
  ShieldCheck,
  TrendingUp,
  User,
  Wallet,
  XCircle,
} from "lucide-react";

import { getRFQ, getSupplierQuotations } from "../../api/sourcing";
import { getLegalDocsByRfq, type LegalDocumentSet } from "../../api/legalDocs";
import { invalidateApprovalWorkflow } from "../../api/approvalWorkflow";
import { updateFinanceReviewStatus } from "../../api/financeReviews";
import {
  getRfqBudgetCheckByCostCenter,
  getActiveBudgetsForFiscalYear,
  BUDGET_EXCEEDED_WARNING,
} from "../../api/budget";
import { assignBudgetToRfq } from "../../api/rfqBudgetAssignment";
import { getLatestAnalysisSnapshot } from "../../api/supplierScoringResults";
import type {
  RfqCostCenterBudgetCheck,
  BudgetForecastStatus,
  AssignableBudgetOption,
} from "../../api/budget";
import { useAuthStore } from "../../store/authStore";
import { formatRfqOwnerFromDoc } from "../../config/roles";
import { formatCurrency, formatDate } from "../../utils/format";
import { Skeleton } from "../../components/Skeleton";
import SlaStageBadge from "../../components/sla/SlaStageBadge";
import type {
  RFQ,
  SupplierQuotation,
  AIRecommendation,
  FinanceReviewStatus,
  LegalReviewStatus,
  FinanceComment,
} from "../../types/erpnext";

/**
 * Lightweight adapter shape built from the ERPNext `Legal Document Review`
 * record (the single source of truth for both Legal and Finance verdicts).
 * Keeps the rest of this page's JSX unchanged — only the data source moved
 * from RFQ custom fields / localStorage to the Legal Document Review DocType.
 */
interface FinanceWorkspaceState {
  legalDocName: string;
  selected_supplier?: string;
  selected_supplier_total: number;
  submitted_by?: string;
  submitted_at?: string;
  legal_status: LegalReviewStatus;
  legal_reviewer?: string;
  legal_review_date?: string;
  legal_comments: FinanceComment[];
  finance_status: FinanceReviewStatus;
  finance_reviewer?: string;
  finance_review_date?: string;
  finance_comments: FinanceComment[];
  workflow_step: string;
}

function mapLegalStatus(status: LegalDocumentSet["review_status"]): LegalReviewStatus {
  if (status === "Approved") return "Approved";
  if (status === "Rejected") return "Rejected";
  return "Pending Legal Review";
}

function mapFinanceStatus(status?: LegalDocumentSet["finance_status"]): FinanceReviewStatus {
  if (status === "Approved") return "Budget Approved";
  if (status === "Rejected") return "Rejected";
  return "Pending Finance Review";
}

function toWorkspaceState(doc: LegalDocumentSet): FinanceWorkspaceState {
  const legalStatus = mapLegalStatus(doc.review_status);
  const financeStatus = mapFinanceStatus(doc.finance_status);
  return {
    legalDocName: doc.name ?? "",
    selected_supplier: doc.supplier,
    selected_supplier_total: doc.grand_total ?? 0,
    submitted_by: doc.procurement_manager,
    submitted_at: doc.submission_date,
    legal_status: legalStatus,
    legal_reviewer: doc.approved_by,
    legal_review_date: doc.approved_on,
    legal_comments: doc.legal_comments
      ? [{ comment: doc.legal_comments, comment_by: doc.approved_by ?? "", comment_date: doc.approved_on ?? "" }]
      : [],
    finance_status: financeStatus,
    finance_reviewer: doc.finance_approved_by,
    finance_review_date: doc.finance_approved_on,
    finance_comments: doc.finance_comments
      ? [
          {
            comment: doc.finance_comments,
            comment_by: doc.finance_approved_by ?? "",
            comment_date: doc.finance_approved_on ?? "",
            action: financeStatus,
          },
        ]
      : [],
    workflow_step:
      financeStatus === "Budget Approved"
        ? "Approved for PO"
        : financeStatus === "Rejected"
          ? "Finance Rejected"
          : legalStatus === "Approved"
            ? "Pending Finance Review"
            : legalStatus === "Rejected"
              ? "Legal Rejected"
              : "Pending Legal Review",
  };
}

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

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  /** Auto items are verified from live ERPNext data; manual items are the
   *  reviewer's judgement call. */
  auto: boolean;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: "budget_availability", label: "Budget Availability", description: "An active budget governs this cost center and has funds remaining", auto: true },
  { id: "cost_center", label: "Cost Center", description: "Cost center is resolved and mapped to a GL budget account", auto: true },
  { id: "budget_limit", label: "Budget Limit", description: "This RFQ value stays within the allocated budget limit", auto: true },
  { id: "approval_authority", label: "Approval Authority", description: "Reviewer holds finance approval authority for this decision", auto: true },
  { id: "financial_compliance", label: "Financial Compliance", description: "Transaction meets financial policies, controls and payment terms", auto: false },
  { id: "final_approval", label: "Final Approval", description: "Confirm the final budget approval decision", auto: false },
];

const FINANCE_APPROVER_ROLES = ["finance", "finance_executive", "admin"];

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function FinanceReviewDetailPage() {
  const { rfqId } = useParams<{ rfqId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  const rfq = rfqQuery.data;
  const quotations = sqQuery.data ?? [];
  const rfqItems = rfq?.items ?? [];

  /* ── Legal Document Review — the single ERPNext source of truth for both
   * the Legal verdict and the Finance verdict on this RFQ. ── */
  const legalDocQuery = useQuery({
    queryKey: ["legal-document-review", "by-rfq", decodedId],
    queryFn: () => getLegalDocsByRfq(decodedId),
    enabled: !!decodedId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const legalDoc = legalDocQuery.data ?? null;
  const approvalState = useMemo<FinanceWorkspaceState | null>(
    () => (legalDoc ? toWorkspaceState(legalDoc) : null),
    [legalDoc]
  );
  const legalApprovedForFinance = approvalState?.legal_status === "Approved";

  const [aiAnalysis, setAiAnalysis] = useState<AIRecommendation | null>(() =>
    readSavedAnalysis(decodedId)
  );
  useEffect(() => {
    const cached = readSavedAnalysis(decodedId);
    setAiAnalysis(cached);
    // Cross-device fallback — see LegalReviewDetailPage for rationale.
    if (!cached && decodedId) {
      getLatestAnalysisSnapshot<{ analysis?: AIRecommendation }>(decodedId)
        .then((snapshot) => {
          if (snapshot?.analysis) setAiAnalysis(snapshot.analysis);
        })
        .catch(() => {
          /* best-effort */
        });
    }
  }, [decodedId]);

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

  const rfqValueForBudget =
    selectedQuote?.grand_total ?? approvalState?.selected_supplier_total ?? 0;

  // Always load the budget picture from ERPNext once the RFQ is available —
  // even before a supplier is selected — so Department, Cost Center, Budget and
  // Fiscal Year are shown live (never as placeholder dashes).
  const budgetCheckQuery = useQuery({
    queryKey: ["rfq-budget-check-by-cost-center", decodedId, rfqValueForBudget],
    queryFn: () => getRfqBudgetCheckByCostCenter(rfq!, rfqValueForBudget),
    enabled: !!rfq,
    // Re-run automatically when the reviewer returns after creating/assigning a
    // budget, so the checklist and validations appear without a manual reload.
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  /* ── Checklist ── */
  // Manual items only live in local state; auto items are derived from ERPNext.
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const budgetCheckData = budgetCheckQuery.data;
  const autoChecks = useMemo<Record<string, boolean>>(() => {
    const b = budgetCheckData;
    const found = !!b?.found;
    return {
      budget_availability: found && (b?.availableBudget ?? 0) > 0,
      cost_center: !!b?.costCenter && !!b?.budgetAccount,
      budget_limit: found && !!b?.withinBudget,
      approval_authority: FINANCE_APPROVER_ROLES.includes(user?.role ?? ""),
    };
  }, [budgetCheckData, user?.role]);

  const isChecklistItemDone = useCallback(
    (item: ChecklistItem) => (item.auto ? !!autoChecks[item.id] : !!checklist[item.id]),
    [autoChecks, checklist]
  );

  const autoComplete = CHECKLIST_ITEMS.filter((c) => c.auto).every(
    (c) => autoChecks[c.id]
  );
  const manualComplete = CHECKLIST_ITEMS.filter((c) => !c.auto).every(
    (c) => checklist[c.id]
  );
  const checklistComplete = autoComplete && manualComplete;
  const checklistDoneCount = CHECKLIST_ITEMS.filter(isChecklistItemDone).length;

  // Whether an active ERPNext budget is linked to this RFQ. Until one exists the
  // Finance Review Checklist is hidden entirely (its budget validations are not
  // applicable yet) and approval stays disabled.
  const hasBudget = !!budgetCheckData?.found;
  const budgetResolved = !budgetCheckQuery.isLoading;
  const budgetMissing = budgetResolved && !hasBudget;

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

  /* ── Manual budget assignment modal ── */
  const [assignOpen, setAssignOpen] = useState(false);

  const currentFinanceStatus = approvalState?.finance_status ?? "Pending Finance Review";

  useEffect(() => {
    if (currentFinanceStatus === "Pending Finance Review") {
      setSubmitted(false);
    } else if (currentFinanceStatus) {
      setSubmitted(true);
    }
  }, [currentFinanceStatus]);

  const canSubmit = (action: string) => {
    if (submitted) return false;
    if (!legalApprovedForFinance) return false;
    if (!actionReason.trim()) return false;
    // A rejection is always allowed (e.g. over-budget) as long as a reason is
    // given; approval requires every checklist item — auto + manual — to pass.
    if (action === "reject") return actionReason.trim().length >= 10;
    // Approval requires an assigned budget plus every checklist item (auto +
    // manual). Without a budget the auto validations are not applicable.
    return hasBudget && checklistComplete;
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
        if (action === "approve" && budgetCheckQuery.data?.found && !budgetCheckQuery.data.withinBudget) {
          toast(BUDGET_EXCEEDED_WARNING, {
            icon: "⚠️",
            duration: 8000,
          });
        }
        await updateFinanceReviewStatus(
          decodedId,
          status,
          user?.email ?? "",
          fullComment,
          action === "reject" ? actionReason.trim() : undefined
        );
        await legalDocQuery.refetch();
        // Refresh Legal + Finance queues/counters from the shared workflow.
        invalidateApprovalWorkflow(queryClient);
        const labels = { approve: "budget approved", reject: "rejected" };
        toast.success(`RFQ ${decodedId} ${labels[action]}`);
        setSubmitted(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update review status");
      } finally {
        setSubmitting(null);
      }
    },
    [decodedId, user?.email, reviewNotes, actionReason, budgetCheckQuery.data, legalDocQuery, queryClient]
  );

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
  const budgetCheck = budgetCheckQuery.data;
  const budgetExceeded =
    !!budgetCheck?.found &&
    !budgetCheck.withinBudget &&
    legalApprovedForFinance &&
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
              <p className="text-sm font-semibold text-neutral-700">{decodedId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SlaStageBadge
              workflow="Finance Review"
              referenceDoctype="Request for Quotation"
              referenceName={rfq.name}
              open={currentFinanceStatus === "Pending Finance Review"}
            />
            <FinanceStatusBadge status={currentFinanceStatus} />
          </div>
        </div>
      </div>

      {!legalApprovedForFinance && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <Gavel className="mt-0.5 h-5 w-5 flex-shrink-0 text-neutral-400" />
          <div>
            <p className="text-sm font-bold text-neutral-800">Awaiting Legal Approval</p>
            <p className="mt-0.5 text-xs text-neutral-600">
              This RFQ has not yet been approved by Legal Review. Finance decisions are only
              available once Legal Review approves the selected supplier's quotation.
            </p>
          </div>
        </div>
      )}

      {budgetExceeded && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-bold text-amber-900">{BUDGET_EXCEEDED_WARNING}</p>
            <p className="mt-0.5 text-xs text-amber-800">
              RFQ value {formatCurrency(rfqValue)} exceeds remaining budget{" "}
              {formatCurrency(budgetCheck?.remainingBudget ?? 0)}. Finance must review and
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
            <InfoField label="Requested By" value={formatRfqOwnerFromDoc(rfq)} />
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
          {budgetCheckQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-24 rounded-lg" />
            </div>
          ) : budgetCheckQuery.data?.found ? (
            <BudgetAnalysisCards check={budgetCheckQuery.data} />
          ) : (
            <NoActiveBudget
              check={budgetCheckQuery.data}
              rfqValue={rfqValue}
              onCreateBudget={() => navigate(buildBudgetCreatePath(budgetCheckQuery.data))}
              onAssignBudget={() => setAssignOpen(true)}
            />
          )}
        </CollapsibleSection>

        {/* Budget not yet linked — the Finance Review Checklist is not applicable
            until a budget is created or assigned. */}
        {budgetMissing && (
          <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Finance review will become available after a budget has been created
            or assigned.
          </div>
        )}

        {/* ═══════════════ Section: Finance Checklist ═══════════════ */}
        {!budgetMissing && (
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
              {checklistDoneCount}/{CHECKLIST_ITEMS.length}
            </span>
          }
        >
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] font-medium text-neutral-500">
            <Info className="h-3.5 w-3.5 flex-shrink-0" />
            Budget Availability, Cost Center, Budget Limit and Approval Authority
            are verified automatically from live data. Only Financial Compliance and
            Final Approval are manual.
          </div>
          <div className="space-y-2">
            {CHECKLIST_ITEMS.map((item) => {
              const done = isChecklistItemDone(item);
              if (item.auto) {
                const pending = budgetCheckQuery.isLoading;
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
                      done
                        ? "border-success-200 bg-success-50/50"
                        : pending
                          ? "border-neutral-200 bg-neutral-50"
                          : "border-danger-200 bg-danger-50/40"
                    }`}
                  >
                    <div className="pt-0.5">
                      {pending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                      ) : done ? (
                        <CheckCircle2 className="h-4 w-4 text-success-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-danger-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-sm font-semibold ${
                            done ? "text-success-800" : "text-neutral-900"
                          }`}
                        >
                          {item.label}
                        </p>
                        <span className="rounded-full bg-neutral-200/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neutral-500">
                          Auto
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-500">{item.description}</p>
                    </div>
                    <span
                      className={`ml-auto mt-0.5 flex-shrink-0 text-[11px] font-bold ${
                        done ? "text-success-600" : pending ? "text-neutral-400" : "text-danger-600"
                      }`}
                    >
                      {pending ? "Checking…" : done ? "Verified" : "Attention"}
                    </span>
                  </div>
                );
              }
              return (
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
              );
            })}
          </div>
          {!checklistComplete && !submitted && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-xs font-medium text-warning-700">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              {autoComplete
                ? "Complete the manual checklist items (Financial Compliance, Final Approval) before approving."
                : "Automatic budget verification must pass before this RFQ can be approved. You can still reject with a reason."}
            </div>
          )}
        </CollapsibleSection>
        )}

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
                  <RequirementRow met={legalApprovedForFinance} label="Legal Review approved" />
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

      <AssignBudgetModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        rfqName={decodedId}
        fiscalYear={budgetCheck?.fiscalYear}
        company={budgetCheck?.company ?? rfq.company}
        assignedBy={user?.email}
        onAssigned={() => {
          setAssignOpen(false);
          void budgetCheckQuery.refetch();
        }}
      />
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

function BudgetAnalysisCards({ check }: { check: RfqCostCenterBudgetCheck }) {
  const statusTone: Record<BudgetForecastStatus, string> = {
    Green: "text-success-700 bg-success-50 border-success-200",
    Yellow: "text-amber-700 bg-amber-50 border-amber-200",
    Red: "text-danger-700 bg-danger-50 border-danger-200",
  };
  const statusLabel: Record<BudgetForecastStatus, string> = {
    Green: "Within Budget",
    Yellow: "Near Limit",
    Red: "Exceeded",
  };
  const forecastStatus = check.forecastStatus ?? "Green";

  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoField label="Department" value={check.department || "Not specified"} />
        <InfoField label="Cost Center" value={check.costCenter || "Not specified"} />
        <InfoField label="Fiscal Year" value={check.fiscalYear || "Not specified"} />
        <InfoField label="Budget Account" value={check.budgetAccount || "Not specified"} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <BudgetCard icon={DollarSign} label="Budget Amount" value={formatCurrency(check.allocatedBudget ?? 0)} tone="neutral" subtitle={check.budgetName} />
        <BudgetCard icon={TrendingUp} label="Actual Spend" value={formatCurrency(check.actualSpend ?? 0)} tone="warning" />
        <BudgetCard icon={Wallet} label="Available Budget" value={formatCurrency(check.availableBudget ?? 0)} tone="success" subtitle="= Budget − Actual Spend" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BudgetCard icon={PieChart} label="Budget Utilization" value={`${check.budgetUtilizationPct ?? 0}%`} tone="neutral" subtitle="Before this RFQ" />
        <BudgetCard icon={DollarSign} label="RFQ Value" value={formatCurrency(check.rfqValue)} tone="neutral" />
        <BudgetCard
          icon={TrendingUp}
          label="Spend Forecast"
          value={`${check.spendForecastPct ?? 0}%`}
          tone={forecastStatus === "Green" ? "success" : "warning"}
          subtitle="(Actual + RFQ) / Budget"
        />
        <div className={`rounded-lg border p-4 ${statusTone[forecastStatus]}`}>
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Budget Status</p>
          <p className="mt-1 text-lg font-bold">{statusLabel[forecastStatus]}</p>
        </div>
      </div>

      <div className="mt-4">
        <BudgetCard
          icon={Wallet}
          label="Remaining Budget after RFQ Approval"
          value={formatCurrency(check.forecastImpact ?? 0)}
          tone={(check.forecastImpact ?? 0) >= 0 ? "success" : "warning"}
          subtitle={
            (check.forecastImpact ?? 0) >= 0
              ? "Funds left once this RFQ is committed"
              : "This RFQ would exceed the available budget"
          }
        />
      </div>
    </>
  );
}

/** ERPNext-driven "no budget" state — never bare dashes, always the real reason. */
function NoActiveBudget({
  check,
  rfqValue,
  onCreateBudget,
  onAssignBudget,
}: {
  check?: RfqCostCenterBudgetCheck;
  rfqValue: number;
  onCreateBudget: () => void;
  onAssignBudget: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm font-bold text-warning-800">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        No Active Budget Found
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoField label="Department" value={check?.department || "Not assigned"} />
        <InfoField label="Cost Center" value={check?.costCenter || "Not assigned"} />
        <InfoField label="Fiscal Year" value={check?.fiscalYear || "Not assigned"} />
        <BudgetCard icon={DollarSign} label="RFQ Value" value={formatCurrency(rfqValue)} tone="neutral" />
      </div>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Reason</p>
        <p className="mt-1 text-sm text-neutral-700">
          {check?.noBudgetMessage ??
            "No approved or active budget governs this cost center."}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onCreateBudget}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Create Budget
        </button>
        <button
          type="button"
          onClick={onAssignBudget}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-5 py-3 text-sm font-bold text-primary shadow-sm transition hover:bg-primary/5"
        >
          <Building2 className="h-4 w-4" /> Assign Budget
        </button>
      </div>
    </div>
  );
}

/**
 * Manual "Assign Budget" picker — lists every Active ERPNext Budget for the
 * RFQ's fiscal year, lets the Finance Manager choose one, persists the choice
 * on the RFQ (live ERPNext), then triggers an automatic refresh so the assigned
 * budget loads immediately. Live data only — no mock records.
 */
function AssignBudgetModal({
  open,
  onClose,
  rfqName,
  fiscalYear,
  company,
  assignedBy,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  rfqName: string;
  fiscalYear?: string;
  company?: string;
  assignedBy?: string;
  onAssigned: () => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const optionsQuery = useQuery<AssignableBudgetOption[]>({
    queryKey: ["assignable-budgets", fiscalYear, company],
    queryFn: () => getActiveBudgetsForFiscalYear(fiscalYear, company),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) setSelected("");
  }, [open]);

  if (!open) return null;

  const options = optionsQuery.data ?? [];

  const handleAssign = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await assignBudgetToRfq(rfqName, selected, assignedBy);
      toast.success("Budget assigned — loading availability…");
      onAssigned();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign budget");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-neutral-900">Assign Active Budget</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="mb-3 text-xs text-neutral-500">
            Showing Active budgets{fiscalYear ? ` for fiscal year ${fiscalYear}` : ""}.
            Select one to govern this RFQ.
          </p>

          {optionsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
          ) : options.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              No Active budgets found{fiscalYear ? ` for ${fiscalYear}` : ""}. Create a
              budget first.
            </div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-auto">
              {options.map((b) => (
                <label
                  key={b.name}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 transition ${
                    selected === b.name
                      ? "border-primary bg-primary/5"
                      : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="assign-budget"
                      checked={selected === b.name}
                      onChange={() => setSelected(b.name)}
                      className="h-4 w-4 text-primary focus:ring-primary"
                    />
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">{b.name}</p>
                      <p className="text-xs text-neutral-500">
                        {b.costCenter || "—"} · {b.fiscalYear}
                        {b.status === "Active" ? " · Active" : ` · ${b.status}`}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-neutral-700">
                    {formatCurrency(b.budgetAmount)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-neutral-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={!selected || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Assign Budget
          </button>
        </div>
      </div>
    </div>
  );
}

/** Prefill the Budget create page with the resolved cost center / fiscal year. */
function buildBudgetCreatePath(check?: RfqCostCenterBudgetCheck): string {
  const params = new URLSearchParams();
  if (check?.costCenter) params.set("costCenter", check.costCenter);
  if (check?.department) params.set("department", check.department);
  if (check?.fiscalYear) params.set("fiscalYear", check.fiscalYear);
  const qs = params.toString();
  return qs ? `/budget/create?${qs}` : "/budget/create";
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
