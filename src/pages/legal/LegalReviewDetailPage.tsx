import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Eye,
  FileText,
  Gavel,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  RefreshCw,
  Scale,
  Send,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";

import { getRFQ, getSupplierQuotations, fetchRawSQ } from "../../api/sourcing";
import {
  getLegalDocs,
  getOrCreateLegalDocs,
  updateLegalDocField,
  updateLegalDocFlag,
  submitLegalReview,
} from "../../api/legalDocs";
import type { LegalDocumentSet, LegalDocFlagField } from "../../api/legalDocs";
import {
  getApprovalState,
  saveApprovalState,
} from "../../api/rfqApprovalWorkflow";
import { updateReviewStatus, addComment } from "../../api/legalReviews";
import { addNotification } from "../../api/notifications";
import { getFileObjectUrl, storeFileBlob } from "../../api/legalDocsStorage";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDate } from "../../utils/format";
import { Skeleton } from "../../components/Skeleton";
import type {
  RFQ,
  SupplierQuotation,
  RFQApprovalState,
  AIRecommendation,
  LegalReviewStatus,
} from "../../types/erpnext";

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

const DOC_REVIEW_ITEMS = [
  { id: "terms", label: "Terms & Conditions Review", docKey: "terms_pdf", noteKey: "terms_note", description: "Verify all contractual terms are acceptable and within company policy" },
  { id: "warranty", label: "Warranty Review", docKey: "warranty_pdf", noteKey: "warranty_note", description: "Validate warranty terms, duration, and coverage" },
  { id: "insurance", label: "Insurance Review", docKey: "insurance_pdf", noteKey: "insurance_note", description: "Verify supplier insurance certificates and coverage adequacy" },
];

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function LegalReviewDetailPage() {
  const { rfqId, sqName } = useParams<{ rfqId?: string; sqName?: string }>();
  const user = useAuthStore((s) => s.user);

  const docsFromSq = useMemo(() => {
    if (sqName) {
      return getLegalDocs(sqName);
    }
    return null;
  }, [sqName]);

  const decodedId = useMemo(() => {
    if (rfqId) return decodeURIComponent(rfqId);
    if (docsFromSq?.rfq_name) return docsFromSq.rfq_name;
    return "";
  }, [rfqId, docsFromSq]);

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

  const approvalState = useMemo(() => {
    if (!decodedId) return null;
    const existing = getApprovalState(decodedId);
    if (existing) {
      // eslint-disable-next-line no-console
      console.log("[LegalReviewDetail] Approval state found:", existing.workflow_step);
      return existing;
    }

    if (!rfq) return null;

    const firstSupplier =
      rfqSuppliers[0]?.supplier ??
      quotations[0]?.supplier ??
      "";
    const bestQuote = quotations.length > 0
      ? quotations.reduce((best, q) =>
          (q.grand_total ?? 0) > (best.grand_total ?? 0) ? q : best
        )
      : null;

    // eslint-disable-next-line no-console
    console.log("[LegalReviewDetail] No approval state — creating from RFQ:", decodedId, "supplier:", firstSupplier);
    const tempState: RFQApprovalState = {
      rfq: decodedId,
      rfq_title: parsed.title,
      company: rfq.company ?? "",
      selected_supplier: firstSupplier,
      selected_supplier_total: bestQuote?.grand_total ?? 0,
      workflow_step: "Pending Legal Review",
      legal_status: "Pending Legal Review",
      finance_status: "Pending Finance Review",
      submitted_at: rfq.creation ?? new Date().toISOString(),
      submitted_by: rfq.owner ?? "",
      legal_comments: [],
      finance_comments: [],
    };
    saveApprovalState(tempState);
    return tempState;
  }, [decodedId, rfq, rfqSuppliers, quotations]);

  const selectedSupplier = useMemo(() => {
    if (sqName && docsFromSq?.supplier) return docsFromSq.supplier;
    return approvalState?.selected_supplier;
  }, [sqName, docsFromSq, approvalState]);

  const aiAnalysis = useMemo(() => readSavedAnalysis(decodedId), [decodedId]);

  /* ── Selected Supplier Quotation — fetch ONLY the one SQ for the selected supplier ── */

  // Step 1: Determine the selected SQ name from the quotations list
  const selectedSQName = useMemo(() => {
    if (sqName) return sqName;
    if (!selectedSupplier || quotations.length === 0) return null;
    const match = quotations.find((q) => q.supplier === selectedSupplier);
    return match?.name ?? null;
  }, [sqName, selectedSupplier, quotations]);

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

  const [legalDocs, setLegalDocs] = useState<LegalDocumentSet | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pdfUrls, setPdfUrls] = useState<Record<string, string>>({});
  const [pdfLoadError, setPdfLoadError] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[LegalReview] Component mounted/updated')
    // eslint-disable-next-line no-console
    console.log('[LegalReview] sqName param/prop:', selectedSQName)
    // eslint-disable-next-line no-console
    console.log('[LegalReview] typeof sqName:', typeof selectedSQName)

    if (selectedSQName) {
      const directKey = `legal_docs_${selectedSQName}`
      // eslint-disable-next-line no-console
      console.log('[LegalReview] Looking for localStorage key:', directKey)
      // eslint-disable-next-line no-console
      console.log('[LegalReview] Raw value found:', localStorage.getItem(directKey))

      const docs = getLegalDocs(selectedSQName);
      // eslint-disable-next-line no-console
      console.log('[LegalReview] getLegalDocs() returned:', docs)
      // eslint-disable-next-line no-console
      console.log('[LegalReview] Full index:', localStorage.getItem('legal_docs_index'))
      // eslint-disable-next-line no-console
      console.log('[LegalReview] Full legalDocs object:', JSON.stringify(docs, null, 2))

      setLegalDocs(docs);
    } else {
      // eslint-disable-next-line no-console
      console.warn('[LegalReview] sqName is empty/undefined — cannot look up documents')
      setLegalDocs(null);
    }
  }, [selectedSQName]);

  useEffect(() => {
    if (!legalDocs) return;

    const loadAllPdfs = async () => {
      const fields = ['terms_pdf', 'warranty_pdf', 'insurance_pdf'];
      const urls: Record<string, string> = {};
      const errors: Record<string, boolean> = {};

      for (const field of fields) {
        const key = (legalDocs as any)[`${field}_key`];
        // eslint-disable-next-line no-console
        console.log(`[PDF Load] ${field} — key:`, key);
        if (key) {
          try {
            const url = await getFileObjectUrl(key);
            // eslint-disable-next-line no-console
            console.log(`[PDF Load] ${field} — resolved URL:`, url ? 'SUCCESS' : 'NULL (blob not found in IndexedDB)');
            if (url) {
              urls[field] = url;
            } else {
              errors[field] = true;
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[PDF Load] ${field} — error:`, err);
            errors[field] = true;
          }
        }
      }
      setPdfUrls(urls);
      setPdfLoadError(errors);
    };

    loadAllPdfs();

    // Cleanup object URLs when component unmounts to avoid memory leaks
    return () => {
      Object.values(pdfUrls).forEach(url => URL.revokeObjectURL(url));
    };
  }, [legalDocs]);

  const handleUpload = async (
    field: 'terms_pdf' | 'warranty_pdf' | 'insurance_pdf',
    file: File
  ) => {
    if (!selectedSQName) return;
    setUploading(field);
    try {
      const permanentKey = `${selectedSQName}_${field}_pdf`;
      await storeFileBlob(permanentKey, file);
      let updated = updateLegalDocField(selectedSQName, `${field}_key` as any, permanentKey);
      updated = updateLegalDocField(selectedSQName, `${field}_name` as any, file.name);
      setLegalDocs(updated);
      toast.success(`${field.replace('_pdf', '').toUpperCase()} document uploaded`);
    } catch (err: any) {
      toast.error('Upload failed: ' + err.message);
    } finally {
      setUploading(null);
    }
  };

  const handleNoteChange = (
    field: 'terms_note' | 'warranty_note' | 'insurance_note',
    value: string
  ) => {
    if (!selectedSQName) return;
    const updated = updateLegalDocField(selectedSQName, field, value);
    setLegalDocs(updated);
  };

  const handleViewPdf = useCallback((
    field: 'terms_pdf' | 'warranty_pdf' | 'insurance_pdf',
    erpnextUrl?: string
  ) => {
    const url = pdfUrls[field] || erpnextUrl;
    if (!url) {
      toast.error('PDF not available');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');

    if (!selectedSQName) return;
    const shortField = field.replace('_pdf', '');
    const viewedField = `${shortField}_viewed` as LegalDocFlagField;
    const updated = updateLegalDocFlag(selectedSQName, viewedField, true);
    if (updated) setLegalDocs(updated);
  }, [pdfUrls, selectedSQName]);

  const handleApproveToggle = useCallback((
    field: 'terms' | 'warranty' | 'insurance',
    checked: boolean
  ) => {
    if (!selectedSQName) return;
    const approvedField = `${field}_approved` as LegalDocFlagField;
    const updated = updateLegalDocFlag(selectedSQName, approvedField, checked);
    if (updated) {
      setLegalDocs(updated);
      if (approvalState) {
        approvalState[`${field}_approved` as 'terms_approved' | 'warranty_approved' | 'insurance_approved'] = checked;
        saveApprovalState(approvalState);
      }
    }
  }, [selectedSQName, approvalState]);

  const allApproved = !!(
    legalDocs?.terms_approved &&
    legalDocs?.warranty_approved &&
    legalDocs?.insurance_approved
  );

  const checklistComplete = allApproved;

  /* ── Notes ── */
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionReason, setActionReason] = useState("");

  /* ── Expanded sections ── */
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    summary: true,
    supplier: true,
    ai: false,
    checklist: true,
    notes: true,
    timeline: false,
    actions: true,
  });

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  /* ── Submission state ── */
  const [submitting, setSubmitting] = useState<LegalReviewStatus | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (approvalState?.legal_status === "Pending Legal Review") {
      setSubmitted(false);
    } else if (approvalState?.legal_status) {
      setSubmitted(true);
    }
  }, [approvalState?.legal_status]);

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
      const statusMap: Record<string, LegalReviewStatus> = {
        approve: "Approved",
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
        if (approvalState) {
          approvalState.terms_approved = !!legalDocs?.terms_approved;
          approvalState.warranty_approved = !!legalDocs?.warranty_approved;
          approvalState.insurance_approved = !!legalDocs?.insurance_approved;
          approvalState.legal_reviewer = user?.email ?? "";
          approvalState.legal_review_date = new Date().toISOString();
          saveApprovalState(approvalState);
        }
        await updateReviewStatus(decodedId, status, user?.email ?? "", fullComment);
        const labels = { approve: "approved", reject: "rejected" };
        toast.success(`RFQ ${decodedId} ${labels[action]}`);
        setSubmitted(true);
      } catch {
        toast.error("Failed to update review status");
      } finally {
        setSubmitting(null);
      }
    },
    [decodedId, user?.email, reviewNotes, actionReason, legalDocs, approvalState]
  );

  const handleAddComment = useCallback(async () => {
    if (!newComment.trim()) return;
    setAddingComment(true);
    try {
      addComment(decodedId, {
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

  const approvedCount = useMemo(() => {
    return [
      legalDocs?.terms_approved,
      legalDocs?.warranty_approved,
      legalDocs?.insurance_approved,
    ].filter(Boolean).length;
  }, [
    legalDocs?.terms_approved,
    legalDocs?.warranty_approved,
    legalDocs?.insurance_approved,
  ]);

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
    const isNotFound =
      errMsg.includes("does not exist") ||
      errMsg.includes("DoesNotExistError");
    // eslint-disable-next-line no-console
    console.error("[LegalReviewDetail] RFQ load failed:", {
      requestedId: decodedId,
      rawParam: rfqId,
      errorMessage: errMsg,
      fullError: rfqQuery.error,
    });
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="mb-4 h-12 w-12 text-danger-400" />
        <h2 className="text-lg font-bold text-neutral-900">
          {isNotFound ? "RFQ Not Found" : "Error Loading RFQ"}
        </h2>
        <p className="mt-2 max-w-md text-center text-sm text-neutral-600">
          {isNotFound ? (
            <>
              <span className="font-semibold">Request for Quotation</span>{" "}
              "{decodedId}" does not exist in ERPNext.
              <br />
              It may have been deleted or the ID may be incorrect.
            </>
          ) : (
            errMsg
          )}
        </p>
        <p className="mt-3 text-xs text-neutral-400">
          DocType: Request for Quotation &middot; Document: {decodedId}
        </p>
        <Link
          to="/sourcing/legal-reviews"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Legal Reviews
        </Link>
      </div>
    );
  }

  // eslint-disable-next-line no-console
  console.log("[LegalReviewDetail] Page rendered", {
    rfqName: rfq.name,
    items: rfqItems.length,
    suppliers: rfqSuppliers.length,
    approvalState: approvalState?.workflow_step ?? "none",
    hasAI: !!aiAnalysis,
  });

  const selectedQuote = quotations.find(
    (q) => q.supplier === selectedSupplier || q.supplier_name === selectedSupplier
  );
  const aiSupplier = aiAnalysis?.supplier_analysis?.find(
    (s) => s.name === selectedSupplier
  );

  const currentLegalStatus = approvalState?.legal_status ?? "Pending Legal Review";
  const comments = approvalState?.legal_comments ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      {/* ── Header ── */}
      <div className="mb-6">
        <Link
          to="/sourcing/legal-reviews"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Legal Reviews
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Scale className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-neutral-900">
                  Legal Review Workspace
                </h1>
                <p className="text-sm text-neutral-500">
                  {parsed.title ?? decodedId}
                </p>
              </div>
            </div>
          </div>
          <LegalStatusBadge status={currentLegalStatus} />
        </div>
      </div>

      {/* ── Reviewer / Timestamp Banner ── */}
      {approvalState?.legal_reviewer && submitted && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <User className="h-4 w-4 text-neutral-400" />
          <div className="text-sm text-neutral-600">
            Reviewed by{" "}
            <span className="font-semibold text-neutral-900">
              {approvalState.legal_reviewer}
            </span>
            {approvalState.legal_review_date && (
              <> on {formatDate(approvalState.legal_review_date)}</>
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
            <InfoField label="Created By" value={rfq.owner} />
            <InfoField label="Transaction Date" value={formatDate(rfq.transaction_date)} />
            <InfoField label="Valid Till" value={parsed.validTill ?? "—"} />
            <InfoField label="Status" value={rfq.status ?? "Draft"} />
            <InfoField label="Company" value={rfq.company ?? "—"} />
          </div>
          {parsed.body && (
            <div className="mt-4 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                Message for Supplier
              </p>
              <p className="text-sm leading-relaxed text-neutral-700 whitespace-pre-wrap">
                {parsed.body}
              </p>
            </div>
          )}
          {rfq.terms && (
            <div className="mt-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                Terms & Conditions
              </p>
              <p className="text-sm leading-relaxed text-neutral-700 whitespace-pre-wrap">
                {rfq.terms}
              </p>
            </div>
          )}

          {/* Items Table */}
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
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">Schedule Date</th>
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
                        <td className="px-3 py-2 text-neutral-600">{item.schedule_date ? formatDate(item.schedule_date) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: Supplier Information ═══════════════ */}
        <CollapsibleSection
          id="supplier"
          icon={Building2}
          title="Supplier & Quotation Details"
          expanded={expandedSections.supplier}
          onToggle={toggleSection}
        >
          {selectedSupplier ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoField
                  label="Selected Supplier"
                  value={selectedSupplier}
                  highlight
                />
                <InfoField
                  label="Quotation Value"
                  value={
                    selectedQuote?.grand_total != null
                      ? formatCurrency(selectedQuote.grand_total)
                      : approvalState?.selected_supplier_total != null
                      ? formatCurrency(approvalState.selected_supplier_total)
                      : "—"
                  }
                  highlight
                />
                <InfoField
                  label="Submitted By"
                  value={approvalState?.submitted_by ?? "—"}
                />
              </div>

              {/* Supplier quotation items */}
              {selectedQuote && (selectedQuote.items ?? []).length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Quoted Line Items
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-neutral-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-100 bg-neutral-50/50">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">Item</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-500">Qty</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-500">Rate</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-500">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedQuote.items ?? []).map((item, idx) => (
                          <tr key={idx} className="border-b border-neutral-50 last:border-0">
                            <td className="px-3 py-2 font-medium text-neutral-900">{item.item_code}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{item.qty}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(item.rate)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(item.amount ?? item.qty * item.rate)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-neutral-200 bg-neutral-50/50">
                          <td colSpan={3} className="px-3 py-2 text-right text-xs font-bold uppercase text-neutral-500">
                            Grand Total
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-bold text-neutral-900">
                            {formatCurrency(selectedQuote.grand_total ?? 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* Other suppliers invited */}
              {rfqSuppliers.length > 1 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    All Invited Suppliers ({rfqSuppliers.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {rfqSuppliers.map((s) => (
                      <span
                        key={s.supplier}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                          s.supplier === selectedSupplier
                            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {s.supplier === selectedSupplier && <Award className="h-3 w-3" />}
                        {s.supplier}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              No supplier has been selected for this RFQ yet.
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: AI Recommendation ═══════════════ */}
        <CollapsibleSection
          id="ai"
          icon={Bot}
          title="AI Recommendation & Risk Assessment"
          expanded={expandedSections.ai}
          onToggle={toggleSection}
          badge={
            aiAnalysis ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                AI Analysis Available
              </span>
            ) : undefined
          }
        >
          {aiAnalysis ? (
            <div className="space-y-4">
              {/* Recommendation summary */}
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

              {/* Risk flags */}
              {(aiAnalysis.risk_flags ?? []).length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Risk Flags
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
                        <div>
                          <span className="mr-1.5 text-[10px] font-bold uppercase">{flag.severity}</span>
                          <span className="mr-1.5 text-[10px] font-bold uppercase text-neutral-400">
                            {flag.type}
                          </span>
                          <span>{flag.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected supplier scores */}
              {aiSupplier && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Selected Supplier Scores
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <ScoreCard label="Cost" value={aiSupplier.score.cost} />
                    <ScoreCard label="Delivery" value={aiSupplier.score.delivery} />
                    <ScoreCard label="Reliability" value={aiSupplier.score.reliability} />
                    <ScoreCard label="Overall" value={aiSupplier.score.overall} highlight />
                  </div>
                </div>
              )}

              {/* Final verdict */}
              <div className="rounded-lg bg-neutral-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                  Final Verdict
                </p>
                <p className="text-sm leading-relaxed text-neutral-700">
                  {aiAnalysis.final_verdict}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg bg-neutral-50 px-4 py-6 text-sm text-neutral-500">
              <Info className="h-5 w-5 flex-shrink-0" />
              No AI analysis has been performed for this RFQ yet.
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: Legal Document Review ═══════════════ */}
        <CollapsibleSection
          id="checklist"
          icon={ShieldCheck}
          title="Legal Document Review"
          expanded={expandedSections.checklist}
          onToggle={toggleSection}
          badge={
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{
                background: approvedCount === 3 ? '#dcfce7' : '#fef3c7',
                color: approvedCount === 3 ? '#15803d' : '#92400e',
              }}
            >
              {approvedCount}/3
            </span>
          }
        >
          {!legalDocs ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
              <div style={{ fontSize: '40px' }}>📭</div>
              <p className="font-semibold text-neutral-600 mt-2">No documents submitted yet for this Supplier Quotation.</p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>The supplier hasn't completed their quotation with legal attachments.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Approval Progress</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '100px', height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${(approvedCount / 3) * 100}%`, height: '100%', background: approvedCount === 3 ? '#2D6A4F' : '#f59e0b', transition: 'width 0.3s ease' }} />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: approvedCount === 3 ? '#2D6A4F' : '#f59e0b' }}>{approvedCount}/3</span>
                </div>
              </div>

              {[
                { field: 'terms_pdf' as const, shortField: 'terms' as const, label: 'Terms & Conditions', icon: '📄' },
                { field: 'warranty_pdf' as const, shortField: 'warranty' as const, label: 'Warranty Document', icon: '🛡️' },
                { field: 'insurance_pdf' as const, shortField: 'insurance' as const, label: 'Insurance Certificate', icon: '🏥' }
              ].map(({ field, shortField, label, icon }) => {
                const erpnextUrl = rawSQ?.[`custom_${shortField}_pdf`] as string | undefined;
                const pdfName = legalDocs?.[`${field}_name` as keyof LegalDocumentSet] as string | undefined
                  || (erpnextUrl ? erpnextUrl.split('/').pop() : undefined);
                const note = legalDocs?.[`${shortField}_note` as keyof LegalDocumentSet] as string | undefined
                  || (rawSQ?.[`custom_${shortField}_note`] as string | undefined);
                const url = pdfUrls[field] || erpnextUrl;
                const hasPdf = !!(legalDocs?.[`${field}_key` as keyof LegalDocumentSet] || erpnextUrl);
                const isViewed = !!legalDocs?.[`${shortField}_viewed` as keyof LegalDocumentSet];
                const isApproved = !!legalDocs?.[`${shortField}_approved` as keyof LegalDocumentSet];
                const loadFailed = pdfLoadError[field] && !erpnextUrl;

                return (
                  <div key={field} style={{
                    border: `1px solid ${isApproved ? '#86efac' : isViewed ? '#bfdbfe' : '#e5e7eb'}`,
                    borderRadius: '10px', padding: '16px', marginBottom: '12px',
                    background: isApproved ? '#f0fdf4' : 'white'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 700 }}>{icon} {label}</span>
                      {isViewed && (
                        <span style={{
                          padding: '3px 10px', background: '#eff6ff', color: '#1d4ed8',
                          borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                          display: 'flex', alignItems: 'center', gap: '4px'
                        }}>👁 Viewed</span>
                      )}
                    </div>

                    {pdfName && (
                      <div style={{ fontSize: '13px', color: '#374151', marginBottom: '10px' }}>
                        📎 {pdfName}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      {hasPdf ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleViewPdf(field, erpnextUrl)}
                            style={{
                              padding: '6px 16px', background: '#2D6A4F', color: 'white',
                              border: 'none', borderRadius: '6px', cursor: 'pointer',
                              fontSize: '13px', fontWeight: 600,
                              display: 'flex', alignItems: 'center', gap: '6px'
                            }}
                          >👁 View PDF</button>
                          {url && (
                            <a
                              href={url}
                              download={pdfName}
                              style={{
                                padding: '6px 16px', background: 'white', color: '#2D6A4F',
                                border: '1px solid #2D6A4F', borderRadius: '6px',
                                fontSize: '13px', fontWeight: 600, textDecoration: 'none',
                                display: 'flex', alignItems: 'center', gap: '6px'
                              }}
                            >⬇ Download PDF</a>
                          )}
                          {!url && loadFailed && (
                            <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 500, alignSelf: 'center' }}>
                              ⚠️ File data not found in browser storage
                            </span>
                          )}
                          {!url && !loadFailed && hasPdf && (
                            <span style={{ fontSize: '12px', color: '#9ca3af', alignSelf: 'center' }}>Loading PDF…</span>
                          )}
                        </>
                      ) : (
                        <span style={{
                          padding: '6px 16px', background: '#fee2e2', color: '#dc2626',
                          borderRadius: '6px', fontSize: '13px', fontWeight: 600
                        }}>PDF not available</span>
                      )}
                    </div>

                    <div style={{
                      background: '#f9fafb', border: '1px solid #e5e7eb',
                      borderRadius: '6px', padding: '10px 12px', marginBottom: '12px',
                      fontSize: '13px', color: '#374151'
                    }}>
                      <strong>Supplier Note:</strong> {note ? note : <span style={{ color: '#9ca3af' }}>(none)</span>}
                    </div>

                    <label style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      fontSize: '13px', fontWeight: 600,
                      color: !isViewed || submitted ? '#9ca3af' : '#111',
                      cursor: !isViewed || submitted ? 'not-allowed' : 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={isApproved}
                        disabled={!isViewed || submitted}
                        onChange={e => handleApproveToggle(shortField, e.target.checked)}
                        style={{ accentColor: '#2D6A4F', width: '16px', height: '16px' }}
                      />
                      Approve
                      {!isViewed && (
                        <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 400 }}>
                          (view PDF first)
                        </span>
                      )}
                    </label>
                  </div>
                )
              })}
            </div>
          )}
          {legalDocs && !checklistComplete && !submitted && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-xs font-medium text-warning-700">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              View each PDF, then approve all three documents before submitting your decision.
            </div>
          )}
        </CollapsibleSection>

        {/* ═══════════════ Section: Review Notes ═══════════════ */}
        <CollapsibleSection
          id="notes"
          icon={MessageSquare}
          title="Review Notes & Reasoning"
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
                placeholder="General observations, concerns, or notes about this RFQ…"
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
                placeholder="Provide the reason for your approval, rejection, or change request. This is mandatory before submitting a decision."
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

        {/* ═══════════════ Section: Comments / Timeline ═══════════════ */}
        <CollapsibleSection
          id="timeline"
          icon={Clock}
          title="Review Timeline & Comments"
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
              status={currentLegalStatus}
              active={currentLegalStatus !== "Pending Legal Review"}
            />
            <TimelineStep
              icon={DollarSign}
              label="Finance Review"
              date={approvalState?.finance_review_date}
              by={approvalState?.finance_reviewer}
              active={currentLegalStatus === "Approved"}
              dimmed={currentLegalStatus !== "Approved"}
            />
          </div>

          {/* Document Approval Audit */}
          {(approvalState?.terms_approved || approvalState?.warranty_approved || approvalState?.insurance_approved) && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Document Approvals
              </p>
              <div className="space-y-1.5">
                {DOC_REVIEW_ITEMS.map((item) => {
                  const key = `${item.id}_approved` as "terms_approved" | "warranty_approved" | "insurance_approved";
                  const approved = !!approvalState?.[key];
                  return (
                    <div key={item.id} className="flex items-center gap-2 text-xs">
                      {approved ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-success-600" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-neutral-300" />
                      )}
                      <span className={approved ? "font-medium text-success-700" : "text-neutral-400"}>
                        {item.label}
                      </span>
                    </div>
                  );
                })}
                {approvalState?.legal_reviewer && (
                  <p className="mt-1.5 text-[10px] text-neutral-400">
                    Reviewed by {approvalState.legal_reviewer}
                    {approvalState.legal_review_date && ` on ${formatDate(approvalState.legal_review_date)}`}
                  </p>
                )}
              </div>
            </div>
          )}

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
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
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

        {/* ═══════════════ Section: Legal Actions ═══════════════ */}
        <CollapsibleSection
          id="actions"
          icon={Gavel}
          title="Legal Decision"
          expanded={expandedSections.actions}
          onToggle={toggleSection}
        >
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button
              disabled={!allApproved || submitted}
              onClick={async () => {
                if (!selectedSQName) {
                  toast.error('No Supplier Quotation selected')
                  return
                }
                const updated = submitLegalReview(
                  selectedSQName,
                  'approved',
                  user?.email ?? 'System',
                  'All documents viewed and approved'
                )
                setLegalDocs(updated)
                
                // Sync with ERPNext & approval workflow
                try {
                  if (approvalState) {
                    approvalState.terms_approved = true;
                    approvalState.warranty_approved = true;
                    approvalState.insurance_approved = true;
                    approvalState.legal_reviewer = user?.email ?? "";
                    approvalState.legal_review_date = new Date().toISOString();
                    saveApprovalState(approvalState);
                  }
                  await updateReviewStatus(decodedId, 'Approved', user?.email ?? "", 'All documents viewed and approved');
                  setSubmitted(true);
                  toast.success('Legal review approved ✅')
                } catch {
                  toast.error('Failed to update ERPNext review status')
                }
              }}
              style={{
                padding: '12px 28px',
                background: allApproved && !submitted ? '#2D6A4F' : '#d1d5db',
                color: 'white',
                border: 'none', borderRadius: '8px',
                cursor: allApproved && !submitted ? 'pointer' : 'not-allowed',
                fontSize: '14px', fontWeight: 700,
                opacity: allApproved && !submitted ? 1 : 0.8
              }}
            >
              {allApproved
                ? '✅ Approve Review'
                : `Approve Review (${approvedCount}/3 documents approved)`}
            </button>
            <button
              disabled={submitted}
              onClick={async () => {
                if (!selectedSQName) {
                  toast.error('No Supplier Quotation selected')
                  return
                }
                const note = prompt('Reason for rejection:')
                if (note) {
                  const updated = submitLegalReview(selectedSQName, 'rejected', user?.email ?? 'System', note)
                  setLegalDocs(updated)
                  
                  // Sync with ERPNext & approval workflow
                  try {
                    if (approvalState) {
                      approvalState.terms_approved = !!legalDocs?.terms_approved;
                      approvalState.warranty_approved = !!legalDocs?.warranty_approved;
                      approvalState.insurance_approved = !!legalDocs?.insurance_approved;
                      approvalState.legal_reviewer = user?.email ?? "";
                      approvalState.legal_review_date = new Date().toISOString();
                      saveApprovalState(approvalState);
                    }
                    await updateReviewStatus(decodedId, 'Rejected', user?.email ?? "", note);
                    setSubmitted(true);
                    toast.error('Legal review rejected')
                  } catch {
                    toast.error('Failed to update ERPNext review status')
                  }
                }
              }}
              style={{
                padding: '10px 24px',
                background: submitted ? '#f3f4f6' : 'white',
                color: submitted ? '#9ca3af' : '#dc2626',
                border: `1px solid ${submitted ? '#e5e7eb' : '#fca5a5'}`,
                borderRadius: '8px',
                cursor: submitted ? 'not-allowed' : 'pointer',
                fontSize: '14px', fontWeight: 600,
                opacity: submitted ? 0.6 : 1
              }}
            >❌ Reject</button>

            {(!legalDocs || (legalDocs.review_status === 'pending' && !legalDocs.terms_pdf_key && !legalDocs.warranty_pdf_key && !legalDocs.insurance_pdf_key)) && !submitted && (
              <button
                onClick={() => {
                  if (!selectedSQName) {
                    toast.error('No Supplier Quotation selected');
                    return;
                  }
                  addNotification({
                    type: "system",
                    title: "Legal Documents Requested",
                    message: `Netlink Legal team has requested compliance documents (Terms, Warranty, Insurance) for Supplier Quotation ${selectedSQName}. Please upload them.`,
                    documentId: selectedSQName,
                    documentType: "Supplier Quotation",
                    recipientRole: "supplier"
                  });
                  toast.success('Document request sent to supplier');
                }}
                style={{
                  padding: '10px 24px', background: '#f59e0b', color: 'white',
                  border: 'none', borderRadius: '8px', cursor: 'pointer',
                  fontSize: '14px', fontWeight: 600
                }}
              >
                📨 Request Documents from Supplier
              </button>
            )}
          </div>

          {legalDocs?.review_status !== 'pending' && (
            <div style={{
              marginTop: '16px', padding: '12px 16px',
              background: legalDocs?.review_status === 'approved' ? '#f0fdf4' : '#fff5f5',
              border: `1px solid ${legalDocs?.review_status === 'approved' ? '#86efac' : '#fca5a5'}`,
              borderRadius: '8px', fontSize: '13px'
            }}>
              <strong>{legalDocs?.review_status === 'approved' ? '✅ Approved' : '❌ Rejected'}</strong> 
              {' '}by {legalDocs?.reviewed_by} on {legalDocs?.reviewed_at ? new Date(legalDocs.reviewed_at).toLocaleString('en-US') : ''}
              {legalDocs?.review_note && <div style={{ marginTop: '4px', color: '#6b7280' }}>{legalDocs.review_note}</div>}
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

function ScoreCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  const tone =
    value >= 80 ? "text-success-600" : value >= 60 ? "text-warning-600" : "text-danger-600";
  return (
    <div className={`rounded-lg border p-3 text-center ${highlight ? "border-primary/30 bg-primary/5" : "border-neutral-200"}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${highlight ? "text-primary" : tone}`}>
        {value}
      </p>
    </div>
  );
}

function LegalStatusBadge({ status }: { status: LegalReviewStatus }) {
  const config: Record<LegalReviewStatus, { icon: typeof Clock; className: string; label: string }> = {
    "Pending Legal Review": { icon: Clock, className: "bg-warning-100 text-warning-700 ring-warning-200", label: "Pending Review" },
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

function StatusIcon({ status }: { status: LegalReviewStatus }) {
  if (status === "Approved") return <CheckCircle2 className="h-6 w-6 text-success-600" />;
  if (status === "Rejected") return <XCircle className="h-6 w-6 text-danger-600" />;
  return <Clock className="h-6 w-6 text-warning-600" />;
}

function ActionBadge({ action }: { action: LegalReviewStatus | "Comment" | "Resubmit" }) {
  const cls =
    action === "Approved"
      ? "bg-success-100 text-success-700"
      : action === "Rejected"
      ? "bg-danger-100 text-danger-700"
      : action === "Resubmit"
      ? "bg-primary-100 text-primary-700"
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
  status?: LegalReviewStatus;
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
            {status && status !== "Pending Legal Review" && (
              <ActionBadge action={status} />
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
      {met ? (
        <CheckCircle2 className="h-4 w-4 text-success-500" />
      ) : (
        <XCircle className="h-4 w-4 text-neutral-300" />
      )}
      <span className={met ? "text-neutral-700" : "text-neutral-400"}>{label}</span>
    </div>
  );
}
