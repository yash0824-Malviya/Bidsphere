import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  DollarSign,
  CheckCircle2,
  XCircle,
  Paperclip,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  TrendingUp,
  Clock,
  Layers,
  User,
  Building,
  Check,
  ArrowUpRight,
  Activity,
  FileCheck,
  Calculator,
} from "lucide-react";
import toast from "react-hot-toast";

import type { BusinessCase, BusinessNeed, FinanceChecklistState, FinanceGateBlocker } from "../../types/businessIntake";
import { formatCurrency } from "../../utils/format";
import { useLayout } from "../../contexts/LayoutContext";

interface Props {
  businessCase: BusinessCase;
  need?: BusinessNeed | null;
  displayBudget: number;
  displayCurrency: string;
  financeChecklist: FinanceChecklistState;
  setFinanceChecklist: React.Dispatch<React.SetStateAction<FinanceChecklistState>>;
  financeBlockers: FinanceGateBlocker[];
  commentText: string;
  setCommentText: (text: string) => void;
  onApprove: () => Promise<void> | void;
  onRequestRevision: () => void;
  onReject: () => void;
  onNavigateToFinancials?: () => void;
  isApproving?: boolean;
  canAct: boolean;
  role: string;
}

export function FinanceGateApprovalWorkspace({
  businessCase,
  need: _need,
  displayBudget,
  displayCurrency,
  financeChecklist,
  setFinanceChecklist,
  financeBlockers,
  commentText,
  setCommentText,
  onApprove,
  onRequestRevision,
  onReject,
  onNavigateToFinancials,
  isApproving = false,
  canAct,
  role: _role,
}: Props) {
  const { sidebarOffset, sidebarMode } = useLayout();
  const [paramsExpanded, setParamsExpanded] = useState(true);

  // ─── Financial Benefits & Calculation State ──────────────────────────────
  const annualSavings = Number(businessCase.expected_annual_savings ?? businessCase.expected_savings ?? 0);
  const revIncrease = Number(businessCase.revenue_increase ?? 0);
  const costAvoidance = Number(businessCase.cost_avoidance ?? 0);
  const annualGrossBenefit = annualSavings + revIncrease + costAvoidance;

  const isFinancialIncomplete =
    businessCase.financial_calculation_status === "Incomplete" ||
    annualGrossBenefit === 0;

  // ─── Checklist Calculations ───────────────────────────────────────────────
  const checklistItems = useMemo(
    () => [
      {
        key: "budgetVerified" as const,
        label: "Budget allocation and sufficiency verified",
        desc: "Confirm available budget pool and project funding allocation.",
        checked: financeChecklist.budgetVerified,
      },
      {
        key: "capexOpexVerified" as const,
        label: "CAPEX / OPEX classification verified",
        desc: "Validate capitalization eligibility, depreciation schedules, and tax treatment.",
        checked: financeChecklist.capexOpexVerified,
      },
      {
        key: "financialAssumptionsReviewed" as const,
        label: "ROI / NPV / financial assumptions reviewed",
        desc: "Assess discount rate, hurdle rate compliance, and cash flow projections.",
        checked: financeChecklist.financialAssumptionsReviewed,
      },
      {
        key: "requiredDocumentsReviewed" as const,
        label: "Supporting documents & specifications reviewed",
        desc: "Verify BOMs, quotes, technical specs, and cost breakdown sheets.",
        checked: financeChecklist.requiredDocumentsReviewed,
      },
      {
        key: "requiredSignaturesVerified" as const,
        label: "Required e-signatures & approvals verified",
        desc: "Ensure departmental sign-offs and delegation of authority compliance.",
        checked: financeChecklist.requiredSignaturesVerified,
      },
      {
        key: "businessJustificationReviewed" as const,
        label: "Business problem & justification validated",
        desc: "Confirm strategic rationale, operational impact, and business urgency.",
        checked: financeChecklist.businessJustificationReviewed,
      },
      {
        key: "financialFeasibilityConfirmed" as const,
        label: "Financial feasibility and commercial readiness confirmed",
        desc: "Final financial clearance for legal review and procurement execution.",
        checked: financeChecklist.financialFeasibilityConfirmed,
      },
    ],
    [financeChecklist]
  );

  const completedChecklistCount = useMemo(
    () => checklistItems.filter((i) => i.checked).length,
    [checklistItems]
  );
  const uncompletedChecklistCount = 7 - completedChecklistCount;
  const checklistPercent = Math.round((completedChecklistCount / 7) * 100);

  const handleToggleChecklist = (key: keyof FinanceChecklistState) => {
    setFinanceChecklist((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCheckAll = () => {
    setFinanceChecklist({
      budgetVerified: true,
      capexOpexVerified: true,
      financialAssumptionsReviewed: true,
      requiredDocumentsReviewed: true,
      requiredSignaturesVerified: true,
      businessJustificationReviewed: true,
      financialFeasibilityConfirmed: true,
    });
    toast.success("All 7 checklist items marked as verified.");
  };

  // ─── Financial Health Assessment ──────────────────────────────────────────
  const budgetStatus = displayBudget > 0 ? "Within Allocation" : "Missing Allocation";
  const capexOpexMix =
    businessCase.capex > 0 && businessCase.opex > 0
      ? businessCase.capex >= businessCase.opex
        ? "CAPEX Dominant"
        : "OPEX Dominant"
      : businessCase.capex > 0
      ? "100% CAPEX"
      : businessCase.opex > 0
      ? "100% OPEX"
      : "Not Specified";

  const roiStatus = isFinancialIncomplete
    ? "Pending Analysis"
    : businessCase.roi > 0
    ? `Positive (${businessCase.roi}%)`
    : businessCase.npv > 0
    ? `Positive NPV`
    : "Analysis Complete";

  const paybackStatus = isFinancialIncomplete
    ? "Pending Analysis"
    : businessCase.payback_period &&
      businessCase.payback_period !== "Not provided" &&
      businessCase.payback_period !== "Standard"
    ? businessCase.payback_period
    : displayBudget > 0
    ? "Not Recoverable"
    : "Not Provided";

  const overallRisk =
    businessCase.financial_risk && businessCase.financial_risk !== "Low"
      ? businessCase.financial_risk
      : isFinancialIncomplete
      ? "Not Assessed"
      : businessCase.financial_risk || "Not Assessed";

  // ─── Document Metrics ─────────────────────────────────────────────────────
  const supportingDocs = businessCase.supporting_documents || [];
  const signatureDocs = supportingDocs.filter((d) => d.signature_required);

  const isBlocked = financeBlockers.length > 0;
  const isApproved = businessCase.finance_status === "Approved";

  // Breakdown of blockers
  const nonChecklistBlockers = financeBlockers.filter(
    (b) => !b.code.startsWith("CHECKLIST_")
  );

  // ─── Stepper Stages ───────────────────────────────────────────────────────
  const steps = [
    {
      id: 1,
      title: "Financial Review",
      desc: displayBudget > 0 ? "Verified" : "In Progress",
      status: isApproved ? "completed" : "current",
    },
    {
      id: 2,
      title: "Documents Review",
      desc: supportingDocs.length > 0 ? `${supportingDocs.length} Attached` : "Pending",
      status: isApproved ? "completed" : supportingDocs.length > 0 ? "completed" : "current",
    },
    {
      id: 3,
      title: "Checklist Verification",
      desc: `${completedChecklistCount}/7 Verified`,
      status: isApproved || completedChecklistCount === 7 ? "completed" : "current",
    },
    {
      id: 4,
      title: "Approver Decision",
      desc: isApproved ? "Approved" : isBlocked ? "Blocked" : "Ready",
      status: isApproved ? "completed" : isBlocked ? "pending" : "current",
    },
    {
      id: 5,
      title: "Completed",
      desc: isApproved ? "Gate Approved" : "Pending Sign-off",
      status: isApproved ? "completed" : "pending",
    },
  ];

  return (
    <div className="w-full space-y-6">
      {/* ════════════════════════════════════════════════════════════════════
          1. PAGE HEADER — High authority approval header
      ════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-[12px] border border-neutral-200/90 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-primary-900 px-2.5 py-1 font-mono text-[12px] font-bold text-white shadow-sm">
                <FileCheck className="h-3.5 w-3.5 text-primary-300" />
                {businessCase.business_case_id}
              </span>
              <h1 className="text-[22px] font-bold text-neutral-900 tracking-tight leading-tight">
                Finance Gate Approval Review
              </h1>
            </div>
            <p className="text-[13px] text-neutral-500 max-w-3xl leading-relaxed">
              Complete the financial verification, review supporting documents, and confirm the mandatory checklist before approving this Business Case.
            </p>

            {/* Metadata Badges */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11.5px] font-medium text-neutral-600">
                <User className="h-3 w-3 text-neutral-400" />
                Owner: <strong className="text-neutral-800">{businessCase.business_owner || "Department Lead"}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11.5px] font-medium text-neutral-600">
                <Building className="h-3 w-3 text-neutral-400" />
                Dept: <strong className="text-neutral-800">{businessCase.department}</strong>
              </span>
              {businessCase.business_need_id && (
                <Link
                  to={`/intake/business-needs/${businessCase.business_need_id}`}
                  className="inline-flex items-center gap-1.5 rounded-[6px] border border-primary-200 bg-primary-50/60 px-2.5 py-1 text-[11.5px] font-medium text-primary-700 hover:bg-primary-100 transition-colors"
                >
                  <FileText className="h-3 w-3 text-primary-500" />
                  Need: <strong className="font-mono">{businessCase.business_need_id}</strong>
                </Link>
              )}
              <span className="inline-flex items-center gap-1 rounded-[6px] border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] font-medium text-neutral-500">
                Rev #{businessCase.revision_number || 1}
              </span>
            </div>
          </div>

          {/* Right: Stage & Approval Status Badges */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex flex-col items-start sm:items-end gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-300 bg-primary-50 px-3.5 py-1 text-[12px] font-bold text-primary-800 shadow-sm">
                <Activity className="h-3.5 w-3.5 text-primary-600" />
                Stage: Finance Review
              </span>
              {isApproved ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3.5 py-1 text-[12px] font-bold text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Status: Approved
                </span>
              ) : isBlocked ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1 text-[12px] font-bold text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  Status: Approval Blocked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-300 bg-blue-50 px-3.5 py-1 text-[12px] font-bold text-blue-800">
                  <Clock className="h-3.5 w-3.5 text-blue-600" />
                  Status: Pending Approval
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          2. APPROVAL PROGRESS STEPPER — 5-step approval journey
      ════════════════════════════════════════════════════════════════════ */}
      <div className="w-full rounded-[12px] border border-neutral-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <nav aria-label="Approval Journey Progress" className="overflow-x-auto scrollbar-hidden">
          <ol className="flex items-center min-w-[720px] justify-between">
            {steps.map((step, idx) => {
              const isLast = idx === steps.length - 1;
              const isCompleted = step.status === "completed";
              const isCurrent = step.status === "current";

              return (
                <React.Fragment key={step.id}>
                  <li className="flex items-center gap-3 shrink-0">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-150 ${
                        isCompleted
                          ? "bg-emerald-600 text-white shadow-sm"
                          : isCurrent
                          ? "bg-primary-700 text-white shadow-sm ring-4 ring-primary-100"
                          : "border border-neutral-300 bg-neutral-100 text-neutral-400"
                      }`}
                    >
                      {isCompleted ? <Check className="h-4 w-4 stroke-[2.5]" /> : step.id}
                    </div>
                    <div className="flex flex-col leading-tight">
                      <span
                        className={`text-[12.5px] font-bold ${
                          isCurrent
                            ? "text-primary-900"
                            : isCompleted
                            ? "text-neutral-800"
                            : "text-neutral-400"
                        }`}
                      >
                        {step.title}
                      </span>
                      <span
                        className={`text-[11px] mt-0.5 ${
                          isCurrent
                            ? "font-semibold text-primary-600"
                            : isCompleted
                            ? "font-medium text-emerald-600"
                            : "text-neutral-400"
                        }`}
                      >
                        {step.desc}
                      </span>
                    </div>
                  </li>

                  {!isLast && (
                    <li className="flex flex-1 items-center px-4" aria-hidden="true">
                      <div
                        className={`h-[2px] w-full rounded-full transition-colors ${
                          isCompleted ? "bg-emerald-500" : "bg-neutral-200"
                        }`}
                      />
                    </li>
                  )}
                </React.Fragment>
              );
            })}
          </ol>
        </nav>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          3. FINANCIAL SUMMARY — 4 Primary Scannable KPI Cards
      ════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Budget */}
        <div className="rounded-[12px] border border-neutral-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold uppercase tracking-wider text-neutral-500">
              Total Budget
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary-50 text-primary-700">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-neutral-900 tracking-tight">
            {displayBudget > 0 ? (
              formatCurrency(displayBudget)
            ) : (
              <span className="text-red-600 text-lg font-bold">Missing ($0.00)</span>
            )}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-neutral-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>Currency: <strong>{displayCurrency}</strong></span>
          </div>
        </div>

        {/* Card 2: CAPEX / OPEX */}
        <div className="rounded-[12px] border border-neutral-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold uppercase tracking-wider text-neutral-500">
              CAPEX / OPEX
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-sky-50 text-sky-700">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl font-bold text-neutral-900 truncate">
            {businessCase.capex > 0 || businessCase.opex > 0 ? (
              `${formatCurrency(businessCase.capex)} / ${formatCurrency(businessCase.opex)}`
            ) : (
              <span className="text-neutral-400 text-base font-normal">Not specified</span>
            )}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-neutral-500">
            <span className="font-semibold text-neutral-700">{capexOpexMix}</span>
          </div>
        </div>

        {/* Card 3: Expected ROI / NPV */}
        <div className="rounded-[12px] border border-neutral-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold uppercase tracking-wider text-neutral-500">
              Expected ROI / NPV
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-emerald-50 text-emerald-700">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <p className={`mt-2 text-xl font-bold truncate ${isFinancialIncomplete ? "text-amber-700" : "text-emerald-700"}`}>
            {isFinancialIncomplete ? (
              "Pending Analysis"
            ) : businessCase.roi !== undefined || businessCase.npv !== undefined ? (
              `${businessCase.roi ? `${businessCase.roi}%` : "0%"} / ${formatCurrency(businessCase.npv || 0)}`
            ) : (
              "Pending Analysis"
            )}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-neutral-500">
            <span>{isFinancialIncomplete ? "Annual benefits required" : "Expected Financial Return"}</span>
          </div>
        </div>

        {/* Card 4: Payback Period */}
        <div className="rounded-[12px] border border-neutral-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold uppercase tracking-wider text-neutral-500">
              Payback Period
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-amber-50 text-amber-700">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <p className={`mt-2 text-xl font-bold truncate ${isFinancialIncomplete ? "text-amber-700" : "text-neutral-900"}`}>
            {paybackStatus}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-neutral-500">
            <span>{isFinancialIncomplete ? "Annual benefits required" : "Capital recovery timeframe"}</span>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          4. FINANCIAL HEALTH & RISK ASSESSMENT
      ════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-[12px] border border-neutral-200/90 bg-neutral-50/70 p-5">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary-700" />
            <h3 className="text-[13.5px] font-bold text-neutral-900">
              Financial Health &amp; Risk Assessment
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase text-neutral-500">
              Overall Financial Risk:
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold border ${
                overallRisk === "Low"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : overallRisk === "Medium"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : overallRisk === "High"
                  ? "bg-red-50 text-red-700 border-red-200"
                  : "bg-neutral-100 text-neutral-600 border-neutral-200"
              }`}
            >
              {overallRisk}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div className="rounded-[8px] bg-white border border-neutral-200/80 p-3 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
              Budget Status
            </span>
            <span className="font-bold text-neutral-800 text-[13px]">{budgetStatus}</span>
          </div>

          <div className="rounded-[8px] bg-white border border-neutral-200/80 p-3 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
              CAPEX / OPEX Mix
            </span>
            <span className="font-bold text-neutral-800 text-[13px]">{capexOpexMix}</span>
          </div>

          <div className="rounded-[8px] bg-white border border-neutral-200/80 p-3 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
              ROI Status
            </span>
            <span className={`font-bold text-[13px] ${isFinancialIncomplete ? "text-amber-700" : "text-neutral-800"}`}>
              {roiStatus}
            </span>
          </div>

          <div className="rounded-[8px] bg-white border border-neutral-200/80 p-3 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
              Payback Feasibility
            </span>
            <span className={`font-bold text-[13px] ${isFinancialIncomplete ? "text-amber-700" : "text-neutral-800"}`}>
              {paybackStatus}
            </span>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          5. SECTION 1 — FINANCIAL PARAMETERS VERIFICATION (Collapsible)
      ════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-[12px] border border-neutral-200/90 bg-white overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <button
          type="button"
          onClick={() => setParamsExpanded(!paramsExpanded)}
          className="w-full flex items-center justify-between p-5 bg-white hover:bg-neutral-50/70 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-800 text-[12px] font-bold">
              1
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-neutral-900">
                1. Financial Parameters Verification
              </h3>
              <p className="text-[11.5px] text-neutral-500 mt-0.5">
                Verify budget allocation, capital expense breakdown, and discount assumptions.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isFinancialIncomplete && displayBudget > 0 && businessCase.financial_calculation_status === "Calculated" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                <Check className="h-3 w-3" />
                Financial Analysis &bull; Complete
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                Financial Analysis Required
              </span>
            )}
            {paramsExpanded ? (
              <ChevronUp className="h-4 w-4 text-neutral-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-neutral-400" />
            )}
          </div>
        </button>

        {paramsExpanded && (
          <div className="border-t border-neutral-100 p-5 bg-neutral-50/40 space-y-4">
            {isFinancialIncomplete ? (
              <div className="rounded-[8px] bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Financial Analysis Required</span>
                    <span className="text-[11.5px] text-amber-800">
                      No measurable annual financial benefit has been provided. At least one annual benefit (Savings, Revenue Increase, or Cost Avoidance) must be specified before Finance Approval.
                    </span>
                  </div>
                </div>
                {onNavigateToFinancials && (
                  <button
                    type="button"
                    onClick={onNavigateToFinancials}
                    className="inline-flex items-center gap-1.5 rounded-[6px] bg-amber-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-amber-700 shrink-0 transition-colors cursor-pointer"
                  >
                    <Calculator className="h-3.5 w-3.5" />
                    Complete Financial Analysis
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-[8px] bg-emerald-50/70 border border-emerald-200 p-3 text-xs text-emerald-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="font-semibold">Financial Analysis verified from backend record. Review metrics below before completing the Finance Checklist.</span>
                </div>
                {onNavigateToFinancials && (
                  <button
                    type="button"
                    onClick={onNavigateToFinancials}
                    className="text-[11px] font-bold text-emerald-800 hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0 ml-2"
                  >
                    Edit Financials
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
              <div className="rounded-[8px] bg-white border border-neutral-200 p-3">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase block mb-1">
                  CAPEX
                </span>
                <span className="text-sm font-bold text-neutral-900 block">
                  {formatCurrency(businessCase.capex)}
                </span>
                <span className="text-[10px] text-neutral-500 mt-0.5 block">
                  Initial Investment
                </span>
              </div>

              <div className="rounded-[8px] bg-white border border-neutral-200 p-3">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase block mb-1">
                  OPEX
                </span>
                <span className="text-sm font-bold text-neutral-900 block">
                  {formatCurrency(businessCase.opex)}
                </span>
                <span className="text-[10px] text-neutral-500 mt-0.5 block">
                  Annual OPEX
                </span>
              </div>

              <div className="rounded-[8px] bg-white border border-neutral-200 p-3">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase block mb-1">
                  Annual Net Benefit
                </span>
                <span className={`text-sm font-bold block ${isFinancialIncomplete ? "text-amber-700" : "text-emerald-700"}`}>
                  {isFinancialIncomplete ? "Pending Analysis" : (businessCase.annual_net_benefit !== undefined ? formatCurrency(businessCase.annual_net_benefit) : "Pending Analysis")}
                </span>
                <span className="text-[10px] text-neutral-500 mt-0.5 block">
                  Gross &minus; OPEX
                </span>
              </div>

              <div className="rounded-[8px] bg-white border border-neutral-200 p-3">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase block mb-1">
                  ROI
                </span>
                <span className={`text-sm font-bold block ${isFinancialIncomplete ? "text-amber-700" : "text-emerald-700"}`}>
                  {isFinancialIncomplete ? "Pending Analysis" : (businessCase.roi_formatted || (businessCase.roi ? `${businessCase.roi}%` : "Not Applicable"))}
                </span>
                <span className="text-[10px] text-neutral-500 mt-0.5 block">
                  Return on Inv.
                </span>
              </div>

              <div className="rounded-[8px] bg-white border border-neutral-200 p-3">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase block mb-1">
                  NPV
                </span>
                <span className={`text-sm font-bold block ${isFinancialIncomplete ? "text-amber-700" : "text-primary-900"}`}>
                  {isFinancialIncomplete ? "Pending Analysis" : (businessCase.npv_formatted || formatCurrency(businessCase.npv || 0))}
                </span>
                <span className="text-[10px] text-neutral-500 mt-0.5 block">
                  Rate: {businessCase.discount_rate || 10}%
                </span>
              </div>

              <div className="rounded-[8px] bg-white border border-neutral-200 p-3">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase block mb-1">
                  IRR
                </span>
                <span className={`text-sm font-bold block ${isFinancialIncomplete ? "text-amber-700" : "text-neutral-900"}`}>
                  {isFinancialIncomplete ? "Pending Analysis" : (businessCase.irr_formatted || (businessCase.irr ? `${businessCase.irr}%` : "Not Available"))}
                </span>
                <span className="text-[10px] text-neutral-500 mt-0.5 block">
                  Internal Rate
                </span>
              </div>

              <div className="rounded-[8px] bg-white border border-neutral-200 p-3">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase block mb-1">
                  Payback Period
                </span>
                <span className={`text-sm font-bold block ${isFinancialIncomplete ? "text-amber-700" : "text-neutral-900"}`}>
                  {paybackStatus}
                </span>
                <span className="text-[10px] text-neutral-500 mt-0.5 block">
                  Duration: {businessCase.project_duration || 5} Yrs
                </span>
              </div>
            </div>

            {businessCase.business_justification && (
              <div className="rounded-[8px] bg-white border border-neutral-200 p-3.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-600 block mb-1">
                  Business Justification &amp; Strategic Rationale
                </span>
                <p className="text-xs text-neutral-700 leading-relaxed whitespace-pre-wrap">
                  {businessCase.business_justification}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          6. SECTION 2 — SUPPORTING DOCUMENTS & SIGNATURE VERIFICATION
      ════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-[12px] border border-neutral-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-800 text-[12px] font-bold">
              2
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-neutral-900">
                2. Supporting Documents &amp; Signature Verification
              </h3>
              <p className="text-[11.5px] text-neutral-500 mt-0.5">
                Review attached specifications, quotes, and mandatory e-signature compliance.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full bg-neutral-100 px-3 py-0.5 text-[11.5px] font-semibold text-neutral-700">
              Documents: <strong>{supportingDocs.length}</strong>
            </span>
            <span className="rounded-full bg-neutral-100 px-3 py-0.5 text-[11.5px] font-semibold text-neutral-700">
              Signatures: <strong>{signatureDocs.length}</strong>
            </span>
          </div>
        </div>

        {supportingDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 rounded-[10px] border border-dashed border-neutral-300 bg-neutral-50/60 text-center">
            <FileText className="h-9 w-9 text-neutral-400 mb-2" />
            <h4 className="text-[13px] font-bold text-neutral-800">
              No supporting documents attached.
            </h4>
            <p className="text-xs text-neutral-500 max-w-md mt-1">
              Required documents, quotes, and specifications must be uploaded and verified before final gate sign-off.
            </p>
            {canAct && (
              <button
                type="button"
                onClick={onRequestRevision}
                className="mt-3.5 inline-flex items-center gap-1.5 rounded-[6px] border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400 transition-colors shadow-2xs"
              >
                <RefreshCw className="h-3.5 w-3.5 text-neutral-500" />
                Request Documents
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[8px] border border-neutral-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 text-[11px] font-bold uppercase text-neutral-500 border-b border-neutral-200">
                <tr>
                  <th className="px-4 py-2.5">Document Name</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Uploaded Date</th>
                  <th className="px-3 py-2.5">Signature Status</th>
                  <th className="px-3 py-2.5">Verification</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {supportingDocs.map((doc, idx) => (
                  <tr key={idx} className="hover:bg-neutral-50/70 transition-colors">
                    <td className="px-4 py-3 font-semibold text-neutral-900 flex items-center gap-2">
                      <Paperclip className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                      <span className="truncate max-w-xs">{doc.name}</span>
                    </td>
                    <td className="px-3 py-3 uppercase text-[11px] text-neutral-500 font-medium">
                      {doc.type || doc.name.split(".").pop() || "FILE"}
                    </td>
                    <td className="px-3 py-3 text-neutral-500 text-[11.5px]">
                      {doc.date || "Attached"}
                    </td>
                    <td className="px-3 py-3">
                      {doc.signature_required ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold border ${
                            doc.signature_status === "Verified" || doc.signature_status === "Signed"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          <ShieldCheck className="h-3 w-3" />
                          {doc.signature_status || "Pending Signature"}
                        </span>
                      ) : (
                        <span className="text-neutral-400 text-[11px] font-medium">Not Required</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-[11.5px] font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        Verified
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {doc.url ? (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-[6px] border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11.5px] font-bold text-primary-700 hover:bg-primary-100 transition-colors"
                        >
                          View
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-neutral-400 text-[11px]">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          7. SECTION 3 — FINANCE REVIEW GATE CHECKLIST
      ════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-[12px] border border-neutral-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-800 text-[12px] font-bold">
              3
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-neutral-900">
                3. Finance Review Gate Checklist
              </h3>
              <p className="text-[11.5px] text-neutral-500 mt-0.5">
                All 7 mandatory items must be completed before approving this Business Case.
              </p>
            </div>
          </div>

          {/* Checklist Dynamic Progress */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-bold text-neutral-800">
                  {completedChecklistCount} / 7 completed
                </span>
                <span className="text-[11px] font-bold text-primary-700 bg-primary-50 px-2 py-0.5 rounded border border-primary-200">
                  {checklistPercent}%
                </span>
              </div>
              <div className="mt-1 h-2 w-32 rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-300 rounded-full"
                  style={{ width: `${checklistPercent}%` }}
                />
              </div>
            </div>
            {canAct && completedChecklistCount < 7 && (
              <button
                type="button"
                onClick={handleCheckAll}
                className="rounded-[6px] border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400 transition-colors"
              >
                Check All
              </button>
            )}
          </div>
        </div>

        {/* 2-Column Checklist Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {checklistItems.map((item) => (
            <label
              key={item.key}
              className={`flex items-start gap-3 p-3.5 rounded-[10px] border transition-all duration-150 cursor-pointer select-none ${
                item.checked
                  ? "border-emerald-300 bg-emerald-50/40 shadow-2xs"
                  : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/60"
              }`}
            >
              <input
                type="checkbox"
                checked={item.checked}
                disabled={!canAct}
                onChange={() => handleToggleChecklist(item.key)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[12.5px] font-bold leading-snug ${
                      item.checked ? "text-neutral-900" : "text-neutral-700"
                    }`}
                  >
                    {item.label}
                  </span>
                  {item.checked && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-100/80 px-1.5 py-0.2 text-[10.5px] font-bold text-emerald-800 shrink-0">
                      <Check className="h-3 w-3 stroke-[2.5]" />
                      Verified
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-neutral-500 leading-normal">
                  {item.desc}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          8. SECTION 4 — APPROVAL BLOCKERS ALERT
      ════════════════════════════════════════════════════════════════════ */}
      {isBlocked ? (
        <div className="rounded-[12px] border border-amber-300 bg-amber-50/90 p-5 text-amber-900 shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-800 shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-[13.5px] font-bold text-amber-950">
                  Approval Blocked: {financeBlockers.length} requirement{financeBlockers.length > 1 ? "s" : ""} incomplete
                </h4>
                <p className="text-[11.5px] text-amber-800 mt-0.5">
                  Complete all mandatory checklist items and resolve required financial analysis and document issues before approval.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-100/90 px-3 py-1 rounded-md border border-amber-200 shrink-0">
              <span>{uncompletedChecklistCount} Checklist</span>
              {nonChecklistBlockers.length > 0 && (
                <>
                  <span>+</span>
                  <span>{nonChecklistBlockers.length} Financial/Doc</span>
                </>
              )}
              <span>= {financeBlockers.length} Total</span>
            </div>
          </div>

          <div className="border-t border-amber-200/80 pt-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block mb-1.5">
              Active Blocking Items ({financeBlockers.length}):
            </span>
            <ul className="space-y-1.5 text-xs text-amber-900">
              {financeBlockers.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber-600 font-bold leading-none mt-1">•</span>
                  <span className="leading-snug">{b.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="rounded-[12px] border border-emerald-200 bg-emerald-50/80 p-4.5 text-emerald-900 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <h4 className="text-[13.5px] font-bold text-emerald-950">
                All Financial Gate Requirements Verified
              </h4>
              <p className="text-[11.5px] text-emerald-700 mt-0.5">
                All 7 mandatory checklist items are confirmed. The Business Case is cleared for Finance Gate approval.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-100 border border-emerald-300 px-3 py-0.5 text-[11px] font-bold text-emerald-800 shrink-0">
            Ready for Sign-Off
          </span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          9. SECTION 5 — APPROVAL DECISION AREA
      ════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-[12px] border border-neutral-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
        <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-800 text-[12px] font-bold">
            4
          </div>
          <div>
            <h3 className="text-[14px] font-bold text-neutral-900">
              4. Approval Decision &amp; Memo
            </h3>
            <p className="text-[11.5px] text-neutral-500 mt-0.5">
              Submit your formal decision and enter approval memo or revision directives.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-[11.5px] font-bold uppercase tracking-wider text-neutral-600 mb-1.5">
            Finance Reviewer Comments &amp; Memo Notes
            <span className="text-neutral-400 font-normal normal-case ml-1">
              (Optional for approval, mandatory for revision/rejection)
            </span>
          </label>
          <textarea
            rows={3}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={!canAct}
            placeholder="Enter financial verification notes, approval conditions, or revision instructions..."
            className="w-full rounded-[8px] border border-neutral-300 bg-white p-3 text-[13px] text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-200 focus:outline-none transition-colors"
          />
        </div>

        {canAct && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onRequestRevision}
                className="inline-flex h-10 items-center gap-1.5 rounded-[6px] border border-neutral-300 bg-white px-4 text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5 text-neutral-500" />
                Request More Information
              </button>

              <button
                type="button"
                onClick={() => {
                  toast.success("Finance review draft comments saved.");
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-[6px] border border-neutral-300 bg-white px-4 text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400 transition-colors"
              >
                Save Draft Notes
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onReject}
                className="inline-flex h-10 items-center gap-1.5 rounded-[6px] border border-red-300 bg-white px-4 text-[12.5px] font-semibold text-red-600 hover:bg-red-50 hover:border-red-400 transition-colors"
              >
                <XCircle className="h-4 w-4 text-red-500" />
                Reject Business Case
              </button>

              <button
                type="button"
                onClick={onApprove}
                disabled={isBlocked || isApproving}
                title={isBlocked ? `Cannot approve: ${financeBlockers[0]?.message}` : "Approve Finance Gate"}
                className={`inline-flex h-10 items-center gap-2 rounded-[6px] px-5 text-[13px] font-bold shadow-sm transition-all ${
                  !isBlocked && !isApproving
                    ? "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
                    : "bg-neutral-200 text-neutral-400 border border-neutral-300 cursor-not-allowed"
                }`}
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve Business Case &rarr;
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          10. STICKY ACTION BAR FOR FINANCE REVIEWER
      ════════════════════════════════════════════════════════════════════ */}
      {canAct && (
        <div
          className="fixed bottom-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur-sm shadow-[0_-4px_16px_rgba(0,0,0,0.05)] transition-[left] duration-300"
          style={{
            left: sidebarMode !== "drawer" ? sidebarOffset : 0,
            right: 0,
            height: 70,
          }}
        >
          <div className="flex h-full w-full items-center justify-between gap-4 px-6 lg:px-8">
            {/* Left: Readiness message */}
            <div className="flex items-center gap-2">
              {isBlocked ? (
                <div className="flex items-center gap-2 text-amber-700 text-xs font-semibold">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>
                    Approval blocked: {financeBlockers.length} requirement(s) incomplete ({uncompletedChecklistCount} checklist + {nonChecklistBlockers.length} financial/doc)
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>All financial requirements verified &middot; Ready for gate sign-off</span>
                </div>
              )}
            </div>

            {/* Right: Actions in one row */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onRequestRevision}
                className="inline-flex h-10 items-center justify-center rounded-[6px] border border-neutral-300 bg-white px-3.5 text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 hover:border-neutral-400 transition-colors"
              >
                Request Information
              </button>

              <button
                type="button"
                onClick={onReject}
                className="inline-flex h-10 items-center justify-center rounded-[6px] border border-red-300 bg-white px-3.5 text-[12.5px] font-semibold text-red-600 hover:bg-red-50 transition-colors"
              >
                Reject
              </button>

              <button
                type="button"
                onClick={onApprove}
                disabled={isBlocked || isApproving}
                className={`inline-flex h-10 items-center gap-1.5 rounded-[6px] px-5 text-[13px] font-bold shadow-sm transition-all ${
                  !isBlocked && !isApproving
                    ? "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
                    : "bg-neutral-200 text-neutral-400 border border-neutral-300 cursor-not-allowed"
                }`}
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve Business Case &rarr;
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
