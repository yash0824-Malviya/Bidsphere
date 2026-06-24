import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Loader2,
  Send,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { checkQuotationStatus, createSupplierQuotation, getRFQ } from "../../api/sourcing";
import { saveLegalDocs } from "../../api/legalDocs";
import { storeFileBlob, getFileBlob, deleteFileBlob } from "../../api/legalDocsStorage";
import { Skeleton } from "../../components/Skeleton";
import type { RFQ, RFQItem } from "../../types/erpnext";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  isoDateOffset,
  todayIso,
} from "../../utils/format";
import SupplierPortalLayout from "./SupplierPortalLayout";

interface SupplierSession {
  supplierName: string;
  loggedIn: boolean;
}

interface QuoteLine {
  item_code: string;
  item_name: string;
  description: string;
  qty: number;
  uom: string;
  unit_price: number;
  delivery_days: number;
  notes: string;
}

/**
 * The Smart RFQ wizard embeds `Title:` / `Valid Till:` lines at the top of
 * `message_for_supplier` (the standard RFQ schema doesn't have those
 * fields). This helper parses them back out for display.
 */
function parseRfqMessage(
  message: string | undefined | null
): { title?: string; validTill?: string; body: string } {
  if (!message) return { body: "" };
  const lines = message.split(/\r?\n/);
  let title: string | undefined;
  let validTill: string | undefined;
  let firstBodyLine = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
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
      validTill = validMatch[1].trim();
      firstBodyLine = i + 1;
      continue;
    }
    if (!title && !validTill) firstBodyLine = i;
    break;
  }

  return {
    title,
    validTill,
    body: lines.slice(firstBodyLine).join("\n").trim(),
  };
}

