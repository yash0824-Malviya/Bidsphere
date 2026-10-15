import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import {
  Expand,
  Loader2,
  MousePointer2,
  PenLine,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import pdfjsWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import LegalESignModal from "./LegalESignModal";
import ConfirmDialog from "../ui/ConfirmDialog";
import {
  buildLegalSignature,
  fetchPdfBytes,
  newAuditId,
  persistEsignEnvelope,
  resolveEsignBundle,
  sha256Hex,
} from "../../api/legalEsign";
import { getLegalReviewAttachmentUrl } from "../../api/legalAttachment";
import { beginLegalSignature, recordLegalDocumentViewed, verifyLegalDocumentIntegrity, type LegalDocumentSet } from "../../api/legalDocs";
import {
  DEFAULT_SIGNATURE_BOX,
  createEmptyEnvelope,
  getDocEnvelope,
  hasLegalSignature,
  getRequiredLegalDocumentKeys,
  isLegalDocumentVerified,
  type LegalDocumentIntegrityStatus,
  type LegalDocKey,
  type LegalEsignBundle,
  type LegalEsignEnvelope,
  type LegalEsignPlacement,
  type LegalEsignSignature,
} from "../../types/legalEsign";
import {
  getSignatureFont,
  type LegalSignatureFontId,
} from "../../types/legalSignatureFonts";
import { formatDate } from "../../utils/format";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc;

type Tool = "pointer" | "esign-place";

interface Props {
  review: LegalDocumentSet;
  documentKey: LegalDocKey;
  fileUrl: string;
  canSign: boolean;
  canReview?: boolean;
  readOnly?: boolean;
  esignDisabledReason?: string;
  requiredDocuments?: Array<{ key: LegalDocKey; label: string; verified: boolean }>;
  eligibilityRefreshing?: boolean;
  onRefreshEligibility?: () => void;
  reviewerFullName: string;
  reviewerId: string;
  esignBundle: LegalEsignBundle | null;
  onBundleChange: (
    bundle: LegalEsignBundle,
    review: LegalDocumentSet,
  ) => void;
}

function bytesForPdfJs(source: ArrayBuffer): Uint8Array {
  return new Uint8Array(source.slice(0));
}

export default function LegalPdfViewer({
  review,
  documentKey,
  fileUrl,
  canSign,
  canReview = false,
  readOnly,
  esignDisabledReason,
  requiredDocuments: suppliedRequiredDocuments,
  eligibilityRefreshing = false,
  onRefreshEligibility,
  reviewerFullName,
  reviewerId,
  esignBundle,
  onBundleChange,
}: Props) {
  const requiredDocuments = suppliedRequiredDocuments ?? getRequiredLegalDocumentKeys(review).map(key => ({
    key,
    label: key === "terms" ? "Master Terms & Conditions" : key === "warranty" ? "Quality & Compliance Warranty" : "Liability Insurance Certificate",
    verified: isLegalDocumentVerified(review, key),
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [tool, setTool] = useState<Tool>("pointer");
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingTyped, setPendingTyped] = useState<string | null>(null);
  const [pendingFontId, setPendingFontId] =
    useState<LegalSignatureFontId | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadedEnvelope, setEnvelope] = useState<LegalEsignEnvelope | null>(null);
  const [loadedIntegrity, setIntegrity] = useState<LegalDocumentIntegrityStatus | "Checking">("Checking");
  const [actualDocumentHash, setActualDocumentHash] = useState<string>();
  const [integrityMessage, setIntegrityMessage] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [hoverSig, setHoverSig] = useState(false);
  const [ghost, setGhost] = useState<{
    page: number;
    xPct: number;
    yPct: number;
  } | null>(null);

  const sourceBytesRef = useRef<ArrayBuffer | null>(null);
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const pageWrapRefs = useRef<Array<HTMLDivElement | null>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const paintGenRef = useRef(0);
  const renderedReceiptRef = useRef<string | null>(null);
  const [rendered, setRendered] = useState(false);

  const safeFileUrl = String(fileUrl || "").trim();
  const proxyUrl = useMemo(
    () => getLegalReviewAttachmentUrl(review.name, documentKey, safeFileUrl),
    [safeFileUrl, review.name, documentKey],
  );
  const documentName =
    safeFileUrl.split("/").pop()?.split("?")[0] || `${documentKey}.pdf`;
  const documentNumber = review.name || review.sq_name || "—";
  const envelope = getDocEnvelope(esignBundle, documentKey) ?? loadedEnvelope;
  const sourceHashChanged = Boolean(actualDocumentHash && envelope &&
    (envelope.documentHash !== actualDocumentHash || (envelope.approvedHash && envelope.approvedHash !== actualDocumentHash)));
  const integrity = sourceHashChanged ? "Failed" : loadedIntegrity;
  const signed = hasLegalSignature(envelope);
  const locked = Boolean(
    envelope?.locked || review.review_status === "Rejected",
  );
  const signatureDisabledReason = readOnly
    ? "You do not have permission to sign this document."
    : signed ? "Document has already been signed."
    : locked ? "This document is locked and cannot be signed."
    : saving ? "Saving signature…"
    : eligibilityRefreshing ? "Refreshing signing eligibility from ERPNext…"
    : !canSign ? esignDisabledReason || "Verify all required supplier documents before signing."
    : loading ? "Loading the current PDF before signing…"
    : error ? "The current PDF could not be rendered. Reopen the viewer before signing."
    : !rendered ? "Rendering every PDF page before signing…"
    : integrity !== "Verified" ? "Document integrity must be verified before signing."
    : undefined;
  const signEnabled = !signatureDisabledReason;
  const activeSig: LegalEsignSignature | null =
    (envelope?.signatures ?? []).find(
      (s) =>
        s.role === "legal" && (s.status === "signed" || s.status === "locked"),
    ) ?? null;
  const receiptOptionsRef = useRef({ canReview, integrity, signed, reviewName: review.name, documentKey, onBundleChange });
  useEffect(() => {
    receiptOptionsRef.current = { canReview, integrity, signed, reviewName: review.name, documentKey, onBundleChange };
  }, [canReview, integrity, signed, review.name, documentKey, onBundleChange]);

  const releasePdfDoc = useCallback(async () => {
    const doc = pdfDocRef.current;
    pdfDocRef.current = null;
    if (doc) {
      try {
        await doc.destroy();
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Load original PDF only — signatures render as an overlay layer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await releasePdfDoc();
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setPageCount(0);
      setEnvelope(null);
      setActualDocumentHash(undefined);
      setIntegrity("Checking");
      setIntegrityMessage(undefined);
      setRendered(false);
      renderedReceiptRef.current = null;
      sourceBytesRef.current = null;
      canvasRefs.current = [];
      pageWrapRefs.current = [];
      try {
        if (!safeFileUrl || !proxyUrl) {
          throw new Error("No PDF URL available for this document.");
        }

        // Diagnostic trail for Legal Review PDF loads (browser console).
        console.info("[LegalPdfViewer] attachment", {
          documentName: review.name,
          doctype: "Legal Document Review",
          documentKey,
          fileName: documentName,
          isPrivate: safeFileUrl.includes("/private/files/"),
        });

        const originalBytes = await fetchPdfBytes(proxyUrl);
        if (cancelled) return;
        sourceBytesRef.current = originalBytes.slice(0);
        const hash = await sha256Hex(sourceBytesRef.current);
        setActualDocumentHash(hash);

        const bundle = resolveEsignBundle(
          review.name,
          review.esign_envelope,
        );
        const fromProp = getDocEnvelope(esignBundle, documentKey);
        const fromResolved = getDocEnvelope(bundle, documentKey);
        const env =
          fromProp ??
          fromResolved ??
          createEmptyEnvelope({
            documentKey,
            documentName,
            documentNumber,
            documentHash: hash,
            documentVersion: "V1",
          });

        if (env.documentHash !== hash || (env.approvedHash && env.approvedHash !== hash)) {
          // Retain the signed evidence and expose tampering; never silently turn
          // a signed replacement into an apparently fresh unsigned document.
          setIntegrity("Failed");
          setIntegrityMessage("The current PDF differs from the stored SHA-256. Signing and downstream approval are blocked.");
        } else if (hasLegalSignature(env) && review.name) {
          try {
            const verification = await verifyLegalDocumentIntegrity(review.name);
            if (cancelled) return;
            const result = verification.documents.find(item => item.documentKey === documentKey);
            setIntegrity(result?.status || "Unavailable");
            setIntegrityMessage(result?.message);
          } catch (integrityError) {
            if (cancelled) return;
            setIntegrity("Unavailable");
            setIntegrityMessage(integrityError instanceof Error ? integrityError.message : "Document integrity could not be verified.");
          }
        } else {
          setIntegrity("Verified");
        }

        let doc;
        try {
          doc = await pdfjs.getDocument({
            data: bytesForPdfJs(sourceBytesRef.current),
          }).promise;
        } catch (pdfErr) {
          throw Object.assign(
            new Error("Document loaded, but the PDF viewer could not display it."),
            { status: 200, cause: pdfErr },
          );
        }
        if (cancelled) {
          void doc.destroy();
          return;
        }

        pdfDocRef.current = doc;
        setEnvelope(env);
        setPageCount(doc.numPages);
        setLoading(false);

      } catch (err) {
        const status = Number((err as { status?: number })?.status) || undefined;
        console.error("[LEGAL PDF ACCESS ERROR]", {
          fileName: documentName,
          parentDoctype: "Legal Document Review",
          parentName: review.name,
          status,
          response:
            status === 403
              ? "Your account does not have permission to view this document."
              : status === 404
                ? "Document file could not be found."
                : err instanceof Error
                  ? err.message
                  : "Unable to load document.",
        });
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load document.",
          );
          setPageCount(0);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      void releasePdfDoc();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxyUrl, documentKey, review.name]);

  useEffect(() => {
    if (loading || error || pageCount === 0) return;
    const gen = ++paintGenRef.current;
    let cancelled = false;

    const paint = async (attempt = 0): Promise<void> => {
      if (cancelled || gen !== paintGenRef.current) return;
      const ready =
        canvasRefs.current.length >= pageCount &&
        canvasRefs.current
          .slice(0, pageCount)
          .every((c) => c instanceof HTMLCanvasElement);
      if (!ready) {
        if (attempt < 20) {
          requestAnimationFrame(() => void paint(attempt + 1));
        }
        return;
      }

      try {
        let activeDoc = pdfDocRef.current;
        if (!activeDoc && sourceBytesRef.current) {
          activeDoc = await pdfjs.getDocument({
            data: bytesForPdfJs(sourceBytesRef.current),
          }).promise;
          if (cancelled || gen !== paintGenRef.current) {
            void activeDoc.destroy();
            return;
          }
          pdfDocRef.current = activeDoc;
        }
        if (!activeDoc) return;

        for (let i = 1; i <= pageCount; i++) {
          if (cancelled || gen !== paintGenRef.current) return;
          const page = await activeDoc.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = canvasRefs.current[i - 1];
          if (!canvas) throw new Error("PDF page canvas is unavailable.");
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) throw new Error("PDF page canvas cannot render.");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
        if (cancelled || gen !== paintGenRef.current) return;
        setRendered(true);
        const receipt = receiptOptionsRef.current;
        if (receipt.canReview && receipt.integrity === "Verified" && !receipt.signed && receipt.reviewName && sourceBytesRef.current && !renderedReceiptRef.current) {
          const hash = await sha256Hex(sourceBytesRef.current);
          renderedReceiptRef.current = hash;
          try {
            const updated = await recordLegalDocumentViewed(receipt.reviewName, receipt.documentKey, hash);
            if (cancelled || gen !== paintGenRef.current) return;
            const bundle = resolveEsignBundle(receipt.reviewName, updated.esign_envelope);
            setEnvelope(getDocEnvelope(bundle, receipt.documentKey));
            receipt.onBundleChange(bundle, updated);
          } catch (receiptError) {
            renderedReceiptRef.current = null;
            toast.error(receiptError instanceof Error ? receiptError.message : "PDF rendered, but the review receipt was not saved.");
          }
        }
      } catch (err) {
        console.error("[LegalPdfViewer] paint failed:", err);
        if (!cancelled && gen === paintGenRef.current) {
          setError(
            err instanceof Error
              ? `Failed to render PDF pages: ${err.message}`
              : "Failed to render PDF pages.",
          );
        }
      }
    };

    void paint();
    return () => {
      cancelled = true;
    };
  }, [loading, error, pageCount, scale]);

  const handleFit = useCallback(() => {
    const el = scrollRef.current;
    const doc = pdfDocRef.current;
    if (!el || !doc) return;
    void (async () => {
      try {
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const available = el.clientWidth - 48;
        setScale(Math.max(0.5, Math.min(2.5, available / base.width)));
      } catch (err) {
        console.error("[LegalPdfViewer] fit-width failed:", err);
      }
    })();
  }, []);

  const handleEsignClick = async () => {
    if (!signEnabled) {
      toast.error(signatureDisabledReason || "Signing prerequisites are incomplete.");
      return;
    }
    if (!review.name) return;
    setSaving(true);
    try {
      const updated = await beginLegalSignature(review.name, documentKey);
      const bundle = resolveEsignBundle(review.name, updated.esign_envelope);
      setEnvelope(getDocEnvelope(bundle, documentKey));
      onBundleChange(bundle, updated);
      setModalOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to start signature.");
    } finally { setSaving(false); }
  };

  const saveEnvelope = async (next: LegalEsignEnvelope) => {
    if (!review.name) throw new Error("Missing Legal Document Review name");
    setSaving(true);
    try {
      const updated = await persistEsignEnvelope(review.name, next);
      const bundle = resolveEsignBundle(review.name, updated.esign_envelope);
      setEnvelope(getDocEnvelope(bundle, documentKey));
      onBundleChange(bundle, updated);
      setIntegrity("Checking");
      try {
        const verification = await verifyLegalDocumentIntegrity(review.name);
        const result = verification.documents.find(item => item.documentKey === documentKey);
        setIntegrity(result?.status || "Unavailable");
        setIntegrityMessage(result?.message);
      } catch (integrityError) {
        setIntegrity("Unavailable");
        setIntegrityMessage(integrityError instanceof Error ? integrityError.message : "Saved signature integrity could not be verified.");
      }
    } finally { setSaving(false); }
  };

  const placeSignature = async (
    page: number,
    xNorm: number,
    yNorm: number,
  ) => {
    if (!pendingTyped || !pendingFontId || !envelope || !review.name) return;
    if (!signEnabled) return;

    const placement: LegalEsignPlacement = {
      page,
      xNorm,
      yNorm,
      widthNorm: DEFAULT_SIGNATURE_BOX.widthNorm,
      heightNorm: DEFAULT_SIGNATURE_BOX.heightNorm,
    };
    const signedAt = new Date();
    const replacing = envelope.signatures.length > 0;
    const sig = buildLegalSignature({
      typedName: pendingTyped,
      reviewerName: reviewerFullName || reviewerId,
      reviewerId,
      placement,
      fontId: pendingFontId,
      signedAt,
    });

    const next: LegalEsignEnvelope = {
      ...envelope,
      signatures: [sig],
      status: "signed",
      locked: false,
      auditTrail: [
        ...envelope.auditTrail,
        {
          id: newAuditId(),
          action: replacing ? "signature_replaced" : "signature_created",
          user: reviewerFullName || reviewerId,
          userId: reviewerId,
          at: signedAt.toISOString(),
          detail: `Typed signature on page ${page} (${pendingFontId})`,
        },
      ],
    };

    const previous = envelope;
    try {
      // Show success only after the server verifies the persisted artifact.
      setPendingTyped(null);
      setPendingFontId(null);
      setTool("pointer");
      setGhost(null);
      await saveEnvelope(next);
      toast.success("Signature saved.");
    } catch (err) {
      setEnvelope(previous);
      console.error("[LegalPdfViewer] signature save failed:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Unable to save signature. Please try again.",
      );
    }
  };

  const confirmDeleteSignature = async () => {
    if (!envelope || !activeSig || locked || readOnly) return;
    const next: LegalEsignEnvelope = {
      ...envelope,
      signatures: [],
      status: "unsigned",
      signedFileUrl: undefined,
      signedFileHash: undefined,
      auditTrail: [
        ...envelope.auditTrail,
        {
          id: newAuditId(),
          action: "signature_deleted",
          user: reviewerFullName || reviewerId,
          userId: reviewerId,
          at: new Date().toISOString(),
          detail: "Signature removed by reviewer",
        },
      ],
    };
    try {
      await saveEnvelope(next);
      setDeleteOpen(false);
      setHoverSig(false);
      setModalOpen(true);
      toast.success("Signature removed. Place a new signature.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not delete signature.",
      );
    }
  };

  const onPagePointerMove = (
    pageNum: number,
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (tool !== "esign-place" || !pendingTyped) {
      setGhost(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setGhost({
      page: pageNum,
      xPct: ((e.clientX - rect.left) / rect.width) * 100,
      yPct: ((e.clientY - rect.top) / rect.height) * 100,
    });
  };

  const onPageClick = (
    pageNum: number,
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (tool !== "esign-place" || !pendingTyped) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const xNorm = (e.clientX - rect.left) / rect.width;
    const yNorm = (e.clientY - rect.top) / rect.height;
    void placeSignature(pageNum, xNorm, yNorm);
  };

  const fontCss = activeSig
    ? getSignatureFont(activeSig.fontId).family
    : getSignatureFont(pendingFontId).family;

  return (
    <div className="mt-4 flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {documentName}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{documentNumber}</span>
            <span aria-hidden>·</span>
            <span>Version {envelope?.documentVersion ?? "V1"}</span>
            {signed ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                Signed ✓
              </span>
            ) : (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  canSign
                    ? "border-blue-200 bg-blue-50 text-blue-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {signEnabled ? "Ready for E-Signature" : requiredDocuments.some(document => !document.verified) ? "Verification Pending" : "Signing Not Ready"}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Uploaded by {review.procurement_manager || "Procurement"}
            {review.submission_date
              ? ` · ${formatDate(review.submission_date)}`
              : ""}
          </p>
          {!loading && envelope ? (
            <div className="mt-2 space-y-1 text-xs">
              <p className="break-all text-slate-600">SHA-256: <span className="font-mono">{envelope.documentHash}</span></p>
              <p role={integrity === "Failed" ? "alert" : "status"} className={integrity === "Failed" ? "font-semibold text-rose-700" : integrity === "Verified" ? "font-semibold text-emerald-700" : "text-amber-700"}>
                Document Integrity: {integrity}{integrity === "Verified" ? " ✓" : ""}
              </p>
              {sourceHashChanged ? <p className="text-rose-700">The current PDF differs from the latest stored SHA-256. Reopen the current document; signing is blocked.</p> : integrityMessage ? <p className="text-slate-600">{integrityMessage}</p> : null}
              {activeSig ? <p className="text-slate-600">Signed By: {activeSig.reviewerName || activeSig.reviewerId} · Signed On: {activeSig.signedAt}</p> : null}
              <p className="text-slate-500">Typed PDF electronic signature. SHA-256 verifies integrity; it is not a certificate-based digital signature.</p>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={!signEnabled}
          title={signatureDisabledReason || "Sign the verified supplier document."}
          onClick={() => void handleEsignClick()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-700 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <PenLine className="h-4 w-4" />
          {signed ? "Signed ✓" : "Sign Document"}
        </button>
      </div>

      <div className="space-y-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-slate-800">Required documents: {requiredDocuments.filter(document => document.verified).length}/{requiredDocuments.length} verified</p>
          {onRefreshEligibility ? <button type="button" disabled={eligibilityRefreshing} onClick={onRefreshEligibility}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:opacity-50">
            {eligibilityRefreshing ? "Refreshing…" : "Refresh status"}
          </button> : null}
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="Required supplier document verification">
          {requiredDocuments.map(document => <li key={document.key} className={`rounded-md border px-2 py-1 ${document.verified ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 font-semibold text-amber-900"}`}>
            {document.label}: {document.verified ? "Verified ✓" : "Verification Pending"}
          </li>)}
        </ul>
        <p role="status" className={signEnabled ? "font-semibold text-emerald-700" : "text-amber-900"}>
          {signatureDisabledReason || "Sign the verified supplier document."}
        </p>
        {requiredDocuments.some(document => !document.verified) ? <p className="font-semibold text-amber-900">
          Pending: {requiredDocuments.filter(document => !document.verified).map(document => document.label).join(", ")}.
        </p> : null}
      </div>

      <div className="relative flex min-h-[440px] flex-1">
        <aside className="absolute left-3 top-3 z-20 flex flex-col gap-1 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-md backdrop-blur">
          <ToolbarBtn
            active={tool === "pointer"}
            title="Pointer"
            onClick={() => {
              setTool("pointer");
              setPendingTyped(null);
              setPendingFontId(null);
              setGhost(null);
            }}
          >
            <MousePointer2 className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn
            title="Zoom In"
            onClick={() => setScale((s) => Math.min(2.5, s + 0.15))}
          >
            <ZoomIn className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn
            title="Zoom Out"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.15))}
          >
            <ZoomOut className="h-4 w-4" />
          </ToolbarBtn>
          <ToolbarBtn title="Fit Width" onClick={() => void handleFit()}>
            <Expand className="h-4 w-4" />
          </ToolbarBtn>
          <div className="my-0.5 h-px bg-slate-200" />
          <ToolbarBtn
            active={tool === "esign-place" || modalOpen}
            title={signatureDisabledReason || "Sign the verified supplier document."}
            disabled={!signEnabled}
            onClick={handleEsignClick}
          >
            <PenLine className="h-4 w-4" />
          </ToolbarBtn>
        </aside>

        <div
          ref={scrollRef}
          className={`relative flex-1 overflow-auto bg-slate-100/80 ${
            tool === "esign-place" ? "cursor-none" : "cursor-default"
          }`}
        >
          {loading ? (
            <div className="flex h-full min-h-[360px] items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading PDF...
            </div>
          ) : error ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-semibold text-rose-700">{error}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 px-14 py-6">
              {Array.from({ length: pageCount }, (_, i) => {
                const pageNum = i + 1;
                const sigOnPage =
                  integrity === "Verified" && activeSig && activeSig.placement.page === pageNum
                    ? activeSig
                    : null;
                const showGhost =
                  tool === "esign-place" &&
                  ghost?.page === pageNum &&
                  Boolean(pendingTyped);

                return (
                  <div
                    key={`${documentKey}-page-${pageNum}`}
                    ref={(el) => {
                      pageWrapRefs.current[i] = el;
                    }}
                    className="relative max-w-full rounded-sm bg-white shadow-md"
                    onMouseMove={(e) => onPagePointerMove(pageNum, e)}
                    onMouseLeave={() => setGhost(null)}
                    onClick={(e) => onPageClick(pageNum, e)}
                  >
                    <canvas
                      ref={(el) => {
                        canvasRefs.current[i] = el;
                      }}
                      className="block max-w-full"
                    />

                    {showGhost && ghost ? (
                      <div
                        className="pointer-events-none absolute z-10 rounded-md border-2 border-dashed border-primary-400 bg-primary-200/35 shadow-sm"
                        style={{
                          left: `${ghost.xPct}%`,
                          top: `${ghost.yPct}%`,
                          width: `${DEFAULT_SIGNATURE_BOX.widthNorm * 100}%`,
                          height: `${DEFAULT_SIGNATURE_BOX.heightNorm * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      >
                        <div className="flex h-full flex-col items-center justify-center px-2 text-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-700">
                            Signature Area
                          </p>
                          <p
                            className="truncate text-lg text-primary-900/80"
                            style={{ fontFamily: fontCss }}
                          >
                            {pendingTyped}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {sigOnPage ? (
                      <div
                        className="absolute z-10"
                        style={{
                          left: `${sigOnPage.placement.xNorm * 100}%`,
                          top: `${sigOnPage.placement.yNorm * 100}%`,
                          width: `${sigOnPage.placement.widthNorm * 100}%`,
                          height: `${sigOnPage.placement.heightNorm * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                        onMouseEnter={() => setHoverSig(true)}
                        onMouseLeave={() => setHoverSig(false)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="relative flex h-full flex-col justify-center rounded-md border border-slate-300/80 bg-white/95 px-3 py-1.5 shadow-md">
                          {hoverSig && !locked && !readOnly && canSign ? (
                            <button
                              type="button"
                              className="absolute -right-2 -top-2 inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-2 py-1 text-[10px] font-bold text-rose-600 shadow-md transition hover:bg-rose-50"
                              onClick={() => setDeleteOpen(true)}
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </button>
                          ) : null}
                          <p
                            className="truncate text-xl leading-tight text-slate-900"
                            style={{
                              fontFamily: getSignatureFont(sigOnPage.fontId)
                                .family,
                            }}
                          >
                            {sigOnPage.typedName}
                          </p>
                          <p className="mt-0.5 text-[9px] font-medium text-slate-500">
                            Legal Reviewer ·{" "}
                            {(() => {
                              const d = sigOnPage.signedAt
                                ? new Date(sigOnPage.signedAt)
                                : null;
                              return d && !Number.isNaN(d.getTime())
                                ? d.toLocaleString()
                                : "—";
                            })()}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {saving ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-lg">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving signature…
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {pendingTyped ? (
        <div className="border-t border-primary-100 bg-primary-50 px-4 py-2 text-center text-xs font-medium text-primary-900">
          Move the blue signature area, then click to place
          {" · "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => {
              setPendingTyped(null);
              setPendingFontId(null);
              setTool("pointer");
              setGhost(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <LegalESignModal
        open={modalOpen}
        workflow="rfq"
        defaultFullName={reviewerFullName}
        confirmationText="I intend to electronically sign the reviewed PDF whose SHA-256 is displayed. SHA-256 is an integrity check, not a digital signature. Finance approval follows completion of all required signatures."
        onClose={() => setModalOpen(false)}
        onContinue={({ typedName, fontId }) => {
          setModalOpen(false);
          setPendingTyped(typedName);
          setPendingFontId(fontId);
          setTool("esign-place");
          toast.success("Click on the document to place your signature.");
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void confirmDeleteSignature()}
        title="Remove Signature?"
        description="This will remove the electronic signature from this document. You can place a new one afterward."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        isLoading={saving}
      />
    </div>
  );
}

function ToolbarBtn({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-9 w-9 place-items-center rounded-lg transition ${
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      } disabled:cursor-not-allowed disabled:opacity-35`}
    >
      {children}
    </button>
  );
}

export function LegalPdfViewerSuspense(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      }
    >
      <LegalPdfViewer {...props} />
    </Suspense>
  );
}
