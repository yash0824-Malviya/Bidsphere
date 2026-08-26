import { useState, useMemo, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  DollarSign,
  CheckCircle2,
  XCircle,
  Paperclip,
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
  Lock,
  AlertTriangle,
  Calculator,
  TrendingUp,
  Briefcase,
  Check,
  Send,
} from "lucide-react";

import {
  fetchBusinessCaseById,
  fetchBusinessNeedById,
  approveFinanceReview,
  approveLegalReview,
  rejectBusinessCaseAtFinance,
  rejectBusinessCaseAtLegal,
  requestFinanceRevision,
  requestLegalRevision,
  resubmitBusinessCaseRevision,
  markProcurementReady,
  linkRfqToBusinessCase,
  saveBusinessCaseFinancials,
} from "../../api/businessIntake";
import { calculateBusinessCaseFinancials } from "../../utils/financialCalculations";
import type { FinanceGateBlocker, FinanceChecklistState } from "../../types/businessIntake";
import { IntakeWorkflowTimeline } from "../../components/intake/IntakeWorkflowTimeline";
import { IntakeApprovalBadge } from "../../components/intake/IntakeApprovalBadge";
import { CreateRFQFromBusinessCaseModal } from "../../components/intake/CreateRFQFromBusinessCaseModal";
import { FinanceGateApprovalWorkspace } from "../../components/intake/FinanceGateApprovalWorkspace";
import { TechnicalRequirementsEditor } from "../../components/intake/TechnicalRequirementsEditor";
import { formatCurrency } from "../../utils/format";
import { useAuthStore } from "../../store/authStore";

type TabId =
  | "overview"
  | "financials"
  | "technical"
  | "strategy"
  | "risk"
  | "documents"
  | "review-submit"
  | "history"
  | "rfqs"
  | "related";

