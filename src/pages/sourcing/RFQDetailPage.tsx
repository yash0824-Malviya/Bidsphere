import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Activity,
  Ban,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import {
  getRFQ,
  getSupplierQuotations,
  lookupDefaultWarehouse,
} from "../../api/sourcing";
import { submitRfqWithContractConfirmation } from "../../api/rfqSubmitClm";
import {
  getItemTargetPrice,
  isItemTargetPriceVisibleToSupplier,
  isTargetPriceVisibleToSupplier,
} from "../../utils/rfqTargetPrice";
import {
  getRfqResponses,
  type SupplierRfqResponse,
} from "../../api/supplierRfqResponse";
import { COMPANY } from "../../api/erpnext";
import {
  assertNoPOForRFQ,
  createPurchaseOrder,
  getPOsForRFQ,
} from "../../api/purchasing";
import type { LinkedPORow } from "../../api/purchasing";
import {
  buildPricingAvailabilitySummary,
  getAIProviderAvailability,
  computeConfidenceScore,
  resolveAIRecommendation,
} from "../../api/ai";
import type { AIQuotation, AIQuotationLine, AnalysisWeights } from "../../api/ai";
import type {
  AIRecommendation,
  QuotePriceStatus,
  RFQApprovalState,
  SupplierAnalysisRow,
} from "../../types/erpnext";
import { getScoringConfig } from "../../api/supplierScoring";
import { getSupplierPerformance } from "../../api/supplierPerformance";
import { scoringResultFromRecommendation } from "../../utils/aiEvaluationResult";
import { getEvaluationRisk } from "../../utils/aiEvaluationDecision";
import { getSupplierAwardEligibility } from "../../utils/supplierAwardEligibility";
import {
  getLatestAnalysisSnapshot,
  saveScoringResult,
} from "../../api/supplierScoringResults";
import {
  normalizeAndDeduplicateRecommendation,
  findRecommendationWinner,
  normalizeSupplierKey,
  type AuthoritativeQuoteInfo,
} from "../../utils/aiRecommendationNormalization";
import {
  getApprovalState,
  submitForReview,
  markPOCreated,
} from "../../api/rfqApprovalWorkflow";
import {
  ensureLegalDocumentReviewForSelection,
  getLegalDocsByRfq,
} from "../../api/legalDocs";
import type { LegalDocumentItemSummary, LegalDocumentSet } from "../../api/legalDocs";
import { getApprovalStateFromErp } from "../../api/legalReviews";
import {
  extendRfqDeadline,
  inviteSuppliersToRfq,
} from "../../api/rfqSupplierInvite";
import { getPendingInvitationSupplierIds } from "../../api/rfqSupplierInviteAudit";
import RfqInviteSuppliersDialog, {
  type InviteSupplierSelection,
} from "../../components/sourcing/RfqInviteSuppliersDialog";
import ExtendRfqDeadlineDialog from "../../components/sourcing/ExtendRfqDeadlineDialog";
import {
  detectRfqAiStale,
  getRfqAiStale,
  markRfqAiStale,
  readRfqAiBaseline,
  saveRfqAiBaseline,
  type RfqAiStaleSource,
} from "../../utils/rfqAiBaseline";
import { parseRfqMessage } from "../../utils/rfqMessage";
import { deriveRfqProcurementWorkflow, type RfqWorkflowStep } from "../../api/rfqProcurementWorkflow";
import { invalidateApprovalWorkflow, isRfqReadyForPurchaseOrder } from "../../api/approvalWorkflow";
import { isLegalReviewExecuted } from "../../types/legalEsign";
import { ANALYSIS_STEPS } from "../../components/aiAnalysisSteps";
import AIAnalysisModal, {
  type SupplierSelectionPayload,
} from "../../components/AIAnalysisModal";
import AIInsightsErrorBoundary from "../../components/AIInsightsErrorBoundary";
import SupplierSelectionSummary from "../../components/SupplierSelectionSummary";
import { AppLoading, EnterpriseError } from "../../components/enterprise";
import { useAuthStore } from "../../store/authStore";
import {
  canManagePurchaseOrders,
  canManageRFQs,
  canManageReverseBidding,
  formatRfqOwnerFromDoc,
} from "../../config/roles";
import {
  createReverseBiddingFromRFQ,
  getReverseBiddingForRFQ,
} from "../../api/reverseBidding";
import type { RFQ, RFQSupplier, SupplierQuotation } from "../../types/erpnext";
import type { ReverseBiddingQuotationSelection } from "../../types/reverseBidding";
import { reverseBiddingSelectionForRow, selectedReverseBiddingQuotations, validateReverseBiddingSelection } from "../../utils/reverseBiddingSelection";
import { resolveRfqQuotationIdentity, type RfqQuotationIdentity } from "../../utils/rfqQuotationIdentity";
import { formatDate, isoDateOffset } from "../../utils/format";
import { generateId } from "../../utils/id";
import RejectedReviewActions from "../../components/sourcing/RejectedReviewActions";
import CheckBudgetModal from "../../components/sourcing/CheckBudgetModal";
import ViewQuotationModal from "../../components/sourcing/ViewQuotationModal";
import CompareQuotationsModal, {
  type ComparisonQuote,
} from "../../components/sourcing/CompareQuotationsModal";
import RFQDetailEnterpriseLayout from "./rfq-detail/RFQDetailEnterpriseLayout";

import { clmViewerKey, getRfqClmSummary, recordRfqAwardDecision } from "../../api/clm";
import {
  canCreateRfqQuoteRound,
  createNextRfqQuoteRound,
  ensureInitialRfqQuoteRound,
  listRfqQuoteRounds,
  RfqQuoteRoundApiError,
  type RfqQuoteRound,
  type RfqRoundReasonCode,
} from "../../api/rfqQuoteRound";
import CreateRfqRoundDialog from "../../components/sourcing/CreateRfqRoundDialog";
import RfqQuoteRoundsPanel from "../../components/sourcing/RfqQuoteRoundsPanel";
import RfqRoundActivityTimeline from "../../components/sourcing/RfqRoundActivityTimeline";
import {
  readRfqRoundActivity,
  readRfqRoundMetaMap,
  recordQuoteRoundCreated,
  recordQuoteRoundSupplierInvites,
} from "../../api/rfqRoundActivity";
import { formatRfqRoundLabel } from "../../utils/rfqRoundTracking";
import {
  formatERPNextDate,
  formatUsDisplayDate,
  logRfqToPoDateContext,
  parseERPNextDateInput,
  resolvePoHeaderScheduleDate,
  resolvePoItemScheduleDate,
  resolvePoTransactionDate,
} from "../../utils/erpNextDate";
import {
  downloadRfqPdf,
  printRfqPdf,
  type RfqPdfData,
} from "../../utils/pdf";
import {
  logRfqDetailApiFailure,
  resolveApiErrorMessage,
  useRfqBackgroundQueryError,
} from "../../utils/rfqDetailApiErrors";
import dayjs from "dayjs";
import {
  isSubmittedQuoteAmount,
  parseQuoteAmount,
  priceFromLines,
  resolveQuotePrice,
  resolveSupplierQuotationPrice,
} from "../../utils/quotePrice";

// The key lives on the server. Its intentional absence in browser code is not an outage.
const HAS_ANTHROPIC_KEY = getAIProviderAvailability().claude;

type RiskLevel = ReturnType<typeof getEvaluationRisk>;

function supplierRiskLevel(s: SupplierAnalysisRow): RiskLevel {
  return getEvaluationRisk(s);
}

/** Savings of the recommended supplier vs the highest bid among all quotes. */
function getSavingsPotential(analysis: AIRecommendation): {
  amount: number;
  pct: number;
} {
  const rows = analysis.supplier_analysis ?? [];
  const recommended = findRecommendationWinner(analysis, rows);
  const totals = rows
    .map((s) => s.grand_total)
    .filter(isSubmittedQuoteAmount);
  const highest = totals.length ? Math.max(...totals) : 0;
  const recommendedTotal = recommended?.grand_total;
  const amount =
    recommendedTotal != null && highest > recommendedTotal
      ? highest - recommendedTotal
      : 0;
  const pct =
    highest > 0
      ? Math.round((amount / highest) * 100)
      : (analysis.cost_analysis?.savings_percentage ?? 0);
  return { amount, pct };
}

/** Persisted AI analysis result for an RFQ — restored on revisit. */
interface SavedAnalysisRecord {
  rfq_name: string;
  analysed_at: string;
  evaluation_run_id?: string;
  recommended_supplier: string;
  confidence_score: number;
  analysis: AIRecommendation;
  quotations_snapshot: { supplier: string; supplier_id?: string; quotation_id?: string; grand_total: number }[];
}

const analysisStorageKey = (rfqName: string) => `rfq_analysis_${rfqName}`;
const ANALYSES_LIST_KEY = "rfq_analyses_list";

/**
 * A saved analysis is only usable if it has a real recommended supplier and a
 * non-empty ranking. This rejects broken records persisted by earlier failed
 * runs (e.g. "Manual review required" placeholders with no supplier_analysis),
 * which would otherwise render an empty/zeroed analysis on reload.
 */
function isUsableAnalysis(record: SavedAnalysisRecord | null): boolean {
  if (!record || !record.analysis) return false;
  const supplier = (record.recommended_supplier || "").trim().toLowerCase();
  if (!supplier || supplier === "manual review required") return false;
  return (record.analysis.supplier_analysis ?? []).length > 0;
}

function readSavedAnalysis(rfqName: string): SavedAnalysisRecord | null {
  try {
    const raw = localStorage.getItem(analysisStorageKey(rfqName));
    const record = raw ? (JSON.parse(raw) as SavedAnalysisRecord) : null;
    if (record && !isUsableAnalysis(record)) {
      localStorage.removeItem(analysisStorageKey(rfqName));
      return null;
    }
    if (record && record.analysis?.supplier_analysis) {
      const snapQuotes = (record.quotations_snapshot ?? []).map((s) => ({
        quotation_id: s.quotation_id,
        supplier_id: s.supplier_id,
        supplier_name: s.supplier,
        total: s.grand_total,
      }));
      record.analysis = normalizeAndDeduplicateRecommendation({
        recommendation: record.analysis,
        authoritativeQuotes: snapQuotes,
        rfqId: rfqName,
      });
      record.recommended_supplier = record.analysis.recommended_supplier;
      record.confidence_score = record.analysis.confidence_score;
    }
    return record;
  } catch {
    return null;
  }
}

interface SubmittedQuote {
  /** Supplier Quotation docname — needed to open the "View Quotation" modal. */
  sqName: string;
  supplier: string;
  supplier_name: string;
  total: number | null;
  priceStatus: QuotePriceStatus;
  notes: string;
  payment_terms?: string;
  warrantyCertificate?: boolean;
  termsCondition?: boolean;
  insuranceCertificate?: boolean;
  /**
   * Unit price, total and delivery_days per item_code. Stored locally so
   * the comparison table reflects in-flight submissions even before the
   * `getSupplierQuotations` query refetches.
   */
  byItem: Map<
    string,
    { unit_price: number | null; total: number | null; delivery_days: number }
  >;
}

function getAuthoritativeQuoteInfos(
  quotes: Map<string, SubmittedQuote>
): AuthoritativeQuoteInfo[] {
  const list: AuthoritativeQuoteInfo[] = [];
  const seen = new Set<string>();
  for (const q of quotes.values()) {
    const key = q.sqName || q.supplier || normalizeSupplierKey(q.supplier_name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push({
      quotation_id: q.sqName,
      supplier_id: q.supplier,
      supplier_name: q.supplier_name,
      total: q.total,
      priceStatus: q.priceStatus,
      docstatus: 1,
      byItem: q.byItem,
    });
  }
  return list;
}

/**
 * Validates a cached/saved analysis against the current RFQ state.
 * If the saved analysis contains suppliers that are no longer invited,
 * or duplicates, it is cleaned or discarded.
 */
function validateCachedAnalysis(
  record: SavedAnalysisRecord | null,
  invitedSupplierIds: Set<string>,
  localQuotes?: Map<string, SubmittedQuote>
): SavedAnalysisRecord | null {
  if (!record) return null;
  if (!isUsableAnalysis(record)) {
    try {
      localStorage.removeItem(analysisStorageKey(record.rfq_name));
    } catch {
      /* ignore */
    }
    return null;
  }

  const authQuotes =
    localQuotes && localQuotes.size > 0
      ? getAuthoritativeQuoteInfos(localQuotes)
      : (record.quotations_snapshot ?? []).map((s) => ({
          quotation_id: s.quotation_id,
          supplier_id: s.supplier_id,
          supplier_name: s.supplier,
          total: s.grand_total,
        }));

  const norm = normalizeAndDeduplicateRecommendation({
    recommendation: record.analysis,
    authoritativeQuotes: authQuotes,
    rfqId: record.rfq_name,
  });

  if (invitedSupplierIds.size > 0) {
    const normInvited = new Set(
      Array.from(invitedSupplierIds).map(normalizeSupplierKey)
    );
    norm.supplier_analysis = norm.supplier_analysis.filter(
      (r) =>
        invitedSupplierIds.has(r.name.trim().toLowerCase()) ||
        normInvited.has(normalizeSupplierKey(r.name))
    );
    norm.supplier_analysis = norm.supplier_analysis.map((r, i) => ({
      ...r,
      rank: i + 1,
    }));
    if (!norm.supplier_analysis.some((row) => row.name === norm.recommended_supplier)) return null;
  }

  if (norm.supplier_analysis.length === 0) {
    try {
      localStorage.removeItem(analysisStorageKey(record.rfq_name));
    } catch {
      /* ignore */
    }
    return null;
  }

  record.analysis = norm;
  record.recommended_supplier = norm.recommended_supplier;
  record.confidence_score = norm.confidence_score;
  return record;
}

/**
 * The Smart RFQ wizard embeds title/valid-till in `message_for_supplier`.
 * Parsed via `parseRfqMessage` from `utils/rfqMessage`.
 */

function quoteForSupplier(
  localQuotes: Map<string, SubmittedQuote>,
  supplierId: string
): SubmittedQuote | undefined {
  if (!supplierId) return undefined;
  const rawKey = supplierId.trim().toLowerCase();
  const normKey = normalizeSupplierKey(supplierId);

  // Exact or normalized key match
  for (const q of localQuotes.values()) {
    const qSuppRaw = (q.supplier || "").trim().toLowerCase();
    const qNameRaw = (q.supplier_name || "").trim().toLowerCase();
    const qSuppNorm = normalizeSupplierKey(q.supplier || "");
    const qNameNorm = normalizeSupplierKey(q.supplier_name || "");

    if (
      qSuppRaw === rawKey ||
      qNameRaw === rawKey ||
      qSuppNorm === normKey ||
      qNameNorm === normKey
    ) {
      return q;
    }
  }

  // Substring or prefix match
  for (const q of localQuotes.values()) {
    const qSuppNorm = normalizeSupplierKey(q.supplier || "");
    const qNameNorm = normalizeSupplierKey(q.supplier_name || "");
    if (
      (qSuppNorm && normKey.includes(qSuppNorm)) ||
      (normKey && qSuppNorm.includes(normKey)) ||
      (qNameNorm && normKey.includes(qNameNorm)) ||
      (normKey && qNameNorm.includes(normKey))
    ) {
      return q;
    }
  }

  return localQuotes.get(supplierId);
}

function reconcileAnalysisQuotePrices(
  analysis: AIRecommendation,
  localQuotes: Map<string, SubmittedQuote>,
  rfqId: string = ""
): boolean {
  const authQuotes = getAuthoritativeQuoteInfos(localQuotes);
  if (authQuotes.length === 0) return false;

  const beforeCount = analysis.supplier_analysis?.length ?? 0;
  const beforeJson = JSON.stringify(analysis.supplier_analysis);

  const norm = normalizeAndDeduplicateRecommendation({
    recommendation: analysis,
    authoritativeQuotes: authQuotes,
    rfqId,
  });

  Object.assign(analysis, norm);

  const changed =
    beforeCount !== norm.supplier_analysis.length ||
    beforeJson !== JSON.stringify(norm.supplier_analysis);

  const availability = buildPricingAvailabilitySummary(
    norm.supplier_analysis.map((row) => ({
      total_value: row.grand_total,
    })),
  );
  if (availability) {
    const genuineZeroCount = norm.supplier_analysis.filter(
      (row) => row.grand_total === 0 && row.quote_price_status === "submitted",
    ).length;
    const availabilitySummary =
      genuineZeroCount > 0
        ? `${availability} ${genuineZeroCount} supplier${genuineZeroCount === 1 ? "" : "s"} submitted a genuine zero-value quote.`
        : availability;
    const normalize = (value: string) => {
      const sanitized = value
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !/\$0(?:\.00)?/i.test(sentence))
        .join(" ")
        .trim();
      return sanitized.toLowerCase().includes(availabilitySummary.toLowerCase())
        ? sanitized.trim()
        : `${sanitized} ${availabilitySummary}`.trim();
    };
    const summary = normalize(analysis.recommendation_summary ?? "");
    const verdict = normalize(analysis.final_verdict ?? "");
    analysis.recommendation_summary = summary;
    analysis.final_verdict = verdict;
    analysis.reason = summary;
  }
  return changed;
}

