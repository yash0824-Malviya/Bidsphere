/**
 * RFQ Detail — enterprise presentation (UI only).
 * Business logic, queries, and handlers remain in RFQDetailPage.
 */

import {
  memo,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  Ban,
  Check,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Printer,
  Scale,
  ShoppingCart,
  Sparkles,
  UserPlus,
} from "lucide-react";

import type {
  RfqProcurementWorkflow,
  RfqWorkflowStep,
} from "../../../api/rfqProcurementWorkflow";
import type { LegalDocumentSet } from "../../../api/legalDocs";
import type {
  QuotePriceStatus,
  RFQ,
  RFQSupplier,
  SupplierAnalysisRow,
} from "../../../types/erpnext";
import type { SupplierRfqResponse } from "../../../api/supplierRfqResponse";
import { useOptionalLayout } from "../../../contexts/LayoutContext";
import StatusBadge from "../../../components/StatusBadge";
import EmptyState from "../../../components/EmptyState";
import ScoreRing from "../../../components/sourcing/ScoreRing";
import { formatCurrency, formatDate } from "../../../utils/format";
import { getEvaluationRisk, projectSupplierDecision } from "../../../utils/aiEvaluationDecision";
import { getSupplierAwardEligibility } from "../../../utils/supplierAwardEligibility";
import {
  formatQuoteTotal,
  isSubmittedQuoteAmount,
} from "../../../utils/quotePrice";

/* ── Design-system class tokens (main content only) ─────────────────────── */

const card = "rfq-card";
const gap = "gap-4";
const stack = "space-y-4";
const labelCls = "rfq-label";
const valueCls = "text-[14px] font-medium text-[var(--rfq-text)]";
const sectionTitle = "rfq-section-title";
const mono = "rfq-mono";

/* ── Types (unchanged contract) ─────────────────────────────────────────── */

export interface SupplierQuoteView {
  sqName: string;
  supplier: string;
  supplier_name: string;
  total: number | null;
  priceStatus: QuotePriceStatus;
  notes: string;
  payment_terms?: string;
  byItem: Map<
    string,
    { unit_price: number | null; total: number | null; delivery_days: number }
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
  copilotRiskLevel: ReturnType<typeof getEvaluationRisk> | null;
  copilotSavings: { pct: number; amount: number } | null;
  recommendedSupplierLabel: string;
  aiReady: boolean;
  aiLoading: boolean;
  aiButtonMode: RfqProcurementWorkflow["aiButtonMode"];
  hasQuotations: boolean;
  hasAnthropicKey: boolean;

  canCompareQuotations: boolean;
  canViewQuotations: boolean;
  canInviteMoreSuppliers: boolean;
  showSubmitRFQ: boolean;
  submittingRFQ: boolean;
  creatingPO: boolean;

  aiNeedsRerun: boolean;
  aiStaleSource?: "invite" | "quotation";
  onRerunAiAnalysis: () => void;

  localQuotes: Map<string, SupplierQuoteView>;
  declineBySupplier: Map<string, SupplierRfqResponse>;
  supplierAnalysisRows: SupplierAnalysisRow[];

  quotesQueryError: boolean;
  quotesQueryErrorMessage?: string | null;
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
  onInviteMoreSuppliers: () => void;

  pendingInvitationSupplierIds: Set<string>;

