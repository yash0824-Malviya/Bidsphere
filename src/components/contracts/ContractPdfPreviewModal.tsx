import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import ClmPdfPreview from "./ClmPdfPreview";
import { CLM_BUTTON } from "./ClmFields";

export interface ContractPreviewDocument {
  url: string;
  type: string;
  name: string;
  bytes?: Uint8Array;
}

/** Presentation only: display the already authorized bytes without refetching or regenerating them. */
export default function ContractPdfPreviewModal({ contractId, preview, onClose }: {
  contractId: string;
  preview: ContractPreviewDocument;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const body = globalThis.document.body;
    const root = globalThis.document.documentElement;
    const previousOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousFocus = globalThis.document.activeElement as HTMLElement | null;
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab" || !panel.current) return;
      const controls = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    globalThis.document.addEventListener("keydown", keydown, true);
    return () => {
      globalThis.document.removeEventListener("keydown", keydown, true);
      body.style.overflow = previousOverflow;
      root.style.overflow = previousRootOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const pdf = preview.type.includes("pdf");
  const modal = <div role="dialog" aria-modal="true" aria-label="Contract document preview" className="fixed inset-0 z-[1300] isolate flex items-center justify-center overflow-hidden bg-slate-950/70 p-2.5 sm:p-4 lg:p-6">
    <div ref={panel} className="flex h-[calc(100dvh-20px)] max-h-[calc(100dvh-20px)] w-full min-w-0 max-w-[1200px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl sm:h-[calc(100dvh-32px)] sm:max-h-[calc(100dvh-32px)] lg:h-[calc(100dvh-48px)] lg:max-h-[calc(100dvh-48px)]">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white p-3 sm:p-4">
        <div className="min-w-0"><h2 className="text-base font-semibold text-slate-900 sm:text-lg">{pdf ? "Contract PDF" : "Contract Document"}</h2><p className="break-words font-mono text-xs text-slate-700 sm:text-sm">{contractId}</p><p className="mt-1 truncate text-xs text-slate-500" title={preview.name}>{preview.name}</p></div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2"><a className={CLM_BUTTON} href={preview.url} download={preview.name}>Download</a><button ref={closeButton} type="button" className={CLM_BUTTON} onClick={onClose}>Close</button></div>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gray-100">
        {pdf && preview.bytes ? <ClmPdfPreview bytes={preview.bytes} title="Contract PDF pages" fill fit="width" showControls onReady={() => undefined} onError={() => undefined} /> : preview.type.startsWith("image/") ? <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6"><img src={preview.url} alt={preview.name} className="mx-auto block h-auto max-w-full" /></div> : <p className="p-6 text-center text-sm text-slate-600">Preview is unavailable for this file type. Download it to view its contents.</p>}
      </div>
    </div>
  </div>;
  // Fixed descendants of transformed app containers are not viewport-fixed.
  // Portal above both the app shell and the E-Sign workspace (z-index 1100).
  return typeof globalThis.document === "undefined" ? modal : createPortal(modal, globalThis.document.body);
}
