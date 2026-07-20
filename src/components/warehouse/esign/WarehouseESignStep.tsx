import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  PenLine,
  Pencil,
  Replace,
  ShieldCheck,
  Trash2,
  Type,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  clearWarehouseSignature,
  finalizeWarehouseSignature,
} from "../../../api/warehouseEsign";
import {
  LEGAL_SIGNATURE_FONTS,
  getSignatureFont,
  type LegalSignatureFontId,
} from "../../../types/legalSignatureFonts";
import {
  WAREHOUSE_CHECKLIST_KEYS,
  WAREHOUSE_CHECKLIST_LABELS,
  type WarehouseEsignState,
  type WarehouseSignatureType,
  hasSignatureArtifact,
  isChecklistComplete,
} from "../../../types/warehouseEsign";
import WarehouseSignaturePad from "./WarehouseSignaturePad";

type SigTab = WarehouseSignatureType;

interface PreviewContext {
  poName: string;
  warehouse: string;
  supplier?: string;
  itemCount: number;
}

interface Props {
  value: WarehouseEsignState;
  onChange: (next: WarehouseEsignState) => void;
  preview: PreviewContext;
  disabled?: boolean;
}

export default function WarehouseESignStep({
  value,
  onChange,
  preview,
  disabled,
}: Props) {
  const [tab, setTab] = useState<SigTab>("typed");
  const [placing, setPlacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: WarehouseEsignState["placement"];
  } | null>(null);

  const checklistDone = isChecklistComplete(value.checklist);
  const artifactReady = hasSignatureArtifact(value);
  const font = getSignatureFont(value.fontId);

  const patch = useCallback(
    (partial: Partial<WarehouseEsignState>) => {
      onChange({ ...value, ...partial });
    },
    [onChange, value],
  );

  async function applyArtifact(
    next: Partial<WarehouseEsignState> & { signatureType: WarehouseSignatureType },
  ) {
    const merged = { ...value, ...next, placed: false, signatureHash: null };
    onChange(merged);
    setPlacing(true);
  }

  async function placeAndFinalize(at?: { x: number; y: number }) {
    if (!artifactReady) {
      toast.error("Create a signature before placing it.");
      return;
    }
    setBusy(true);
    try {
      const placement = at
        ? {
            ...value.placement,
            x: Math.min(0.55, Math.max(0.02, at.x - value.placement.w / 2)),
            y: Math.min(0.82, Math.max(0.55, at.y - value.placement.h / 2)),
          }
        : value.placement;
      const drafted = {
        ...value,
        placed: true,
        placement,
        signatureType: value.signatureType ?? tab,
      };
      const finalized = await finalizeWarehouseSignature(drafted);
      onChange(finalized);
      setPlacing(false);
      toast.success("Warehouse signature placed and hashed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to place signature.");
    } finally {
      setBusy(false);
    }
  }

  function handleRemove() {
    if (value.locked) return;
    onChange(clearWarehouseSignature(value));
    setPlacing(false);
    toast.success("Signature removed.");
  }

  function handlePageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placing || value.locked || !pageRef.current) return;
    const rect = pageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (y < 0.55) {
      toast.error("Place the signature in the Warehouse Digital Signature zone.");
      return;
    }
    void placeAndFinalize({ x, y });
  }

  function onSigPointerDown(
    e: React.PointerEvent,
    mode: "move" | "resize",
  ) {
    if (value.locked || !value.placed) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...value.placement },
    };
  }

  function onSigPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const page = pageRef.current;
    if (!drag || !page || value.locked) return;
    const rect = page.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    if (drag.mode === "move") {
      patch({
        placement: {
          ...drag.orig,
          x: Math.min(0.7, Math.max(0.02, drag.orig.x + dx)),
          y: Math.min(0.85, Math.max(0.55, drag.orig.y + dy)),
        },
      });
    } else {
      patch({
        placement: {
          ...drag.orig,
          w: Math.min(0.7, Math.max(0.22, drag.orig.w + dx)),
          h: Math.min(0.28, Math.max(0.1, drag.orig.h + dy)),
        },
      });
    }
  }

  function onSigPointerUp() {
    dragRef.current = null;
  }

  async function rehashAfterMove() {
    if (!value.placed || value.locked || !value.signatureHash) return;
    setBusy(true);
    try {
      const finalized = await finalizeWarehouseSignature(value, {
        action: "Warehouse Signature Updated",
      });
      onChange(finalized);
    } catch {
      /* keep previous hash if rehash fails mid-drag */
    } finally {
      setBusy(false);
    }
  }

  const previewName = useMemo(
    () => value.typedName.trim() || value.fullName.trim() || "Your Name",
    [value.typedName, value.fullName],
  );

  return (
    <div className="space-y-5">
      {/* Section 1 — Checklist */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Warehouse Verification Checklist
            </h2>
            <p className="text-sm text-slate-500">
              Confirm physical inspection before digitally signing the GRN.
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {WAREHOUSE_CHECKLIST_KEYS.map((key) => (
            <label
              key={key}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 transition ${
                value.checklist[key]
                  ? "border-sky-300 bg-sky-50/70"
                  : "border-slate-200 bg-white hover:border-slate-300"
              } ${disabled || value.locked ? "pointer-events-none opacity-70" : ""}`}
            >
              <input
                type="checkbox"
                checked={value.checklist[key]}
                disabled={disabled || value.locked}
                onChange={(e) =>
                  patch({
                    checklist: { ...value.checklist, [key]: e.target.checked },
                  })
                }
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span className="text-sm text-slate-800">
                {WAREHOUSE_CHECKLIST_LABELS[key]}
              </span>
            </label>
          ))}
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Remarks
          </span>
          <textarea
            value={value.remarks}
            disabled={disabled || value.locked}
            onChange={(e) => patch({ remarks: e.target.value })}
            rows={3}
            placeholder="Inspection notes, exceptions, or carrier comments…"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none ring-sky-500/20 focus:border-sky-400 focus:ring-2 disabled:bg-slate-50"
          />
        </label>
      </motion.section>

      {/* Section 2 — Signer identity */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700">
            <PenLine className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Warehouse Digital Signature
            </h2>
            <p className="text-sm text-slate-500">
              Signer identity is captured from the logged-in Warehouse Manager.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["Full Name", value.fullName, (v: string) => patch({ fullName: v, typedName: value.typedName || v })],
              ["Designation", value.designation, (v: string) => patch({ designation: v })],
              ["Employee ID", value.employeeId, (v: string) => patch({ employeeId: v })],
              ["Current Date & Time", value.signedAtDisplay, null],
            ] as const
          ).map(([label, val, setter]) => (
            <label key={label} className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                {label}
              </span>
              <input
                type="text"
                value={val}
                readOnly={!setter || value.locked}
                onChange={
                  setter
                    ? (e) => (setter as (v: string) => void)(e.target.value)
                    : undefined
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 read-only:bg-slate-50"
              />
            </label>
          ))}
        </div>
      </motion.section>

      {/* Signature options */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
      >
        <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3">
          {(
            [
              ["typed", Type, "Type Signature"],
              ["drawn", PenLine, "Draw Signature"],
              ["uploaded", ImagePlus, "Upload Signature Image"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              disabled={disabled || value.locked}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                tab === id
                  ? "bg-sky-600 text-white shadow-sm"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {tab === "typed" && (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Full Name
              </span>
              <input
                type="text"
                disabled={disabled || value.locked}
                value={value.typedName}
                onChange={(e) =>
                  patch({
                    typedName: e.target.value,
                    signatureType: "typed",
                    signatureDataUrl: null,
                    placed: false,
                    signatureHash: null,
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20"
                placeholder="Type your full name"
              />
            </label>

            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Signature Style
              </span>
              <div className="grid gap-2">
                {LEGAL_SIGNATURE_FONTS.map((f, idx) => {
                  const selected = f.id === value.fontId;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={disabled || value.locked}
                      onClick={() =>
                        patch({
                          fontId: f.id as LegalSignatureFontId,
                          signatureType: "typed",
                          placed: false,
                          signatureHash: null,
                        })
                      }
                      className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition ${
                        selected
                          ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Style {idx + 1} · {f.label}
                      </span>
                      <span
                        className="text-2xl text-slate-900"
                        style={{ fontFamily: f.family, lineHeight: 1.2 }}
                      >
                        {previewName}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-sky-200 bg-gradient-to-b from-sky-50/80 to-white px-4 py-6 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-600/80">
                Live Preview
              </p>
              <p
                className="mt-2 text-4xl text-slate-900"
                style={{ fontFamily: font.family, lineHeight: 1.2 }}
              >
                {previewName}
              </p>
            </div>

            <button
              type="button"
              disabled={disabled || value.locked || previewName.length < 2}
              onClick={() =>
                void applyArtifact({
                  signatureType: "typed",
                  typedName: previewName,
                  signatureDataUrl: null,
                })
              }
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
            >
              Use Typed Signature
            </button>
          </div>
        )}

        {tab === "drawn" && (
          <div className="space-y-3">
            <WarehouseSignaturePad
              disabled={disabled || value.locked}
              onSaved={(dataUrl) =>
                void applyArtifact({
                  signatureType: "drawn",
                  signatureDataUrl: dataUrl,
                })
              }
            />
            {value.signatureType === "drawn" && value.signatureDataUrl && (
              <img
                src={value.signatureDataUrl}
                alt="Drawn signature preview"
                className="h-16 object-contain"
              />
            )}
          </div>
        )}

        {tab === "uploaded" && (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 bg-sky-50/40 px-4 py-8 text-sm text-slate-600 hover:bg-sky-50">
              <ImagePlus className="mb-2 h-5 w-5 text-sky-600" />
              Upload PNG / JPG / JPEG (transparent PNG preferred)
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="hidden"
                disabled={disabled || value.locked}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (!/^image\/(png|jpeg|jpg)$/i.test(file.type)) {
                    toast.error("Only PNG, JPG, or JPEG images are allowed.");
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    void applyArtifact({
                      signatureType: "uploaded",
                      signatureDataUrl: String(reader.result || ""),
                    });
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {value.signatureType === "uploaded" && value.signatureDataUrl && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Uploaded Preview
                </p>
                <img
                  src={value.signatureDataUrl}
                  alt="Uploaded signature"
                  className="max-h-24 object-contain"
                />
              </div>
            )}
          </div>
        )}
      </motion.section>

      {/* Placement on GRN preview */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Signature Placement — GRN Preview
            </h3>
            <p className="text-sm text-slate-500">
              Click Place Signature, then click the signature zone at the bottom of the document.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!value.placed ? (
              <button
                type="button"
                disabled={disabled || value.locked || !artifactReady || busy}
                onClick={() => setPlacing(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
                Place Signature
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={disabled || value.locked}
                  onClick={() => {
                    setPlacing(true);
                    patch({ placed: false, signatureHash: null });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  disabled={disabled || value.locked}
                  onClick={handleRemove}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
                <button
                  type="button"
                  disabled={disabled || value.locked}
                  onClick={() => {
                    handleRemove();
                    setTab("typed");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  <Replace className="h-3.5 w-3.5" />
                  Replace
                </button>
              </>
            )}
          </div>
        </div>

        <div
          ref={pageRef}
          onClick={handlePageClick}
          onPointerMove={onSigPointerMove}
          onPointerUp={() => {
            const wasDragging = Boolean(dragRef.current);
            onSigPointerUp();
            if (wasDragging) void rehashAfterMove();
          }}
          className={`relative mx-auto min-h-[420px] max-w-2xl rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6 shadow-inner ${
            placing ? "cursor-crosshair ring-2 ring-sky-300" : ""
          }`}
        >
          <p className="text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            Goods Receipt Note — Preview
          </p>
          <h4 className="mt-2 text-center text-lg font-bold text-slate-900">
            {preview.poName}
          </h4>
          <div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <p>Supplier: {preview.supplier || "—"}</p>
            <p>Warehouse: {preview.warehouse || "—"}</p>
            <p>Lines receiving: {preview.itemCount}</p>
            <p>Status: Draft (pending signature)</p>
          </div>
          <div className="mt-6 h-px bg-slate-200" />
          <p className="mt-4 text-xs text-slate-500">
            Received items summary will appear on the final GRN PDF after submission.
          </p>

          <div className="absolute inset-x-6 bottom-6">
            <div className="mb-2 border-t border-slate-300 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Warehouse Digital Signature
            </div>
            <div
              className={`relative flex h-28 items-center justify-center rounded-lg border-2 border-dashed transition ${
                placing
                  ? "border-sky-400 bg-sky-100/70 text-sky-700"
                  : "border-slate-300 bg-white text-slate-400"
              }`}
            >
              {!value.placed && (
                <span className="text-sm font-medium">
                  {placing ? "Click to place signature" : "Click to Sign"}
                </span>
              )}
            </div>
          </div>

          {value.placed && (
            <div
              className="absolute z-10 rounded-md border border-sky-400 bg-white/95 p-2 shadow-md"
              style={{
                left: `${value.placement.x * 100}%`,
                top: `${value.placement.y * 100}%`,
                width: `${value.placement.w * 100}%`,
                height: `${value.placement.h * 100}%`,
              }}
              onPointerDown={(e) => onSigPointerDown(e, "move")}
            >
              {value.signatureType === "typed" ? (
                <p
                  className="truncate text-center text-2xl text-slate-900"
                  style={{ fontFamily: font.family }}
                >
                  {value.typedName}
                </p>
              ) : value.signatureDataUrl ? (
                <img
                  src={value.signatureDataUrl}
                  alt="Signature"
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              ) : null}
              <p className="mt-0.5 text-center text-[9px] text-slate-500">
                {value.fullName} · {value.employeeId || "—"}
              </p>
              <button
                type="button"
                aria-label="Resize signature"
                className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize rounded-sm border border-sky-500 bg-sky-500"
                onPointerDown={(e) => onSigPointerDown(e, "resize")}
              />
            </div>
          )}
        </div>

        {value.signatureHash && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-semibold">SHA256 Verified</span>
            <code className="break-all font-mono text-[10px] text-emerald-700">
              {value.signatureHash}
            </code>
          </div>
        )}
      </motion.section>

      {/* Certification */}
      <label
        className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition ${
          value.certified
            ? "border-sky-300 bg-sky-50"
            : "border-slate-200 bg-white"
        } ${!checklistDone || !value.placed ? "opacity-80" : ""}`}
      >
        <input
          type="checkbox"
          checked={value.certified}
          disabled={disabled || value.locked || !checklistDone || !value.placed}
          onChange={(e) => {
            const certified = e.target.checked;
            if (!certified) {
              patch({ certified: false });
              return;
            }
            // Re-hash with certification included in the canonical payload.
            void (async () => {
              setBusy(true);
              try {
                const finalized = await finalizeWarehouseSignature(
                  { ...value, certified: true },
                  { action: "Warehouse Signature Updated" },
                );
                onChange(finalized);
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Unable to certify signature.",
                );
              } finally {
                setBusy(false);
              }
            })();
          }}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
        <span className="text-sm leading-snug text-slate-800">
          I certify that the above goods have been physically received and inspected.
        </span>
      </label>

      {!checklistDone && (
        <p className="text-sm text-amber-700">
          Complete the verification checklist to continue.
        </p>
      )}
      {checklistDone && !value.placed && (
        <p className="text-sm text-amber-700">
          Place your warehouse digital signature on the GRN preview.
        </p>
      )}
    </div>
  );
}
