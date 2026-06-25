import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Activity,
  ArrowLeft,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Gavel,
  Info,
  Layers,
  Loader2,
  Scale,
  Send,
  ShoppingCart,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

import {
  getRFQ,
  getSupplierQuotations,
  lookupDefaultWarehouse,
  submitRFQ,
} from "../../api/sourcing";
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
  resolveAIRecommendation,
} from "../../api/ai";
import type { AIQuotation, AIQuotationLine, AnalysisWeights } from "../../api/ai";
import type { AIRecommendation, RFQApprovalState } from "../../types/erpnext";
import { getScoringConfig } from "../../api/supplierScoring";
import { getSupplierPerformance } from "../../api/supplierPerformance";
import { scoreSuppliers } from "../../api/supplierScoringEngine";
import { saveScoringResult } from "../../api/supplierScoringResults";
import {
  getApprovalState,
  submitForReview,
  canCreatePOFromWorkflow,
  markPOCreated,
} from "../../api/rfqApprovalWorkflow";
import { ANALYSIS_STEPS } from "../../components/aiAnalysisSteps";
import AIAnalysisModal, {
  type SupplierSelectionPayload,
} from "../../components/AIAnalysisModal";
import AIInsightsErrorBoundary from "../../components/AIInsightsErrorBoundary";
import SupplierSelectionSummary from "../../components/SupplierSelectionSummary";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { useAuthStore } from "../../store/authStore";
import { canManageRFQs } from "../../config/roles";
import type { RFQ, RFQSupplier, SupplierQuotation } from "../../types/erpnext";
import { formatCurrency, formatDate } from "../../utils/format";
import { readRFQCreationMeta } from "../../api/rfqCreationMeta";
import RFQCreationSummaryCard from "../../components/sourcing/RFQCreationSummaryCard";
import RejectedReviewActions from "../../components/sourcing/RejectedReviewActions";
import {
  formatERPNextDate,
  formatUsDisplayDate,
  logRfqToPoDateContext,
  parseERPNextDateInput,
  resolvePoHeaderScheduleDate,
  resolvePoItemScheduleDate,
  resolvePoTransactionDate,
} from "../../utils/erpNextDate";
import dayjs from "dayjs";

const HAS_ANTHROPIC_KEY = !!(
  import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined
);

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
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
  if (!record || invitedSupplierIds.size === 0) return record;

  const analysis = record.analysis;
  if (!analysis?.supplier_analysis?.length) return record;

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
 * The Smart RFQ wizard embeds the title and valid-till hint as the first
 * lines of `message_for_supplier` because those fields are not part of the
 * ERPNext Request for Quotation schema. This helper parses them back out
 * so the detail page can display them.
 *
 * Recognised format:
 *
 *   Title: <free text>
 *   Valid Till: <YYYY-MM-DD or human-readable date>
 *
 *   <body>
 */
function parseRfqMessage(message: string | undefined | null): {
  title?: string;
  validTill?: string;
  body: string;
} {
  if (!message) return { body: "" };

  const lines = message.split(/\r?\n/);
  let title: string | undefined;
  let validTill: string | undefined;
  let firstBodyLine = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      // blank line — body starts after this
      firstBodyLine = i + 1;
      break;
    }
    const titleMatch = trimmed.match(/^Title\s*:\s*(.+)$/i);
    if (titleMatch && !title) {
      title = titleMatch[1].trim();
      firstBodyLine = i + 1;
      continue;
    }
    const validMatch = trimmed.match(/^Valid\s*Till\s*:\s*(.+)$/i);
    if (validMatch && !validTill) {
      const rawValidTill = validMatch[1].trim();
      validTill = formatERPNextDate(rawValidTill) ?? rawValidTill;
      firstBodyLine = i + 1;
      continue;
    }
    // First non-meta line — bail out and treat the rest as body.
    if (!title && !validTill) {
      firstBodyLine = i;
    }
    break;
  }

  return {
    title,
    validTill,
    body: lines.slice(firstBodyLine).join("\n").trim(),
  };
}

type SupplierQuoteStatus =
  | "Pending"
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
  validTill?: string
): SupplierQuoteStatus {
  if (hasQuote || row.quote_status === "Received") return "Quotation Received";
  if (row.quote_status === "No Quote") return "Declined";
  if (validTill) {
    const deadline = parseERPNextDateInput(validTill);
    if (deadline?.isValid()) {
      const end = deadline.endOf("day");
      if (end.isBefore(dayjs())) return "Expired";
    }
  }
  return "Pending";
}

