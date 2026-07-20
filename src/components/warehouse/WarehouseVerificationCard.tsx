import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  Download,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  appendWarehouseEsignAudit,
  fetchStoredSignedGrnPdfBytes,
  getWarehouseSignatureSummary,
  resolveSignedGrnPdfUrl,
  verifyWarehouseGrnSignature,
  type WarehouseSignatureVerification,
} from "../../api/warehouseEsign";
import { getFullFileUrl } from "../../api/legalDocsStorage";
import type { PurchaseReceipt } from "../../types/erpnext";
import { useAuthStore } from "../../store/authStore";
import { primaryWarehouseFromReceipt } from "../../utils/supplierPortalUtils";
import { grnPdfFilename } from "../../utils/pdf/grnPdf";
import WarehouseSignatureVerifyModal from "./WarehouseSignatureVerifyModal";

interface Props {
  grn: PurchaseReceipt;
  /** When true, show green verified styling (signed + ok). */
  compact?: boolean;
}

/**
 * Warehouse Verification summary used on Finance GRN detail and Voucher pages.
 * Always references the stored signed GRN PDF — never regenerates.
 */
export default function WarehouseVerificationCard({ grn, compact }: Props) {
  const authUser = useAuthStore((s) => s.user);
  const summary = getWarehouseSignatureSummary(grn);
  const warehouse = primaryWarehouseFromReceipt(grn) || "—";
  const verified =
    summary.signed &&
    String(summary.verificationStatus).toLowerCase() !== "invalid";

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] =
    useState<WarehouseSignatureVerification | null>(null);
  const [dlBusy, setDlBusy] = useState(false);

  async function handleVerify() {
    setVerifyOpen(true);
    setVerifyBusy(true);
    try {
      const result = await verifyWarehouseGrnSignature(grn);
      setVerifyResult(result);
      appendWarehouseEsignAudit(
        "Finance verified signature",
        authUser?.full_name || authUser?.email || "Finance",
        grn.name,
        { targetRole: "finance", grnName: grn.name },
      );
      if (result.valid || (result.signed && result.integrity !== "modified")) {
        toast.success("Warehouse signature verified.");
      } else if (!result.signed) {
        toast.error("Warehouse GRN is not digitally signed.");
      } else {
        toast.error("Signature verification failed.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifyBusy(false);
    }
  }

  async function handleDownload() {
    setDlBusy(true);
    try {
      const bytes = await fetchStoredSignedGrnPdfBytes(grn);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = grnPdfFilename(grn).replace(/\.pdf$/i, "") + "-signed.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      // Fallback: open stored file URL directly if bytes fetch fails.
      try {
        const fileUrl = await resolveSignedGrnPdfUrl(grn);
        if (fileUrl) {
          window.open(getFullFileUrl(fileUrl), "_blank", "noopener,noreferrer");
          return;
        }
      } catch {
        /* fall through */
      }
      toast.error(
        err instanceof Error ? err.message : "Could not download signed GRN.",
      );
    } finally {
      setDlBusy(false);
    }
  }

  async function handleView() {
    try {
      const fileUrl = await resolveSignedGrnPdfUrl(grn);
      if (fileUrl) {
        window.open(getFullFileUrl(fileUrl), "_blank", "noopener,noreferrer");
        return;
      }
      // Navigate to GRN detail which embeds the stored PDF viewer.
      window.location.assign(`/p2p/grn/${encodeURIComponent(grn.name)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open signed GRN.");
    }
  }

  return (
    <>
      <section
        className={`rounded-xl border p-3.5 shadow-sm ${
          verified
            ? "border-emerald-200 bg-emerald-50/60"
            : "border-amber-200 bg-amber-50/60"
        } ${compact ? "" : ""}`}
      >
        <div className="mb-3 flex items-center gap-2">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              verified
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {verified ? (
              <BadgeCheck className="h-4 w-4" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Warehouse Verification
            </h2>
            <p className="text-[11px] text-neutral-500">
              Linked signed Goods Receipt Note
            </p>
          </div>
        </div>

        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <Field label="GRN Number" value={grn.name} />
          <Field label="Warehouse" value={warehouse} />
          <Field label="Signed By" value={summary.signedBy} />
          <Field
            label="Signed Date"
            value={`${summary.signedDateLabel} · ${summary.signedTimeLabel}`}
          />
          <Field
            label="Verification Status"
            value={
              verified
                ? "Verified ✓"
                : summary.signed
                  ? String(summary.verificationStatus)
                  : "Not signed"
            }
            tone={verified ? "ok" : "warn"}
          />
          <Field label="Document Version" value={summary.documentVersion} />
        </dl>

        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/60 pt-3">
          <ActionBtn
            icon={ExternalLink}
            label="View Signed GRN"
            onClick={() => void handleView()}
          />
          <ActionBtn
            icon={Download}
            label={dlBusy ? "Downloading…" : "Download Signed GRN"}
            onClick={() => void handleDownload()}
            disabled={dlBusy}
          />
          <ActionBtn
            icon={ShieldCheck}
            label="Verify Signature"
            onClick={() => void handleVerify()}
            primary
          />
          <Link
            to={`/p2p/grn/${encodeURIComponent(grn.name)}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-700 hover:bg-sky-50 hover:text-sky-800"
          >
            Open GRN
          </Link>
        </div>
      </section>

      <WarehouseSignatureVerifyModal
        open={verifyOpen}
        busy={verifyBusy}
        summary={summary}
        result={verifyResult}
        onClose={() => setVerifyOpen(false)}
      />
    </>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-xs font-semibold ${
          tone === "ok"
            ? "text-emerald-700"
            : tone === "warn"
              ? "text-amber-800"
              : "text-neutral-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  primary,
  disabled,
}: {
  icon: typeof Download;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold shadow-sm disabled:opacity-50 ${
        primary
          ? "bg-sky-600 text-white hover:bg-sky-700"
          : "border border-neutral-200 bg-white text-neutral-700 hover:bg-sky-50 hover:text-sky-800"
      }`}
    >
      {disabled ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}
