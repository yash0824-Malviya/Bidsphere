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
  Sparkles,
} from "lucide-react";

import {
  getRFQ,
  getSupplierQuotations,
  lookupDefaultWarehouse,
  submitRFQ,
  updateRFQ,
} from "../../api/sourcing";
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
  AI_FALLBACK_NOTICE,
  buildLocalProcurementRecommendation,
  computeConfidenceScore,
  resolveAIRecommendation,
} from "../../api/ai";
import type { AIQuotation, AIQuotationLine, AnalysisWeights } from "../../api/ai";
import type {
  AIRecommendation,
  RFQApprovalState,
  SupplierAnalysisRow,
} from "../../types/erpnext";
import { getScoringConfig } from "../../api/supplierScoring";
import { getSupplierPerformance } from "../../api/supplierPerformance";
import { scoreSuppliers } from "../../api/supplierScoringEngine";
import {
  getLatestAnalysisSnapshot,
  saveScoringResult,
} from "../../api/supplierScoringResults";
import {
  getApprovalState,
  submitForReview,
  canCreatePOFromWorkflow,
  markPOCreated,
} from "../../api/rfqApprovalWorkflow";
import {
  ensureLegalDocumentReviewForSelection,
  getLegalDocsByRfq,
} from "../../api/legalDocs";
import { getApprovalStateFromErp } from "../../api/legalReviews";
import type { LegalDocumentItemSummary, LegalDocumentSet } from "../../api/legalDocs";
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
import { deriveRfqProcurementWorkflow } from "../../api/rfqProcurementWorkflow";
import { invalidateApprovalWorkflow } from "../../api/approvalWorkflow";
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
import { formatDate, isoDateOffset } from "../../utils/format";
import RejectedReviewActions from "../../components/sourcing/RejectedReviewActions";
import CheckBudgetModal from "../../components/sourcing/CheckBudgetModal";
import ViewQuotationModal from "../../components/sourcing/ViewQuotationModal";
import CompareQuotationsModal, {
  type ComparisonQuote,
} from "../../components/sourcing/CompareQuotationsModal";
import RFQDetailEnterpriseLayout from "./rfq-detail/RFQDetailEnterpriseLayout";
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

const HAS_ANTHROPIC_KEY = !!(
  import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined
);

type RiskLevel = "Low" | "Medium" | "High";

/** Mirrors the risk heuristic used across the AI analysis UI (modal + summary). */
function supplierRiskLevel(s: SupplierAnalysisRow): RiskLevel {
  if (s.verdict === "AVOID") return "High";
  if (s.verdict === "EXPENSIVE") return "Medium";
  const rel = s.score?.reliability ?? 50;
  if (rel < 40 || (s.weaknesses ?? []).length >= 3) return "High";
  if (rel < 65 || s.verdict === "GOOD OPTION") return "Medium";
  return "Low";
}

/** Savings of the recommended supplier vs the highest bid among all quotes. */
function getSavingsPotential(analysis: AIRecommendation): {
  amount: number;
  pct: number;
} {
  const rows = analysis.supplier_analysis ?? [];
  const recommended = rows.find(
    (s) =>
      s.name.toLowerCase() === (analysis.recommended_supplier ?? "").trim().toLowerCase()
  );
  const totals = rows.map((s) => s.grand_total).filter((t) => t > 0);
  const highest = totals.length ? Math.max(...totals) : 0;
  const recommendedTotal = recommended?.grand_total ?? 0;
  const amount = highest > recommendedTotal ? highest - recommendedTotal : 0;
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
  recommended_supplier: string;
  confidence_score: number;
  analysis: AIRecommendation;
  quotations_snapshot: { supplier: string; grand_total: number }[];
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
    return record;
  } catch {
    return null;
  }
}

/**
 * Validates a cached analysis against the current RFQ's invited suppliers.
 * Returns the record (possibly filtered) if valid, or null if it should be
 * discarded and re-run.
 */
