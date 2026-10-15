import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfjsWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc;

export interface ClmPdfViewport {
  width: number;
  height: number;
  pixelRatio: number;
}

/** Measure the actual scroll area, including after browser zoom or modal resizing. */
export function observeClmPdfViewport(host: HTMLDivElement, viewport: HTMLDivElement, onResize: (size: ClmPdfViewport) => void): () => void {
  const view = viewport.ownerDocument.defaultView;
  if (!view) return () => undefined;
  let frame = 0;
  let previous: ClmPdfViewport | undefined;
  const measure = () => {
    frame = 0;
    const style = view.getComputedStyle(viewport);
    const height = viewport.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
    const size = { width: host.clientWidth, height, pixelRatio: Math.min(view.devicePixelRatio || 1, 2) };
    if (size.width <= 0 || size.height <= 0) return;
    if (previous && previous.width === size.width && previous.height === size.height && previous.pixelRatio === size.pixelRatio) return;
    previous = size;
    onResize(size);
  };
  const schedule = () => {
    if (frame) view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(measure);
  };
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
  observer?.observe(viewport);
  observer?.observe(host);
  view.addEventListener("resize", schedule);
  view.visualViewport?.addEventListener("resize", schedule);
  measure();
  return () => {
    if (frame) view.cancelAnimationFrame(frame);
    observer?.disconnect();
    view.removeEventListener("resize", schedule);
    view.visualViewport?.removeEventListener("resize", schedule);
  };
}

/** Use the existing PDF.js renderer so readiness means every page was rendered. */
export async function renderClmPdfPreview(bytes: Uint8Array, host: HTMLDivElement, signal: AbortSignal, options: Partial<ClmPdfViewport> & { fit?: "width" | "page" } = {}): Promise<number> {
  const cancelled = () => { if (signal.aborted) throw new DOMException("Document preview closed.", "AbortError"); };
  cancelled();
  // PDF.js transfers its input to the worker. Retain the caller's reviewed bytes.
  const loading = pdfjs.getDocument({ data: bytes.slice() });
  let rendering: pdfjs.RenderTask | undefined;
  let destroying: Promise<void> | undefined;
  const destroy = () => destroying ??= loading.destroy();
  const abort = () => { rendering?.cancel(); void destroy().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await loading.promise;
    cancelled();
    if (!pdf.numPages) throw new Error("Contract document has no pages available for signing.");
    host.replaceChildren();
    for (let number = 1; number <= pdf.numPages; number += 1) {
      cancelled();
      const page = await pdf.getPage(number);
      cancelled();
      const base = page.getViewport({ scale: 1 });
      const availableWidth = options.width ?? host.clientWidth;
      if (!(availableWidth > 0)) throw new Error("The contract document viewer has no available width.");
      const widthScale = availableWidth / base.width;
      const pageScale = options.fit === "page" && options.height && options.height > 0 ? options.height / base.height : widthScale;
      const viewport = page.getViewport({ scale: Math.min(widthScale, pageScale, 1.6) });
      const canvas = host.ownerDocument.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Contract document preview is unavailable in this browser.");
      const ratio = Math.min(options.pixelRatio || globalThis.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.className = "clm-pdf-page";
      // CSS dimensions must match the PDF viewport, not the device-pixel bitmap.
      // In particular, w-full would stretch a fit-to-page canvas back to full width.
      Object.assign(canvas.style, {
        all: "revert", display: "block", width: `${viewport.width}px`, height: `${viewport.height}px`,
        minWidth: "0", minHeight: "0", maxWidth: "100%", maxHeight: "none", margin: "0 auto 16px",
        padding: "0", border: "0", background: "#fff", boxSizing: "content-box", transform: "none", zoom: "1",
        outline: "1px solid #cbd5e1", boxShadow: "0 2px 4px rgb(15 23 42 / 10%), 0 8px 24px rgb(15 23 42 / 8%)",
      });
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Contract document page ${number} of ${pdf.numPages}`);
      host.append(canvas);
      rendering = page.render({ canvasContext: context, viewport, ...(ratio === 1 ? {} : { transform: [ratio, 0, 0, ratio, 0, 0] }) });
      await rendering.promise;
      rendering = undefined;
      cancelled();
      page.cleanup();
    }
    return pdf.numPages;
  } finally {
    signal.removeEventListener("abort", abort);
    await destroy();
  }
}

export default function ClmPdfPreview({ bytes, title = "Contract document preview", maxHeight, fill = false, fit = "width", showControls = false, onReady, onError }: {
  bytes: Uint8Array;
  title?: string;
  maxHeight?: number;
  /** Occupy the parent's bounded flex area rather than creating another vh-sized pane. */
  fill?: boolean;
  fit?: "width" | "page";
  /** Reading controls for the modal; inline signing previews retain their existing fit. */
  showControls?: boolean;
  onReady: () => void;
  onError: (error: Error) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [size, setSize] = useState<ClmPdfViewport>();
  const [selectedFit, setSelectedFit] = useState<"width" | "page">();
  const [pageCount, setPageCount] = useState<number>();
  const activeFit = showControls ? selectedFit ?? fit : fit;
  useEffect(() => {
    if (!host.current || !viewport.current) return;
    return observeClmPdfViewport(host.current, viewport.current, setSize);
  }, []);
  useEffect(() => {
    if (!host.current || !size) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setPageCount(undefined);
    void renderClmPdfPreview(bytes, host.current, controller.signal, { ...size, fit: activeFit }).then(count => {
      if (!controller.signal.aborted) { setLoading(false); setPageCount(count); callbacks.current.onReady(); }
    }).catch(reason => {
      if (controller.signal.aborted) return;
      const failure = new Error(`Contract document could not be opened for signing. ${reason instanceof Error ? reason.message : "Retry the document preview."}`);
      setLoading(false); setError(failure.message); callbacks.current.onError(failure);
    });
    return () => controller.abort();
  }, [bytes, size, activeFit]);
  return <div className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-200/70 ${fill ? "h-full flex-1" : ""}`}
    style={fill ? undefined : { height: maxHeight ?? "55vh", maxHeight: maxHeight ?? "55vh" }} aria-label={title}>
    {showControls && <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 sm:px-4">
      <p className="text-xs text-slate-600" aria-live="polite">{pageCount ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}` : "Document preview"}</p>
      <div role="group" aria-label="PDF page scaling" className="flex gap-1 rounded-md border border-slate-200 bg-white p-1">
        {([ ["page", "Fit page"], ["width", "Fit width"] ] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={activeFit === mode} onClick={() => setSelectedFit(mode)} className={`min-h-8 rounded px-3 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${activeFit === mode ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>)}
      </div>
    </div>}
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {loading && <p role="status" className="pointer-events-none absolute inset-x-2 top-2 z-10 rounded bg-white/95 p-2 text-center text-sm text-slate-600 shadow-sm">Rendering contract document…</p>}
      {error && <p role="alert" className="absolute inset-x-2 top-2 z-10 rounded bg-white p-2 text-sm text-rose-800 shadow-sm">{error}</p>}
      <div ref={viewport} role="region" aria-label={`${title} scroll area`} tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto p-3 motion-safe:scroll-smooth sm:p-6" style={{ overscrollBehavior: "contain", scrollbarGutter: "stable", isolation: "isolate" }} aria-busy={loading}>
        <div ref={host} className="min-w-0" style={{ fontSize: 0, lineHeight: 0, transform: "none", zoom: 1 }} />
      </div>
    </div>
  </div>;
}
