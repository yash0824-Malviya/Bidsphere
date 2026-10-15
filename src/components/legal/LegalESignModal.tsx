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
  /** RFQ document signing is independent of the Business Case approval workflow. */
  workflow?: "business_case" | "rfq" | "contract";
  caseId?: string;
  caseTitle?: string;
  roleLabel?: string;
  confirmationText?: string;
  onClose: () => void;
  onContinue: (payload: LegalESignContinuePayload) => void;
}

/**
 * Type-signature modal (DocuSign-style) for Legal Approval.
 */
export default function LegalESignModal({
  open,
  defaultFullName,
  workflow = "business_case",
  caseId,
  caseTitle,
  roleLabel = "Legal Manager",
  confirmationText,
  onClose,
  onContinue,
}: Props) {
  if (!open) return null;
  return (
    <LegalESignModalBody
      key={`esign-${workflow}-${defaultFullName}-${caseId || ""}`}
      defaultFullName={defaultFullName}
      workflow={workflow}
      caseId={caseId}
      caseTitle={caseTitle}
      roleLabel={roleLabel}
      confirmationText={confirmationText ?? (workflow === "contract"
        ? "Type and adopt the signature you want to apply to this Contract. Final signing occurs after confirmation in the Contract workspace."
        : workflow === "rfq"
        ? "I intend to apply a typed PDF electronic signature to the reviewed supplier document. SHA-256 verifies document integrity; Finance approval follows the required signatures."
        : "I confirm that I have reviewed the required legal, compliance and supporting documents and approve this Business Case to proceed to Procurement.")}
      onClose={onClose}
      onContinue={onContinue}
    />
  );
}

function LegalESignModalBody({
  defaultFullName,
  workflow,
  caseId,
  caseTitle,
  roleLabel,
  confirmationText,
  onClose,
  onContinue,
}: Omit<Props, "open">) {
  const [fullName, setFullName] = useState(defaultFullName?.trim() || (workflow === "contract" ? "" : "Legal Manager"));
  const [fontId, setFontId] = useState<LegalSignatureFontId>(
    DEFAULT_SIGNATURE_FONT_ID,
  );
  const [confirmed, setConfirmed] = useState(workflow !== "rfq" && workflow !== "contract");

  const canContinue = workflow === "contract"
    ? fullName.trim().length > 0 && fullName.trim().length <= 160 && confirmed
    : Boolean(fontId) && (fullName.trim().length >= 1 || Boolean(defaultFullName)) && (workflow !== "rfq" || confirmed);
  const preview = useMemo(() => fullName.trim() || "Your Name", [fullName]);
  const font = getSignatureFont(fontId);
  const formattedDate = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]"
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
        className={`relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl${workflow === "contract" ? " flex max-h-[calc(100dvh-32px)] min-h-0 min-w-0 flex-col" : ""}`}
      >
        <header className={`flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4${workflow === "contract" ? " shrink-0" : ""}`}>
          <div className={`flex items-center gap-2.5${workflow === "contract" ? " min-w-0" : ""}`}>
            <span className={`grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200${workflow === "contract" ? " shrink-0" : ""}`}>
              <PenLine className="h-4 w-4" />
            </span>
            <div className={workflow === "contract" ? "min-w-0 break-words" : undefined}>
              <h2
                id="esign-title"
                className="text-base font-bold text-slate-900"
              >
                {workflow === "contract" ? "ADOPT CONTRACT SIGNATURE" : workflow === "rfq" ? "RFQ DOCUMENT E-SIGNATURE" : "LEGAL APPROVAL & E-SIGNATURE"}
              </h2>
              <p className="text-xs text-slate-500">
                {workflow === "contract" ? "Capture your typed signature for this Contract" : workflow === "rfq" ? "Apply a typed PDF electronic signature to the verified document" : "Execute legal stage approval and digital e-signature"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 cursor-pointer${workflow === "contract" ? " shrink-0" : ""}`}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className={workflow === "contract" ? "min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-4" : "space-y-4 px-5 py-5 max-h-[75vh] overflow-y-auto"}>
          {/* Business Case Context Card */}
          {caseId && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                  {workflow === "contract" ? "Contract:" : "Business Case:"}
                </span>
                <span className="font-mono font-bold text-indigo-900">{caseId}</span>
              </div>
              {caseTitle && (
                <div className="flex justify-between gap-4">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] shrink-0">
                    Title:
                  </span>
                  <span className="font-medium text-slate-800 text-right truncate">
                    {caseTitle}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Legal Declaration */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 leading-relaxed font-medium">
            "{confirmationText}"
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                {workflow === "contract" ? "Signature text" : "Signer Name"} <span className="text-rose-500">*</span>
              </span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); if (workflow === "contract") setConfirmed(false); }}
                aria-label={workflow === "contract" ? "Signature text" : undefined}
                maxLength={workflow === "contract" ? 160 : undefined}
                autoFocus
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none ring-primary-500/30 transition focus:border-primary-400 focus:ring-2"
                placeholder={workflow === "contract" ? "Type your signature" : "Enter legal signer name"}
              />
            </label>

            <div>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Role
              </span>
              <input
                type="text"
                readOnly
                value={roleLabel || "Legal Manager"}
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-700 outline-none cursor-not-allowed"
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span>Date & Time:</span>
            <span className="font-mono font-medium text-slate-800">{formattedDate}</span>
          </div>

          {workflow !== "contract" && <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Select Signature Style
            </span>
            <div className="grid grid-cols-2 gap-2">
              {LEGAL_SIGNATURE_FONTS.map((f) => {
                const selected = f.id === fontId;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFontId(f.id)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition cursor-pointer ${
                      selected
                        ? "border-[#1554D1] bg-blue-50/70 ring-2 ring-blue-200"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {f.label}
                    </span>
                    <span
                      className="text-lg text-slate-900 truncate"
                      style={{ fontFamily: f.family, lineHeight: 1.2 }}
                    >
                      {preview}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>}

          {/* Live Signature Preview */}
          <div className="rounded-xl border border-dashed border-indigo-200 bg-linear-to-b from-indigo-50/60 to-white px-4 py-5 text-center shadow-2xs">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
              E-Signature Preview
            </p>
            <p
              className="mt-2 text-3xl text-slate-900 truncate"
              style={{ fontFamily: workflow === "contract" ? '"Times New Roman", Times, serif' : font.family, fontStyle: workflow === "contract" ? "italic" : undefined, lineHeight: 1.2 }}
            >
              {preview}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 hover:bg-slate-50 transition-colors">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span className="text-xs leading-snug text-slate-700">
              {workflow === "contract"
                ? "I adopt this typed signature for the Contract shown above."
                : workflow === "rfq"
                ? "I have reviewed the required supplier documents and intend to apply my electronic signature to this PDF. Completing the required signatures sends the RFQ to Finance for approval."
                : "I confirm that I have reviewed all required legal, compliance, and supporting documents, and intend to apply my digital signature to approve this Business Case."}
            </span>
          </label>
        </div>

        <footer className={`flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/80 px-5 py-3.5${workflow === "contract" ? " shrink-0" : ""}`}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => {
              if (!canContinue) return;
              onContinue({ typedName: workflow === "contract" ? fullName.trim() : fullName.trim() || defaultFullName || "Legal Manager", fontId });
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600 cursor-pointer"
          >
            <PenLine className="h-3.5 w-3.5" />
            {workflow === "contract" ? "Adopt Signature" : workflow === "rfq" ? "Continue to Signature Placement" : "Sign & Approve"}
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
