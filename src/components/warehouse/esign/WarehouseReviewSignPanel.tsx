import { useState } from "react";
import { CheckCircle2, Loader2, PenLine, ShieldCheck, Type } from "lucide-react";
import toast from "react-hot-toast";

import {
  finalizeWarehouseSignatureForReview,
  hasReviewSignatureReady,
} from "../../../api/warehouseEsign";
import type { WarehouseEsignState } from "../../../types/warehouseEsign";
import WarehouseSignaturePad from "./WarehouseSignaturePad";

interface Props {
  value: WarehouseEsignState;
  onChange: (next: WarehouseEsignState) => void;
  disabled?: boolean;
}

/**
 * Mandatory Digital Signature block for Receive Goods → Review & Submit.
 * Signature pad + certify checkbox. Final hash is stamped on Sign & Finalize.
 */
export default function WarehouseReviewSignPanel({
  value,
  onChange,
  disabled,
}: Props) {
  const [mode, setMode] = useState<"drawn" | "typed">(
    value.signatureType === "typed" ? "typed" : "drawn",
  );
  const [busy, setBusy] = useState(false);
  const ready = hasReviewSignatureReady(value);

  async function applyDrawn(dataUrl: string) {
    if (disabled || value.locked) return;
    setBusy(true);
    try {
      const next = await finalizeWarehouseSignatureForReview({
        ...value,
        signatureType: "drawn",
        signatureDataUrl: dataUrl,
        typedName: value.typedName || value.fullName,
        certified: value.certified,
      });
      onChange(next);
      toast.success("Signature captured.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save signature.");
    } finally {
      setBusy(false);
    }
  }

  async function applyTyped() {
    if (disabled || value.locked) return;
    if (value.typedName.trim().length < 2) {
      toast.error("Enter your full name to sign.");
      return;
    }
    setBusy(true);
    try {
      const next = await finalizeWarehouseSignatureForReview({
        ...value,
        signatureType: "typed",
        signatureDataUrl: null,
        typedName: value.typedName.trim(),
        fullName: value.fullName.trim() || value.typedName.trim(),
        certified: value.certified,
      });
      onChange(next);
      toast.success("Typed signature captured.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save signature.");
    } finally {
      setBusy(false);
    }
  }

  const readOnly = Boolean(disabled || value.locked);

  return (
    <section className="rounded-2xl border border-primary-200 bg-primary-50/40 p-5 space-y-4">
      {value.locked && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-900">
          GRN successfully signed and finalized.
        </div>
      )}
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-100 text-primary-700">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Warehouse Digital Signature
          </h3>
          <p className="text-xs text-slate-600">
            {value.locked
              ? "This signature is locked after finalization and cannot be changed."
              : "Mandatory before Sign & Finalize GRN. Finance cannot create a voucher until this is completed."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Signer name
          </span>
          <input
            type="text"
            value={value.fullName}
            disabled={readOnly}
            onChange={(e) => onChange({ ...value, fullName: e.target.value, typedName: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70"
            placeholder="Warehouse Manager"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Role
          </span>
          <input
            type="text"
            value={value.role || value.designation}
            disabled={readOnly}
            onChange={(e) =>
              onChange({
                ...value,
                role: e.target.value,
                designation: e.target.value,
              })
            }
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70"
            placeholder="Warehouse Manager"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setMode("drawn")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === "drawn"
              ? "bg-primary-600 text-white"
              : "border border-slate-200 bg-white text-slate-700"
          }`}
        >
          <PenLine className="h-3.5 w-3.5" />
          Draw
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setMode("typed")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === "typed"
              ? "bg-primary-600 text-white"
              : "border border-slate-200 bg-white text-slate-700"
          }`}
        >
          <Type className="h-3.5 w-3.5" />
          Type
        </button>
      </div>

      {mode === "drawn" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Signature pad
          </p>
          <WarehouseSignaturePad
            disabled={readOnly || busy}
            saveLabel="Use this signature"
            onSaved={(dataUrl) => void applyDrawn(dataUrl)}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Type your signature
          </p>
          <input
            type="text"
            value={value.typedName}
            disabled={readOnly}
            onChange={(e) => onChange({ ...value, typedName: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-lg italic text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70"
            placeholder="Sign your name"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          />
          <button
            type="button"
            disabled={readOnly || busy}
            onClick={() => void applyTyped()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Type className="h-3.5 w-3.5" />}
            Apply typed signature
          </button>
        </div>
      )}

      {(value.signatureDataUrl || (value.signatureType === "typed" && value.signatureHash)) && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Signature captured
          {value.signatureHash ? ` · SHA256 ${value.signatureHash.slice(0, 12)}…` : ""}
        </div>
      )}

      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
          checked={value.certified}
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, certified: e.target.checked })}
        />
        <span>
          <span className="font-semibold">I certify received goods match this GRN</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            Quantity, condition, and warehouse acceptance are confirmed for this receipt.
          </span>
        </span>
      </label>

      {!ready && !value.locked && (
        <p className="text-xs text-amber-800">
          Capture a signature and check the certification box to enable{" "}
          <span className="font-semibold">Sign &amp; Finalize GRN</span>.
        </p>
      )}
    </section>
  );
}