function validateCachedAnalysis(
  record: SavedAnalysisRecord | null,
  invitedSupplierIds: Set<string>
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
  if (invitedSupplierIds.size === 0) return record;

  const analysis = record.analysis;
  if (!analysis?.supplier_analysis?.length) return null;

  const beforeCount = analysis.supplier_analysis.length;
  analysis.supplier_analysis = analysis.supplier_analysis.filter((row) =>
    invitedSupplierIds.has(row.name.trim().toLowerCase())
  );

  if (analysis.supplier_analysis.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[AI Cache] Purging cached analysis for",
      record.rfq_name,
      "— none of the ranked suppliers are in the invited list"
    );
    localStorage.removeItem(analysisStorageKey(record.rfq_name));
    return null;
  }

  if (analysis.supplier_analysis.length < beforeCount) {
    // eslint-disable-next-line no-console
    console.warn(
      "[AI Cache] Removed",
      beforeCount - analysis.supplier_analysis.length,
      "non-invited supplier(s) from cached analysis"
    );
    // Re-rank sequentially
    analysis.supplier_analysis
      .sort((a, b) => a.rank - b.rank)
      .forEach((row, idx) => { row.rank = idx + 1; });
  }

  // Fix recommended_supplier if it's not in the invited set
  if (!invitedSupplierIds.has(record.recommended_supplier.trim().toLowerCase())) {
    const fallback = analysis.supplier_analysis[0]?.name ?? "";
    // eslint-disable-next-line no-console
    console.warn(
      "[AI Cache] recommended_supplier",
      record.recommended_supplier,
      "not in invited set — correcting to",
      fallback
    );
    record.recommended_supplier = fallback;
    analysis.recommended_supplier = fallback;
    record.confidence_score = analysis.confidence_score;
  }

  return record;
}

interface SubmittedQuote {
  /** Supplier Quotation docname — needed to open the "View Quotation" modal. */
  sqName: string;
  supplier: string;
  supplier_name: string;
  total: number;
  notes: string;
  payment_terms?: string;
  /**
   * Unit price, total and delivery_days per item_code. Stored locally so
   * the comparison table reflects in-flight submissions even before the
   * `getSupplierQuotations` query refetches.
   */
  byItem: Map<
    string,
    { unit_price: number; total: number; delivery_days: number }
  >;
}

/**
 * The Smart RFQ wizard embeds title/valid-till in `message_for_supplier`.
 * Parsed via `parseRfqMessage` from `utils/rfqMessage`.
 */

type SupplierQuoteStatus =
  | "Pending"
  | "Pending Invitation"
  | "Quotation Received"
  | "Declined"
  | "Expired";