type SupplierQuoteStatus =
  | "Pending"
  | "Pending Invitation"
  | "Quotation Received"
  | "Declined"
  | "Expired";

function resolveSupplierStatus(
  row: RFQSupplier,
  hasQuote: boolean,
  validTill?: string,
  declined?: boolean,
  pendingInvitation?: boolean,
): SupplierQuoteStatus {
  if (hasQuote || row.quote_status === "Received") return "Quotation Received";
  if (declined || row.quote_status === "No Quote") return "Declined";
  if (validTill) {
    const deadline = parseERPNextDateInput(validTill);
    if (deadline?.isValid()) {
      const end = deadline.endOf("day");
      if (end.isBefore(dayjs())) return "Expired";
    }
  }
  if (pendingInvitation) return "Pending Invitation";
  return "Pending";
}

function supplierStatusTone(
  status: string
): "warning" | "success" | "danger" | "neutral" | "info" {
  switch (status) {
    case "Quotation Received":
      return "success";
    case "Declined":
      return "danger";
    case "Expired":
      return "neutral";
    case "Pending Invitation":
      return "info";
    default:
      return "warning";
  }
}

export default function RFQDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const rfqName = decodeURIComponent(id);
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role;
  const isReadOnly = !canManageRFQs(userRole);

  const [approvalState, setApprovalState] = useState<RFQApprovalState | null>(
    () => getApprovalState(rfqName)
  );
  const [submittingForReview, setSubmittingForReview] = useState(false);
  const [pendingAwardDecision, setPendingAwardDecision] = useState<{ award: string; supplier: string; quotation: string } | null>(null);
  const [clmErrorMessage, setClmErrorMessage] = useState<string | null>(null);
  const [retryingClm, setRetryingClm] = useState(false);
  const [submittingRFQ, setSubmittingRFQ] = useState(false);
  const [localQuotes, setLocalQuotes] = useState<Map<string, SubmittedQuote>>(
    new Map()
  );
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [reasonPopup, setReasonPopup] = useState<SupplierRfqResponse | null>(
    null
  );
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [checkBudgetOpen, setCheckBudgetOpen] = useState(false);
  const [viewQuotationSq, setViewQuotationSq] = useState<string | null>(null);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [extendDeadlineOpen, setExtendDeadlineOpen] = useState(false);
  const [pendingInviteSuppliers, setPendingInviteSuppliers] = useState<
    InviteSupplierSelection[]
  >([]);
  const [invitingSuppliers, setInvitingSuppliers] = useState(false);
  const [aiStaleTick, setAiStaleTick] = useState(0);
  const [aiResult, setAiResult] = useState<AIRecommendation | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingStep, setAiLoadingStep] = useState(0);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiStepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [creatingPO, setCreatingPO] = useState(false);
  const [creatingRound, setCreatingRound] = useState(false);
  const [roundActivityTick, setRoundActivityTick] = useState(0);
  const [createRoundOpen, setCreateRoundOpen] = useState(false);
  const [startingReverseBidding, setStartingReverseBidding] = useState(false);
  const [savedAnalysis, setSavedAnalysis] = useState<SavedAnalysisRecord | null>(
    () => readSavedAnalysis(rfqName)
  );

  useEffect(() => {
    const cached = getApprovalState(rfqName);
    setApprovalState(cached);
    // Cross-device fallback: if this browser has never cached this RFQ's
    // workflow state (e.g. a different device/browser than the one that
    // submitted for review), fetch it from ERPNext directly — the
    // localStorage cache must never be the only place this data exists.
    if (!cached && rfqName) {
      getApprovalStateFromErp(rfqName)
        .then((erpState) => {
          if (erpState) setApprovalState(erpState);
        })
        .catch(() => {
          /* best-effort — page still functions via ERPNext queries below */
        });
    }
  }, [rfqName]);

  // The Legal Document Review record is the REAL source of truth for
  // review decisions (see api/legalReviewCore.ts) — the legacy
  // `approvalState` custom-field workflow above is never written to by the
  // actual Legal/Finance review pages, so it can never reflect a real
  // rejection. The "Rejected" banners below must read from here instead.
  const legalDocQuery = useQuery<LegalDocumentSet | null>({
    queryKey: ["legal-doc-review", rfqName],
    queryFn: () => getLegalDocsByRfq(rfqName),
    enabled: !!rfqName,
    // Always fetch fresh data on page visit so Legal/Finance status badges
    // never show stale approval state when reopening the RFQ.
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const legalDoc = legalDocQuery.data;

  const rfqQuery = useQuery<RFQ>({
    queryKey: ["rfq", rfqName],
    enabled: !!rfqName,
    queryFn: () => getRFQ(rfqName),
  });
  const rfqClmQuery = useQuery({
    queryKey: ["clm", "rfq-contract", rfqName, clmViewerKey()],
    queryFn: () => getRfqClmSummary(rfqName),
    enabled: !!rfqName,
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
  });
  const contractContinuationReady = !rfqClmQuery.isError && rfqClmQuery.data?.continuation_ready === true && rfqClmQuery.data.blocks_procurement === false;

  const roundsQuery = useQuery<RfqQuoteRound[]>({
    queryKey: ["rfq-quote-rounds", rfqName],
    enabled: !!rfqName,
    queryFn: async () => {
      const listUrl = `/api/rfq-quote-round?rfq=${encodeURIComponent(rfqName)}`;
      try {
        const rounds = await listRfqQuoteRounds(rfqName);
        if (rounds.length > 0) return rounds;

        try {
          const { round } = await ensureInitialRfqQuoteRound(
            rfqName,
            user?.email || user?.name,
          );
          return [round];
        } catch (ensureErr) {
          logRfqDetailApiFailure("quote-rounds", ensureErr, {
            url: "/api/rfq-quote-round?action=ensure-initial",
            method: "POST",
            payload: { rfq_name: rfqName },
          });
          return [];
        }
      } catch (listErr) {
        logRfqDetailApiFailure("quote-rounds", listErr, {
          url: listUrl,
          method: "GET",
        });
        throw listErr;
      }
    },
    retry: false,
  });

  const quoteRoundsErrorMessage = useRfqBackgroundQueryError(
    "quote-rounds",
    roundsQuery.isError,
    roundsQuery.error,
    {
      url: `/api/rfq-quote-round?rfq=${encodeURIComponent(rfqName)}`,
      method: "GET",
    },
  );

  // Explicit supplier "No Quote" declines (first-class responses).
  const declinesQuery = useQuery<SupplierRfqResponse[]>({
    queryKey: ["rfq-declines", rfqName],
    enabled: !!rfqName,
    queryFn: () => getRfqResponses(rfqName),
  });

  const declineBySupplier = useMemo(() => {
    const map = new Map<string, SupplierRfqResponse>();
    for (const d of declinesQuery.data ?? []) {
      map.set((d.supplier ?? "").toLowerCase(), d);
    }
    return map;
  }, [declinesQuery.data]);

  const declinedCount = declineBySupplier.size;

  const rfq = rfqQuery.data;
  const inviteProcurementCategory = rfq?.custom_procurement_category?.trim() ?? "";
  const inviteItemGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const item of rfq?.items ?? []) {
      const g = (item as { item_group?: string }).item_group;
      if (g?.trim()) groups.add(g.trim());
    }
    return [...groups];
  }, [rfq?.items]);
  const inviteCommodity = inviteItemGroups[0] ?? "";
  const parsedMessage = useMemo(
    () => parseRfqMessage(rfq?.message_for_supplier),
    [rfq?.message_for_supplier]
  );

  const activeQuoteRound = useMemo(() => {
    const rounds = roundsQuery.data ?? [];
    return (
      rounds.find((r) => r.status === "Active") ??
      rounds.find((r) => r.status === "Draft") ??
      rounds[rounds.length - 1] ??
      null
    );
  }, [roundsQuery.data]);

  const activeRoundName =
    activeQuoteRound?.name ?? rfq?.custom_active_rfq_round ?? null;

  const quotesQuery = useQuery<SupplierQuotation[]>({
    queryKey: ["rfq-quotes", rfqName, activeRoundName],
    enabled: !!rfqName,
    queryFn: () =>
      getSupplierQuotations(rfqName, {
        activeRoundName,
      }),
    retry: false,
  });

  const supplierQuotesErrorMessage = useRfqBackgroundQueryError(
    "supplier-quotes",
    quotesQuery.isError,
    quotesQuery.error,
    {
      url: `Supplier Quotation (RFQ ${rfqName})`,
      method: "GET",
    },
  );

  /* ─────────────── PO completion state ─────────────── */

  /**
   * Live ERPNext query — finds Purchase Orders actually created from this RFQ.
   * This is the SINGLE source of truth for PO completion; there is no
   * localStorage/cached/synthesised fallback. `staleTime: 0` ensures a fresh
   * lookup on every page visit so a PO deleted in ERPNext no longer shows here.
   */
  const linkedPOsQuery = useQuery<LinkedPORow[]>({
    queryKey: ["rfq-linked-pos", rfqName],
    enabled: !!rfqName,
    queryFn: () => getPOsForRFQ(rfqName),
    staleTime: 0,
    retry: false,
  });

  useRfqBackgroundQueryError(
    "linked-pos",
    linkedPOsQuery.isError,
    linkedPOsQuery.error,
    {
      url: `Purchase Order (RFQ ${rfqName})`,
      method: "GET",
    },
  );
  const linkedPOs = linkedPOsQuery.data ?? [];
  const linkedPO = linkedPOs[0] ?? null;

  // One-time cleanup: purge legacy localStorage PO-reference keys that older
  // builds used as a same-session completion cache. They are no longer read,
  // but removing them eliminates any stale "PO Created" residue.
  useEffect(() => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("rfq_po_ref_"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore storage access errors */
    }
  }, []);

  /**
   * A RFQ is only "PO Created" when ERPNext returns a real Purchase Order with
   * a document name. No localStorage, no RFQ-status inference, no placeholders.
   */
  const isRealPurchaseOrder = !!linkedPO && !!linkedPO.name;
  const poExists = isRealPurchaseOrder;
  const isCompleted = isRealPurchaseOrder && contractContinuationReady;

  // Procurement is FINALIZED once any backend signal says the decision is done:
  // a real Purchase Order exists, the RFQ status is "Completed", or the approval
  // workflow reached "PO Created". When finalized, every procurement-decision
  // action (analysis, supplier selection, quote comparison, PO creation) is
  // hidden and the page becomes a read-only historical record. Driven entirely
  // by backend state — never hardcoded UI values.
  const procurementFinalized =
    poExists ||
    (contractContinuationReady && ((rfq?.status ?? "").trim().toLowerCase() === "completed" ||
    approvalState?.workflow_step === "PO Created"));

  const completionPO = linkedPO ?? null;
  const completionSummary = {
    supplier: completionPO?.supplier_name ?? completionPO?.supplier ?? "—",
    total: completionPO?.grand_total ?? 0,
    poName: completionPO?.name ?? "—",
    poDate: completionPO?.transaction_date ?? "",
  };

  // Runtime diagnostics — completion is driven solely by the ERPNext lookup.
  useEffect(() => {
    if (!rfq) return;
    // eslint-disable-next-line no-console
    console.log("RFQ ERP data", rfq);
    // eslint-disable-next-line no-console
    console.log("PO lookup result", linkedPOs);
    // eslint-disable-next-line no-console
    console.log("PO validation", isRealPurchaseOrder);
  }, [rfq, linkedPOs, isRealPurchaseOrder]);

  const isDraftDocument =
    rfq?.docstatus === 0 || rfq?.docstatus === undefined;
  const documentStateLabel = rfq?.docstatus === 1 ? "Submitted" : "Draft";
  const showSubmitRFQ =
    !isReadOnly &&
    !procurementFinalized &&
    isDraftDocument &&
    rfq?.status !== "Submitted" &&
    rfq?.status !== "Cancelled";

  useEffect(() => {
    if (!rfq) return;
    // eslint-disable-next-line no-console
    console.log("[RFQDetail] Submit RFQ visibility", {
      rfqStatus: rfq.status,
      workflowState: approvalState?.workflow_step ?? null,
      documentState: documentStateLabel,
      docstatus: rfq.docstatus,
      poCreatedFlag: poExists,
      linkedPOName: linkedPO?.name ?? null,
      isReadOnly,
      showSubmitRFQ,
    });
  }, [
    rfq,
    approvalState?.workflow_step,
    documentStateLabel,
    poExists,
    linkedPO?.name,
    isReadOnly,
    showSubmitRFQ,
  ]);

  // Log RFQ data whenever it loads so we can confirm rfqName matches what
  // the supplier portal used as rfq_no when submitting quotations.
  useEffect(() => {
    if (!rfq) return;
    // eslint-disable-next-line no-console
    console.log("[RFQDetail] RFQ loaded:", {
      name: rfq.name,
      status: rfq.status,
      suppliers: (rfq.suppliers ?? []).map(
        (s: { supplier?: string; supplier_name?: string }) => s.supplier ?? s.supplier_name
      ),
      items: (rfq.items ?? []).map(
        (it: { item_code?: string; qty?: number }) => `${it.item_code} × ${it.qty}`
      ),
    });
  }, [rfq]);

  // Log the raw SQ query result every time it updates.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // eslint-disable-next-line no-console
    console.log(
      "[RFQDetail] Supplier Quotation query result for", rfqName,
      "→", quotesQuery.data?.length ?? 0, "record(s):",
      quotesQuery.data
    );
  }, [quotesQuery.data, rfqName]);

  // Hydrate `localQuotes` whenever the server-side query refreshes or from sessionStorage
  useEffect(() => {
    setLocalQuotes(() => {
      const next = new Map<string, SubmittedQuote>();

      // Group quotes by normalized supplier key to avoid duplicate entries when
      // multiple quotation revisions exist (e.g. Draft docstatus=0 vs Submitted docstatus=1)
      type SQItem = NonNullable<typeof quotesQuery.data>[number];
      const grouped = new Map<string, SQItem[]>();
      for (const sq of quotesQuery.data ?? []) {
        const suppKey = normalizeSupplierKey(sq.supplier_name || sq.supplier || "");
        if (!suppKey) continue;
        const list = grouped.get(suppKey) ?? [];
        list.push(sq);
        grouped.set(suppKey, list);
      }

      for (const [, sqList] of grouped) {
        if (!sqList || sqList.length === 0) continue;
        // Prefer submitted (docstatus=1) over draft (docstatus=0), then valid price over 0, then newest name
        sqList.sort((a, b) => {
          const aDoc = a.docstatus ?? 0;
          const bDoc = b.docstatus ?? 0;
          if (aDoc !== bDoc) return bDoc - aDoc;
          const aPrice = resolveSupplierQuotationPrice(a).amount ?? 0;
          const bPrice = resolveSupplierQuotationPrice(b).amount ?? 0;
          if ((aPrice > 0) !== (bPrice > 0)) return bPrice > 0 ? 1 : -1;
          return (b.name || "").localeCompare(a.name || "");
        });

        const sq = sqList[0];
        const supplierName = sq.supplier_name ?? sq.supplier ?? "";
        const price = resolveSupplierQuotationPrice(sq);
        const byItem = new Map<
          string,
          { unit_price: number | null; total: number | null; delivery_days: number }
        >();
        for (const it of sq.items ?? []) {
          const itObj = it as unknown as Record<string, unknown>;
          const unitPrice = parseQuoteAmount(
            it.rate ??
            itObj.unit_price ??
            itObj.price ??
            itObj.quoted_rate ??
            itObj.price_list_rate
          );
          const qty = parseQuoteAmount(
            it.qty ??
            itObj.quantity ??
            itObj.requested_qty
          ) ?? 1;
          const explicitTotal = parseQuoteAmount(
            it.amount ??
            itObj.total ??
            itObj.line_total ??
            itObj.net_amount
          );
          const lineTotal =
            explicitTotal ??
            (unitPrice !== null ? unitPrice * qty : null);

          const rawLead =
            (it as unknown as Record<string, unknown>).lead_time_days ??
            it.delivery_days ??
            itObj.lead_time_days ??
            itObj.delivery_days;
          const rawDeliveryDate =
            (it as unknown as Record<string, unknown>).expected_delivery_date ??
            (it as unknown as Record<string, unknown>).delivery_date ??
            (it as unknown as Record<string, unknown>).schedule_date ??
            itObj.expected_delivery_date ??
            itObj.delivery_date ??
            itObj.schedule_date;
          let parsedDelivery =
            typeof rawLead === "number" && rawLead > 0 ? rawLead : 0;
          if (!parsedDelivery && typeof rawDeliveryDate === "string" && rawDeliveryDate.trim()) {
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const target = new Date(rawDeliveryDate);
            target.setHours(0, 0, 0, 0);
            const diff = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (diff > 0) parsedDelivery = diff;
          }

          const itemEntry = {
            unit_price: unitPrice,
            total: lineTotal,
            delivery_days: parsedDelivery,
            expected_delivery_date: typeof rawDeliveryDate === "string" ? rawDeliveryDate : undefined,
          };
          if (it.item_code) {
            byItem.set(it.item_code, itemEntry);
            byItem.set(it.item_code.trim().toLowerCase(), itemEntry);
          }
          if (it.item_name) {
            byItem.set(it.item_name, itemEntry);
            byItem.set(it.item_name.trim().toLowerCase(), itemEntry);
          }
        }

        let resolvedAmount = price.amount;
        let resolvedStatus = price.status;

        // If price is missing or not resolved from server payload, check sessionStorage for matching quotation
        if (resolvedAmount === null && typeof window !== "undefined") {
          const keysToTry = [
            `quotation_${rfqName}_${supplierName}`,
            `quotation_${rfqName}_${sq.supplier}`,
            `quotation_${rfqName}_${normalizeSupplierKey(supplierName)}`,
            `quotation_${rfqName}_${normalizeSupplierKey(sq.supplier)}`,
            `draft_quotation_${rfqName}_${supplierName}`,
            `draft_quotation_${rfqName}_${sq.supplier}`,
          ];
          for (const k of keysToTry) {
            try {
              const raw = sessionStorage.getItem(k);
              if (raw) {
                const parsed = JSON.parse(raw);
                const sPrice = resolveQuotePrice(parsed);
                if (sPrice.amount !== null) {
                  resolvedAmount = sPrice.amount;
                  resolvedStatus = sPrice.status;
                  if (byItem.size === 0 && Array.isArray(parsed.items)) {
                    for (const pit of parsed.items) {
                      const pUnit = parseQuoteAmount(pit.unit_price ?? pit.rate ?? pit.price);
                      const pQty = parseQuoteAmount(pit.qty ?? pit.quantity) ?? 1;
                      const pTot = parseQuoteAmount(pit.total ?? pit.amount) ?? (pUnit !== null ? pUnit * pQty : null);
                      const pLead = (pit as Record<string, unknown>).lead_time_days ?? pit.delivery_days ?? 0;
                      const pDate = (pit as Record<string, unknown>).expected_delivery_date ?? (pit as Record<string, unknown>).delivery_date ?? "";
                      let pDays = typeof pLead === "number" && pLead > 0 ? pLead : 0;
                      if (!pDays && typeof pDate === "string" && pDate.trim()) {
                        const now = new Date();
                        now.setHours(0, 0, 0, 0);
                        const target = new Date(pDate);
                        target.setHours(0, 0, 0, 0);
                        const diff = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        if (diff > 0) pDays = diff;
                      }
                      const pEntry = {
                        unit_price: pUnit,
                        total: pTot,
                        delivery_days: pDays,
                        expected_delivery_date: typeof pDate === "string" ? pDate : undefined,
                      };
                      if (pit.item_code) {
                        byItem.set(pit.item_code, pEntry);
                        byItem.set(pit.item_code.trim().toLowerCase(), pEntry);
                      }
                      if (pit.item_name) {
                        byItem.set(pit.item_name, pEntry);
                        byItem.set(pit.item_name.trim().toLowerCase(), pEntry);
                      }
                    }
                  }
                  break;
                }
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }

        const quoteObj: SubmittedQuote = {
          sqName: sq.name,
          supplier: sq.supplier,
          supplier_name: supplierName,
          total: resolvedAmount,
          priceStatus: resolvedStatus,
          notes: [sq.notes, sq.custom_terms_note && `Terms: ${sq.custom_terms_note}`,
            sq.custom_warranty_note && `Warranty: ${sq.custom_warranty_note}`,
            sq.custom_insurance_note && `Insurance: ${sq.custom_insurance_note}`]
            .filter(Boolean).join("\n"),
          payment_terms: (sq as unknown as Record<string, unknown>).terms as string | undefined,
          warrantyCertificate: Boolean(sq.custom_warenty_certificate),
          termsCondition: Boolean(sq.custom_terms__condition || sq.terms),
          insuranceCertificate: Boolean(sq.custom_insurance_certificate),
          byItem,
        };

        // Exactly one canonical entry per unique supplier
        next.set(supplierName, quoteObj);
      }

      // Check sessionStorage for quotes for this RFQ that might not have landed on backend
      if (typeof window !== "undefined") {
        try {
          for (let i = 0; i < sessionStorage.length; i++) {
            const storageKey = sessionStorage.key(i);
            if (storageKey && storageKey.startsWith(`quotation_${rfqName}_`)) {
              const raw = sessionStorage.getItem(storageKey);
              if (raw) {
                const parsed = JSON.parse(raw);
                const supp = parsed.supplier || parsed.supplier_name;
                if (supp && !quoteForSupplier(next, supp)) {
                  const sPrice = resolveQuotePrice(parsed);
                  const byItem = new Map<
                    string,
                    { unit_price: number | null; total: number | null; delivery_days: number }
                  >();
                  if (Array.isArray(parsed.items)) {
                    for (const pit of parsed.items) {
                      const pUnit = parseQuoteAmount(pit.unit_price ?? pit.rate ?? pit.price);
                      const pQty = parseQuoteAmount(pit.qty ?? pit.quantity) ?? 1;
                      const pTot = parseQuoteAmount(pit.total ?? pit.amount) ?? (pUnit !== null ? pUnit * pQty : null);
                      const pEntry = { unit_price: pUnit, total: pTot, delivery_days: pit.delivery_days ?? 0 };
                      if (pit.item_code) {
                        byItem.set(pit.item_code, pEntry);
                        byItem.set(pit.item_code.trim().toLowerCase(), pEntry);
                      }
                      if (pit.item_name) {
                        byItem.set(pit.item_name, pEntry);
                        byItem.set(pit.item_name.trim().toLowerCase(), pEntry);
                      }
                    }
                  }
                  const quoteObj: SubmittedQuote = {
                    sqName: parsed.name || "",
                    supplier: parsed.supplier || supp,
                    supplier_name: parsed.supplier_name || supp,
                    total: sPrice.amount,
                    priceStatus: sPrice.status,
                    notes: parsed.notes ?? "",
                    payment_terms: parsed.payment_terms,
                    byItem,
                  };
                  next.set(supp, quoteObj);
                }
              }
            }
          }
        } catch {
          /* ignore storage enumeration errors */
        }
      }

      return next;
    });
  }, [quotesQuery.data, rfqName]);

  /* ─────────────── Comparison data ─────────────── */

  const comparison = useMemo(() => {
    if (!rfq) return null;
    const suppliers = (rfq.suppliers ?? []).map((s) => ({
      supplier: s.supplier,
      supplier_name: s.supplier,
      submitted: !!quoteForSupplier(localQuotes, s.supplier),
    }));
    const submittedCount = suppliers.filter((s) => s.submitted).length;
    return { suppliers, submittedCount };
  }, [rfq, localQuotes]);

  /* ─────────────── AI analysis modal ─────────────── */

  const submittedQuoteCount = comparison?.submittedCount ?? 0;

  const aiQuoteAmount = useMemo(() => {
    const recommendedSupplierName =
      aiResult?.recommended_supplier ??
      savedAnalysis?.recommended_supplier ??
      "";
    if (!recommendedSupplierName) return null;
    const quote = quoteForSupplier(localQuotes, recommendedSupplierName);
    return quote?.total ?? null;
  }, [aiResult, savedAnalysis, localQuotes]);

  /* ─────────────── Invited supplier allow-list ─────────────── */

  const invitedSupplierIds = useMemo(() => {
    if (!rfq) return new Set<string>();
    return new Set(
      (rfq.suppliers ?? []).map(
        (s: { supplier?: string; supplier_name?: string }) =>
          (s.supplier ?? s.supplier_name ?? "").trim().toLowerCase()
      )
    );
  }, [rfq]);

  const quotedSupplierIds = useMemo(
    () =>
      Array.from(localQuotes.values())
        .map((q) => (q.supplier ?? q.supplier_name ?? "").trim().toLowerCase())
        .filter(Boolean),
    [localQuotes],
  );

  useEffect(() => {
    if (!rfqName || !savedAnalysis) return;
    if (
      detectRfqAiStale(
        rfqName,
        Array.from(invitedSupplierIds),
        quotedSupplierIds,
      )
    ) {
      const baseline = readRfqAiBaseline(rfqName);
      let source: RfqAiStaleSource = "quotation";
      if (baseline) {
        const baseQuoted = new Set(baseline.quotedSupplierIds);
        const baseInvited = new Set(baseline.invitedSupplierIds);
        const hasNewQuote = quotedSupplierIds.some((id) => !baseQuoted.has(id));
        const hasNewInvite = Array.from(invitedSupplierIds).some(
          (id) => !baseInvited.has(id),
        );
        if (hasNewInvite && !hasNewQuote) source = "invite";
      }
      markRfqAiStale(
        rfqName,
        source === "invite"
          ? "Additional suppliers were invited after the last AI analysis."
          : "A new supplier quotation was received after the last AI analysis.",
        source,
      );
      setAiStaleTick((t) => t + 1);
    }
  }, [rfqName, savedAnalysis, invitedSupplierIds, quotedSupplierIds]);

  const aiNeedsRerun = useMemo(() => {
    void aiStaleTick;
    return !!savedAnalysis && getRfqAiStale(rfqName).stale;
  }, [savedAnalysis, rfqName, aiStaleTick]);

  const aiStaleSource = useMemo((): RfqAiStaleSource => {
    void aiStaleTick;
    return getRfqAiStale(rfqName).source ?? "quotation";
  }, [rfqName, aiStaleTick]);

  // Must stay above loading/error early returns — same hook order every render.
  const newlyAddedByRound = useMemo(() => {
    void roundActivityTick;
    if (!rfqName) return {} as Record<string, number>;
    const map = readRfqRoundMetaMap(rfqName);
    const out: Record<string, number> = {};
    for (const [roundName, meta] of Object.entries(map)) {
      out[roundName] = meta.newly_added_suppliers;
    }
    return out;
  }, [rfqName, roundActivityTick]);

  const roundActivityEntries = useMemo(() => {
    void roundActivityTick;
    return rfqName ? readRfqRoundActivity(rfqName) : [];
  }, [rfqName, roundActivityTick]);

  /* ─────────────── Saved AI analysis (localStorage) ─────────────── */

  // Re-hydrate the persisted analysis whenever the RFQ changes.
  useEffect(() => {
    const cached = readSavedAnalysis(rfqName);
    setSavedAnalysis(cached);
    let active = true;
    // Always reconcile with ERPNext; a browser cache must not conceal a newer run.
    if (rfqName) {
      getLatestAnalysisSnapshot<SavedAnalysisRecord>(rfqName).then((snapshot) => {
        if (!active || !snapshot || !isUsableAnalysis(snapshot)) return;
        setSavedAnalysis((current) => {
          if (current && Date.parse(current.analysed_at) > Date.parse(snapshot.analysed_at)) return current;
          try { localStorage.setItem(analysisStorageKey(rfqName), JSON.stringify(snapshot)); } catch { /* optional cache */ }
          return snapshot;
        });
      }).catch(() => { /* cached analysis remains available while ERPNext is offline */ });
    }
    return () => { active = false; };
  }, [rfqName]);

  useEffect(() => {
    if (import.meta.env.DEV && savedAnalysis?.analysis.evaluation_run_id) {
      console.debug("[AI EVALUATION DEBUG] frontend", JSON.stringify({
        rfq: savedAnalysis.rfq_name,
        evaluation_run_id: savedAnalysis.analysis.evaluation_run_id,
        recommendations: savedAnalysis.analysis.supplier_analysis,
      }));
    }
  }, [savedAnalysis]);

  // Validate cached analysis against the actual invited suppliers once
  // the RFQ data is available — purge or filter stale results that
  // reference suppliers not invited to THIS RFQ.
  useEffect(() => {
    if (!rfq || !savedAnalysis) return;
    const validated = validateCachedAnalysis(
      structuredClone(savedAnalysis),
      invitedSupplierIds,
      localQuotes
    );
    if (!validated) {
      if (localQuotes.size > 0) setSavedAnalysis(null);
      return;
    }
    if (
      JSON.stringify(validated.analysis.supplier_analysis) !==
        JSON.stringify(savedAnalysis.analysis.supplier_analysis)
    ) {
      // eslint-disable-next-line no-console
      console.log(
        "[AI Cache] Validated cached analysis against invited suppliers:",
        "filtered"
      );
      setSavedAnalysis(validated);
    }
  }, [rfq, invitedSupplierIds, savedAnalysis, localQuotes]);

  // Repair older cached analyses after the authoritative quotation records
  // load. Earlier versions persisted missing quote prices as numeric zero.
  useEffect(() => {
    if (!quotesQuery.data || !savedAnalysis) return;
    const reconciled = structuredClone(savedAnalysis);
    if (reconcileAnalysisQuotePrices(reconciled.analysis, localQuotes, rfqName)) {
      reconciled.recommended_supplier = reconciled.analysis.recommended_supplier;
      reconciled.confidence_score = reconciled.analysis.confidence_score;
      setSavedAnalysis(reconciled);
      try {
        localStorage.setItem(analysisStorageKey(rfqName), JSON.stringify(reconciled));
      } catch {
        // Rendering remains correct even if browser storage is unavailable.
      }
    }
  }, [quotesQuery.data, localQuotes, rfqName, savedAnalysis]);

  function saveAnalysis(name: string, analysis: AIRecommendation, publish = true): SavedAnalysisRecord {
    const record: SavedAnalysisRecord = {
      rfq_name: name,
      analysed_at: new Date().toISOString(),
      evaluation_run_id: analysis.evaluation_run_id,
      recommended_supplier: analysis.recommended_supplier,
      confidence_score: analysis.confidence_score,
      analysis,
      quotations_snapshot: (() => {
        const seen = new Set<string>();
        const snap: SavedAnalysisRecord["quotations_snapshot"] = [];
        const normInvited = new Set(Array.from(invitedSupplierIds).map(normalizeSupplierKey));
        for (const q of localQuotes.values()) {
          if (!isSubmittedQuoteAmount(q.total)) continue;
          const key = normalizeSupplierKey(q.supplier ?? q.supplier_name ?? "");
          if (invitedSupplierIds.size > 0) {
            const rawKey = (q.supplier ?? q.supplier_name ?? "").trim().toLowerCase();
            if (!invitedSupplierIds.has(rawKey) && !normInvited.has(key)) continue;
          }
          if (!seen.has(key)) {
            seen.add(key);
            snap.push({ supplier: q.supplier_name, supplier_id: q.supplier, quotation_id: q.sqName, grand_total: q.total! });
          }
        }
        return snap;
      })(),
    };
    if (!publish) return record;
    try {
      // When a supplier is already selected, save re-analysis under a
      // separate key to preserve the original selection snapshot.
      if (approvalState?.selected_supplier) {
        localStorage.setItem(
          `rfq_reanalysis_${name}`,
          JSON.stringify(record)
        );
      } else {
        localStorage.setItem(analysisStorageKey(name), JSON.stringify(record));
        const key = analysisStorageKey(name);
        const list: string[] = JSON.parse(
          localStorage.getItem(ANALYSES_LIST_KEY) || "[]"
        );
        if (!list.includes(key)) {
          list.push(key);
          localStorage.setItem(ANALYSES_LIST_KEY, JSON.stringify(list));
        }
        setSavedAnalysis(record);
        saveRfqAiBaseline(
          name,
          Array.from(invitedSupplierIds),
            Array.from(localQuotes.values())
            .filter((q) => isSubmittedQuoteAmount(q.total))
            .map((q) => (q.supplier ?? q.supplier_name ?? "").trim())
            .filter(Boolean),
        );
      }
    } catch {
      /* ignore storage quota / serialization errors */
    }
    return record;
  }

  function viewSavedAnalysis() {
    // When a supplier is already selected, ALWAYS open the read-only summary.
    // Never fall through to the full AI modal or re-run analysis.
    if (approvalState?.selected_supplier) {
      if (savedAnalysis) {
        const validated = validateCachedAnalysis(
          structuredClone(savedAnalysis),
          invitedSupplierIds,
          localQuotes
        );
        if (!validated) {
          setAiResult(null);
          toast.error("AI evaluation unavailable / incomplete for the current quotations.");
          return;
        }
        setAiResult(validated.analysis);
      }
      setSummaryModalOpen(true);
      return;
    }

    // Before supplier selection: open full AI modal with saved results
    if (!savedAnalysis) return;

    const validated = validateCachedAnalysis(
      structuredClone(savedAnalysis),
      invitedSupplierIds,
      localQuotes
    );
    if (!validated) {
      // eslint-disable-next-line no-console
      console.warn("[AI] Cached analysis invalidated — forcing re-analysis");
      setSavedAnalysis(null);
      openAIAnalysis();
      return;
    }

    setAiResult(validated.analysis);
    setAiError(null);
    setAiLoading(false);
    setAiModalOpen(true);
  }

  function findQuoteByIdentity(identity: RfqQuotationIdentity): SubmittedQuote {
    const sq = resolveRfqQuotationIdentity(rfqName, identity, quotesQuery.data ?? []);
    const quote = [...localQuotes.values()].find((row) => row.sqName === sq.name && row.supplier === sq.supplier);
    if (!quote) throw new Error("Selected Supplier Quotation is no longer available. Refresh the RFQ and try again.");
    return quote;
  }

  function assertEvaluatedSupplierEligible(identity: RfqQuotationIdentity, requireEvaluation = true) {
    const rows = (aiResult ?? savedAnalysis?.analysis)?.supplier_analysis ?? [];
    const matching = rows.filter((row) => {
      const evaluated = reverseBiddingSelectionForRow(row);
      return evaluated?.rfq_id === rfqName && evaluated.quotation_id === identity.quotation_id &&
        evaluated.supplier_id === identity.supplier_id;
    });
    // Existing approved records without an AI snapshot still use the live backend gate.
    if (!requireEvaluation && matching.length === 0) return;
    const eligibility = getSupplierAwardEligibility(matching.length === 1 ? matching[0] : undefined);
    if (!eligibility.awardEligible) {
      throw new Error(eligibility.awardIneligibilityReason || "Supplier is not eligible for selection. Refresh the evaluation and try again.");
    }
  }

  /**
   * Real ERPNext Supplier Quotation record (has `.name` + legal-document
   * custom fields) for a supplier — unlike `SubmittedQuote`, which is a
   * locally-derived display object with no ERPNext document name.
   */
  function findRealSQForSupplier(supplierId: string, quotationId?: string): SupplierQuotation | undefined {
    try {
      return resolveRfqQuotationIdentity(rfqName, { supplier_id: supplierId, quotation_id: quotationId }, quotesQuery.data ?? []);
    } catch { return undefined; }
  }

  /**
   * Ensures a "Legal Document Review" record exists for the winning
   * supplier the instant they're selected (RFQ workflow -> "Pending Legal
   * Review"). Award confirmation must verify this persisted record before the CLM decision.
   */
  async function ensureLegalReviewForWinningSupplier(
    rfqForReview: RFQ,
    supplierForApproval: string,
    quotationId?: string,
  ): Promise<LegalDocumentSet> {
    // eslint-disable-next-line no-console
    console.log("[LegalAudit] 1. Procurement selected supplier:", supplierForApproval);

    const sq = findRealSQForSupplier(supplierForApproval, quotationId);
    // eslint-disable-next-line no-console
    console.log("[LegalAudit] 2. Supplier Quotation lookup result:", {
      searched_supplier_id: supplierForApproval,
      rfq: rfqForReview.name,
      found: !!sq,
      supplier_quotation_id: sq?.name ?? null,
      supplier_name: sq?.supplier_name ?? sq?.supplier ?? null,
      status: sq?.status ?? null,
      total_candidates_in_rfq: (quotesQuery.data ?? []).length,
      candidate_suppliers: (quotesQuery.data ?? []).map((q) => ({
        supplier: q.supplier,
        supplier_name: q.supplier_name,
      })),
    });

    if (!sq?.name) {
      // eslint-disable-next-line no-console
      console.warn(
        "[LegalAudit] 3. Lookup FAILED — no Supplier Quotation record matched",
        `supplier === "${supplierForApproval}"`,
        "OR",
        `supplier_name === "${supplierForApproval}"`,
        "among quotations already scoped to this RFQ (items.request_for_quotation =",
        rfqForReview.name,
        "). Reason: either no quotation exists for this RFQ/supplier pair, or the",
        "supplier identifier passed in does not exactly match either field",
        "(check for casing/whitespace/quote-character differences)."
      );
      throw new Error("Supplier selection was saved, but its matching Supplier Quotation could not be confirmed. The Contract decision was not recorded.");
    }
    // eslint-disable-next-line no-console
    console.log("[LegalAudit] 3. Lookup query matched. supplier == selected supplier is verified against quotations pre-filtered by request_for_quotation == current RFQ.");

    const itemSummary: LegalDocumentItemSummary[] = (sq.items ?? []).map((it) => ({
      item_code: it.item_code,
      item_name: it.item_name,
      qty: it.qty,
      uom: it.uom,
      rate: it.rate,
      amount: it.amount ?? it.qty * it.rate,
    }));

    // NOTE: real ERPNext fieldnames (verified via Custom Field metadata) —
    // `custom_terms__condition` (double underscore) and
    // `custom_warenty_certificate` (upstream typo "warenty") are NOT typos
    // in this code; they must match ERPNext exactly.
    const termsFileUrl = (sq.custom_terms__condition as string | undefined) ?? "";
    const termsNote = sq.custom_terms_note ?? "";
    const warrantyFileUrl = (sq.custom_warenty_certificate as string | undefined) ?? "";
    const warrantyNote = sq.custom_warranty_note ?? "";
    const insuranceFileUrl = (sq.custom_insurance_certificate as string | undefined) ?? "";
    const insuranceNote = sq.custom_insurance_note ?? "";

    // eslint-disable-next-line no-console
    console.log("[LegalAudit] 4. Before create — resolved inputs:", {
      selected_supplier: supplierForApproval,
      resolved_supplier_quotation: sq.name,
      resolved_rfq: rfqForReview.name,
      legal_pdfs_found: {
        terms_pdf: termsFileUrl || "(none)",
        warranty_pdf: warrantyFileUrl || "(none)",
        insurance_pdf: insuranceFileUrl || "(none)",
      },
    });

    try {
      const created = await ensureLegalDocumentReviewForSelection({
        sq_name: sq.name,
        rfq_name: rfqForReview.name,
        supplier: sq.supplier,
        company: rfqForReview.company ?? "",
        quotation_number: sq.name,
        procurement_manager: user?.email ?? "",
        submission_date: sq.transaction_date ?? new Date().toISOString(),
        grand_total: (() => {
          const amount = resolveSupplierQuotationPrice(sq).amount;
          if (amount === null) {
            throw new Error(
              "Cannot create Legal Review: quotation pricing was not provided.",
            );
          }
          return amount;
        })(),
        valid_till: sq.valid_till,
        item_summary: JSON.stringify(itemSummary),
        terms_file_url: termsFileUrl,
        terms_note: termsNote,
        warranty_file_url: warrantyFileUrl,
        warranty_note: warrantyNote,
        insurance_file_url: insuranceFileUrl,
        insurance_note: insuranceNote,
      });
      // eslint-disable-next-line no-console
      console.log("[LegalAudit] 5. Legal Review Name:", created?.name ?? "(missing)");
      const persisted = await getLegalDocsByRfq(rfqForReview.name);
      if (!created.name || persisted?.name !== created.name || persisted.rfq_name !== rfqForReview.name || persisted.supplier !== supplierForApproval || persisted.sq_name !== sq.name) throw new Error("The persisted supplier award could not be verified. The Contract decision was not recorded.");
      return persisted;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[LegalAudit] 5. Creation failed — complete ERP error:", err);
      throw err;
    }
  }

  function closeAIModal() {
    if (creatingPO) return;
    setAiModalOpen(false);
    if (aiStepIntervalRef.current) {
      clearInterval(aiStepIntervalRef.current);
      aiStepIntervalRef.current = null;
    }
    if (aiLoading) setAiLoading(false);
  }

  function openAIAnalysis() {
    if (submittedQuoteCount < 2) {
      toast.error("Need at least 2 quotations for AI analysis.");
      return;
    }
    setAiModalOpen(true);
    void runAIAnalysis();
  }

  async function runAIAnalysis() {
    if (!rfq) return;

    setAiLoading(true);
    setAiLoadingStep(0);
    setAiError(null);
    setAiResult(null);

    if (aiStepIntervalRef.current) clearInterval(aiStepIntervalRef.current);
    aiStepIntervalRef.current = setInterval(() => {
      setAiLoadingStep((prev) => {
        if (prev >= ANALYSIS_STEPS.length - 1) {
          if (aiStepIntervalRef.current) {
            clearInterval(aiStepIntervalRef.current);
            aiStepIntervalRef.current = null;
          }
          return prev;
        }
        return prev + 1;
      });
    }, 900);

    try {
      if ((comparison?.submittedCount ?? 0) < 2) {
        throw new Error("Need at least 2 quotations for an AI recommendation.");
      }

      /* ── Build the invited-supplier allow-list ───────────────────────── */

      // eslint-disable-next-line no-console
      console.log("[AI] ══════ Starting AI Analysis ══════");
      // eslint-disable-next-line no-console
      console.log("[AI] Current RFQ ID:", rfq.name);

      // Suppliers who explicitly declined ("No Quote") are excluded from the
      // comparison / AI recommendation — only quoting suppliers are evaluated.
      const invitedSuppliers = new Set(
        (rfq.suppliers ?? [])
          .map(
            (s: { supplier?: string; supplier_name?: string }) =>
              (s.supplier ?? s.supplier_name ?? "").trim().toLowerCase()
          )
          .filter((key) => !declineBySupplier.has(key))
      );

      // eslint-disable-next-line no-console
      console.log("[AI] Invited suppliers (excluding declines):", [...invitedSuppliers]);

      /* ── Filter quotations: only invited + submitted (deduplicated) ─── */

      const normInvitedSuppliers = new Set(
        Array.from(invitedSuppliers).map(normalizeSupplierKey)
      );
      const seenEligible = new Set<string>();
      const eligibleQuotes: SubmittedQuote[] = [];
      for (const q of localQuotes.values()) {
        const rawKey = (q.supplier ?? q.supplier_name ?? "").trim().toLowerCase();
        const normKey = normalizeSupplierKey(rawKey);
        if (
          !seenEligible.has(normKey) &&
          (invitedSuppliers.has(rawKey) || normInvitedSuppliers.has(normKey))
        ) {
          seenEligible.add(normKey);
          eligibleQuotes.push(q);
        }
      }

      // eslint-disable-next-line no-console
      console.log("[AI] Submitted suppliers:", [...localQuotes.keys()]);
      // eslint-disable-next-line no-console
      console.log(
        "[AI] Eligible suppliers (invited ∩ submitted):",
        eligibleQuotes.map((q) => q.supplier_name)
      );

      if (eligibleQuotes.length < 2) {
        throw new Error(
          eligibleQuotes.length === 0
            ? "Waiting for supplier quotations from invited suppliers."
            : "Need at least 2 quotations from invited suppliers for AI analysis."
        );
      }

      /* ── Build AI request from eligible suppliers ONLY ───────────────── */

      const evaluationRunId = generateId();
      const aiRequest = {
        evaluation_run_id: evaluationRunId,
        rfq_name: rfq.name,
        rfq_title: parsedMessage.title || rfq.name,
        items_requested: (rfq.items ?? []).map((it) => ({
          item: it.item_name ?? it.item_code,
          qty: it.qty,
          uom: it.uom,
        })),
        quotations: eligibleQuotes.map<AIQuotation>((q) => {
          const lines: AIQuotationLine[] = (rfq.items ?? []).map((it) => {
            const itemCodeKey = it.item_code?.trim().toLowerCase();
            const itemNameKey = it.item_name?.trim().toLowerCase();
            const cell =
              (it.item_code ? q.byItem.get(it.item_code) : undefined) ??
              (itemCodeKey ? q.byItem.get(itemCodeKey) : undefined) ??
              (it.item_name ? q.byItem.get(it.item_name) : undefined) ??
              (itemNameKey ? q.byItem.get(itemNameKey) : undefined) ??
              Array.from(q.byItem.entries()).find(([k]) => {
                const lk = k.toLowerCase();
                return (
                  (itemCodeKey && lk.includes(itemCodeKey)) ||
                  (itemNameKey && lk.includes(itemNameKey))
                );
              })?.[1];

            const unitPrice = cell?.unit_price ?? null;
            const qty = it.qty ?? 1;
            const lineTotal =
              cell?.total ?? (unitPrice !== null ? unitPrice * qty : null);

            const cellDelivery =
              cell?.delivery_days && cell.delivery_days > 0
                ? cell.delivery_days
                : undefined;

            return {
              item: it.item_name ?? it.item_code,
              requested_qty: qty,
              unit_price: unitPrice,
              total: lineTotal,
              delivery_days: cellDelivery,
              delivery_date: (cell as unknown as { expected_delivery_date?: string })?.expected_delivery_date,
              expected_delivery_date: (cell as unknown as { expected_delivery_date?: string })?.expected_delivery_date,
              notes: "",
            };
          });

          let totalValue = q.total;
          if (totalValue === null) {
            const sumLines = priceFromLines(lines);
            if (sumLines !== null) totalValue = sumLines;
          }

          return {
            quotation_id: q.sqName,
            supplier_id: q.supplier,
            supplier_name: q.supplier_name,
            items: lines,
            total_value: totalValue,
            price_status: isSubmittedQuoteAmount(totalValue) ? "submitted" : q.priceStatus,
            payment_terms: q.payment_terms || undefined,
            notes: q.notes,
            documents: {
              warranty_certificate: q.warrantyCertificate,
              terms_conditions: q.termsCondition,
              insurance_certificate: q.insuranceCertificate,
            },
          };
        }),
      };

      const scoringConfig = await getScoringConfig();
      const analysisWeights: AnalysisWeights = {
        price: scoringConfig.price_weight,
        delivery: scoringConfig.delivery_weight,
        quality: scoringConfig.quality_weight,
        reliability: scoringConfig.reliability_weight,
      };

      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.log("AI Request", aiRequest);

      const supplierNames = aiRequest.quotations.map((q) => q.supplier_id || q.supplier_name);
      let historicalData;
      try {
        historicalData = await getSupplierPerformance(supplierNames);
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.log("[AI] Historical performance data:", historicalData);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[AI] Could not fetch historical data, scoring with quotation data only:", err);
      }

      for (const quote of aiRequest.quotations) {
        quote.historical_data = historicalData?.[quote.supplier_id || quote.supplier_name];
      }
      if (import.meta.env.DEV) console.debug("[AI EVALUATION DEBUG] input", JSON.stringify(aiRequest));
      const resolved = await resolveAIRecommendation(aiRequest, analysisWeights);
      if (!resolved) throw new Error("AI evaluation unavailable / incomplete. Please retry the analysis.");
      let recommendation = resolved.recommendation;

      /* ── Post-validation: Normalize, deduplicate & reconcile quote prices ─── */
      const authoritativeQuotes: AuthoritativeQuoteInfo[] = eligibleQuotes.map((q) => ({
        quotation_id: q.sqName || undefined,
        supplier_quotation_id: q.sqName || undefined,
        supplier_id: q.supplier || undefined,
        supplier_name: q.supplier_name,
        grand_total: q.total != null && isSubmittedQuoteAmount(q.total) ? q.total : undefined,
        rfq_id: rfq.name,
        docstatus: 1,
        byItem: q.byItem,
        priceStatus: q.priceStatus,
      }));

      recommendation = normalizeAndDeduplicateRecommendation(recommendation, {
        rfqId: rfq.name,
        authoritativeQuotes,
      });

      if (recommendation.supplier_analysis.length !== eligibleQuotes.length) {
        throw new Error("AI evaluation unavailable / incomplete: one result per current quotation is required.");
      }
      for (const row of recommendation.supplier_analysis) {
        const quote = aiRequest.quotations.find((q) => q.quotation_id === row.quotation_id && q.supplier_id === row.supplier_id);
        if (!quote || row.evaluation_run_id !== evaluationRunId) throw new Error("AI evaluation identity mismatch.");
        const quotedDelivery = quote.items.some((item) => Number(item.delivery_days) > 0);
        const history = quote.historical_data;
        const deliveryAvailable = !!history?.has_delivery_data || quotedDelivery;
        const historyAvailable = !!history?.has_sufficient_data;
        row.has_sufficient_data = deliveryAvailable && historyAvailable;
        row.confidence_level = row.has_sufficient_data ? "high" : "low";
        row.score_sources = [
          {dimension:"Price", value:row.score.cost, source:"This supplier's submitted quotation", has_data:isSubmittedQuoteAmount(quote.total_value)},
          {dimension:"Delivery", value:row.score.delivery, source:history?.has_delivery_data ? "This supplier's receipts matched to their purchase orders; quoted delivery is separately reported" : quotedDelivery ? "This quotation's delivery commitment" : "Delivery unavailable; existing neutral scoring rule", has_data:deliveryAvailable},
          {dimension:"Quality", value:row.score.quality ?? -1, source:history?.has_quality_data ? "Actual quantities and rejections in this supplier's purchase receipts" : "Quoted item coverage; historical quality unavailable", has_data:!!history?.has_quality_data},
          {dimension:"Reliability", value:row.score.reliability, source:history?.has_reliability_data ? "This supplier's order and invoice history" : "Terms and attachment presence; contents not verified", has_data:!!history?.has_reliability_data},
        ];
      }
      const engineResult = scoringResultFromRecommendation(recommendation, scoringConfig);

      // Confidence Score (AI Procurement Copilot card) — always the fixed
      // Price 35% / Delivery 25% / Reliability 30% / Completeness 10%
      // formula applied to the recommended supplier's dimension scores, so
      // it never depends on whether the cloud AI provider echoed a usable
      // top-level confidence figure.
      const winner = findRecommendationWinner(recommendation);
      const recommendedScored = engineResult.suppliers.find(
        (s) => s.quotation_id === winner?.quotation_id && s.supplier_id === winner?.supplier_id,
      );
      if (recommendedScored) {
        recommendation.confidence_score = computeConfidenceScore({
          price_score: recommendedScored.dimensions.price_score,
          delivery_score: recommendedScored.dimensions.delivery_score,
          reliability_score: recommendedScored.dimensions.reliability_score,
          completeness_score: recommendedScored.dimensions.quality_score,
        });
      }

      const analysisRecord = saveAnalysis(rfq.name, recommendation, false);
      const persisted = await saveScoringResult(rfq.name, engineResult, analysisRecord);
      const verified = JSON.parse(persisted.analysis_snapshot!) as SavedAnalysisRecord;
      saveAnalysis(rfq.name, verified.analysis);
      setAiResult(verified.analysis);
      setAiLoadingStep(ANALYSIS_STEPS.length - 1);
      setAiError(null);
      if (import.meta.env.DEV) console.debug("[AI EVALUATION DEBUG] persisted/frontend", JSON.stringify({
        rfq:rfq.name, evaluation_run_id:evaluationRunId, document:persisted.name,
        persisted:persisted.supplier_scores, frontend:verified.analysis.supplier_analysis,
      }));
    } catch (err) {
      const message = resolveApiErrorMessage(err, "AI evaluation unavailable / incomplete. Please retry the analysis.");
      setAiError(message);
      setAiResult(null);
      toast.error(message, {id:"rfq-ai-evaluation"});
    } finally {
      if (aiStepIntervalRef.current) {
        clearInterval(aiStepIntervalRef.current);
        aiStepIntervalRef.current = null;
      }
      setAiLoading(false);
    }
  }

  function handleConfirmAndSendForReview() {
    setAiModalOpen(false);
    toast("The saved RFQ contract requirement is applied after supplier award.");
  }

  function createPOFromRecommendation() {
    if (!aiResult) return;
    // Prefer live contract / LDR gate (same as Generate PO) over legacy localStorage check.
    const ldrReady = (contractContinuationReady || isRfqReadyForPurchaseOrder(legalDoc)) && !poExists;
    if (ldrReady) {
      if (!canManagePurchaseOrders(userRole)) {
        toast.error("Purchase Order creation is restricted to authorized roles.");
        return;
      }
      void handleCreatePO();
    } else {
      void handleConfirmAndSendForReview();
    }
  }

  async function handleSelectAnySupplier(payload: SupplierSelectionPayload) {
    if (!rfq || submittingForReview) return;
    let awardPersisted = Boolean(
      pendingAwardDecision ||
      (legalDoc?.name && legalDoc.supplier === payload.supplierName) ||
      (rfqClmQuery.data?.can_decide && rfqClmQuery.data.source?.award)
    );

    // eslint-disable-next-line no-console
    console.log("[RFQ] Supplier selection:", {
      supplier: payload.supplierName,
      aiRank: payload.aiRank,
      riskLevel: payload.riskLevel,
      reason: payload.reason,
      grandTotal: payload.grandTotal,
      selectedBy: user?.email,
      timestamp: new Date().toISOString(),
    });

    setSubmittingForReview(true);
    try {
      const quote = findQuoteByIdentity(payload);
      assertEvaluatedSupplierEligible(payload);
      if (!isSubmittedQuoteAmount(quote.total)) throw new Error("Cannot select this supplier until quotation pricing is provided.");
      const supplierForApproval = quote.supplier;

      if (pendingAwardDecision && (pendingAwardDecision.supplier !== supplierForApproval || pendingAwardDecision.quotation !== quote.sqName)) {
        throw new Error("Finish the saved supplier award Contract decision before selecting another supplier.");
      }

      // Check if award already exists for this supplier and quotation
      const existingAward =
        pendingAwardDecision ||
        (legalDoc && legalDoc.name && legalDoc.supplier === supplierForApproval && legalDoc.sq_name === quote.sqName
          ? { award: legalDoc.name, supplier: legalDoc.supplier, quotation: legalDoc.sq_name }
          : rfqClmQuery.data?.can_decide && rfqClmQuery.data.source?.award && rfqClmQuery.data.source.supplier === supplierForApproval && rfqClmQuery.data.source.quotation === quote.sqName
          ? { award: rfqClmQuery.data.source.award, supplier: rfqClmQuery.data.source.supplier, quotation: rfqClmQuery.data.source.quotation }
          : null);

      let award = existingAward;
      let state = approvalState;

      if (!award) {
        state = await submitForReview({
          rfqName: rfq.name,
          rfqTitle: parsedMessage.title || rfq.name,
          company: rfq.company ?? "",
          selectedSupplier: supplierForApproval,
          selectedSupplierTotal: quote.total,
          rfqValue: quote.total,
          submittedBy: user?.email ?? "procurement@netlink.com",
          contractRequired: rfq.contract_required === "Yes",
        });
        if (state) setApprovalState(state);

        const record = await ensureLegalReviewForWinningSupplier(rfq, supplierForApproval, quote.sqName);
        award = { award: record.name!, supplier: record.supplier, quotation: record.sq_name };
      }

      if (!award?.award) throw new Error("The persisted supplier award is unavailable. The Contract decision was not recorded.");
      awardPersisted = true;
      setPendingAwardDecision(award);
      if (state) setApprovalState(state);

      // Persist audit trail for the selection decision
      const auditKey = `rfq_selection_audit_${rfq.name}`;
      const audit = {
        rfq: rfq.name,
        selected_supplier: supplierForApproval,
        supplier_quotation: quote.sqName,
        supplier_display_name: payload.supplierName,
        ai_rank: payload.aiRank,
        risk_level: payload.riskLevel,
        selection_reason: payload.reason,
        grand_total: quote.total,
        selected_by: user?.full_name ?? user?.email ?? "Procurement Manager",
        selected_by_email: user?.email ?? "",
        selected_at: new Date().toISOString(),
        ai_recommended: aiResult?.recommended_supplier ?? "",
        is_ai_top_pick: payload.aiRank === 1,
      };
      localStorage.setItem(auditKey, JSON.stringify(audit));
      // eslint-disable-next-line no-console
      console.log("[RFQ] Selection audit saved:", audit);

      void queryClient.invalidateQueries({ queryKey: ["clm"] });
      invalidateApprovalWorkflow(queryClient);
      void legalDocQuery.refetch();

      // Hand off to CLM Contract Request
      try {
        const handoff = await recordRfqAwardDecision({
          rfq: rfq.name,
          award_id: award.award,
          quotation_id: award.quotation,
          supplier_id: award.supplier,
          decision: (rfq.contract_required === "Yes" || rfq.contract_required === "No") ? rfq.contract_required : undefined,
        });
        setPendingAwardDecision(null);
        setClmErrorMessage(null);
        toast.dismiss("rfq-clm-decision-error");
        toast.dismiss("rfq-submit-for-review");
        void queryClient.invalidateQueries({ queryKey: ["clm"] });
        invalidateApprovalWorkflow(queryClient);
        void legalDocQuery.refetch();
        toast.success(
          handoff.summary.decision === "Yes"
            ? `${payload.supplierName} awarded. Contract Request ${handoff.request!.record.name} is pending with Procurement.`
            : `${payload.supplierName} awarded. No Contract required; the existing procurement workflow continues.`,
          { id: "rfq-award-success" }
        );
        setAiModalOpen(false);
      } catch (clmErr) {
        // Award was successfully persisted; CLM initial request handoff requires department verification
        const clmMsg = resolveApiErrorMessage(
          clmErr,
          "A single requesting Department is required for the initial Contract Request. Set the RFQ Department or verify its linked Material Request Department, then retry this saved RFQ."
        );
        setClmErrorMessage(clmMsg);
        toast.error(
          `Supplier award is saved, but its Contract decision could not be confirmed: ${clmMsg}`,
          { id: "rfq-clm-decision-error", duration: 8000 }
        );
        setAiModalOpen(false);
        // Do not re-throw clmErr here: the award succeeded, and closing the modal cleanly prevents stuck/stale UI.
      }
    } catch (err) {
      toast.error(
        `${awardPersisted ? "Supplier award is saved, but its Contract decision could not be confirmed. " : ""}${resolveApiErrorMessage(err, "The supplier award could not be saved. Keep this form open and retry.")}`,
        { id: "rfq-submit-for-review" },
      );
      throw err;
    } finally {
      setSubmittingForReview(false);
    }
  }

  async function handleRetryClmHandoff() {
    if (!rfq || !activeAwardDecision || retryingClm) return;
    setRetryingClm(true);
    try {
      const handoff = await recordRfqAwardDecision({
        rfq: rfq.name,
        award_id: activeAwardDecision.award,
        quotation_id: activeAwardDecision.quotation,
        supplier_id: activeAwardDecision.supplier,
        decision: (rfq.contract_required === "Yes" || rfq.contract_required === "No") ? rfq.contract_required : undefined,
      });
      setClmErrorMessage(null);
      setPendingAwardDecision(null);
      toast.dismiss("rfq-clm-decision-error");
      toast.dismiss("rfq-submit-for-review");
      void queryClient.invalidateQueries({ queryKey: ["clm"] });
      invalidateApprovalWorkflow(queryClient);
      void legalDocQuery.refetch();
      void rfqQuery.refetch();
      toast.success(
        handoff.summary.decision === "Yes"
          ? `${activeAwardDecision.supplier} awarded. Contract Request ${handoff.request!.record.name} is pending with Procurement.`
          : `${activeAwardDecision.supplier} awarded. No Contract required; the existing procurement workflow continues.`,
        { id: "rfq-award-success" }
      );
    } catch (err) {
      const msg = resolveApiErrorMessage(
        err,
        "A single requesting Department is required for the initial Contract Request. Set the RFQ Department or verify its linked Material Request Department, then retry this saved RFQ."
      );
      setClmErrorMessage(msg);
      toast.error(
        `Contract decision could not be confirmed: ${msg}`,
        { id: "rfq-clm-decision-error", duration: 8000 }
      );
    } finally {
      setRetryingClm(false);
    }
  }

  /**
   * Procurement chose to negotiate: create (or reuse) a Reverse Bidding event
   * from the manually selected AI-ranked suppliers and open the auction page.
   * This does NOT touch the Legal/Finance/PO path — the auction feeds into it
   * later via "Approve Winner".
   */
  async function handleStartReverseBidding(selectedRows: ReverseBiddingQuotationSelection[]) {
    if (!rfq || startingReverseBidding) return;
    setStartingReverseBidding(true);
    try {
      const selectedQuotations = validateReverseBiddingSelection(rfq.name, selectedRows, quotesQuery.data ?? []);
      selectedQuotations.forEach((selection) => assertEvaluatedSupplierEligible(selection));
      const approvedSuppliers = selectedQuotations.map((row) => row.supplier_id);
      if (import.meta.env.DEV) console.debug("[ReverseBidding] frontend selection", {
        rfq_id: rfq.name,
        selected_quotations: selectedQuotations.map((row) => ({
          ...row,
          supplier_name: (quotesQuery.data ?? []).find((quote) => quote.name === row.quotation_id)?.supplier_name,
        })),
        selected_supplier_ids: approvedSuppliers,
        selected_quotation_ids: selectedQuotations.map((row) => row.quotation_id),
        shortlisted_ids: approvedSuppliers,
      });
      const existing = await getReverseBiddingForRFQ(rfq.name);
      const rb = await createReverseBiddingFromRFQ({
        rfqName: rfq.name,
        approvedSuppliers,
        selectedQuotations,
        activeRoundName,
        procurementManager: user?.email,
      });
      if (existing?.name === rb.name) {
        toast(`Reverse auction already exists for ${rfq.name}.`, { icon: "ℹ️" });
      } else {
        toast.success(`Reverse auction ${rb.name} created with ${selectedQuotations.length} suppliers.`);
      }
      setAiModalOpen(false);
      navigate(`/sourcing/reverse-bidding/${encodeURIComponent(rb.name)}`);
    } catch (err) {
      toast.error(
        resolveApiErrorMessage(err, "Could not start reverse bidding."),
        { id: "rfq-reverse-bidding" },
      );
    } finally {
      setStartingReverseBidding(false);
    }
  }

  /* ─────────────── RFQ submit ─────────────── */

  async function handleSubmitRFQ() {
    if (!rfq) return;
    // eslint-disable-next-line no-console
    console.log("[RFQ] docstatus:", rfq.docstatus, "name:", rfq.name);

    setSubmittingRFQ(true);
    try {
      const submitted = await submitRfqWithContractConfirmation(rfq.name);
      toast.success(submitted.message);
    } catch (err) {
      toast.error(resolveApiErrorMessage(err, "Submit failed."), {
        id: "rfq-submit",
        duration: 8_000,
      });
    } finally {
      // ERPNext may have submitted the RFQ even if its subsequent CLM routing failed.
      void rfqQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["clm"] });
      setSubmittingRFQ(false);
    }
  }

  async function handleCreatePO() {
    if (!rfq || isCompleted) return;

    if (poExists) {
      toast.error("A Purchase Order already exists for this RFQ.");
      return;
    }
    try {
      const contract = await getRfqClmSummary(rfq.name);
      queryClient.setQueryData(["clm", "rfq-contract", rfqName, clmViewerKey()], contract);
      if (!contract.continuation_ready || contract.blocks_procurement) {
        toast.error(contract.decision === "Pending" ? "Save the Contract / CLM decision before creating a purchase order." : "Complete the required CLM execution before creating a purchase order.");
        return;
      }
      if (contract.contract?.name) {
        navigate(`/p2p/purchase-orders/new?${new URLSearchParams({ contract: contract.contract.name })}`);
        return;
      }
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, "Could not verify the RFQ Contract Requirement. Refresh and try again."));
      return;
    }

    // Authoritative gate: ERPNext's Legal Document Review is the single
    // source of truth for Legal/Finance approval — NOT the localStorage
    // `approvalState` cache. That cache can be empty (new browser/device,
    // or approvals recorded purely on the Legal Document Review record
    // without ever syncing back to RFQ custom fields), which previously
    // let this check be silently skipped (`if (currentState && ...)`) and
    // allowed a PO to be created with NO verification at all. Always
    // re-check the live ERPNext record before creating anything.
    let legalDoc: LegalDocumentSet | null;
    try {
      legalDoc = await getLegalDocsByRfq(rfq.name);
    } catch (err) {
      toast.error(
        `Could not verify Legal/Finance approval status: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
      return;
    }
    const isReadyForPO = isRfqReadyForPurchaseOrder(legalDoc);
    if (!legalDoc || !isReadyForPO) {
      toast.error(
        `PO creation requires completed Legal e-signatures, verified integrity, and Finance approval. Legal: ${
          legalDoc?.review_status ?? "Not submitted"
        }, Finance: ${legalDoc?.finance_status ?? "Not submitted"}.`
      );
      return;
    }

    if (!canManagePurchaseOrders(userRole)) {
      toast.error("Purchase Order creation is restricted to authorized roles.");
      return;
    }

    setCreatingPO(true);

    try {
      await assertNoPOForRFQ(rfq.name);

      // The approved Legal record identifies the awarded quotation, independently
      // of which supplier the AI recommended or which row is currently displayed.
      const sqsForRfq = await getSupplierQuotations(rfq.name, { activeRoundName });
      const winningSq = resolveRfqQuotationIdentity(rfq.name, {
        supplier_id: legalDoc.supplier,
        quotation_id: legalDoc.sq_name,
        rfq_id: legalDoc.rfq_name,
      }, sqsForRfq);
      const winner = findQuoteByIdentity({ supplier_id: winningSq.supplier, quotation_id: winningSq.name, rfq_id: rfq.name });
      assertEvaluatedSupplierEligible({ supplier_id: winningSq.supplier, quotation_id: winningSq.name, rfq_id: rfq.name }, false);

      const poTransactionDate = resolvePoTransactionDate();
      const rfqTransactionDateIso = formatERPNextDate(rfq.transaction_date);
      const rfqValidTillIso =
        formatERPNextDate(rfq.valid_till) ??
        formatERPNextDate(parsedMessage.validTill);

      const warehouse = await lookupDefaultWarehouse(COMPANY);
      // eslint-disable-next-line no-console
      console.log("[PO] Using warehouse:", warehouse);

      const poItems = (rfq.items ?? []).map((it) => {
        const cell = winner.byItem.get(it.item_code);
        const rate = cell?.unit_price ?? 0;
        const scheduleDate = resolvePoItemScheduleDate(
          it.schedule_date,
          poTransactionDate
        );
        return {
          item_code: it.item_code,
          item_name: it.item_name ?? it.item_code,
          description: it.description ?? it.item_name ?? it.item_code,
          qty: it.qty,
          uom: it.uom ?? "Nos",
          rate,
          amount: rate * it.qty,
          schedule_date: scheduleDate,
          warehouse,
          // Preserve MR lineage so engineering attachments resolve by reference.
          ...(it.material_request
            ? { material_request: it.material_request }
            : {}),
          ...(it.material_request_item
            ? { material_request_item: it.material_request_item }
            : {}),
          ...(winningSq?.name
            ? { supplier_quotation: winningSq.name }
            : {}),
        };
      });

      const poScheduleDate = resolvePoHeaderScheduleDate(
        poItems.map((item) => item.schedule_date),
        poTransactionDate
      );

      // eslint-disable-next-line no-console
      console.log("[PO] Selected supplier (display):", winner.supplier_name);
      // eslint-disable-next-line no-console
      console.log("[PO] ERPNext supplier ID:", winner.supplier);
      // eslint-disable-next-line no-console
      console.log("[PO] Supplier name:", winner.supplier_name);

      const poPayload = {
        supplier: winner.supplier,
        company: COMPANY,
        transaction_date: poTransactionDate,
        schedule_date: poScheduleDate,
        remarks: rfq.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items: poItems as any,
      };

      logRfqToPoDateContext({
        rfqName: rfq.name,
        rfqTransactionDateRaw: rfq.transaction_date,
        rfqTransactionDateIso,
        rfqValidTillIso,
        sqName: winningSq?.name,
        sqTransactionDateRaw: winningSq?.transaction_date,
        sqTransactionDateIso: winningSq?.transaction_date
          ? formatERPNextDate(winningSq.transaction_date)
          : null,
        poTransactionDateIso: poTransactionDate,
        poScheduleDateIso: poScheduleDate,
        payload: poPayload,
      });

      const po = await createPurchaseOrder(poPayload);

      logRfqToPoDateContext({
        rfqName: rfq.name,
        rfqTransactionDateRaw: rfq.transaction_date,
        rfqTransactionDateIso,
        rfqValidTillIso,
        sqName: winningSq?.name,
        sqTransactionDateRaw: winningSq?.transaction_date,
        sqTransactionDateIso: winningSq?.transaction_date
          ? formatERPNextDate(winningSq.transaction_date)
          : null,
        poTransactionDateIso: poTransactionDate,
        poScheduleDateIso: poScheduleDate,
        payload: poPayload,
        erpNextStored: {
          transaction_date: po.transaction_date,
          schedule_date: po.schedule_date,
        },
      });

      toast.success(`Purchase Order ${po.name} created!`);
      // eslint-disable-next-line no-console
      console.log("[PO] Created:", po.name, {
        sent: poTransactionDate,
        stored: po.transaction_date,
        storedDisplay: formatUsDisplayDate(po.transaction_date),
      });

      markPOCreated(rfqName);
      setApprovalState(getApprovalState(rfqName));

      setAiModalOpen(false);
      setAiResult(null);
      // Re-run the live ERPNext lookup so completion reflects the real PO.
      void queryClient.invalidateQueries({ queryKey: ["rfq-linked-pos", rfqName] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      // Refresh the dashboard's Procurement Cycle Time (and other analytics).
      void queryClient.invalidateQueries({ queryKey: ["procurement-analytics"] });
      invalidateApprovalWorkflow(queryClient);
      void legalDocQuery.refetch();

      setTimeout(() => {
        navigate(`/p2p/purchase-orders/${encodeURIComponent(po.name)}`);
      }, 1_500);
    } catch (err) {
      toast.error(resolveApiErrorMessage(err, "PO creation failed."), {
        id: "rfq-create-po",
        duration: 8_000,
      });
    } finally {
      setCreatingPO(false);
    }
  }

  /* ─────────────── Render ─────────────── */

  // Selection SSoT: local/ERP approval cache OR live Legal Document Review supplier.
  const resolvedSelectedSupplier =
    (approvalState?.selected_supplier ?? "").trim() ||
    (legalDoc?.supplier ?? "").trim() ||
    "";
  const hasSelectedSupplier = resolvedSelectedSupplier.length > 0;

  const activeAwardDecision: { award: string; supplier: string; quotation: string } | null =
    pendingAwardDecision ||
    (rfqClmQuery.data?.can_decide &&
    rfqClmQuery.data?.source?.award &&
    typeof rfqClmQuery.data.source.supplier === "string" &&
    typeof rfqClmQuery.data.source.quotation === "string"
      ? {
          award: String(rfqClmQuery.data.source.award),
          supplier: rfqClmQuery.data.source.supplier,
          quotation: rfqClmQuery.data.source.quotation,
        }
      : legalDoc?.name &&
        legalDoc.supplier &&
        legalDoc.sq_name &&
        (!rfqClmQuery.data?.decision || rfqClmQuery.data?.decision === "Pending") &&
        rfq?.contract_required === "Yes" &&
        !rfqClmQuery.data?.request
      ? {
          award: legalDoc.name,
          supplier: legalDoc.supplier,
          quotation: legalDoc.sq_name,
        }
      : null);

  const aiModals = (
    <>
      <AIInsightsErrorBoundary
        onRetry={() => {
          setAiError(null);
          setAiResult(null);
        }}
      >
        <AIAnalysisModal
          open={aiModalOpen}
          loading={aiLoading}
          loadingStep={aiLoadingStep}
          result={aiResult}
          error={aiError}
          quoteAmount={aiQuoteAmount}
          quotationCount={submittedQuoteCount}
          creatingPO={creatingPO || submittingForReview}
          hasApiKey={HAS_ANTHROPIC_KEY}
          poAlreadyExists={poExists || (hasSelectedSupplier && !activeAwardDecision)}
          chosenSupplier={hasSelectedSupplier && !activeAwardDecision ? resolvedSelectedSupplier : null}
          ctaLabel="Create Purchase Order"
          ctaLoadingLabel="Submitting for Review…"
          ctaDoneMessage={
            poExists
              ? "A purchase order has already been created for this RFQ."
              : hasSelectedSupplier && !activeAwardDecision
                ? `${resolvedSelectedSupplier} has been awarded this RFQ.`
                : undefined
          }
          onClose={closeAIModal}
          onRetry={isReadOnly ? () => {} : () => void runAIAnalysis()}
          onCreatePO={
            isReadOnly || aiNeedsRerun ? () => {} : createPOFromRecommendation
          }
          onSelectSupplier={
            isReadOnly || (hasSelectedSupplier && !activeAwardDecision) || aiNeedsRerun
              ? undefined
              : handleSelectAnySupplier
          }
          onStartReverseBidding={
            isReadOnly ||
            hasSelectedSupplier ||
            !canManageReverseBidding(userRole)
              ? undefined
              : handleStartReverseBidding
          }
          startingReverseBidding={startingReverseBidding}
        />
      </AIInsightsErrorBoundary>

      <AIInsightsErrorBoundary>
        <SupplierSelectionSummary
          open={summaryModalOpen && hasSelectedSupplier}
          rfqName={rfqName}
          selectedSupplier={resolvedSelectedSupplier}
          selectedAt={approvalState?.submitted_at ?? legalDoc?.submission_date ?? ""}
          selectedTotal={
            approvalState?.selected_supplier_total ?? legalDoc?.grand_total ?? 0
          }
          analysis={aiResult ?? savedAnalysis?.analysis ?? null}
          quoteAmount={aiQuoteAmount}
          workflowStep={approvalState?.workflow_step}
          onClose={() => setSummaryModalOpen(false)}
        />
      </AIInsightsErrorBoundary>
    </>
  );

  if (rfqQuery.isLoading) {
    return (
      <>
        {aiModals}
        <AppLoading variant="document" />
      </>
    );
  }

  if (rfqQuery.isError || !rfq) {
    return (
      <>
        {aiModals}
        <EnterpriseError
          error={rfqQuery.error ?? new Error("not found")}
          onRetry={() => void rfqQuery.refetch()}
          onBack={() => {
            window.location.assign("/sourcing/rfqs");
          }}
        />
      </>
    );
  }

  /* ── Command Center derived metrics ── */
  // A "No Quote" decline is an intentional response — it counts as Responded,
  // never as Pending. Quoted and declined suppliers are disjoint (a supplier
  // who declines never also submits a quotation).
  const supplierCount = (rfq.suppliers ?? []).length;
  const quotedCount = submittedQuoteCount;
  const respondedCount = Math.min(supplierCount, quotedCount + declinedCount);
  const awaitingCount = Math.max(0, supplierCount - respondedCount);
  const responseRate = supplierCount
    ? Math.round((respondedCount / supplierCount) * 100)
    : 0;
  const totalQty = (rfq.items ?? []).reduce((sum, it) => sum + (it.qty ?? 0), 0);
  const aiReady = submittedQuoteCount >= 2;

  const validTillDisplay = rfq.valid_till
    ? formatDate(rfq.valid_till)
    : parsedMessage.validTill
    ? formatDate(parsedMessage.validTill)
    : "—";

  const hasQuotations = respondedCount > 0;
  const copilotHasAnalysis = !!savedAnalysis && hasQuotations;
  const canReAnalyze = hasSelectedSupplier && !isCompleted;

  const rfqStatusLower = (rfq.status ?? "").trim().toLowerCase();
  const inviteBlockedAfterAward =
    hasSelectedSupplier ||
    procurementFinalized ||
    rfqStatusLower === "cancelled" ||
    rfqStatusLower === "closed" ||
    rfqStatusLower === "completed" ||
    rfq.docstatus === 2;
  const canInviteMoreSuppliers =
    !isReadOnly && !inviteBlockedAfterAward;

  const alreadyInvitedSupplierIds = new Set(
    (rfq.suppliers ?? []).map((s) => s.supplier.trim().toLowerCase()),
  );

  const pendingInvitationSupplierIds = getPendingInvitationSupplierIds(rfq.name);

  const rawValidTill =
    rfq.valid_till || parsedMessage.validTill || undefined;
  const isRfqExpired = rawValidTill
    ? (() => {
        const deadline = parseERPNextDateInput(rawValidTill);
        return deadline?.isValid()
          ? deadline.endOf("day").isBefore(dayjs())
          : false;
      })()
    : false;

  async function executeSupplierInvite(
    suppliers: InviteSupplierSelection[],
    extendDeadline: boolean,
  ) {
    if (!rfq || suppliers.length === 0) return;

    const newSuppliers = suppliers.filter(
      (s) => !alreadyInvitedSupplierIds.has(s.supplier.trim().toLowerCase()),
    );
    if (newSuppliers.length === 0) {
      toast.error("This supplier has already been invited to this RFQ.");
      return;
    }

    setInvitingSuppliers(true);
    try {
      let validTill = rawValidTill;
      if (extendDeadline) {
        const extended = isoDateOffset(14);
        await extendRfqDeadline(rfq.name, extended);
        validTill = extended;
      }

      const result = await inviteSuppliersToRfq({
        rfqName: rfq.name,
        newSuppliers,
        invitedBy: user?.email || user?.name || "Procurement",
        validTill,
      });

      if (copilotHasAnalysis || savedAnalysis) {
        markRfqAiStale(
          rfq.name,
          "Additional suppliers were invited after the last AI analysis.",
          "invite",
        );
        setAiStaleTick((t) => t + 1);
      }

      await queryClient.invalidateQueries({ queryKey: ["rfq", rfq.name] });
      setPendingInviteSuppliers([]);
      setExtendDeadlineOpen(false);

      const count = result.invited.length;
      toast.success(
        `${count} supplier${count === 1 ? "" : "s"} invited successfully.${
          result.rfq.docstatus !== 1
            ? " Submit the RFQ to publish invitations to the supplier portal."
            : ""
        }`,
      );
    } catch (err) {
      const msg = resolveApiErrorMessage(err, "Could not invite suppliers.");
      if (/already invited|already participating/i.test(msg)) {
        toast.error("This supplier has already been invited to this RFQ.", {
          id: "rfq-invite-suppliers",
        });
      } else {
        toast.error(msg, { id: "rfq-invite-suppliers", duration: 8_000 });
      }
    } finally {
      setInvitingSuppliers(false);
    }
  }

  function handleInviteSelection(suppliers: InviteSupplierSelection[]) {
    const newSuppliers = suppliers.filter(
      (s) => !alreadyInvitedSupplierIds.has(s.supplier.trim().toLowerCase()),
    );
    if (newSuppliers.length === 0) {
      toast.error("This supplier has already been invited to this RFQ.");
      return;
    }
    setPendingInviteSuppliers(newSuppliers);
    if (isRfqExpired) {
      setExtendDeadlineOpen(true);
      return;
    }
    void executeSupplierInvite(newSuppliers, false);
  }

  /**
   * "View Quotation" must stay hidden through RFQ Created → Suppliers
   * Responded → AI Analysis, and only appear once the RFQ workflow has
   * actually reached Supplier Selected or Purchase Order Created. Both
   * signals are backend-driven, not frontend-only: `hasSelectedSupplier`
   * reflects the RFQ's `custom_selected_supplier` field in ERPNext (synced
   * via `syncStateToErpNext`, restored on refresh via `getApprovalStateFromErp`),
   * and `procurementFinalized` is derived from a live Purchase Order query
   * against ERPNext (`getPOsForRFQ`) plus the RFQ's own `status` field.
   */
  const canViewQuotations = hasSelectedSupplier || procurementFinalized;

  const canCreateQuoteRound = canCreateRfqQuoteRound({
    hasSelectedSupplier,
    procurementFinalized,
    rfqCancelled:
      rfqStatusLower === "cancelled" ||
      rfq.docstatus === 2,
  });

  const nextRoundNumber =
    (activeQuoteRound?.round_number ??
      (roundsQuery.data?.length ?? 0)) + 1;

  async function handleCreateNextRound(input: {
    reasonCode: RfqRoundReasonCode;
    remarks: string;
    newSuppliers?: InviteSupplierSelection[];
  }) {
    if (!rfq || !canCreateQuoteRound || creatingRound) return;
    setCreatingRound(true);
    const toastId = "rfq-create-quote-round";
    const actor = user?.email || user?.name || "Procurement";
    const roundLabel = formatRfqRoundLabel(nextRoundNumber);
    try {
      if (input.newSuppliers && input.newSuppliers.length > 0 && isRfqExpired) {
        const extended = isoDateOffset(14);
        await extendRfqDeadline(rfq.name, extended);
      }

      const createResult = await createNextRfqQuoteRound({
        rfqName: rfq.name,
        reasonCode: input.reasonCode,
        remarks: input.remarks,
        createdBy: actor,
        associateSuppliers: input.newSuppliers?.map((s) => ({
          supplier: s.supplier,
          supplier_name: s.supplier_name,
        })),
        inviteSuppliers: input.newSuppliers?.map((s) => ({
          supplier: s.supplier,
          supplier_name: s.supplier_name,
        })),
      });
      const { round, invited, inviteWarning, emailWarning } = createResult;

      recordQuoteRoundCreated({
        rfqName: rfq.name,
        roundName: round.name,
        roundNumber: round.round_number || nextRoundNumber,
        reasonCode: input.reasonCode,
        remarks: input.remarks,
        user: actor,
      });

      const invitedSuppliers = invited ?? [];
      if (invitedSuppliers.length > 0) {
        recordQuoteRoundSupplierInvites({
          rfqName: rfq.name,
          roundName: round.name,
          roundNumber: round.round_number || nextRoundNumber,
          reasonCode: input.reasonCode,
          user: actor,
          suppliers: invitedSuppliers.map((s) => ({
            supplier: s.supplier,
            supplier_name: s.supplier_name || s.supplier,
          })),
          emailStatus:
            emailWarning
              ? "failed"
              : round.status === "Active"
                ? "sent"
                : "pending_submit",
        });
      }

      if (copilotHasAnalysis || savedAnalysis) {
        markRfqAiStale(
          rfq.name,
          "A new quote round was opened — re-run AI analysis on current quotations.",
          "quotation",
        );
        setAiStaleTick((t) => t + 1);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rfq", rfq.name] }),
        queryClient.invalidateQueries({ queryKey: ["rfq-quote-rounds", rfq.name] }),
        queryClient.invalidateQueries({ queryKey: ["rfq-quotes", rfq.name] }),
      ]);
      setRoundActivityTick((t) => t + 1);
      setCreateRoundOpen(false);

      const invitedCount = invitedSuppliers.length;
      toast.success(
        invitedCount > 0
          ? `Quote Round ${roundLabel} created successfully. ${invitedCount} supplier${
              invitedCount === 1 ? "" : "s"
            } invited.`
          : `Quote Round ${roundLabel} created successfully.`,
        { id: toastId },
      );

      const followUpWarning = inviteWarning || emailWarning;
      if (followUpWarning) {
        toast.error(followUpWarning, {
          id: `${toastId}-invite-warning`,
          duration: 10000,
        });
      }
    } catch (err) {
      const message =
        err instanceof RfqQuoteRoundApiError && err.message.trim()
          ? err.message.trim()
          : resolveApiErrorMessage(err, "Could not create quote round.");
      toast.error(message, { id: toastId, duration: 8000 });
    } finally {
      setCreatingRound(false);
    }
  }

  const handlePerformAnalysis = () => {
    if (isReadOnly) return;
    openAIAnalysis();
  };

  const handleViewAnalysis = () => {
    viewSavedAnalysis();
  };

  const handleReAnalyze = () => {
    if (isReadOnly || !canReAnalyze) return;
    openAIAnalysis();
  };

  // If a supplier has been selected, AI analysis is necessarily complete.
  // This is the single workflow-stage gate used by every visibility rule.
  const aiAnalysisDone = hasSelectedSupplier || copilotHasAnalysis;
  const aiConfidence = savedAnalysis?.confidence_score;

  /** Quotation comparison is ONLY allowed after AI analysis completes. */
  const canCompareQuotations =
    submittedQuoteCount > 0 && (aiAnalysisDone || procurementFinalized);

  /* ── AI Procurement Copilot card derived values ──
   * These read straight from the saved analysis (persists across refresh —
   * see `saveAnalysis` / `getLatestAnalysisSnapshot`) so the card never has
   * to wait on `hasSelectedSupplier` to show what the analysis produced. */
  const copilotRecommendedRow = copilotHasAnalysis && savedAnalysis
    ? findRecommendationWinner(savedAnalysis.analysis)
    : undefined;
  const copilotRiskLevel = copilotRecommendedRow
    ? supplierRiskLevel(copilotRecommendedRow)
    : null;
  const copilotSavings =
    copilotHasAnalysis && savedAnalysis?.analysis
      ? getSavingsPotential(savedAnalysis.analysis)
      : null;

  /**
   * Single source of truth for timeline / Status Center / AI gates / Create PO.
   * Sequentially gated — Legal/Finance/PO can never appear ahead of selection.
   */
  const linkedMaterialRequests = Array.from(
    new Set(
      (rfq.items ?? [])
        .map((i) => i.material_request)
        .filter((v): v is string => !!v && v.trim().length > 0)
    )
  );
  const materialRequestLabel =
    linkedMaterialRequests.length === 0
      ? "—"
      : linkedMaterialRequests.length === 1
        ? linkedMaterialRequests[0]
        : `${linkedMaterialRequests[0]} +${linkedMaterialRequests.length - 1} more`;

  const workflow = deriveRfqProcurementWorkflow({
    transactionDate: formatDate(rfq.transaction_date),
    documentStatus:
      rfq.docstatus === 1 ? "Submitted" : rfq.docstatus === 0 ? "Draft" : String(rfq.docstatus ?? "—"),
    rfqStatus: rfq.status ?? "Draft",
    hasMaterialRequest: true,
    materialRequestLabel,
    supplierCount,
    respondedCount,
    hasQuotations,
    hasAnalysis: copilotHasAnalysis,
    analysisConfidence: aiConfidence,
    recommendedSupplier: savedAnalysis?.recommended_supplier ?? null,
    selectedSupplier: resolvedSelectedSupplier || null,
    legalStatus: legalDoc?.review_status ?? "",
    legalSigned: !!legalDoc && isLegalReviewExecuted(legalDoc),
    legalWorkflowState: legalDoc?.workflow_state ?? null,
    financeStatus: legalDoc?.finance_status ?? "",
    legalApprovedBy: legalDoc?.approved_by,
    legalApprovedOn: legalDoc?.approved_on,
    financeApprovedBy: legalDoc?.finance_approved_by,
    financeApprovedOn: legalDoc?.finance_approved_on,
    poExists,
    poName: completionSummary.poName !== "—" ? completionSummary.poName : null,
    currentOwnerOverride: legalDoc?.current_owner,
    nextApproverOverride: legalDoc?.next_approver,
    contract: rfqClmQuery.isError ? null : rfqClmQuery.data ?? null,
  });

  const timeline: RfqWorkflowStep[] = (() => {
    const list = workflow.stages;
    if (!list.some((s) => s.active) && !list.every((s) => s.done)) {
      const firstPending = list.find((s) => !s.done);
      if (firstPending) {
        return list.map((s) =>
          s.id === firstPending.id ? { ...s, active: true, state: "current" as const } : s,
        );
      }
    }
    return list;
  })();
  const legalApproved = workflow.legalApproved;
  const financeApproved = workflow.financeApproved;
  const fullyApproved = legalApproved && financeApproved;
  // PO creation is owned by Procurement Team after Manager approval.
  const canCreatePO =
    workflow.canCreatePO &&
    (contractContinuationReady || isRfqReadyForPurchaseOrder(legalDoc)) &&
    canManagePurchaseOrders(userRole);

  const quoteTotals = Array.from(localQuotes.values())
    .map((q) => q.total)
    .filter(isSubmittedQuoteAmount);
  const allSuppliersResponded = supplierCount > 0 && awaitingCount === 0;
  const avgQuote =
    quoteTotals.length > 0
      ? quoteTotals.reduce((a, b) => a + b, 0) / quoteTotals.length
      : 0;
  const lowestQuote = quoteTotals.length > 0 ? Math.min(...quoteTotals) : 0;
  const highestQuote = quoteTotals.length > 0 ? Math.max(...quoteTotals) : 0;

  const rfqScheduleDates = (rfq.items ?? [])
    .map((it) => it.schedule_date)
    .filter((d): d is string => !!d && String(d).trim().length > 0);
  const expectedDelivery =
    rfqScheduleDates.length > 0
      ? formatDate(rfqScheduleDates.sort()[0])
      : validTillDisplay;
  const currencyLabel =
    (rfq as { currency?: string }).currency ||
    import.meta.env.VITE_DEFAULT_CURRENCY ||
    "USD";
  const deliveryLocation =
    (rfq as { shipping_address_name?: string; shipping_address?: string })
      .shipping_address_name ||
    (rfq as { shipping_address?: string }).shipping_address ||
    "—";
  const estimatedBudget = (rfq.items ?? []).reduce((sum, it) => {
    const rate = Number((it as { rate?: number; amount?: number }).rate ?? 0);
    const amount = Number((it as { amount?: number }).amount ?? 0);
    const qty = Number(it.qty ?? 0);
    return sum + (amount || rate * qty);
  }, 0);

  // ── RFQ Overview metadata (display-only, derived from the live RFQ) ──
  const rfqExtra = rfq as {
    department?: string;
    custom_department?: string;
    rfq_owner?: string;
    custom_rfq_owner?: string;
    custom_procurement_owner?: string;
    buyer?: string;
    custom_buyer?: string;
    assigned_to?: string;
    custom_assigned_to?: string;
  };
  const departmentLabel = rfqExtra.department || rfqExtra.custom_department || "—";
  const ownerLabel = formatRfqOwnerFromDoc({
    owner: rfq.owner,
    rfq_owner: rfqExtra.rfq_owner,
    custom_rfq_owner: rfqExtra.custom_rfq_owner,
    custom_procurement_owner: rfqExtra.custom_procurement_owner,
    buyer: rfqExtra.buyer,
    custom_buyer: rfqExtra.custom_buyer,
    assigned_to: rfqExtra.assigned_to,
    custom_assigned_to: rfqExtra.custom_assigned_to,
  });
  const companyLabel = rfq.company || COMPANY;

  const selectionReason =
    copilotRecommendedRow?.why_best_or_worst ||
    savedAnalysis?.analysis?.recommendation_summary ||
    savedAnalysis?.analysis?.reason ||
    null;

  const recommendedSupplierLabel = hasSelectedSupplier
    ? resolvedSelectedSupplier
    : copilotHasAnalysis
      ? savedAnalysis!.recommended_supplier
      : hasQuotations && aiReady
        ? "Ready to analyze"
        : "Not Available";

  const buyerLabel =
    rfqExtra.buyer ||
    rfqExtra.custom_buyer ||
    rfqExtra.assigned_to ||
    rfqExtra.custom_assigned_to ||
    "";

  const selectedQuote = resolvedSelectedSupplier
    ? quoteForSupplier(localQuotes, resolvedSelectedSupplier)
    : undefined;

  const buildRfqPdfData = (): RfqPdfData => {
    const awardValue =
      approvalState?.selected_supplier_total ??
      legalDoc?.grand_total ??
      selectedQuote?.total ??
      null;

    const rawValidTill = rfq.valid_till || parsedMessage.validTill || null;
    const rawDelivery =
      rfqScheduleDates.length > 0 ? rfqScheduleDates.sort()[0]! : rawValidTill;

    const approvals: RfqPdfData["approvals"] = [];
    if (hasSelectedSupplier && resolvedSelectedSupplier) {
      approvals.push({
        approver: ownerLabel || "Procurement",
        status: "Supplier Selected",
        date: approvalState?.submitted_at ?? legalDoc?.submission_date ?? null,
        remarks: resolvedSelectedSupplier,
      });
    }
    if (
      legalDoc?.review_status &&
      legalDoc.review_status !== "Pending"
    ) {
      approvals.push({
        approver: legalDoc.approved_by || "Legal Reviewer",
        status: legalDoc.review_status,
        date: legalDoc.approved_on ?? null,
        remarks:
          legalDoc.legal_comments || legalDoc.rejection_reason || null,
      });
    }
    if (
      legalDoc?.finance_status &&
      legalDoc.finance_status !== "Pending" &&
      (legalDoc.finance_status as string) !== ""
    ) {
      approvals.push({
        approver: legalDoc.finance_approved_by || "Finance Manager",
        status: legalDoc.finance_status,
        date: legalDoc.finance_approved_on ?? null,
        remarks:
          legalDoc.finance_comments ||
          legalDoc.finance_rejection_reason ||
          null,
      });
    }

    return {
      rfq_number: rfq.name,
      title: parsedMessage.title || rfq.name,
      status: isCompleted ? "Completed" : rfq.status || "Draft",
      company: companyLabel,
      department: departmentLabel !== "—" ? departmentLabel : null,
      buyer: buyerLabel || null,
      owner: ownerLabel,
      currency: currencyLabel,
      created_date: rfq.transaction_date || rfq.creation || null,
      valid_till: rawValidTill,
      material_request:
        materialRequestLabel !== "—" ? materialRequestLabel : null,
      selected_supplier: resolvedSelectedSupplier || null,
      award_value: awardValue && awardValue > 0 ? awardValue : null,
      delivery_date: rawDelivery,
      purchase_order_status: poExists
        ? "Created"
        : workflow.purchaseOrderStatus || null,
      purchase_order_name:
        completionSummary.poName !== "—" ? completionSummary.poName : null,
      items: (rfq.items ?? []).map((it) => {
        const cell = selectedQuote?.byItem.get(it.item_code);
        const rateFromItem = Number(
          (it as { rate?: number }).rate ?? NaN,
        );
        const unit_price = cell?.unit_price
          ?? (Number.isFinite(rateFromItem) ? rateFromItem : null);
        const qty = Number(it.qty ?? 0);
        const total =
          cell?.total ??
          (unit_price != null ? unit_price * qty : null);
        const target = getItemTargetPrice(it);
        const showLine = isItemTargetPriceVisibleToSupplier(it, rfq);
        return {
          item_code: it.item_code,
          item_name: it.item_name || it.item_code,
          qty,
          uom: it.uom || "Nos",
          unit_price,
          total,
          /* External PDFs only include Target Price when the line is flagged. */
          target_price: showLine ? target : null,
        };
      }),
      include_target_price:
        isTargetPriceVisibleToSupplier(rfq) ||
        (rfq.items ?? []).some((it) =>
          isItemTargetPriceVisibleToSupplier(it, rfq),
        ),
      ai: copilotHasAnalysis
        ? {
            recommended_supplier:
              savedAnalysis?.recommended_supplier || null,
            confidence: aiConfidence ?? null,
            summary: selectionReason,
            risk_level: copilotRiskLevel,
            savings:
              copilotSavings && copilotSavings.amount > 0
                ? copilotSavings.amount
                : null,
          }
        : null,
      approvals,
      terms: (rfq.terms || parsedMessage.body || "").trim() || null,
    };
  };

  const handleExportPdf = () => {
    void downloadRfqPdf(buildRfqPdfData()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[RFQ PDF]", err);
      toast.error("Unable to generate RFQ PDF.");
    });
  };

  const handlePrintPdf = () => {
    void printRfqPdf(buildRfqPdfData()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[RFQ PDF]", err);
      toast.error("Unable to print RFQ PDF.");
    });
  };

  return (
    <RFQDetailEnterpriseLayout
      rfq={rfq}
      isReadOnly={isReadOnly}
      isCompleted={isCompleted}
      companyLabel={companyLabel}
      departmentLabel={departmentLabel}
      ownerLabel={ownerLabel}
      materialRequestLabel={materialRequestLabel}
      validTillDisplay={validTillDisplay}
      currencyLabel={currencyLabel}
      expectedDelivery={expectedDelivery}
      deliveryLocation={deliveryLocation}
      estimatedBudget={estimatedBudget}
      totalQty={totalQty}
      workflow={workflow}
      timeline={timeline}
      supplierCount={supplierCount}
      quotedCount={quotedCount}
      respondedCount={respondedCount}
      declinedCount={declinedCount}
      awaitingCount={awaitingCount}
      responseRate={responseRate}
      lowestQuote={lowestQuote}
      avgQuote={avgQuote}
      highestQuote={highestQuote}
      allSuppliersResponded={allSuppliersResponded}
      hasSelectedSupplier={hasSelectedSupplier}
      resolvedSelectedSupplier={resolvedSelectedSupplier}
      selectedSupplierTotal={
        approvalState?.selected_supplier_total ?? legalDoc?.grand_total ?? 0
      }
      selectionReason={selectionReason}
      legalDoc={legalDoc}
      poExists={poExists}
      poName={completionSummary.poName !== "—" ? completionSummary.poName : null}
      fullyApproved={fullyApproved}
      canCreatePO={canCreatePO}
      procurementFinalized={procurementFinalized}
      copilotHasAnalysis={copilotHasAnalysis}
      aiConfidence={aiConfidence}
      copilotRiskLevel={copilotRiskLevel}
      copilotSavings={copilotSavings}
      recommendedSupplierLabel={recommendedSupplierLabel}
      aiReady={aiReady}
      aiLoading={aiLoading}
      aiButtonMode={workflow.aiButtonMode}
      hasQuotations={hasQuotations}
      hasAnthropicKey={HAS_ANTHROPIC_KEY}
      canCompareQuotations={canCompareQuotations}
      canViewQuotations={canViewQuotations}
      canInviteMoreSuppliers={canInviteMoreSuppliers}
      aiNeedsRerun={aiNeedsRerun}
      aiStaleSource={aiStaleSource}
      onRerunAiAnalysis={handlePerformAnalysis}
      showSubmitRFQ={showSubmitRFQ}
      submittingRFQ={submittingRFQ}
      creatingPO={creatingPO}
      localQuotes={localQuotes}
      declineBySupplier={declineBySupplier}
      supplierAnalysisRows={savedAnalysis?.analysis?.supplier_analysis ?? []}
      quotesQueryError={quotesQuery.isError}
      quotesQueryErrorMessage={supplierQuotesErrorMessage}
      onRetryQuotes={() => void quotesQuery.refetch()}
      onCheckBudget={() => setCheckBudgetOpen(true)}
      onSubmitRFQ={() => void handleSubmitRFQ()}
      onCompareQuotations={() => setCompareModalOpen(true)}
      onViewQuotation={(sq) => setViewQuotationSq(sq)}
      onViewDeclineReason={(d) => setReasonPopup(d)}
      onPerformAnalysis={handlePerformAnalysis}
      onViewAnalysis={handleViewAnalysis}
      onReAnalyze={handleReAnalyze}
      onCreatePO={() => void handleCreatePO()}
      onPrint={handlePrintPdf}
      onExportPdf={handleExportPdf}
      onInviteMoreSuppliers={() => setInviteDialogOpen(true)}
      pendingInvitationSupplierIds={pendingInvitationSupplierIds}
      resolveSupplierStatus={(s, hasQuote, validTill, hasDecline, pendingInvite) =>
        resolveSupplierStatus(
          s,
          hasQuote,
          validTill || parsedMessage.validTill || undefined,
          hasDecline,
          pendingInvite,
        )
      }
      supplierStatusTone={supplierStatusTone}
      quoteForSupplier={quoteForSupplier}

      quoteRoundsSlot={
        <div className="space-y-4">
          <RfqQuoteRoundsPanel
            rounds={roundsQuery.data ?? []}
            activeRoundName={activeRoundName}
            loading={roundsQuery.isLoading && !roundsQuery.data}
            errorMessage={quoteRoundsErrorMessage}
            onRetry={() => void roundsQuery.refetch()}
            canCreateRound={canCreateQuoteRound && !isReadOnly}
            createDisabledReason={
              hasSelectedSupplier
                ? "Award completed — new rounds are disabled."
                : procurementFinalized
                  ? "Procurement finalized — new rounds are disabled."
                  : undefined
            }
            creatingRound={creatingRound}
            newlyAddedByRound={newlyAddedByRound}
            onCreateRound={() => setCreateRoundOpen(true)}
          />
          <RfqRoundActivityTimeline entries={roundActivityEntries} />
        </div>
      }
      rejectionBanners={
        <>
          {!isReadOnly && (legalDoc?.review_status === "Rejected" ||
            legalDoc?.review_status === "Pending" && legalDoc.current_owner === "Procurement") && (
            <div className="mb-4 rounded-2xl border border-danger-200 bg-danger-50/60 px-4 py-3">
              <p className="mb-2 text-sm font-semibold text-danger-800">{legalDoc?.review_status === "Rejected" ? "Legal Rejected" : "Legal Changes Requested"}</p>
              {legalDoc?.legal_comments && <p className="mb-2 text-xs text-danger-700">{legalDoc.legal_comments}</p>}
              <p className="mb-3 text-xs text-danger-700">
                Edit the RFQ if needed, then resubmit for legal review.
              </p>
              <RejectedReviewActions
                rfqName={rfq.name}
                reviewType="legal"
                onResubmitted={() => {
                  invalidateApprovalWorkflow(queryClient);
                  void legalDocQuery.refetch();
                }}
              />
            </div>
          )}
          {!isReadOnly &&
            legalDoc?.review_status === "Approved" &&
            legalDoc.finance_status === "Rejected" && (
              <div className="mb-4 rounded-2xl border border-danger-200 bg-danger-50/60 px-4 py-3">
                <p className="mb-2 text-sm font-semibold text-danger-800">Finance Rejected</p>
                <p className="mb-3 text-xs text-danger-700">
                  Edit the RFQ if needed, then resubmit for finance review.
                </p>
                <RejectedReviewActions
                  rfqName={rfq.name}
                  reviewType="finance"
                  onResubmitted={() => {
                    invalidateApprovalWorkflow(queryClient);
                    void legalDocQuery.refetch();
                  }}
                />
              </div>
            )}
          {!isReadOnly && activeAwardDecision && rfq?.contract_required === "Yes" && !rfqClmQuery.data?.request && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <p className="mb-1 text-sm font-semibold text-amber-900">
                Supplier Award Saved — Contract Request Pending
              </p>
              <p className="mb-3 text-xs text-amber-800">
                {clmErrorMessage ||
                  "A single requesting Department is required for the initial Contract Request. Set the RFQ Department or verify its linked Material Request Department, then retry this saved RFQ."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={retryingClm}
                  onClick={handleRetryClmHandoff}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {retryingClm ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Retry Contract Request
                </button>
              </div>
            </div>
          )}
        </>
      }
      reverseBiddingSlot={
        !procurementFinalized &&
        hasQuotations &&
        aiReady &&
        aiAnalysisDone &&
        savedAnalysis &&
        canManageReverseBidding(userRole) ? (
          <ReverseBiddingCTA
            rfqName={rfq.name}
            approvedRows={(savedAnalysis.analysis.supplier_analysis ?? [])
              .filter((row) => getSupplierAwardEligibility(row).awardEligible)}
            activeRoundName={activeRoundName}
            procurementManager={user?.email}
            allowCreate={!hasSelectedSupplier && !aiNeedsRerun}
          />
        ) : null
      }
      legalRejectedActions={null}
      financeRejectedActions={null}
      checkBudgetModal={
        <CheckBudgetModal
          open={checkBudgetOpen}
          onClose={() => setCheckBudgetOpen(false)}
          onContinue={() => {
            setCheckBudgetOpen(false);
            void handleSubmitRFQ();
          }}
          rfqName={rfq.name}
          company={rfq.company ?? null}
          costCenter={(rfq as { cost_center?: string }).cost_center ?? null}
          fiscalYear={(rfq as { fiscal_year?: string }).fiscal_year ?? null}
          items={(rfq.items ?? []) as never}
        />
      }
      modals={
        <>
          {aiModals}
          {reasonPopup && (
            <div
              role="dialog"
              aria-modal="true"
              className="modal-overlay"
              onClick={() => setReasonPopup(null)}
            >
              <div
                className="modal-panel relative max-w-md p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-warning-50 text-warning-600">
                    <Ban className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-neutral-900">
                      Supplier Declined RFQ
                    </h2>
                    <p className="text-sm text-neutral-500">
                      {reasonPopup.supplier_name || reasonPopup.supplier}
                    </p>
                  </div>
                </div>
                <div className="mt-4 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                  <Row label="Supplier" value={reasonPopup.supplier_name || reasonPopup.supplier} />
                  <Row label="Reason" value={reasonPopup.decline_reason || "—"} />
                  {reasonPopup.reason_details ? (
                    <Row label="Details" value={reasonPopup.reason_details} />
                  ) : null}
                  <Row label="Comment" value={reasonPopup.comment || "—"} />
                  <Row
                    label="Submitted On"
                    value={
                      reasonPopup.response_date
                        ? formatDate(reasonPopup.response_date)
                        : "—"
                    }
                  />
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setReasonPopup(null)}
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          {viewQuotationSq && (
            <ViewQuotationModal
              sqName={viewQuotationSq}
              rfqName={rfqName}
              onClose={() => setViewQuotationSq(null)}
            />
          )}
          {compareModalOpen && (
            <CompareQuotationsModal
              rfqName={rfqName}
              items={(rfq?.items ?? []).map((it) => ({
                item_code: it.item_code,
                item_name: it.item_name,
                qty: it.qty,
                uom: it.uom,
                target_price: getItemTargetPrice(it),
              }))}
              quotes={Array.from(localQuotes.values())
                .filter((q) => q.sqName)
                .map<ComparisonQuote>((q) => ({
                  sqName: q.sqName,
                  supplier: q.supplier,
                  supplierName: q.supplier_name,
                  total: q.total,
                  priceStatus: q.priceStatus,
                  paymentTerms: q.payment_terms,
                  notes: q.notes,
                  byItem: q.byItem,
                }))}
              onViewQuotation={(sqName) => {
                setCompareModalOpen(false);
                setViewQuotationSq(sqName);
              }}
              canViewQuotation={canViewQuotations}
              onClose={() => setCompareModalOpen(false)}
            />
          )}
          <RfqInviteSuppliersDialog
            open={inviteDialogOpen}
            onClose={() => {
              if (invitingSuppliers) return;
              setInviteDialogOpen(false);
            }}
            alreadyInvited={alreadyInvitedSupplierIds}
            alreadyInvitedCount={alreadyInvitedSupplierIds.size}
            inviting={invitingSuppliers}
            onInvite={handleInviteSelection}
            procurementCategory={inviteProcurementCategory}
            commodity={inviteCommodity}
            itemGroups={inviteItemGroups}
          />
          <ExtendRfqDeadlineDialog
            open={extendDeadlineOpen}
            currentValidTill={validTillDisplay}
            busy={invitingSuppliers}
            onCancel={() => {
              if (invitingSuppliers) return;
              setExtendDeadlineOpen(false);
              setPendingInviteSuppliers([]);
            }}
            onInviteAnyway={() =>
              void executeSupplierInvite(pendingInviteSuppliers, false)
            }
            onExtendAndInvite={() =>
              void executeSupplierInvite(pendingInviteSuppliers, true)
            }
          />
          <CreateRfqRoundDialog
            open={createRoundOpen}
            nextRoundNumber={nextRoundNumber}
            creating={creatingRound}
            alreadyInvited={alreadyInvitedSupplierIds}
            alreadyInvitedCount={alreadyInvitedSupplierIds.size}
            procurementCategory={inviteProcurementCategory}
            commodity={inviteCommodity}
            itemGroups={inviteItemGroups}
            rfqName={rfq?.name}
            validTill={validTillDisplay}
            onClose={() => {
              if (creatingRound) return;
              setCreateRoundOpen(false);
            }}
            onSubmit={(input) => void handleCreateNextRound(input)}
          />
        </>
      }
    />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <span className="max-w-[65%] text-right text-sm text-neutral-800">
        {value}
      </span>
    </div>
  );
}

/* ── Reverse Bidding call-to-action (after AI evaluation) ───────────────── */

function ReverseBiddingCTA({
  rfqName,
  approvedRows,
  activeRoundName,
  procurementManager,
  allowCreate,
}: {
  rfqName: string;
  approvedRows: SupplierAnalysisRow[];
  activeRoundName?: string | null;
  procurementManager?: string;
  /** Once a supplier is selected, new auctions can no longer be created. */
  allowCreate: boolean;
}) {
  const navigate = useNavigate();

  const eligibleRows = approvedRows.filter((row) => getSupplierAwardEligibility(row).awardEligible &&
    isSubmittedQuoteAmount(row.grand_total) && reverseBiddingSelectionForRow(row));

  const existingQuery = useQuery({
    queryKey: ["reverse-bidding-for-rfq", rfqName],
    queryFn: () => getReverseBiddingForRFQ(rfqName),
    staleTime: 30_000,
  });
  const existing = existingQuery.data;

  // Hooks must run unconditionally — early return only after every hook below.
  const createMutation = useMutation({
    mutationFn: () => {
      if (eligibleRows.length < 2 || eligibleRows.length > 5) {
        throw new Error("Select 2–5 eligible suppliers in the AI report before starting reverse bidding.");
      }
      const selectedQuotations = selectedReverseBiddingQuotations(eligibleRows,
        new Set(eligibleRows.map((row) => row.quotation_id || row.supplier_quotation_id || "")));
      return createReverseBiddingFromRFQ({
        rfqName,
        approvedSuppliers: selectedQuotations.map((row) => row.supplier_id),
        selectedQuotations,
        activeRoundName,
        procurementManager,
      });
    },
    onSuccess: (rb) => {
      toast.success(`Reverse auction ${rb.name} created.`);
      navigate(`/sourcing/reverse-bidding/${encodeURIComponent(rb.name)}`);
    },
    onError: (e: unknown) =>
      toast.error(
        resolveApiErrorMessage(e, "Could not create reverse auction."),
        { id: "rfq-reverse-bidding-create" },
      ),
  });

  // After supplier selection, reverse bidding is locked. Keep the auction
  // visible for reference if it already exists; otherwise hide the section.
  if (!allowCreate && !existing) return null;

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-[#1F3A6D]/30 bg-[#1F3A6D]/5 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#1F3A6D]/15 text-[#1F3A6D]">
          <Activity className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-neutral-900">
            Reverse Bidding
          </p>
          <p className="text-xs leading-relaxed text-neutral-500">
            Invite the AI-shortlisted suppliers to a live reverse auction to
            drive the price down before creating a Purchase Order.
          </p>
        </div>
      </div>
      {existing ? (
        <button
          type="button"
          onClick={() =>
            navigate(
              `/sourcing/reverse-bidding/${encodeURIComponent(existing.name)}`
            )
          }
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#1F3A6D] bg-white px-4 py-2 text-sm font-semibold text-[#1F3A6D] shadow-sm transition hover:bg-[#1F3A6D]/5"
        >
          <Sparkles className="h-4 w-4" />
          View Reverse Auction
        </button>
      ) : (
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !allowCreate || eligibleRows.length < 2 || eligibleRows.length > 5}
          title={eligibleRows.length < 2 || eligibleRows.length > 5 ? "Select 2–5 eligible suppliers in the AI report." : undefined}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1F3A6D] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {createMutation.isPending ? "Creating…" : "Create Reverse Bidding"}
        </button>
      )}
    </div>
  );
}
