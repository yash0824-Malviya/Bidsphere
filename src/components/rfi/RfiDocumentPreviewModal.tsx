/**
 * Procurement RFI uploaded-document preview (image lightbox + PDF viewer).
 * Loads file bytes only when opened — never on page mount.
 */

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  FileWarning,
  Loader2,
  Minimize2,
  Printer,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import pdfjsWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";

import {
  getFullFileUrl,
  openErpFileInBrowser,
} from "../../api/legalDocsStorage";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc;

export type RfiPreviewDocument = {
  id: string;
  /** Required-document label / type shown in the header. */
  label: string;
  fileName: string;
  fileUrl: string;
};

type PreviewKind =
  | "image"
  | "pdf"
  | "spreadsheet"
  | "word"
  | "unsupported";

export function detectPreviewKind(fileName: string): PreviewKind {
  const lower = fileName.toLowerCase();
  if (/\.(png|jpe?g|gif|webp)$/i.test(lower)) return "image";
  if (/\.pdf$/i.test(lower)) return "pdf";
  if (/\.(xlsx|xls|csv)$/i.test(lower)) return "spreadsheet";
  if (/\.(docx|doc|rtf)$/i.test(lower)) return "word";
  return "unsupported";
}

/** True when View should open a preview modal (even if preview ends up unavailable). */
export function canOpenDocumentPreview(fileName: string): boolean {
  const kind = detectPreviewKind(fileName);
  return kind === "image" || kind === "pdf" || kind === "spreadsheet" || kind === "word";
}

function detectKind(fileName: string): PreviewKind {
  return detectPreviewKind(fileName);
}

async function fetchPreviewBlob(fileUrl: string): Promise<Blob> {
  const raw = String(fileUrl || "").trim();
  if (!raw) throw new Error("No file URL available.");

  if (raw.startsWith("data:")) {
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`Preview failed: HTTP ${res.status}`);
    return res.blob();
  }

  const openUrl =
    raw.includes("/api/file-proxy") || /^https?:\/\//i.test(raw)
      ? raw
      : getFullFileUrl(raw);
  if (!openUrl) throw new Error("Could not resolve a readable URL for this file.");

  const res = await fetch(openUrl);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; detail?: string };
      detail = String(body?.message || body?.detail || detail).trim() || detail;
    } catch {
      /* ignore */
    }
    throw new Error(`View failed: ${detail}`);
  }
  return res.blob();
}

interface Props {
  open: boolean;
  documents: RfiPreviewDocument[];
  initialIndex?: number;
  onClose: () => void;
}