  resolveSupplierStatus: (
    s: RFQSupplier,
    hasQuote: boolean,
    validTill: string | undefined,
    hasDecline: boolean,
    pendingInvitation?: boolean,
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
  quoteRoundsSlot?: ReactNode;
  legalRejectedActions: ReactNode;
  financeRejectedActions: ReactNode;
  checkBudgetModal: ReactNode;
  modals: ReactNode;
}

type DisplayScore = { score: number; rank: number; evaluation: SupplierAnalysisRow };

function normKey(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function uniqueKeys(...values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const v of values) {
    const k = normKey(v);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Resolve AI score + rank for every Submitted supplier (has a quote).
 * Pending suppliers are omitted (UI shows "—").
 * Display the saved evaluation's score and rank for its exact quotation.
 * Missing evaluations remain unavailable; this display does not score suppliers.
 */
export function buildSubmittedSupplierScores(opts: {
  suppliers: RFQSupplier[];
  localQuotes: Map<string, SupplierQuoteView>;
  analysisRows: SupplierAnalysisRow[];
  quoteForSupplier: RFQDetailEnterpriseLayoutProps["quoteForSupplier"];
  itemCount: number;
  targetPrices?: Map<string, number>;
  rfqId?: string;
}): Map<string, DisplayScore> {
  const {
    suppliers,
    localQuotes,
    analysisRows,
    quoteForSupplier,
    rfqId,
  } = opts;
  const result = new Map<string, DisplayScore>();

  const runs = new Set(analysisRows.map((row) => row.evaluation_run_id).filter(Boolean));
  // Without an envelope run ID, mixed runs cannot identify a current result.
  if (runs.size > 1) return result;
  const currentRun = [...runs][0];
  const eligibleRows = analysisRows.filter((row) =>
    (!rfqId || !row.rfq_id || row.rfq_id === rfqId) &&
    (!currentRun || row.evaluation_run_id === currentRun));
  const submitted = suppliers.map((supplier) => {
    const quote = quoteForSupplier(localQuotes, supplier.supplier);
    return { supplier, quote: quote?.supplier === supplier.supplier ? quote : undefined };
  }).filter((entry): entry is { supplier: RFQSupplier; quote: SupplierQuoteView } => !!entry.quote);
  const nameOwners = new Map<string, Set<string>>();
  for (const { supplier, quote } of submitted) {
    for (const name of uniqueKeys(supplier.supplier_name, quote.supplier_name)) {
      const owners = nameOwners.get(name) ?? new Set<string>();
      owners.add(quote.sqName || quote.supplier);
      nameOwners.set(name, owners);
    }
  }

  for (const { supplier, quote } of submitted) {
    const names = uniqueKeys(supplier.supplier_name, quote.supplier_name, supplier.supplier);
    const matches = eligibleRows.filter((row) => {
      const quotationId = row.quotation_id || row.supplier_quotation_id;
      if (row.quotation_id && row.supplier_quotation_id && row.quotation_id !== row.supplier_quotation_id) return false;
      if (quotationId) {
        return quotationId === quote.sqName && (!row.supplier_id || row.supplier_id === quote.supplier);
      }
      if (row.supplier_id) return row.supplier_id === quote.supplier;
      const name = normKey(row.name);
      return names.includes(name) && nameOwners.get(name)?.size === 1;
    });
    if (matches.length !== 1) continue;
    const row = matches[0];
    const overall = row?.score?.overall;
    if (typeof overall !== "number" || !Number.isFinite(overall) || overall < 0 || overall > 100 ||
        !Number.isInteger(row.rank) || row.rank < 1) continue;
    const entry = { score: overall, rank: row.rank, evaluation: row };
    // Prefix exact document identities so case/punctuation/name aliases cannot
    // collide with a Supplier or Supplier Quotation ID.
    if (quote.sqName) result.set(`quotation:${quote.sqName}`, entry);
    if (quote.supplier) result.set(`supplier:${quote.supplier}`, entry);
    if (supplier.supplier === quote.supplier) result.set(`supplier:${supplier.supplier}`, entry);
    for (const name of names) {
      if (nameOwners.get(name)?.size === 1) result.set(`name:${name}`, entry);
    }
  }

  return result;
}

/* ── Small primitives ───────────────────────────────────────────────────── */

function Field({
  label: lbl,
  children,
  monoValue = false,
}: {
  label: string;
  children: ReactNode;
  monoValue?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className={labelCls}>{lbl}</div>
      <div
        className={`mt-0.5 truncate ${valueCls} ${monoValue ? mono : ""}`.trim()}
      >
        {children}
      </div>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "amber" | "red" | "teal";
}) {
  const map = {
    neutral: "bg-[var(--rfq-paper)] text-[var(--rfq-text-soft)]",
    blue: "bg-[var(--rfq-accent-soft)] text-[var(--rfq-accent)]",
    green: "bg-[var(--rfq-success-soft)] text-[var(--rfq-success)]",
    teal: "bg-[var(--rfq-teal-soft)] text-[var(--rfq-teal)]",
    amber: "bg-[var(--rfq-warn-soft)] text-[var(--rfq-warn)]",
    red: "bg-[var(--rfq-danger-soft)] text-[var(--rfq-danger)]",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${map[tone]}`}
    >
      {children}
    </span>
  );
}

function ApprovalPill({
  approved,
  rejected,
  label,
  by,
  on,
}: {
  approved: boolean;
  rejected: boolean;
  label: string;
  by?: string | null;
  on?: string | null;
}) {
  if (rejected) {
    return (
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--rfq-danger-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--rfq-danger)]">
          <Ban className="h-3 w-3" />
          Rejected
        </span>
        <p className={`mt-1 text-[11px] text-[var(--rfq-text-faint)]`}>
          {label}
        </p>
      </div>
    );
  }
  if (approved) {
    return (
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--rfq-success-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--rfq-success)]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approved
        </span>
        <p className={`mt-1 text-[11px] text-[var(--rfq-text-faint)] ${mono}`}>
          {[by, on ? formatDate(on) : null].filter(Boolean).join(" · ") || label}
        </p>
      </div>
    );
  }
  return (
    <div>
      <Badge tone="amber">{label}</Badge>
    </div>
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
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
  className?: string;
  href?: string;
  title?: string;
}) {
  const styles = {
    primary:
      "bg-[var(--rfq-accent)] text-white hover:opacity-90 disabled:opacity-50",
    secondary:
      "border border-[var(--rfq-border)] bg-[var(--rfq-surface)] text-[var(--rfq-text)] hover:bg-[var(--rfq-paper)] disabled:opacity-50",
    ghost:
      "text-[var(--rfq-accent)] hover:underline disabled:opacity-50",
  } as const;
  const cls = `inline-flex items-center justify-center gap-1.5 rounded-[var(--rfq-radius-control)] px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rfq-accent)] ${styles[variant]} ${className}`;
  if (href) {
    return (
      <Link to={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls} title={title}>
      {children}
    </button>
  );
}

function GaugeBar({
  label: lbl,
  valueLabel,
  pct,
}: {
  label: string;
  valueLabel: string;
  pct: number;
}) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={labelCls}>{lbl}</span>
        <span className={`${mono} text-[13px] font-semibold text-[var(--rfq-text)]`}>
          {valueLabel}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--rfq-paper)]">
        <div
          className="h-full rounded-full bg-[var(--rfq-accent)]"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function Kpi({ label: lbl, children }: { label: string; children: ReactNode }) {
  return (
    <div className={`${card} px-3 py-2.5`}>
      <div className={labelCls}>{lbl}</div>
      <div className={`mt-1 ${mono} text-[18px] font-semibold text-[var(--rfq-text)]`}>
        {children}
      </div>
    </div>
  );
}

/* ── Decision bullets ───────────────────────────────────────────────────── */

function decisionBullets(opts: {
  hasAnalysis: boolean;
  selected: boolean;
  selectedTotal: number;
  lowest: number;
  risk: ReturnType<typeof getEvaluationRisk> | null;
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
  if (out.length < 5 && opts.strengths?.[0]) {
    out.push(opts.strengths[0].trim());
  }
  if (!opts.hasAnalysis && !opts.selected) {
    return ["Run AI analysis after quotations are received"];
  }
  return out.slice(0, 5);
}

/* ── Procurement Status ─────────────────────────────────────────────────── */

const WorkflowBar = memo(function WorkflowBar({
  steps,
}: {
  steps: RfqWorkflowStep[];
}) {
  const visibleSteps = steps.filter((step) => step.id !== "clm");
  return (
    <div className={`${card} p-4`}>
      <h2 className={`${sectionTitle} mb-4`}>Procurement Status</h2>
      <ol className="hidden w-full md:flex md:items-start">
        {visibleSteps.map((step, i) => (
          <li key={step.id} className="flex min-w-0 flex-1 items-start">
            <div
              className="flex w-full flex-col items-center px-0.5 text-center"
              title={step.meta}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold ${
                  step.rejected
                    ? "border-[var(--rfq-danger)] bg-[var(--rfq-danger)] text-white"
                    : step.done
                      ? "border-[var(--rfq-success)] bg-[var(--rfq-success)] text-white"
                      : step.active
                        ? "border-[var(--rfq-accent)] bg-[var(--rfq-accent)] text-white"
                        : "border-[var(--rfq-border)] bg-[var(--rfq-surface)] text-[var(--rfq-text-faint)]"
                }`}
              >
                {step.rejected ? (
                  <Ban className="h-3.5 w-3.5" />
                ) : step.done ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`mt-2 line-clamp-2 text-[11px] font-semibold leading-tight ${
                  step.active
                    ? "text-[var(--rfq-accent)]"
                    : step.done
                      ? "text-[var(--rfq-text)]"
                      : "text-[var(--rfq-text-soft)]"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < visibleSteps.length - 1 && (
              <span
                aria-hidden
                className={`mt-3.5 h-0.5 min-w-[8px] flex-1 ${
                  step.done
                    ? "bg-[var(--rfq-success)]"
                    : "bg-[var(--rfq-border)]"
                }`}
              />
            )}
          </li>
        ))}
      </ol>
      <ol className="space-y-2 md:hidden">
        {visibleSteps.map((step) => (
          <li key={step.id} className="flex items-start gap-2">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                step.rejected
                  ? "bg-[var(--rfq-danger)] text-white"
                  : step.done
                    ? "bg-[var(--rfq-success)] text-white"
                    : step.active
                      ? "bg-[var(--rfq-accent)] text-white"
                      : "bg-[var(--rfq-border)] text-[var(--rfq-text-faint)]"
              }`}
            >
              {step.done && !step.rejected ? (
                <Check className="h-3 w-3" strokeWidth={3} />
              ) : null}
            </span>
            <div>
              <div className="text-[13px] font-semibold text-[var(--rfq-text)]">
                {step.label}
              </div>
              <div className="text-[12px] text-[var(--rfq-text-soft)]">
                {step.meta}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
});

