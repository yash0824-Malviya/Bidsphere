import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Eye,
  FileText,
  Gavel,
  HelpCircle,
  Layers,
  Loader2,
  Scale,
  ShieldAlert,
  ShieldCheck,
  User,
  X,
  XCircle,
} from "lucide-react";

const LegalPdfViewer = lazy(
  () => import("../../components/legal/LegalPdfViewer"),
);

import {
  getRFQ,
  getSupplierQuotations,
  fetchRawSQ,
} from "../../api/sourcing";
import {
  getLegalDocs,
  updateLegalDocs,
  submitLegalReview,
  saveLegalChecklist,
  requestLegalChanges,
  getLegalSignatureEligibility,
} from "../../api/legalDocs";
import type { LegalDocumentSet } from "../../api/legalDocs";
import { invalidateApprovalWorkflow } from "../../api/approvalWorkflow";
import { resolveEsignBundle } from "../../api/legalEsign";
import { getLatestAnalysisSnapshot } from "../../api/supplierScoringResults";
import { useAuthStore } from "../../store/authStore";
import { formatRfqOwnerFromDoc } from "../../config/roles";
import { formatCurrency, formatDate } from "../../utils/format";
import { AppLoading, EnterpriseError, FadeIn } from "../../components/enterprise";
import SlaStageBadge from "../../components/sla/SlaStageBadge";
import type { RFQ, SupplierQuotation, AIRecommendation } from "../../types/erpnext";
import {
  hasDocSignature,
  getRequiredLegalDocumentKeys,
  isLegalDocumentVerified,
  isLegalReviewExecuted,
  isFinanceApproved,
  isLegalApproved,
  canFinalLegalApprove,
  type LegalDocKey,
} from "../../types/legalEsign";

type DocReviewStatus = "Pending" | "Approved" | "Rejected";

export type ChecklistStatus =
  | "Pending"
  | "Compliant"
  | "Non-Compliant"
  | "Exception"
  | "Not Applicable"
  | "Requires Clarification";

export interface CheckpointExceptionDetails {
  description: string;
  businessImpact?: string;
  requiredResolution?: string;
  severity: "Low" | "Medium" | "High" | "Critical";
}

export interface CheckpointClarificationDetails {
  inquiry: string;
  owner?: string;
  dueDate?: string;
}

export interface CheckpointItem {
  id: string;
  point: string;
  category: string;
  status: ChecklistStatus;
  remarks: string;
  reviewedBy?: string;
  reviewedAt?: string;
  exception?: CheckpointExceptionDetails;
  clarification?: CheckpointClarificationDetails;
}

