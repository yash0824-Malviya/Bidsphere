import { useState } from "react";
import type { jsPDF } from "jspdf";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

type Variant = "button" | "compact";

interface PdfActionsProps {
  /** Builds the jsPDF document from the latest record data. */
  build: () => Promise<jsPDF>;
  /** Download filename, e.g. `INV-BLUERI-4728.pdf`. */
  filename: string;
  /** `button` for page headers, `compact` for table rows. */
  variant?: Variant;
  /** Toggle individual actions (both shown by default). */
  showView?: boolean;
  showDownload?: boolean;
  /** Stop row click handlers firing when used inside a clickable table row. */
  stopPropagation?: boolean;
  /**
   * Label for the document, e.g. "Voucher PDF" → buttons read
   * "View Voucher PDF" / "Download Voucher PDF". Defaults to "PDF".
   */
  docLabel?: string;
  className?: string;
}

/**
 * Reusable "View PDF / Download PDF" control. PDFs are generated on demand from
 * the live record (`build`) so they always reflect the latest status. "View"
 * opens a print-friendly blob preview in a new tab; "Download" saves the file.
 */
export default function PdfActions({
  build,
  filename,
  variant = "button",
  showView = true,
  showDownload = true,
  stopPropagation = false,
  docLabel = "PDF",
  className = "",
}: PdfActionsProps) {
  const [busy, setBusy] = useState<null | "view" | "download">(null);

  async function run(mode: "view" | "download", e: React.MouseEvent) {
    if (stopPropagation) e.stopPropagation();
    if (busy) return;
    setBusy(mode);
    try {
      const doc = await build();
      if (mode === "download") {
        doc.save(filename);
      } else {
        const url = doc.output("bloburl");
        const win = window.open(url, "_blank");
        if (!win) doc.save(filename);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[PdfActions] failed to generate PDF", err);
      toast.error("Could not generate the PDF. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (variant === "compact") {
    return (
      <div className={`inline-flex items-center gap-1 ${className}`}>
        {showView && (
          <button
            type="button"
            title={`View ${docLabel}`}
            onClick={(e) => run("view", e)}
            disabled={busy !== null}
            className="inline-flex items-center justify-center rounded-md border border-neutral-200 bg-white p-1.5 text-neutral-500 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
          >
            {busy === "view" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        {showDownload && (
          <button
            type="button"
            title={`Download ${docLabel}`}
            onClick={(e) => run("download", e)}
            disabled={busy !== null}
            className="inline-flex items-center justify-center rounded-md border border-neutral-200 bg-white p-1.5 text-neutral-500 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
          >
            {busy === "download" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {showView && (
        <button
          type="button"
          onClick={(e) => run("view", e)}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
        >
          {busy === "view" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          View {docLabel}
        </button>
      )}
      {showDownload && (
        <button
          type="button"
          onClick={(e) => run("download", e)}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
        >
          {busy === "download" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download {docLabel}
        </button>
      )}
    </div>
  );
}

export { FileText };
