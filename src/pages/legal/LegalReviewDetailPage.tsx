import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Bot,
  Building2,
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
  Scale,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";

import { getRFQ, getSupplierQuotations, fetchRawSQ } from "../../api/sourcing";
import {
  getLegalDocs,
  updateLegalDocs,
  submitLegalReview,
} from "../../api/legalDocs";
import type { LegalDocumentItemSummary, LegalDocumentSet } from "../../api/legalDocs";
import { triggerLegalDocumentsRequested } from "../../api/notifications";
import { getFullFileUrl } from "../../api/legalDocsStorage";
import { getLatestAnalysisSnapshot } from "../../api/supplierScoringResults";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDate } from "../../utils/format";
import { Skeleton } from "../../components/Skeleton";
import type { RFQ, SupplierQuotation, AIRecommendation } from "../../types/erpnext";

/**
 * Local decision-status type matching the ERPNext "Legal Document Review"
 * DocType's `review_status` field EXACTLY. This is intentionally distinct
 * from `LegalReviewStatus` (types/erpnext.ts), which belongs to the legacy
 * RFQ-workflow system — this page is now driven ONLY by the DocType, which
 * is the single source of truth for the review verdict.
 */
type DocReviewStatus = "Pending" | "Approved" | "Rejected";

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

  const [legalDocs, setLegalDocs] = useState<LegalDocumentSet | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);

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
    const load = async () => {
      const lookupSq = sqName ?? selectedSQName;
      if (!lookupSq) {
        if (!sqName) {
          setLegalDocs(null);
          setLoadingDocs(false);
        }
        return;
      }
      setLoadingDocs(true);
      const docs = await getLegalDocs(lookupSq);
      // eslint-disable-next-line no-console
      console.log("[LegalReview] Loaded from ERPNext:", docs);
      setLegalDocs(docs);
      setLoadingDocs(false);
    };
    void load();
  }, [sqName, selectedSQName]);

  const handleViewPdf = useCallback(
    async (field: "terms" | "warranty" | "insurance") => {
      const url = legalDocs?.[`${field}_file_url`];
      if (!url) {
        toast.error("PDF not available");
        return;
      }
      window.open(getFullFileUrl(url), "_blank", "noopener,noreferrer");

      if (legalDocs?.name) {
        try {
          const updated = await updateLegalDocs(legalDocs.name, {
            [`${field}_viewed`]: 1,
          } as Partial<LegalDocumentSet>);
          setLegalDocs(updated);
        } catch {
          toast.error("Could not mark document as viewed");
        }
      }
    },
    [legalDocs]
  );

  const handleApproveToggle = useCallback(
    async (field: "terms" | "warranty" | "insurance", checked: boolean) => {
      if (!legalDocs?.name) return;
      try {
        const updated = await updateLegalDocs(legalDocs.name, {
          [`${field}_approved`]: checked ? 1 : 0,
        } as Partial<LegalDocumentSet>);
        setLegalDocs(updated);
      } catch {
        toast.error("Could not update approval status");
      }
    },
    [legalDocs]
  );

  const allApproved = !!(
    legalDocs?.terms_approved &&
    legalDocs?.warranty_approved &&
    legalDocs?.insurance_approved
  );

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

  const checklistComplete = allApproved;

  const itemSummary: LegalDocumentItemSummary[] = useMemo(() => {
    if (!legalDocs?.item_summary) return [];
    try {
      const parsed = JSON.parse(legalDocs.item_summary);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [legalDocs?.item_summary]);

  /* ── Decision comments (mandatory; written to ERPNext on submit) ── */
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

  /* ── Submission state — derived entirely from the ERPNext DocType.
   * `review_status` IS the single source of truth: "Pending" means the
   * decision hasn't been made yet; anything else means it's final. ── */
  const submitted = legalDocs?.review_status !== undefined && legalDocs.review_status !== "Pending";

  const [submitting, setSubmitting] = useState(false);

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
    reviewStatus: legalDocs?.review_status ?? "none",
    hasAI: !!aiAnalysis,
  });

  const selectedQuote = quotations.find(
    (q) => q.supplier === selectedSupplier || q.supplier_name === selectedSupplier
  );
  const aiSupplier = aiAnalysis?.supplier_analysis?.find(
    (s) => s.name === selectedSupplier
  );

  const currentLegalStatus: DocReviewStatus = legalDocs?.review_status ?? "Pending";

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
                      : legalDocs?.grand_total != null
                      ? formatCurrency(legalDocs.grand_total)
                      : "—"
                  }
                  highlight
                />
                <InfoField
                  label="Submitted By"
                  value={legalDocs?.procurement_manager ?? rfq?.owner ?? "—"}
                />
                <InfoField label="Company" value={legalDocs?.company} />
                <InfoField
                  label="Procurement Manager"
                  value={legalDocs?.procurement_manager}
                />
                <InfoField
                  label="Submission Date"
                  value={legalDocs?.submission_date ? formatDate(legalDocs.submission_date) : undefined}
                />
                <InfoField
                  label="Quote Valid Till"
                  value={legalDocs?.valid_till ? formatDate(legalDocs.valid_till) : undefined}
                />
                <InfoField label="Payment Terms" value={legalDocs?.payment_terms} />
              </div>

              {legalDocs?.supplier_notes && (
                <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                    Supplier Notes
                  </p>
                  <p className="text-sm leading-relaxed text-neutral-700 whitespace-pre-wrap">
                    {legalDocs.supplier_notes}
                  </p>
                </div>
              )}

              {/* Supplier quotation items */}
              {selectedQuote && (selectedQuote.items ?? []).length > 0 ? (
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
              ) : itemSummary.length > 0 ? (
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
                          <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">UOM</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-500">Rate</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-500">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemSummary.map((item, idx) => (
                          <tr key={idx} className="border-b border-neutral-50 last:border-0">
                            <td className="px-3 py-2 font-medium text-neutral-900">
                              {item.item_code}
                              {item.item_name && item.item_name !== item.item_code && (
                                <span className="ml-1 text-xs text-neutral-500">({item.item_name})</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{item.qty}</td>
                            <td className="px-3 py-2 text-neutral-600">{item.uom ?? "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(item.rate)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold">
                              {formatCurrency(item.amount ?? item.qty * item.rate)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-neutral-200 bg-neutral-50/50">
                          <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold uppercase text-neutral-500">
                            Grand Total
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-bold text-neutral-900">
                            {formatCurrency(legalDocs?.grand_total ?? 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ) : null}

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
          {!loadingDocs && !legalDocs ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
              <div style={{ fontSize: '40px' }}>📭</div>
              <p className="font-semibold text-neutral-600 mt-2">No documents submitted yet for this Supplier Quotation.</p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>The supplier hasn&apos;t completed their quotation with legal attachments.</p>
            </div>
          ) : loadingDocs ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
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
                { shortField: 'terms' as const, label: 'Terms & Conditions', icon: '📄' },
                { shortField: 'warranty' as const, label: 'Warranty Document', icon: '🛡️' },
                { shortField: 'insurance' as const, label: 'Insurance Certificate', icon: '🏥' }
              ].map(({ shortField, label, icon }) => {
                const fileUrl = legalDocs?.[`${shortField}_file_url`];
                const pdfName = legalDocs?.[`${shortField}_file_name` as keyof LegalDocumentSet] as string | undefined
                  || (fileUrl ? fileUrl.split('/').pop() : undefined);
                const note = legalDocs?.[`${shortField}_note` as keyof LegalDocumentSet] as string | undefined;
                const hasPdf = !!fileUrl;
                const isViewed = !!legalDocs?.[`${shortField}_viewed` as keyof LegalDocumentSet];
                const isApproved = !!legalDocs?.[`${shortField}_approved` as keyof LegalDocumentSet];

                return (
                  <div key={shortField} style={{
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
                            onClick={() => void handleViewPdf(shortField)}
                            style={{
                              padding: '6px 16px', background: '#2D6A4F', color: 'white',
                              border: 'none', borderRadius: '6px', cursor: 'pointer',
                              fontSize: '13px', fontWeight: 600,
                              display: 'flex', alignItems: 'center', gap: '6px'
                            }}
                          >👁 View PDF</button>
                          {fileUrl && (
                            <a
                              href={getFullFileUrl(fileUrl)}
                              download={pdfName}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                padding: '6px 16px', background: 'white', color: '#2D6A4F',
                                border: '1px solid #2D6A4F', borderRadius: '6px',
                                fontSize: '13px', fontWeight: 600, textDecoration: 'none',
                                display: 'flex', alignItems: 'center', gap: '6px'
                              }}
                            >⬇ Download PDF</a>
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
              placeholder="Provide the reason for your approval or rejection. This is mandatory before submitting a decision and is saved permanently on the Legal Document Review record in ERPNext."
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
              disabled={!allApproved || submitted || submitting || !actionReason.trim()}
              onClick={async () => {
                if (!legalDocs?.name) {
                  toast.error('No Legal Document Review record found')
                  return
                }
                if (!actionReason.trim()) {
                  toast.error('Provide a decision reason before approving.')
                  return
                }
                setSubmitting(true);
                try {
                  // The ERPNext "Legal Document Review" document is the ONLY
                  // place this decision is written — review_status,
                  // approved_by, approved_on, and legal_comments all land on
                  // the same document, server-side, via the backend gateway.
                  const updated = await submitLegalReview(
                    legalDocs.name,
                    'Approved',
                    user?.email ?? 'System',
                    actionReason.trim()
                  )
                  setLegalDocs(updated);
                  // Sync any other Legal views open in this session (Dashboard,
                  // Pending/History list) — cross-device sync needs no code at
                  // all here since every page fetches fresh from ERPNext.
                  await queryClient.invalidateQueries({ queryKey: ["legal-document-reviews"] });
                  toast.success('Legal review approved ✅')
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to update legal review')
                } finally {
                  setSubmitting(false);
                }
              }}
              style={{
                padding: '12px 28px',
                background: allApproved && !submitted ? '#2D6A4F' : '#d1d5db',
                color: 'white',
                border: 'none', borderRadius: '8px',
                cursor: allApproved && !submitted && !submitting ? 'pointer' : 'not-allowed',
                fontSize: '14px', fontWeight: 700,
                opacity: allApproved && !submitted ? 1 : 0.8
              }}
            >
              {submitting
                ? 'Submitting…'
                : allApproved
                ? '✅ Approve Review'
                : `Approve Review (${approvedCount}/3 documents approved)`}
            </button>
            <button
              disabled={submitted || submitting || !actionReason.trim()}
              onClick={async () => {
                if (!legalDocs?.name) {
                  toast.error('No Legal Document Review record found')
                  return
                }
                if (!actionReason.trim()) {
                  toast.error('Provide a rejection reason before rejecting.')
                  return
                }
                setSubmitting(true);
                try {
                  const updated = await submitLegalReview(
                    legalDocs.name,
                    'Rejected',
                    user?.email ?? 'System',
                    actionReason.trim(),
                    actionReason.trim()
                  )
                  setLegalDocs(updated);
                  await queryClient.invalidateQueries({ queryKey: ["legal-document-reviews"] });
                  toast.error('Legal review rejected')
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to update legal review')
                } finally {
                  setSubmitting(false);
                }
              }}
              style={{
                padding: '10px 24px',
                background: submitted ? '#f3f4f6' : 'white',
                color: submitted ? '#9ca3af' : '#dc2626',
                border: `1px solid ${submitted ? '#e5e7eb' : '#fca5a5'}`,
                borderRadius: '8px',
                cursor: submitted || submitting ? 'not-allowed' : 'pointer',
                fontSize: '14px', fontWeight: 600,
                opacity: submitted ? 0.6 : 1
              }}
            >❌ Reject</button>

            {(!loadingDocs && !legalDocs || (legalDocs?.review_status === 'Pending' && !legalDocs.terms_file_url && !legalDocs.warranty_file_url && !legalDocs.insurance_file_url)) && !submitted && (
              <button
                onClick={() => {
                  if (!selectedSQName) {
                    toast.error('No Supplier Quotation selected');
                    return;
                  }
                  triggerLegalDocumentsRequested(selectedSQName);
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

          {legalDocs?.review_status !== 'Pending' && (
            <div style={{
              marginTop: '16px', padding: '12px 16px',
              background: legalDocs?.review_status === 'Approved' ? '#f0fdf4' : '#fff5f5',
              border: `1px solid ${legalDocs?.review_status === 'Approved' ? '#86efac' : '#fca5a5'}`,
              borderRadius: '8px', fontSize: '13px'
            }}>
              <strong>{legalDocs?.review_status === 'Approved' ? '✅ Approved' : '❌ Rejected'}</strong>
              {' '}by {legalDocs?.approved_by} on {legalDocs?.approved_on ? new Date(legalDocs.approved_on).toLocaleString('en-US') : ''}
              {legalDocs?.legal_comments && <div style={{ marginTop: '4px', color: '#6b7280' }}>{legalDocs.legal_comments}</div>}
              {legalDocs?.review_status === 'Rejected' && legalDocs?.rejection_reason && (
                <div style={{ marginTop: '4px', color: '#dc2626', fontWeight: 600 }}>
                  Rejection reason: {legalDocs.rejection_reason}
                </div>
              )}
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
