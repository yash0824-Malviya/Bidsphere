import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  Loader2,
  Minimize2,
  Printer,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import pdfjsWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc;

interface Props {
  /** Fresh PDF bytes — parent regenerates when GRN changes. */
  pdfBytes: ArrayBuffer | null;
  loading?: boolean;
  /** Hard failure (corrupt file, etc.) — shown in rose. */
  error?: string | null;
  /** Soft empty state (PDF not generated yet) — neutral, never blocks Finance. */
  emptyHint?: string | null;
  onDownload?: () => void;
  onPrint?: () => void;
  onFullscreenChange?: (full: boolean) => void;
  /** Increment to programmatically enter fullscreen. */
  fullscreenToken?: number;
  className?: string;
}

/**
 * Inline signed-GRN PDF viewer (pdf.js) — zoom, pages, rotate, fullscreen.
 * Does not open a new browser tab for viewing.
 */
export default function SignedGrnPdfViewer({
  pdfBytes,
  loading,
  error,
  emptyHint,
  onDownload,
  onPrint,
  onFullscreenChange,
  fullscreenToken = 0,
  className = "",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [rotation, setRotation] = useState(0);
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
      if (!pdfBytes) return;
      try {
        const copy = pdfBytes.slice(0);
        const task = pdfjs.getDocument({ data: new Uint8Array(copy) });
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
            err instanceof Error ? err.message : "Unable to open signed GRN PDF.",
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
        const viewport = pg.getViewport({ scale, rotation });
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
  }, [page, pageCount, scale, rotation, pdfBytes]);

  function toggleFullscreen() {
    const next = !fullscreen;
    setFullscreen(next);
    onFullscreenChange?.(next);
    const el = shellRef.current;
    if (!el) return;
    if (next) {
      void el.requestFullscreen?.().catch(() => undefined);
    } else if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }

  useEffect(() => {
    function onFs() {
      const active = Boolean(document.fullscreenElement);
      setFullscreen(active);
      onFullscreenChange?.(active);
    }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [onFullscreenChange]);

  useEffect(() => {
    if (!fullscreenToken) return;
    const el = shellRef.current;
    if (!el) return;
    setFullscreen(true);
    void el.requestFullscreen?.().catch(() => undefined);
  }, [fullscreenToken]);

  const hardError = error || localError;
  const showEmptyHint = !pdfBytes && !loading && !hardError && Boolean(emptyHint);

  return (
    <div
      ref={shellRef}
      className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${
        fullscreen ? "fixed inset-0 z-[70] rounded-none" : ""
      } ${className}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-2.5 py-2">
        <ToolbarBtn
          icon={ZoomOut}
          label="Zoom out"
          onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.15).toFixed(2))))}
        />
        <ToolbarBtn
          icon={ZoomIn}
          label="Zoom in"
          onClick={() => setScale((s) => Math.min(2.5, Number((s + 0.15).toFixed(2))))}
        />
        <span className="px-1.5 text-[11px] font-semibold tabular-nums text-slate-500">
          {Math.round(scale * 100)}%
        </span>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <ToolbarBtn
          icon={ChevronLeft}
          label="Previous page"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        />
        <span className="min-w-[4.5rem] text-center text-[11px] font-semibold tabular-nums text-slate-600">
          {pageCount ? `${page} / ${pageCount}` : "—"}
        </span>
        <ToolbarBtn
          icon={ChevronRight}
          label="Next page"
          disabled={!pageCount || page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
        />
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <ToolbarBtn
          icon={RotateCw}
          label="Rotate"
          onClick={() => setRotation((r) => (r + 90) % 360)}
        />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {onDownload && (
            <ToolbarBtn icon={Download} label="Download" onClick={onDownload} />
          )}
          {onPrint && (
            <ToolbarBtn icon={Printer} label="Print" onClick={onPrint} />
          )}
          <ToolbarBtn
            icon={fullscreen ? Minimize2 : Expand}
            label={fullscreen ? "Exit full screen" : "Full screen"}
            onClick={toggleFullscreen}
          />
        </div>
      </div>

      <div className="relative flex min-h-[360px] flex-1 items-start justify-center overflow-auto p-4">
        {(loading || rendering) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
            <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
          </div>
        )}
        {hardError ? (
          <p className="m-auto max-w-md text-center text-sm text-rose-600">{hardError}</p>
        ) : showEmptyHint ? (
          <p className="m-auto max-w-md text-center text-sm text-slate-500">{emptyHint}</p>
        ) : (
          <canvas
            ref={canvasRef}
            className="max-w-full rounded-md bg-white shadow-md ring-1 ring-slate-200"
          />
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
  icon: typeof ZoomIn;
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-sky-50 hover:text-sky-700 disabled:opacity-40"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