function quoteForSupplier(
  localQuotes: Map<string, SubmittedQuote>,
  supplierId: string
): SubmittedQuote | undefined {
  for (const q of localQuotes.values()) {
    if (q.supplier === supplierId || q.supplier_name === supplierId) return q;
  }
  return localQuotes.get(supplierId);
}

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
  });
  const legalDoc = legalDocQuery.data;

  const rfqQuery = useQuery<RFQ>({
    queryKey: ["rfq", rfqName],
    enabled: !!rfqName,
    queryFn: () => getRFQ(rfqName),
  });

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
  const isCompleted = isRealPurchaseOrder;

  // Procurement is FINALIZED once any backend signal says the decision is done:
  // a real Purchase Order exists, the RFQ status is "Completed", or the approval
  // workflow reached "PO Created". When finalized, every procurement-decision
  // action (analysis, supplier selection, quote comparison, PO creation) is
  // hidden and the page becomes a read-only historical record. Driven entirely
  // by backend state — never hardcoded UI values.
  const procurementFinalized =
    poExists ||
    (rfq?.status ?? "").trim().toLowerCase() === "completed" ||
    approvalState?.workflow_step === "PO Created";

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

  // Hydrate `localQuotes` whenever the server-side query refreshes.
  useEffect(() => {
    if (!quotesQuery.data) return;
    setLocalQuotes((prev) => {
      const next = new Map(prev);
      for (const sq of quotesQuery.data) {
        const supplierName = sq.supplier_name ?? sq.supplier;
        const byItem = new Map<
          string,
          { unit_price: number; total: number; delivery_days: number }
        >();
        for (const it of sq.items ?? []) {
          byItem.set(it.item_code, {
            unit_price: it.rate ?? 0,
            total: it.amount ?? (it.rate ?? 0) * (it.qty ?? 0),
            delivery_days: it.delivery_days ?? 0,
          });
        }
        next.set(supplierName, {
          sqName: sq.name,
          supplier: sq.supplier,
          supplier_name: supplierName,
          total: sq.grand_total ?? sq.total ?? sumQuotation(sq),
          notes: sq.notes ?? "",
          payment_terms: (sq as unknown as Record<string, unknown>).terms as string | undefined,
          byItem,
        });
      }
      return next;
    });
  }, [quotesQuery.data]);

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
        .filter((q) => q.total > 0)
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
    // Cross-device fallback: this browser may never have run/cached the
    // analysis for this RFQ (e.g. it was generated on a different device).
    // ERPNext's `Supplier Scoring Result.analysis_snapshot` is the durable
    // source of truth — fetch it when the local cache is empty.
    if (!cached && rfqName) {
      getLatestAnalysisSnapshot<SavedAnalysisRecord>(rfqName)
        .then((snapshot) => {
          if (snapshot && isUsableAnalysis(snapshot)) setSavedAnalysis(snapshot);
        })
        .catch(() => {
          /* best-effort — analysis can always be re-run */
        });
    }
  }, [rfqName]);

  // Validate cached analysis against the actual invited suppliers once
  // the RFQ data is available — purge or filter stale results that
  // reference suppliers not invited to THIS RFQ.
  useEffect(() => {
    if (!rfq || invitedSupplierIds.size === 0 || !savedAnalysis) return;
    const validated = validateCachedAnalysis(
      structuredClone(savedAnalysis),
      invitedSupplierIds
    );
    if (validated !== savedAnalysis) {
      // eslint-disable-next-line no-console
      console.log(
        "[AI Cache] Validated cached analysis against invited suppliers:",
        validated ? "filtered" : "purged"
      );
      setSavedAnalysis(validated);
    }
  }, [rfq, invitedSupplierIds]); // eslint-disable-line react-hooks/exhaustive-deps

  function saveAnalysis(name: string, analysis: AIRecommendation): SavedAnalysisRecord {
    const record: SavedAnalysisRecord = {
      rfq_name: name,
      analysed_at: new Date().toISOString(),
      recommended_supplier: analysis.recommended_supplier,
      confidence_score: analysis.confidence_score,
      analysis,
      quotations_snapshot: Array.from(localQuotes.values())
        .filter((q) => {
          if (q.total <= 0) return false;
          if (invitedSupplierIds.size === 0) return true;
          const key = (q.supplier ?? q.supplier_name ?? "").trim().toLowerCase();
          return invitedSupplierIds.has(key);
        })
        .map((q) => ({ supplier: q.supplier_name, grand_total: q.total })),
    };
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
            .filter((q) => q.total > 0)
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
        setAiResult(savedAnalysis.analysis);
      }
      setSummaryModalOpen(true);
      return;
    }

    // Before supplier selection: open full AI modal with saved results
    if (!savedAnalysis) return;

    const validated = validateCachedAnalysis(
      structuredClone(savedAnalysis),
      invitedSupplierIds
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

  function findQuoteByName(name: string): SubmittedQuote | undefined {
    return quoteForSupplier(localQuotes, name);
  }

  /**
   * Real ERPNext Supplier Quotation record (has `.name` + legal-document
   * custom fields) for a supplier — unlike `SubmittedQuote`, which is a
   * locally-derived display object with no ERPNext document name.
   */
  function findRealSQForSupplier(supplierId: string): SupplierQuotation | undefined {
    return (quotesQuery.data ?? []).find(
      (q) => q.supplier === supplierId || q.supplier_name === supplierId
    );
  }

  /**
   * Ensures a "Legal Document Review" record exists for the winning
   * supplier the instant they're selected (RFQ workflow -> "Pending Legal
   * Review"). Never blocks or fails the selection flow itself —
   * `submitForReview()` has already succeeded by the time this runs, so any
   * failure here is logged and surfaced as a non-blocking toast only.
   */
  async function ensureLegalReviewForWinningSupplier(
    rfqForReview: RFQ,
    supplierForApproval: string
  ): Promise<void> {
    // eslint-disable-next-line no-console
    console.log("[LegalAudit] 1. Procurement selected supplier:", supplierForApproval);

    const sq = findRealSQForSupplier(supplierForApproval);
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
      toast.error(
        "Supplier selected, but no matching Supplier Quotation was found — the Legal Document Review was NOT created. Please notify Legal.",
        { duration: 10_000 }
      );
      return;
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
        grand_total: sq.grand_total ?? sq.total ?? 0,
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
      console.log(
        "[LegalAudit] 5. Legal Review Name:",
        (created as { name?: string })?.name ?? "(created, name not returned)"
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[LegalAudit] 5. Creation failed — complete ERP error:", err);
      toast.error(
        "Supplier selected, but the Legal Document Review record could not be created automatically. Please notify Legal.",
        { duration: 10_000 }
      );
    }
  }

  const aiQuoteAmount = useMemo(() => {
    if (!aiResult) return 0;
    const fromQuotes = findQuoteByName(aiResult.recommended_supplier)?.total;
    if (fromQuotes && fromQuotes > 0) return fromQuotes;
    const analysisRow = aiResult.supplier_analysis?.find(
      (r) => r.name.toLowerCase() === aiResult.recommended_supplier.toLowerCase()
    );
    return analysisRow?.grand_total ?? 0;
  }, [aiResult, localQuotes]);

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
    if ((comparison?.submittedCount ?? 0) < 2) {
      toast.error("Need at least 2 quotations for an AI recommendation.");
      return;
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

    /* ── Filter quotations: only invited + submitted ────────────────── */

    const eligibleQuotes: SubmittedQuote[] = [];
    for (const q of localQuotes.values()) {
      const key = (q.supplier ?? q.supplier_name ?? "").trim().toLowerCase();
      if (invitedSuppliers.has(key)) {
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
      toast.error(
        eligibleQuotes.length === 0
          ? "Waiting for supplier quotations from invited suppliers."
          : "Need at least 2 quotations from invited suppliers for AI analysis."
      );
      return;
    }

    /* ── Build AI request from eligible suppliers ONLY ───────────────── */

    const eligibleNameSet = new Set(
      eligibleQuotes.map((q) => q.supplier_name.trim().toLowerCase())
    );

    const aiRequest = {
      rfq_name: rfq.name,
      rfq_title: parsedMessage.title || rfq.name,
      items_requested: (rfq.items ?? []).map((it) => ({
        item: it.item_name ?? it.item_code,
        qty: it.qty,
        uom: it.uom,
      })),
      quotations: eligibleQuotes.map<AIQuotation>((q) => {
        const lines: AIQuotationLine[] = (rfq.items ?? []).map((it) => {
          const cell = q.byItem.get(it.item_code);
          return {
            item: it.item_name ?? it.item_code,
            requested_qty: it.qty,
            unit_price: cell?.unit_price ?? 0,
            total: cell?.total ?? 0,
            delivery_days: cell?.delivery_days ?? 7,
            notes: "",
          };
        });
        return {
          supplier_name: q.supplier_name,
          items: lines,
          total_value: q.total,
          payment_terms: q.payment_terms || undefined,
          notes: q.notes,
        };
      }),
    };

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
      const scoringConfig = await getScoringConfig();
      const analysisWeights: AnalysisWeights = {
        price: scoringConfig.price_weight,
        delivery: scoringConfig.delivery_weight,
        quality: scoringConfig.quality_weight,
        reliability: scoringConfig.reliability_weight,
      };

      // eslint-disable-next-line no-console
      console.log("AI Request", aiRequest);

      const supplierNames = aiRequest.quotations.map((q) => q.supplier_name);
      let historicalData;
      try {
        historicalData = await getSupplierPerformance(supplierNames);
        // eslint-disable-next-line no-console
        console.log("[AI] Historical performance data:", historicalData);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[AI] Could not fetch historical data, scoring with quotation data only:", err);
      }

      const targetPriceMap = new Map<string, number>();
      for (const it of rfq.items ?? []) {
        const t = getItemTargetPrice(it);
        if (t != null && t > 0) targetPriceMap.set(it.item_code, t);
      }
      const engineResult = scoreSuppliers(
        aiRequest.quotations,
        (rfq.items ?? []).length,
        {
          price_weight: scoringConfig.price_weight,
          delivery_weight: scoringConfig.delivery_weight,
          quality_weight: scoringConfig.quality_weight,
          reliability_weight: scoringConfig.reliability_weight,
        },
        historicalData,
        targetPriceMap.size > 0 ? targetPriceMap : undefined,
      );
      // eslint-disable-next-line no-console
      console.log("[SCORING ENGINE]", engineResult);

      let recommendation: AIRecommendation | null = null;

      const resolved = await resolveAIRecommendation(aiRequest, analysisWeights);
      if (resolved) {
        recommendation = resolved.recommendation;
      } else {
        recommendation = buildLocalProcurementRecommendation(aiRequest, engineResult);
        toast(AI_FALLBACK_NOTICE, { icon: "ℹ️", duration: 6_000 });
      }

      /* ── Post-validation: strip any supplier NOT in eligible set ─── */

      const beforeCount = recommendation.supplier_analysis.length;
      recommendation.supplier_analysis = recommendation.supplier_analysis.filter(
        (row) => eligibleNameSet.has(row.name.trim().toLowerCase())
      );
      if (recommendation.supplier_analysis.length < beforeCount) {
        // eslint-disable-next-line no-console
        console.warn(
          "[AI] Removed",
          beforeCount - recommendation.supplier_analysis.length,
          "non-eligible supplier(s) from ranking"
        );
      }

      recommendation.supplier_analysis
        .sort((a, b) => a.rank - b.rank)
        .forEach((row, idx) => { row.rank = idx + 1; });

      if (!eligibleNameSet.has(recommendation.recommended_supplier.trim().toLowerCase())) {
        recommendation.recommended_supplier =
          recommendation.supplier_analysis[0]?.name ??
          eligibleQuotes[0]?.supplier_name ??
          "";
      }

      // eslint-disable-next-line no-console
      console.log(
        "[AI] Final ranked suppliers:",
        recommendation.supplier_analysis.map((r) => `#${r.rank} ${r.name}`)
      );

      // Merge deterministic engine scores into supplier_analysis
      for (const scored of engineResult.suppliers) {
        const row = recommendation.supplier_analysis.find(
          (r) => r.name.toLowerCase() === scored.supplier.toLowerCase()
        );
        if (row) {
          row.score = {
            cost: scored.dimensions.price_score,
            delivery: scored.dimensions.delivery_score,
            reliability: scored.dimensions.reliability_score,
            overall: scored.final_score,
          };
          row.rank = scored.ranking;
          (row as unknown as Record<string, unknown>).score_sources = scored.score_sources;
          (row as unknown as Record<string, unknown>).has_sufficient_data = scored.has_sufficient_data;
          (row as unknown as Record<string, unknown>).confidence_level = scored.confidence_level;
        }
      }

      // Confidence Score (AI Procurement Copilot card) — always the fixed
      // Price 35% / Delivery 25% / Reliability 30% / Completeness 10%
      // formula applied to the recommended supplier's dimension scores, so
      // it never depends on whether the cloud AI provider echoed a usable
      // top-level confidence figure.
      const recommendedScored = engineResult.suppliers.find(
        (s) =>
          s.supplier.trim().toLowerCase() ===
          recommendation.recommended_supplier.trim().toLowerCase()
      );
      if (recommendedScored) {
        recommendation.confidence_score = computeConfidenceScore({
          price_score: recommendedScored.dimensions.price_score,
          delivery_score: recommendedScored.dimensions.delivery_score,
          reliability_score: recommendedScored.dimensions.reliability_score,
          completeness_score: recommendedScored.dimensions.quality_score,
        });
      }

      setAiResult(recommendation);
      const analysisRecord = saveAnalysis(rfq.name, recommendation);
      setAiLoadingStep(ANALYSIS_STEPS.length - 1);
      setAiError(null);

      saveScoringResult(rfq.name, engineResult, analysisRecord).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[SCORING] Failed to persist results:", err);
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[AI Analysis] Unexpected error:", err);

      // Never block procurement — always attempt local engine as last resort
      try {
        const scoringConfig = await getScoringConfig();
        const targetPriceMap = new Map<string, number>();
        for (const it of rfq.items ?? []) {
          const t = getItemTargetPrice(it);
          if (t != null && t > 0) targetPriceMap.set(it.item_code, t);
        }
        const engineResult = scoreSuppliers(
          aiRequest.quotations,
          (rfq.items ?? []).length,
          {
            price_weight: scoringConfig.price_weight,
            delivery_weight: scoringConfig.delivery_weight,
            quality_weight: scoringConfig.quality_weight,
            reliability_weight: scoringConfig.reliability_weight,
          },
          undefined,
          targetPriceMap.size > 0 ? targetPriceMap : undefined,
        );
        const localRec = buildLocalProcurementRecommendation(aiRequest, engineResult);
        const recommendedScored = engineResult.suppliers.find(
          (s) =>
            s.supplier.trim().toLowerCase() ===
            localRec.recommended_supplier.trim().toLowerCase()
        );
        if (recommendedScored) {
          localRec.confidence_score = computeConfidenceScore({
            price_score: recommendedScored.dimensions.price_score,
            delivery_score: recommendedScored.dimensions.delivery_score,
            reliability_score: recommendedScored.dimensions.reliability_score,
            completeness_score: recommendedScored.dimensions.quality_score,
          });
        }
        setAiResult(localRec);
        setAiError(null);
        saveAnalysis(rfq.name, localRec);
        toast(AI_FALLBACK_NOTICE, { icon: "ℹ️", duration: 6_000 });
      } catch (localErr) {
        // eslint-disable-next-line no-console
        console.error("[AI Analysis] Local fallback also failed:", localErr);
        const fallbackMsg = resolveApiErrorMessage(
          localErr,
          AI_FALLBACK_NOTICE,
        );
        setAiError(fallbackMsg);
        toast(AI_FALLBACK_NOTICE, { icon: "ℹ️", duration: 6_000, id: "rfq-ai-fallback" });
      }
    } finally {
      if (aiStepIntervalRef.current) {
        clearInterval(aiStepIntervalRef.current);
        aiStepIntervalRef.current = null;
      }
      setAiLoading(false);
    }
  }

  async function handleConfirmAndSendForReview() {
    if (!aiResult || !rfq) return;

    const existing = getApprovalState(rfqName);
    if (existing && canCreatePOFromWorkflow(existing, poExists)) {
      void handleCreatePO(aiResult.recommended_supplier);
      return;
    }

    setSubmittingForReview(true);
    try {
      const supplier = aiResult.recommended_supplier;
      const quote = findQuoteByName(supplier);
      // Use the ERPNext supplier document ID from the quotation record.
      // The AI returns a display name which may not match the ERPNext link ID.
      const supplierForApproval = quote?.supplier ?? supplier;
      // eslint-disable-next-line no-console
      console.log("[RFQ] submitForReview — AI recommended:", supplier, "| ERPNext ID:", supplierForApproval);
      const state = await submitForReview({
        rfqName: rfq.name,
        rfqTitle: parsedMessage.title || rfq.name,
        company: rfq.company ?? "",
        selectedSupplier: supplierForApproval,
        selectedSupplierTotal: quote?.total ?? 0,
        rfqValue: quote?.total ?? 0,
        submittedBy: user?.email ?? "procurement@netlink.com",
      });
      setApprovalState(state);
      await ensureLegalReviewForWinningSupplier(rfq, supplierForApproval);
      invalidateApprovalWorkflow(queryClient);
      void legalDocQuery.refetch();
      toast.success("Supplier selection confirmed — sent for Legal & Finance review.");
      setAiModalOpen(false);
    } catch (err) {
      toast.error(
        resolveApiErrorMessage(err, "Failed to submit for review."),
        { id: "rfq-submit-for-review" },
      );
    } finally {
      setSubmittingForReview(false);
    }
  }

  function createPOFromRecommendation() {
    if (!aiResult) return;
    // Prefer live LDR gate (same as Generate PO) over legacy localStorage check.
    const ldrReady =
      legalDoc?.review_status === "Approved" &&
      legalDoc?.finance_status === "Approved" &&
      !poExists;
    if (ldrReady || canCreatePOFromWorkflow(getApprovalState(rfqName), poExists)) {
      void handleCreatePO(aiResult.recommended_supplier);
    } else {
      void handleConfirmAndSendForReview();
    }
  }

  async function handleSelectAnySupplier(payload: SupplierSelectionPayload) {
    if (!rfq) return;

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

    const quote = findQuoteByName(payload.supplierName);
    const supplierForApproval = quote?.supplier ?? payload.supplierName;

    setSubmittingForReview(true);
    try {
      const state = await submitForReview({
        rfqName: rfq.name,
        rfqTitle: parsedMessage.title || rfq.name,
        company: rfq.company ?? "",
        selectedSupplier: supplierForApproval,
        selectedSupplierTotal: payload.grandTotal,
        rfqValue: payload.grandTotal,
        submittedBy: user?.email ?? "procurement@netlink.com",
      });

      // Persist audit trail for the selection decision
      const auditKey = `rfq_selection_audit_${rfq.name}`;
      const audit = {
        rfq: rfq.name,
        selected_supplier: supplierForApproval,
        supplier_display_name: payload.supplierName,
        ai_rank: payload.aiRank,
        risk_level: payload.riskLevel,
        selection_reason: payload.reason,
        grand_total: payload.grandTotal,
        selected_by: user?.full_name ?? user?.email ?? "Procurement Manager",
        selected_by_email: user?.email ?? "",
        selected_at: new Date().toISOString(),
        ai_recommended: aiResult?.recommended_supplier ?? "",
        is_ai_top_pick: payload.aiRank === 1,
      };
      localStorage.setItem(auditKey, JSON.stringify(audit));
      // eslint-disable-next-line no-console
      console.log("[RFQ] Selection audit saved:", audit);

      setApprovalState(state);
      await ensureLegalReviewForWinningSupplier(rfq, supplierForApproval);
      invalidateApprovalWorkflow(queryClient);
      void legalDocQuery.refetch();
      toast.success(
        `${payload.supplierName} selected — sent for Legal & Finance review.`
      );
      setAiModalOpen(false);
    } catch (err) {
      toast.error(
        resolveApiErrorMessage(err, "Failed to submit for review."),
        { id: "rfq-submit-for-review" },
      );
    } finally {
      setSubmittingForReview(false);
    }
  }

  /**
   * Procurement chose to negotiate: create (or reuse) a Reverse Bidding event
   * from the manually selected AI-ranked suppliers and open the auction page.
   * This does NOT touch the Legal/Finance/PO path — the auction feeds into it
   * later via "Approve Winner".
   */
  async function handleStartReverseBidding(supplierNames: string[]) {
    if (!rfq || startingReverseBidding) return;
    setStartingReverseBidding(true);
    try {
      const existing = await getReverseBiddingForRFQ(rfq.name);
      if (existing) {
        toast(`Reverse auction already exists for ${rfq.name}.`, { icon: "ℹ️" });
        setAiModalOpen(false);
        navigate(
          `/sourcing/reverse-bidding/${encodeURIComponent(existing.name)}`
        );
        return;
      }
      const rb = await createReverseBiddingFromRFQ({
        rfqName: rfq.name,
        approvedSuppliers: supplierNames,
        procurementManager: user?.email,
      });
      toast.success(
        `Reverse auction ${rb.name} created with ${supplierNames.length} suppliers.`
      );
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
      await submitRFQ(rfq.name);
      toast.success(`RFQ ${rfq.name} submitted — suppliers can now respond.`);
      // Refetch so docstatus + status reflect the new Submitted state.
      void rfqQuery.refetch();
    } catch (err) {
      toast.error(resolveApiErrorMessage(err, "Submit failed."), {
        id: "rfq-submit",
        duration: 8_000,
      });
    } finally {
      setSubmittingRFQ(false);
    }
  }

  async function handleCreatePO(supplierName: string) {
    if (!rfq || isCompleted) return;

    if (poExists) {
      toast.error("A Purchase Order already exists for this RFQ.");
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
    const isReadyForPO =
      legalDoc?.review_status === "Approved" &&
      legalDoc?.finance_status === "Approved";
    if (!isReadyForPO) {
      toast.error(
        `PO creation requires both Legal and Finance approval. Legal: ${
          legalDoc?.review_status ?? "Not submitted"
        }, Finance: ${legalDoc?.finance_status ?? "Not submitted"}.`
      );
      return;
    }

    const winner = findQuoteByName(supplierName);
    if (!winner) {
      toast.error(`No saved quotation for ${supplierName}.`);
      return;
    }

    setCreatingPO(true);

    try {
      await assertNoPOForRFQ(rfq.name);

      const poTransactionDate = resolvePoTransactionDate();
      const rfqTransactionDateIso = formatERPNextDate(rfq.transaction_date);
      const rfqValidTillIso =
        formatERPNextDate(rfq.valid_till) ??
        formatERPNextDate(parsedMessage.validTill);

      const warehouse = await lookupDefaultWarehouse(COMPANY);
      // eslint-disable-next-line no-console
      console.log("[PO] Using warehouse:", warehouse);

      const sqsForRfq = await getSupplierQuotations(rfq.name);
      const winningSq = sqsForRfq.find(
        (sq) =>
          sq.supplier === winner.supplier ||
          sq.supplier_name === winner.supplier_name
      );

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
      console.log("[PO] Selected supplier (display):", supplierName);
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
          poAlreadyExists={poExists || hasSelectedSupplier}
          chosenSupplier={hasSelectedSupplier ? resolvedSelectedSupplier : null}
          ctaLabel="Create Purchase Order"
          ctaLoadingLabel="Submitting for Review…"
          ctaDoneMessage={
            poExists
              ? "A purchase order has already been created for this RFQ."
              : hasSelectedSupplier
                ? `${resolvedSelectedSupplier} has been awarded this RFQ.`
                : undefined
          }
          onClose={closeAIModal}
          onRetry={isReadOnly ? () => {} : () => void runAIAnalysis()}
          onCreatePO={
            isReadOnly || aiNeedsRerun ? () => {} : createPOFromRecommendation
          }
          onSelectSupplier={
            isReadOnly || hasSelectedSupplier || aiNeedsRerun
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
  const copilotRecommendedRow = copilotHasAnalysis
    ? (savedAnalysis?.analysis?.supplier_analysis ?? []).find(
        (s) =>
          s.name.toLowerCase() ===
          (savedAnalysis?.recommended_supplier ?? "").trim().toLowerCase()
      )
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
    financeStatus: legalDoc?.finance_status ?? "",
    legalApprovedBy: legalDoc?.approved_by,
    legalApprovedOn: legalDoc?.approved_on,
    financeApprovedBy: legalDoc?.finance_approved_by,
    financeApprovedOn: legalDoc?.finance_approved_on,
    poExists,
    poName: completionSummary.poName !== "—" ? completionSummary.poName : null,
    currentOwnerOverride: legalDoc?.current_owner,
    nextApproverOverride: legalDoc?.next_approver,
  });

  const timeline = workflow.stages;
  const legalApproved = workflow.legalApproved;
  const financeApproved = workflow.financeApproved;
  const fullyApproved = legalApproved && financeApproved;
  // PO creation is owned by Procurement Team after Manager approval.
  const canCreatePO =
    workflow.canCreatePO && canManagePurchaseOrders(userRole);

  const quoteTotals = Array.from(localQuotes.values())
    .map((q) => q.total)
    .filter((t) => t > 0);
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
      legalDoc.finance_status !== ""
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
      onCreatePO={() => void handleCreatePO(resolvedSelectedSupplier)}
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
          {!isReadOnly && legalDoc?.review_status === "Rejected" && (
            <div className="mb-4 rounded-2xl border border-danger-200 bg-danger-50/60 px-4 py-3">
              <p className="mb-2 text-sm font-semibold text-danger-800">Legal Rejected</p>
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
            approvedSuppliers={(savedAnalysis.analysis.supplier_analysis ?? [])
              .filter((r) => r.verdict !== "AVOID")
              .map((r) => r.name)}
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

/* ==========================================================================
 * Utilities
 * ========================================================================== */

function sumQuotation(sq: SupplierQuotation): number {
  return (sq.items ?? []).reduce(
    (s, it) => s + (it.amount ?? (it.rate ?? 0) * (it.qty ?? 0)),
    0
  );
}

/* ── Reverse Bidding call-to-action (after AI evaluation) ───────────────── */

function ReverseBiddingCTA({
  rfqName,
  approvedSuppliers,
  procurementManager,
  allowCreate,
}: {
  rfqName: string;
  approvedSuppliers: string[];
  procurementManager?: string;
  /** Once a supplier is selected, new auctions can no longer be created. */
  allowCreate: boolean;
}) {
  const navigate = useNavigate();

  const existingQuery = useQuery({
    queryKey: ["reverse-bidding-for-rfq", rfqName],
    queryFn: () => getReverseBiddingForRFQ(rfqName),
    staleTime: 30_000,
  });
  const existing = existingQuery.data;

  // Hooks must run unconditionally — early return only after every hook below.
  const createMutation = useMutation({
    mutationFn: () =>
      createReverseBiddingFromRFQ({
        rfqName,
        approvedSuppliers,
        procurementManager,
      }),
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
          disabled={createMutation.isPending || !allowCreate}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1F3A6D] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {createMutation.isPending ? "Creating…" : "Create Reverse Bidding"}
        </button>
      )}
    </div>
  );
}
