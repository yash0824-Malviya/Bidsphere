import { motion } from "framer-motion";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import type { WarehouseSignatureVerification } from "../../api/warehouseEsign";
import type { WarehouseSignatureSummary } from "../../api/warehouseEsign";

interface Props {
  open: boolean;
  busy?: boolean;
  summary: WarehouseSignatureSummary;
  result: WarehouseSignatureVerification | null;
  onClose: () => void;
}

export default function WarehouseSignatureVerifyModal({
  open,
  busy,
  summary,
  result,
  onClose,
}: Props) {
  if (!open) return null;

  const valid =
    result?.signed === true &&
    result.integrity !== "modified" &&
    (result.valid || Boolean(result.hash));
  const invalid = result?.integrity === "modified";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        aria-label="Close verification modal"
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="verify-sig-title"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-50 text-primary-700">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <h2
                id="verify-sig-title"
                className="text-base font-semibold text-slate-900"
              >
                Digital Signature Verification
              </h2>
              <p className="text-xs text-slate-500">
                Warehouse Manager signature integrity check
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-5">
          {busy || !result ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
              Verifying signature…
            </div>
          ) : (
            <>
              <div
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-3 text-sm font-semibold ${
                  valid
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : invalid
                      ? "border-rose-200 bg-rose-50 text-rose-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {valid ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <ShieldAlert className="h-5 w-5" />
                )}
                {valid
                  ? "Signature Valid"
                  : invalid
                    ? "Document Modified — Signature Invalid"
                    : "Signature status unknown"}
              </div>

              <dl className="grid gap-2 text-sm">
                <Row
                  label="Signature Status"
                  value={valid ? "Verified" : invalid ? "Invalid" : "Pending"}
                />
                <Row
                  label="Signed By"
                  value={result.signedBy || summary.signedBy || "Warehouse Manager"}
                />
                <Row
                  label="Signed On"
                  value={(() => {
                    const raw = result.signedAtIso || summary.signedAtIso;
                    if (!raw) return "—";
                    const d = new Date(raw);
                    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
                  })()}
                />
                <Row
                  label="SHA-256 Hash"
                  value={result.hash || summary.sha256Hash || summary.hash || "—"}
                  mono
                />
                <Row
                  label="Certificate Status"
                  value={
                    valid
                      ? "Valid"
                      : result.certificateStatus ||
                        summary.certificateStatus ||
                        summary.verificationStatus ||
                        "—"
                  }
                />
                <Row
                  label="Integrity"
                  value={
                    result.integrity === "intact" || valid
                      ? "Verified"
                      : result.integrity === "modified"
                        ? "Modified"
                        : summary.documentIntegrity || "Unknown"
                  }
                />
              </dl>

              <p className="text-xs text-slate-500">{result.message}</p>
            </>
          )}
        </div>

        <footer className="flex justify-end border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Close
          </button>
        </footer>
      </motion.div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-all font-semibold text-slate-900 ${
          mono ? "font-mono text-[11px]" : "text-sm"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
