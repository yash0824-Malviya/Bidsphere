import { useState } from "react";
import { Loader2, PenLine, ShieldCheck, Type } from "lucide-react";
import toast from "react-hot-toast";

import WarehouseSignaturePad from "../esign/WarehouseSignaturePad";

export type ReceiptSignPayload = {
  signerName: string;
  signatureType: "drawn" | "typed";
  signatureDataUrl?: string | null;
  typedName?: string;
};

interface Props {
  title: string;
  subtitle?: string;
  defaultName?: string;
  disabled?: boolean;
  busy?: boolean;
  onSign: (payload: ReceiptSignPayload) => Promise<void>;
}

export default function MaterialIssueReceiptSignPanel({
  title,
  subtitle,
  defaultName = "",
  disabled,
  busy: externalBusy,
  onSign,
}: Props) {
  const [mode, setMode] = useState<"drawn" | "typed">("drawn");
  const [fullName, setFullName] = useState(defaultName);
  const [typedName, setTypedName] = useState(defaultName);
  const [certified, setCertified] = useState(false);
  const [busy, setBusy] = useState(false);
  const loading = busy || externalBusy;

  const applyDrawn = async (dataUrl: string) => {
    if (!fullName.trim()) {
      toast.error("Enter signer name before capturing signature.");
      return;
    }
    if (!certified) {
      toast.error("Confirm the certification checkbox before signing.");
      return;
    }
    setBusy(true);
    try {
      await onSign({
        signerName: fullName.trim(),
        signatureType: "drawn",
        signatureDataUrl: dataUrl,
        typedName: fullName.trim(),
      });
      toast.success("Signature captured.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign.");
    } finally {
      setBusy(false);
    }
  };

  const applyTyped = async () => {
    if (typedName.trim().length < 2) {
      toast.error("Enter your full name to sign.");
      return;
    }
    if (!certified) {
      toast.error("Confirm the certification checkbox before signing.");
      return;
    }
    setBusy(true);
    try {
      await onSign({
        signerName: (fullName || typedName).trim(),
        signatureType: "typed",
        typedName: typedName.trim(),
      });
      toast.success("Typed signature captured.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-primary-200 bg-primary-50/40 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-100 text-primary-700">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {subtitle ? (
            <p className="text-xs text-slate-600">{subtitle}</p>
          ) : null}
        </div>
      </div>

      <label className="block text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Signer name
        </span>
        <input
          type="text"
          disabled={disabled || loading}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400"
          placeholder="Full name"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => setMode("drawn")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            mode === "drawn"
              ? "bg-primary-600 text-white"
              : "bg-white text-slate-600 ring-1 ring-slate-200"
          }`}
        >
          <PenLine className="h-3.5 w-3.5" />
          Draw
        </button>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => setMode("typed")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            mode === "typed"
              ? "bg-primary-600 text-white"
              : "bg-white text-slate-600 ring-1 ring-slate-200"
          }`}
        >
          <Type className="h-3.5 w-3.5" />
          Type
        </button>
      </div>

      {mode === "drawn" ? (
        <WarehouseSignaturePad
          disabled={disabled || loading}
          onSaved={(dataUrl) => void applyDrawn(dataUrl)}
        />
      ) : (
        <div className="space-y-3">
          <input
            type="text"
            disabled={disabled || loading}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Type your legal name"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400"
          />
          <button
            type="button"
            disabled={disabled || loading}
            onClick={() => void applyTyped()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Sign with typed name
          </button>
        </div>
      )}

      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={certified}
          disabled={disabled || loading}
          onChange={(e) => setCertified(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I certify that I am authorized to sign this Material Issue Receipt. A
          SHA-256 hash will be generated and stored for verification.
        </span>
      </label>
    </section>
  );
}
