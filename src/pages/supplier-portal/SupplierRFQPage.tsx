import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CloudUpload,
  FileCheck,
  FileText,
  Eye,
  Lock,
  Loader2,
  Package,
  Save,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import { checkQuotationStatus, createSupplierQuotation, getRFQ } from "../../api/sourcing";
import {
  attachCostBreakdownToQuotation,
  rfqRequiresCostBreakdown,
} from "../../api/costBreakdown";
import {
  declineRfq,
  getSupplierResponse,
  type SupplierRfqResponse,
} from "../../api/supplierRfqResponse";
import { triggerQuotationDeclined } from "../../api/notifications";
import NoQuoteDialog, {
  type NoQuotePayload,
} from "../../components/supplier-portal/NoQuoteDialog";
import { uploadFileToERPNext, getFullFileUrl } from "../../api/legalDocsStorage";
import { AppLoading, EnterpriseError } from "../../components/enterprise";
import EngineeringDocumentsPanel from "../../components/supplier-portal/EngineeringDocumentsPanel";
import CostBreakdownPanel, {
  type CostBreakdownPanelHandle,
} from "../../components/supplier-portal/CostBreakdownPanel";
import {
  Drawing2dCell,
  PartNameCell,
} from "../../components/warehouse/EngineeringDocCells";
import type { RFQ, RFQItem } from "../../types/erpnext";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  isoDateOffset,
  todayIso,
} from "../../utils/format";
import { resolveItemEngineeringDocsBatch } from "../../api/resolveItemEngineeringDocs";
import {
  pickEngineeringDocs,
  type EngineeringDocs,
} from "../../utils/materialRequestItemFiles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

const DELIVERY_DAY_OPTIONS = [1, 2, 3, 5, 7, 10, 14, 15, 21, 30, 45, 60, 90] as const;

interface SupplierSession {
  supplierName: string;
  loggedIn: boolean;
  linkedSupplier?: string;
  companyName?: string;
  authMode?: "pin" | "account";
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
  part_name?: string;
  drawing_2d_url?: string;
  attachments?: import("../../utils/materialRequestItemFiles").EngineeringAttachment[];
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

  // Must match Request for Quotation Supplier.supplier (ERP Supplier.name), not display label.
  const supplierName = (() => {
    if (!session) return "";
    const linked = String(session.linkedSupplier || "").trim();
    const stored = String(session.supplierName || "").trim();
    const company = String(session.companyName || "").trim();
    return (
      linked ||
      (session.authMode === "pin" ? stored : "") ||
      (company && stored && company !== stored ? stored : "") ||
      stored
    );
  })();

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
  const [declined, setDeclined] = useState<SupplierRfqResponse | null>(null);
  const [noQuoteOpen, setNoQuoteOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
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

      // 1b. Check ERPNext for an explicit "No Quote" decline response. A
      // declined supplier gets a read-only screen instead of the quote form.
      try {
        const response = await getSupplierResponse(rfqName, supplierName);
        if (!cancelled && response) {
          setDeclined(response);
          setCheckingStatus(false);
          return;
        }
      } catch {
        /* fall through */
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
        // ERPNext check failed — fall through to the quote_status check
        // below rather than trusting sessionStorage alone.
      }

      // 3. Check the RFQ supplier row's quote_status — the ERPNext-owned
      // authoritative signal. sessionStorage data is used ONLY to enrich the
      // read-only summary (line items/terms) once ERPNext confirms
      // submission — it must NEVER be the sole trigger for "submitted",
      // otherwise a failed ERPNext create (network error, validation error,
      // etc.) leaves a local draft behind that permanently masks the
      // failure: the supplier sees "Quotation Submitted" forever while
      // procurement never receives a real Supplier Quotation.
      const supplierRow = (rfq?.suppliers ?? []).find((s) => s.supplier === supplierName);
      if (!cancelled && supplierRow?.quote_status === "No Quote") {
        setDeclined({
          name: rfqName,
          rfq: rfqName,
          supplier: supplierName,
          response_status: "No Quote",
          decline_reason: "",
        });
        setCheckingStatus(false);
        return;
      }
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
      }