/** Read-only Target Pricing + quantity trail — configured at RFQ creation. */
function ItemsWithTargetPrice({ rfq }: { rfq: RFQ }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-left text-sm">
        <thead className="bg-[var(--rfq-paper)] text-[11px] font-semibold uppercase tracking-wide text-[var(--rfq-text-soft)]">
          <tr>
            <th className="px-4 py-2.5">Item</th>
            <th className="px-4 py-2.5 text-right">Dept Requested</th>
            <th className="px-4 py-2.5 text-right">WH Available</th>
            <th className="px-4 py-2.5 text-right">Final Qty</th>
            <th className="px-4 py-2.5">UOM</th>
            <th className="px-4 py-2.5">Qty Reason</th>
            <th className="px-4 py-2.5 text-right">Target Price</th>
            <th className="px-4 py-2.5 text-center">Show to Supplier</th>
            <th className="px-4 py-2.5">Required By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--rfq-border)]">
          {(rfq.items ?? []).map((it) => {
            const key = it.name || it.item_code;
            const displayTarget = Number(it.custom_target_price);
            const hasTarget =
              Number.isFinite(displayTarget) && displayTarget > 0;
            const showToSupplier = !!(
              it.custom_show_target_price_to_supplier ??
              rfq.custom_show_target_price_to_supplier
            );
            const dept =
              it.custom_department_requested_qty != null &&
              Number.isFinite(Number(it.custom_department_requested_qty))
                ? Number(it.custom_department_requested_qty)
                : Number(it.qty) || 0;
            const wh =
              it.custom_warehouse_available_qty != null &&
              Number.isFinite(Number(it.custom_warehouse_available_qty))
                ? Number(it.custom_warehouse_available_qty)
                : null;
            const final =
              it.custom_procurement_final_qty != null &&
              Number.isFinite(Number(it.custom_procurement_final_qty))
                ? Number(it.custom_procurement_final_qty)
                : Number(it.qty) || 0;
            return (
              <tr key={key} className="bg-[var(--rfq-surface)]">
                <td className="px-4 py-2.5">
                  <div className={`${mono} font-semibold text-[var(--rfq-text)]`}>
                    {it.item_code}
                  </div>
                  <div className="text-[12px] text-[var(--rfq-text-soft)]">
                    {it.item_name || it.description || "—"}
                  </div>
                </td>
                <td className={`px-4 py-2.5 text-right ${mono} tabular-nums`}>
                  {dept}
                </td>
                <td className={`px-4 py-2.5 text-right ${mono} tabular-nums`}>
                  {wh == null ? "—" : wh}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-semibold ${mono} tabular-nums text-[var(--rfq-text)]`}
                >
                  {final}
                </td>
                <td className={`px-4 py-2.5 ${mono}`}>{it.uom || "—"}</td>
                <td className="px-4 py-2.5 text-[12px] text-[var(--rfq-text-soft)]">
                  {it.custom_qty_change_reason?.trim() || "—"}
                </td>
                <td className={`px-4 py-2.5 text-right ${mono} tabular-nums`}>
                  {hasTarget ? formatCurrency(displayTarget) : "—"}
                </td>
                <td className="px-4 py-2.5 text-center text-[13px] text-[var(--rfq-text)]">
                  {showToSupplier ? "Yes" : "No"}
                </td>
                <td className={`px-4 py-2.5 ${mono}`}>
                  {formatDate(it.schedule_date)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
    legalDoc,
    poExists,
    poName,
    canCreatePO,
    procurementFinalized,
    copilotHasAnalysis,
    recommendedSupplierLabel,
    aiReady,
    aiLoading,
    aiButtonMode,
    hasQuotations,
    hasAnthropicKey,
  canCompareQuotations,
  canViewQuotations,
  canInviteMoreSuppliers,
  showSubmitRFQ,
  submittingRFQ,
  creatingPO,
  aiNeedsRerun,
  aiStaleSource = "quotation",
  onRerunAiAnalysis,
    localQuotes,
    declineBySupplier,
    supplierAnalysisRows,
    quotesQueryError,
    quotesQueryErrorMessage,
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
  onInviteMoreSuppliers,
  pendingInvitationSupplierIds,
    resolveSupplierStatus,
    supplierStatusTone,
    quoteForSupplier,
    rejectionBanners,
    reverseBiddingSlot,
    quoteRoundsSlot,
    checkBudgetModal,
    modals,
  } = props;

  const hasSubmittedPrices = Array.from(localQuotes.values()).some((quote) =>
    isSubmittedQuoteAmount(quote.total),
  );

  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    const register = layout?.registerPageHeader;
    const unregister = layout?.unregisterPageHeader;
    if (!register || !unregister) return;
    register();
    return () => unregister();
  }, [layout?.registerPageHeader, layout?.unregisterPageHeader]);

  const displayScores = useMemo(
    () =>
      buildSubmittedSupplierScores({
        suppliers: rfq.suppliers ?? [],
        localQuotes,
        analysisRows: supplierAnalysisRows,
        rfqId: rfq.name,
        quoteForSupplier,
        itemCount: rfq.items?.length ?? 0,
        targetPrices: (() => {
          const map = new Map<string, number>();
          for (const it of rfq.items ?? []) {
            const t = Number(it.custom_target_price);
            if (Number.isFinite(t) && t > 0) map.set(it.item_code, t);
          }
          return map;
        })(),
      }),
    [
      rfq.suppliers,
      rfq.name,
      rfq.items,
      localQuotes,
      supplierAnalysisRows,
      quoteForSupplier,
    ],
  );

  const focusKey = hasSelectedSupplier ? resolvedSelectedSupplier : recommendedSupplierLabel;
  const focusScore =
    displayScores.get(`supplier:${focusKey}`) ?? displayScores.get(`name:${normKey(focusKey)}`);
  const focusAnalysis = focusScore?.evaluation;
  const focusEligibility = focusAnalysis ? getSupplierAwardEligibility(focusAnalysis) : null;
  const focusRisk = focusAnalysis ? getEvaluationRisk(focusAnalysis) : null;
  const focusDecision = focusAnalysis ? projectSupplierDecision(focusAnalysis, focusAnalysis.rank === 1) : null;
  const focusReason = focusAnalysis?.why_best_or_worst;
  const quoteTotals = Array.from(localQuotes.values()).map((quote) => quote.total).filter(isSubmittedQuoteAmount);
  const highestSubmittedQuote = quoteTotals.length ? Math.max(...quoteTotals) : 0;
  const focusSavings = isSubmittedQuoteAmount(focusAnalysis?.grand_total)
    ? Math.max(0, highestSubmittedQuote - focusAnalysis.grand_total) : 0;

  const confidence =
    focusScore ? Math.round(focusScore.score) : 0;

  const bullets = useMemo(
    () =>
      decisionBullets({
        hasAnalysis: copilotHasAnalysis,
        selected: hasSelectedSupplier,
        selectedTotal: selectedSupplierTotal,
        lowest: lowestQuote,
        risk: focusRisk,
        legalOk: workflow.legalApproved,
        financeOk: workflow.financeApproved,
        rank: focusScore?.rank ?? focusAnalysis?.rank,
        strengths: focusDecision?.strengths,
        reason: focusReason,
      }),
    [
      copilotHasAnalysis,
      hasSelectedSupplier,
      selectedSupplierTotal,
      lowestQuote,
      focusRisk,
      workflow.legalApproved,
      workflow.financeApproved,
      focusScore,
      focusAnalysis,
      focusDecision,
      focusReason,
    ],
  );

  const recommendationFooter = useMemo(() => {
    if (focusDecision) return `${focusDecision.recommendation_reason} ${focusReason || ""}`.trim();
    const who = hasSelectedSupplier
      ? resolvedSelectedSupplier
      : recommendedSupplierLabel;
    if (who && who !== "—" && (copilotHasAnalysis || hasSelectedSupplier)) {
      return `Evaluation unavailable for ${who}. Review the quotation before making a selection.`;
    }
    if (!hasQuotations) {
      return "Awaiting supplier quotations before AI evaluation.";
    }
    return "Run AI analysis to compare scores, risk and verdicts.";
  }, [
    focusDecision,
    focusReason,
    hasSelectedSupplier,
    resolvedSelectedSupplier,
    recommendedSupplierLabel,
    copilotHasAnalysis,
    focusScore,
    hasQuotations,
  ]);

  const poStatus = poExists
    ? "Created"
    : workflow.purchaseOrderStatus === "Ready"
      ? "Ready"
      : "Pending";

  const displaySupplier = hasSelectedSupplier
    ? resolvedSelectedSupplier
    : recommendedSupplierLabel;

  const coveragePct = supplierCount
    ? (respondedCount / supplierCount) * 100
    : 0;

  return (
    <div className="rfq-detail-ds -mx-1 rounded-[var(--rfq-radius-card)] px-1 pb-8 pt-1 md:px-0">
      {isReadOnly && (
        <div className="mb-4 rounded-[var(--rfq-radius-card)] border border-[var(--rfq-accent)]/30 bg-[var(--rfq-accent-soft)] px-3 py-2 text-[13px] text-[var(--rfq-accent)]">
          Read-only view. Use Legal Reviews to approve or reject.
        </div>
      )}

      {rejectionBanners}

      {aiNeedsRerun && !procurementFinalized && !hasSelectedSupplier ? (
        <div className="mb-4 flex flex-col gap-3 rounded-[var(--rfq-radius-card)] border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-amber-900">
              {aiStaleSource === "invite"
                ? "New supplier(s) invited."
                : "New supplier quotation received."}
            </p>
            <p className="mt-0.5 text-[12px] text-amber-800">
              {aiStaleSource === "invite"
                ? "AI recommendation will update after new quotations are received."
                : "AI recommendation needs to be recalculated before award."}
            </p>
          </div>
          <Btn onClick={onRerunAiAnalysis} variant="primary" className="shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
            Re-run AI Analysis
          </Btn>
        </div>
      ) : null}

      <div className={stack}>
        {/* ── Top bar / header ── */}
        <header className={`${card} p-4 md:p-5`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  className={`${mono} text-[26px] font-semibold leading-tight text-[var(--rfq-text)] md:text-[28px]`}
                >
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
              {canInviteMoreSuppliers ? (
                <Btn onClick={onInviteMoreSuppliers}>
                  <UserPlus className="h-3.5 w-3.5" />
                  Invite More Suppliers
                </Btn>
              ) : null}
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

          {/* Meta strip — 3 cols from ~768px */}
          <div
            className={`mt-4 grid grid-cols-2 border-t border-[var(--rfq-border)] pt-4 ${gap} sm:grid-cols-3 lg:grid-cols-6`}
          >
            <Field label="Company">{companyLabel}</Field>
            <Field label="Department">{departmentLabel}</Field>
            <Field label="Owner">{ownerLabel}</Field>
            <Field label="Created" monoValue>
              {formatDate(rfq.transaction_date)}
            </Field>
            <Field label="Valid till" monoValue>
              {validTillDisplay}
            </Field>
            <Field label="Currency" monoValue>
              {currencyLabel}
            </Field>
            <Field label="MR" monoValue>
              {materialRequestLabel}
            </Field>
            <Field label="Selected supplier">
              {hasSelectedSupplier ? resolvedSelectedSupplier : "—"}
            </Field>
            <Field label="Award value" monoValue>
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
            <Field label="Delivery" monoValue>
              {expectedDelivery}
            </Field>
            <Field label="Next approver">{workflow.nextApprover}</Field>
          </div>
        </header>

        {/* ── AI recommendation ── */}
        <section className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rfq-border)] px-4 py-3 md:px-5">
            <h2 className={sectionTitle}>AI evaluation</h2>
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
                : aiButtonMode === "view_and_rerun" ? (
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
                  ) : (
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
                  onClick={() => { if (focusEligibility?.awardEligible !== false) onCreatePO(); }}
                  disabled={creatingPO || !canCreatePO || focusEligibility?.awardEligible === false}
                  title={focusEligibility?.awardIneligibilityReason}
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

          <div className={`grid ${gap} p-4 md:grid-cols-3 md:p-5`}>
            {/* (a) gauges */}
            <div className="space-y-4">
              <p className="text-[13px] font-semibold text-[var(--rfq-text)]">
                {hasSelectedSupplier ? "Selected" : focusEligibility?.awardEligible === false ? "Top score" : "AI top-ranked"}
              </p>
              <p className="truncate text-[15px] font-semibold text-[var(--rfq-text)]">
                {displaySupplier || "—"}
              </p>
              <GaugeBar
                label="AI score"
                valueLabel={focusScore ? `${confidence}/100` : "—"}
                pct={focusScore ? confidence : 0}
              />
              <GaugeBar
                label="Coverage"
                valueLabel={`${respondedCount}/${supplierCount}`}
                pct={coveragePct}
              />
              <Field label="Commercial rank" monoValue>
                {focusScore?.rank ? `#${focusScore.rank}` : "—"}
              </Field>
            </div>

            {/* (b) bordered stat list */}
            <div className="rounded-[var(--rfq-radius-card)] border border-[var(--rfq-border)]">
              {(
                [
                  ["Risk", focusRisk ?? "Unavailable", false],
                  ["Verdict", focusAnalysis?.verdict ?? "Unavailable", false],
                  [
                    "Savings",
                    focusSavings > 0
                      ? formatCurrency(focusSavings)
                      : "—",
                    true,
                  ],
                  [
                    "Lowest quote",
                    hasSubmittedPrices ? formatCurrency(lowestQuote) : "—",
                    true,
                  ],
                  [
                    "Average quote",
                    hasSubmittedPrices ? formatCurrency(avgQuote) : "—",
                    true,
                  ],
                  ["Response rate", `${responseRate}%`, true],
                  [
                    "PO",
                    poName && poName !== "—" ? poName : poStatus,
                    Boolean(poName && poName !== "—"),
                  ],
                ] as const
              ).map(([lbl, val, isMono], i, arr) => (
                <div
                  key={lbl}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                    i < arr.length - 1
                      ? "border-b border-[var(--rfq-border)]"
                      : ""
                  }`}
                >
                  <span className={labelCls}>{lbl}</span>
                  <span
                    className={`text-right text-[13px] font-semibold text-[var(--rfq-text)] ${
                      isMono ? mono : ""
                    }`}
                  >
                    {val}
                  </span>
                </div>
              ))}
            </div>

            {/* (c) decision checklist */}
            <div>
              <div className={labelCls}>Decision summary</div>
              <ul className="mt-2 space-y-2">
                {bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2.5 text-[13px] text-[var(--rfq-text)]"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--rfq-success-soft)] text-[var(--rfq-success)]">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              {!procurementFinalized &&
                !hasQuotations &&
                !hasSelectedSupplier && (
                  <p className="mt-3 text-[12px] text-[var(--rfq-text-soft)]">
                    Available after quotations are submitted.
                  </p>
                )}
              {!procurementFinalized &&
                hasQuotations &&
                hasAnthropicKey &&
                !aiReady &&
                !hasSelectedSupplier && (
                  <p className="mt-3 text-[12px] text-[var(--rfq-text-soft)]">
                    Need at least 2 quotations.
                  </p>
                )}
              {!procurementFinalized &&
                hasQuotations &&
                !hasAnthropicKey &&
                !hasSelectedSupplier && (
                  <p className="mt-3 text-[12px] text-[var(--rfq-text-soft)]">
                    Local comparison will be used.
                  </p>
                )}
            </div>
          </div>

          <div className="border-t border-[var(--rfq-border)] bg-[var(--rfq-accent-soft)] px-4 py-3 text-[13px] text-[var(--rfq-accent)] md:px-5">
            {recommendationFooter}
          </div>
        </section>

        {/* ── KPIs ── */}
        <section
          className={`grid grid-cols-2 ${gap} sm:grid-cols-4 xl:grid-cols-8`}
        >
          <Kpi label="Items">{rfq.items?.length ?? 0}</Kpi>
          <Kpi label="Suppliers invited">{supplierCount}</Kpi>
          <Kpi label="Quoted">{quotedCount}</Kpi>
          <Kpi label="Responded">{respondedCount}</Kpi>
          <Kpi label="Declined">{declinedCount}</Kpi>
          <Kpi label="Response rate">{responseRate}%</Kpi>
          <Kpi label="Total qty">
            {Number.isFinite(totalQty) ? totalQty : "—"}
          </Kpi>
          <Kpi label="Est. budget">
            {estimatedBudget > 0 ? formatCurrency(estimatedBudget) : "—"}
          </Kpi>
        </section>

        {/* ── Procurement Status ── */}
        <WorkflowBar steps={timeline} />

        {quoteRoundsSlot}

        {/* ── Items ── */}
        <section className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rfq-border)] px-4 py-3 md:px-5">
            <div>
              <h2 className={sectionTitle}>Items</h2>
              <p className="mt-0.5 text-[12px] text-[var(--rfq-text-soft)]">
                Procurement Final Qty is sent to suppliers. Department Requested
                and Warehouse Available are internal history only.
              </p>
            </div>
            <span className={`${mono} text-[13px] text-[var(--rfq-text-soft)]`}>
              {rfq.items?.length ?? 0} lines
            </span>
          </div>
          {!rfq.items?.length ? (
            <div className="p-6">
              <EmptyState title="No items" description="This RFQ has no line items." />
            </div>
          ) : (
            <ItemsWithTargetPrice rfq={rfq} />
          )}
        </section>

        {/* ── Supplier quotations ── */}
        <section className={`${card} p-4 md:p-5`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={sectionTitle}>Supplier quotations</h2>
            <div className="flex items-center gap-3">
              <span className={`${mono} text-[13px] text-[var(--rfq-text-soft)]`}>
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
            <p className="mb-3 text-[13px] text-[var(--rfq-text-soft)]">
              Quote amounts stay hidden until AI analysis is complete.
            </p>
          )}

          {quotesQueryError ? (
            <div className="rounded-[var(--rfq-radius-card)] border border-[var(--rfq-danger)]/30 bg-[var(--rfq-danger-soft)] px-3 py-2 text-[13px] text-[var(--rfq-danger)]">
              {quotesQueryErrorMessage ||
                "Could not load supplier quotations."}{" "}
              <button
                type="button"
                onClick={onRetryQuotes}
                className="font-semibold underline"
              >
                Retry
              </button>
            </div>
          ) : null}

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
                pendingInvitationSupplierIds.has(normKey(s.supplier)) ||
                  pendingInvitationSupplierIds.has(normKey(s.supplier_name)),
              );
              const isWinner =
                hasSelectedSupplier &&
                (normKey(s.supplier) === normKey(resolvedSelectedSupplier) ||
                  normKey(s.supplier_name) ===
                    normKey(resolvedSelectedSupplier));
              const scoreEntry =
                (quote?.supplier === s.supplier ? displayScores.get(`quotation:${quote.sqName}`) : undefined) ??
                displayScores.get(`supplier:${s.supplier}`);
              const hasSubmittedQuote = Boolean(quote);
              const score = hasSubmittedQuote ? scoreEntry?.score ?? null : null;
              const rank = hasSubmittedQuote ? scoreEntry?.rank ?? null : null;
              const deliveryDays = quote
                ? [...quote.byItem.values()].find((v) => v.delivery_days)
                    ?.delivery_days
                : undefined;
              const showAmounts = canCompareQuotations && !!quote;

              return (
                <article
                  key={s.name}
                  data-supplier={s.supplier}
                  className={`flex h-full flex-col overflow-hidden rounded-[var(--rfq-radius-card)] border ${
                    isWinner
                      ? "border-[var(--rfq-teal)] shadow-[var(--rfq-shadow)]"
                      : "border-[var(--rfq-border)] bg-[var(--rfq-surface)] shadow-[var(--rfq-shadow)]"
                  }`}
                >
                  <div
                    className={`flex items-start justify-between gap-2 px-3 py-3 ${
                      isWinner ? "bg-[var(--rfq-teal-soft)]" : "bg-[var(--rfq-surface)]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-[var(--rfq-text)]">
                        {s.supplier_name || s.supplier}
                      </div>
                      <div
                        className={`truncate text-[12px] text-[var(--rfq-text-soft)] ${mono}`}
                      >
                        {s.supplier}
                      </div>
                    </div>
                    {isWinner ? (
                      <Badge tone="teal">Selected</Badge>
                    ) : quote ? (
                      <Badge tone="green">Submitted ✓</Badge>
                    ) : decline ? (
                      <Badge tone="amber">No quote</Badge>
                    ) : status === "Pending Invitation" ? (
                      <Badge tone="blue">Pending Invitation</Badge>
                    ) : (
                      <StatusBadge
                        status={status}
                        tone={supplierStatusTone(status)}
                      />
                    )}
                  </div>

                  <div className="flex flex-1 items-start gap-3 px-3 py-3">
                    <ScoreRing score={score} rank={rank} />
                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2">
                      <Field label="Quote" monoValue>
                        {showAmounts
                          ? formatQuoteTotal(
                              quote!.total,
                              quote!.priceStatus,
                            )
                          : "—"}
                      </Field>
                      <Field label="Delivery" monoValue>
                        {showAmounts && deliveryDays
                          ? `${deliveryDays} days`
                          : "—"}
                      </Field>
                      <Field label="AI score" monoValue>
                        {score != null ? score : "—"}
                      </Field>
                      <Field label="Rank" monoValue>
                        {rank != null ? `#${rank}` : "—"}
                      </Field>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--rfq-border)] px-3 py-3">
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

        {/* ── Selected supplier ── */}
        {hasSelectedSupplier && (
          <section className={`${card} p-4 md:p-5`}>
            <h2 className={`${sectionTitle} mb-3`}>Selected supplier</h2>
            <div
              className={`grid grid-cols-2 ${gap} sm:grid-cols-3 lg:grid-cols-6`}
            >
              <Field label="Supplier">{resolvedSelectedSupplier}</Field>
              <Field label="Award amount" monoValue>
                {selectedSupplierTotal > 0
                  ? formatCurrency(selectedSupplierTotal)
                  : "—"}
              </Field>
              <Field label="Savings" monoValue>
                {focusSavings > 0
                  ? formatCurrency(focusSavings)
                  : "—"}
              </Field>
              <Field label="Legal">
                <ApprovalPill
                  approved={workflow.legalApproved}
                  rejected={workflow.legalRejected}
                  label={workflow.legalStatus}
                  by={legalDoc?.approved_by}
                  on={legalDoc?.approved_on}
                />
              </Field>
              <Field label="Finance">
                <ApprovalPill
                  approved={workflow.financeApproved}
                  rejected={workflow.financeRejected}
                  label={workflow.financeStatus}
                  by={legalDoc?.finance_approved_by}
                  on={legalDoc?.finance_approved_on}
                />
              </Field>
              <Field label="Purchase order" monoValue>
                {poExists ? poName || "Created" : "Not created"}
              </Field>
            </div>
          </section>
        )}

        {reverseBiddingSlot}
      </div>

      {checkBudgetModal}
      {modals}
    </div>
  );
}
