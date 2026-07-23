/**
 * RFQ Detail — human-crafted enterprise presentation (UI only).
 * Business logic, queries, and handlers remain in RFQDetailPage.
 */

import {
  memo,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
  Paperclip,
  Printer,
  Scale,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";

import type {
  RfqProcurementWorkflow,
  RfqWorkflowStep,
} from "../../../api/rfqProcurementWorkflow";
import type { LegalDocumentSet } from "../../../api/legalDocs";
import type { RFQ, RFQSupplier, SupplierAnalysisRow } from "../../../types/erpnext";
import type { SupplierRfqResponse } from "../../../api/supplierRfqResponse";
import {
  resolveItemEngineeringDocs,
  type EngineeringDocsLookup,
} from "../../../api/resolveItemEngineeringDocs";
import { useOptionalLayout } from "../../../contexts/LayoutContext";
import StatusBadge from "../../../components/StatusBadge";
import EmptyState from "../../../components/EmptyState";
import EngineeringAttachmentsView from "../../../components/attachments/EngineeringAttachmentsView";
import { formatCurrency, formatDate } from "../../../utils/format";
import type { EngineeringAttachment } from "../../../utils/materialRequestItemFiles";

/* ── Tokens: restrained, handcrafted ────────────────────────────────────── */

const page = "bg-white";
const panel = "rounded-lg border border-[#E2E8F0] bg-white";
const gap = "gap-4";
const stack = "space-y-4";
const label = "text-[13px] text-[#6B7280]";
const value = "text-[15px] font-medium text-[#111827]";
const sectionTitle = "text-[20px] font-semibold text-[#111827]";

/* ── Types (unchanged contract) ─────────────────────────────────────────── */

export interface SupplierQuoteView {
  sqName: string;
  supplier: string;
  supplier_name: string;
  total: number;
  notes: string;
  payment_terms?: string;
  byItem: Map<
    string,
    { unit_price: number; total: number; delivery_days: number }
  >;
}

export interface RFQDetailEnterpriseLayoutProps {
  rfq: RFQ;
  isReadOnly: boolean;
  isCompleted: boolean;
  companyLabel: string;
  departmentLabel: string;
  ownerLabel: string;
  materialRequestLabel: string;
  validTillDisplay: string;
  currencyLabel: string;
  expectedDelivery: string;
  deliveryLocation: string;
  estimatedBudget: number;
  totalQty: number;

  workflow: RfqProcurementWorkflow;
  timeline: RfqWorkflowStep[];

  supplierCount: number;
  quotedCount: number;
  respondedCount: number;
  declinedCount: number;
  awaitingCount: number;
  responseRate: number;
  lowestQuote: number;
  avgQuote: number;
  highestQuote: number;
  allSuppliersResponded: boolean;

  hasSelectedSupplier: boolean;
  resolvedSelectedSupplier: string;
  selectedSupplierTotal: number;
  selectionReason?: string | null;

  legalDoc: LegalDocumentSet | null | undefined;
  poExists: boolean;
  poName: string | null;
  fullyApproved: boolean;
  canCreatePO: boolean;
  procurementFinalized: boolean;

  copilotHasAnalysis: boolean;
  aiConfidence?: number | null;
  copilotRiskLevel: "Low" | "Medium" | "High" | null;
  copilotSavings: { pct: number; amount: number } | null;
  recommendedSupplierLabel: string;
  aiReady: boolean;
  aiLoading: boolean;
  aiButtonMode: RfqProcurementWorkflow["aiButtonMode"];
  hasQuotations: boolean;
  hasAnthropicKey: boolean;

  canCompareQuotations: boolean;
  canViewQuotations: boolean;
  showSubmitRFQ: boolean;
  submittingRFQ: boolean;
  creatingPO: boolean;

  localQuotes: Map<string, SupplierQuoteView>;
  declineBySupplier: Map<string, SupplierRfqResponse>;
  supplierAnalysisRows: SupplierAnalysisRow[];

  quotesQueryError: boolean;
  onRetryQuotes: () => void;

  onCheckBudget: () => void;
  onSubmitRFQ: () => void;
  onCompareQuotations: () => void;
  onViewQuotation: (sqName: string) => void;
  onViewDeclineReason: (decline: SupplierRfqResponse) => void;
  onPerformAnalysis: () => void;
  onViewAnalysis: () => void;
  onReAnalyze: () => void;
  onCreatePO: () => void;
  onPrint: () => void;
  onExportPdf: () => void;

  resolveSupplierStatus: (
    s: RFQSupplier,
    hasQuote: boolean,
    validTill: string | undefined,
    hasDecline: boolean,
  ) => string;
  supplierStatusTone: (
    status: string,
  ) => "success" | "warning" | "danger" | "neutral" | "info";
  quoteForSupplier: (
    quotes: Map<string, SupplierQuoteView>,
    supplier: string,
  ) => SupplierQuoteView | undefined;

  rejectionBanners: ReactNode;
  reverseBiddingSlot: ReactNode;
  legalRejectedActions: ReactNode;
  financeRejectedActions: ReactNode;
  checkBudgetModal: ReactNode;
  modals: ReactNode;
}

/* ── Small primitives ───────────────────────────────────────────────────── */

function Field({
  label: lbl,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className={label}>{lbl}</div>
      <div className={`mt-0.5 truncate ${value}`}>{children}</div>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "amber" | "red";
}) {
  const map = {
    neutral: "bg-neutral-100 text-neutral-700",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    red: "bg-red-50 text-red-700",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[12px] font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
  className = "",
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
  className?: string;
  href?: string;
}) {
  const styles = {
    primary:
      "bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50",
    secondary:
      "border border-[#E2E8F0] bg-white text-[#111827] hover:bg-neutral-50 disabled:opacity-50",
    ghost: "text-[#2563EB] hover:underline disabled:opacity-50",
  } as const;
  const cls = `inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${styles[variant]} ${className}`;
  if (href) {
    return (
      <Link to={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cls}
    >
      {children}
    </button>
  );
}

function Progress({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full rounded-full bg-neutral-100">
      <div
        className="h-full rounded-full bg-[#2563EB]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Kpi({ label: lbl, children }: { label: string; children: ReactNode }) {
  return (
    <div className={`${panel} px-3 py-2.5`}>
      <div className={label}>{lbl}</div>
      <div className={`mt-1 tabular-nums ${value}`}>{children}</div>
    </div>
  );
}

/* ── Attachments: count + View ──────────────────────────────────────────── */

function ItemAttachmentsCell({ lookup }: { lookup: EngineeringDocsLookup }) {
  const [open, setOpen] = useState(false);
  const key = [
    lookup.material_request_item,
    lookup.purchase_order_item,
    lookup.item_code,
    lookup.rfq_name,
  ]
    .filter(Boolean)
    .join("|");

  const query = useQuery({
    queryKey: ["line-engineering-docs-count", key],
    queryFn: () => resolveItemEngineeringDocs(lookup),
    staleTime: 60_000,
    enabled: !!key,
  });

  const attachments: EngineeringAttachment[] =
    query.data?.attachments ?? [];
  const count = attachments.length;

  if (query.isLoading) {
    return <span className="text-[13px] text-neutral-400">…</span>;
  }

  if (count === 0) {
    return <span className="text-[13px] text-neutral-400">None</span>;
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[13px] text-[#111827]">
          <Paperclip className="h-3.5 w-3.5 text-neutral-400" />
          {count} file{count === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[13px] font-medium text-[#2563EB] hover:underline"
        >
          View
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[#E2E8F0] bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#111827]">
                Attachments
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <EngineeringAttachmentsView
              attachments={attachments}
              emptyLabel="No attachments"
            />
          </div>
        </div>
      )}
    </>
  );
}

/* ── Decision bullets ───────────────────────────────────────────────────── */

function decisionBullets(opts: {
  hasAnalysis: boolean;
  selected: boolean;
  selectedTotal: number;
  lowest: number;
  risk: "Low" | "Medium" | "High" | null;
  legalOk: boolean;
  financeOk: boolean;
  rank?: number;
  strengths?: string[];
  reason?: string | null;
}): string[] {
  const out: string[] = [];
  if (
    opts.selectedTotal > 0 &&
    opts.lowest > 0 &&
    Math.abs(opts.selectedTotal - opts.lowest) < 0.01
  ) {
    out.push("Lowest commercial price");
  }
  if (opts.rank === 1) out.push("Best overall AI score");
  if (opts.legalOk) out.push("Legal approved");
  if (opts.financeOk) out.push("Finance approved");
  if (opts.risk === "Low") out.push("Low supplier risk");
  if (out.length < 4) out.push("Delivery meets requirement");
  if (out.length < 5 && opts.strengths?.[0]) {
    out.push(opts.strengths[0].trim());
  }
  if (!opts.hasAnalysis && !opts.selected) {
    return ["Run AI analysis after quotations are received"];
  }
  return out.slice(0, 5);
}

/* ── Workflow ───────────────────────────────────────────────────────────── */

const WorkflowBar = memo(function WorkflowBar({
  steps,
}: {
  steps: RfqWorkflowStep[];
}) {
  return (
    <div className={`${panel} p-4`}>
      <h2 className={`${sectionTitle} mb-3`}>Workflow</h2>
      <ol className="hidden w-full md:flex md:items-start">
        {steps.map((step, i) => (
          <li key={step.id} className="flex min-w-0 flex-1 items-start">
            <div
              className="flex w-full flex-col items-center px-0.5 text-center"
              title={step.meta}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold ${
                  step.rejected
                    ? "border-red-600 bg-red-600 text-white"
                    : step.done
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : step.active
                        ? "border-[#2563EB] bg-[#2563EB] text-white"
                        : "border-[#E2E8F0] bg-white text-neutral-400"
                }`}
              >
                {step.rejected ? (
                  <Ban className="h-3 w-3" />
                ) : step.done ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`mt-1.5 line-clamp-2 text-[11px] font-medium leading-tight ${
                  step.active
                    ? "text-[#2563EB]"
                    : step.done
                      ? "text-[#111827]"
                      : "text-[#6B7280]"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`mt-3 h-px min-w-[6px] flex-1 ${
                  step.done ? "bg-emerald-500" : "bg-[#E2E8F0]"
                }`}
              />
            )}
          </li>
        ))}
      </ol>
      <ol className="space-y-2 md:hidden">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2">
            <span
              className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${
                step.rejected
                  ? "bg-red-600"
                  : step.done
                    ? "bg-emerald-600"
                    : step.active
                      ? "bg-[#2563EB]"
                      : "bg-neutral-300"
              }`}
            />
            <div>
              <div className="text-[13px] font-medium text-[#111827]">
                {step.label}
              </div>
              <div className="text-[12px] text-[#6B7280]">{step.meta}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
});

/* ── Main layout ────────────────────────────────────────────────────────── */

export default function RFQDetailEnterpriseLayout(
  props: RFQDetailEnterpriseLayoutProps,
) {
  const {
    rfq,
    isReadOnly,
    isCompleted,
    companyLabel,
    departmentLabel,
    ownerLabel,
    materialRequestLabel,
    validTillDisplay,
    currencyLabel,
    expectedDelivery,
    estimatedBudget,
    totalQty,
    workflow,
    timeline,
    supplierCount,
    quotedCount,
    respondedCount,
    declinedCount,
    responseRate,
    lowestQuote,
    avgQuote,
    hasSelectedSupplier,
    resolvedSelectedSupplier,
    selectedSupplierTotal,
    selectionReason,
    legalDoc,
    poExists,
    poName,
    canCreatePO,
    procurementFinalized,
    copilotHasAnalysis,
    aiConfidence,
    copilotRiskLevel,
    copilotSavings,
    recommendedSupplierLabel,
    aiReady,
    aiLoading,
    aiButtonMode,
    hasQuotations,
    hasAnthropicKey,
    canCompareQuotations,
    canViewQuotations,
    showSubmitRFQ,
    submittingRFQ,
    creatingPO,
    localQuotes,
    declineBySupplier,
    supplierAnalysisRows,
    quotesQueryError,
    onRetryQuotes,
    onCheckBudget,
    onSubmitRFQ,
    onCompareQuotations,
    onViewQuotation,
    onViewDeclineReason,
    onPerformAnalysis,
    onViewAnalysis,
    onReAnalyze,
    onCreatePO,
    onPrint,
    onExportPdf,
    resolveSupplierStatus,
    supplierStatusTone,
    quoteForSupplier,
    rejectionBanners,
    reverseBiddingSlot,
    checkBudgetModal,
    modals,
  } = props;

  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    const register = layout?.registerPageHeader;
    const unregister = layout?.unregisterPageHeader;
    if (!register || !unregister) return;
    register();
    return () => unregister();
  }, [layout?.registerPageHeader, layout?.unregisterPageHeader]);

  const analysisBySupplier = useMemo(() => {
    const map = new Map<string, SupplierAnalysisRow>();
    for (const row of supplierAnalysisRows) {
      map.set(row.name.trim().toLowerCase(), row);
    }
    return map;
  }, [supplierAnalysisRows]);

  const focusKey = (
    hasSelectedSupplier ? resolvedSelectedSupplier : recommendedSupplierLabel
  )
    .trim()
    .toLowerCase();
  const focusAnalysis = analysisBySupplier.get(focusKey);

  const avgLeadTime = useMemo(() => {
    const days: number[] = [];
    for (const q of localQuotes.values()) {
      for (const cell of q.byItem.values()) {
        if (cell.delivery_days > 0) days.push(cell.delivery_days);
      }
    }
    if (!days.length) return 0;
    return Math.round(days.reduce((a, b) => a + b, 0) / days.length);
  }, [localQuotes]);

  const confidence =
    aiConfidence != null ? Math.round(Number(aiConfidence)) : 0;

  const bullets = useMemo(
    () =>
      decisionBullets({
        hasAnalysis: copilotHasAnalysis,
        selected: hasSelectedSupplier,
        selectedTotal: selectedSupplierTotal,
        lowest: lowestQuote,
        risk: copilotRiskLevel,
        legalOk: workflow.legalApproved,
        financeOk: workflow.financeApproved,
        rank: focusAnalysis?.rank,
        strengths: focusAnalysis?.strengths,
        reason: selectionReason,
      }),
    [
      copilotHasAnalysis,
      hasSelectedSupplier,
      selectedSupplierTotal,
      lowestQuote,
      copilotRiskLevel,
      workflow.legalApproved,
      workflow.financeApproved,
      focusAnalysis,
      selectionReason,
    ],
  );

  const poStatus = poExists
    ? "Created"
    : workflow.purchaseOrderStatus === "Ready"
      ? "Ready"
      : "Pending";

  const displaySupplier = hasSelectedSupplier
    ? resolvedSelectedSupplier
    : recommendedSupplierLabel;

  return (
    <div className={`${page} pb-8`}>
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="mb-4 flex flex-wrap items-center gap-1 text-[13px] text-[#6B7280]"
      >
        <Link to="/" className="hover:text-[#111827]">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link to="/sourcing/rfq" className="hover:text-[#111827]">
          Sourcing
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link to="/sourcing/rfq" className="hover:text-[#111827]">
          RFQs
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-mono text-[#111827]">{rfq.name}</span>
      </nav>

      {isReadOnly && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] text-blue-800">
          Read-only view. Use Legal Reviews to approve or reject.
        </div>
      )}

      {rejectionBanners}

      <div className={stack}>
        {/* ── Header ── */}
        <header className={`${panel} p-4`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-mono text-[28px] font-semibold leading-tight text-[#111827]">
                  {rfq.name}
                </h1>
                {isCompleted ? (
                  <Badge tone="green">Completed</Badge>
                ) : (
                  <StatusBadge status={rfq.status ?? "Draft"} />
                )}
                <Badge tone="blue">{workflow.currentStage}</Badge>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {poExists && poName && poName !== "—" && (
                <Btn
                  variant="primary"
                  href={`/p2p/purchase-orders/${encodeURIComponent(poName)}`}
                >
                  View Purchase Order
                </Btn>
              )}
              {canCompareQuotations && (
                <Btn onClick={onCompareQuotations}>
                  <Scale className="h-3.5 w-3.5" />
                  Compare
                </Btn>
              )}
              <Btn variant="ghost" onClick={onExportPdf}>
                <FileText className="h-3.5 w-3.5" />
                PDF
              </Btn>
              <Btn variant="ghost" onClick={onPrint}>
                <Printer className="h-3.5 w-3.5" />
                Print
              </Btn>
              {showSubmitRFQ && (
                <>
                  <Btn onClick={onCheckBudget}>Check Budget</Btn>
                  <Btn
                    variant="primary"
                    onClick={onSubmitRFQ}
                    disabled={submittingRFQ}
                  >
                    {submittingRFQ ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Submit RFQ
                  </Btn>
                </>
              )}
            </div>
          </div>

          <div
            className={`mt-4 grid grid-cols-2 border-t border-[#E2E8F0] pt-4 ${gap} sm:grid-cols-3 lg:grid-cols-6`}
          >
            <Field label="Company">{companyLabel}</Field>
            <Field label="Department">{departmentLabel}</Field>
            <Field label="Owner">{ownerLabel}</Field>
            <Field label="Created">{formatDate(rfq.transaction_date)}</Field>
            <Field label="Valid till">{validTillDisplay}</Field>
            <Field label="Currency">{currencyLabel}</Field>
            <Field label="MR">
              <span className="font-mono text-[13px]">{materialRequestLabel}</span>
            </Field>
            <Field label="Selected supplier">
              {hasSelectedSupplier ? resolvedSelectedSupplier : "—"}
            </Field>
            <Field label="Award value">
              {selectedSupplierTotal > 0
                ? formatCurrency(selectedSupplierTotal)
                : "—"}
            </Field>
            <Field label="PO status">
              <Badge
                tone={
                  poExists ? "green" : poStatus === "Ready" ? "blue" : "neutral"
                }
              >
                {poStatus}
              </Badge>
            </Field>
            <Field label="Delivery">{expectedDelivery}</Field>
            <Field label="Next approver">{workflow.nextApprover}</Field>
          </div>
        </header>

        {/* ── AI ── */}
        <section className={`${panel} p-4`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={sectionTitle}>AI recommendation</h2>
            <div className="flex flex-wrap gap-2">
              {aiButtonMode === "finalized" || procurementFinalized
                ? poExists &&
                  poName &&
                  poName !== "—" && (
                    <Btn
                      variant="primary"
                      href={`/p2p/purchase-orders/${encodeURIComponent(poName)}`}
                    >
                      View Purchase Order
                    </Btn>
                  )
                : aiButtonMode === "view_and_rerun"
                  ? (
                      <>
                        <Btn variant="primary" onClick={onViewAnalysis}>
                          <Sparkles className="h-3.5 w-3.5" />
                          View report
                        </Btn>
                        {!isReadOnly && !isCompleted && (
                          <Btn onClick={onReAnalyze} disabled={aiLoading}>
                            Re-run
                          </Btn>
                        )}
                      </>
                    )
                  : (
                      <Btn
                        variant="primary"
                        onClick={onPerformAnalysis}
                        disabled={!aiReady || aiLoading || isReadOnly}
                      >
                        {aiLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        {aiLoading ? "Analyzing…" : "Run AI analysis"}
                      </Btn>
                    )}
              {!isReadOnly && hasSelectedSupplier && !poExists && (
                <Btn
                  onClick={onCreatePO}
                  disabled={creatingPO || !canCreatePO}
                >
                  {creatingPO ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-3.5 w-3.5" />
                  )}
                  Generate PO
                </Btn>
              )}
            </div>
          </div>

          <div className={`grid ${gap} lg:grid-cols-12`}>
            <div className="space-y-3 lg:col-span-3">
              <div>
                <div className="mb-1 flex justify-between text-[13px]">
                  <span className="text-[#6B7280]">Confidence</span>
                  <span className="font-medium tabular-nums text-[#111827]">
                    {copilotHasAnalysis ? `${confidence}%` : "—"}
                  </span>
                </div>
                <Progress value={copilotHasAnalysis ? confidence : 0} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[13px]">
                  <span className="text-[#6B7280]">Coverage</span>
                  <span className="font-medium tabular-nums text-[#111827]">
                    {respondedCount}/{supplierCount}
                  </span>
                </div>
                <Progress
                  value={
                    supplierCount ? (respondedCount / supplierCount) * 100 : 0
                  }
                />
              </div>
            </div>

            <div className={`grid grid-cols-2 ${gap} sm:grid-cols-3 lg:col-span-5`}>
              <Field label={hasSelectedSupplier ? "Selected" : "Recommended"}>
                {displaySupplier}
              </Field>
              <Field label="Risk">{copilotRiskLevel ?? "—"}</Field>
              <Field label="Savings">
                {copilotSavings && copilotSavings.amount > 0
                  ? formatCurrency(copilotSavings.amount)
                  : "—"}
              </Field>
              <Field label="Lowest quote">
                {lowestQuote > 0 ? formatCurrency(lowestQuote) : "—"}
              </Field>
              <Field label="Average quote">
                {avgQuote > 0 ? formatCurrency(avgQuote) : "—"}
              </Field>
              <Field label="Response rate">{responseRate}%</Field>
              <Field label="Commercial rank">
                {focusAnalysis?.rank ? `#${focusAnalysis.rank}` : "—"}
              </Field>
              <Field label="PO">
                {poName && poName !== "—" ? poName : poStatus}
              </Field>
            </div>

            <div className="lg:col-span-4">
              <div className={label}>Decision summary</div>
              <ul className="mt-1.5 space-y-1">
                {bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2 text-[13px] text-[#111827]"
                  >
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                    {b}
                  </li>
                ))}
              </ul>
              {!procurementFinalized &&
                !hasQuotations &&
                !hasSelectedSupplier && (
                  <p className="mt-2 text-[12px] text-[#6B7280]">
                    Available after quotations are submitted.
                  </p>
                )}
              {!procurementFinalized &&
                hasQuotations &&
                hasAnthropicKey &&
                !aiReady &&
                !hasSelectedSupplier && (
                  <p className="mt-2 text-[12px] text-[#6B7280]">
                    Need at least 2 quotations.
                  </p>
                )}
              {!procurementFinalized &&
                hasQuotations &&
                !hasAnthropicKey &&
                !hasSelectedSupplier && (
                  <p className="mt-2 text-[12px] text-[#6B7280]">
                    Local comparison will be used.
                  </p>
                )}
            </div>
          </div>
        </section>

        {/* ── KPIs ── */}
        <section className={`grid grid-cols-2 ${gap} sm:grid-cols-4 xl:grid-cols-8`}>
          <Kpi label="Items">{rfq.items?.length ?? 0}</Kpi>
          <Kpi label="Suppliers invited">{supplierCount}</Kpi>
          <Kpi label="Responses">
            {respondedCount}
            <span className="text-[12px] font-normal text-[#6B7280]">
              {" "}
              ({quotedCount} quoted)
            </span>
          </Kpi>
          <Kpi label="Lowest quote">
            {lowestQuote > 0 ? formatCurrency(lowestQuote) : "—"}
          </Kpi>
          <Kpi label="Savings">
            {copilotSavings && copilotSavings.amount > 0
              ? formatCurrency(copilotSavings.amount)
              : "—"}
          </Kpi>
          <Kpi label="Budget">
            {estimatedBudget > 0 ? formatCurrency(estimatedBudget) : "—"}
          </Kpi>
          <Kpi label="Average quote">
            {avgQuote > 0 ? formatCurrency(avgQuote) : "—"}
          </Kpi>
          <Kpi label="Lead time">
            {avgLeadTime > 0 ? `${avgLeadTime} days` : "—"}
          </Kpi>
        </section>

        {/* ── Workflow ── */}
        <WorkflowBar steps={timeline} />

        {quotesQueryError && (
          <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
            <span>Quotations failed to load.</span>
            <button
              type="button"
              onClick={onRetryQuotes}
              className="font-medium underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Items ── */}
        <section className={panel}>
          <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3">
            <h2 className={sectionTitle}>Items</h2>
            <span className="text-[13px] text-[#6B7280]">
              {rfq.items?.length ?? 0} lines · qty {totalQty}
            </span>
          </div>
          {(rfq.items ?? []).length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No items"
              description="This RFQ has no line items."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-left text-[12px] font-medium text-[#6B7280]">
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">
                      Description
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 text-right font-medium">UOM</th>
                    <th className="px-4 py-2 font-medium">Delivery</th>
                    <th className="px-4 py-2 font-medium">Attachments</th>
                  </tr>
                </thead>
                <tbody>
                  {(rfq.items ?? []).map((it) => (
                    <tr
                      key={it.name}
                      className="border-b border-[#E2E8F0] last:border-0 hover:bg-neutral-50/80"
                    >
                      <td className="px-4 py-2 align-middle">
                        <div className="font-medium text-[#111827]">
                          {it.item_name ?? it.item_code}
                        </div>
                        <div className="font-mono text-[12px] text-[#6B7280]">
                          {it.item_code}
                        </div>
                      </td>
                      <td className="hidden max-w-[240px] px-4 py-2 align-middle text-[#6B7280] md:table-cell">
                        <span className="line-clamp-1">
                          {it.description ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right align-middle tabular-nums font-medium text-[#111827]">
                        {it.qty}
                      </td>
                      <td className="px-4 py-2 text-right align-middle text-[#6B7280]">
                        {it.uom ?? "—"}
                      </td>
                      <td className="px-4 py-2 align-middle text-[#6B7280]">
                        {it.schedule_date
                          ? formatDate(it.schedule_date)
                          : expectedDelivery}
                      </td>
                      <td className="px-4 py-2 align-middle">
                        <ItemAttachmentsCell
                          lookup={{
                            item_code: it.item_code,
                            material_request: it.material_request,
                            material_request_item: it.material_request_item,
                            custom_part_name: it.custom_part_name,
                            custom_2d_drawing: it.custom_2d_drawing,
                            custom_engineering_attachments:
                              it.custom_engineering_attachments,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Suppliers ── */}
        <section className={`${panel} p-4`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={sectionTitle}>Supplier quotations</h2>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-[#6B7280]">
                {supplierCount} invited · {quotedCount} quoted
                {declinedCount > 0 ? ` · ${declinedCount} declined` : ""}
              </span>
              {canCompareQuotations && (
                <Btn onClick={onCompareQuotations}>
                  <Scale className="h-3.5 w-3.5" />
                  Compare
                </Btn>
              )}
            </div>
          </div>

          {!isCompleted && (
            <p className="mb-3 text-[13px] text-[#6B7280]">
              Quote amounts stay hidden until AI analysis is complete.
            </p>
          )}

          <div className={`grid ${gap} sm:grid-cols-2 xl:grid-cols-3`}>
            {(rfq.suppliers ?? []).map((s) => {
              const quote = quoteForSupplier(localQuotes, s.supplier);
              const decline = declineBySupplier.get(
                (s.supplier ?? "").toLowerCase(),
              );
              const status = resolveSupplierStatus(
                s,
                !!quote,
                rfq.valid_till || undefined,
                !!decline,
              );
              const isWinner =
                hasSelectedSupplier &&
                s.supplier.trim().toLowerCase() ===
                  resolvedSelectedSupplier.trim().toLowerCase();
              const analysis = analysisBySupplier.get(
                (s.supplier ?? "").trim().toLowerCase(),
              );
              const deliveryDays = quote
                ? [...quote.byItem.values()].find((v) => v.delivery_days)
                    ?.delivery_days
                : undefined;
              const showAmounts = canCompareQuotations && !!quote;

              return (
                <article
                  key={s.name}
                  data-supplier={s.supplier}
                  className={`flex h-full flex-col rounded-lg border p-3 ${
                    isWinner
                      ? "border-emerald-500 bg-emerald-50/30"
                      : "border-[#E2E8F0] bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-medium text-[#111827]">
                        {s.supplier_name || s.supplier}
                      </div>
                      <div className="truncate font-mono text-[12px] text-[#6B7280]">
                        {s.supplier}
                      </div>
                    </div>
                    {isWinner ? (
                      <Badge tone="green">Selected</Badge>
                    ) : quote ? (
                      <Badge tone="green">Submitted</Badge>
                    ) : decline ? (
                      <Badge tone="amber">No quote</Badge>
                    ) : (
                      <StatusBadge
                        status={status}
                        tone={supplierStatusTone(status)}
                      />
                    )}
                  </div>

                  <div className="mt-3 grid flex-1 grid-cols-2 gap-x-3 gap-y-2">
                    <Field label="Quote">
                      {showAmounts ? formatCurrency(quote!.total) : "—"}
                    </Field>
                    <Field label="Delivery">
                      {showAmounts && deliveryDays
                        ? `${deliveryDays} days`
                        : "—"}
                    </Field>
                    <Field label="AI score">
                      {analysis?.score?.overall != null
                        ? Math.round(Number(analysis.score.overall))
                        : "—"}
                    </Field>
                    <Field label="Rank">
                      {analysis?.rank ? `#${analysis.rank}` : "—"}
                    </Field>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-[#E2E8F0] pt-3">
                    {quote && canViewQuotations && (
                      <Btn
                        variant="ghost"
                        onClick={() => onViewQuotation(quote.sqName)}
                        disabled={!quote.sqName}
                        className="px-0"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View quotation
                      </Btn>
                    )}
                    {decline && (
                      <Btn
                        variant="ghost"
                        onClick={() => onViewDeclineReason(decline)}
                        className="px-0"
                      >
                        View reason
                      </Btn>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* ── Selected supplier (only when awarded) ── */}
        {hasSelectedSupplier && (
          <section className={`${panel} p-4`}>
            <h2 className={`${sectionTitle} mb-3`}>Selected supplier</h2>
            <div
              className={`grid grid-cols-2 ${gap} sm:grid-cols-3 lg:grid-cols-6`}
            >
              <Field label="Supplier">{resolvedSelectedSupplier}</Field>
              <Field label="Award amount">
                {selectedSupplierTotal > 0
                  ? formatCurrency(selectedSupplierTotal)
                  : "—"}
              </Field>
              <Field label="Savings">
                {copilotSavings && copilotSavings.amount > 0
                  ? formatCurrency(copilotSavings.amount)
                  : "—"}
              </Field>
              <Field label="Legal">
                <Badge
                  tone={
                    workflow.legalRejected
                      ? "red"
                      : workflow.legalApproved
                        ? "green"
                        : "amber"
                  }
                >
                  {workflow.legalStatus}
                </Badge>
              </Field>
              <Field label="Finance">
                <Badge
                  tone={
                    workflow.financeRejected
                      ? "red"
                      : workflow.financeApproved
                        ? "green"
                        : "amber"
                  }
                >
                  {workflow.financeStatus}
                </Badge>
              </Field>
              <Field label="Purchase order">
                {poExists ? poName || "Created" : "Not created"}
              </Field>
            </div>
            {(legalDoc?.approved_by || legalDoc?.finance_approved_by) && (
              <p className="mt-3 text-[12px] text-[#6B7280]">
                Legal: {legalDoc?.approved_by || "—"}
                {legalDoc?.approved_on
                  ? ` (${formatDate(legalDoc.approved_on)})`
                  : ""}
                {" · "}
                Finance: {legalDoc?.finance_approved_by || "—"}
                {legalDoc?.finance_approved_on
                  ? ` (${formatDate(legalDoc.finance_approved_on)})`
                  : ""}
              </p>
            )}
          </section>
        )}

        {reverseBiddingSlot}
      </div>

      {checkBudgetModal}
      {modals}
    </div>
  );
}
