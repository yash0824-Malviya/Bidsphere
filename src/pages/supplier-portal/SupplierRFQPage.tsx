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
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import { checkQuotationStatus, createSupplierQuotation } from "../../api/sourcing";
import {
  attachCostBreakdownToQuotation,
  rfqRequiresCostBreakdown,
} from "../../api/costBreakdown";
import {
  declineRfq,
  getSupplierResponse,
  type SupplierRfqResponse,
} from "../../api/supplierRfqResponse";
import {
  getSupplierRfqDetail,
  SupplierRfqAccessError,
  supplierRfqFailureTitle,
} from "../../api/supplierRfqDetail";
import {
  getItemTargetPrice,
  isItemTargetPriceVisibleToSupplier,
  isTargetPriceVisibleToSupplier,
} from "../../utils/rfqTargetPrice";
import { triggerQuotationDeclined } from "../../api/notifications";
import NoQuoteDialog, {
  type NoQuotePayload,
} from "../../components/supplier-portal/NoQuoteDialog";
import { uploadFileToERPNext, getFullFileUrl } from "../../api/legalDocsStorage";
import { AppLoading } from "../../components/enterprise";
import SupplierItemAttachmentsPanel from "../../components/supplier-portal/SupplierItemAttachmentsPanel";
import SupplierRfqDocumentsSection from "../../components/supplier-portal/SupplierRfqDocumentsSection";
import CostBreakdownPanel, {
  type CostBreakdownPanelHandle,
} from "../../components/supplier-portal/CostBreakdownPanel";
import SectionErrorBoundary from "../../components/supplier-portal/SectionErrorBoundary";
import {
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
import { formatRfqRoundLabel } from "../../utils/rfqRoundTracking";
import { resolveItemEngineeringDocsBatch } from "../../api/resolveItemEngineeringDocs";
import {
  filterSupplierVisibleAttachments,
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

/** Enterprise procurement UI tokens (supplier quotation). */
const ENT_CARD =
  "rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(15,23,42,0.08)]";
const ENT_CARD_PAD = "p-4";
const ENT_SECTION_HEAD = "border-b border-[#E2E8F0] px-4 py-2.5";
const ENT_LABEL = "mb-2 block text-[13px] font-medium text-[#64748B]";
const ENT_INPUT =
  "h-11 w-full rounded-2xl border border-[#E2E8F0] bg-white px-3 text-[15px] text-[#0F172A] shadow-sm transition placeholder:text-[#94A3B8] focus:border-[#1F3A6D] focus:outline-none focus:ring-2 focus:ring-[#1F3A6D]/20";

/** Quotation page shell — 1680px max, 24px inline padding, 73/27 column split. */
const QUOTE_PAGE_SHELL = "mx-auto w-full max-w-[1680px] px-6";
const QUOTE_MAIN_GRID =
  "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,73fr)_minmax(0,27fr)] lg:items-start";
const CMD_BAR_BTN =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60";
const CMD_BAR_BTN_OUTLINE = `${CMD_BAR_BTN} border border-[#CBD5E1] bg-white text-[#334155] shadow-sm hover:border-[#1F3A6D]/40 hover:bg-[#F8FAFC] hover:text-[#1F3A6D]`;
const CMD_BAR_BTN_DANGER = `${CMD_BAR_BTN} border border-red-200 bg-white text-red-700 shadow-sm hover:border-red-300 hover:bg-red-50`;
const CMD_BAR_BTN_PRIMARY = `${CMD_BAR_BTN} bg-[#1F3A6D] text-white shadow-[0_2px_8px_rgba(31,58,109,0.25)] hover:bg-[#17315D] disabled:bg-[#CBD5E1] disabled:text-[#64748B] disabled:shadow-none`;

function formatRelativeSavedAt(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return formatDateTime(iso);

  const diffMin = Math.floor((Date.now() - then) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr === 1 ? "" : "s"} ago`;

  return formatDateTime(iso);
}

/** Show contextual action bar after ~75% scroll or when Review section is near viewport. */
function useQuotationFooterVisibility(enabled: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }

    const reviewEl = document.getElementById("section-review");

    const getScrollRoot = (): HTMLElement | Window => {
      const main = document.querySelector(
        ".supplier-portal-layout main.app-shell-scroll",
      );
      return main instanceof HTMLElement ? main : window;
    };

    const evaluate = () => {
      const scrollRoot = getScrollRoot();
      const viewportHeight =
        scrollRoot instanceof Window
          ? window.innerHeight
          : scrollRoot.clientHeight;

      const scrollTop =
        scrollRoot instanceof Window ? window.scrollY : scrollRoot.scrollTop;
      const scrollHeight =
        scrollRoot instanceof Window
          ? document.documentElement.scrollHeight
          : scrollRoot.scrollHeight;

      const scrollable = scrollHeight - viewportHeight;
      const scrollPct = scrollable > 0 ? scrollTop / scrollable : 0;

      let nearReview = false;
      if (reviewEl) {
        const top = reviewEl.getBoundingClientRect().top;
        nearReview = top <= viewportHeight * 0.85;
      }

      setVisible(scrollPct >= 0.75 || nearReview);
    };

    evaluate();

    const scrollRoot = getScrollRoot();
    scrollRoot.addEventListener("scroll", evaluate, { passive: true });
    window.addEventListener("resize", evaluate, { passive: true });

    const observer =
      reviewEl &&
      new ResizeObserver(() => {
        evaluate();
      });
    if (observer && reviewEl) observer.observe(reviewEl);

    return () => {
      scrollRoot.removeEventListener("scroll", evaluate);
      window.removeEventListener("resize", evaluate);
      observer?.disconnect();
    };
  }, [enabled]);

  return visible;
}

function rfqItemHasWarehouseShortage(item?: RFQItem | null): boolean {
  if (!item) return false;
  const whAvail =
    item.custom_warehouse_available_qty != null &&
    Number.isFinite(Number(item.custom_warehouse_available_qty))
      ? Math.max(0, Number(item.custom_warehouse_available_qty))
      : null;
  const requested =
    item.custom_department_requested_qty != null &&
    Number.isFinite(Number(item.custom_department_requested_qty))
      ? Number(item.custom_department_requested_qty)
      : item.qty;
  const requestedDisplay = Number(requested) || 0;
  return (
    whAvail != null &&
    requestedDisplay > 0 &&
    whAvail + 1e-9 < requestedDisplay
  );
}

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
  /** Present only when RFQ allows Target Price visibility to suppliers. */
  target_price?: number | null;
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
    queryKey: ["supplier-portal-rfq", rfqName, supplierName],
    enabled: !!rfqName && !!session && !!supplierName,
    retry: 1,
    queryFn: async () => {
      // eslint-disable-next-line no-console
      console.info("[SupplierRFQPage] Loading RFQ detail", {
        path: `/supplier/rfq/${rfqName}`,
        rfqName,
        supplierName,
      });
      const doc = await getSupplierRfqDetail(rfqName, supplierName);
      // eslint-disable-next-line no-console
      console.info("[SupplierRFQPage] RFQ detail loaded", {
        name: doc.name,
        docstatus: doc.docstatus,
        status: doc.status,
        items: doc.items?.length ?? 0,
        suppliers: doc.suppliers?.length ?? 0,
      });
      return doc;
    },
  });

  const rfq = rfqQuery.data;
  const rfqLoading =
    !session ||
    rfqQuery.isPending ||
    rfqQuery.isLoading ||
    (rfqQuery.isFetching && !rfq);
  const parsedMessage = useMemo(
    () => parseRfqMessage(rfq?.message_for_supplier),
    [rfq?.message_for_supplier]
  );

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
    if (!rfq || !supplierName) return;

    const items = rfq.items ?? [];
    let cancelled = false;

    const quoteLineFromItem = (
      it: RFQItem,
      eng?: EngineeringDocs,
    ): QuoteLine => {
      const raw = eng ?? pickEngineeringDocs(it);
      const visible = filterSupplierVisibleAttachments(raw.attachments ?? []);
      return {
        item_code: it.item_code,
        item_name: it.item_name ?? it.item_code,
        description: it.description ?? "",
        qty: it.qty,
        uom: it.uom ?? "Nos",
        unit_price: 0,
        delivery_days: 7,
        notes: "",
        target_price: isItemTargetPriceVisibleToSupplier(it, rfq)
          ? getItemTargetPrice(it)
          : null,
        ...raw,
        attachments: visible,
        drawing_2d_url: visible[0]?.fileUrl || raw.drawing_2d_url,
      };
    };

    // Populate lines immediately so Quote Summary / Cost Breakdown / item
    // cards never stay empty while engineering-doc resolution runs.
    const draftKey = `draft_quotation_${rfq.name}_${supplierName}`;
    const rawDraft = sessionStorage.getItem(draftKey);
    let usedDraftItems = false;
    if (rawDraft) {
      try {
        const draft = JSON.parse(rawDraft) as {
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
          const targetByItem = new Map(
            items.map((it) => {
              const show = isItemTargetPriceVisibleToSupplier(it, rfq);
              return [
                it.item_code,
                show ? getItemTargetPrice(it) : null,
              ] as const;
            }),
          );
          setLines(
            draft.items.map((line) => ({
              ...line,
              target_price: targetByItem.get(line.item_code) ?? null,
            })),
          );
          usedDraftItems = true;
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
        }
      } catch {
        /* fall through to RFQ defaults */
      }
    }

    if (!usedDraftItems) {
      setLines(items.map((it) => quoteLineFromItem(it)));
    }

    // eslint-disable-next-line no-console
    console.info("[SupplierRFQPage] Line items seeded", {
      rfqId: rfq.name,
      itemCount: items.length,
      usedDraftItems,
    });

    if (items.length === 0) {
      setEngByCode(new Map());
      return;
    }

    void (async () => {
      try {
        const engMap = await resolveItemEngineeringDocsBatch(
          items.map((it) => ({
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

        const engFor = (it: RFQItem): EngineeringDocs => {
          const raw =
            engMap.get(`${rfq.name}::${it.item_code}`) ||
            engMap.get(String(it.material_request_item || "").trim()) ||
            engMap.get(it.item_code) ||
            pickEngineeringDocs(it);
          const visible = filterSupplierVisibleAttachments(raw.attachments);
          return {
            ...raw,
            attachments: visible,
            drawing_2d_url: visible[0]?.fileUrl || raw.drawing_2d_url,
          };
        };

        const byCode = new Map<string, EngineeringDocs>();
        for (const it of items) {
          byCode.set(it.item_code, engFor(it));
        }
        setEngByCode(byCode);

        setLines((prev) => {
          if (prev.length === 0) {
            return items.map((it) => quoteLineFromItem(it, engFor(it)));
          }
          return prev.map((line) => {
            const eng = byCode.get(line.item_code);
            if (!eng) return line;
            return {
              ...line,
              ...eng,
              /* Keep prices/notes the supplier already entered. */
              unit_price: line.unit_price,
              delivery_days: line.delivery_days,
              notes: line.notes,
              target_price: line.target_price,
            };
          });
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[SupplierRFQPage] Engineering docs enrichment failed — keeping line items",
          err,
        );
      }
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
        rfq_round: rfq.custom_active_rfq_round,
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

  const quotationFormActive =
    !!session &&
    !submittedQuote &&
    !rfqLoading &&
    !checkingStatus &&
    !declined &&
    !alreadySubmitted &&
    !!rfq &&
    !rfqQuery.isError;

  const footerVisible = useQuotationFooterVisibility(quotationFormActive);

  if (!session) {
    return (
      <>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      </>
    );
  }

  /* ── Success screen ──────────────────────────────────────────────── */
  if (submittedQuote) {
    const isSubmitted = submittedQuote.status === "Submitted";
    return (
      <>
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
      </>
    );
  }

  if (rfqLoading) {
    return <AppLoading variant="document" />;
  }

  if (rfqQuery.isError || !rfq) {
    const err = rfqQuery.error;
    // eslint-disable-next-line no-console
    console.error("[SupplierRFQPage] RFQ detail failed", {
      path: `/supplier/rfq/${rfqName}`,
      rfqName,
      supplierName,
      error: err,
    });

    const accessErr =
      err instanceof SupplierRfqAccessError
        ? err
        : null;
    const title = accessErr
      ? supplierRfqFailureTitle(accessErr.code)
      : err instanceof Error && /not found/i.test(err.message)
        ? "RFQ not found"
        : err instanceof Error && /permission|forbidden/i.test(err.message)
          ? "Permission denied"
          : err instanceof Error && /server|500|502|503/i.test(err.message)
            ? "Backend server error"
            : "Unable to load RFQ";
    const description =
      accessErr?.message ||
      (err instanceof Error ? err.message : null) ||
      "The RFQ could not be loaded. Check the browser console for API details.";

    return (
      <>
        <BackToDashboard />
        <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <ShieldAlert className="mx-auto h-6 w-6 text-rose-600" />
          <h2 className="mt-2 text-base font-semibold text-rose-900">{title}</h2>
          <p className="mt-1 text-sm text-rose-800">{description}</p>
          {accessErr?.httpStatus != null ? (
            <p className="mt-2 text-xs font-mono text-rose-700">
              HTTP {accessErr.httpStatus}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => window.history.back()}
              className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void rfqQuery.refetch()}
              className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
            >
              Retry
            </button>
          </div>
        </div>
      </>
    );
  }

  /* ── Checking status spinner ──────────────────────────────────────── */
  if (checkingStatus) {
    return (
      <>
        <div className="flex min-h-[40vh] items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
          <span className="text-sm text-neutral-500">Checking quotation status…</span>
        </div>
      </>
    );
  }

  /* ── Read-only view: Supplier declined (No Quote) ─────────────────── */
  if (declined) {
    return (
      <>
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
      </>
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
      <>
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

        <div className="mt-6">
          <SupplierRfqDocumentsSection
            rfqName={rfq.name}
            erpSupplierId={supplierName}
          />
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
                const rfqItem = (rfq.items ?? []).find(
                  (i) => i.item_code === line.item_code,
                );
                const target = isItemTargetPriceVisibleToSupplier(
                  rfqItem ?? {},
                  rfq,
                )
                  ? getItemTargetPrice(rfqItem ?? {})
                  : null;
                return (
                <div key={line.item_code} className="space-y-2 p-4 bg-neutral-50/40">
                  <div>
                    <p className="font-medium text-neutral-900">{line.item_name}</p>
                    <p className="text-xs text-neutral-500">{line.item_code}</p>
                  </div>
                  {target != null ? <SupplierTargetPriceBadge price={target} /> : null}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-[10px] font-medium uppercase text-neutral-500">Quantity to Quote</p>
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
                  <SupplierItemAttachmentsPanel
                    rfqName={rfq.name}
                    itemCode={line.item_code}
                    erpSupplierId={supplierName}
                  />
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
                    <th className="px-4 py-2 text-right">Quantity to Quote</th>
                    <th className="px-4 py-2">UOM</th>
                    {isTargetPriceVisibleToSupplier(rfq) ? (
                      <th className="px-4 py-2 text-right">Target Price</th>
                    ) : null}
                    <th className="px-4 py-2 text-right">Unit Price</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right">Delivery (days)</th>
                    <th className="px-4 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {subData.items.map((line) => {
                    const rfqItem = (rfq.items ?? []).find(
                      (i) => i.item_code === line.item_code,
                    );
                    const target = isItemTargetPriceVisibleToSupplier(
                      rfqItem ?? {},
                      rfq,
                    )
                      ? getItemTargetPrice(rfqItem ?? {})
                      : null;
                    const eng =
                      engByCode.get(line.item_code) ||
                      pickEngineeringDocs(rfqItem);
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
                        <SupplierItemAttachmentsPanel
                          rfqName={rfq.name}
                          itemCode={line.item_code}
                          erpSupplierId={supplierName}
                          compact
                        />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{line.qty}</td>
                      <td className="px-4 py-2 text-neutral-700">{line.uom}</td>
                      {isTargetPriceVisibleToSupplier(rfq) ? (
                        <td className="px-4 py-2 text-right align-top">
                          {target != null ? (
                            <SupplierTargetPriceBadge price={target} compact />
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                      ) : null}
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
      </>
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
    <>
      <div className={`${QUOTE_PAGE_SHELL} flex flex-col gap-6 pb-[88px]`}>
        <BackToDashboard />

        {/* RFQ header */}
        <div className={`${ENT_CARD} ${ENT_CARD_PAD}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-[#1F3A6D]">
                Request for Quotation
              </p>
              <h1 className="mt-1 text-[28px] font-bold leading-tight text-[#0F172A]">
                {parsedMessage.title || rfq.name}
              </h1>
              <p className="mt-0.5 text-[15px] text-[#64748B]">{rfq.name}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-[13px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                Draft
              </span>
              {validTillDisplay && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1F5F9] px-3 py-1 text-[13px] font-semibold text-[#475569] ring-1 ring-inset ring-[#E2E8F0]">
                  <Calendar className="h-3.5 w-3.5" />
                  Due {formatDate(validTillDisplay)}
                </span>
              )}
              {draftSavedAt && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[13px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Auto Saved
                </span>
              )}
              <span className="inline-flex items-center rounded-full bg-[#EEF3FA] px-3 py-1 text-[13px] font-semibold text-[#1F3A6D] ring-1 ring-inset ring-[#D6E2F5]">
                {rfqStatusLabel}
              </span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            <HeaderMeta label="RFQ Number" value={rfq.name} />
            {rfq.custom_current_round_number ? (
              <HeaderMeta
                label="Quote Round"
                value={formatRfqRoundLabel(rfq.custom_current_round_number)}
              />
            ) : null}
            <HeaderMeta label="Buyer" value={rfq.company || "Netlink"} />
            <HeaderMeta label="Issue Date" value={formatDate(rfq.transaction_date)} />
            <HeaderMeta
              label="Valid Till"
              value={validTillDisplay ? formatDate(validTillDisplay) : "—"}
            />
          </div>
          {parsedMessage.body && (
            <div className="mt-4 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-[15px] leading-relaxed text-[#334155]">
              <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#64748B]">
                <FileText className="h-3.5 w-3.5" />
                Buyer Notes
              </p>
              <p className="whitespace-pre-line">{parsedMessage.body}</p>
            </div>
          )}
        </div>

        <WorkflowProgress
          steps={workflowSteps}
          activeStepId={activeStepId}
          onStepClick={scrollToSection}
        />

        <SupplierRfqDocumentsSection
          rfqName={rfq.name}
          erpSupplierId={supplierName}
        />

        <div className={QUOTE_MAIN_GRID}>
          <div className="min-w-0 space-y-6 lg:space-y-6">
            {/* Pricing — item cards */}
            <section
              id="section-pricing"
              className={`scroll-mt-24 ${ENT_CARD}`}
            >
              <div className={`flex items-center justify-between ${ENT_SECTION_HEAD}`}>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EEF3FA] text-[#1F3A6D]">
                    <Package className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold leading-tight text-[#0F172A]">Line Items & Pricing</h2>
                    <p className="text-[12px] font-medium text-[#64748B]">
                      Enter unit price, delivery, and notes
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[12px] font-semibold text-[#475569]">
                  {lines.length} items
                </span>
              </div>
              <div className="divide-y divide-[#E2E8F0] px-4 pb-4 pt-2">
                {lines.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-6 text-center text-[13px] font-medium text-[#64748B]">
                    {(rfq.items?.length ?? 0) > 0
                      ? "Line items are still loading. Please wait a moment…"
                      : "This RFQ has no line items yet. Contact procurement if this looks incorrect."}
                  </div>
                ) : (
                  lines.map((line, idx) => {
                    const rfqItem = (rfq.items ?? []).find(
                      (it) => it.item_code === line.item_code,
                    );
                    return (
                      <QuoteItemCard
                        key={line.item_code}
                        line={line}
                        index={idx}
                        rfqName={rfq.name}
                        erpSupplierId={supplierName}
                        rfqItem={rfqItem}
                        onPatch={patchLine}
                      />
                    );
                  })
                )}
              </div>
            </section>

            {requiresCostBreakdown && (
              <SectionErrorBoundary title="Cost Breakdown failed to load">
                <CostBreakdownPanel
                  ref={costBreakdownRef}
                  rfqName={rfq.name}
                  supplier={supplierName}
                  items={lines.map((l) => ({
                    item_code: l.item_code,
                    item_name: l.item_name,
                    qty: l.qty,
                    unit_price: l.unit_price,
                  }))}
                  readOnly={!!alreadySubmitted}
                  onReadyChange={setCostBreakdownReady}
                />
              </SectionErrorBoundary>
            )}

            {/* Additional information — collapsible */}
            <section
              id="section-additional"
              className={`scroll-mt-24 overflow-hidden ${ENT_CARD}`}
            >
              <button
                type="button"
                onClick={() => setAdditionalOpen((v) => !v)}
                className="flex w-full items-center justify-between border-none bg-transparent px-4 py-2.5 text-left transition hover:bg-[#F8FAFC]"
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
                <div className="grid gap-3 border-t border-[#E2E8F0] p-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="payment-terms" className={ENT_LABEL}>
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
                    <label htmlFor="quote-validity" className={ENT_LABEL}>
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
                    <label htmlFor="quote-notes" className={ENT_LABEL}>
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
              className={`scroll-mt-24 overflow-hidden ${ENT_CARD}`}
            >
              <button
                type="button"
                onClick={() => setLegalDocsOpen((v) => !v)}
                className="flex w-full items-center justify-between border-none bg-transparent px-4 py-2.5 text-left transition hover:bg-[#F8FAFC]"
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
              className={`scroll-mt-24 ${ENT_CARD_PAD} ${ENT_CARD}`}
            >
              <h2 className="text-[15px] font-semibold text-[#0F172A]">Review &amp; Submit</h2>
              <p className="mt-0.5 text-[13px] font-medium text-[#64748B]">
                Confirm terms before submitting your quotation
              </p>
              <label
                className={`mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-[15px] transition ${
                  !acceptedTerms
                    ? "border-red-200 bg-red-50/50 text-[#334155] ring-1 ring-inset ring-red-100"
                    : "border-[#E2E8F0] bg-[#F8FAFC] text-[#334155] hover:border-[#1F3A6D]/30 hover:bg-[#EEF3FA]/40"
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
          <aside className="hidden min-w-0 lg:sticky lg:top-[4.75rem] lg:block lg:self-start">
            <QuoteSummaryPanel
              itemCount={lines.length}
              grandTotal={grandTotal}
              avgDeliveryDays={avgDeliveryDays}
              uploadedDocsCount={uploadedDocsCount}
              completionPct={completionPct}
            />
          </aside>
        </div>

        {/* Mobile / tablet summary */}
        <div className="lg:hidden">
          <QuoteSummaryPanel
            itemCount={lines.length}
            grandTotal={grandTotal}
            avgDeliveryDays={avgDeliveryDays}
            uploadedDocsCount={uploadedDocsCount}
            completionPct={completionPct}
          />
        </div>
      </div>

      <QuotationFloatingFooter
        visible={footerVisible}
        grandTotal={grandTotal}
        itemCount={lines.length}
        avgDeliveryDays={avgDeliveryDays}
        uploadedDocsCount={uploadedDocsCount}
        draftSavedAt={draftSavedAt}
        submitting={submitting}
        canSubmit={canSubmit}
        submitDisabledTitle={submitDisabledTitle}
        onSaveDraft={handleSaveDraft}
        onNoQuote={() => setNoQuoteOpen(true)}
        onSubmit={handleSubmit}
      />

      <NoQuoteDialog
        open={noQuoteOpen}
        rfqName={rfq.name}
        submitting={declining}
        onClose={() => setNoQuoteOpen(false)}
        onSubmit={handleDecline}
      />
    </>
  );
}

/* ============================================================================
 * UI helpers — quotation form
 * ========================================================================== */

function QuotationFloatingFooter({
  visible,
  grandTotal,
  itemCount,
  avgDeliveryDays,
  uploadedDocsCount,
  draftSavedAt,
  submitting,
  canSubmit,
  submitDisabledTitle,
  onSaveDraft,
  onNoQuote,
  onSubmit,
}: {
  visible: boolean;
  grandTotal: number;
  itemCount: number;
  avgDeliveryDays: number;
  uploadedDocsCount: number;
  draftSavedAt: string | null;
  submitting: boolean;
  canSubmit: boolean;
  submitDisabledTitle?: string;
  onSaveDraft: () => void;
  onNoQuote: () => void;
  onSubmit: () => void;
}) {
  const metadataParts = [
    `${itemCount} Item${itemCount === 1 ? "" : "s"}`,
    itemCount
      ? `Avg Delivery ${avgDeliveryDays} Day${avgDeliveryDays === 1 ? "" : "s"}`
      : "Avg Delivery —",
    `Docs ${uploadedDocsCount}/3`,
    draftSavedAt ? `Auto Saved ${formatRelativeSavedAt(draftSavedAt)}` : null,
  ].filter(Boolean);

  return (
    <div
      role="region"
      aria-label="Quotation actions"
      aria-hidden={!visible}
      className={`supplier-rfq-command-bar transition-transform duration-300 ease-out ${
        visible
          ? "pointer-events-auto translate-y-0"
          : "pointer-events-none translate-y-full"
      }`}
    >
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium leading-none text-[#64748B]">
            Quote Total
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums leading-none tracking-tight text-[#1F3A6D]">
            {formatCurrency(grandTotal)}
          </p>
          <p className="mt-1 truncate text-[11px] leading-snug text-[#64748B]">
            {metadataParts.join(" • ")}
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center gap-3 sm:w-auto sm:justify-end">
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={submitting}
            className={`${CMD_BAR_BTN_OUTLINE} w-full sm:w-auto`}
          >
            Save Draft
          </button>
          <button
            type="button"
            onClick={onNoQuote}
            disabled={submitting}
            className={`${CMD_BAR_BTN_DANGER} w-full sm:w-auto`}
          >
            No Quote
          </button>
          <span
            className="inline-flex w-full min-w-0 sm:w-auto"
            title={submitDisabledTitle}
          >
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
              className={`${CMD_BAR_BTN_PRIMARY} w-full sm:min-w-[10.5rem]`}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  Submitting…
                </>
              ) : (
                "Submit Quotation"
              )}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function HeaderMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
      <p className="text-[12px] font-medium text-[#64748B]">{label}</p>
      <p className="mt-1 truncate text-[14px] font-semibold text-[#0F172A]">{value}</p>
    </div>
  );
}

/** Professional Target Price block for supplier portal (only when buyer enabled). */
function SupplierTargetPriceBadge({
  price,
  compact = false,
}: {
  price: number;
  compact?: boolean;
}) {
  if (!Number.isFinite(price) || price < 0) return null;
  if (compact) {
    return (
      <div className="inline-flex flex-col items-end leading-tight">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          Target Price
        </span>
        <span className="text-sm font-semibold tabular-nums text-neutral-900">
          {formatCurrency(price)}{" "}
          <span className="text-xs font-medium text-neutral-500">/ Unit</span>
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[#1F3A6D]/15 bg-[#EEF3FA]/60 px-3 py-2">
      <p className="text-[13px] font-medium text-[#64748B]">Target Price</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#0F172A]">
        {formatCurrency(price)}{" "}
        <span className="text-[13px] font-medium text-[#64748B]">/ Unit</span>
      </p>
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
    <div className={`${ENT_CARD} px-4 py-2`}>
      <div className="flex h-12 max-h-[52px] min-h-[48px] items-center gap-1 overflow-x-auto sm:flex-wrap sm:overflow-visible">
        {steps.map((step, idx) => {
          const isActive = step.id === activeStepId && !step.complete;
          const isCurrent = step.id === activeStepId;
          return (
            <div key={step.id} className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => onStepClick(step.id)}
                className={`inline-flex h-9 max-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold leading-none transition ${
                  step.complete
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                    : isActive
                      ? "bg-[#EEF3FA] text-[#1F3A6D] ring-2 ring-inset ring-[#1F3A6D]/30"
                      : isCurrent
                        ? "bg-[#EEF3FA]/80 text-[#1F3A6D] ring-1 ring-inset ring-[#D6E2F5]"
                        : "bg-[#F8FAFC] text-[#64748B] ring-1 ring-inset ring-[#E2E8F0] hover:bg-[#EEF3FA] hover:text-[#1F3A6D]"
                }`}
              >
                {step.complete ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                      isActive
                        ? "bg-[#1F3A6D] text-white"
                        : "bg-[#E2E8F0] text-[#64748B]"
                    }`}
                  >
                    {idx + 1}
                  </span>
                )}
                <span className="whitespace-nowrap">{step.label}</span>
              </button>
              {idx < steps.length - 1 && (
                <ChevronRight className="hidden h-3 w-3 shrink-0 text-[#CBD5E1] sm:block" />
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
      <label className={ENT_LABEL}>Delivery Days</label>
      <Select value={selectValue} onValueChange={handleSelect}>
        <SelectTrigger className={`${ENT_INPUT} tabular-nums`}>
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
        <div className="mt-2">
          <label className={ENT_LABEL}>Custom Days</label>
          <input
            type="number"
            min={0}
            value={value || ""}
            onChange={(e) => onChange(Number(e.target.value))}
            placeholder="Enter days"
            className={`${ENT_INPUT} tabular-nums`}
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
  rfqName,
  erpSupplierId,
  rfqItem,
  onPatch,
}: {
  line: QuoteLine;
  index: number;
  rfqName: string;
  erpSupplierId: string;
  rfqItem?: RFQItem;
  onPatch: (idx: number, patch: Partial<QuoteLine>) => void;
}) {
  const lineTotal = line.unit_price * line.qty;
  const priced = line.unit_price > 0;
  const hasShortage = rfqItemHasWarehouseShortage(rfqItem);

  return (
    <div className="py-3 first:pt-1 last:pb-1">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold leading-snug text-[#0F172A]">
            {line.item_name}
          </h3>
          <p className="mt-0.5 text-[13px] font-medium text-[#64748B]">{line.item_code}</p>
          {line.description ? (
            <p className="mt-1 text-[13px] leading-snug text-[#64748B]">{line.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasShortage ? (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
              Warehouse Shortage
            </span>
          ) : null}
          <span className="inline-flex items-center rounded-full bg-[#EEF3FA] px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-[#1F3A6D] ring-1 ring-inset ring-[#D6E2F5]">
            Qty {line.qty} {line.uom}
          </span>
        </div>
      </div>

      {line.target_price != null && Number.isFinite(line.target_price) ? (
        <div className="mt-2">
          <SupplierTargetPriceBadge price={line.target_price} />
        </div>
      ) : null}

      {/* Pricing row */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={ENT_LABEL}>Unit Price</label>
          <input
            type="number"
            min={0}
            step="any"
            value={line.unit_price || ""}
            onChange={(e) => onPatch(index, { unit_price: Number(e.target.value) })}
            placeholder="0.00"
            className={`${ENT_INPUT} tabular-nums ${!priced ? "border-amber-200 bg-amber-50/40" : ""}`}
          />
        </div>
        <DeliveryDaysField
          value={line.delivery_days}
          onChange={(days) => onPatch(index, { delivery_days: days })}
        />
        <div>
          <label className={ENT_LABEL}>Line Total</label>
          <div className="flex h-11 items-center rounded-2xl bg-[#EEF3FA] px-3 ring-1 ring-inset ring-[#D6E2F5]">
            <span className="text-[15px] font-bold tabular-nums text-[#1F3A6D]">
              {formatCurrency(lineTotal)}
            </span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="mt-3">
        <label className={ENT_LABEL}>Notes</label>
        <textarea
          value={line.notes}
          onChange={(e) => onPatch(index, { notes: e.target.value })}
          placeholder="Optional line notes"
          rows={3}
          className={`${ENT_INPUT} min-h-[70px] resize-y py-2.5`}
        />
      </div>

      <SupplierItemAttachmentsPanel
        rfqName={rfqName}
        itemCode={line.item_code}
        erpSupplierId={erpSupplierId}
      />
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
  const readyToSubmit = completionPct >= 100;

  return (
    <div className={`${ENT_CARD} ${ENT_CARD_PAD}`}>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
        Quote Summary
      </h3>

      <div className="mt-3 rounded-xl border border-[#D6E2F5] bg-[#EEF3FA] px-3 py-2.5">
        <p className="text-[12px] font-medium text-[#64748B]">Grand Total</p>
        <p className="mt-0.5 text-[28px] font-bold tabular-nums leading-none text-[#1F3A6D]">
          {formatCurrency(grandTotal)}
        </p>
      </div>

      <div className="mt-3 divide-y divide-[#E2E8F0]">
        <SummaryRow label="Number of Items" value={String(itemCount)} />
        <SummaryRow
          label="Average Delivery"
          value={itemCount ? `${avgDeliveryDays} days` : "—"}
        />
        <SummaryRow
          label="Uploaded Documents"
          value={`${uploadedDocsCount} / 3`}
        />
        <SummaryRow label="Currency" value="INR" />
        <SummaryRow label="Estimated Rank" value="—" muted />
        <SummaryRow label="Budget Difference" value="—" muted />
      </div>

      <div className="mt-3 border-t border-[#E2E8F0] pt-3">
        <p className="text-[12px] font-medium text-[#64748B]">Completion Status</p>
        {readyToSubmit ? (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[13px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ready to Submit
          </p>
        ) : (
          <>
            <div className="mt-1.5 flex items-center justify-between text-[12px] font-medium text-[#64748B]">
              <span>In progress</span>
              <span className="font-semibold text-[#1F3A6D]">{completionPct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#E2E8F0]">
              <div
                className="h-full rounded-full bg-[#1F3A6D] transition-all duration-300"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  highlight,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <dt className="text-[13px] font-medium text-[#64748B]">{label}</dt>
      <dd
        className={`text-[14px] tabular-nums ${
          highlight
            ? "font-bold text-[#1F3A6D]"
            : muted
              ? "font-medium text-[#94A3B8]"
              : "font-semibold text-[#0F172A]"
        }`}
      >
        {value}
      </dd>
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