      if (!cancelled) setCheckingStatus(false);
    }

    detect();
    return () => { cancelled = true; };
  }, [rfqName, supplierName, rfq]);

  /* ─────────────── Local quote state ─────────────── */

  const [lines, setLines] = useState<QuoteLine[]>([]);
  /** Resolved MR→RFQ engineering docs by item_code (read-only for suppliers). */
  const [engByCode, setEngByCode] = useState<Map<string, EngineeringDocs>>(
    () => new Map(),
  );
  const [paymentTerms, setPaymentTerms] = useState("Net 30 days");
  const [validityDate, setValidityDate] = useState(isoDateOffset(30));
  const [notes, setNotes] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [costBreakdownReady, setCostBreakdownReady] = useState(false);
  const costBreakdownRef = useRef<CostBreakdownPanelHandle>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [additionalOpen, setAdditionalOpen] = useState(true);
  const [dragOverDoc, setDragOverDoc] = useState<string | null>(null);
  const [legalDocsOpen, setLegalDocsOpen] = useState(true);
  const [expandedLegalDoc, setExpandedLegalDoc] = useState<
    Record<"terms_pdf" | "warranty_pdf" | "insurance_pdf", boolean>
  >({
    terms_pdf: true,
    warranty_pdf: false,
    insurance_pdf: false,
  });

  /* ── Legal document uploads ── */
  const [legalDraft, setLegalDraft] = useState({
    terms_file_url: "", terms_file_name: "", terms_note: "",
    warranty_file_url: "", warranty_file_name: "", warranty_note: "",
    insurance_file_url: "", insurance_file_name: "", insurance_note: "",
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

    const base = field === "terms_pdf" ? "terms" : field === "warranty_pdf" ? "warranty" : "insurance";
    setUploading(field);
    try {
      const tempDocName = `temp-${supplierName}-${Date.now()}`.replace(/\s+/g, "_");
      const fileUrl = await uploadFileToERPNext(file, "Supplier Quotation", tempDocName);
      setLegalDraft((prev) => ({
        ...prev,
        [`${base}_file_url`]: fileUrl,
        [`${base}_file_name`]: file.name,
      }));
      setExpandedLegalDoc((prev) => ({ ...prev, [field]: false }));
      toast.success(`${file.name} uploaded to server`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Upload failed: " + msg);
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

  const handleLegalDelete = async (
    field: "terms_pdf" | "warranty_pdf" | "insurance_pdf"
  ) => {
    const base = field === "terms_pdf" ? "terms" : field === "warranty_pdf" ? "warranty" : "insurance";
    const urlField = `${base}_file_url` as keyof typeof legalDraft;
    const nameField = `${base}_file_name` as keyof typeof legalDraft;
    setLegalDraft((prev) => ({
      ...prev,
      [urlField]: "",
      [nameField]: "",
    }));
    setExpandedLegalDoc((prev) => ({ ...prev, [field]: true }));
    toast.success("Document removed");
  };

  async function handleLegalPreview(field: "terms_pdf" | "warranty_pdf" | "insurance_pdf") {
    const base = field === "terms_pdf" ? "terms" : field === "warranty_pdf" ? "warranty" : "insurance";
    const url = legalDraft[`${base}_file_url` as keyof typeof legalDraft];
    if (!url) return;
    window.open(getFullFileUrl(url), "_blank", "noopener,noreferrer");
  }

  function toggleLegalDoc(field: "terms_pdf" | "warranty_pdf" | "insurance_pdf") {
    setExpandedLegalDoc((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  const allDocsUploaded = !!(
    legalDraft.terms_file_url &&
    legalDraft.warranty_file_url &&
    legalDraft.insurance_file_url
  );
  const [submittedQuote, setSubmittedQuote] = useState<{
    name: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!rfq?.items || !supplierName) return;

    let cancelled = false;

    void (async () => {
      // Resolve from RFQ Item JSON and/or linked Material Request Item + File
      // DocType — never re-upload; same references Warehouse/Procurement use.
      const engMap = await resolveItemEngineeringDocsBatch(
        (rfq.items ?? []).map((it) => ({
          item_code: it.item_code,
          material_request: it.material_request,
          material_request_item: it.material_request_item,
          custom_part_name: it.custom_part_name,
          custom_2d_drawing: it.custom_2d_drawing,
          custom_engineering_attachments: it.custom_engineering_attachments,
          rfq_name: rfq.name,
        })),
      );
      if (cancelled) return;

      const engFor = (it: RFQItem) =>
        engMap.get(String(it.material_request_item || "").trim()) ||
        engMap.get(`${rfq.name}::${it.item_code}`) ||
        engMap.get(it.item_code) ||
        pickEngineeringDocs(it);

      const byCode = new Map<string, EngineeringDocs>();
      for (const it of rfq.items ?? []) {
        byCode.set(it.item_code, engFor(it));
      }
      setEngByCode(byCode);

      const draftKey = `draft_quotation_${rfq.name}_${supplierName}`;
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        try {
          const draft = JSON.parse(raw) as {
            items?: QuoteLine[];
            payment_terms?: string;
            valid_till?: string;
            notes?: string;
            legal_documents?: {
              terms_conditions_pdf?: string | null;
              terms_conditions_note?: string;
              terms_conditions_name?: string;
              warranty_certificate_pdf?: string | null;
              warranty_certificate_note?: string;
              warranty_certificate_name?: string;
              insurance_certificate_pdf?: string | null;
              insurance_certificate_note?: string;
              insurance_certificate_name?: string;
            };
            saved_at?: string;
          };

          if (draft.items?.length) {
            const byCode = new Map(
              (rfq.items ?? []).map((it) => [it.item_code, engFor(it)]),
            );
            setLines(
              draft.items.map((line) => ({
                ...line,
                ...byCode.get(line.item_code),
              })),
            );
            if (draft.payment_terms) setPaymentTerms(draft.payment_terms);
            if (draft.valid_till) setValidityDate(draft.valid_till);
            if (draft.notes != null) setNotes(draft.notes);
            if (draft.legal_documents) {
              const ld = draft.legal_documents;
              setLegalDraft({
                terms_file_url: ld.terms_conditions_pdf ?? "",
                terms_file_name: ld.terms_conditions_name ?? "",
                terms_note: ld.terms_conditions_note ?? "",
                warranty_file_url: ld.warranty_certificate_pdf ?? "",
                warranty_file_name: ld.warranty_certificate_name ?? "",
                warranty_note: ld.warranty_certificate_note ?? "",
                insurance_file_url: ld.insurance_certificate_pdf ?? "",
                insurance_file_name: ld.insurance_certificate_name ?? "",
                insurance_note: ld.insurance_certificate_note ?? "",
              });
            }
            if (draft.saved_at) setDraftSavedAt(draft.saved_at);
            return;
          }
        } catch {
          /* fall through to RFQ defaults */
        }
      }

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
          ...engFor(it),
        })),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [rfq, supplierName]);

  function persistDraft(showToast = false) {
    if (!rfq || !supplierName) return;
    const saved_at = new Date().toISOString();
    const draftKey = `draft_quotation_${rfq.name}_${supplierName}`;
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          items: lines,
          payment_terms: paymentTerms,
          valid_till: validityDate,
          notes,
          legal_documents: {
            terms_conditions_pdf: legalDraft.terms_file_url || null,
            terms_conditions_name: legalDraft.terms_file_name,
            terms_conditions_note: legalDraft.terms_note,
            warranty_certificate_pdf: legalDraft.warranty_file_url || null,
            warranty_certificate_name: legalDraft.warranty_file_name,
            warranty_certificate_note: legalDraft.warranty_note,
            insurance_certificate_pdf: legalDraft.insurance_file_url || null,
            insurance_certificate_name: legalDraft.insurance_file_name,
            insurance_certificate_note: legalDraft.insurance_note,
          },
          saved_at,
        })
      );
      setDraftSavedAt(saved_at);
      if (showToast) toast.success("Draft saved");
    } catch {
      if (showToast) toast.error("Could not save draft locally");
    }
  }

  useEffect(() => {
    if (!rfq || !supplierName || alreadySubmitted) return;
    const timer = window.setTimeout(() => persistDraft(false), 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, paymentTerms, validityDate, notes, legalDraft, rfq, supplierName, alreadySubmitted]);

  function handleSaveDraft() {
    persistDraft(true);
  }

  function patchLine(idx: number, patch: Partial<QuoteLine>) {
    setLines((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    );
  }

  const grandTotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.unit_price * l.qty, 0),
    [lines]
  );

  const avgDeliveryDays = useMemo(() => {
    if (lines.length === 0) return 0;
    return Math.round(
      lines.reduce((sum, l) => sum + (l.delivery_days || 0), 0) / lines.length
    );
  }, [lines]);

  const uploadedDocsCount = useMemo(() => {
    return [
      legalDraft.terms_file_url,
      legalDraft.warranty_file_url,
      legalDraft.insurance_file_url,
    ].filter(Boolean).length;
  }, [legalDraft]);

  const requiresCostBreakdown = !!rfq && rfqRequiresCostBreakdown(rfq);
  const pricingComplete = lines.length > 0 && lines.every((l) => l.unit_price > 0);
  const costBreakdownComplete = !requiresCostBreakdown || costBreakdownReady;
  const additionalComplete = !!(paymentTerms.trim() && validityDate);
  const documentsComplete = allDocsUploaded;
  const reviewComplete = acceptedTerms;

  const completionPct = useMemo(() => {
    const pricingWeight = requiresCostBreakdown ? 22 : 30;
    const costWeight = requiresCostBreakdown ? 8 : 0;
    const pricingScore = lines.length
      ? (lines.filter((l) => l.unit_price > 0).length / lines.length) *
        pricingWeight
      : 0;
    const costScore = requiresCostBreakdown && costBreakdownReady ? costWeight : 0;
    let additionalScore = 0;
    if (paymentTerms.trim()) additionalScore += 10;
    if (validityDate) additionalScore += 10;
    const docScore = (uploadedDocsCount / 3) * 30;
    const reviewScore = acceptedTerms ? 20 : 0;
    return Math.min(
      100,
      Math.round(
        pricingScore + costScore + additionalScore + docScore + reviewScore,
      ),
    );
  }, [
    lines,
    paymentTerms,
    validityDate,
    uploadedDocsCount,
    acceptedTerms,
    requiresCostBreakdown,
    costBreakdownReady,
  ]);

  const submitBlockers = useMemo(() => {
    const issues: string[] = [];
    const unpriced = lines.filter((l) => !(l.unit_price > 0));
    if (unpriced.length > 0) {
      issues.push(
        `Enter unit price for ${unpriced.length} item${unpriced.length === 1 ? "" : "s"}`
      );
    }
    if (requiresCostBreakdown && !costBreakdownReady) {
      issues.push("Complete and validate the Cost Breakdown");
    }
    if (!paymentTerms.trim()) issues.push("Payment terms are required");
    if (!validityDate) issues.push("Quote validity date is required");
    if (!allDocsUploaded) {
      issues.push(
        `Upload all legal documents (${uploadedDocsCount}/3 complete)`
      );
    }
    if (!acceptedTerms) issues.push("Accept the terms & conditions checkbox");
    return issues;
  }, [
    lines,
    paymentTerms,
    validityDate,
    allDocsUploaded,
    uploadedDocsCount,
    acceptedTerms,
    requiresCostBreakdown,
    costBreakdownReady,
  ]);

  const canSubmit = submitBlockers.length === 0 && !submitting;

  const workflowSteps = useMemo(() => {
    const steps = [
      { id: "section-pricing", label: "Pricing", complete: pricingComplete },
    ];
    if (requiresCostBreakdown) {
      steps.push({
        id: "section-cost-breakdown",
        label: "Cost Breakdown",
        complete: costBreakdownComplete,
      });
    }
    steps.push(
      {
        id: "section-additional",
        label: "Additional Information",
        complete: additionalComplete,
      },
      { id: "section-documents", label: "Documents", complete: documentsComplete },
      {
        id: "section-review",
        label: "Review & Submit",
        complete: reviewComplete,
      },
    );
    return steps;
  }, [
    pricingComplete,
    requiresCostBreakdown,
    costBreakdownComplete,
    additionalComplete,
    documentsComplete,
    reviewComplete,
  ]);

  const activeStepId = useMemo(() => {
    const next = workflowSteps.find((s) => !s.complete);
    return next?.id ?? workflowSteps[workflowSteps.length - 1]?.id ?? "";
  }, [workflowSteps]);

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
    if (requiresCostBreakdown) {
      if (!costBreakdownRef.current?.isReady()) {
        toast.error("Please complete the Cost Breakdown before submitting.");
        scrollToSection("section-cost-breakdown");
        return;
      }
      try {
        await costBreakdownRef.current.save({ status: "Draft" });
      } catch (cbErr) {
        toast.error(
          cbErr instanceof Error
            ? cbErr.message
            : "Failed to save Cost Breakdown.",
        );
        scrollToSection("section-cost-breakdown");
        return;
      }
    }

    // eslint-disable-next-line no-console
    console.log("[SupplierQuote] Legal documents being submitted:", {
      terms_conditions_pdf: legalDraft.terms_file_url ?? "(not uploaded)",
      terms_conditions_note: legalDraft.terms_note || "(empty)",
      warranty_certificate_pdf: legalDraft.warranty_file_url ?? "(not uploaded)",
      warranty_certificate_note: legalDraft.warranty_note || "(empty)",
      insurance_certificate_pdf: legalDraft.insurance_file_url ?? "(not uploaded)",
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
            terms_conditions_pdf: legalDraft.terms_file_url ?? null,
            terms_conditions_note: legalDraft.terms_note,
            warranty_certificate_pdf: legalDraft.warranty_file_url ?? null,
            warranty_certificate_note: legalDraft.warranty_note,
            insurance_certificate_pdf: legalDraft.insurance_file_url ?? null,
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
        // Attach the uploaded legal documents to the real ERPNext record —
        // these are what the Legal Document Review is built from once this
        // supplier is selected as the winner.
        legal_documents: {
          terms_conditions_pdf: legalDraft.terms_file_url || null,
          terms_conditions_note: legalDraft.terms_note,
          warranty_certificate_pdf: legalDraft.warranty_file_url || null,
          warranty_certificate_note: legalDraft.warranty_note,
          insurance_certificate_pdf: legalDraft.insurance_file_url || null,
          insurance_certificate_note: legalDraft.insurance_note,
        },
      });
      const quoteName = (result as { name?: string }).name ?? "";
      const quoteStatus = (result as { status?: string }).status ?? "Draft";
      setSubmittedQuote({ name: quoteName, status: quoteStatus });

      if (quoteName && requiresCostBreakdown) {
        try {
          await attachCostBreakdownToQuotation(
            rfq.name,
            supplierName,
            quoteName,
          );
        } catch (linkErr) {
          // eslint-disable-next-line no-console
          console.warn("[CostBreakdown] attach to SQ failed:", linkErr);
        }
      }

      toast.success(
        quoteStatus === "Submitted"
          ? `Quotation ${quoteName} submitted!`
          : `Quotation ${quoteName} saved (Draft)`
      );

      // ── Legal Document Review is NOT created here ─────────────────────────
      // Reviewing legal documents only makes sense for the WINNING supplier,
      // so the backend creates exactly one Legal Document Review per RFQ —
      // gated on the Procurement Manager selecting a supplier (RFQ workflow
      // → "Pending Legal Review") — never at quotation submission time.
      // See ensureLegalDocumentReviewForSelection() in RFQDetailPage.tsx and
      // api/legalReviewCore.ts (createLegalDocumentReview). The terms /
      // warranty / insurance files captured above are stored on the
      // Supplier Quotation's own custom fields and are read from there once
      // this quotation is selected as the winner.
      if (quoteName) {
        // eslint-disable-next-line no-console
        console.log(
          "[Legal] Quotation submitted — Legal Document Review will be created by the backend only if/when this supplier is selected as the winner."
        );
      }
    } catch (err) {
      const realError = err instanceof Error ? err.message : "Unknown error";
      // eslint-disable-next-line no-console
      console.error("[SQ] Full error:", err);
      // Do NOT navigate away and do NOT set `submittedQuote` on failure.
      // The sessionStorage snapshot above is a local draft-recovery aid
      // only — it is never treated as proof of submission (see the
      // `detect()` effect above) — so staying on this page with the form
      // still filled in and a clear error is the only way for the supplier
      // to know the quotation was NOT actually received by procurement and
      // that they need to retry, instead of silently believing they're done.
      toast.error(
        `Quotation was NOT submitted: ${realError}. Please try again.`,
        { duration: 10_000 }
      );
    }

    setSubmitting(false);
  }

  async function handleDecline(payload: NoQuotePayload) {
    if (!rfq) return;
    setDeclining(true);
    try {
      const rfqSupplierRow = (rfq.suppliers ?? []).find(
        (s) => s.supplier === supplierName
      );
      const response = await declineRfq({
        rfq: rfq.name,
        supplier: supplierName,
        supplierDisplayName: supplierName,
        rfqSupplierRow: rfqSupplierRow?.name,
        reason: payload.reason,
        reasonDetails: payload.reasonDetails,
        comment: payload.comment,
        respondedBy: supplierName,
      });

      // Notify the procurement manager (in-app). Non-fatal on failure.
      try {
        triggerQuotationDeclined(rfq.name, supplierName, payload.reason);
      } catch {
        /* ignore */
      }

      setNoQuoteOpen(false);
      setDeclined(response);
      toast.success("Your 'No Quote' response has been sent to the buyer.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Could not submit No Quote: ${msg}`, { duration: 10_000 });
    } finally {
      setDeclining(false);
    }
  }

  /* ─────────────── Render ─────────────── */

  if (!session) {
    return (
      
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      
    );
  }

  /* ── Success screen ──────────────────────────────────────────────── */
  if (submittedQuote) {
    const isSubmitted = submittedQuote.status === "Submitted";
    return (
      
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
      
    );
  }

  if (rfqQuery.isLoading) {
    return (
      
        <AppLoading variant="document" />
      
    );
  }

  if (rfqQuery.isError || !rfq) {
    return (
      
        <EnterpriseError
          error={rfqQuery.error ?? new Error("not found")}
          onRetry={() => void rfqQuery.refetch()}
          onBack={() => window.history.back()}
        />
      
    );
  }

  // Draft RFQs (docstatus 0) are internal to Procurement and must never be
  // accessible to suppliers — block access even via a direct link.
  const isPublished = (rfq as { docstatus?: number }).docstatus === 1;
  if (!isPublished) {
    return (
      
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
      
    );
  }

  if (!isInvited) {
    return (
      
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
      
    );
  }

  /* ── Checking status spinner ──────────────────────────────────────── */
  if (checkingStatus) {
    return (
      
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
          <span className="text-sm text-neutral-500">Checking quotation status…</span>
        </div>
      
    );
  }

  /* ── Read-only view: Supplier declined (No Quote) ─────────────────── */
  if (declined) {
    return (
      
        <BackToDashboard />

        <div className="mb-4 rounded-2xl border border-warning-200 bg-warning-50 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-warning-100">
              <Ban className="h-5 w-5 text-warning-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-warning-900">No Quote Submitted</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-500 px-2.5 py-0.5 text-[10px] font-bold text-white">
                  <Lock className="h-2.5 w-2.5" /> Declined
                </span>
              </div>
              <p className="mt-1 text-sm text-warning-800">
                You have declined to quote for this RFQ. The buyer has been notified of your response.
              </p>
              {declined.response_date && (
                <p className="mt-1 text-xs text-warning-700">
                  <Clock className="mr-1 inline h-3 w-3" />
                  Submitted on {formatDateTime(declined.response_date)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mb-2">
          <h1 className="text-xl font-bold text-neutral-900">
            RFQ {rfq.name} — Declined
          </h1>
          <p className="text-sm text-neutral-600">
            {parsedMessage.title || "Your decline response is shown below in read-only mode."}
          </p>
        </div>

        <div className="mt-4 card divide-y divide-neutral-100">
          <div className="flex items-start justify-between gap-4 px-5 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Reason
            </span>
            <span className="text-right text-sm font-medium text-neutral-800">
              {declined.decline_reason || "—"}
            </span>
          </div>
          {declined.reason_details && (
            <div className="flex items-start justify-between gap-4 px-5 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Details
              </span>
              <span className="max-w-[70%] text-right text-sm text-neutral-700">
                {declined.reason_details}
              </span>
            </div>
          )}
          {declined.comment && (
            <div className="flex items-start justify-between gap-4 px-5 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Comments
              </span>
              <span className="max-w-[70%] text-right text-sm text-neutral-700">
                {declined.comment}
              </span>
            </div>
          )}
        </div>
      
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
              {subData.items.map((line) => {
                const eng =
                  engByCode.get(line.item_code) ||
                  pickEngineeringDocs(
                    (rfq.items ?? []).find((i) => i.item_code === line.item_code),
                  );
                return (
                <div key={line.item_code} className="space-y-2 p-4 bg-neutral-50/40">
                  <div>
                    <p className="font-medium text-neutral-900">{line.item_name}</p>
                    <p className="text-xs text-neutral-500">{line.item_code}</p>
                  </div>
                  <EngineeringDocumentsPanel
                    partName={eng.part_name}
                    drawing2dUrl={eng.drawing_2d_url}
                    attachments={eng.attachments}
                  />
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
              );
              })}
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
                    <th className="px-4 py-2">Part Name</th>
                    <th className="px-4 py-2">Attachments</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2">UOM</th>
                    <th className="px-4 py-2 text-right">Unit Price</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right">Delivery (days)</th>
                    <th className="px-4 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {subData.items.map((line) => {
                    const eng =
                      engByCode.get(line.item_code) ||
                      pickEngineeringDocs(
                        (rfq.items ?? []).find(
                          (i) => i.item_code === line.item_code,
                        ),
                      );
                    return (
                    <tr key={line.item_code} className="bg-neutral-50/40">
                      <td className="px-4 py-2 align-top">
                        <p className="font-medium text-neutral-900">{line.item_name}</p>
                        <p className="text-xs text-neutral-500">{line.item_code}</p>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <PartNameCell value={eng.part_name} />
                      </td>
                      <td className="px-4 py-2 align-top">
                        <Drawing2dCell
                          url={eng.drawing_2d_url}
                          attachments={eng.attachments}
                        />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{line.qty}</td>
                      <td className="px-4 py-2 text-neutral-700">{line.uom}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-neutral-900">{formatCurrency(line.unit_price)}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-900">{formatCurrency(line.unit_price * line.qty)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{line.delivery_days}</td>
                      <td className="px-4 py-2 text-neutral-600">{line.notes || "—"}</td>
                    </tr>
                  );
                  })}
                </tbody>
                <tfoot className="bg-neutral-100">
                  <tr>
                    <td colSpan={7} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-600">Grand Total</td>
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
      
    );
  }

  const validTillDisplay =
    parsedMessage.validTill || rfq.valid_till || undefined;
  const rfqStatusLabel = rfq.status ?? "Open";

  const submitDisabledTitle = !acceptedTerms
    ? "Accept Terms & Conditions to enable submission."
    : submitBlockers.length > 0
      ? submitBlockers.join("; ")
      : undefined;

  return (
    
      {/* Content scrolls above a sticky footer so Submit is never clipped */}
      <div className="-mb-8 flex h-[calc(100dvh-7.5rem)] flex-col overflow-hidden sm:h-[calc(100dvh-4rem)] lg:h-[calc(100dvh-3.75rem)]">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex w-full flex-col gap-6 pb-3">
        <BackToDashboard />

        {/* Compact RFQ header */}
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">
                Request for Quotation
              </p>
              <h1 className="mt-0.5 text-lg font-bold text-neutral-900 sm:text-xl">
                {parsedMessage.title || rfq.name}
              </h1>
              <p className="mt-0.5 text-xs font-medium text-neutral-500">{rfq.name}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                Draft
              </span>
              {validTillDisplay && (
                <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200">
                  <Calendar className="h-3 w-3" />
                  Due {formatDate(validTillDisplay)}
                </span>
              )}
              {draftSavedAt && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <CheckCircle2 className="h-3 w-3" />
                  Auto Saved
                </span>
              )}
              <span className="inline-flex items-center rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-semibold text-primary-700 ring-1 ring-inset ring-primary-200">
                {rfqStatusLabel}
              </span>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <HeaderMeta label="RFQ Number" value={rfq.name} />
            <HeaderMeta label="Buyer" value={rfq.company || "Netlink"} />
            <HeaderMeta label="Issue Date" value={formatDate(rfq.transaction_date)} />
            <HeaderMeta
              label="Valid Till"
              value={validTillDisplay ? formatDate(validTillDisplay) : "—"}
            />
          </div>
          {parsedMessage.body && (
            <div className="mt-2.5 rounded-lg border border-neutral-100 bg-neutral-50/80 px-3 py-2 text-sm leading-relaxed text-neutral-700">
              <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                <FileText className="h-3 w-3" />
                Buyer Notes
              </p>
              <p className="whitespace-pre-line">{parsedMessage.body}</p>
            </div>
          )}
        </div>

        <div className="mt-2.5 flex items-center justify-end">
          <p className="text-xs font-semibold text-primary-700">{completionPct}% complete</p>
        </div>

        <WorkflowProgress
          steps={workflowSteps}
          activeStepId={activeStepId}
          onStepClick={scrollToSection}
        />

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="space-y-3">
            {/* Pricing — item cards */}
            <section
              id="section-pricing"
              className="scroll-mt-24 rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-center justify-between border-b border-neutral-100 px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary-600" />
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-900">Line Items & Pricing</h2>
                    <p className="text-[11px] text-neutral-500">
                      Enter unit price, delivery, and notes for each item
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                  {lines.length} items
                </span>
              </div>
              <div className="space-y-2 p-2.5">
                {lines.map((line, idx) => (
                  <QuoteItemCard
                    key={line.item_code}
                    line={line}
                    index={idx}
                    onPatch={patchLine}
                  />
                ))}
              </div>
            </section>

            {requiresCostBreakdown && (
              <CostBreakdownPanel
                ref={costBreakdownRef}
                rfqName={rfq.name}
                supplier={supplierName}
                items={lines.map((l) => ({
                  item_code: l.item_code,
                  item_name: l.item_name,
                }))}
                readOnly={!!alreadySubmitted}
                onReadyChange={setCostBreakdownReady}
              />
            )}

            {/* Additional information — collapsible */}
            <section
              id="section-additional"
              className="scroll-mt-24 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <button
                type="button"
                onClick={() => setAdditionalOpen((v) => !v)}
                className="flex w-full items-center justify-between border-none bg-transparent px-3.5 py-2.5 text-left hover:bg-neutral-50/80"
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary-600" />
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-900">
                      Additional Information
                    </h2>
                    <p className="text-[11px] text-neutral-500">
                      Payment terms, validity, and general notes
                    </p>
                  </div>
                </div>
                {additionalOpen ? (
                  <ChevronDown className="h-4 w-4 text-neutral-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-neutral-400" />
                )}
              </button>
              {additionalOpen && (
                <div className="grid gap-2.5 border-t border-neutral-100 p-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="payment-terms"
                      className="mb-1 block text-xs font-medium text-neutral-700"
                    >
                      Payment Terms
                    </label>
                    <input
                      id="payment-terms"
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                      placeholder="e.g. Net 30 days"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="quote-validity"
                      className="mb-1 block text-xs font-medium text-neutral-700"
                    >
                      Validity of Quote
                    </label>
                    <input
                      id="quote-validity"
                      type="date"
                      value={validityDate}
                      min={todayIso()}
                      onChange={(e) => setValidityDate(e.target.value)}
                      className="input-field"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="quote-notes"
                      className="mb-1 block text-xs font-medium text-neutral-700"
                    >
                      General Notes
                    </label>
                    <textarea
                      id="quote-notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Warranty, brand substitutions, freight terms…"
                      className="input-field min-h-[80px] resize-y"
                    />
                  </div>
                </div>
              )}
            </section>

            {/* Legal documents — accordion */}
            <section
              id="section-documents"
              className="scroll-mt-24 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <button
                type="button"
                onClick={() => setLegalDocsOpen((v) => !v)}
                className="flex w-full items-center justify-between border-none bg-transparent px-3.5 py-2.5 text-left hover:bg-neutral-50/80"
              >
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary-600" />
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-900">
                      Legal &amp; Compliance Documents
                    </h2>
                    <p className="text-[11px] text-neutral-500">
                      {uploadedDocsCount}/3 uploaded — expand each section to manage files
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {documentsComplete && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      Complete
                    </span>
                  )}
                  {legalDocsOpen ? (
                    <ChevronDown className="h-4 w-4 text-neutral-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-neutral-400" />
                  )}
                </div>
              </button>
              {legalDocsOpen && (
                <div className="space-y-2 border-t border-neutral-100 p-2.5">
                  {(
                    [
                      { field: "terms_pdf" as const, label: "Terms & Conditions", icon: FileText },
                      { field: "warranty_pdf" as const, label: "Warranty Document", icon: Shield },
                      {
                        field: "insurance_pdf" as const,
                        label: "Insurance Certificate",
                        icon: FileCheck,
                      },
                    ] as const
                  ).map(({ field, label, icon: Icon }) => (
                    <LegalDocUploadCard
                      key={field}
                      field={field}
                      label={label}
                      icon={Icon}
                      expanded={expandedLegalDoc[field]}
                      onToggle={() => toggleLegalDoc(field)}
                      legalDraft={legalDraft}
                      uploading={uploading === field}
                      dragOver={dragOverDoc === field}
                      onUpload={handleLegalUpload}
                      onDelete={handleLegalDelete}
                      onPreview={handleLegalPreview}
                      onNoteChange={handleLegalNoteChange}
                      onDragOver={() => setDragOverDoc(field)}
                      onDragLeave={() => setDragOverDoc(null)}
                      onDrop={(file) => {
                        setDragOverDoc(null);
                        void handleLegalUpload(field, file);
                      }}
                    />
                  ))}
                  {!allDocsUploaded && (
                    <p className="flex items-center gap-1.5 px-1 text-xs font-medium text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      All documents must be uploaded before submitting your quotation.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Review */}
            <section
              id="section-review"
              className="scroll-mt-24 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
            >
              <h2 className="text-sm font-semibold text-neutral-900">Review &amp; Submit</h2>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                Confirm terms before submitting your quotation to the buyer
              </p>
              <label
                className={`mt-2.5 flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition ${
                  !acceptedTerms
                    ? "border-red-300 bg-red-50/50 text-neutral-800 ring-1 ring-inset ring-red-200"
                    : "border-neutral-100 bg-neutral-50/60 text-neutral-700 hover:border-primary-200 hover:bg-primary-50/30"
                }`}
              >
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  aria-invalid={!acceptedTerms}
                  aria-describedby={!acceptedTerms ? "terms-accept-hint" : undefined}
                  className={`mt-0.5 h-4 w-4 rounded focus:ring-2 ${
                    !acceptedTerms
                      ? "border-red-500 text-red-600 focus:ring-red-500"
                      : "border-neutral-300 text-primary-600 focus:ring-primary-500"
                  }`}
                />
                <span>
                  I accept Netlink&apos;s RFQ terms &amp; conditions and confirm the pricing
                  above is firm and binding for the validity period.
                </span>
              </label>
              {!acceptedTerms && (
                <p
                  id="terms-accept-hint"
                  className="mt-1.5 flex items-center gap-1 px-0.5 text-xs font-medium text-red-600"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Accept Terms &amp; Conditions to enable submission.
                </p>
              )}
            </section>
          </div>

          {/* Sticky quote summary — desktop */}
          <aside className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:self-start">
            <QuoteSummaryPanel
              itemCount={lines.length}
              grandTotal={grandTotal}
              avgDeliveryDays={avgDeliveryDays}
              uploadedDocsCount={uploadedDocsCount}
              completionPct={completionPct}
            />
          </aside>
        </div>

        {/* Mobile summary — sticky while scrolling */}
        <div className="sticky top-0 z-10 mt-3 lg:hidden">
          <QuoteSummaryPanel
            itemCount={lines.length}
            grandTotal={grandTotal}
            avgDeliveryDays={avgDeliveryDays}
            uploadedDocsCount={uploadedDocsCount}
            completionPct={completionPct}
          />
        </div>
          </div>
        </div>

      {/* Sticky bottom action bar — Quote Total + actions in one footer */}
      <div className="sticky bottom-0 z-40 shrink-0 border-t border-neutral-200 bg-white/95 shadow-[0_-6px_24px_rgba(15,23,42,0.08)] backdrop-blur-md supports-[backdrop-filter]:bg-white/90">
        <div className="flex w-full flex-col gap-2 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-4">
            <div className="min-w-0 shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                Quote Total
              </p>
              <p className="text-xl font-bold tabular-nums text-primary-600 sm:text-2xl">
                {formatCurrency(grandTotal)}
              </p>
              {draftSavedAt && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-500">
                  <Clock className="h-3 w-3" />
                  Auto saved {formatDateTime(draftSavedAt)}
                </p>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={submitting}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 shadow-sm transition hover:border-primary-300 hover:bg-neutral-50 hover:shadow disabled:opacity-60 sm:flex-none sm:px-4"
              >
                <Save className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">Save Draft</span>
              </button>
              <button
                type="button"
                onClick={() => setNoQuoteOpen(true)}
                disabled={submitting}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-sm font-semibold text-warning-700 shadow-sm transition hover:border-warning-400 hover:bg-warning-100 disabled:opacity-60 sm:flex-none sm:px-4"
              >
                <Ban className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">No Quote</span>
              </button>
              {/* Wrapper so tooltip works while the button is disabled */}
              <span
                className="inline-flex min-w-0 flex-[1.2] sm:flex-none"
                title={submitDisabledTitle}
              >
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  aria-disabled={!canSubmit}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-primary-700 hover:shadow-lg disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none sm:min-w-[11.5rem] sm:px-5"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 shrink-0" />
                  )}
                  <span className="whitespace-nowrap">
                    {submitting ? "Submitting…" : "Submit Quotation"}
                  </span>
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>

      <NoQuoteDialog
        open={noQuoteOpen}
        rfqName={rfq.name}
        submitting={declining}
        onClose={() => setNoQuoteOpen(false)}
        onSubmit={handleDecline}
      />
    
  );
}

/* ============================================================================
 * UI helpers — quotation form
 * ========================================================================== */

function HeaderMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      <p className="mt-0.5 truncate text-xs font-semibold text-neutral-800">{value}</p>
    </div>
  );
}