function supplierStatusTone(
  status: SupplierQuoteStatus
): "warning" | "success" | "danger" | "neutral" {
  switch (status) {
    case "Quotation Received":
      return "success";
    case "Declined":
      return "danger";
    case "Expired":
      return "neutral";
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
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [aiResult, setAiResult] = useState<AIRecommendation | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingStep, setAiLoadingStep] = useState(0);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiStepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [creatingPO, setCreatingPO] = useState(false);
  const [savedAnalysis, setSavedAnalysis] = useState<SavedAnalysisRecord | null>(
    () => readSavedAnalysis(rfqName)
  );

  useEffect(() => {
    setApprovalState(getApprovalState(rfqName));
  }, [rfqName]);

  const rfqQuery = useQuery<RFQ>({
    queryKey: ["rfq", rfqName],
    enabled: !!rfqName,
    queryFn: () => getRFQ(rfqName),
  });

  const quotesQuery = useQuery<SupplierQuotation[]>({
    queryKey: ["rfq-quotes", rfqName],
    enabled: !!rfqName,
    queryFn: () => getSupplierQuotations(rfqName),
  });

  const rfq = rfqQuery.data;
  const parsedMessage = useMemo(
    () => parseRfqMessage(rfq?.message_for_supplier),
    [rfq?.message_for_supplier]
  );

  const creationMeta = useMemo(
    () => (rfqName ? readRFQCreationMeta(rfqName) : null),
    [rfqName]
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
  });
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
    !poExists &&
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

  /* ─────────────── Saved AI analysis (localStorage) ─────────────── */

  // Re-hydrate the persisted analysis whenever the RFQ changes.
  useEffect(() => {
    setSavedAnalysis(readSavedAnalysis(rfqName));
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

  function saveAnalysis(name: string, analysis: AIRecommendation) {
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
      }
    } catch {
      /* ignore storage quota / serialization errors */
    }
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

    const invitedSuppliers = new Set(
      (rfq.suppliers ?? []).map(
        (s: { supplier?: string; supplier_name?: string }) =>
          (s.supplier ?? s.supplier_name ?? "").trim().toLowerCase()
      )
    );

    // eslint-disable-next-line no-console
    console.log("[AI] Invited suppliers:", [...invitedSuppliers]);

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

      const engineResult = scoreSuppliers(
        aiRequest.quotations,
        (rfq.items ?? []).length,
        {
          price_weight: scoringConfig.price_weight,
          delivery_weight: scoringConfig.delivery_weight,
          quality_weight: scoringConfig.quality_weight,
          reliability_weight: scoringConfig.reliability_weight,
        },
        historicalData
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

      setAiResult(recommendation);
      saveAnalysis(rfq.name, recommendation);
      setAiLoadingStep(ANALYSIS_STEPS.length - 1);
      setAiError(null);

      saveScoringResult(rfq.name, engineResult).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[SCORING] Failed to persist results:", err);
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[AI Analysis] Unexpected error:", err);

      // Never block procurement — always attempt local engine as last resort
      try {
        const scoringConfig = await getScoringConfig();
        const engineResult = scoreSuppliers(
          aiRequest.quotations,
          (rfq.items ?? []).length,
          {
            price_weight: scoringConfig.price_weight,
            delivery_weight: scoringConfig.delivery_weight,
            quality_weight: scoringConfig.quality_weight,
            reliability_weight: scoringConfig.reliability_weight,
          }
        );
        const localRec = buildLocalProcurementRecommendation(aiRequest, engineResult);
        setAiResult(localRec);
        setAiError(null);
        saveAnalysis(rfq.name, localRec);
        toast(AI_FALLBACK_NOTICE, { icon: "ℹ️", duration: 6_000 });
      } catch (localErr) {
        // eslint-disable-next-line no-console
        console.error("[AI Analysis] Local fallback also failed:", localErr);
        setAiError(AI_FALLBACK_NOTICE);
        toast(AI_FALLBACK_NOTICE, { icon: "ℹ️", duration: 6_000 });
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
      toast.success("Supplier selection confirmed — sent for Legal & Finance review.");
      setAiModalOpen(false);
    } catch (err) {
      toast.error(
        `Failed to submit for review: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setSubmittingForReview(false);
    }
  }

  function createPOFromRecommendation() {
    if (!aiResult) return;
    const existing = getApprovalState(rfqName);
    if (existing && canCreatePOFromWorkflow(existing, poExists)) {
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
      toast.success(
        `${payload.supplierName} selected — sent for Legal & Finance review.`
      );
      setAiModalOpen(false);
    } catch (err) {
      toast.error(
        `Failed to submit for review: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setSubmittingForReview(false);
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
      toast.error(
        `Submit failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { duration: 8_000 }
      );
    } finally {
      setSubmittingRFQ(false);
    }
  }

  async function handleCreatePO(supplierName: string) {
    if (!rfq || isCompleted) return;

    const currentState = getApprovalState(rfqName);
    if (currentState && !canCreatePOFromWorkflow(currentState, poExists)) {
      toast.error("PO creation requires both Legal and Finance approval.");
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

      setTimeout(() => {
        navigate(`/p2p/purchase-orders/${encodeURIComponent(po.name)}`);
      }, 1_500);
    } catch (err) {
      toast.error(
        `PO creation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { duration: 8_000 }
      );
    } finally {
      setCreatingPO(false);
    }
  }

  /* ─────────────── Render ─────────────── */

  const hasSelectedSupplier = !!approvalState?.selected_supplier;

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
          chosenSupplier={
            hasSelectedSupplier ? approvalState?.selected_supplier ?? null : null
          }
          ctaLabel="Select Supplier"
          ctaLoadingLabel="Submitting for Review…"
          ctaDoneMessage={
            poExists
              ? "A purchase order has already been created for this RFQ."
              : hasSelectedSupplier
                ? `${approvalState?.selected_supplier ?? "Supplier"} has been awarded this RFQ.`
                : undefined
          }
          onClose={closeAIModal}
          onRetry={isReadOnly ? () => {} : () => void runAIAnalysis()}
          onCreatePO={isReadOnly ? () => {} : createPOFromRecommendation}
          onSelectSupplier={
            isReadOnly || hasSelectedSupplier ? undefined : handleSelectAnySupplier
          }
        />
      </AIInsightsErrorBoundary>

      <AIInsightsErrorBoundary>
        <SupplierSelectionSummary
          open={summaryModalOpen && hasSelectedSupplier}
          rfqName={rfqName}
          selectedSupplier={approvalState?.selected_supplier ?? ""}
          selectedAt={approvalState?.submitted_at ?? ""}
          selectedTotal={approvalState?.selected_supplier_total ?? 0}
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
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (rfqQuery.isError || !rfq) {
    return (
      <>
        {aiModals}
        <div>
          <BackLink />
          <ErrorState
            icon={FileText}
            title="RFQ not found"
            description="It may have been deleted, or you may not have access."
            onRetry={() => rfqQuery.refetch()}
          />
        </div>
      </>
    );
  }

  /* ── Command Center derived metrics ── */
  const supplierCount = (rfq.suppliers ?? []).length;
  const respondedCount = submittedQuoteCount;
  const awaitingCount = Math.max(0, supplierCount - respondedCount);
  const responseRate = supplierCount
    ? Math.round((respondedCount / supplierCount) * 100)
    : 0;
  const totalQty = (rfq.items ?? []).reduce((sum, it) => sum + (it.qty ?? 0), 0);
  const uomCount = new Set((rfq.items ?? []).map((it) => it.uom ?? "Nos")).size;
  const aiReady = submittedQuoteCount >= 2;

  const validTillDisplay = rfq.valid_till
    ? formatDate(rfq.valid_till)
    : parsedMessage.validTill
    ? formatDate(parsedMessage.validTill)
    : "—";

  const hasQuotations = respondedCount > 0;
  const copilotHasAnalysis = !!savedAnalysis && hasQuotations;
  const canReAnalyze = hasSelectedSupplier && !isCompleted;

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

  const legalApproved = approvalState?.legal_status === "Approved";
  const financeApproved = approvalState?.finance_status === "Budget Approved";
  const fullyApproved = legalApproved && financeApproved;

  // If a supplier has been selected, AI analysis is necessarily complete
  const aiAnalysisDone = hasSelectedSupplier || copilotHasAnalysis;
  const aiConfidence = savedAnalysis?.confidence_score;

  const timeline: { label: string; meta: string; done: boolean; active: boolean }[] = [
    {
      label: "RFQ Created",
      meta: formatDate(rfq.transaction_date),
      done: true,
      active: false,
    },
    {
      label: "Suppliers Responded",
      meta: hasQuotations ? `${respondedCount} of ${supplierCount}` : "Awaiting responses",
      done: hasQuotations,
      active: !hasQuotations,
    },
    {
      label: "AI Analysis",
      meta: aiAnalysisDone
        ? aiConfidence != null
          ? `Confidence ${clampScore(aiConfidence)}%`
          : "Completed"
        : "Pending",
      done: aiAnalysisDone,
      active: hasQuotations && !aiAnalysisDone,
    },
    {
      label: "Supplier Selected",
      meta: hasSelectedSupplier ? approvalState!.selected_supplier : "Pending",
      done: hasSelectedSupplier,
      active: aiAnalysisDone && !hasSelectedSupplier,
    },
    {
      label: "Legal Review",
      meta: legalApproved
        ? "Approved"
        : hasSelectedSupplier
          ? approvalState!.legal_status
          : "Pending",
      done: legalApproved,
      active: hasSelectedSupplier && !legalApproved,
    },
    {
      label: "Finance Review",
      meta: financeApproved
        ? "Budget Approved"
        : hasSelectedSupplier
          ? approvalState!.finance_status
          : "Pending",
      done: financeApproved,
      active: legalApproved && !financeApproved,
    },
    {
      label: "Purchase Order",
      meta: isCompleted
        ? completionSummary.poName
        : fullyApproved
          ? "Ready to create"
          : "Pending",
      done: isCompleted,
      active: fullyApproved && !isCompleted,
    },
  ];

  const currentStage = timeline.find((s) => s.active)?.label ?? (isCompleted ? "Completed" : "RFQ Created");

  return (
    <div>
      {isReadOnly && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm text-primary-700">
          <Info className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium">Read-only view — Legal Reviewer access. Use Legal Reviews to approve or reject.</span>
        </div>
      )}

      {/* ── Approval Workflow Progress Tracker ── */}
      {approvalState && !isReadOnly && (
        <ApprovalWorkflowTracker
          state={approvalState}
          poExists={poExists}
          fullyApproved={fullyApproved}
        />
      )}

      <RfqDetailHeader
        title={parsedMessage.title || rfq.name}
        rfqName={rfq.name}
        isCompleted={isCompleted}
        status={rfq.status ?? "Draft"}
        actions={
          showSubmitRFQ ? (
            <button
              type="button"
              onClick={() => void handleSubmitRFQ()}
              disabled={submittingRFQ}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submittingRFQ ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Submit RFQ
                </>
              )}
            </button>
          ) : undefined
        }
      />

      {creationMeta && (
        <RFQCreationSummaryCard meta={creationMeta} className="mb-4" />
      )}

      {!isReadOnly && approvalState?.legal_status === "Rejected" && (
        <div className="mb-4 rounded-xl border border-danger-200 bg-danger-50/60 px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-danger-800">Legal Rejected</p>
          <p className="mb-3 text-xs text-danger-700">
            Edit the RFQ if needed, then resubmit for legal review.
          </p>
          <RejectedReviewActions
            rfqName={rfq.name}
            reviewType="legal"
            onResubmitted={() => setApprovalState(getApprovalState(rfq.name))}
          />
        </div>
      )}

      {!isReadOnly &&
        approvalState?.legal_status === "Approved" &&
        approvalState.finance_status === "Rejected" && (
          <div className="mb-4 rounded-xl border border-danger-200 bg-danger-50/60 px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-danger-800">Finance Rejected</p>
            <p className="mb-3 text-xs text-danger-700">
              Edit the RFQ if needed, then resubmit for finance review.
            </p>
            <RejectedReviewActions
              rfqName={rfq.name}
              reviewType="finance"
              onResubmitted={() => setApprovalState(getApprovalState(rfq.name))}
            />
          </div>
        )}

      {/* ── Procurement Command Center ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Row 1 · Document Details */}
        <CommandCard icon={FileText} title="Document Details">
          <div className="divide-y divide-neutral-100">
            <KeyRow label="RFQ Number" value={rfq.name} mono strong />
            <KeyRow label="Issued Date" value={formatDate(rfq.transaction_date)} />
            <KeyRow label="Valid Till" value={validTillDisplay} />
            <KeyRow label="Company" value={COMPANY} />
          </div>
        </CommandCard>

        {/* Row 1 · Requested Items Summary */}
        <CommandCard
          icon={Layers}
          title="Requested Items Summary"
          badge={<Pill tone="brand">{rfq.items?.length ?? 0} items</Pill>}
        >
          <div className="grid grid-cols-3 gap-2">
            <MiniStat value={rfq.items?.length ?? 0} label="Line Items" />
            <MiniStat value={totalQty} label="Total Qty" />
            <MiniStat value={uomCount} label="UOMs" />
          </div>
        </CommandCard>

        {/* Row 1 · RFQ Status Center */}
        <CommandCard icon={Activity} title="RFQ Status Center">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500">Current Status</span>
              <StatusBadge status={rfq.status ?? "Draft"} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500">Document State</span>
              <Pill tone={rfq.docstatus === 1 ? "brand" : "neutral"}>
                {rfq.docstatus === 1 ? "Submitted" : "Draft"}
              </Pill>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500">Procurement</span>
              {isCompleted ? (
                <Pill tone="success">
                  <CheckCircle2 className="h-3 w-3" />
                  PO Created
                </Pill>
              ) : (
                <Pill tone="amber">In Progress</Pill>
              )}
            </div>
          </div>
        </CommandCard>

        {/* Row 2 · RFQ Status */}
        <CommandCard icon={Clock} title="RFQ Status">
          <div className="mb-3 flex items-center justify-between rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Current Stage</span>
            <span className="text-xs font-bold text-primary-700">{currentStage}</span>
          </div>
          <ol>
            {timeline.map((step, i) => (
              <TimelineStep
                key={step.label}
                label={step.label}
                meta={step.meta}
                done={step.done}
                active={step.active}
                last={i === timeline.length - 1}
              />
            ))}
          </ol>
        </CommandCard>

        {/* Row 2 · Supplier Response Summary (neutral — no winner/ranking) */}
        <CommandCard
          icon={Users}
          title="Supplier Response Summary"
          badge={<Pill tone="brand">{supplierCount} invited</Pill>}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat value={respondedCount} label="Responded" />
              <MiniStat value={awaitingCount} label="Awaiting" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-500">
                <span>Response rate</span>
                <span className="font-semibold text-neutral-700">
                  {responseRate}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-[#0ea5e9] transition-all"
                  style={{ width: `${responseRate}%` }}
                />
              </div>
            </div>
          </div>
        </CommandCard>

        {/* Row 2 · AI Procurement Copilot */}
        <CommandCard
          icon={Bot}
          title="AI Procurement Copilot"
          tone="ai"
          badge={
            hasSelectedSupplier ? (
              <Pill tone="success">Complete</Pill>
            ) : hasQuotations && aiReady ? (
              <Pill tone="brand">Ready</Pill>
            ) : (
              <Pill tone="amber">Pending</Pill>
            )
          }
        >
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500">Confidence Score</span>
              <span className="text-sm font-bold text-neutral-900">
                {hasSelectedSupplier && copilotHasAnalysis
                  ? `${savedAnalysis!.confidence_score}%`
                  : "—"}
              </span>
            </div>
            {hasSelectedSupplier && copilotHasAnalysis && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-[#0ea5e9]"
                  style={{ width: `${savedAnalysis!.confidence_score}%` }}
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500">Supplier Coverage</span>
              <span className="text-sm font-bold text-neutral-900">
                {hasQuotations ? `${respondedCount}/${supplierCount}` : `0/${supplierCount}`}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500">Recommendation</span>
              <Pill
                tone={
                  hasSelectedSupplier ? "success" : hasQuotations && aiReady ? "brand" : "amber"
                }
              >
                {hasSelectedSupplier
                  ? approvalState!.selected_supplier
                  : hasQuotations && aiReady
                  ? "Ready to analyze"
                  : "Not Available"}
              </Pill>
            </div>

            {/* ── AI Action Buttons ── */}
            {hasSelectedSupplier ? (
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={handleViewAnalysis}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
                >
                  <Sparkles className="h-4 w-4" />
                  View Analysis
                </button>
                {!isReadOnly && canReAnalyze && (
                  <button
                    type="button"
                    onClick={handleReAnalyze}
                    disabled={aiLoading}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {aiLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Activity className="h-4 w-4" />
                    )}
                    {aiLoading ? "Analyzing…" : "Re-Analyze"}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handlePerformAnalysis}
                disabled={!aiReady || aiLoading || isReadOnly}
                className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Perform AI Analysis
                  </>
                )}
              </button>
            )}
            {!hasQuotations && !hasSelectedSupplier && (
              <p className="text-center text-[11px] text-neutral-400">
                AI Analysis will be available after supplier quotations are submitted.
              </p>
            )}
            {hasQuotations && !HAS_ANTHROPIC_KEY && !hasSelectedSupplier && (
              <p className="text-center text-[11px] text-neutral-400">
                AI key not configured — local quotation comparison will be used.
              </p>
            )}
            {hasQuotations && HAS_ANTHROPIC_KEY && !aiReady && !hasSelectedSupplier && (
              <p className="text-center text-[11px] text-neutral-400">
                Need at least 2 quotations.
              </p>
            )}
          </div>
        </CommandCard>
      </div>

      {/* Items requested */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-[#0ea5e9]/5 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#0ea5e9]/10 text-[#0ea5e9]">
              <ShoppingCart className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-semibold text-neutral-900">
              Items Requested
            </h3>
          </div>
          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-[#0ea5e9] ring-1 ring-inset ring-[#0ea5e9]/20">
            {rfq.items?.length ?? 0} item
            {(rfq.items?.length ?? 0) === 1 ? "" : "s"}
          </span>
        </div>
        {(rfq.items ?? []).length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No items"
            description="This RFQ has no line items."
          />
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  <th className="border-b border-neutral-200 bg-neutral-50 px-5 py-3">
                    Item
                  </th>
                  <th className="hidden border-b border-neutral-200 bg-neutral-50 px-5 py-3 sm:table-cell">
                    Description
                  </th>
                  <th className="border-b border-neutral-200 bg-neutral-50 px-5 py-3 text-right">
                    Qty
                  </th>
                  <th className="border-b border-neutral-200 bg-neutral-50 px-5 py-3 text-right">
                    UOM
                  </th>
                </tr>
              </thead>
              <tbody>
                {(rfq.items ?? []).map((it) => (
                  <tr
                    key={it.name}
                    className="transition-colors hover:bg-[#0ea5e9]/[0.04]"
                  >
                    <td className="border-b border-neutral-100 px-5 py-3.5 align-top">
                      <div className="font-medium text-neutral-900">
                        {it.item_name ?? it.item_code}
                      </div>
                      {it.item_code &&
                        it.item_name &&
                        it.item_code !== it.item_name && (
                          <div className="mt-0.5 font-mono text-xs text-neutral-400">
                            {it.item_code}
                          </div>
                        )}
                      {it.description && (
                        <div className="mt-1 text-xs leading-relaxed text-neutral-500 sm:hidden">
                          {it.description}
                        </div>
                      )}
                    </td>
                    <td className="hidden border-b border-neutral-100 px-5 py-3.5 align-top text-neutral-600 sm:table-cell">
                      {it.description ?? "—"}
                    </td>
                    <td className="border-b border-neutral-100 px-5 py-3.5 text-right align-top font-semibold tabular-nums text-neutral-900">
                      {it.qty}
                    </td>
                    <td className="border-b border-neutral-100 px-5 py-3.5 text-right align-top text-neutral-600">
                      {it.uom ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Suppliers — portal responses only (buyer monitors, no manual entry) */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-[#0ea5e9]/5 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#0ea5e9]/10 text-[#0ea5e9]">
              <Building2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-neutral-900">
                Suppliers Invited
              </h3>
              <p className="text-xs text-neutral-500">
                {isCompleted
                  ? "Supplier quotations received for this RFQ. Procurement is complete."
                  : "Monitor supplier response status. Quotations are submitted via the Supplier Portal."}
              </p>
            </div>
          </div>
          <span className="flex-shrink-0 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-[#0ea5e9] ring-1 ring-inset ring-[#0ea5e9]/20">
            {(rfq.suppliers ?? []).length} invited
          </span>
        </div>

        {!isCompleted && (
          <div className="mx-4 mt-3 flex gap-2.5 rounded-lg border border-[#0ea5e9]/20 bg-[#0ea5e9]/5 px-3.5 py-2.5">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#0ea5e9]" />
            <p className="text-sm leading-relaxed text-neutral-700">
              Suppliers will submit quotations through the Supplier Portal.
              Pricing remains hidden until AI analysis is performed.
            </p>
          </div>
        )}

        <ul className="space-y-2 px-4 py-3">
          {(rfq.suppliers ?? []).map((s) => {
            const quote = quoteForSupplier(localQuotes, s.supplier);
            const validTill =
              rfq.valid_till ?? parsedMessage.validTill ?? undefined;
            const status = resolveSupplierStatus(s, !!quote, validTill);
            const itemsQuoted = quote
              ? (rfq.items ?? []).filter((it) => {
                  const cell = quote.byItem.get(it.item_code);
                  return cell && cell.unit_price > 0;
                }).length
              : 0;

            // Neutral list — submission status only. No quote amounts, no
            // ranking or winner/runner-up indicators. Procurement decisions are
            // shown exclusively in the AI Procurement Decision section after a PO.
            return (
              <li key={s.name} data-supplier={s.supplier}>
                <div className="flex flex-col gap-2.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-3 shadow-sm transition-colors hover:border-neutral-300 sm:flex-row sm:items-center sm:justify-between">
                  {/* Identity */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-neutral-500 ring-1 ring-inset ring-neutral-200">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900">
                        {s.supplier}
                      </p>
                      <p className="inline-flex items-center gap-1 text-xs text-neutral-500">
                        {quote ? (
                          <>
                            <FileText className="h-3 w-3" />
                            {itemsQuoted} item{itemsQuoted === 1 ? "" : "s"} submitted
                          </>
                        ) : (
                          "Awaiting quotation"
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Neutral submission status — no ranking, no amounts */}
                  <div className="flex items-center sm:justify-end">
                    {quote ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-semibold text-success-600 ring-1 ring-inset ring-success-100">
                        <CheckCircle2 className="h-3 w-3" />
                        Quotation Submitted
                      </span>
                    ) : (
                      <StatusBadge
                        status={status}
                        tone={supplierStatusTone(status)}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {aiModals}
    </div>
  );
}

/* ============================================================================
 * Helper components
 * ========================================================================== */

function BackLink() {
  return (
    <Link
      to="/sourcing/rfq"
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to RFQs
    </Link>
  );
}

/**
 * Redesigned RFQ detail header: back link, RFQ title + name, status / PO
 * completion badge and an optional actions slot. Registers with the global
 * layout (same as PageHeader) so the top-bar title is suppressed while mounted.
 */
function RfqDetailHeader({
  title,
  rfqName,
  isCompleted,
  status,
  actions,
}: {
  title: string;
  rfqName: string;
  isCompleted: boolean;
  status: string;
  actions?: ReactNode;
}) {
  const layout = useOptionalLayout();
  const register = layout?.registerPageHeader;
  const unregister = layout?.unregisterPageHeader;

  useLayoutEffect(() => {
    if (!register || !unregister) return;
    register();
    return () => unregister();
  }, [register, unregister]);

  return (
    <div className="mb-4">
      <BackLink />

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        {/* Command-center top bar */}
        <div className="flex flex-col gap-3 bg-sidebar px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate font-mono text-base font-bold tracking-tight text-white">
              {rfqName}
            </p>
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/50">
              RFQ Command Center
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white ring-1 ring-inset ring-white/15">
              <Sparkles className="h-3 w-3" />
              AI Procurement
            </span>
            {isCompleted ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-success-100 ring-1 ring-inset ring-success-500/40">
                <CheckCircle2 className="h-3 w-3" />
                Completed
              </span>
            ) : (
              <StatusBadge status={status} />
            )}
          </div>
        </div>

        {/* Title + reference + actions */}
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-neutral-900 sm:text-xl">
              {title}
            </h2>
            <div className="mt-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-neutral-50 px-2 py-0.5 font-mono text-xs font-semibold text-neutral-600 ring-1 ring-inset ring-neutral-200">
                {rfqName}
              </span>
            </div>
          </div>
          {actions && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Procurement Command Center building blocks ── */

const CARD_ICON_TONES = {
  brand: "bg-[#0ea5e9]/10 text-[#0ea5e9]",
  ai: "bg-primary text-white",
} as const;

function CommandCard({
  icon: Icon,
  title,
  badge,
  tone = "brand",
  children,
}: {
  icon: typeof FileText;
  title: string;
  badge?: ReactNode;
  tone?: keyof typeof CARD_ICON_TONES;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${CARD_ICON_TONES[tone]}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <h3 className="truncate text-xs font-bold uppercase tracking-wide text-neutral-700">
            {title}
          </h3>
        </div>
        {badge}
      </header>
      <div className="flex-1 px-4 py-3">{children}</div>
    </section>
  );
}

function KeyRow({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm first:pt-0 last:pb-0">
      <span className="flex-shrink-0 text-neutral-500">{label}</span>
      <span
        className={[
          "truncate text-right text-neutral-900",
          mono ? "font-mono tracking-tight" : "",
          strong
            ? "text-[18px] font-bold leading-tight"
            : mono
            ? "text-xs font-semibold"
            : "font-semibold",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function MiniStat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-2 py-2.5 text-center ring-1 ring-inset ring-neutral-100">
      <div className="text-xl font-bold tabular-nums text-neutral-900">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
    </div>
  );
}

function TimelineStep({
  label,
  meta,
  done,
  active,
  last,
}: {
  label: string;
  meta: string;
  done: boolean;
  active: boolean;
  last: boolean;
}) {
  const dotBg = done
    ? "bg-[#0ea5e9]"
    : active
      ? "bg-amber-500 ring-4 ring-amber-100"
      : "bg-neutral-200";

  const connectorBg = done ? "bg-[#0ea5e9]/30" : "bg-neutral-200";

  return (
    <li className="relative flex gap-2.5 pb-3 last:pb-0">
      {!last && (
        <span
          aria-hidden
          className={`absolute left-[5.5px] top-3.5 h-full w-px ${connectorBg}`}
        />
      )}
      <span
        className={`relative z-10 mt-0.5 flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full ${dotBg}`}
      >
        {done && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
      </span>
      <div className="-mt-0.5 min-w-0 flex-1">
        <p
          className={`text-sm font-semibold ${
            done
              ? "text-neutral-900"
              : active
                ? "text-amber-700"
                : "text-neutral-400"
          }`}
        >
          {label}
        </p>
        <p
          className={`truncate text-xs ${
            active ? "text-amber-600" : "text-neutral-500"
          }`}
        >
          {meta}
        </p>
      </div>
      {active && (
        <span className="mt-0.5 shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
          Current
        </span>
      )}
    </li>
  );
}

const PILL_TONES = {
  brand: "bg-[#0ea5e9]/10 text-[#0ea5e9] ring-[#0ea5e9]/20",
  success: "bg-success-50 text-success-600 ring-success-100",
  amber: "bg-warning-50 text-warning-600 ring-warning-100",
  neutral: "bg-neutral-100 text-neutral-600 ring-neutral-200",
} as const;

function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof PILL_TONES;
}) {
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/* ============================================================================
 * Utilities
 * ========================================================================== */

function sumQuotation(sq: SupplierQuotation): number {
  return (sq.items ?? []).reduce(
    (s, it) => s + (it.amount ?? (it.rate ?? 0) * (it.qty ?? 0)),
    0
  );
}

/* ============================================================================
 * Approval Workflow Progress Tracker
 * ========================================================================== */

function ApprovalWorkflowTracker({
  state,
  poExists,
  fullyApproved,
}: {
  state: RFQApprovalState;
  poExists: boolean;
  fullyApproved: boolean;
}) {
  const steps: {
    label: string;
    icon: typeof Check;
    done: boolean;
    active: boolean;
    rejected?: boolean;
  }[] = [
    {
      label: "Supplier Selected",
      icon: CheckCircle2,
      done: true,
      active: false,
    },
    {
      label: "Legal Review",
      icon: Gavel,
      done: state.legal_status === "Approved",
      active: state.legal_status === "Pending Legal Review",
      rejected:
        state.legal_status === "Rejected",
    },
    {
      label: "Finance Review",
      icon: Wallet,
      done: state.finance_status === "Budget Approved",
      active:
        state.legal_status === "Approved" &&
        state.finance_status === "Pending Finance Review",
      rejected: state.finance_status === "Rejected",
    },
    {
      label: "Create PO",
      icon: ShoppingCart,
      done: poExists,
      active: fullyApproved && !poExists,
    },
  ];

  const stepBadge = (s: (typeof steps)[number]) => {
    if (s.done)
      return "border-emerald-500 bg-emerald-500 text-white";
    if (s.rejected)
      return "border-red-500 bg-red-500 text-white";
    if (s.active)
      return "border-primary bg-primary text-white animate-pulse";
    return "border-neutral-300 bg-white text-neutral-400";
  };

  const statusLabel = (() => {
    if (poExists) return { text: "PO Created", tone: "bg-emerald-100 text-emerald-700" };
    if (fullyApproved) return { text: "Approved for PO", tone: "bg-emerald-100 text-emerald-700" };
    if (state.workflow_step === "Legal Rejected" || state.workflow_step === "Finance Rejected")
      return { text: state.workflow_step, tone: "bg-red-100 text-red-700" };
    return { text: state.workflow_step, tone: "bg-primary-100 text-primary-700" };
  })();

  return (
    <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
            RFQ Status
          </h3>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusLabel.tone}`}
        >
          {statusLabel.text}
        </span>
      </div>

      {/* Step indicators */}
      <div className="flex items-center">
        {steps.map((s, i) => {
          const SIcon = s.icon;
          return (
            <div key={s.label} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition ${stepBadge(s)}`}
                >
                  {s.done ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <SIcon className="h-3.5 w-3.5" />
                  )}
                </div>
                <span
                  className={`mt-1.5 text-center text-[10px] font-semibold ${
                    s.done
                      ? "text-emerald-600"
                      : s.rejected
                        ? "text-red-600"
                        : s.active
                          ? "text-primary"
                          : "text-neutral-400"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`mx-1 h-0.5 flex-1 rounded-full ${
                    s.done ? "bg-emerald-500" : "bg-neutral-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Supplier info */}
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
        <Send className="h-3 w-3 flex-shrink-0 text-neutral-400" />
        <span>
          Selected supplier: <strong className="text-neutral-900">{state.selected_supplier}</strong>
          {state.selected_supplier_total > 0 && (
            <> · {formatCurrency(state.selected_supplier_total)}</>
          )}
        </span>
      </div>
    </div>
  );
}