const INITIAL_CHECKPOINTS: CheckpointItem[] = [
  {
    id: "rfq_terms",
    point: "RFQ Terms & Conditions",
    category: "Commercial & Statutory Covenants",
    status: "Pending",
    remarks: "",
  },
  {
    id: "sq_terms",
    point: "Supplier Quotation Terms",
    category: "Commercial & Statutory Covenants",
    status: "Pending",
    remarks: "",
  },
  {
    id: "supplier_docs",
    point: "Supplier Legal Documentation",
    category: "Instruments & Verification",
    status: "Pending",
    remarks: "",
  },
  {
    id: "nda_confidentiality",
    point: "NDA / Confidentiality Requirements",
    category: "Instruments & Verification",
    status: "Pending",
    remarks: "",
  },
  {
    id: "compliance_declarations",
    point: "Compliance Declarations",
    category: "Regulatory & Integrity Covenants",
    status: "Pending",
    remarks: "",
  },
  {
    id: "regulatory_requirements",
    point: "Regulatory Requirements",
    category: "Regulatory & Integrity Covenants",
    status: "Pending",
    remarks: "",
  },
  {
    id: "commercial_exceptions",
    point: "Commercial / Legal Exceptions",
    category: "Risk & Governance",
    status: "Pending",
    remarks: "",
  },
  {
    id: "contractual_requirements",
    point: "Contractual Requirements",
    category: "Risk & Governance",
    status: "Pending",
    remarks: "",
  },
];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

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
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { firstBodyLine = i + 1; break; }
    const tm = trimmed.match(/^Title\s*:\s*(.+)$/i);
    if (tm && !title) { title = tm[1].trim(); firstBodyLine = i + 1; continue; }
    const vm = trimmed.match(/^Valid\s*Till\s*:\s*(.+)$/i);
    if (vm && !validTill) { validTill = vm[1].trim(); firstBodyLine = i + 1; continue; }
    if (!title && !validTill) firstBodyLine = i;
    break;
  }
  return { title, validTill, body: lines.slice(firstBodyLine).join("\n").trim() };
}

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

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function LegalReviewDetailPage() {
  const { rfqId, sqName } = useParams<{ rfqId?: string; sqName?: string }>();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [loadedLegalDocs, setLoadedLegalDocs] = useState<LegalDocumentSet | null>(null);
  const reviewLoadGeneration = useRef(0);
  const setLegalDocs = useCallback((next: LegalDocumentSet | null) => {
    setLoadedLegalDocs(current => {
      // Do not let an older in-flight read overwrite a persisted verification.
      if (current?.name === next?.name && current?.modified && next?.modified && next.modified < current.modified) return current;
      return next;
    });
  }, []);
  const isAuthorizedLegalSigner = user?.role === "legal" || user?.role === "admin";
  const signatureEligibility = useQuery({
    queryKey: ["legal-signature-eligibility", loadedLegalDocs?.name, loadedLegalDocs?.modified],
    queryFn: () => getLegalSignatureEligibility(loadedLegalDocs!.name!),
    enabled: Boolean(loadedLegalDocs?.name && isAuthorizedLegalSigner),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchOnMount: "always",
  });
  // The freshly fetched record drives BOTH the badges and signing gate. Keep
  // the last mutation/load as the query-key anchor to avoid a refetch loop.
  const eligibilitySnapshot = signatureEligibility.data?.record && signatureEligibility.data.record.name === loadedLegalDocs?.name &&
    !(loadedLegalDocs?.modified && signatureEligibility.data.record.modified && signatureEligibility.data.record.modified < loadedLegalDocs.modified)
    ? signatureEligibility.data : undefined;
  const legalDocs = eligibilitySnapshot?.record ?? loadedLegalDocs;
  const eligibilityFresh = Boolean(isAuthorizedLegalSigner && signatureEligibility.isSuccess &&
    !signatureEligibility.isFetching && !signatureEligibility.isError && eligibilitySnapshot);
  const esignBundle = useMemo(() => resolveEsignBundle(legalDocs?.name, legalDocs?.esign_envelope), [legalDocs?.name, legalDocs?.esign_envelope]);
  const [viewerDocKey, setViewerDocKey] = useState<LegalDocKey | null>(null);
  const [showReviewRequiredWarning, setShowReviewRequiredWarning] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    summary: true,
    supplier: true,
    classification: true,
    checklist: true,
    documents: true,
    exceptions: true,
    notes: true,
    ai: false,
    timeline: false,
    actions: true,
  });

  const decodedId = useMemo(() => {
    if (rfqId) return decodeURIComponent(rfqId);
    return legalDocs?.rfq_name ?? "";
  }, [rfqId, legalDocs?.rfq_name]);

  // eslint-disable-next-line no-console
  console.log("[LegalReviewDetail] Route loaded", {
    rawParam: rfqId,
    decodedId,
    doctype: "Request for Quotation",
  });

  /* ── RFQ data (fetches from Request for Quotation, NOT Legal Review) ── */
  const rfqQuery = useQuery<RFQ>({
    queryKey: ["rfq", decodedId],
    queryFn: async () => {
      const apiUrl = `/api/resource/Request%20for%20Quotation/${encodeURIComponent(decodedId)}`;
      // eslint-disable-next-line no-console
      console.log("[LegalReviewDetail] Fetching:", apiUrl);
      try {
        const data = await getRFQ(decodedId);
        // eslint-disable-next-line no-console
        console.log("[LegalReviewDetail] RFQ loaded:", {
          name: data?.name,
          status: data?.status,
          items: (data?.items ?? []).length,
          suppliers: (data?.suppliers ?? []).length,
          owner: data?.owner,
        });
        return data;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[LegalReviewDetail] RFQ fetch FAILED:", {
          requestedName: decodedId,
          doctype: "Request for Quotation",
          error: err instanceof Error ? err.message : err,
        });
        throw err;
      }
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
  const parsed = useMemo(() => parseRfqMessage(rfq?.message_for_supplier), [rfq]);

  const rfqItems = rfq?.items ?? [];
  const rfqSuppliers = rfq?.suppliers ?? [];

  // Selected supplier is derived ENTIRELY from ERPNext data — the Legal
  // Document Review DocType's `supplier` field once it exists (it always
  // does once a review has been created), falling back to the live RFQ/
  // Supplier Quotation queries while the record is still loading. No
  // localStorage or synthesised client-side state is involved.
  const selectedSupplier = useMemo(() => {
    if (legalDocs?.supplier) return legalDocs.supplier;
    return rfqSuppliers[0]?.supplier ?? quotations[0]?.supplier ?? "";
  }, [legalDocs?.supplier, rfqSuppliers, quotations]);

  const [aiAnalysis, setAiAnalysis] = useState<AIRecommendation | null>(() =>
    readSavedAnalysis(decodedId)
  );
  useEffect(() => {
    const cached = readSavedAnalysis(decodedId);
    setAiAnalysis(cached);
    // Cross-device fallback: Procurement may have run the analysis on a
    // different browser/device than the one Legal is reviewing from.
    // ERPNext's Supplier Scoring Result snapshot is the source of truth.
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

  /* ── Selected Supplier Quotation — fetch ONLY the one SQ for the selected supplier ── */

  // Step 1: Determine the selected SQ name from the quotations list
  const selectedSQName = useMemo(() => {
    if (sqName) return sqName;
    if (legalDocs?.sq_name) return legalDocs.sq_name;
    if (!selectedSupplier || quotations.length === 0) return null;
    const match = quotations.find((q) => q.supplier === selectedSupplier);
    return match?.name ?? null;
  }, [sqName, legalDocs?.sq_name, selectedSupplier, quotations]);

  useEffect(() => {
    const generation = ++reviewLoadGeneration.current;
    let cancelled = false;
    const load = async () => {
      const lookupSq = sqName ?? selectedSQName;
      if (!lookupSq) {
        if (!sqName) {
          setLegalDocs(null);
        }
        return;
      }
      const docs = await getLegalDocs(lookupSq);
      if (cancelled || generation !== reviewLoadGeneration.current) return;
      setLegalDocs(docs);
    };
    void load();
    return () => { cancelled = true; };
  }, [sqName, selectedSQName, setLegalDocs]);

  const handleViewPdf = useCallback(
    async (field: LegalDocKey) => {
      const url = legalDocs?.[`${field}_file_url`];
      if (!url) {
        toast.error("PDF not available");
        return;
      }
      // Toggle inline viewer — only one open at a time.
      if (viewerDocKey === field) {
        setViewerDocKey(null);
        return;
      }
      setViewerDocKey(field);
      setExpandedSections((prev) => ({ ...prev, checklist: true }));


    },
    [legalDocs, viewerDocKey]
  );

  const refreshLegalDocs = useCallback(async () => {
    const lookupSq = sqName ?? selectedSQName;
    if (!lookupSq) return;
    const generation = reviewLoadGeneration.current;
    const docs = await getLegalDocs(lookupSq);
    if (generation !== reviewLoadGeneration.current) return;
    if (docs) {
      setLegalDocs(docs);
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rfq", decodedId] }),
      queryClient.invalidateQueries({ queryKey: ["supplier-quotations", decodedId] }),
      queryClient.invalidateQueries({ queryKey: ["selected-sq-raw", selectedSQName] }),
      queryClient.invalidateQueries({ queryKey: ["legal-document-reviews"] }),
      queryClient.invalidateQueries({ queryKey: ["legal-signature-eligibility"] }),
    ]);
  }, [sqName, selectedSQName, decodedId, queryClient, setLegalDocs]);

  const handleApproveToggle = useCallback(
    async (field: "terms" | "warranty" | "insurance", checked: boolean) => {
      if (!legalDocs?.name) return;
      if (checked && !esignBundle?.documents[field]?.viewedAt) {
        setShowReviewRequiredWarning(true);
        toast.error("Open and review the current PDF before marking it reviewed.");
        return;
      }
      try {
        const generation = reviewLoadGeneration.current;
        const updated = await updateLegalDocs(legalDocs.name, {
          [`${field}_approved`]: checked ? 1 : 0,
        } as Partial<LegalDocumentSet>);
        if (generation !== reviewLoadGeneration.current) return;
        setLegalDocs(updated);
        await refreshLegalDocs();
      } catch {
        toast.error("Could not update approval status");
      }
    },
    [legalDocs, esignBundle, refreshLegalDocs, setLegalDocs]
  );

  const attachedDocKeys = useMemo(() => {
    return eligibilitySnapshot?.requiredDocumentKeys ?? getRequiredLegalDocumentKeys(legalDocs);
  }, [eligibilitySnapshot, legalDocs]);

  const verifiedDocKeys = useMemo(() => {
    return eligibilitySnapshot?.verifiedDocumentKeys ?? attachedDocKeys.filter((k) => isLegalDocumentVerified(legalDocs, k));
  }, [eligibilitySnapshot, attachedDocKeys, legalDocs]);

  const pendingDocKeys = eligibilitySnapshot?.pendingDocumentKeys ?? attachedDocKeys.filter(key => !verifiedDocKeys.includes(key));

  const allInstrumentsVerified = useMemo(() => {
    return attachedDocKeys.length > 0 && pendingDocKeys.length === 0;
  }, [attachedDocKeys.length, pendingDocKeys.length]);

  const documentsReviewed = useMemo(() => {
    return attachedDocKeys.length > 0 && attachedDocKeys.every(key => legalDocs?.[`${key}_approved`] && esignBundle?.documents[key]?.viewedAt);
  }, [attachedDocKeys, legalDocs, esignBundle]);

  const financeApproved = useMemo(() => {
    return isFinanceApproved(legalDocs);
  }, [legalDocs]);

  const legalApproved = useMemo(() => {
    return isLegalApproved(legalDocs);
  }, [legalDocs]);



  // Step 2: Fetch ONLY that single SQ as a raw object (not from list)
  const selectedSQQuery = useQuery<Record<string, unknown>>({
    queryKey: ["selected-sq-raw", selectedSQName],
    queryFn: () => {
      // eslint-disable-next-line no-console
      console.log("[LegalDocs] Fetching SINGLE SQ:", selectedSQName);
      return fetchRawSQ(selectedSQName!);
    },
    enabled: !!selectedSQName,
  });

  const rawSQ = selectedSQQuery.data ?? null;

  // Log the full SQ object when it arrives
  useEffect(() => {
    if (!rawSQ || !selectedSQName) return;
    const allKeys = Object.keys(rawSQ);
    const docKeys = allKeys.filter((k) =>
      /terms|warranty|insurance|pdf|certificate|note/i.test(k)
    );
    // eslint-disable-next-line no-console
    console.group("[LegalDocs] Selected SQ:", selectedSQName);
    // eslint-disable-next-line no-console
    console.log("Supplier:", rawSQ.supplier);
    // eslint-disable-next-line no-console
    console.log("Total keys:", allKeys.length);
    // eslint-disable-next-line no-console
    console.log("Document-related keys:", docKeys.length > 0 ? docKeys : "NONE");
    for (const k of docKeys) {
      // eslint-disable-next-line no-console
      console.log(`  ${k}:`, rawSQ[k] || "(empty)");
    }
    // eslint-disable-next-line no-console
    console.log("Supplier Quotation Full:", rawSQ);
    // eslint-disable-next-line no-console
    console.groupEnd();
  }, [rawSQ, selectedSQName]);

  /* ── Decision comments & conditions (written to ERPNext on submit) ── */
  const [actionReason, setActionReason] = useState("");
  const [conditionsExceptions, setConditionsExceptions] = useState("");
  const [showClarifyModal, setShowClarifyModal] = useState(false);
  const [clarifyComments, setClarifyComments] = useState("");

  /* ── Interactive Legal & Compliance Checklist State ── */
  const [checklistDraft, setChecklistDraft] = useState<{ source: string; items: CheckpointItem[] } | null>(null);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const checklistSource = `${legalDocs?.name || ""}:${legalDocs?.esign_envelope || ""}`;
  const checkpoints = useMemo(() => {
    if (checklistDraft?.source === checklistSource) return checklistDraft.items;
    const saved = resolveEsignBundle(legalDocs?.name, legalDocs?.esign_envelope).reviewChecklist;
    return INITIAL_CHECKPOINTS.map(item => ({ ...item, ...saved?.find(row => row.id === item.id) } as CheckpointItem));
  }, [checklistDraft, checklistSource, legalDocs?.name, legalDocs?.esign_envelope]);
  const setCheckpoints = useCallback((items: CheckpointItem[]) => {
    setChecklistDraft({ source: checklistSource, items });
  }, [checklistSource]);

  const persistChecklist = useCallback(async (items: CheckpointItem[]) => {
    if (!legalDocs?.name) throw new Error("No Legal Review record found.");
    setSavingChecklist(true);
    try {
      const updated = await saveLegalChecklist(legalDocs.name, items);
      setLegalDocs(updated);
    } finally { setSavingChecklist(false); }
  }, [legalDocs?.name, setLegalDocs]);

  // Active item opened in Review Modal
  const [activeReviewItem, setActiveReviewItem] = useState<CheckpointItem | null>(null);

  // Review Modal edit state
  const [reviewModalStatus, setReviewModalStatus] = useState<ChecklistStatus>("Pending");
  const [reviewModalRemarks, setReviewModalRemarks] = useState("");
  const [reviewModalException, setReviewModalException] = useState<CheckpointExceptionDetails>({
    description: "",
    businessImpact: "",
    requiredResolution: "",
    severity: "Medium",
  });
  const [reviewModalClarification, setReviewModalClarification] = useState<CheckpointClarificationDetails>({
    inquiry: "",
    owner: "Procurement / Supplier",
    dueDate: "",
  });

  const handleOpenReviewModal = useCallback((item: CheckpointItem) => {
    setActiveReviewItem(item);
    setReviewModalStatus(item.status);
    setReviewModalRemarks(item.remarks || "");
    setReviewModalException(
      item.exception || {
        description: "",
        businessImpact: "",
        requiredResolution: "",
        severity: "Medium",
      }
    );
    setReviewModalClarification(
      item.clarification || {
        inquiry: "",
        owner: "Procurement / Supplier",
        dueDate: "",
      }
    );
  }, []);

  const handleSaveReviewModal = useCallback(async () => {
    if (!activeReviewItem) return;

    if (reviewModalStatus === "Exception" && !reviewModalException.description.trim()) {
      toast.error("Please provide an Exception Description.");
      return;
    }

    if (reviewModalStatus === "Requires Clarification" && !reviewModalClarification.inquiry.trim()) {
      toast.error("Please specify the Clarification Inquiry.");
      return;
    }

    const reviewerName = user?.name || user?.email || "Legal Manager";
    const nowIso = new Date().toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const updatedCheckpoints = checkpoints.map((chk) => {
      if (chk.id !== activeReviewItem.id) return chk;
      return {
        ...chk,
        status: reviewModalStatus,
        remarks: reviewModalRemarks.trim(),
        reviewedBy: reviewerName,
        reviewedAt: nowIso,
        exception: reviewModalStatus === "Exception" ? reviewModalException : undefined,
        clarification: reviewModalStatus === "Requires Clarification" ? reviewModalClarification : undefined,
      };
    });

    try { await persistChecklist(updatedCheckpoints); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Checklist could not be saved."); return; }

    // If an exception was saved, automatically sync to conditionsExceptions field for visibility
    if (reviewModalStatus === "Exception" && reviewModalException.description.trim()) {
      const exceptionNote = `[${activeReviewItem.point}] ${reviewModalException.severity} Severity: ${reviewModalException.description.trim()}`;
      setConditionsExceptions((prev) => {
        if (!prev) return exceptionNote;
        if (prev.includes(activeReviewItem.point)) return prev;
        return `${prev}\n${exceptionNote}`;
      });
    }

    toast.success(`Updated "${activeReviewItem.point}" to ${reviewModalStatus}`);
    setActiveReviewItem(null);
  }, [
    activeReviewItem,
    reviewModalStatus,
    reviewModalRemarks,
    reviewModalException,
    reviewModalClarification,
    user,
    checkpoints,
    persistChecklist,
  ]);

  const handleInlineStatusChange = useCallback(
    async (id: string, newStatus: ChecklistStatus) => {
      const reviewerName = user?.name || user?.email || "Legal Manager";
      const nowIso = new Date().toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const updated = checkpoints.map((chk) => {
        if (chk.id !== id) return chk;
        return {
          ...chk,
          status: newStatus,
          reviewedBy: reviewerName,
          reviewedAt: nowIso,
        };
      });

      try {
        await persistChecklist(updated);
        toast.success(`Checkpoint updated to ${newStatus}`);
      } catch (err) { toast.error(err instanceof Error ? err.message : "Checklist could not be saved."); }
    },
    [checkpoints, persistChecklist, user]
  );

  const handleInlineRemarksChange = useCallback(
    (id: string, newRemarks: string) => {
      const updated = checkpoints.map((chk) => (chk.id === id ? { ...chk, remarks: newRemarks } : chk));
      setCheckpoints(updated);
    },
    [checkpoints, setCheckpoints]
  );

  // Checklist Progress Metrics
  const completedCount = useMemo(() => {
    return checkpoints.filter((c) => c.status === "Compliant" || c.status === "Not Applicable").length;
  }, [checkpoints]);

  const pendingCount = useMemo(() => {
    return checkpoints.filter((c) => c.status === "Pending").length;
  }, [checkpoints]);

  const compliantCount = useMemo(() => {
    return checkpoints.filter((c) => c.status === "Compliant").length;
  }, [checkpoints]);

  const exceptionsCount = useMemo(() => {
    return checkpoints.filter((c) => c.status === "Exception" || c.status === "Non-Compliant").length;
  }, [checkpoints]);

  const clarificationCount = useMemo(() => {
    return checkpoints.filter((c) => c.status === "Requires Clarification").length;
  }, [checkpoints]);

  // Completion rule: All 8 checkpoints must be Compliant or Not Applicable
  const isChecklistFullyApproved = useMemo(() => {
    return checkpoints.length > 0 && checkpoints.every((c) => c.status === "Compliant" || c.status === "Not Applicable");
  }, [checkpoints]);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  /* ── Submission state — derived entirely from the ERPNext DocType.
   * `review_status` IS the single source of truth: "Pending" means the
   * decision hasn't been made yet; anything else means it's final. ── */
  const submitted = savingChecklist || legalDocs?.review_status !== "Pending" || legalDocs?.current_owner === "Procurement" || !["legal", "admin"].includes(user?.role || "");

  const [submitting, setSubmitting] = useState(false);

  const approvedCount = verifiedDocKeys.length;

  const canEsign = useMemo(() => {
    return eligibilityFresh && !savingChecklist && Boolean(eligibilitySnapshot?.eligible);
  }, [eligibilityFresh, savingChecklist, eligibilitySnapshot?.eligible]);

  const hasSignatures = useMemo(() => {
    return isLegalReviewExecuted(legalDocs);
  }, [legalDocs]);

  const canApprove = useMemo(() => {
    return Boolean(
      isAuthorizedLegalSigner &&
      !submitted &&
      canFinalLegalApprove(legalDocs)
    );
  }, [isAuthorizedLegalSigner, submitted, legalDocs]);

  const esignDisabledReason = useMemo(() => {
    if (!isAuthorizedLegalSigner) {
      return "You do not have permission to sign this document.";
    }
    if (signatureEligibility.isError) return "Unable to refresh signing eligibility. Refresh status before signing.";
    if (!eligibilityFresh) return "Refreshing signing eligibility from ERPNext…";
    if (savingChecklist) return "Wait for the current review update to finish.";
    if (!allInstrumentsVerified) {
      return "Verify all required supplier documents before signing.";
    }
    if (hasSignatures) return "Document has already been signed.";
    if (!eligibilitySnapshot?.eligible) return eligibilitySnapshot?.reason || "Document workflow state does not permit e-signature.";
    return undefined;
  }, [isAuthorizedLegalSigner, signatureEligibility.isError, eligibilitySnapshot, eligibilityFresh, savingChecklist, allInstrumentsVerified, hasSignatures]);

  useEffect(() => {
    if (!legalDocs) return;
    // Safe diagnostics: logs status metadata without credentials
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[LegalGating] Status audit for ${legalDocs.name || decodedId}`);
    // eslint-disable-next-line no-console
    console.log("finance_status:", legalDocs.finance_status || "(empty)");
    // eslint-disable-next-line no-console
    console.log("legal_status:", legalDocs.review_status || "(empty)");
    // eslint-disable-next-line no-console
    console.log("workflow_state:", legalDocs.workflow_state || "(empty)");
    // eslint-disable-next-line no-console
    console.log("status:", rfq?.status || "(empty)");
    // eslint-disable-next-line no-console
    console.log("verification_status:", {
      verified_count: verifiedDocKeys.length,
      required_count: attachedDocKeys.length,
      all_verified: allInstrumentsVerified,
      terms_approved: legalDocs.terms_approved,
      warranty_approved: legalDocs.warranty_approved,
      insurance_approved: legalDocs.insurance_approved,
    });
    // eslint-disable-next-line no-console
    console.log("signature_status:", {
      canEsign,
      hasSignatures,
      esign_envelope_present: Boolean(legalDocs.esign_envelope),
    });
    // eslint-disable-next-line no-console
    console.groupEnd();
  }, [legalDocs, rfq, financeApproved, legalApproved, allInstrumentsVerified, verifiedDocKeys, attachedDocKeys, canEsign, hasSignatures, decodedId]);

  /* ── Loading / error states ── */
  if (rfqQuery.isLoading) {
    return (
      <div className="p-6">
        <AppLoading variant="document" />
      </div>
    );
  }

  if (rfqQuery.isError || !rfq) {
    // eslint-disable-next-line no-console
    console.error("[LegalReviewDetail] Document load failed:", {
      requestedId: decodedId,
      rawParam: rfqId,
      fullError: rfqQuery.error,
    });
    return (
      <div className="p-6">
        <EnterpriseError
          error={rfqQuery.error ?? new Error("not found")}
          onRetry={() => void rfqQuery.refetch()}
          onBack={() => {
            window.location.assign("/legal/reviews");
          }}
          backLabel="Back"
        />
      </div>
    );
  }

  // eslint-disable-next-line no-console
  console.log("[LegalReviewDetail] Page rendered", {
    rfqName: rfq.name,
    items: rfqItems.length,
    suppliers: rfqSuppliers.length,
    reviewStatus: legalDocs?.review_status ?? "none",
    hasAI: !!aiAnalysis,
  });

  const selectedQuote = quotations.find(
    (q) => q.supplier === selectedSupplier || q.supplier_name === selectedSupplier
  );

  const currentLegalStatus: DocReviewStatus = legalDocs?.review_status ?? "Pending";

  return (
    <FadeIn className="mx-auto w-full max-w-[1360px] px-6 sm:px-8 py-6 space-y-6">
      {/* ── Header ── */}
      <div className="border-b border-slate-200 pb-5">
        <Link
          to="/legal/reviews"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-primary-700"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Legal Reviews
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700 ring-1 ring-violet-200">
              <Scale className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  RFQ Legal Review: {decodedId}
                </h1>
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {selectedSQName ? `Quotation: ${selectedSQName}` : selectedSupplier || "RFQ Review"}
                </span>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-slate-500">
                Review RFQ terms, supplier documentation, compliance requirements, and legal conditions before commercial progression.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SlaStageBadge
              workflow="Legal Review"
              referenceDoctype="Request for Quotation"
              referenceName={rfq.name}
              open={currentLegalStatus === "Pending"}
            />
            <LegalStatusBadge status={currentLegalStatus} />
          </div>
        </div>
      </div>

      {/* ── Reviewer / Timestamp Banner — sourced directly from the ERPNext
          "Legal Document Review" record (approved_by / approved_on). ── */}
      {legalDocs?.approved_by && submitted && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <User className="h-4 w-4 text-neutral-400" />
          <div className="text-sm text-neutral-600">
            Reviewed by{" "}
            <span className="font-semibold text-neutral-900">
              {legalDocs.approved_by}
            </span>
            {legalDocs.approved_on && <> on {formatDate(legalDocs.approved_on)}</>}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* ═══════════════ Section 1: RFQ Summary (Full Width) ═══════════════ */}
        <CollapsibleSection
          id="summary"
          icon={FileText}
          title="RFQ Summary"
          expanded={expandedSections.summary}
          onToggle={toggleSection}
          badge={
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              {rfqItems.length} {rfqItems.length === 1 ? "Item" : "Items"}
            </span>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoField label="RFQ Number" value={rfq.name} highlight />
            <InfoField label="Supplier Quotation" value={selectedSQName ?? legalDocs?.sq_name ?? "Pending"} />
            <InfoField label="Created By" value={formatRfqOwnerFromDoc(rfq)} />
            <InfoField label="Company" value={rfq.company ?? "Bidsphere Corp"} />
            <InfoField label="Transaction Date" value={formatDate(rfq.transaction_date)} />
            <InfoField label="Valid Till" value={parsed.validTill ?? (rfq.valid_till ? formatDate(rfq.valid_till) : "—")} />
            <InfoField label="Current Status" value={currentLegalStatus === "Pending" ? "Pending Legal Review" : currentLegalStatus} />
            <InfoField label="Total Items" value={`${rfqItems.length} line items`} />
          </div>

          {parsed.body && (
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Message for Supplier
              </p>
              <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                {parsed.body}
              </p>
            </div>
          )}

          {rfq.terms && (
            <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                RFQ Master Terms & Conditions
              </p>
              <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                {rfq.terms}
              </p>
            </div>
          )}

          {/* Items Table */}
          {rfqItems.length > 0 && (
            <div className="mt-5">
              <div className="mb-2.5 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  RFQ Line Items ({rfqItems.length})
                </p>
                <span className="text-[11px] text-slate-400">Standard procurement item specifications</span>
              </div>
              <div className="w-full max-w-full overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    <col className="w-[28%]" />
                    <col className="w-[36%]" />
                    <col className="w-[12%]" />
                    <col className="w-[10%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                      <th className="px-3.5 py-2.5">Item Code</th>
                      <th className="px-3.5 py-2.5">Item Name</th>
                      <th className="px-3.5 py-2.5 text-right">Quantity</th>
                      <th className="px-3.5 py-2.5">UOM</th>
                      <th className="px-3.5 py-2.5">Schedule Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rfqItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                        <td className="truncate px-3.5 py-2.5 text-xs font-semibold text-slate-900" title={item.item_code}>
                          {item.item_code}
                        </td>
                        <td className="truncate px-3.5 py-2.5 text-xs text-slate-700" title={item.item_name || item.description || item.item_code}>
                          {item.item_name || item.description || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right text-xs font-medium text-slate-900 tabular-nums">
                          {item.qty}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-xs text-slate-600">
                          {item.uom ?? "Nos"}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-xs text-slate-600">
                          {item.schedule_date ? formatDate(item.schedule_date) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section 2: Side-by-side 2-Column Grid ═══════════════ */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Card A: Supplier & Quotation Details */}
          <CollapsibleSection
            id="supplier"
            icon={Building2}
            title="Supplier & Quotation Details"
            expanded={expandedSections.supplier}
            onToggle={toggleSection}
          >
            {selectedSupplier ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoField
                    label="Selected Supplier"
                    value={selectedSupplier}
                    highlight
                  />
                  <InfoField
                    label="Supplier ID"
                    value={selectedQuote?.supplier ?? selectedSupplier}
                  />
                  <InfoField
                    label="Quotation Value"
                    value={
                      selectedQuote?.grand_total != null
                        ? formatCurrency(selectedQuote.grand_total)
                        : legalDocs?.grand_total != null
                        ? formatCurrency(legalDocs.grand_total)
                        : "—"
                    }
                    highlight
                  />
                  <InfoField
                    label="Currency"
                    value="USD ($)"
                  />
                  <InfoField
                    label="Submitted By"
                    value={legalDocs?.procurement_manager ?? rfq?.owner ?? "Procurement"}
                  />
                  <InfoField
                    label="Submission Date"
                    value={legalDocs?.submission_date ? formatDate(legalDocs.submission_date) : (selectedQuote?.transaction_date ? formatDate(selectedQuote.transaction_date) : "—")}
                  />
                  <InfoField
                    label="Contact Person"
                    value={
                      rfqSuppliers.find((s) => s.supplier === selectedSupplier)?.contact ||
                      (selectedQuote as unknown as Record<string, string>)?.contact_display ||
                      "Supplier Representative"
                    }
                  />
                  <InfoField
                    label="Contact Email"
                    value={
                      rfqSuppliers.find((s) => s.supplier === selectedSupplier)?.email_id ||
                      (selectedQuote as unknown as Record<string, string>)?.contact_email ||
                      "legal-contact@supplier.com"
                    }
                  />
                </div>

                {legalDocs?.supplier_notes && (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Supplier Notes
                    </p>
                    <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                      {legalDocs.supplier_notes}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                No supplier has been selected for this RFQ review yet.
              </div>
            )}
          </CollapsibleSection>

          {/* Card B: RFQ Classification & Commercial Terms */}
          <CollapsibleSection
            id="classification"
            icon={Layers}
            title="RFQ Classification & Commercial Terms"
            expanded={expandedSections.classification}
            onToggle={toggleSection}
          >
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoField
                  label="Procurement Category"
                  value={
                    rfq.custom_procurement_category ||
                    (rfq as unknown as Record<string, unknown>)?.category as string ||
                    "Direct Materials / Sourcing"
                  }
                  highlight
                />
                <InfoField
                  label="RFQ Type"
                  value={
                    rfqItems.some((i) => i.custom_2d_drawing || i.custom_engineering_attachments)
                      ? "Custom Engineered / Sourcing"
                      : "Standard Direct Commercial"
                  }
                />
                <InfoField
                  label="Priority"
                  value={
                    (selectedQuote?.grand_total ?? legalDocs?.grand_total ?? 0) > 10000
                      ? "High Priority"
                      : "Standard"
                  }
                />
                <InfoField
                  label="Incoterms"
                  value={
                    (selectedQuote as unknown as Record<string, unknown>)?.incoterm as string ||
                    (legalDocs as unknown as Record<string, unknown>)?.incoterm as string ||
                    "DAP - Delivered at Place"
                  }
                />
                <InfoField
                  label="Payment Terms"
                  value={legalDocs?.payment_terms || (selectedQuote as unknown as Record<string, unknown>)?.payment_terms_template as string || "Net 45 Days"}
                />
                <InfoField
                  label="Lead Time"
                  value={
                    selectedQuote?.items?.[0]?.delivery_days != null
                      ? `${selectedQuote.items[0].delivery_days} Days`
                      : "14-21 Business Days"
                  }
                />
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Legal Compliance Requirement
                </p>
                <p className="text-xs leading-relaxed text-slate-700">
                  Direct commercial supplier contracts and purchase commitments exceed corporate threshold and require strict adherence to Netlink Standard Terms, warranty covenants, and liability coverage.
                </p>
              </div>
            </div>
          </CollapsibleSection>
        </div>

        {/* ═══════════════ Section 3: Legal & Compliance Review Checklist ═══════════════ */}
        <CollapsibleSection
          id="checklist"
          icon={ShieldCheck}
          title="Legal & Compliance Review Checklist"
          expanded={expandedSections.checklist}
          onToggle={toggleSection}
          badge={
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                isChecklistFullyApproved
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-amber-50 text-amber-700 ring-amber-200"
              }`}
            >
              {completedCount} / 8 Completed
            </span>
          }
        >
          <div className="space-y-4">
            {/* Progress Header & Counter Badges */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Legal Review Progress:
                    </span>
                    <span className="rounded-md bg-blue-600 px-2 py-0.5 text-xs font-extrabold text-white">
                      {completedCount} / 8 Completed
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Verification of statutory, commercial, and contractual covenants before formal procurement contract award.
                  </p>
                </div>

                {/* Progress Badges */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/70 px-2.5 py-0.5 font-bold text-slate-700">
                    <Clock className="h-3 w-3 text-slate-500" />
                    Pending: {pendingCount}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-800">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    Compliant: {compliantCount}
                  </span>
                  {exceptionsCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 font-bold text-rose-800">
                      <AlertTriangle className="h-3 w-3 text-rose-600" />
                      Exceptions: {exceptionsCount}
                    </span>
                  )}
                  {clarificationCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 font-bold text-amber-800">
                      <HelpCircle className="h-3 w-3 text-amber-600" />
                      Clarifications: {clarificationCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full transition-all duration-300 ${
                    isChecklistFullyApproved ? "bg-emerald-500" : "bg-blue-600"
                  }`}
                  style={{ width: `${(completedCount / 8) * 100}%` }}
                />
              </div>
            </div>

            {/* Checklist Table */}
            <div className="w-full max-w-full overflow-hidden rounded-xl border border-slate-200 shadow-2xs">
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[22%]" />
                  <col className="w-[36%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    <th className="px-4 py-3">Checkpoint</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Remarks / Legal Observations</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {checkpoints.map((row) => {
                    const isRowCompliant = row.status === "Compliant";
                    const isRowNA = row.status === "Not Applicable";
                    const isRowPending = row.status === "Pending";
                    const isRowException = row.status === "Exception" || row.status === "Non-Compliant";
                    const isRowClarify = row.status === "Requires Clarification";

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Checkpoint Title & Category */}
                        <td className="px-4 py-3 align-top">
                          <p className="text-xs font-bold text-slate-900 leading-snug">
                            {row.point}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {row.category}
                          </p>

                          {/* Audit Info if reviewed */}
                          {row.reviewedAt && (
                            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
                              <User className="h-2.5 w-2.5" />
                              Reviewed by {row.reviewedBy ?? "Legal Manager"} · {row.reviewedAt}
                            </p>
                          )}
                        </td>

                        {/* Status selector */}
                        <td className="px-4 py-3 align-top">
                          <div className="space-y-1.5">
                            <select
                              value={row.status}
                              disabled={submitted}
                              onChange={(e) => handleInlineStatusChange(row.id, e.target.value as ChecklistStatus)}
                              className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 ${
                                isRowCompliant
                                  ? "border-emerald-300 bg-emerald-50/80 text-emerald-800 focus:border-emerald-500 focus:ring-emerald-500"
                                  : isRowNA
                                  ? "border-slate-300 bg-slate-50 text-slate-700 focus:border-slate-500 focus:ring-slate-500"
                                  : isRowException
                                  ? "border-rose-300 bg-rose-50/80 text-rose-800 focus:border-rose-500 focus:ring-rose-500"
                                  : isRowClarify
                                  ? "border-amber-300 bg-amber-50/80 text-amber-800 focus:border-amber-500 focus:ring-amber-500"
                                  : "border-slate-300 bg-white text-slate-700 focus:border-blue-500 focus:ring-blue-500"
                              }`}
                            >
                              <option value="Pending">Pending Review</option>
                              <option value="Compliant">Compliant</option>
                              <option value="Non-Compliant">Non-Compliant</option>
                              <option value="Exception">Exception</option>
                              <option value="Not Applicable">Not Applicable</option>
                              <option value="Requires Clarification">Requires Clarification</option>
                            </select>

                            {/* Exception Details pill */}
                            {row.status === "Exception" && row.exception && (
                              <div className="rounded-md border border-rose-200 bg-rose-50 p-1.5 text-[10px] text-rose-800">
                                <span className="font-bold uppercase tracking-wider text-rose-700">
                                  [{row.exception.severity} Severity]:
                                </span>{" "}
                                {row.exception.description}
                              </div>
                            )}

                            {/* Clarification Details pill */}
                            {row.status === "Requires Clarification" && row.clarification && (
                              <div className="rounded-md border border-amber-200 bg-amber-50 p-1.5 text-[10px] text-amber-800">
                                <span className="font-bold uppercase tracking-wider text-amber-700">
                                  [Inquiry]:
                                </span>{" "}
                                {row.clarification.inquiry}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Editable Remarks / Legal Observations */}
                        <td className="px-4 py-3 align-top">
                          <textarea
                            value={row.remarks}
                            disabled={submitted}
                            onChange={(e) => handleInlineRemarksChange(row.id, e.target.value)}
                            onBlur={() => { void persistChecklist(checkpoints).catch(err => toast.error(err instanceof Error ? err.message : "Remarks were not saved.")); }}
                            placeholder="Enter legal observations, exceptions, or required actions..."
                            rows={2}
                            className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
                          />
                        </td>

                        {/* Action buttons */}
                        <td className="px-4 py-3 text-right align-top">
                          <div className="flex flex-col items-end gap-1.5">
                            {row.id === "supplier_docs" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedSections((prev) => ({ ...prev, documents: true }));
                                  const el = document.getElementById("documents");
                                  if (el) {
                                    el.scrollIntoView({ behavior: "smooth" });
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 hover:border-slate-300"
                              >
                                <Eye className="h-3 w-3 text-slate-500" />
                                View Documents
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenReviewModal(row)}
                              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition shadow-2xs ${
                                isRowPending
                                  ? "bg-blue-600 text-white hover:bg-blue-700"
                                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <Scale className="h-3 w-3" />
                              Review
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </CollapsibleSection>

        {/* ═══════════════ Section 4: Supplier Legal Documents ═══════════════ */}
        <CollapsibleSection
          id="documents"
          icon={FileText}
          title="Supplier Legal Documents"
          expanded={expandedSections.documents}
          onToggle={toggleSection}
          badge={
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 ring-1 ring-blue-200">
              {approvedCount}/{attachedDocKeys.length} Verified
            </span>
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-semibold text-slate-800">
                  Attached Legal Instruments &amp; Electronic Signatures
                </p>
                <p className="text-[11px] text-slate-500">
                  Open attachments to inspect legal terms and verify covenants.{" "}
                  {!allInstrumentsVerified ? (
                    <span className="text-amber-800 font-medium">
                      Verify all required supplier documents before e-signature ({verifiedDocKeys.length} of {attachedDocKeys.length} verified).
                    </span>
                  ) : hasSignatures ? (
                    <span className="font-semibold text-emerald-700">
                      ✓ Required signatures completed. {financeApproved ? "Finance Approved." : "Pending Finance Approval."}
                    </span>
                  ) : (
                    <span className="font-semibold text-emerald-700">
                      {canEsign ? "✓ Ready for E-Signature. E-signature is ready." : esignDisabledReason}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">Verification Progress:</span>
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                  {approvedCount} of {attachedDocKeys.length} Required Documents
                </span>
                <button type="button" disabled={!legalDocs?.name || !isAuthorizedLegalSigner || signatureEligibility.isFetching}
                  onClick={() => { void signatureEligibility.refetch(); }}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50">
                  {signatureEligibility.isFetching ? "Refreshing…" : "Refresh status"}
                </button>
              </div>
            </div>
            {pendingDocKeys.length > 0 ? (
              <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                Pending required documents: {pendingDocKeys.map(key => key === "terms" ? "Master Terms & Conditions" : key === "warranty" ? "Quality & Compliance Warranty" : "Liability Insurance Certificate").join(", ")}.
              </p>
            ) : null}

            {/* Document Cards / Table with Embedded Actions */}
            <div className="space-y-3">
              {[
                {
                  shortField: "terms" as const,
                  label: "Master Terms & Conditions",
                  docType: "Master Agreement (MSA)",
                  docNumber: `DOC-TRM-${decodedId.replace(/\D/g, "").slice(-4) || "1001"}`,
                  issueDate: legalDocs?.submission_date || rfq.transaction_date,
                  expiryDate: legalDocs?.valid_till || parsed.validTill || "2027-12-31",
                },
                {
                  shortField: "warranty" as const,
                  label: "Quality & Compliance Warranty",
                  docType: "Compliance Warranty",
                  docNumber: `DOC-WRN-${decodedId.replace(/\D/g, "").slice(-4) || "2001"}`,
                  issueDate: legalDocs?.submission_date || rfq.transaction_date,
                  expiryDate: legalDocs?.valid_till || parsed.validTill || "2027-12-31",
                },
                {
                  shortField: "insurance" as const,
                  label: "Liability Insurance Certificate",
                  docType: "Certificate of Insurance",
                  docNumber: `DOC-INS-${decodedId.replace(/\D/g, "").slice(-4) || "3001"}`,
                  issueDate: legalDocs?.submission_date || rfq.transaction_date,
                  expiryDate: legalDocs?.valid_till || parsed.validTill || "2027-12-31",
                },
              ].filter(({ shortField }) => attachedDocKeys.includes(shortField) || legalDocs?.[`${shortField}_file_url`]).map(({ shortField, label, docType, docNumber, issueDate, expiryDate }) => {
                const fileUrl = legalDocs?.[`${shortField}_file_url`];
                const pdfName = legalDocs?.[`${shortField}_file_name` as keyof LegalDocumentSet] as string | undefined || (fileUrl ? fileUrl.split("/").pop() : undefined);
                const note = legalDocs?.[`${shortField}_note` as keyof LegalDocumentSet] as string | undefined;
                const hasPdf = Boolean(fileUrl);
                const isViewed = Boolean(legalDocs?.[`${shortField}_viewed` as keyof LegalDocumentSet]);
                const isApproved = verifiedDocKeys.includes(shortField);
                const docSigned = hasDocSignature(esignBundle, shortField);
                const isOpen = viewerDocKey === shortField;

                return (
                  <div
                    key={shortField}
                    className={`rounded-xl border bg-white p-4 shadow-2xs transition ${
                      isApproved
                        ? "border-emerald-200 bg-emerald-50/10"
                        : isOpen
                        ? "border-primary-300 ring-2 ring-primary-100"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-900">{label}</h4>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            {docType}
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            {docNumber}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Issued: {issueDate ? formatDate(issueDate) : "—"} · Valid Till: {expiryDate ? formatDate(expiryDate) : "—"}
                          {pdfName ? ` · File: ${pdfName}` : ""}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            docSigned
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : isApproved
                              ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                          }`}
                        >
                          {docSigned ? "Signed ✓" : isApproved ? "Verified ✓" : "Verification Pending"}
                        </span>

                        {hasPdf ? (
                          <button
                            type="button"
                            onClick={() => void handleViewPdf(shortField)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold text-white transition ${
                              isOpen ? "bg-slate-800 hover:bg-slate-700" : "bg-primary-700 hover:bg-primary-800"
                            }`}
                          >
                            {isOpen
                              ? "Close Viewer"
                              : docSigned
                              ? "View Signed PDF"
                              : canEsign
                              ? "Sign Document"
                              : "View & Verify"}
                          </button>
                        ) : (
                          <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                            No PDF attached
                          </span>
                        )}

                        <label
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                            !isViewed || submitted || false
                              ? "cursor-not-allowed text-slate-400"
                              : "cursor-pointer text-slate-900"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isApproved}
                            disabled={!isViewed || submitted || false}
                            onChange={(e) => handleApproveToggle(shortField, e.target.checked)}
                            className="h-4 w-4 accent-emerald-700"
                          />
                          Verify Instrument
                        </label>
                      </div>
                    </div>

                    {note ? (
                      <div className="mt-2.5 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-600">
                        <strong className="text-slate-700">Supplier Note:</strong> {note}
                      </div>
                    ) : null}

                    {isOpen && legalDocs && fileUrl ? (
                      <Suspense
                        fallback={
                          <div className="mt-4 flex min-h-[320px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
                            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                          </div>
                        }
                      >
                        <div className="mt-4 pt-3 border-t border-slate-100">
                          <LegalPdfViewer
                            key={`${shortField}:${String(fileUrl)}`}
                            review={legalDocs}
                            documentKey={shortField}
                            fileUrl={String(fileUrl)}
                            canSign={Boolean(canEsign && eligibilitySnapshot?.canSignDocumentKeys.includes(shortField))}
                            esignDisabledReason={docSigned ? "Document has already been signed." : esignDisabledReason}
                            requiredDocuments={attachedDocKeys.map(key => ({ key, label: key === "terms" ? "Master Terms & Conditions" : key === "warranty" ? "Quality & Compliance Warranty" : "Liability Insurance Certificate", verified: verifiedDocKeys.includes(key) }))}
                            eligibilityRefreshing={signatureEligibility.isFetching}
                            onRefreshEligibility={() => { void signatureEligibility.refetch(); }}
                            canReview={!submitted && (user?.role === "legal" || user?.role === "admin")}
                            readOnly={user?.role !== "legal" && user?.role !== "admin"}
                            reviewerFullName={
                              user?.full_name ||
                              user?.email ||
                              user?.name ||
                              "Legal Manager"
                            }
                            reviewerId={user?.email || user?.name || "legal"}
                            esignBundle={esignBundle}
                            onBundleChange={(_bundle, updated) => {
                              setLegalDocs(updated);
                              setShowReviewRequiredWarning(false);
                              void refreshLegalDocs();
                            }}
                          />
                        </div>
                      </Suspense>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleSection>

        {/* ═══════════════ Section 5: Legal Exceptions ═══════════════ */}
        <CollapsibleSection
          id="exceptions"
          icon={ShieldAlert}
          title="Legal Exceptions & Risk Log"
          expanded={expandedSections.exceptions}
          onToggle={toggleSection}
          badge={
            conditionsExceptions.trim() ? (
              <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200">
                1 Exception Logged
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
                No Exceptions
              </span>
            )
          }
        >
          <div className="space-y-4">
            {conditionsExceptions.trim() ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-rose-900">
                      Contractual Deviation / Exception Identified
                    </h4>
                    <p className="mt-1 text-xs text-rose-800 leading-relaxed whitespace-pre-wrap">
                      {conditionsExceptions}
                    </p>
                    <div className="mt-3 flex items-center gap-4 text-[11px] text-rose-700">
                      <span><strong>Severity:</strong> Moderate / Requires Commercial Confirmation</span>
                      <span><strong>Status:</strong> Active Review Condition</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-emerald-900">
                    No legal exceptions identified.
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-700">
                    The supplier quotation fully conforms with corporate legal standards, liability cappings, and Netlink standard warranties.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* ═══════════════ Section: Decision Comments ═══════════════
            This single field is what gets written to ERPNext's
            `legal_comments` (Approve or Reject) and `rejection_reason`
            (Reject only) the moment a decision is submitted below. */}
        <CollapsibleSection
          id="notes"
          icon={Gavel}
          title="Decision Comments"
          expanded={expandedSections.notes}
          onToggle={toggleSection}
        >
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Comments <span className="text-danger-500">*</span>
            </label>
            <textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Provide the reason for your approval or rejection. This is mandatory before submitting a decision and is saved permanently on the Legal Document Review record."
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
        </CollapsibleSection>

        {/* ═══════════════ Section: Review Timeline ═══════════════
            Every fact shown here is read live from ERPNext — the "Legal
            Document Review" record (submission_date / procurement_manager /
            review_status / approved_by / approved_on) and the RFQ's own
            custom_finance_* fields. Nothing is read from localStorage. */}
        <CollapsibleSection
          id="timeline"
          icon={Clock}
          title="Review Timeline"
          expanded={expandedSections.timeline}
          onToggle={toggleSection}
        >
          <div className="space-y-3">
            <TimelineStep
              icon={Layers}
              label="RFQ Submitted for Legal Review"
              date={legalDocs?.submission_date}
              by={legalDocs?.procurement_manager ?? rfq?.owner}
              active
            />
            <TimelineStep
              icon={Scale}
              label="Legal Review"
              date={legalDocs?.approved_on}
              by={legalDocs?.approved_by}
              status={currentLegalStatus}
              active={currentLegalStatus !== "Pending"}
            />
            <TimelineStep
              icon={DollarSign}
              label="Finance Review"
              date={(rfq as unknown as Record<string, unknown> | undefined)?.custom_finance_review_date as string | undefined}
              by={(rfq as unknown as Record<string, unknown> | undefined)?.custom_finance_reviewer as string | undefined}
              active={currentLegalStatus === "Approved"}
              dimmed={currentLegalStatus !== "Approved"}
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════ Section: Legal Decision ═══════════════ */}
        <CollapsibleSection
          id="actions"
          icon={Gavel}
          title="Legal Review Decision"
          expanded={expandedSections.actions}
          onToggle={toggleSection}
        >
          <div className="space-y-4">
            {/* Conditions / Exceptions */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Conditions / Exceptions <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <textarea
                value={conditionsExceptions}
                onChange={(e) => setConditionsExceptions(e.target.value)}
                placeholder="Specify any contractual conditions, coverage waivers, or warranty exceptions attached to this legal decision..."
                rows={2}
                disabled={submitted}
                className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
              />
            </div>

            {/* Decision Comments */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Decision Comments <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="Provide the reason for your approval, rejection, or clarification. This is mandatory before submitting a decision."
                rows={3}
                disabled={submitted}
                className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
              />
              {!submitted && !actionReason.trim() && (
                <p className="mt-1 text-xs text-slate-400">
                  Decision comments are mandatory before any decision can be finalized.
                </p>
              )}
            </div>

            {/* 3 Action Buttons */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                {/* Approve Button */}
                {canApprove && (
                  <button
                    type="button"
                    disabled={submitted || submitting || !actionReason.trim()}
                    onClick={async () => {
                      if (!legalDocs?.name) {
                        toast.error("No Legal Document Review record found");
                        return;
                      }
                      if (!actionReason.trim()) {
                        toast.error("Provide a decision comment before approving.");
                        return;
                      }
                      setSubmitting(true);
                      try {
                        const fullReason = conditionsExceptions.trim()
                          ? `${actionReason.trim()}\n[Exceptions]: ${conditionsExceptions.trim()}`
                          : actionReason.trim();

                        const updated = await submitLegalReview(
                          legalDocs.name,
                          "Approved",
                          user?.email ?? "System",
                          fullReason,
                        );
                        setLegalDocs(updated);
                        invalidateApprovalWorkflow(queryClient);
                        await Promise.all([
                          queryClient.invalidateQueries({ queryKey: ["legal-document-reviews"] }),
                          queryClient.invalidateQueries({ queryKey: ["legal-signature-eligibility"] }),
                          queryClient.invalidateQueries({ queryKey: ["selected-sq-raw", selectedSQName] }),
                        ]);
                        toast.success("Legal review approved");
                      } catch (err) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : "Failed to approve legal review",
                        );
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? "Approving…" : "Approve Legal Review"}
                  </button>
                )}

                {/* Reject Button */}
                <button
                  type="button"
                  disabled={submitted || submitting || !actionReason.trim()}
                  onClick={async () => {
                    if (!legalDocs?.name) {
                      toast.error("No Legal Document Review record found");
                      return;
                    }
                    if (!actionReason.trim()) {
                      toast.error("Provide a rejection reason before rejecting.");
                      return;
                    }
                    setSubmitting(true);
                    try {
                      const fullReason = conditionsExceptions.trim()
                        ? `${actionReason.trim()}\n[Exceptions]: ${conditionsExceptions.trim()}`
                        : actionReason.trim();

                      const updated = await submitLegalReview(
                        legalDocs.name,
                        "Rejected",
                        user?.email ?? "System",
                        fullReason,
                        fullReason,
                      );
                      setLegalDocs(updated);
                      invalidateApprovalWorkflow(queryClient);
                      toast.error("Legal review rejected");
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Failed to update legal review",
                      );
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reject Legal Review
                </button>

                {/* Request Revision / Clarification Button */}
                <button
                  type="button"
                  disabled={submitted || submitting}
                  onClick={() => setShowClarifyModal(true)}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Request Revision
                </button>
              </div>

              <p className="max-w-md text-xs text-slate-600">
                Completing every required electronic signature sends this RFQ to Finance Review automatically.
                Finance approval is then required before Procurement can create a PO.
              </p>
            </div>

            {!allInstrumentsVerified && !submitted && (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-2xs"
              >
                <p className="flex items-center gap-2 font-bold text-amber-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  Document Verification Required Before Approval ({verifiedDocKeys.length}/{attachedDocKeys.length} Verified)
                </p>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Inspect and verify every required supplier document in Section 4 before approving this legal review.
                  {pendingDocKeys.length > 0 && ` Pending verification: ${pendingDocKeys.map(k => k === "terms" ? "Master Terms & Conditions" : k === "warranty" ? "Quality & Compliance Warranty" : "Liability Insurance Certificate").join(", ")}.`}
                </p>
              </div>
            )}

            {!hasSignatures && !submitted && (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900 shadow-2xs"
              >
                <p className="flex items-center gap-2 font-bold text-blue-800">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-blue-600" />
                  E-Signature Required Before Finance Review
                </p>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Verify and electronically sign every required instrument in Section 4. SHA-256 verifies document integrity; it is not a digital signature.
                </p>
              </div>
            )}

            {!isChecklistFullyApproved && !submitted && (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-2xs"
              >
                <p className="flex items-center gap-2 font-bold text-amber-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  Legal Review Checkpoints Incomplete ({completedCount}/8 Completed)
                </p>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Record findings in the legal checklist. RFQ e-signature eligibility is determined by the required documents, verified PDF hashes, and Legal workflow state.
                </p>
              </div>
            )}

            {showReviewRequiredWarning && !documentsReviewed && !submitted ? (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 shadow-2xs"
              >
                <p className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                  Document Review Required
                </p>
                <p className="mt-1 text-slate-600">
                  Open each PDF, inspect its contents, and mark it reviewed before submitting approval.
                </p>
              </div>
            ) : null}

            {legalDocs?.review_status !== "Pending" && (
              <div
                className={`mt-4 rounded-xl border p-4 text-xs ${
                  legalDocs?.review_status === "Approved"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-rose-200 bg-rose-50 text-rose-900"
                }`}
              >
                <p className="font-bold">
                  {legalDocs?.review_status === "Approved" ? "✅ Approved" : "❌ Rejected"}{" "}
                  by {legalDocs?.approved_by} on {legalDocs?.approved_on ? formatDate(legalDocs.approved_on) : ""}
                </p>
                {legalDocs?.legal_comments && (
                  <p className="mt-1.5 text-slate-700">{legalDocs.legal_comments}</p>
                )}
                {legalDocs?.review_status === "Rejected" && legalDocs?.rejection_reason && (
                  <p className="mt-1 text-rose-700 font-semibold">
                    Rejection reason: {legalDocs.rejection_reason}
                  </p>
                )}
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Modal for Request Clarification */}
        {showClarifyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                  <AlertTriangle className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Request Revision / Clarification
                  </h3>
                  <p className="text-xs text-slate-500">
                    Send required revisions or compliance inquiry to Procurement and Supplier
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Clarification Inquiry <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={clarifyComments}
                  onChange={(e) => setClarifyComments(e.target.value)}
                  placeholder="Specify what additional documentation, term revisions, or compliance clarifications are required..."
                  rows={4}
                  className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowClarifyModal(false)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!clarifyComments.trim() || submitting}
                  onClick={async () => {
                    if (!legalDocs?.name) return;
                    setSubmitting(true);
                    try {
                      const updated = await requestLegalChanges(legalDocs.name, clarifyComments.trim());
                      setLegalDocs(updated);
                      invalidateApprovalWorkflow(queryClient);
                      setShowClarifyModal(false);
                      toast.success("Changes requested. Review returned to Procurement.");
                    } catch (err) { toast.error(err instanceof Error ? err.message : "Changes request was not saved."); }
                    finally { setSubmitting(false); }
                  }}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Send Request
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal for Checkpoint Review */}
        {activeReviewItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-200">
                    <Scale className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 leading-tight">
                      Review: {activeReviewItem.point}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {activeReviewItem.category}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveReviewItem(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {/* Decision Status */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-700">
                    Checkpoint Decision Status <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={reviewModalStatus}
                    onChange={(e) => setReviewModalStatus(e.target.value as ChecklistStatus)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Pending">Pending Review</option>
                    <option value="Compliant">Compliant</option>
                    <option value="Non-Compliant">Non-Compliant</option>
                    <option value="Exception">Exception</option>
                    <option value="Not Applicable">Not Applicable</option>
                    <option value="Requires Clarification">Requires Clarification</option>
                  </select>
                </div>

                {/* Structured Fields if Exception */}
                {reviewModalStatus === "Exception" && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
                      <AlertTriangle className="h-4 w-4" />
                      Exception Details
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-rose-900">
                        Exception Description <span className="text-rose-600">*</span>
                      </label>
                      <textarea
                        value={reviewModalException.description}
                        onChange={(e) =>
                          setReviewModalException((prev) => ({ ...prev, description: e.target.value }))
                        }
                        placeholder="Detailed description of legal, statutory, or commercial deviation..."
                        rows={2}
                        className="w-full rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-rose-900">
                          Severity Level
                        </label>
                        <select
                          value={reviewModalException.severity}
                          onChange={(e) =>
                            setReviewModalException((prev) => ({
                              ...prev,
                              severity: e.target.value as CheckpointExceptionDetails["severity"],
                            }))
                          }
                          className="w-full rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-rose-500"
                        >
                          <option value="Low">Low Severity</option>
                          <option value="Medium">Medium Severity</option>
                          <option value="High">High Severity</option>
                          <option value="Critical">Critical Severity</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-rose-900">
                          Business Impact
                        </label>
                        <input
                          type="text"
                          value={reviewModalException.businessImpact || ""}
                          onChange={(e) =>
                            setReviewModalException((prev) => ({ ...prev, businessImpact: e.target.value }))
                          }
                          placeholder="e.g., Uncapped liability, payment term clash"
                          className="w-full rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-rose-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-rose-900">
                        Required Resolution
                      </label>
                      <input
                        type="text"
                        value={reviewModalException.requiredResolution || ""}
                        onChange={(e) =>
                          setReviewModalException((prev) => ({ ...prev, requiredResolution: e.target.value }))
                        }
                        placeholder="Action needed before contract execution"
                        className="w-full rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      />
                    </div>
                  </div>
                )}

                {/* Structured Fields if Requires Clarification */}
                {reviewModalStatus === "Requires Clarification" && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
                      <HelpCircle className="h-4 w-4" />
                      Clarification Request Details
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-amber-900">
                        Clarification Required <span className="text-amber-600">*</span>
                      </label>
                      <textarea
                        value={reviewModalClarification.inquiry}
                        onChange={(e) =>
                          setReviewModalClarification((prev) => ({ ...prev, inquiry: e.target.value }))
                        }
                        placeholder="Specify questions, missing certs, or amended terms needed..."
                        rows={2}
                        className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-amber-900">
                          Clarification Owner
                        </label>
                        <input
                          type="text"
                          value={reviewModalClarification.owner || ""}
                          onChange={(e) =>
                            setReviewModalClarification((prev) => ({ ...prev, owner: e.target.value }))
                          }
                          placeholder="e.g. Procurement Manager / Supplier Legal"
                          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-amber-900">
                          Due Date
                        </label>
                        <input
                          type="date"
                          value={reviewModalClarification.dueDate || ""}
                          onChange={(e) =>
                            setReviewModalClarification((prev) => ({ ...prev, dueDate: e.target.value }))
                          }
                          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Remarks & Legal Observations */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-700">
                    Remarks / Legal Observations
                  </label>
                  <textarea
                    value={reviewModalRemarks}
                    onChange={(e) => setReviewModalRemarks(e.target.value)}
                    placeholder="Enter legal observations, exceptions, or required actions..."
                    rows={3}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setActiveReviewItem(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveReviewModal}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-2xs"
                >
                  Save Decision
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </FadeIn>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function CollapsibleSection({
  id,
  icon: Icon,
  title,
  expanded,
  onToggle,
  badge,
  children,
}: {
  id: string;
  icon: typeof FileText;
  title: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100">
          <Icon className="h-4 w-4 text-neutral-600" />
        </div>
        <span className="flex-1 text-sm font-bold text-neutral-900">{title}</span>
        {badge}
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-neutral-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-neutral-400" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-neutral-100 px-5 py-4">{children}</div>
      )}
    </div>
  );
}

function InfoField({
  label,
  value,
  highlight,
}: {
  label: string;
  value?: string | null;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      <p className={`mt-0.5 text-sm ${highlight ? "font-bold text-primary" : "font-medium text-neutral-900"}`}>
        {value || "—"}
      </p>
    </div>
  );
}



function LegalStatusBadge({ status }: { status: DocReviewStatus }) {
  const config: Record<DocReviewStatus, { icon: typeof Clock; className: string; label: string }> = {
    Pending: { icon: Clock, className: "bg-warning-100 text-warning-700 ring-warning-200", label: "Pending Review" },
    Approved: { icon: CheckCircle2, className: "bg-success-100 text-success-700 ring-success-200", label: "Approved" },
    Rejected: { icon: XCircle, className: "bg-danger-100 text-danger-700 ring-danger-200", label: "Legal Rejected" },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${c.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {c.label}
    </span>
  );
}

function ActionBadge({ action }: { action: DocReviewStatus }) {
  const cls =
    action === "Approved"
      ? "bg-success-100 text-success-700"
      : action === "Rejected"
      ? "bg-danger-100 text-danger-700"
      : "bg-neutral-100 text-neutral-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      {action}
    </span>
  );
}

function TimelineStep({
  icon: Icon,
  label,
  date,
  by,
  status,
  active,
  dimmed,
}: {
  icon: typeof Clock;
  label: string;
  date?: string;
  by?: string;
  status?: DocReviewStatus;
  active?: boolean;
  dimmed?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 ${dimmed ? "opacity-40" : ""}`}>
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
          active ? "bg-primary/10 text-primary" : "bg-neutral-100 text-neutral-400"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 pt-1">
        <p className="text-sm font-semibold text-neutral-900">{label}</p>
        {(date || by || status) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            {by && <span>{by}</span>}
            {date && <span>{formatDate(date)}</span>}
            {status && status !== "Pending" && (
              <ActionBadge action={status} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