export default function BusinessCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [commentText, setCommentText] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [revisionNotes, setRevisionNotes] = useState("");
  const [actionModal, setActionModal] = useState<"none" | "reject" | "revision" | "resubmit">("none");
  const [isRfqModalOpen, setIsRfqModalOpen] = useState(false);

  // Resubmit fields
  const [editJustification, setEditJustification] = useState("");
  const [editBudget, setEditBudget] = useState<number | "">("");

  // Interactive Financial Assumptions Form State
  const [finCapex, setFinCapex] = useState<number | "">("");
  const [finOpex, setFinOpex] = useState<number | "">("");
  const [finSavings, setFinSavings] = useState<number | "">("");
  const [finRevenue, setFinRevenue] = useState<number | "">("");
  const [finCostAvoid, setFinCostAvoid] = useState<number | "">("");
  const [finDuration, setFinDuration] = useState<number | "">("");
  const [finDiscountRate, setFinDiscountRate] = useState<number | "">("");
  const [finSuccessMsg, setFinSuccessMsg] = useState("");
  const [finErrorMsg, setFinErrorMsg] = useState("");

  // Finance Gate Checklist State
  const [financeChecklist, setFinanceChecklist] = useState<FinanceChecklistState>({
    budgetVerified: false,
    capexOpexVerified: false,
    financialAssumptionsReviewed: false,
    requiredDocumentsReviewed: false,
    requiredSignaturesVerified: false,
    businessJustificationReviewed: false,
    financialFeasibilityConfirmed: false,
  });

  const { data: businessCase, isLoading } = useQuery({
    queryKey: ["business-case", id],
    queryFn: () => fetchBusinessCaseById(id || ""),
    enabled: Boolean(id),
  });

  const { data: need } = useQuery({
    queryKey: ["business-need", businessCase?.business_need_id],
    queryFn: () => fetchBusinessNeedById(businessCase?.business_need_id || ""),
    enabled: Boolean(businessCase?.business_need_id),
  });

  // Source-of-truth budget & currency (derived from Business Case or linked Business Need)
  const displayBudget = useMemo(() => {
    if (businessCase?.budget && businessCase.budget > 0) return businessCase.budget;
    if (need?.estimated_budget && need.estimated_budget > 0) return need.estimated_budget;
    return 0;
  }, [businessCase?.budget, need?.estimated_budget]);

  const displayCurrency = businessCase?.currency || need?.currency || "USD";

  // Sync financial form state from ERPNext Business Case data
  useEffect(() => {
    if (businessCase) {
      setFinCapex(businessCase.capex > 0 ? businessCase.capex : displayBudget > 0 ? displayBudget : "");
      setFinOpex(businessCase.opex ?? 0);
      setFinSavings(businessCase.expected_annual_savings ?? businessCase.expected_savings ?? 0);
      setFinRevenue(businessCase.revenue_increase ?? 0);
      setFinCostAvoid(businessCase.cost_avoidance ?? 0);
      setFinDuration(businessCase.project_duration ?? 5);
      setFinDiscountRate(businessCase.discount_rate ?? 10);
    }
  }, [businessCase, displayBudget]);

  const saveFinancialsMutation = useMutation({
    mutationFn: async () => {
      if (!businessCase) return;
      return saveBusinessCaseFinancials(businessCase.business_case_id || businessCase.name, {
        capex: finCapex === "" ? 0 : Number(finCapex),
        opex: finOpex === "" ? 0 : Number(finOpex),
        expected_annual_savings: finSavings === "" ? 0 : Number(finSavings),
        revenue_increase: finRevenue === "" ? 0 : Number(finRevenue),
        cost_avoidance: finCostAvoid === "" ? 0 : Number(finCostAvoid),
        project_duration: finDuration === "" ? 5 : Number(finDuration),
        discount_rate: finDiscountRate === "" ? 10 : Number(finDiscountRate),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      setFinSuccessMsg("Financial calculations and multi-year cash flows saved to ERPNext.");
      setFinErrorMsg("");
      toast.success("Financial calculations saved to ERPNext!");
      setTimeout(() => setFinSuccessMsg(""), 4000);
    },
    onError: (err: unknown) => {
      const msg = (err as Error)?.message || "Failed to calculate and save financials.";
      setFinErrorMsg(msg);
      toast.error(msg);
    },
  });

  // Authoritative or derived cash flows from ERPNext
  const effectiveCashFlows = useMemo(() => {
    if (businessCase?.cash_flows && businessCase.cash_flows.length > 0) {
      return businessCase.cash_flows;
    }
    const c = Number(finCapex !== "" ? finCapex : businessCase?.capex ?? displayBudget);
    const o = Number(finOpex !== "" ? finOpex : businessCase?.opex ?? 0);
    const s = Number(finSavings !== "" ? finSavings : businessCase?.expected_annual_savings ?? 0);
    const r = Number(finRevenue !== "" ? finRevenue : businessCase?.revenue_increase ?? 0);
    const a = Number(finCostAvoid !== "" ? finCostAvoid : businessCase?.cost_avoidance ?? 0);
    const d = Number(finDuration !== "" ? finDuration : businessCase?.project_duration ?? 5);
    const dr = Number(finDiscountRate !== "" ? finDiscountRate : businessCase?.discount_rate ?? 10);

    const calc = calculateBusinessCaseFinancials({
      capex: c,
      opex: o,
      expected_annual_savings: s,
      revenue_increase: r,
      cost_avoidance: a,
      project_duration: d,
      discount_rate: dr,
    });
    return calc.cash_flows;
  }, [businessCase, displayBudget, finCapex, finOpex, finSavings, finRevenue, finCostAvoid, finDuration, finDiscountRate]);

  const isFinancialIncomplete = useMemo(() => {
    if (!businessCase) return true;
    const grossBenefit =
      Number(businessCase.expected_annual_savings ?? businessCase.expected_savings ?? 0) +
      Number(businessCase.revenue_increase ?? 0) +
      Number(businessCase.cost_avoidance ?? 0);
    return businessCase.financial_calculation_status === "Incomplete" || grossBenefit === 0;
  }, [businessCase]);

  const financeBlockers: FinanceGateBlocker[] = useMemo(() => {
    if (!businessCase) return [];
    const list: FinanceGateBlocker[] = [];

    if (!displayBudget || displayBudget <= 0) {
      list.push({ code: "MISSING_BUDGET", message: "Total Budget is missing or $0. An estimated budget must be specified." });
    }
    if (isFinancialIncomplete || businessCase.financial_calculation_status === "Invalid") {
      list.push({ code: "FINANCIAL_CALC_INCOMPLETE", message: "Financial analysis calculations are incomplete (annual benefits required) or invalid." });
    }
    if (!financeChecklist.budgetVerified) {
      list.push({ code: "CHECKLIST_BUDGET", message: "Finance Checklist: Budget allocation and sufficiency is unchecked." });
    }
    if (!financeChecklist.capexOpexVerified) {
      list.push({ code: "CHECKLIST_CAPEX_OPEX", message: "Finance Checklist: CAPEX/OPEX classification is unchecked." });
    }
    if (!financeChecklist.financialAssumptionsReviewed) {
      list.push({ code: "CHECKLIST_ASSUMPTIONS", message: "Finance Checklist: ROI/NPV/financial assumptions review is unchecked." });
    }
    if (!financeChecklist.requiredDocumentsReviewed) {
      list.push({ code: "CHECKLIST_DOCUMENTS", message: "Finance Checklist: Supporting documents & specifications review is unchecked." });
    }
    if (!financeChecklist.requiredSignaturesVerified) {
      list.push({ code: "CHECKLIST_SIGNATURES", message: "Finance Checklist: Required e-signatures & approvals verification is unchecked." });
    }
    if (!financeChecklist.businessJustificationReviewed) {
      list.push({ code: "CHECKLIST_JUSTIFICATION", message: "Finance Checklist: Business problem & justification validation is unchecked." });
    }
    if (!financeChecklist.financialFeasibilityConfirmed) {
      list.push({ code: "CHECKLIST_FEASIBILITY", message: "Finance Checklist: Financial feasibility confirmation is unchecked." });
    }

    for (const doc of businessCase.supporting_documents || []) {
      if (doc.signature_required && doc.signature_status === "Pending") {
        list.push({ code: "SIGNATURE_PENDING", message: `Digital signature is pending for "${doc.name}".` });
      }
      if (doc.signature_required && doc.signature_status === "Invalid") {
        list.push({ code: "SIGNATURE_INVALID", message: `Digital signature verification failed for "${doc.name}".` });
      }
    }

    return list;
  }, [businessCase, financeChecklist, displayBudget]);

  if (isLoading) {
    return <div className="p-8 text-center text-neutral-500">Loading Business Case details...</div>;
  }

  if (!businessCase) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-bold text-neutral-900">Business Case Not Found</h2>
        <Link to="/intake/business-cases" className="mt-2 text-sm text-primary-600 hover:underline inline-block">
          Return to Business Cases List
        </Link>
      </div>
    );
  }

  const role = user?.role || "department";

  // Gate Action Permissions
  const canFinanceAct =
    (role === "finance" || role === "finance_executive" || role === "admin") &&
    businessCase.workflow_status === "Pending Finance Review" &&
    businessCase.finance_status === "Pending";

  const canLegalAct =
    (role === "legal" || role === "admin") &&
    businessCase.workflow_status === "Pending Legal Review" &&
    businessCase.finance_status === "Approved" &&
    businessCase.legal_status === "Pending";

  const canProcurementMarkReady =
    (role === "procurement" || role === "procurement_team" || role === "admin") &&
    businessCase.workflow_status === "Pending Procurement" &&
    businessCase.finance_status === "Approved" &&
    businessCase.legal_status === "Approved";

  const canResubmitRevision =
    (role === "department" || role === "admin") &&
    (businessCase.workflow_status === "Revision Required - Finance" ||
      businessCase.workflow_status === "Revision Required - Legal");

  const canProcurementCreateRfq =
    (role === "procurement" || role === "procurement_team" || role === "admin") &&
    (businessCase.workflow_status === "Procurement Ready" ||
      businessCase.workflow_status === "Approved - Ready for RFQ") &&
    businessCase.finance_status === "Approved" &&
    businessCase.legal_status === "Approved" &&
    !businessCase.rfq_id;

  // Handlers
  const handleFinanceApprove = async () => {
    if (financeBlockers.length > 0) {
      toast.error(`Finance Gate Approval Blocked: ${financeBlockers[0].message}`);
      return;
    }
    const payload = {
      business_case: businessCase.business_case_id,
      action: "approve_finance",
      comments: commentText || "Financial analysis verified and budget approved.",
      reviewer_email: user?.email || "finance@netlink.com",
      role,
      checklist: financeChecklist,
    };
    if (import.meta.env.DEV) {
      console.log("[FinanceGate:ApproveRequest] Sending Finance approval request:", {
        endpoint: "/api/method/frappe.client.set_value (or businessIntake.approveFinanceReview)",
        payload,
      });
    }
    try {
      const result = await approveFinanceReview(
        businessCase.business_case_id,
        payload.comments,
        payload.reviewer_email,
        role,
        financeChecklist,
      );
      if (import.meta.env.DEV) {
        console.log("[FinanceGate:ApproveResponse] Approval succeeded:", {
          status: 200,
          response: result,
        });
      }
      toast.success("Finance Gate approved successfully.");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["business-need"] });
      setCommentText("");
    } catch (err: unknown) {
      if (import.meta.env.DEV) {
        console.error("[FinanceGate:ApproveError] Approval failed:", err);
      }
      const errMsg = err instanceof Error ? err.message : "Finance Gate approval failed.";
      toast.error(errMsg);
    }
  };

  const handleFinanceReject = async () => {
    if (!rejectReason.trim()) return;
    try {
      await rejectBusinessCaseAtFinance(
        businessCase.business_case_id,
        rejectReason,
        user?.email || "finance@netlink.com",
        role
      );
      toast.success("Business Case rejected at Finance stage.");
      setActionModal("none");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Rejection failed.");
    }
  };

  const handleFinanceRevision = async () => {
    if (!revisionNotes.trim()) return;
    try {
      await requestFinanceRevision(
        businessCase.business_case_id,
        revisionNotes,
        user?.email || "finance@netlink.com",
        role
      );
      toast.success("Revision requested from Finance. Returned to Business Owner.");
      setActionModal("none");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Revision request failed.");
    }
  };

  const handleLegalApprove = async () => {
    const payload = {
      business_case: businessCase.business_case_id,
      action: "approve_legal",
      comments: commentText || "Legal terms and compliance verified.",
      reviewer_email: user?.email || "legal@netlink.com",
      role,
    };
    if (import.meta.env.DEV) {
      console.log("[LegalGate:ApproveRequest] Sending Legal approval request:", {
        endpoint: "/api/method/frappe.client.set_value (or businessIntake.approveLegalReview)",
        payload,
      });
    }
    try {
      const result = await approveLegalReview(
        businessCase.business_case_id,
        payload.comments,
        payload.reviewer_email,
        role
      );
      if (import.meta.env.DEV) {
        console.log("[LegalGate:ApproveResponse] Approval succeeded:", {
          status: 200,
          response: result,
        });
      }
      toast.success("Legal Gate Approved! Business Case moved to Procurement Review.");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      setCommentText("");
    } catch (err: unknown) {
      if (import.meta.env.DEV) {
        console.error("[LegalGate:ApproveError] Approval failed:", err);
      }
      const errMsg = err instanceof Error ? err.message : "Legal approval failed.";
      toast.error(errMsg);
    }
  };

  const handleLegalReject = async () => {
    if (!rejectReason.trim()) return;
    try {
      await rejectBusinessCaseAtLegal(
        businessCase.business_case_id,
        rejectReason,
        user?.email || "legal@netlink.com",
        role
      );
      toast.success("Business Case rejected at Legal stage.");
      setActionModal("none");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Rejection failed.");
    }
  };

  const handleLegalRevision = async () => {
    if (!revisionNotes.trim()) return;
    try {
      await requestLegalRevision(
        businessCase.business_case_id,
        revisionNotes,
        user?.email || "legal@netlink.com",
        role
      );
      toast.success("Revision requested from Legal. Returned to Business Owner.");
      setActionModal("none");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Revision request failed.");
    }
  };

  const handleProcurementMarkReady = async () => {
    try {
      await markProcurementReady(
        businessCase.business_case_id,
        commentText || "Procurement review complete. Case is ready for RFQ creation.",
        user?.email || "procurement@netlink.com",
        role
      );
      toast.success("Business Case marked as Procurement Ready! RFQ creation unlocked.");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      setCommentText("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Procurement action failed.");
    }
  };

  const handleConfirmResubmit = async () => {
    try {
      await resubmitBusinessCaseRevision(
        businessCase.business_case_id,
        {
          business_justification: editJustification || businessCase.business_justification,
          budget: editBudget ? Number(editBudget) : businessCase.budget,
        },
        user?.email || "department@netlink.com",
        role
      );
      toast.success("Business Case updated and resubmitted for review!");
      setActionModal("none");
      queryClient.invalidateQueries({ queryKey: ["business-case", id] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Resubmission failed.");
    }
  };

  const handleCreateRfqSubmit = async () => {
    const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;
    await linkRfqToBusinessCase(
      businessCase.business_case_id,
      rfqNumber,
      user?.email || "procurement@netlink.com",
      role
    );
    toast.success(`RFQ ${rfqNumber} successfully created and linked!`);
    queryClient.invalidateQueries({ queryKey: ["business-case", id] });
    navigate(`/sourcing/rfq/${rfqNumber}`);
  };

  const isFinanceReviewStage =
    canFinanceAct ||
    businessCase.workflow_status === "Pending Finance Review" ||
    businessCase.finance_status === "Pending";

  return (
    <div className="space-y-6 px-6 lg:px-8 py-6 pb-32">
      {/* Back Link */}
      <div>
        <Link
          to="/intake/business-cases"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Business Cases
        </Link>
      </div>

      {/* Header Banner (Shown when not in dedicated Finance Gate workspace) */}
      {!isFinanceReviewStage && (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-primary-700">{businessCase.business_case_id}</span>
                <IntakeApprovalBadge status={businessCase.workflow_status} size="md" />
                {businessCase.is_locked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700">
                    <Lock className="h-3 w-3 text-neutral-500" />
                    Approved Record (Locked)
                  </span>
                )}
              </div>
              <h1 className="mt-1 text-xl font-bold text-neutral-900">{businessCase.title}</h1>
              <p className="mt-1 text-xs text-neutral-500">
                Linked Need: <Link to={`/intake/business-needs/${businessCase.business_need_id}`} className="font-mono text-primary-600 hover:underline">{businessCase.business_need_id}</Link> | Dept: <span className="font-semibold text-neutral-700">{businessCase.department}</span> | Owner: <span className="font-semibold text-neutral-700">{businessCase.business_owner}</span> | Rev #{businessCase.revision_number || 1}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {canResubmitRevision && (
                <button
                  onClick={() => {
                    setEditJustification(businessCase.business_justification);
                    setEditBudget(businessCase.budget);
                    setActionModal("resubmit");
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700"
                >
                  <RefreshCw className="h-4 w-4" />
                  Update & Resubmit Revision
                </button>
              )}

              {canProcurementCreateRfq && (
                <button
                  onClick={() => setIsRfqModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700"
                >
                  <Sparkles className="h-4 w-4" />
                  Create RFQ
                </button>
              )}

              {businessCase.rfq_id && (
                <Link
                  to={`/sourcing/rfq/${businessCase.rfq_id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-100"
                >
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  Linked RFQ: {businessCase.rfq_id}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lifecycle Timeline */}
      <IntakeWorkflowTimeline need={need} businessCase={businessCase} />

      {/* Finance Gate Approval Workspace */}
      {isFinanceReviewStage && (
        <FinanceGateApprovalWorkspace
          businessCase={businessCase}
          need={need}
          displayBudget={displayBudget}
          displayCurrency={displayCurrency}
          financeChecklist={financeChecklist}
          setFinanceChecklist={setFinanceChecklist}
          financeBlockers={financeBlockers}
          commentText={commentText}
          setCommentText={setCommentText}
          onApprove={handleFinanceApprove}
          onRequestRevision={() => setActionModal("revision")}
          onReject={() => setActionModal("reject")}
          onNavigateToFinancials={() => setActiveTab("financials")}
          canAct={canFinanceAct}
          role={role}
        />
      )}

      {/* Legal Gate Action Bar */}
      {canLegalAct && (
        <div className="rounded-xl border border-purple-300 bg-purple-50/80 p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-purple-200 pb-2 mb-3">
            <ShieldCheck className="h-5 w-5 text-purple-700" />
            <h3 className="text-sm font-bold text-purple-900">Legal & Compliance Gate Review</h3>
          </div>
          <p className="text-xs text-purple-800">
            Review procurement strategy ({businessCase.procurement_strategy}), technical specs, risk assessment, and legal terms. Approving will forward the case to Procurement for RFQ creation.
          </p>

          <textarea
            rows={2}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Enter Legal comments..."
            className="mt-3 w-full rounded-lg border border-purple-300 bg-white p-2.5 text-xs focus:border-purple-500 focus:outline-none"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={handleLegalApprove}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-4 w-4" />
              Approve Legal Gate & Ready for Procurement
            </button>

            <button
              onClick={() => setActionModal("revision")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700"
            >
              <RefreshCw className="h-4 w-4" />
              Request Revision
            </button>

            <button
              onClick={() => setActionModal("reject")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              <XCircle className="h-4 w-4" />
              Reject Case
            </button>
          </div>
        </div>
      )}

      {/* Procurement Gate Action Bar: Mark Procurement Ready */}
      {canProcurementMarkReady && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 border-b border-amber-200 pb-2">
            <Briefcase className="h-5 w-5 text-amber-700" />
            <h3 className="text-sm font-bold text-amber-900">Procurement Queue Review</h3>
          </div>
          <p className="text-xs text-amber-800">
            Finance and Legal approvals are complete. As Procurement Manager, review the procurement strategy and specifications, then mark the case as <strong>Procurement Ready</strong> to unlock RFQ creation.
          </p>
          <textarea
            rows={2}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Enter Procurement review comments..."
            className="w-full rounded-lg border border-amber-300 bg-white p-2.5 text-xs focus:border-amber-500 focus:outline-none"
          />
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleProcurementMarkReady}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Procurement Ready
            </button>
          </div>
        </div>
      )}

      {/* Summary Financial Matrix (Shown when not in Finance Gate review workspace) */}
      {!isFinanceReviewStage && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase text-neutral-500">Total Budget</span>
            <p className="mt-1 text-lg font-bold text-neutral-900">
              {displayBudget > 0 ? formatCurrency(displayBudget) : <span className="text-neutral-400 text-sm font-normal">Not provided</span>}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase text-neutral-500">CAPEX / OPEX</span>
            <p className="mt-1 text-xs font-bold text-neutral-800">
              {businessCase.capex > 0 || businessCase.opex > 0 ? `${formatCurrency(businessCase.capex)} / ${formatCurrency(businessCase.opex)}` : <span className="text-neutral-400 font-normal">Not provided</span>}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase text-neutral-500">Expected ROI</span>
            <p className="mt-1 text-lg font-bold text-emerald-600">
              {businessCase.roi > 0 ? `${businessCase.roi}%` : <span className="text-neutral-400 text-sm font-normal">Not provided</span>}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase text-neutral-500">NPV / IRR</span>
            <p className="mt-1 text-xs font-bold text-primary-900">
              {businessCase.npv > 0 || businessCase.irr > 0 ? `${formatCurrency(businessCase.npv)} (${businessCase.irr}%)` : <span className="text-neutral-400 font-normal">Not provided</span>}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase text-neutral-500">Payback Period</span>
            <p className="mt-1 text-xs font-bold text-neutral-900">
              {businessCase.payback_period && businessCase.payback_period !== "Not provided" && businessCase.payback_period !== "Standard"
                ? businessCase.payback_period
                : displayBudget === 0
                ? "0 Months"
                : <span className="text-neutral-400 font-normal">Not provided</span>}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold uppercase text-neutral-500">Projected Savings</span>
            <p className="mt-1 text-lg font-bold text-indigo-700">
              {businessCase.expected_savings > 0 ? formatCurrency(businessCase.expected_savings) : <span className="text-neutral-400 text-sm font-normal">Not provided</span>}
            </p>
          </div>
        </div>
      )}

      {/* 7-Step Workflow Navigation Tabs */}
      <div className="flex overflow-x-auto border-b border-neutral-200 bg-white px-2 rounded-t-xl">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === "overview"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          1. Overview
        </button>
        <button
          onClick={() => setActiveTab("financials")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === "financials"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          2. Financial Analysis
          {isFinancialIncomplete && (
            <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" title="Annual benefits required" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("technical")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === "technical"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          3. Technical Requirements
        </button>
        <button
          onClick={() => setActiveTab("strategy")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === "strategy"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          4. Procurement Strategy
        </button>
        <button
          onClick={() => setActiveTab("risk")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === "risk"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          5. Risk &amp; Compliance
        </button>
        <button
          onClick={() => setActiveTab("documents")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === "documents"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          6. Documents ({businessCase.supporting_documents.length})
        </button>
        <button
          onClick={() => setActiveTab("review-submit")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === "review-submit"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          7. Review &amp; Submit
          {isFinancialIncomplete ? (
            <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
          ) : (
            <Check className="h-3 w-3 text-emerald-600" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === "history"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          Approval History ({businessCase.approval_history.length})
        </button>
        <button
          onClick={() => setActiveTab("rfqs")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === "rfqs"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          Linked RFQs ({businessCase.rfq_id ? 1 : 0})
        </button>
        <button
          onClick={() => setActiveTab("related")}
          className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === "related"
              ? "border-primary-600 text-primary-600 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          Related Records
        </button>
      </div>

      {/* Tab Panels */}
      <div className="rounded-b-xl border border-t-0 border-neutral-200 bg-white p-6 shadow-sm">
        {/* Tab 1: Overview */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* AI Business Case Summary Card (Assistant Only) */}
            <div className="rounded-xl border border-indigo-200 bg-linear-to-r from-indigo-50/70 via-purple-50/40 to-white p-4.5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-indigo-950 uppercase tracking-wider">AI Business Case Summary</h4>
                    <span className="text-[11px] text-indigo-700">Synthesized contextual assessment (Advisory only — requires human review)</span>
                  </div>
                </div>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-800 border border-indigo-200">
                  AI Assistant
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-neutral-800">
                <div className="rounded-lg bg-white/90 p-3 border border-indigo-100 shadow-xs">
                  <span className="font-bold text-indigo-900 block text-[11px] uppercase">1. Executive Summary</span>
                  <p className="mt-1 text-neutral-700 leading-relaxed">
                    {businessCase.executive_summary || `Procurement intake requirement initiated by ${businessCase.department || "Business Unit"} for ${businessCase.title || "commercial purchase"}.`}
                  </p>
                </div>

                <div className="rounded-lg bg-white/90 p-3 border border-indigo-100 shadow-xs">
                  <span className="font-bold text-indigo-900 block text-[11px] uppercase">2. Business Problem</span>
                  <p className="mt-1 text-neutral-700 leading-relaxed">
                    {businessCase.business_problem || need?.problem_statement || "Operational requirement identified requiring external supplier sourcing."}
                  </p>
                </div>

                <div className="rounded-lg bg-white/90 p-3 border border-indigo-100 shadow-xs">
                  <span className="font-bold text-indigo-900 block text-[11px] uppercase">3. Business Objective & Financial Context</span>
                  <p className="mt-1 text-neutral-700 leading-relaxed">
                    {businessCase.business_objective || need?.expected_benefits || "Meet operational demands through structured procurement."}
                    {" "}
                    {displayBudget > 0
                      ? `Allocated budget: ${formatCurrency(displayBudget)} (${displayCurrency}).`
                      : "Financial information not provided."}
                  </p>
                </div>

                <div className="rounded-lg bg-white/90 p-3 border border-indigo-100 shadow-xs">
                  <span className="font-bold text-indigo-900 block text-[11px] uppercase">4. Expected Outcome & Recommendation</span>
                  <p className="mt-1 text-neutral-700 leading-relaxed">
                    {businessCase.recommendation || `Proceed with standard commercial RFQ workflow for ${businessCase.need_type || "Direct"} procurement per departmental requirements.`}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase text-neutral-500">Executive Summary</h4>
              <p className="mt-1 text-xs text-neutral-800 leading-relaxed">
                {businessCase.executive_summary || businessCase.business_justification || <span className="text-neutral-400 font-normal">Not provided</span>}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase text-neutral-500">Business Objective</h4>
              <p className="mt-1 text-xs text-neutral-800 leading-relaxed">
                {businessCase.business_objective || businessCase.expected_outcome || <span className="text-neutral-400 font-normal">Not provided</span>}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase text-neutral-500">Business Justification</h4>
              <p className="mt-1 text-xs text-neutral-800 leading-relaxed">
                {businessCase.business_justification || <span className="text-neutral-400 font-normal">Not provided</span>}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase text-neutral-500">Business Problem</h4>
              <p className="mt-1 text-xs text-neutral-800 leading-relaxed">
                {businessCase.business_problem || <span className="text-neutral-400 font-normal">Not provided</span>}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs font-bold uppercase text-neutral-500">Current Situation</h4>
                <p className="mt-1 text-xs text-neutral-700">
                  {businessCase.current_situation || <span className="text-neutral-400 font-normal">Not provided</span>}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase text-neutral-500">Expected Outcome</h4>
                <p className="mt-1 text-xs text-neutral-700">
                  {businessCase.expected_outcome || <span className="text-neutral-400 font-normal">Not provided</span>}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs font-bold uppercase text-neutral-500">Alternatives Considered</h4>
                <p className="mt-1 text-xs text-neutral-700">
                  {businessCase.alternatives_considered || <span className="text-neutral-400 font-normal">Not provided</span>}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase text-neutral-500">Recommendation</h4>
                <p className="mt-1 text-xs font-semibold text-neutral-900">
                  {businessCase.recommendation || <span className="text-neutral-400 font-normal">Not provided</span>}
                </p>
              </div>
            </div>

            {/* Step Navigation */}
            <div className="flex justify-end pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setActiveTab("financials")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 cursor-pointer shadow-xs transition-colors"
              >
                Next: 2. Financial Analysis &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Financial Analysis */}
        {activeTab === "financials" && (
          <div className="space-y-6">
            {/* Section A: Financial Assumptions Form */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                    <Calculator className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-neutral-900">Financial Assumptions & Inputs</h3>
                    <p className="text-xs text-neutral-500">Provide assumptions to calculate deterministic ROI, NPV, IRR, Payback, and Cash Flows.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold border ${
                      businessCase.financial_calculation_status === "Calculated" && (Number(businessCase.expected_annual_savings ?? businessCase.expected_savings ?? 0) + Number(businessCase.revenue_increase ?? 0) + Number(businessCase.cost_avoidance ?? 0)) > 0
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : businessCase.financial_calculation_status === "Invalid"
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {businessCase.financial_calculation_status === "Calculated" && (Number(businessCase.expected_annual_savings ?? businessCase.expected_savings ?? 0) + Number(businessCase.revenue_increase ?? 0) + Number(businessCase.cost_avoidance ?? 0)) > 0 ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                    Status: {businessCase.financial_calculation_status === "Calculated" && (Number(businessCase.expected_annual_savings ?? businessCase.expected_savings ?? 0) + Number(businessCase.revenue_increase ?? 0) + Number(businessCase.cost_avoidance ?? 0)) === 0 ? "Incomplete" : (businessCase.financial_calculation_status || "Incomplete")}
                  </span>
                </div>
              </div>

              {((Number(finSavings) || 0) + (Number(finRevenue) || 0) + (Number(finCostAvoid) || 0)) === 0 && (
                <div className="rounded-lg bg-amber-50 p-3.5 text-xs text-amber-900 border border-amber-200 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Financial benefit inputs required</span>
                    <span className="text-[11.5px] text-amber-800">
                      Enter at least one expected annual benefit (Annual Savings, Revenue Increase, or Cost Avoidance) to calculate ROI, NPV, IRR, and Payback.
                    </span>
                  </div>
                </div>
              )}

              {finSuccessMsg && (
                <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>{finSuccessMsg}</span>
                </div>
              )}

              {finErrorMsg && (
                <div className="rounded-lg bg-red-50 p-3 text-xs text-red-800 border border-red-200 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                  <span>{finErrorMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">
                    CAPEX (Initial Investment) ({displayCurrency}) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={finCapex}
                    onChange={(e) => setFinCapex(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 200000"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">
                    OPEX / Year ({displayCurrency}) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={finOpex}
                    onChange={(e) => setFinOpex(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 20000"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">
                    Expected Annual Savings ({displayCurrency}) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={finSavings}
                    onChange={(e) => setFinSavings(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 70000"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">
                    Revenue Increase / Year ({displayCurrency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={finRevenue}
                    onChange={(e) => setFinRevenue(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 30000"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">
                    Cost Avoidance / Year ({displayCurrency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={finCostAvoid}
                    onChange={(e) => setFinCostAvoid(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 10000"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">
                    Project Duration (Years) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={finDuration}
                    onChange={(e) => setFinDuration(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 5"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">
                    Discount Rate (%) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={finDiscountRate}
                    onChange={(e) => setFinDiscountRate(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 10"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Dedicated Action Row */}
              <div className="flex items-center justify-end pt-4 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => saveFinancialsMutation.mutate()}
                  disabled={saveFinancialsMutation.isPending}
                  className="rounded-lg bg-primary-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                >
                  {saveFinancialsMutation.isPending ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Calculating &amp; Saving...
                    </>
                  ) : (
                    <>
                      <Calculator className="h-3.5 w-3.5" />
                      Calculate &amp; Save to ERPNext
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Section B: Calculated Financial Results Summary OR Zero-Benefit State */}
            {businessCase.financial_calculation_status === "Incomplete" || ((Number(businessCase.expected_annual_savings ?? businessCase.expected_savings ?? 0) + Number(businessCase.revenue_increase ?? 0) + Number(businessCase.cost_avoidance ?? 0)) === 0) ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-6 shadow-sm space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                    <AlertTriangle className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-950">Financial Analysis Incomplete</h4>
                    <p className="text-xs text-amber-800 mt-0.5">
                      No measurable annual financial benefit has been provided.
                    </p>
                  </div>
                </div>
                <div className="rounded-lg bg-white/80 border border-amber-200 p-4 text-xs text-neutral-800 space-y-2">
                  <p className="font-semibold text-neutral-900">Add at least one expected annual benefit:</p>
                  <ul className="list-disc list-inside space-y-1 text-neutral-700 pl-1">
                    <li><strong>Expected Annual Savings</strong> (operational expenditure reductions)</li>
                    <li><strong>Revenue Increase / Year</strong> (new gross income or margin gains)</li>
                    <li><strong>Cost Avoidance / Year</strong> (mitigated penalties, avoided maintenance, prevented losses)</li>
                  </ul>
                  <p className="text-[11.5px] text-neutral-500 pt-1">
                    ROI, NPV, IRR, and Payback cannot be meaningfully calculated until financial benefits are provided.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-neutral-200 bg-linear-to-r from-blue-50/40 via-indigo-50/20 to-white p-5 shadow-sm space-y-3">
                <div className="flex items-center gap-2 border-b border-blue-100 pb-2.5">
                  <TrendingUp className="h-4 w-4 text-primary-600" />
                  <h4 className="text-xs font-bold uppercase text-neutral-800">Calculated Financial Metrics (Deterministic Model)</h4>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Total Investment</span>
                    <span className="font-bold text-neutral-900 text-sm mt-0.5 block">
                      {businessCase.total_investment ? formatCurrency(businessCase.total_investment) : displayBudget > 0 ? formatCurrency(displayBudget) : "$0.00"}
                    </span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Annual Gross Benefit</span>
                    <span className="font-bold text-neutral-800 text-sm mt-0.5 block">
                      {businessCase.annual_gross_benefit !== undefined ? formatCurrency(businessCase.annual_gross_benefit) : "Not calculated"}
                    </span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Annual Net Benefit</span>
                    <span className="font-bold text-neutral-800 text-sm mt-0.5 block">
                      {businessCase.annual_net_benefit !== undefined ? formatCurrency(businessCase.annual_net_benefit) : "Not calculated"}
                    </span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Total Net Benefit</span>
                    <span className="font-bold text-indigo-700 text-sm mt-0.5 block">
                      {businessCase.total_net_benefit !== undefined ? formatCurrency(businessCase.total_net_benefit) : "Not calculated"}
                    </span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Net Project Gain</span>
                    <span className="font-bold text-emerald-700 text-sm mt-0.5 block">
                      {businessCase.net_project_gain !== undefined ? formatCurrency(businessCase.net_project_gain) : "Not calculated"}
                    </span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">ROI (Return on Investment)</span>
                    <span className="font-bold text-emerald-600 text-sm mt-0.5 block">
                      {businessCase.roi_formatted || (businessCase.roi ? `${businessCase.roi}%` : "Not Applicable")}
                    </span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">NPV (Net Present Value)</span>
                    <span className="font-bold text-primary-900 text-sm mt-0.5 block">
                      {businessCase.npv_formatted || formatCurrency(businessCase.npv || 0)}
                    </span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">IRR (Internal Rate of Return)</span>
                    <span className="font-bold text-neutral-900 text-sm mt-0.5 block">
                      {businessCase.irr_formatted || (businessCase.irr ? `${businessCase.irr}%` : "Not Available")}
                    </span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Payback Period</span>
                    <span className="font-bold text-neutral-900 text-sm mt-0.5 block">
                      {businessCase.payback_period || "Not Available"}
                    </span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-neutral-200 shadow-xs">
                    <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Discount Rate</span>
                    <span className="font-semibold text-neutral-800 text-sm mt-0.5 block">
                      {businessCase.discount_rate !== undefined ? `${businessCase.discount_rate}%` : "10%"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Section C: Yearly Cash Flow Child Table (Year 0..N) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase text-neutral-700 flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                  Multi-Year Cash Flow Breakdown (Year 0 → Year {businessCase.project_duration || finDuration || 5})
                </h4>
                <span className="text-[11px] text-neutral-500">
                  {effectiveCashFlows.length} Periods modeled
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                    <tr>
                      <th className="p-2.5">Year</th>
                      <th className="p-2.5 text-right">Beg. Balance</th>
                      <th className="p-2.5 text-right">Investment</th>
                      <th className="p-2.5 text-right">Annual Savings</th>
                      <th className="p-2.5 text-right">Revenue Inc.</th>
                      <th className="p-2.5 text-right">Cost Avoid.</th>
                      <th className="p-2.5 text-right">OPEX</th>
                      <th className="p-2.5 text-right">Gross Benefit</th>
                      <th className="p-2.5 text-right font-bold">Net Benefit</th>
                      <th className="p-2.5 text-right">Disc. Factor</th>
                      <th className="p-2.5 text-right font-bold text-primary-900">DCF</th>
                      <th className="p-2.5 text-right font-bold text-neutral-900">Cum. Cash Flow</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {effectiveCashFlows.length > 0 ? (
                      effectiveCashFlows.map((row, idx) => (
                        <tr key={idx} className={row.year === 0 ? "bg-neutral-50/70 font-semibold" : "hover:bg-neutral-50"}>
                          <td className="p-2.5 font-bold text-neutral-900 whitespace-nowrap">
                            {row.year === 0 ? "Year 0 (Initial)" : `Year ${row.year}`}
                          </td>
                          <td className="p-2.5 text-right text-neutral-600 whitespace-nowrap">
                            {row.year === 0 ? "—" : formatCurrency(row.beginning_balance)}
                          </td>
                          <td className="p-2.5 text-right text-red-600 whitespace-nowrap">
                            {row.investment > 0 ? formatCurrency(row.investment) : "—"}
                          </td>
                          <td className="p-2.5 text-right text-emerald-700 whitespace-nowrap">
                            {row.annual_savings > 0 ? formatCurrency(row.annual_savings) : "—"}
                          </td>
                          <td className="p-2.5 text-right text-emerald-700 whitespace-nowrap">
                            {row.revenue_increase > 0 ? formatCurrency(row.revenue_increase) : "—"}
                          </td>
                          <td className="p-2.5 text-right text-emerald-700 whitespace-nowrap">
                            {row.cost_avoidance > 0 ? formatCurrency(row.cost_avoidance) : "—"}
                          </td>
                          <td className="p-2.5 text-right text-neutral-600 whitespace-nowrap">
                            {row.opex > 0 ? formatCurrency(row.opex) : "—"}
                          </td>
                          <td className="p-2.5 text-right text-neutral-800 whitespace-nowrap">
                            {row.annual_gross_benefit > 0 ? formatCurrency(row.annual_gross_benefit) : "—"}
                          </td>
                          <td className={`p-2.5 text-right font-bold whitespace-nowrap ${row.annual_net_benefit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                            {formatCurrency(row.annual_net_benefit)}
                          </td>
                          <td className="p-2.5 text-right text-neutral-500 whitespace-nowrap">
                            {row.discount_factor.toFixed(4)}
                          </td>
                          <td className={`p-2.5 text-right font-bold whitespace-nowrap ${row.discounted_cash_flow < 0 ? "text-red-600" : "text-primary-800"}`}>
                            {formatCurrency(row.discounted_cash_flow)}
                          </td>
                          <td className={`p-2.5 text-right font-bold whitespace-nowrap ${row.cumulative_cash_flow < 0 ? "text-red-600" : "text-emerald-700"}`}>
                            {formatCurrency(row.cumulative_cash_flow)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={12} className="p-4 text-center text-neutral-500 italic">
                          Provide financial assumptions above and click "Calculate & Save" to generate the multi-year cash flow model.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Review Status Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-neutral-200 p-4 bg-white">
                <span className="text-xs font-semibold text-neutral-500 uppercase block">Finance Status</span>
                <span className="text-sm font-bold text-neutral-900 mt-1 block">{businessCase.finance_status}</span>
                {businessCase.finance_approved_by && (
                  <p className="text-xs text-neutral-500 mt-1">Approved by {businessCase.finance_approved_by} on {businessCase.finance_approved_date}</p>
                )}
                {businessCase.finance_comments && (
                  <p className="text-xs text-neutral-700 mt-1 italic">"{businessCase.finance_comments}"</p>
                )}
              </div>

              <div className="rounded-xl border border-neutral-200 p-4 bg-white">
                <span className="text-xs font-semibold text-neutral-500 uppercase block">Legal Status</span>
                <span className="text-sm font-bold text-neutral-900 mt-1 block">{businessCase.legal_status}</span>
                {businessCase.legal_approved_by && (
                  <p className="text-xs text-neutral-500 mt-1">Approved by {businessCase.legal_approved_by} on {businessCase.legal_approved_date}</p>
                )}
                {businessCase.legal_comments && (
                  <p className="text-xs text-neutral-700 mt-1 italic">"{businessCase.legal_comments}"</p>
                )}
              </div>
            </div>

            {/* Step Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setActiveTab("overview")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                &larr; Previous: 1. Overview
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("technical")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 cursor-pointer shadow-xs transition-colors"
              >
                Next: 3. Technical Requirements &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Technical Requirements */}
        {activeTab === "technical" && (
          <div className="space-y-6">
            <TechnicalRequirementsEditor
              requirements={businessCase.technical_requirements_list || []}
              readOnly={businessCase.is_locked || (role !== "department" && role !== "admin")}
              title="Technical Requirements & Specifications"
              subtitle={`Inherited from Business Need ${businessCase.business_need_id}. Reviewed during Business Case approval.`}
            />

            {businessCase.technical_requirements && (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-4.5 space-y-1.5">
                <h4 className="text-xs font-bold uppercase text-neutral-600">Technical Overview &amp; Specifications Summary</h4>
                <p className="text-xs text-neutral-800 whitespace-pre-line leading-relaxed">{businessCase.technical_requirements}</p>
              </div>
            )}

            {/* Step Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setActiveTab("financials")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                &larr; Previous: 2. Financial Analysis
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("strategy")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 cursor-pointer shadow-xs transition-colors"
              >
                Next: 4. Procurement Strategy &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Tab 4: Procurement Strategy */}
        {activeTab === "strategy" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-neutral-200 p-4">
                <span className="text-xs text-neutral-500 uppercase block">Sourcing Method</span>
                <span className="text-sm font-bold text-neutral-900 mt-1 block">{businessCase.procurement_strategy}</span>
              </div>
              <div className="rounded-xl border border-neutral-200 p-4">
                <span className="text-xs text-neutral-500 uppercase block">Supplier Category</span>
                <span className="text-sm font-bold text-neutral-900 mt-1 block">{businessCase.supplier_category || "General Procurement"}</span>
              </div>
              <div className="rounded-xl border border-neutral-200 p-4">
                <span className="text-xs text-neutral-500 uppercase block">Target RFQ Date</span>
                <span className="text-sm font-bold text-neutral-900 mt-1 block">{businessCase.target_rfq_date || "2026-09-01"}</span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase text-neutral-500">Target Suppliers Recommendation</h4>
              <p className="mt-1 text-xs text-neutral-800 font-semibold">{businessCase.target_suppliers}</p>
            </div>

            {/* Step Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setActiveTab("technical")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                &larr; Previous: 3. Technical Requirements
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("risk")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 cursor-pointer shadow-xs transition-colors"
              >
                Next: 5. Risk &amp; Compliance &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Tab 5: Risk & Compliance */}
        {activeTab === "risk" && (
          <div className="space-y-6">
            <h4 className="text-xs font-bold uppercase text-neutral-500">Risk Assessment Matrix</h4>
            <div className="overflow-x-auto rounded-xl border border-neutral-200">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                  <tr>
                    <th className="p-3">Category</th>
                    <th className="p-3">Severity</th>
                    <th className="p-3">Probability</th>
                    <th className="p-3">Impact</th>
                    <th className="p-3">Mitigation Plan</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {businessCase.risk_assessments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-neutral-500">
                        {businessCase.risk_assessment || "Standard operational risk profile."}
                      </td>
                    </tr>
                  ) : (
                    businessCase.risk_assessments.map((r, i) => (
                      <tr key={i}>
                        <td className="p-3 font-semibold">{r.risk_category}</td>
                        <td className="p-3">{r.severity}</td>
                        <td className="p-3">{r.probability}%</td>
                        <td className="p-3">{r.impact}</td>
                        <td className="p-3">{r.mitigation_plan}</td>
                        <td className="p-3 font-semibold">{r.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Step Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setActiveTab("strategy")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                &larr; Previous: 4. Procurement Strategy
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("documents")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 cursor-pointer shadow-xs transition-colors"
              >
                Next: 6. Documents &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Tab 6: Documents */}
        {activeTab === "documents" && (
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase text-neutral-500">Supporting Business Case Documents</h4>
            {businessCase.supporting_documents.length === 0 ? (
              <p className="text-xs text-neutral-500">No documents attached.</p>
            ) : (
              <div className="space-y-2">
                {businessCase.supporting_documents.map((att, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-xs">
                    <span className="font-medium text-neutral-700 flex items-center gap-2">
                      <Paperclip className="h-4 w-4 text-neutral-400" />
                      {att.url ? (
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-primary-600 hover:underline flex items-center gap-1"
                        >
                          {att.name}
                          <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400" />
                        </a>
                      ) : (
                        att.name
                      )}
                    </span>
                    <span className="text-neutral-500">{att.size || "—"} ({att.date})</span>
                  </div>
                ))}
              </div>
            )}

            {/* Step Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setActiveTab("risk")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                &larr; Previous: 5. Risk &amp; Compliance
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("review-submit")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 cursor-pointer shadow-xs transition-colors"
              >
                Next: 7. Review &amp; Submit &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Tab 7: Review & Submit */}
        {activeTab === "review-submit" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-neutral-900">7. Pre-Flight Review &amp; Submission</h3>
                <p className="text-xs text-neutral-500">
                  Verify that all 6 sections are completed before submitting the Business Case for Finance Review.
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                isFinancialIncomplete
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-emerald-50 text-emerald-800 border-emerald-200"
              }`}>
                {isFinancialIncomplete ? (
                  <>
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                    Financial Analysis Required
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    Ready for Finance Review
                  </>
                )}
              </span>
            </div>

            {/* Financial Analysis Gating Banner */}
            {isFinancialIncomplete ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800 shrink-0 mt-0.5">
                    <AlertTriangle className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-950">Financial Analysis Incomplete</h4>
                    <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                      No measurable annual financial benefit has been provided. At least one expected annual benefit (Annual Savings, Revenue Increase, or Cost Avoidance) must be greater than $0 before this Business Case can proceed to Finance Review.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-amber-200/60">
                  <span className="text-xs text-amber-800 font-medium">Input annual benefits to calculate ROI, NPV, IRR, and Payback:</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("financials")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-700 transition-colors cursor-pointer"
                  >
                    <Calculator className="h-3.5 w-3.5" />
                    Complete Financial Analysis &rarr;
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4.5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 shrink-0">
                    <CheckCircle2 className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-emerald-950">Financial Analysis Complete &amp; Saved</h4>
                    <p className="text-[11.5px] text-emerald-800 mt-0.5">
                      Investment: {formatCurrency(businessCase.capex)} | Annual Net Benefit: {formatCurrency(businessCase.annual_net_benefit || 0)} | Expected ROI: {businessCase.roi_formatted || `${businessCase.roi}%`} | NPV: {businessCase.npv_formatted || formatCurrency(businessCase.npv || 0)} | Payback: {businessCase.payback_period || "Not provided"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("financials")}
                  className="text-xs font-bold text-emerald-700 hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  Edit Financials &rarr;
                </button>
              </div>
            )}

            {/* 6 Sections Pre-Flight Summary Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-900 uppercase text-[11px]">1. Business Overview</span>
                  <span className="text-emerald-700 font-bold flex items-center gap-1"><Check className="h-3 w-3" /> Complete</span>
                </div>
                <p className="text-neutral-600 line-clamp-2">{businessCase.title}</p>
                <span className="text-[10.5px] text-neutral-400 block">Dept: {businessCase.department} | Owner: {businessCase.business_owner}</span>
              </div>

              <div className={`rounded-xl border p-4 space-y-2 ${isFinancialIncomplete ? "border-amber-300 bg-amber-50/40" : "border-neutral-200 bg-white"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-900 uppercase text-[11px]">2. Financial Analysis</span>
                  {isFinancialIncomplete ? (
                    <span className="text-amber-700 font-bold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Incomplete</span>
                  ) : (
                    <span className="text-emerald-700 font-bold flex items-center gap-1"><Check className="h-3 w-3" /> Complete</span>
                  )}
                </div>
                <p className="text-neutral-600">Budget: {formatCurrency(displayBudget)} ({displayCurrency})</p>
                <span className="text-[10.5px] text-neutral-400 block">
                  {isFinancialIncomplete ? "Annual benefits required" : `ROI: ${businessCase.roi_formatted || `${businessCase.roi}%`} | NPV: ${businessCase.npv_formatted || formatCurrency(businessCase.npv || 0)}`}
                </span>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-900 uppercase text-[11px]">3. Technical Specs</span>
                  <span className="text-emerald-700 font-bold flex items-center gap-1"><Check className="h-3 w-3" /> Complete</span>
                </div>
                <p className="text-neutral-600 line-clamp-2">{businessCase.technical_requirements || "Requirements defined."}</p>
                <span className="text-[10.5px] text-neutral-400 block">{businessCase.technical_requirements_list?.length || 0} line items listed</span>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-900 uppercase text-[11px]">4. Procurement Strategy</span>
                  <span className="text-emerald-700 font-bold flex items-center gap-1"><Check className="h-3 w-3" /> Complete</span>
                </div>
                <p className="text-neutral-600">{businessCase.procurement_strategy || "Commercial RFQ"}</p>
                <span className="text-[10.5px] text-neutral-400 block">Category: {businessCase.supplier_category || "General"}</span>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-900 uppercase text-[11px]">5. Risk &amp; Compliance</span>
                  <span className="text-emerald-700 font-bold flex items-center gap-1"><Check className="h-3 w-3" /> Complete</span>
                </div>
                <p className="text-neutral-600">{businessCase.risk_assessments?.length || 0} Risk factors evaluated</p>
                <span className="text-[10.5px] text-neutral-400 block">Overall Risk: {businessCase.financial_risk || "Not Assessed"}</span>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-900 uppercase text-[11px]">6. Documents</span>
                  <span className="text-emerald-700 font-bold flex items-center gap-1"><Check className="h-3 w-3" /> Complete</span>
                </div>
                <p className="text-neutral-600">{businessCase.supporting_documents?.length || 0} documents attached</p>
                <span className="text-[10.5px] text-neutral-400 block">Signatures validated</span>
              </div>
            </div>

            {/* Bottom Actions for Review & Submit */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setActiveTab("documents")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                &larr; Previous: 6. Documents
              </button>

              <div className="flex items-center gap-3">
                {isFinancialIncomplete ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-2 rounded-lg bg-neutral-200 px-5 py-2.5 text-xs font-bold text-neutral-400 cursor-not-allowed"
                    title="Complete Financial Analysis to enable submission"
                  >
                    <Send className="h-4 w-4" />
                    Submit for Finance Review (Blocked by Financials)
                  </button>
                ) : (
                  (businessCase.workflow_status === "Draft" ||
                   businessCase.workflow_status === "Revision Required - Finance" ||
                   businessCase.workflow_status === "Revision Required - Legal") && (
                    <button
                      type="button"
                      onClick={handleConfirmResubmit}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700 cursor-pointer transition-colors"
                    >
                      <Send className="h-4 w-4" />
                      Submit Business Case for Finance Review &rarr;
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 7: Approval History */}
        {activeTab === "history" && (
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase text-neutral-500">Full Approval & Revision Audit History</h4>
            {businessCase.approval_history.length === 0 ? (
              <p className="text-xs text-neutral-500">No formal approval history records yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 bg-neutral-50 uppercase text-neutral-600 font-semibold">
                    <tr>
                      <th className="p-3">Stage</th>
                      <th className="p-3">Approver</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Action</th>
                      <th className="p-3">Comments</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Rev #</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {businessCase.approval_history.map((h, i) => (
                      <tr key={i}>
                        <td className="p-3 font-semibold">{h.stage}</td>
                        <td className="p-3">{h.approver}</td>
                        <td className="p-3">{h.role}</td>
                        <td className="p-3 font-bold text-neutral-900">{h.action}</td>
                        <td className="p-3 max-w-xs">{h.comments}</td>
                        <td className="p-3">{new Date(h.approved_on).toLocaleString()}</td>
                        <td className="p-3 font-mono">#{h.revision_number}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 8: Linked RFQs */}
        {activeTab === "rfqs" && (
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase text-neutral-500">Linked Request for Quotations</h4>
            {businessCase.rfq_id ? (
              <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                <div>
                  <span className="font-mono text-sm font-bold text-indigo-900">{businessCase.rfq_id}</span>
                  <p className="text-xs text-neutral-600 mt-0.5">Linked sourcing RFQ created by Procurement</p>
                </div>
                <Link
                  to={`/sourcing/rfq/${businessCase.rfq_id}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  Open RFQ Workspace
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <p className="text-xs text-neutral-500">No RFQ linked yet. Waiting for Procurement conversion.</p>
            )}
          </div>
        )}

        {/* Tab 9: Related Records */}
        {activeTab === "related" && (
          <div className="space-y-4 text-xs">
            <h4 className="text-xs font-bold uppercase text-neutral-500">Related Upstream & Downstream Procurement Objects</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-neutral-200 p-4">
                <span className="font-semibold text-neutral-700 block">Upstream Business Need</span>
                <Link to={`/intake/business-needs/${businessCase.business_need_id}`} className="font-mono text-primary-600 hover:underline font-bold mt-1 block">
                  {businessCase.business_need_id} ({businessCase.title})
                </Link>
              </div>
              <div className="rounded-xl border border-neutral-200 p-4">
                <span className="font-semibold text-neutral-700 block">Downstream Sourcing RFQ</span>
                <span className="font-mono font-bold text-neutral-900 mt-1 block">
                  {businessCase.rfq_id || "Not created yet"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* RFQ Creation Modal */}
      <CreateRFQFromBusinessCaseModal
        isOpen={isRfqModalOpen}
        businessCase={businessCase}
        onClose={() => setIsRfqModalOpen(false)}
        onSubmit={handleCreateRfqSubmit}
      />

      {/* Rejection / Revision / Resubmit Modals */}
      {actionModal === "reject" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-neutral-900">Reject Business Case</h3>
            <p className="mt-1 text-xs text-neutral-500">Provide rationale for rejecting this business case.</p>
            <textarea
              required
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter rejection reason..."
              className="mt-3 w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-red-500 focus:outline-none"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setActionModal("none")}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                onClick={() => (canFinanceAct ? handleFinanceReject() : handleLegalReject())}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {actionModal === "revision" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-neutral-900">Request Revision</h3>
            <p className="mt-1 text-xs text-neutral-500">Specify required changes for the Business Owner.</p>
            <textarea
              required
              rows={3}
              value={revisionNotes}
              onChange={(e) => setRevisionNotes(e.target.value)}
              placeholder="Enter required modifications..."
              className="mt-3 w-full rounded-lg border border-neutral-300 p-2.5 text-xs focus:border-amber-500 focus:outline-none"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setActionModal("none")}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                onClick={() => (canFinanceAct ? handleFinanceRevision() : handleLegalRevision())}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700"
              >
                Request Revision
              </button>
            </div>
          </div>
        </div>
      )}

      {actionModal === "resubmit" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-neutral-900">Update & Resubmit Revision</h3>
            <p className="text-xs text-neutral-500">Update required fields and resubmit to the review gate.</p>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 uppercase">Business Justification</label>
              <textarea
                rows={3}
                value={editJustification}
                onChange={(e) => setEditJustification(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 uppercase">Total Budget ($)</label>
              <input
                type="number"
                value={editBudget}
                onChange={(e) => setEditBudget(e.target.value ? Number(e.target.value) : "")}
                className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-xs focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setActionModal("none")}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmResubmit}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                Confirm Resubmit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