export default function RfiDocumentPreviewModal({
  open,
  documents,
  initialIndex = 0,
  onClose,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [sheetPreview, setSheetPreview] = useState<{
    sheetName: string;
    rows: string[][];
  } | null>(null);
  const [imageScale, setImageScale] = useState(1);
  const objectUrlRef = useRef<string | null>(null);
  const imageShellRef = useRef<HTMLDivElement | null>(null);

  const current = documents[index] ?? null;
  const kind = current ? detectKind(current.fileName) : "unsupported";
  const canNav = documents.length > 1;

  useEffect(() => {
    if (open) {
      setIndex(
        Math.min(Math.max(0, initialIndex), Math.max(0, documents.length - 1)),
      );
    }
  }, [open, initialIndex, documents.length]);

  useEffect(() => {
    if (!open || !current) {
      setLoading(false);
      setError(null);
      setPdfBytes(null);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setObjectUrl(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setImageScale(1);
    setPdfBytes(null);
    setSheetPreview(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      setObjectUrl(null);
    }

    const previewKind = detectKind(current.fileName);
    if (previewKind === "unsupported" || previewKind === "word") {
      // Word/office binary preview is not embedded — show unavailable state.
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const blob = await fetchPreviewBlob(current.fileUrl);
        if (cancelled) return;
        if (previewKind === "pdf") {
          setPdfBytes(await blob.arrayBuffer());
        } else if (previewKind === "spreadsheet") {
          const buffer = await blob.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: "array" });
          const sheetName = workbook.SheetNames[0] || "Sheet1";
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) {
            throw new Error("Preview is not available for this file type.");
          }
          const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
            sheet,
            { header: 1, defval: "" },
          );
          const rows = matrix
            .slice(0, 80)
            .map((row) =>
              (Array.isArray(row) ? row : []).slice(0, 20).map((cell) =>
                cell == null ? "" : String(cell),
              ),
            );
          if (!rows.length) {
            throw new Error("Preview is not available for this file type.");
          }
          setSheetPreview({ sheetName, rows });
        } else {
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setObjectUrl(url);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Preview is not available for this file type.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, current?.id, current?.fileUrl, current?.fileName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && canNav) {
        setIndex((i) => (i > 0 ? i - 1 : documents.length - 1));
      }
      if (e.key === "ArrowRight" && canNav) {
        setIndex((i) => (i < documents.length - 1 ? i + 1 : 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canNav, documents.length, onClose]);

  if (!open || !current) return null;

  const handleDownload = async () => {
    try {
      await openErpFileInBrowser(current.fileUrl, {
        mode: "download",
        fileName: current.fileName || "document",
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Download failed.",
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${current.fileName}`}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]"
        aria-label="Close preview"
        onClick={onClose}
      />

      <div className="relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              {current.label}
            </p>
            <h2 className="truncate text-base font-semibold text-neutral-900">
              {current.fileName}
            </h2>
            {canNav ? (
              <p className="mt-0.5 text-xs text-neutral-500">
                Document {index + 1} of {documents.length}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canNav ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setIndex((i) => (i > 0 ? i - 1 : documents.length - 1))
                  }
                  className="rounded-lg border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50"
                  title="Previous"
                  aria-label="Previous document"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setIndex((i) => (i < documents.length - 1 ? i + 1 : 0))
                  }
                  className="rounded-lg border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50"
                  title="Next"
                  aria-label="Next document"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="rounded-lg border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50"
              title="Download"
              aria-label="Download"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="relative min-h-[280px] flex-1 overflow-hidden bg-neutral-100">
          {loading ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-sm text-neutral-500">
              <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
              Loading preview…
            </div>
          ) : error ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
              <FileWarning className="h-8 w-8 text-amber-500" />
              <p className="text-sm text-neutral-700">{error}</p>
              <button
                type="button"
                onClick={() => void handleDownload()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          ) : kind === "image" && objectUrl ? (
            <ImageLightbox
              shellRef={imageShellRef}
              src={objectUrl}
              alt={current.fileName}
              scale={imageScale}
              onZoomIn={() => setImageScale((s) => Math.min(4, s + 0.25))}
              onZoomOut={() => setImageScale((s) => Math.max(0.5, s - 0.25))}
              onFit={() => setImageScale(1)}
            />
          ) : kind === "pdf" && pdfBytes ? (
            <EmbeddedPdfViewer
              pdfBytes={pdfBytes}
              fileName={current.fileName}
              onDownload={() => void handleDownload()}
            />
          ) : kind === "spreadsheet" && sheetPreview ? (
            <SpreadsheetPreview
              sheetName={sheetPreview.sheetName}
              rows={sheetPreview.rows}
            />
          ) : (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
              <FileWarning className="h-8 w-8 text-neutral-400" />
              <p className="text-sm text-neutral-700">
                Preview is not available for this file type.
              </p>
              <button
                type="button"
                onClick={() => void handleDownload()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ImageLightbox({
  shellRef,
  src,
  alt,
  scale,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  shellRef: RefObject<HTMLDivElement | null>;
  src: string;
  alt: string;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.().catch(() => undefined);
    } else {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  };

  return (
    <div ref={shellRef} className="flex h-full min-h-[280px] flex-col bg-neutral-100">
      <div className="flex items-center justify-center gap-1 border-b border-neutral-200 bg-white px-3 py-2">
        <ToolbarBtn icon={ZoomOut} label="Zoom out" onClick={onZoomOut} />
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-neutral-600">
          {Math.round(scale * 100)}%
        </span>
        <ToolbarBtn icon={ZoomIn} label="Zoom in" onClick={onZoomIn} />
        <ToolbarBtn icon={Minimize2} label="Fit to screen" onClick={onFit} />
        <ToolbarBtn
          icon={fullscreen ? Minimize2 : Expand}
          label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
        />
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <img
          src={src}
          alt={alt}
          className="max-h-[70vh] max-w-full origin-center object-contain shadow-sm transition-transform"
          style={{ transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}

function SpreadsheetPreview({
  sheetName,
  rows,
}: {
  sheetName: string;
  rows: string[][];
}) {
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  return (
    <div className="flex h-full min-h-[280px] flex-col">
      <div className="border-b border-neutral-200 bg-white px-4 py-2 text-xs font-medium text-neutral-600">
        Sheet: {sheetName}
        <span className="ml-2 text-neutral-400">
          (showing first {rows.length} rows)
        </span>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <table className="min-w-full border-collapse text-left text-xs">
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? "bg-neutral-50 font-semibold" : ""}>
                {Array.from({ length: colCount }, (_, ci) => (
                  <td
                    key={ci}
                    className="border border-neutral-200 bg-white px-2 py-1.5 text-neutral-800"
                  >
                    {row[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmbeddedPdfViewer({
  pdfBytes,
  fileName,
  onDownload,
}: {
  pdfBytes: ArrayBuffer;
  fileName: string;
  onDownload: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.1);
  const [rendering, setRendering] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      docRef.current?.destroy().catch(() => undefined);
      docRef.current = null;
      setPage(1);
      setPageCount(0);
      setLocalError(null);
      try {
        const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes.slice(0)) });
        const pdf = await task.promise;
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        docRef.current = pdf;
        setPageCount(pdf.numPages);
      } catch (err) {
        if (!cancelled) {
          setLocalError(
            err instanceof Error ? err.message : "Unable to open PDF.",
          );
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      docRef.current?.destroy().catch(() => undefined);
      docRef.current = null;
    };
  }, [pdfBytes]);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      const pdf = docRef.current;
      const canvas = canvasRef.current;
      if (!pdf || !canvas || pageCount < 1) return;
      setRendering(true);
      try {
        const pg = await pdf.getPage(page);
        if (cancelled) return;
        const viewport = pg.getViewport({ scale });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pg.render({ canvasContext: ctx, viewport }).promise;
      } catch (err) {
        if (!cancelled) {
          setLocalError(
            err instanceof Error ? err.message : "Failed to render PDF page.",
          );
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [page, pageCount, scale, pdfBytes]);

  useEffect(() => {
    function onFs() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.().catch(() => undefined);
    } else {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  };

  const handlePrint = () => {
    try {
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) {
        toast.error("Allow pop-ups to print this PDF.");
        URL.revokeObjectURL(url);
        return;
      }
      const revoke = () => URL.revokeObjectURL(url);
      w.addEventListener("load", () => {
        try {
          w.focus();
          w.print();
        } catch {
          /* ignore */
        }
        window.setTimeout(revoke, 60_000);
      });
      window.setTimeout(revoke, 120_000);
    } catch {
      toast.error("Could not open print dialog.");
    }
  };

  return (
    <div ref={shellRef} className="flex h-full min-h-[280px] flex-col bg-neutral-100">
      <div className="flex flex-wrap items-center justify-center gap-1 border-b border-neutral-200 bg-white px-3 py-2">
        <ToolbarBtn
          icon={ChevronLeft}
          label="Previous page"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        />
        <span className="min-w-[5.5rem] text-center text-xs tabular-nums text-neutral-600">
          {pageCount ? `${page} / ${pageCount}` : "—"}
        </span>
        <ToolbarBtn
          icon={ChevronRight}
          label="Next page"
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          disabled={!pageCount || page >= pageCount}
        />
        <span className="mx-1 h-4 w-px bg-neutral-200" />
        <ToolbarBtn
          icon={ZoomOut}
          label="Zoom out"
          onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}
        />
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-neutral-600">
          {Math.round(scale * 100)}%
        </span>
        <ToolbarBtn
          icon={ZoomIn}
          label="Zoom in"
          onClick={() => setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))))}
        />
        <span className="mx-1 h-4 w-px bg-neutral-200" />
        <ToolbarBtn
          icon={fullscreen ? Minimize2 : Expand}
          label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
        />
        <ToolbarBtn icon={Printer} label="Print" onClick={handlePrint} />
        <ToolbarBtn icon={Download} label="Download" onClick={onDownload} />
      </div>

      <div className="relative flex flex-1 items-start justify-center overflow-auto p-4">
        {localError ? (
          <p className="m-auto text-sm text-rose-600">{localError}</p>
        ) : (
          <>
            {rendering ? (
              <Loader2 className="absolute right-4 top-4 h-4 w-4 animate-spin text-neutral-400" />
            ) : null}
            <canvas
              ref={canvasRef}
              className="mx-auto max-w-full bg-white shadow-sm"
              aria-label={fileName}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ToolbarBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg border border-neutral-200 p-1.5 text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
