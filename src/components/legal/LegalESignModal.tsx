import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PenLine, X } from "lucide-react";
import {
  DEFAULT_SIGNATURE_FONT_ID,
  LEGAL_SIGNATURE_FONTS,
  getSignatureFont,
  type LegalSignatureFontId,
} from "../../types/legalSignatureFonts";

export interface LegalESignContinuePayload {
  typedName: string;
  fontId: LegalSignatureFontId;
}

interface Props {
  open: boolean;
  defaultFullName: string;
  onClose: () => void;
  onContinue: (payload: LegalESignContinuePayload) => void;
}

/**
 * Type-signature modal (DocuSign-style). Font picker + live preview.
 * Body remounts when opened so form state resets without syncing in an effect.
 */
export default function LegalESignModal({
  open,
  defaultFullName,
  onClose,
  onContinue,
}: Props) {
  if (!open) return null;
  return (
    <LegalESignModalBody
      key={`esign-${defaultFullName}`}
      defaultFullName={defaultFullName}
      onClose={onClose}
      onContinue={onContinue}
    />
  );
}

function LegalESignModalBody({
  defaultFullName,
  onClose,
  onContinue,
}: Omit<Props, "open">) {
  const [fullName, setFullName] = useState(defaultFullName);
  const [fontId, setFontId] = useState<LegalSignatureFontId>(
    DEFAULT_SIGNATURE_FONT_ID,
  );
  const [confirmed, setConfirmed] = useState(false);

  const canContinue = fullName.trim().length >= 2 && confirmed;
  const preview = useMemo(() => fullName.trim() || "Your Name", [fullName]);
  const font = getSignatureFont(fontId);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        aria-label="Close signature modal"
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="esign-title"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-700">
              <PenLine className="h-4 w-4" />
            </span>
            <div>
              <h2
                id="esign-title"
                className="text-base font-semibold text-slate-900"
              >
                Electronic Signature
              </h2>
              <p className="text-xs text-slate-500">
                Type your name, choose a style, then place on the PDF
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Full Name <span className="text-rose-500">*</span>
            </span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-sky-500/30 transition focus:border-sky-400 focus:ring-2"
              placeholder="Enter your full legal name"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Signature Style
            </span>
            <div className="grid gap-2">
              {LEGAL_SIGNATURE_FONTS.map((f) => {
                const selected = f.id === fontId;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFontId(f.id)}
                    className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition ${
                      selected
                        ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {f.label}
                    </span>
                    <span
                      className="text-2xl text-slate-900"
                      style={{ fontFamily: f.family, lineHeight: 1.2 }}
                    >
                      {preview}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-sky-200 bg-gradient-to-b from-sky-50/80 to-white px-4 py-6 text-center shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-600/80">
              Live Preview
            </p>
            <p
              className="mt-2 text-4xl text-slate-900"
              style={{ fontFamily: font.family, lineHeight: 1.2 }}
            >
              {preview}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span className="text-sm leading-snug text-slate-700">
              I confirm this is my electronic signature and I intend to sign
              this document.
            </span>
          </label>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canContinue}
            onClick={() =>
              onContinue({ typedName: fullName.trim(), fontId })
            }
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
