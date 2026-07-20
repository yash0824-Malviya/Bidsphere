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
  burnTypedSignatureIntoPdf,
  buildLegalSignature,
  fetchPdfBytes,
  newAuditId,
  persistEsignEnvelope,
  resolveEsignBundle,
  sha256Hex,
} from "../../api/legalEsign";
import { getFullFileUrl } from "../../api/legalDocsStorage";
import type { LegalDocumentSet } from "../../api/legalDocs";
import {
  DEFAULT_SIGNATURE_BOX,
  createEmptyEnvelope,
  getDocEnvelope,
  hasLegalSignature,
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
  readOnly?: boolean;
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
  readOnly,
  reviewerFullName,
  reviewerId,
  esignBundle,
  onBundleChange,
}: Props) {
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
  const [envelope, setEnvelope] = useState<LegalEsignEnvelope | null>(null);
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
  const bundleRef = useRef(esignBundle);
  useEffect(() => {
    bundleRef.current = esignBundle;
  }, [esignBundle]);

  const safeFileUrl = String(fileUrl || "").trim();
  const proxyUrl = useMemo(
    () => (safeFileUrl ? getFullFileUrl(safeFileUrl) : ""),
    [safeFileUrl],
  );
  const documentName =
    safeFileUrl.split("/").pop()?.split("?")[0] || `${documentKey}.pdf`;
  const documentNumber = review.name || review.sq_name || "—";
  const signed = hasLegalSignature(envelope);
  const locked = Boolean(
    envelope?.locked || review.review_status !== "Pending",
  );
  const activeSig: LegalEsignSignature | null =
    (envelope?.signatures ?? []).find(
      (s) =>
        s.role === "legal" && (s.status === "signed" || s.status === "locked"),
    ) ?? null;

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
    canvasRefs.current = [];
    pageWrapRefs.current = [];

    (async () => {
      await releasePdfDoc();
      try {
        if (!safeFileUrl || !proxyUrl) {
          throw new Error("No PDF URL available for this document.");
        }

        // Diagnostic trail for Legal Review PDF loads (browser console).
        console.info("[LegalPdfViewer] attachment", {
          documentName: review.name,
          doctype: "Legal Document Review",
          documentKey,
          attachmentUrl: safeFileUrl,
          filePath: safeFileUrl,
          fileName: documentName,
          isPrivate: safeFileUrl.includes("/private/files/"),
          proxyUrl: String(proxyUrl).replace(
            /access_token=[^&]+/,
            "access_token=***",
          ),
        });

        const originalBytes = await fetchPdfBytes(proxyUrl);
        if (cancelled) return;
        sourceBytesRef.current = originalBytes.slice(0);
        const hash = await sha256Hex(sourceBytesRef.current);

        const bundle = resolveEsignBundle(
          review.name,
          review.esign_envelope,
        );
        const fromProp = getDocEnvelope(esignBundle, documentKey);
        const fromResolved = getDocEnvelope(bundle, documentKey);
        let env =
          fromProp ??
          fromResolved ??
          createEmptyEnvelope({
            documentKey,
            documentName,
            documentNumber,
            documentHash: hash,
            documentVersion: "V1",
          });

        if (!env.documentHash) env = { ...env, documentHash: hash };
        if (!env.reviewStartedAt) {
          env = {
            ...env,
            reviewStartedAt: new Date().toISOString(),
            auditTrail: [
              ...env.auditTrail,
              {
                id: newAuditId(),
                action: "review_started",
                user: reviewerFullName || reviewerId,
                userId: reviewerId,
                at: new Date().toISOString(),
                detail: `Opened ${documentKey} for review`,
              },
              {
                id: newAuditId(),
                action: "document_opened",
                user: reviewerFullName || reviewerId,
                userId: reviewerId,
                at: new Date().toISOString(),
              },
            ],
          };
        }

        const doc = await pdfjs.getDocument({
          data: bytesForPdfJs(sourceBytesRef.current),
        }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }

        pdfDocRef.current = doc;
        setEnvelope(env);
        setPageCount(doc.numPages);
        setLoading(false);

        // Persist review-started audit (and local backup) without blocking paint.
        if (review.name && !fromProp?.reviewStartedAt && !fromResolved?.reviewStartedAt) {
          void persistEsignEnvelope(review.name, env, {
            existingBundle: bundle,
          })
            .then((updated) => {
              if (cancelled) return;
              const nextBundle = resolveEsignBundle(
                review.name,
                updated.esign_envelope,
              );
              onBundleChange(nextBundle, updated);
            })
            .catch(() => {
              /* local write inside persist still attempted */
            });
        }
      } catch (err) {
        console.error("[LegalPdfViewer] load failed:", err);
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
          if (!canvas) continue;
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) continue;
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          await page.render({ canvasContext: ctx, viewport }).promise;
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

  const handleEsignClick = () => {
    if (readOnly || locked) {
      toast.error("This document is locked and cannot be signed.");
      return;
    }
    if (!canSign) {
      toast.error("Only Legal Reviewers can sign this document.");
      return;
    }
    if (signed) {
      toast.error("A signature already exists. Delete it to place a new one.");
      return;
    }
    setModalOpen(true);
  };

  const saveEnvelope = async (
    next: LegalEsignEnvelope,
    opts?: { burn?: boolean },
  ) => {
    if (!review.name) throw new Error("Missing Legal Document Review name");
    setSaving(true);
    try {
      let signedFile:
        | { bytes: Uint8Array; fileName: string }
        | undefined;
      if (opts?.burn && sourceBytesRef.current && next.signatures[0]) {
        const sig = next.signatures[0];
        const burned = await burnTypedSignatureIntoPdf(
          sourceBytesRef.current.slice(0),
          sig.typedName,
          "Legal Reviewer",
          new Date(sig.signedAt),
          sig.placement,
        );
        signedFile = {
          bytes: burned,
          fileName: documentName.replace(/\.pdf$/i, "") + "-signed.pdf",
        };
      }

      const updated = await persistEsignEnvelope(review.name, next, {
        signedFile,
        existingBundle: resolveEsignBundle(
          review.name,
          bundleRef.current ?? review.esign_envelope,
        ),
      });
      const bundle = resolveEsignBundle(review.name, updated.esign_envelope);
      setEnvelope(next);
      onBundleChange(bundle, updated);
    } finally {
      setSaving(false);
    }
  };

  const placeSignature = async (
    page: number,
    xNorm: number,
    yNorm: number,
  ) => {
    if (!pendingTyped || !pendingFontId || !envelope || !review.name) return;
    if (signed || locked || readOnly) return;

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
      // Update overlay immediately — do not reload/repaint the PDF.
      setEnvelope(next);
      setPendingTyped(null);
      setPendingFontId(null);
      setTool("pointer");
      setGhost(null);
      await saveEnvelope(next, { burn: true });
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
                Signed
              </span>
            ) : (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                Pending Signature
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Uploaded by {review.procurement_manager || "Procurement"}
            {review.submission_date
              ? ` · ${formatDate(review.submission_date)}`
              : ""}
          </p>
        </div>
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
            title="E-Sign"
            disabled={!canSign || locked || signed || saving || readOnly}
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
                  activeSig && activeSig.placement.page === pageNum
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
                        className="pointer-events-none absolute z-10 rounded-md border-2 border-dashed border-sky-400 bg-sky-200/35 shadow-sm"
                        style={{
                          left: `${ghost.xPct}%`,
                          top: `${ghost.yPct}%`,
                          width: `${DEFAULT_SIGNATURE_BOX.widthNorm * 100}%`,
                          height: `${DEFAULT_SIGNATURE_BOX.heightNorm * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      >
                        <div className="flex h-full flex-col items-center justify-center px-2 text-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                            Signature Area
                          </p>
                          <p
                            className="truncate text-lg text-sky-900/80"
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
        <div className="border-t border-sky-100 bg-sky-50 px-4 py-2 text-center text-xs font-medium text-sky-900">
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
        defaultFullName={reviewerFullName}
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
