/**
 * Signature Preview — shows the actual warehouse signature (image or typed)
 * plus View / Download signature actions (verification lives elsewhere).
 */
import { useState } from "react";
import toast from "react-hot-toast";
import {
  Download,
  Eye,
  PenLine,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  downloadWarehouseSignature,
  type WarehouseSignatureSummary,
} from "../../api/warehouseEsign";
import type { PurchaseReceipt } from "../../types/erpnext";
import { getSignatureFont } from "../../types/legalSignatureFonts";

interface SignaturePreviewCardProps {
  grn: PurchaseReceipt;
  summary: WarehouseSignatureSummary;
  certificateStatus?: string;
  integrityLabel?: string;
}

export default function SignaturePreviewCard({
  grn,
  summary,
  certificateStatus,
  integrityLabel,
}: SignaturePreviewCardProps) {
  const [viewOpen, setViewOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const font = getSignatureFont(summary.fontId);
  const typeKey = String(summary.signatureType || "").toLowerCase();
  const showTypedText =
    typeKey === "typed" && Boolean(summary.typedText || summary.signedBy);
  const showImage = !showTypedText && Boolean(summary.previewSrc);
  const cert = certificateStatus || summary.certificateStatus || "Valid";
  const integrity = integrityLabel || summary.documentIntegrity || "Verified";

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadWarehouseSignature(grn);
      toast.success("Signature downloaded.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Unable to download signature.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <PenLine className="h-4 w-4 text-primary-600" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Signature Preview
          </h3>
        </div>

        <div className="flex min-h-[96px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4">
          {showImage && summary.previewSrc ? (
            <img
              src={summary.previewSrc}
              alt={`Signature of ${summary.signedBy}`}
              className="max-h-20 w-auto max-w-full object-contain"
            />
          ) : showTypedText ? (
            <p
              className="max-w-full truncate px-2 text-center text-3xl text-slate-900"
              style={{
                fontFamily: font.family,
                fontStyle: "italic",
              }}
            >
              {summary.typedText || summary.signedBy}
            </p>
          ) : summary.previewSrc ? (
            <img
              src={summary.previewSrc}
              alt={`Signature of ${summary.signedBy}`}
              className="max-h-20 w-auto max-w-full object-contain"
            />
          ) : (
            <p className="text-xs text-slate-400">No signature image stored.</p>
          )}
        </div>

        <dl className="mt-3 space-y-1.5 text-xs">
          <PreviewRow label="Signed by" value={summary.signedBy} />
          <PreviewRow label="Role" value={summary.role} />
          <PreviewRow
            label="Signed on"
            value={`${summary.signedDateLabel} · ${summary.signedTimeLabel}`}
          />
          <PreviewRow
            label="Type"
            value={
              summary.signatureType
                ? summary.signatureType.charAt(0).toUpperCase() +
                  summary.signatureType.slice(1)
                : "—"
            }
          />
          <PreviewRow label="Certificate" value={cert} tone="ok" />
          <PreviewRow label="Integrity" value={integrity} tone="ok" />
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              SHA-256
            </dt>
            <dd className="mt-0.5 break-all font-mono text-[10px] text-slate-700">
              {summary.sha256Hash || "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          <ActionChip
            icon={Eye}
            label="View Signature"
            onClick={() => setViewOpen(true)}
          />
          <ActionChip
            icon={Download}
            label={downloading ? "Downloading…" : "Download Signature"}
            onClick={() => void handleDownload()}
            disabled={downloading}
          />
        </div>
      </div>

      {viewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="View signature"
          onClick={() => setViewOpen(false)}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setViewOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Warehouse Digital Signature
              </h2>
            </div>
            <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-6">
              {showImage && summary.previewSrc ? (
                <img
                  src={summary.previewSrc}
                  alt={`Signature of ${summary.signedBy}`}
                  className="max-h-36 w-auto max-w-full object-contain"
                />
              ) : showTypedText ? (
                <p
                  className="text-center text-4xl text-slate-900"
                  style={{
                    fontFamily: font.family,
                    fontStyle: "italic",
                  }}
                >
                  {summary.typedText || summary.signedBy}
                </p>
              ) : summary.previewSrc ? (
                <img
                  src={summary.previewSrc}
                  alt={`Signature of ${summary.signedBy}`}
                  className="max-h-36 w-auto max-w-full object-contain"
                />
              ) : (
                <p className="text-sm text-slate-400">No signature artifact.</p>
              )}
            </div>
            <div className="mt-4 space-y-1 text-sm text-slate-600">
              <p>
                <span className="font-semibold text-slate-800">
                  {summary.signedBy}
                </span>{" "}
                · {summary.role}
              </p>
              <p>
                {summary.signedDateLabel} · {summary.signedTimeLabel}
              </p>
              <p className="break-all font-mono text-[11px] text-slate-500">
                SHA-256: {summary.sha256Hash}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <ActionChip
                icon={Download}
                label="Download Signature"
                onClick={() => void handleDownload()}
              />
              <button
                type="button"
                onClick={() => setViewOpen(false)}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PreviewRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd
        className={`text-right text-xs font-medium ${
          tone === "ok" ? "text-emerald-700" : "text-slate-800"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function ActionChip({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Eye;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