export default function SupplierRFQPage() {
  const navigate = useNavigate();
  const { rfqName: rawRfq = "" } = useParams<{ rfqName: string }>();
  const rfqName = decodeURIComponent(rawRfq);

  /* ─────────────── Session gate ─────────────── */

  const [session, setSession] = useState<SupplierSession | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("supplier_session");
    if (!raw) {
      navigate("/supplier/login", { replace: true });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SupplierSession;
      if (!parsed.loggedIn || !parsed.supplierName) {
        sessionStorage.removeItem("supplier_session");
        navigate("/supplier/login", { replace: true });
        return;
      }
      setSession(parsed);
    } catch {
      sessionStorage.removeItem("supplier_session");
      navigate("/supplier/login", { replace: true });
    }
  }, [navigate]);

  const supplierName = session?.supplierName ?? "";

  /* ─────────────── RFQ data ─────────────── */

  const rfqQuery = useQuery<RFQ>({
    queryKey: ["supplier-portal-rfq", rfqName],
    enabled: !!rfqName && !!session,
    queryFn: () => getRFQ(rfqName),
  });

  const rfq = rfqQuery.data;
  const parsedMessage = useMemo(
    () => parseRfqMessage(rfq?.message_for_supplier),
    [rfq?.message_for_supplier]
  );

  const isInvited = useMemo(() => {
    if (!rfq || !supplierName) return false;
    return (rfq.suppliers ?? []).some((s) => s.supplier === supplierName);
  }, [rfq, supplierName]);

  /* ─────────────── Already-submitted detection ─────────────── */

  interface SubmittedData {
    quoteName: string;
    items: QuoteLine[];
    payment_terms?: string;
    valid_till?: string;
    notes?: string;
    grand_total?: number;
    submitted_at?: string;
  }

  const [alreadySubmitted, setAlreadySubmitted] = useState<SubmittedData | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);

  useEffect(() => {
    if (!rfqName || !supplierName || !rfq) {
      setCheckingStatus(false);
      return;
    }

    let cancelled = false;

    async function detect() {
      // 1. Check sessionStorage for locally persisted submission
      const sessionKey = `quotation_${rfqName}_${supplierName}`;
      const localRaw = sessionStorage.getItem(sessionKey);
      let localData: {
        items?: QuoteLine[];
        payment_terms?: string;
        valid_till?: string;
        notes?: string;
        grand_total?: number;
        submitted_at?: string;
      } | null = null;

      if (localRaw) {
        try { localData = JSON.parse(localRaw); } catch { /* ignore */ }
      }

      // 2. Check ERPNext for a submitted Supplier Quotation
      try {
        const erpStatus = await checkQuotationStatus(rfqName, supplierName);
        if (!cancelled && erpStatus === "Submitted") {
          setAlreadySubmitted({
            quoteName: rfqName,
            items: localData?.items ?? [],
            payment_terms: localData?.payment_terms,
            valid_till: localData?.valid_till,
            notes: localData?.notes,
            grand_total: localData?.grand_total,
            submitted_at: localData?.submitted_at,
          });
          setCheckingStatus(false);
          return;
        }
      } catch {
        // ERPNext check failed — fall back to local data
      }

      // 3. Check the RFQ supplier row's quote_status
      const supplierRow = (rfq?.suppliers ?? []).find((s) => s.supplier === supplierName);
      if (!cancelled && supplierRow?.quote_status === "Received") {
        setAlreadySubmitted({
          quoteName: rfqName,
          items: localData?.items ?? [],
          payment_terms: localData?.payment_terms,
          valid_till: localData?.valid_till,
          notes: localData?.notes,
          grand_total: localData?.grand_total,
          submitted_at: localData?.submitted_at,
        });
        setCheckingStatus(false);
        return;
      }

      // 4. Also treat local data as submitted if it exists
      if (!cancelled && localData?.items && localData.items.length > 0) {
        setAlreadySubmitted({
          quoteName: rfqName,
          items: localData.items,
          payment_terms: localData.payment_terms,
          valid_till: localData.valid_till,
          notes: localData.notes,
          grand_total: localData.grand_total,
          submitted_at: localData.submitted_at,
        });
      }

      if (!cancelled) setCheckingStatus(false);
    }

    detect();
    return () => { cancelled = true; };
  }, [rfqName, supplierName, rfq]);

  /* ─────────────── Local quote state ─────────────── */

  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [paymentTerms, setPaymentTerms] = useState("Net 30 days");
  const [validityDate, setValidityDate] = useState(isoDateOffset(30));
  const [notes, setNotes] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* ── Legal document uploads ── */
  const [legalDraft, setLegalDraft] = useState({
    terms_pdf_key: "", terms_pdf_name: "", terms_note: "",
    warranty_pdf_key: "", warranty_pdf_name: "", warranty_note: "",
    insurance_pdf_key: "", insurance_pdf_name: "", insurance_note: ""
  });
  const [uploading, setUploading] = useState<string | null>(null);

  const handleLegalUpload = async (
    field: "terms_pdf" | "warranty_pdf" | "insurance_pdf",
    file: File
  ) => {
    const MAX_SIZE_MB = 15;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`File too large. Max size is ${MAX_SIZE_MB}MB`);
      return;
    }

    setUploading(field);
    try {
      const tempKey = `temp_${field}_${Date.now()}`;
      await storeFileBlob(tempKey, file);

      setLegalDraft(prev => ({
        ...prev,
        [`${field}_key`]: tempKey,
        [`${field}_name`]: file.name
      }));
      toast.success(`${file.name} attached`);
    } catch (err: any) {
      toast.error("Could not store file: " + err.message);
    } finally {
      setUploading(null);
    }
  };

  const handleLegalNoteChange = (
    field: "terms_note" | "warranty_note" | "insurance_note",
    value: string
  ) => {
    setLegalDraft(prev => ({ ...prev, [field]: value }));
  };

  const allDocsUploaded = !!(legalDraft.terms_pdf_key && legalDraft.warranty_pdf_key && legalDraft.insurance_pdf_key);
  const [submittedQuote, setSubmittedQuote] = useState<{
    name: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!rfq?.items) return;
    setLines(
      rfq.items.map<QuoteLine>((it: RFQItem) => ({
        item_code: it.item_code,
        item_name: it.item_name ?? it.item_code,
        description: it.description ?? "",
        qty: it.qty,
        uom: it.uom ?? "Nos",
        unit_price: 0,
        delivery_days: 7,
        notes: "",
      }))
    );
  }, [rfq]);

  function patchLine(idx: number, patch: Partial<QuoteLine>) {
    setLines((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    );
  }

  const grandTotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.unit_price * l.qty, 0),
    [lines]
  );

  /* ─────────────── Submit ─────────────── */

  async function handleSubmit() {
    if (!rfq) return;

    if (lines.length === 0) {
      toast.error("This RFQ has no items.");
      return;
    }
    if (!acceptedTerms) {
      toast.error("Please accept the terms & conditions.");
      return;
    }
    if (!allDocsUploaded) {
      toast.error("Please upload all required legal documents (Terms & Conditions, Warranty, Insurance).");
      return;
    }

    // Per-item validation — points the supplier at the exact row that's
    // missing a price.
    const unpriced = lines.find((l) => !(l.unit_price > 0));
    if (unpriced) {
      toast.error(`Enter price for: ${unpriced.item_name}`);
      return;
    }
    if (!validityDate) {
      toast.error("Please choose a quote validity date.");
      return;
    }

    // eslint-disable-next-line no-console
    console.log("[SupplierQuote] Legal documents being submitted:", {
      terms_conditions_pdf: legalDraft.terms_pdf_key ?? "(not uploaded)",
      terms_conditions_note: legalDraft.terms_note || "(empty)",
      warranty_certificate_pdf: legalDraft.warranty_pdf_key ?? "(not uploaded)",
      warranty_certificate_note: legalDraft.warranty_note || "(empty)",
      insurance_certificate_pdf: legalDraft.insurance_pdf_key ?? "(not uploaded)",
      insurance_certificate_note: legalDraft.insurance_note || "(empty)",
    });

    setSubmitting(true);

    // ── Persist to sessionStorage *first* ─────────────────────────────────
    // This guarantees the supplier never loses their work even if the
    // back-end is misconfigured — and it's what powers the "thank you"
    // success screen regardless of ERPNext's state.
    const sessionKey = `quotation_${rfq.name}_${supplierName}`;
    const grandTotalSnapshot = lines.reduce(
      (sum, l) => sum + l.qty * (l.unit_price || 0),
      0
    );
    try {
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify({
          rfq: rfq.name,
          supplier: supplierName,
          items: lines,
          payment_terms: paymentTerms,
          valid_till: validityDate,
          notes,
          grand_total: grandTotalSnapshot,
          submitted_at: new Date().toISOString(),
          legal_documents: {
            terms_conditions_pdf: legalDraft.terms_pdf_key ?? null,
            terms_conditions_note: legalDraft.terms_note,
            warranty_certificate_pdf: legalDraft.warranty_pdf_key ?? null,
            warranty_certificate_note: legalDraft.warranty_note,
            insurance_certificate_pdf: legalDraft.insurance_pdf_key ?? null,
            insurance_certificate_note: legalDraft.insurance_note,
          },
        })
      );
    } catch {
      // sessionStorage can throw in private-mode — non-fatal.
    }

    // ── Try ERPNext in the background — silent on failure ────────────────
    // Send only the minimal field set ERPNext's Supplier Quotation
    // controller accepts. `delivery_days`, `description`, terms,
    // payment_terms etc. are kept locally (sessionStorage above) but
    // **not** forwarded — they're what was triggering the 400s.
    try {
      // Look up the RFQ Supplier row name for this supplier so ERPNext can
      // flip quote_status "Pending" → "Received" on submit.
      const rfqSupplierRow = (rfq.suppliers ?? []).find(
        (s) => s.supplier === supplierName
      );

      const result = await createSupplierQuotation({
        supplier: supplierName,
        rfq_no: rfq.name,
        rfq_supplier_name: rfqSupplierRow?.name,
        items: lines.map((l) => {
          const rfqItem = (rfq.items ?? []).find(
            (it) => it.item_code === l.item_code
          );
          return {
            item_code: l.item_code,
            item_name: l.item_name,
            qty: Number(l.qty),
            uom: l.uom || "Nos",
            rate: parseFloat(String(l.unit_price)) || 0,
            rfq_item_name: rfqItem?.name,
          };
        }),
      });
      const quoteName = (result as { name?: string }).name ?? "";
      const quoteStatus = (result as { status?: string }).status ?? "Draft";
      setSubmittedQuote({ name: quoteName, status: quoteStatus });

      // Persist the legal documents under the REAL Supplier Quotation name
      if (quoteName) {
        // eslint-disable-next-line no-console
        console.log('[DEBUG-1] Quotation created, full result object:', result)
        // eslint-disable-next-line no-console
        console.log('[DEBUG-2] Extracted sqName:', quoteName, '| typeof:', typeof quoteName)
        // eslint-disable-next-line no-console
        console.log('[DEBUG-3] legalDraft state at submit time:', legalDraft)

        const finalizeLegalDocKey = async (tempKey: string | undefined, sqName: string, field: string) => {
          if (!tempKey) return undefined;
          const stored = await getFileBlob(tempKey);
          if (!stored) return undefined;
          const permanentKey = `${sqName}_${field}`;
          await storeFileBlob(permanentKey, new File([stored.blob], stored.name, { type: stored.type }));
          await deleteFileBlob(tempKey); // cleanup temp entry
          return permanentKey;
        };

        const termsKey = await finalizeLegalDocKey(legalDraft.terms_pdf_key, quoteName, "terms_pdf");
        const warrantyKey = await finalizeLegalDocKey(legalDraft.warranty_pdf_key, quoteName, "warranty_pdf");
        const insuranceKey = await finalizeLegalDocKey(legalDraft.insurance_pdf_key, quoteName, "insurance_pdf");

        const legalDocPayload = {
          sq_name: quoteName,
          rfq_name: rfq.name,
          supplier: supplierName,
          terms_pdf_key: termsKey,
          terms_pdf_name: legalDraft.terms_pdf_name,
          terms_note: legalDraft.terms_note,
          warranty_pdf_key: warrantyKey,
          warranty_pdf_name: legalDraft.warranty_pdf_name,
          warranty_note: legalDraft.warranty_note,
          insurance_pdf_key: insuranceKey,
          insurance_pdf_name: legalDraft.insurance_pdf_name,
          insurance_note: legalDraft.insurance_note,
          submitted_by_supplier_at: new Date().toISOString(),
          review_status: 'pending' as const
        }
        // eslint-disable-next-line no-console
        console.log('[DEBUG-4] About to call saveLegalDocs with:', legalDocPayload)
        saveLegalDocs(legalDocPayload);
        // eslint-disable-next-line no-console
        console.log('[DEBUG-5] saveLegalDocs called. Verifying immediately by reading back:')
        // eslint-disable-next-line no-console
        console.log('[DEBUG-6] Readback result:', localStorage.getItem(`legal_docs_${quoteName}`))
        // eslint-disable-next-line no-console
        console.log('[DEBUG-7] Index after save:', localStorage.getItem('legal_docs_index'))
      }

      toast.success(
        quoteStatus === "Submitted"
          ? `Quotation ${quoteName} submitted!`
          : `Quotation ${quoteName} saved (Draft)`
      );
    } catch (err) {
      const realError = err instanceof Error ? err.message : "Unknown error";
      // eslint-disable-next-line no-console
      console.error("[SQ] Full error:", err);
      toast.error(`Save failed: ${realError}`, { duration: 8_000 });
      // Data is in sessionStorage so navigate to dashboard regardless.
      navigate("/supplier/dashboard", { replace: true });
    }

    setSubmitting(false);
  }

  /* ─────────────── Render ─────────────── */

  if (!session) {
    return (
      <SupplierPortalLayout>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      </SupplierPortalLayout>
    );
  }

  /* ── Success screen ──────────────────────────────────────────────── */
  if (submittedQuote) {
    const isSubmitted = submittedQuote.status === "Submitted";
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <div className="mx-auto max-w-lg py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-100">
            <CheckCircle2 className="h-7 w-7 text-accent-600" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900">
            {isSubmitted ? "Quotation Submitted!" : "Quotation Saved"}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {isSubmitted
              ? "Your quotation has been submitted and is now visible to the buyer."
              : "Your quotation was saved as a draft. Please submit it from the dashboard."}
          </p>

          <div
            className={`mx-auto mt-6 max-w-sm rounded-xl border px-6 py-4 text-left ${
              isSubmitted
                ? "border-accent-200 bg-accent-50"
                : "border-warning-200 bg-warning-50"
            }`}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Quotation Number
            </p>
            <p className="mt-1 text-lg font-bold text-neutral-900">
              {submittedQuote.name}
            </p>
            <p
              className={`mt-1 text-sm font-medium ${
                isSubmitted ? "text-accent-700" : "text-warning-700"
              }`}
            >
              {isSubmitted ? "✅ Submitted" : "⏳ Draft — submit from dashboard"}
            </p>
          </div>

          <button
            onClick={() => navigate("/supplier/dashboard", { replace: true })}
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-700"
          >
            Back to Dashboard
          </button>
        </div>
      </SupplierPortalLayout>
    );
  }

  if (rfqQuery.isLoading) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </SupplierPortalLayout>
    );
  }

  if (rfqQuery.isError || !rfq) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackToDashboard />
        <div className="rounded-2xl border border-danger-200 bg-danger-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-danger-600" />
          <h2 className="mt-2 text-base font-semibold text-danger-800">
            Couldn't load this RFQ
          </h2>
          <p className="mt-1 text-sm text-danger-700">
            The RFQ may have been deleted, or you may not have access.
          </p>
          <button
            type="button"
            onClick={() => rfqQuery.refetch()}
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-danger-300 bg-white px-3 py-1.5 text-xs font-medium text-danger-700 hover:bg-danger-100"
          >
            Try again
          </button>
        </div>
      </SupplierPortalLayout>
    );
  }

  // Draft RFQs (docstatus 0) are internal to Procurement and must never be
  // accessible to suppliers — block access even via a direct link.
  const isPublished = (rfq as { docstatus?: number }).docstatus === 1;
  if (!isPublished) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackToDashboard />
        <div className="rounded-2xl border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldAlert className="mx-auto h-6 w-6 text-warning-600" />
          <h2 className="mt-2 text-base font-semibold text-warning-800">
            This RFQ is not available
          </h2>
          <p className="mt-1 text-sm text-warning-700">
            This request for quotation has not been published yet. You'll be
            able to view it and submit a quotation once the buyer opens it.
          </p>
        </div>
      </SupplierPortalLayout>
    );
  }

  if (!isInvited) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackToDashboard />
        <div className="rounded-2xl border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldAlert className="mx-auto h-6 w-6 text-warning-600" />
          <h2 className="mt-2 text-base font-semibold text-warning-800">
            You are not invited to this RFQ
          </h2>
          <p className="mt-1 text-sm text-warning-700">
            {supplierName} is not on the supplier list for {rfqName}. If you
            believe this is an error, please contact the buyer.
          </p>
        </div>
      </SupplierPortalLayout>
    );
  }

  /* ── Checking status spinner ──────────────────────────────────────── */
  if (checkingStatus) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
          <span className="text-sm text-neutral-500">Checking quotation status…</span>
        </div>
      </SupplierPortalLayout>
    );
  }

  /* ── Read-only view: Quotation already submitted ──────────────────── */
  if (alreadySubmitted) {
    const subData = alreadySubmitted;
    const hasItems = subData.items.length > 0;
    const readOnlyTotal = hasItems
      ? subData.items.reduce((s, l) => s + l.unit_price * l.qty, 0)
      : subData.grand_total ?? 0;

    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackToDashboard />

        {/* Status banner */}
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-emerald-900">Quotation Submitted</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold text-white">
                  <Lock className="h-2.5 w-2.5" /> Submitted
                </span>
              </div>
              <p className="mt-1 text-sm text-emerald-700">
                This quotation has already been submitted and is under procurement review.
              </p>
              {subData.submitted_at && (
                <p className="mt-1 text-xs text-emerald-600">
                  <Clock className="mr-1 inline h-3 w-3" />
                  Submitted on {formatDateTime(subData.submitted_at)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* RFQ header */}
        <div className="mb-2">
          <h1 className="text-xl font-bold text-neutral-900">
            Quotation Details — {rfq.name}
          </h1>
          <p className="text-sm text-neutral-600">
            {parsedMessage.title || "Your submitted quotation is shown below in read-only mode."}
          </p>
        </div>

        {/* RFQ banner */}
        <div className="mt-4 rounded-2xl bg-gradient-to-r from-neutral-500 to-neutral-600 p-5 text-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/80">
                <Sparkles className="h-3 w-3" />
                Quotation submitted for
              </div>
              <h2 className="mt-1 truncate text-lg font-bold">
                {parsedMessage.title || rfq.name}
              </h2>
              <p className="text-sm text-white/80">{rfq.name}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <Tile icon={Calendar} label="Issued">
              {formatDate(rfq.transaction_date)}
            </Tile>
            <Tile icon={Calendar} label="Valid Till">
              {parsedMessage.validTill
                ? formatDate(parsedMessage.validTill)
                : rfq.valid_till
                ? formatDate(rfq.valid_till)
                : "—"}
            </Tile>
            <Tile icon={Building2} label="Buyer">
              {rfq.company || "Netlink"}
            </Tile>
          </div>
        </div>

        {/* Submitted items (read-only) */}
        {hasItems && (
          <div className="mt-6 card">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">Quoted Items</h2>
                <p className="text-xs text-neutral-500">Read-only — prices as submitted</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                <Lock className="h-2.5 w-2.5" /> Locked
              </span>
            </div>

            {/* Mobile stacked cards */}
            <div className="divide-y divide-neutral-200 md:hidden">
              {subData.items.map((line) => (
                <div key={line.item_code} className="space-y-2 p-4 bg-neutral-50/40">
                  <div>
                    <p className="font-medium text-neutral-900">{line.item_name}</p>
                    <p className="text-xs text-neutral-500">{line.item_code}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-[10px] font-medium uppercase text-neutral-500">Quantity</p>
                      <p className="font-medium tabular-nums">{line.qty} {line.uom}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase text-neutral-500">Unit Price</p>
                      <p className="font-semibold tabular-nums text-neutral-900">{formatCurrency(line.unit_price)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase text-neutral-500">Total</p>
                      <p className="font-semibold tabular-nums text-primary-700">{formatCurrency(line.unit_price * line.qty)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase text-neutral-500">Delivery</p>
                      <p className="font-medium tabular-nums">{line.delivery_days} days</p>
                    </div>
                  </div>
                  {line.notes && (
                    <p className="text-xs text-neutral-500">Note: {line.notes}</p>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between bg-neutral-100 px-4 py-3">
                <span className="text-xs font-semibold uppercase text-neutral-600">Grand Total</span>
                <span className="text-base font-bold tabular-nums text-primary-700">{formatCurrency(readOnlyTotal)}</span>
              </div>
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2">UOM</th>
                    <th className="px-4 py-2 text-right">Unit Price</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right">Delivery (days)</th>
                    <th className="px-4 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {subData.items.map((line) => (
                    <tr key={line.item_code} className="bg-neutral-50/40">
                      <td className="px-4 py-2 align-top">
                        <p className="font-medium text-neutral-900">{line.item_name}</p>
                        <p className="text-xs text-neutral-500">{line.item_code}</p>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{line.qty}</td>
                      <td className="px-4 py-2 text-neutral-700">{line.uom}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-neutral-900">{formatCurrency(line.unit_price)}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-900">{formatCurrency(line.unit_price * line.qty)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{line.delivery_days}</td>
                      <td className="px-4 py-2 text-neutral-600">{line.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-neutral-100">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-600">Grand Total</td>
                    <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-primary-700">{formatCurrency(readOnlyTotal)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Additional info (read-only) */}
        <div className="mt-6 card">
          <div className="border-b border-neutral-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-neutral-900">Submission Details</h2>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <ReadOnlyField label="Payment Terms" value={subData.payment_terms || "Net 30 days"} />
            <ReadOnlyField label="Quote Valid Until" value={subData.valid_till ? formatDate(subData.valid_till) : "—"} />
            {subData.notes && (
              <div className="sm:col-span-2">
                <ReadOnlyField label="General Notes" value={subData.notes} />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-center">
          <p className="text-sm text-neutral-600">
            Your quotation is under review. You will be notified if a revision is requested.
          </p>
          <Link
            to="/supplier/dashboard"
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 no-underline"
          >
            Back to Dashboard
          </Link>
        </div>
      </SupplierPortalLayout>
    );
  }

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <BackToDashboard />

      <div className="mb-2">
        <h1 className="text-xl font-bold text-neutral-900">
          Submit Quotation — {rfq.name}
        </h1>
        <p className="text-sm text-neutral-600">
          {parsedMessage.title || "Enter your prices and lead times below."}
        </p>
      </div>

      {/* RFQ banner */}
      <div className="mt-4 rounded-2xl bg-gradient-to-r from-accent-500 to-primary-600 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/80">
              <Sparkles className="h-3 w-3" />
              You are submitting a quotation for
            </div>
            <h2 className="mt-1 truncate text-lg font-bold">
              {parsedMessage.title || rfq.name}
            </h2>
            <p className="text-sm text-white/80">{rfq.name}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <Tile icon={Calendar} label="Issued">
            {formatDate(rfq.transaction_date)}
          </Tile>
          <Tile icon={Calendar} label="Valid Till">
            {parsedMessage.validTill
              ? formatDate(parsedMessage.validTill)
              : rfq.valid_till
              ? formatDate(rfq.valid_till)
              : "—"}
          </Tile>
          <Tile icon={Building2} label="Buyer">
            {rfq.company || "Netlink"}
          </Tile>
        </div>

        {parsedMessage.body && (
          <div className="mt-4 rounded-lg bg-white/10 p-3 text-sm leading-relaxed ring-1 ring-inset ring-white/15">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/80">
              <FileText className="h-3 w-3" />
              Buyer's Notes &amp; Terms
            </div>
            <p className="whitespace-pre-line text-white/95">
              {parsedMessage.body}
            </p>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="mt-6 card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Items to Quote
            </h2>
            <p className="text-xs text-neutral-500">
              Enter your unit price and lead time per line. Totals update
              live.
            </p>
          </div>
          <span className="text-xs text-neutral-500">
            {lines.length} item{lines.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Mobile stacked item cards */}
        <div className="divide-y divide-neutral-200 md:hidden">
          {lines.map((line, idx) => (
            <div key={line.item_code} className="space-y-3 p-4">
              <div>
                <p className="font-medium text-neutral-900">{line.item_name}</p>
                <p className="text-xs text-neutral-500">{line.item_code}</p>
                {line.description ? (
                  <p className="mt-1 text-xs text-neutral-500">{line.description}</p>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase text-neutral-500">Quantity</p>
                  <p className="font-medium tabular-nums">{line.qty} {line.uom}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-neutral-500">Total</p>
                  <p className="font-semibold tabular-nums text-primary-700">
                    {formatCurrency(line.unit_price * line.qty)}
                  </p>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  Unit Price
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={line.unit_price || ""}
                  onChange={(e) =>
                    patchLine(idx, { unit_price: Number(e.target.value) })
                  }
                  placeholder="0.00"
                  className="input-field tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  Delivery (days)
                </label>
                <input
                  type="number"
                  min={0}
                  value={line.delivery_days || ""}
                  onChange={(e) =>
                    patchLine(idx, { delivery_days: Number(e.target.value) })
                  }
                  placeholder="7"
                  className="input-field tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  Notes
                </label>
                <input
                  value={line.notes}
                  onChange={(e) => patchLine(idx, { notes: e.target.value })}
                  placeholder="Optional"
                  className="input-field"
                />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between bg-neutral-50 px-4 py-3">
            <span className="text-xs font-semibold uppercase text-neutral-600">
              Grand Total
            </span>
            <span className="text-base font-bold tabular-nums text-primary-700">
              {formatCurrency(grandTotal)}
            </span>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2">UOM</th>
                <th className="px-4 py-2 text-right">Unit Price</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Delivery (days)</th>
                <th className="px-4 py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {lines.map((line, idx) => (
                <tr key={line.item_code}>
                  <td className="px-4 py-2 align-top">
                    <p className="font-medium text-neutral-900">
                      {line.item_name}
                    </p>
                    <p className="text-xs text-neutral-500">{line.item_code}</p>
                    {line.description && (
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        {line.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-700">
                    {line.qty}
                  </td>
                  <td className="px-4 py-2 text-neutral-700">{line.uom}</td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={line.unit_price || ""}
                      onChange={(e) =>
                        patchLine(idx, {
                          unit_price: Number(e.target.value),
                        })
                      }
                      placeholder="0.00"
                      className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-900">
                    {formatCurrency(line.unit_price * line.qty)}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={0}
                      value={line.delivery_days || ""}
                      onChange={(e) =>
                        patchLine(idx, {
                          delivery_days: Number(e.target.value),
                        })
                      }
                      placeholder="7"
                      className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={line.notes}
                      onChange={(e) =>
                        patchLine(idx, { notes: e.target.value })
                      }
                      placeholder="Optional"
                      className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-neutral-50">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  Grand Total
                </td>
                <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-primary-700">
                  {formatCurrency(grandTotal)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Additional info */}
      <div className="mt-6 card">
        <div className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            Additional Information
          </h2>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="payment-terms"
              className="mb-1.5 block text-sm font-medium text-neutral-700"
            >
              Payment Terms
            </label>
            <input
              id="payment-terms"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="e.g. Net 30 days"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <div>
            <label
              htmlFor="quote-validity"
              className="mb-1.5 block text-sm font-medium text-neutral-700"
            >
              Validity of Quote
            </label>
            <input
              id="quote-validity"
              type="date"
              value={validityDate}
              min={todayIso()}
              onChange={(e) => setValidityDate(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor="quote-notes"
              className="mb-1.5 block text-sm font-medium text-neutral-700"
            >
              General Notes
            </label>
            <textarea
              id="quote-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Warranty, brand substitutions, freight terms…"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-500"
              />
              <span>
                I accept Netlink's RFQ terms &amp; conditions and confirm the
                pricing above is firm and binding for the validity period.
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* ── Legal Document Uploads ── */}
      <div style={{ marginTop: '24px' }} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', color: '#111' }}>
          📋 Legal & Compliance Documents
        </h3>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '14px' }}>
          Attach supporting documents. These will be reviewed by Netlink's legal team.
        </p>

        {[
          { key: 'terms', label: 'Terms & Conditions', icon: '📄' },
          { key: 'warranty', label: 'Warranty Document', icon: '🛡️' },
          { key: 'insurance', label: 'Insurance Certificate', icon: '🏥' }
        ].map(({ key, label, icon }) => {
          const keyField = `${key}_pdf_key` as keyof typeof legalDraft;
          const nameKey = `${key}_pdf_name` as keyof typeof legalDraft;
          const noteKey = `${key}_note` as keyof typeof legalDraft;
          const uploaded = !!legalDraft[keyField];

          return (
            <div key={key} style={{
              border: `1px solid ${uploaded ? '#86efac' : '#e5e7eb'}`,
              borderRadius: '10px', padding: '14px', marginBottom: '10px',
              background: uploaded ? '#f0fdf4' : 'white'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>{icon} {label}</span>
                <label style={{
                  padding: '5px 12px',
                  background: uploaded ? 'white' : '#2D6A4F',
                  color: uploaded ? '#2D6A4F' : 'white',
                  border: uploaded ? '1px solid #2D6A4F' : 'none',
                  borderRadius: '6px', cursor: 'pointer',
                  fontSize: '12px', fontWeight: 600
                }}>
                  {uploading === `${key}_pdf` ? '⏳ Uploading...' : uploaded ? '🔄 Replace' : '📤 Upload PDF'}
                  <input
                    type="file" accept=".pdf" hidden
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) handleLegalUpload(`${key}_pdf` as any, file)
                    }}
                  />
                </label>
              </div>
              {legalDraft[nameKey] && (
                <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
                  📎 {legalDraft[nameKey] as string}
                </div>
              )}
              <textarea
                placeholder={`Notes about ${label.toLowerCase()}...`}
                value={legalDraft[noteKey] as string}
                onChange={e => handleLegalNoteChange(`${key}_note` as any, e.target.value)}
                rows={2}
                style={{
                  width: '100%', padding: '8px 10px',
                  border: '1px solid #e5e7eb', borderRadius: '6px',
                  fontSize: '13px', resize: 'vertical', fontFamily: 'inherit'
                }}
              />
            </div>
          )
        })}
        {!allDocsUploaded && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning-700 mt-3">
            <AlertTriangle className="h-3.5 w-3.5" />
            All documents must be uploaded before submitting your quotation.
          </p>
        )}
      </div>

      {/* Submit */}
      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-accent-200 bg-accent-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-accent-700">
            Quote Total
          </p>
          <p className="text-lg font-bold tabular-nums text-accent-900">
            {formatCurrency(grandTotal)}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-touch inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-700 disabled:opacity-60 sm:w-auto"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {submitting ? "Submitting…" : "Submit Quotation"}
        </button>
      </div>
    </SupplierPortalLayout>
  );
}

/* ============================================================================
 * Helpers
 * ========================================================================== */

function BackToDashboard() {
  return (
    <Link
      to="/supplier/dashboard"
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-accent-700"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to dashboard
    </Link>
  );
}

interface TileProps {
  icon: typeof Calendar;
  label: string;
  children: React.ReactNode;
}

function Tile({ icon: Icon, label, children }: TileProps) {
  return (
    <div className="rounded-lg bg-white/10 p-3 ring-1 ring-inset ring-white/15">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/80">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-0.5 font-semibold">{children}</p>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-neutral-500">{label}</p>
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">{value}</div>
    </div>
  );
}