function WorkflowProgress({
  steps,
  activeStepId,
  onStepClick,
}: {
  steps: Array<{ id: string; label: string; complete: boolean }>;
  activeStepId: string;
  onStepClick: (id: string) => void;
}) {
  return (
    <div className="mt-2.5 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex min-w-max items-center gap-1 sm:min-w-0 sm:flex-wrap">
        {steps.map((step, idx) => {
          const isActive = step.id === activeStepId && !step.complete;
          const isCurrent = step.id === activeStepId;
          return (
            <div key={step.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onStepClick(step.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all duration-200 hover:shadow-sm ${
                  step.complete
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                    : isActive
                      ? "bg-primary-50 text-primary-800 ring-2 ring-inset ring-primary-400 shadow-sm"
                      : isCurrent
                        ? "bg-primary-50/80 text-primary-700 ring-1 ring-inset ring-primary-300"
                        : "bg-neutral-50 text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:bg-primary-50 hover:text-primary-700"
                }`}
              >
                {step.complete ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                      isActive
                        ? "bg-primary-600 text-white"
                        : "bg-neutral-200 text-neutral-600"
                    }`}
                  >
                    {idx + 1}
                  </span>
                )}
                {step.label}
                {isActive && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary-500" />
                  </span>
                )}
              </button>
              {idx < steps.length - 1 && (
                <ChevronRight className="hidden h-3.5 w-3.5 text-neutral-300 sm:block" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeliveryDaysField({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  const isPresetValue = (DELIVERY_DAY_OPTIONS as readonly number[]).includes(value);
  const [isCustom, setIsCustom] = useState(!isPresetValue);

  const selectValue = isCustom ? "custom" : String(value);

  const handleSelect = (next: string) => {
    if (next === "custom") {
      // Keep whatever integer is already stored as the custom starting point.
      setIsCustom(true);
      return;
    }
    setIsCustom(false);
    onChange(Number(next));
  };

  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-medium text-neutral-600">
        Delivery Days
      </label>
      <Select value={selectValue} onValueChange={handleSelect}>
        <SelectTrigger className="tabular-nums py-1.5 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DELIVERY_DAY_OPTIONS.map((d) => (
            <SelectItem key={d} value={String(d)}>
              {d} {d === 1 ? "Day" : "Days"}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom…</SelectItem>
        </SelectContent>
      </Select>
      {isCustom && (
        <div className="mt-1.5">
          <label className="mb-0.5 block text-[10px] font-medium text-neutral-600">
            Custom Days
          </label>
          <input
            type="number"
            min={0}
            value={value || ""}
            onChange={(e) => onChange(Number(e.target.value))}
            placeholder="Enter number of days"
            className="input-field tabular-nums py-1.5 text-sm"
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

function QuoteItemCard({
  line,
  index,
  onPatch,
}: {
  line: QuoteLine;
  index: number;
  onPatch: (idx: number, patch: Partial<QuoteLine>) => void;
}) {
  const lineTotal = line.unit_price * line.qty;
  const priced = line.unit_price > 0;
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/40 p-2.5 transition-all duration-200 hover:border-primary-200 hover:shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">{line.item_name}</p>
          <p className="text-[11px] text-neutral-500">{line.item_code}</p>
          {line.description ? (
            <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">{line.description}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Qty
          </p>
          <p className="text-sm font-semibold tabular-nums text-neutral-800">
            {line.qty} {line.uom}
          </p>
        </div>
      </div>

      <EngineeringDocumentsPanel
        partName={line.part_name}
        drawing2dUrl={line.drawing_2d_url}
        attachments={line.attachments}
      />

      <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
        <div>
          <label className="mb-0.5 block text-[10px] font-medium text-neutral-600">
            Unit Price
          </label>
          <input
            type="number"
            min={0}
            step="any"
            value={line.unit_price || ""}
            onChange={(e) => onPatch(index, { unit_price: Number(e.target.value) })}
            placeholder="0.00"
            className={`input-field tabular-nums py-1.5 text-sm ${!priced ? "border-amber-200 bg-amber-50/30" : ""}`}
          />
        </div>
        <DeliveryDaysField
          value={line.delivery_days}
          onChange={(days) => onPatch(index, { delivery_days: days })}
        />
        <div>
          <label className="mb-0.5 block text-[10px] font-medium text-neutral-600">
            Line Total
          </label>
          <div className="flex h-[34px] items-center rounded-lg border border-neutral-200 bg-white px-2.5 text-sm font-bold tabular-nums text-primary-600">
            {formatCurrency(lineTotal)}
          </div>
        </div>
      </div>
      <div className="mt-1.5">
        <label className="mb-0.5 block text-[10px] font-medium text-neutral-600">Notes</label>
        <input
          value={line.notes}
          onChange={(e) => onPatch(index, { notes: e.target.value })}
          placeholder="Optional line notes"
          className="input-field py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

function QuoteSummaryPanel({
  itemCount,
  grandTotal,
  avgDeliveryDays,
  uploadedDocsCount,
  completionPct,
}: {
  itemCount: number;
  grandTotal: number;
  avgDeliveryDays: number;
  uploadedDocsCount: number;
  completionPct: number;
}) {
  return (
    <div className="rounded-xl border border-primary-100 bg-gradient-to-b from-primary-50/80 to-white p-3.5 shadow-md ring-1 ring-primary-100/80 transition-shadow hover:shadow-lg">
      <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700">
        Quote Summary
      </h3>
      <div className="mt-2.5 rounded-lg border border-primary-100/80 bg-white/70 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          Grand Total
        </p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums leading-none text-primary-600">
          {formatCurrency(grandTotal)}
        </p>
      </div>
      <div className="mt-2.5 space-y-2">
        <SummaryRow label="Number of Items" value={String(itemCount)} />
        <SummaryRow
          label="Avg. Delivery Days"
          value={itemCount ? `${avgDeliveryDays} days` : "—"}
        />
        <SummaryRow label="Documents Uploaded" value={`${uploadedDocsCount} / 3`} />
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[11px] font-medium text-neutral-600">
          <span>Completion</span>
          <span className="font-bold text-primary-700">{completionPct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary-400 to-primary-600 transition-all duration-500 ease-out"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span
        className={`font-semibold tabular-nums ${
          highlight ? "text-primary-700" : "text-neutral-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

type LegalField = "terms_pdf" | "warranty_pdf" | "insurance_pdf";

function LegalDocUploadCard({
  field,
  label,
  icon: Icon,
  expanded,
  onToggle,
  legalDraft,
  uploading,
  dragOver,
  onUpload,
  onDelete,
  onPreview,
  onNoteChange,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  field: LegalField;
  label: string;
  icon: typeof FileText;
  expanded: boolean;
  onToggle: () => void;
  legalDraft: {
    terms_file_url: string;
    terms_file_name: string;
    terms_note: string;
    warranty_file_url: string;
    warranty_file_name: string;
    warranty_note: string;
    insurance_file_url: string;
    insurance_file_name: string;
    insurance_note: string;
  };
  uploading: boolean;
  dragOver: boolean;
  onUpload: (field: LegalField, file: File) => Promise<void>;
  onDelete: (field: LegalField) => Promise<void>;
  onPreview: (field: LegalField) => Promise<void>;
  onNoteChange: (
    field: "terms_note" | "warranty_note" | "insurance_note",
    value: string
  ) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (file: File) => void;
}) {
  const base =
    field === "terms_pdf" ? "terms" : field === "warranty_pdf" ? "warranty" : "insurance";
  const urlField = `${base}_file_url` as keyof typeof legalDraft;
  const nameField = `${base}_file_name` as keyof typeof legalDraft;
  const noteField = `${base}_note` as "terms_note" | "warranty_note" | "insurance_note";
  const uploaded = !!legalDraft[urlField];
  const fileName = legalDraft[nameField];

  return (
    <div
      className={`overflow-hidden rounded-lg border transition-all duration-200 ${
        uploaded
          ? "border-emerald-200 bg-emerald-50/30"
          : dragOver
            ? "border-primary-400 bg-primary-50/50 shadow-sm"
            : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) onDrop(file);
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between border-none bg-transparent px-2.5 py-2 text-left hover:bg-white/50"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-neutral-200">
            <Icon className="h-3.5 w-3.5 text-primary-600" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-neutral-900">{label}</p>
            {uploaded && fileName ? (
              <p className="mt-0.5 truncate text-[10px] text-neutral-600">{fileName}</p>
            ) : (
              <p className="mt-0.5 text-[10px] text-neutral-500">PDF required</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {uploaded && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <CheckCircle2 className="h-3 w-3" />
              Uploaded
            </span>
          )}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-neutral-100/80 px-2.5 pb-2.5 pt-1.5">
          {uploaded && fileName && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-2 py-1.5">
              <FileCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800">
                {fileName}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => void onPreview(field)}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] font-semibold text-neutral-700 transition hover:border-primary-300 hover:text-primary-700"
                >
                  <Eye className="h-3 w-3" />
                  Preview
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] font-semibold text-neutral-700 transition hover:border-primary-300 hover:text-primary-700">
                  {uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  Replace
                  <input
                    type="file"
                    accept=".pdf"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onUpload(field, file);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void onDelete(field)}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] font-semibold text-neutral-600 transition hover:border-red-200 hover:text-red-600"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            </div>
          )}

          {!uploaded && !uploading && (
            <div className="mb-2 flex items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50/80 px-2 py-3 text-center">
              <CloudUpload className="h-4 w-4 text-neutral-400" />
              <p className="text-[11px] text-neutral-500">Drag &amp; drop PDF or upload</p>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-[10px] font-semibold text-white shadow-sm transition hover:bg-primary-700">
                <Upload className="h-3 w-3" />
                Upload PDF
                <input
                  type="file"
                  accept=".pdf"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onUpload(field, file);
                  }}
                />
              </label>
            </div>
          )}

          {uploading && (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-2 text-xs text-primary-700">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading document…
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-primary-100">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-primary-500" />
              </div>
            </div>
          )}

          <textarea
            placeholder={`Notes about ${label.toLowerCase()}…`}
            value={legalDraft[noteField]}
            onChange={(e) => onNoteChange(noteField, e.target.value)}
            rows={2}
            className="input-field min-h-[48px] resize-y py-1.5 text-xs"
          />
        </div>
      )}
    </div>
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
  children: ReactNode;
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
