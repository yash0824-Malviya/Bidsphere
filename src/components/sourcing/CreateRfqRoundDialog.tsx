/**
 * Create Next RFQ Quote Round — reason/remarks, with Step 2 supplier
 * invitation when Reason Code = "New Supplier Added".
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  Loader2,
  Mail,
  Plus,
  Search,
  X,
} from "lucide-react";

import {
  RFQ_ROUND_REASON_CODES,
  type RfqRoundReasonCode,
} from "../../api/rfqQuoteRound";
import {
  canBypassSupplierCategoryFilter,
  fetchRecommendedSuppliers,
  type RecommendedSupplier,
} from "../../api/recommendSuppliers";
import { useDebounce } from "../../hooks/useDebounce";
import { useAuthStore } from "../../store/authStore";
import type { InviteSupplierSelection } from "./RfqInviteSuppliersDialog";

export const NEW_SUPPLIER_ADDED_REASON: RfqRoundReasonCode = "New Supplier Added";

export interface CreateRfqRoundDialogProps {
  open: boolean;
  nextRoundNumber: number;
  creating?: boolean;
  alreadyInvited: Set<string>;
  alreadyInvitedCount: number;
  procurementCategory?: string;
  commodity?: string;
  itemGroups?: string[];
  rfqName?: string;
  validTill?: string;
  onClose: () => void;
  onSubmit: (input: {
    reasonCode: RfqRoundReasonCode;
    remarks: string;
    newSuppliers?: InviteSupplierSelection[];
  }) => void;
}

function norm(id: string): string {
  return id.trim().toLowerCase();
}

function aiMatchStars(pct: number): string {
  const stars = Math.max(1, Math.min(5, Math.round(pct / 20)));
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

export default function CreateRfqRoundDialog({
  open,
  nextRoundNumber,
  creating,
  alreadyInvited,
  alreadyInvitedCount,
  procurementCategory = "",
  commodity = "",
  itemGroups = [],
  rfqName = "",
  validTill = "",
  onClose,
  onSubmit,
}: CreateRfqRoundDialogProps) {
  const user = useAuthStore((s) => s.user);
  const [step, setStep] = useState<1 | 2>(1);
  const [reasonCode, setReasonCode] = useState<RfqRoundReasonCode>(
    "Commercial Revision",
  );
  const [remarks, setRemarks] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 250);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false);
  const [draft, setDraft] = useState<Record<string, InviteSupplierSelection>>(
    {},
  );
  const [showEmailPreview, setShowEmailPreview] = useState(false);

  const canShowAll = canBypassSupplierCategoryFilter(user?.role);
  const needsSupplierStep = reasonCode === NEW_SUPPLIER_ADDED_REASON;

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setReasonCode("Commercial Revision");
    setRemarks("");
    setSearch("");
    setShowAllSuppliers(false);
    setDraft({});
    setShowEmailPreview(false);
  }, [open]);

  const recommendQuery = useQuery({
    queryKey: [
      "rfq-round-create-invite-recommend",
      procurementCategory,
      commodity,
      itemGroups.join("|"),
      debounced,
      showAllSuppliers,
    ],
    enabled: open && step === 2 && needsSupplierStep,
    staleTime: 30_000,
    queryFn: () =>
      fetchRecommendedSuppliers({
        procurement_category: procurementCategory || undefined,
        commodity: commodity || undefined,
        item_groups: itemGroups,
        search: debounced.trim() || undefined,
        show_all: showAllSuppliers,
        limit: 100,
      }),
  });

  const recommended = recommendQuery.data?.recommended ?? [];
  const otherMatching = recommendQuery.data?.other_matching ?? [];
  const totalMatching = recommended.length + otherMatching.length;
  const selectedSuppliers = useMemo(() => Object.values(draft), [draft]);
  const selectedCount = selectedSuppliers.length;

  if (!open) return null;

  const padded = String(nextRoundNumber).padStart(2, "0");
  const remarksValid = remarks.trim().length >= 10;

  const toggle = (row: RecommendedSupplier) => {
    if (alreadyInvited.has(norm(row.name)) || creating) return;
    setDraft((prev) => {
      const next = { ...prev };
      if (next[row.name]) delete next[row.name];
      else {
        next[row.name] = {
          supplier: row.name,
          supplier_name: row.supplier_name || row.name,
        };
      }
      return next;
    });
  };

  const handlePrimary = () => {
    if (!remarksValid || creating) return;
    if (needsSupplierStep && step === 1) {
      setStep(2);
      return;
    }
    if (needsSupplierStep && step === 2) {
      if (selectedCount === 0) return;
      onSubmit({
        reasonCode,
        remarks: remarks.trim(),
        newSuppliers: selectedSuppliers,
      });
      return;
    }
    onSubmit({ reasonCode, remarks: remarks.trim() });
  };

  const dialogWide = step === 2 && needsSupplierStep;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45"
        aria-label="Close"
        onClick={onClose}
        disabled={creating}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-rfq-round-title"
        className={`relative z-10 flex w-full flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl ${
          dialogWide ? "max-h-[92vh] max-w-5xl" : "max-w-lg"
        }`}
      >
        <div className="flex items-start justify-between border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
              {needsSupplierStep
                ? `Step ${step} of 2`
                : "Create Quote Round"}
            </p>
            <h2
              id="create-rfq-round-title"
              className="text-[16px] font-semibold text-[#1E293B]"
            >
              {step === 2 && needsSupplierStep
                ? `Supplier Invitation — Round R${padded}`
                : `Create Quote Round R${padded}`}
            </h2>
            <p className="mt-1 text-[13px] text-[#64748B]">
              {step === 2 && needsSupplierStep
                ? "Select suppliers to invite with this new quote round. Only newly selected suppliers are associated with R"
                    .concat(padded, ".")
                : "Copies items, documents, and terms from the previous round. Supplier quotations are not copied."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-lg p-2 text-[#64748B] hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 1 ? (
          <div className="space-y-4 px-5 py-4">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
                Reason Code *
              </span>
              <select
                value={reasonCode}
                onChange={(e) => {
                  const next = e.target.value as RfqRoundReasonCode;
                  setReasonCode(next);
                  if (next !== NEW_SUPPLIER_ADDED_REASON) setStep(1);
                }}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5 text-[14px] text-[#1E293B] outline-none focus:border-[#1F3A6D] focus:ring-2 focus:ring-[#1F3A6D]/20"
              >
                {RFQ_ROUND_REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
                Remarks *
              </span>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={4}
                placeholder="Explain why this new round is required (minimum 10 characters)…"
                className="w-full resize-y rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5 text-[14px] text-[#1E293B] outline-none focus:border-[#1F3A6D] focus:ring-2 focus:ring-[#1F3A6D]/20"
              />
              {!remarksValid && remarks.length > 0 ? (
                <p className="mt-1 text-[12px] text-amber-700">
                  Please provide at least 10 characters explaining the change.
                </p>
              ) : null}
            </label>

            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-3 text-[12px] text-[#475569]">
              {needsSupplierStep
                ? "Next: choose suppliers to invite with this round, then create the round and send invitations."
                : "After creation you can modify parts, quantities, drawings, attachments, suppliers, and delivery requirements before inviting suppliers."}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="space-y-3 border-b border-[#F1F5F9] px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search supplier…"
                  className="w-full rounded-lg border border-neutral-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#1F3A6D] focus:ring-2 focus:ring-[#1F3A6D]/15"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {canShowAll ? (
                  <label className="flex items-center gap-2 text-[12px] text-neutral-700">
                    <input
                      type="checkbox"
                      checked={showAllSuppliers}
                      onChange={(e) => setShowAllSuppliers(e.target.checked)}
                      className="rounded border-neutral-300"
                    />
                    Show All Suppliers
                  </label>
                ) : (
                  <span />
                )}
                <Link
                  to="/suppliers/new"
                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create New Supplier
                </Link>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
              {recommendQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading suppliers…
                </div>
              ) : recommendQuery.error ? (
                <div className="px-4 py-8 text-center text-sm text-red-700">
                  {recommendQuery.error instanceof Error
                    ? recommendQuery.error.message
                    : "Could not load suppliers."}
                </div>
              ) : totalMatching === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
                  <p className="text-sm font-medium text-neutral-800">
                    No suppliers match the current filters.
                  </p>
                  <Link
                    to="/suppliers/new"
                    className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    <Plus className="h-4 w-4" />
                    Create New Supplier
                  </Link>
                </div>
              ) : (
                <>
                  <SupplierTable
                    title="AI Recommended Suppliers"
                    rows={recommended}
                    alreadyInvited={alreadyInvited}
                    draft={draft}
                    creating={!!creating}
                    onToggle={toggle}
                  />
                  <SupplierTable
                    title="Existing Matching Suppliers"
                    rows={otherMatching}
                    alreadyInvited={alreadyInvited}
                    draft={draft}
                    creating={!!creating}
                    onToggle={toggle}
                  />
                </>
              )}
            </div>

            <div className="space-y-3 border-t border-[#F1F5F9] px-5 py-3">
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                  Selected suppliers ({selectedCount})
                </p>
                {selectedCount === 0 ? (
                  <p className="mt-1 text-[12px] text-[#94A3B8]">
                    Select at least one supplier to continue.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {selectedSuppliers.map((s) => (
                      <li
                        key={s.supplier}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-[#1E293B] ring-1 ring-[#E2E8F0]"
                      >
                        {s.supplier_name}
                        <button
                          type="button"
                          disabled={creating}
                          onClick={() =>
                            setDraft((prev) => {
                              const next = { ...prev };
                              delete next[s.supplier];
                              return next;
                            })
                          }
                          className="text-[#94A3B8] hover:text-[#475569]"
                          aria-label={`Remove ${s.supplier_name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-[#64748B]">
                  Already invited on this RFQ: {alreadyInvitedCount}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowEmailPreview((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#1F3A6D] hover:underline"
              >
                <Mail className="h-3.5 w-3.5" />
                {showEmailPreview ? "Hide email preview" : "Optional email preview"}
              </button>
              {showEmailPreview ? (
                <div className="rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-3 text-[12px] text-[#475569]">
                  <p className="font-semibold text-[#1E293B]">
                    Subject: Invitation to quote — {rfqName || "RFQ"}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                    {`Hello,\n\nYou are invited to submit a quotation for ${
                      rfqName || "this RFQ"
                    } (Quote Round R${padded}).\n\nDeadline: ${
                      validTill || "see RFQ details"
                    }\n\nPlease log in to the supplier portal to review items and submit your quote.\n\n— Procurement`}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex justify-between gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <div>
            {step === 2 ? (
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={creating}
                className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-[13px] font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-[13px] font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                creating ||
                !remarksValid ||
                (step === 2 && needsSupplierStep && selectedCount === 0)
              }
              onClick={handlePrimary}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1F3A6D] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#17315D] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {needsSupplierStep && step === 1
                ? "Next"
                : needsSupplierStep && step === 2
                  ? "Create Round & Send Invitations"
                  : `Create Round R${padded}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SupplierTable({
  title,
  rows,
  alreadyInvited,
  draft,
  creating,
  onToggle,
}: {
  title: string;
  rows: RecommendedSupplier[];
  alreadyInvited: Set<string>;
  draft: Record<string, InviteSupplierSelection>;
  creating: boolean;
  onToggle: (row: RecommendedSupplier) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-4">
      <h4 className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wide text-neutral-600">
        {title}
      </h4>
      <table className="w-full min-w-[880px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-[#E2E8F0] text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            <th className="px-3 py-2">Select</th>
            <th className="px-3 py-2">Supplier Name</th>
            <th className="px-3 py-2">AI Match</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Location</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1F5F9]">
          {rows.map((row) => {
            const invited = alreadyInvited.has(norm(row.name));
            const checked = !!draft[row.name];
            return (
              <tr
                key={row.name}
                onClick={invited ? undefined : () => onToggle(row)}
                className={`transition-colors ${
                  invited
                    ? "cursor-not-allowed bg-neutral-50/90 text-neutral-500 opacity-70"
                    : checked
                      ? "cursor-pointer bg-[#EEF3FA]/70"
                      : "cursor-pointer hover:bg-neutral-50/80"
                }`}
              >
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  {invited ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                      <Check className="h-3.5 w-3.5" />
                      Already Invited
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(row)}
                      disabled={creating}
                      className="h-4 w-4 rounded border-neutral-300 text-[#1F3A6D]"
                    />
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <p className="font-medium text-neutral-900">
                    {row.supplier_name}
                  </p>
                  <p className="text-[10px] text-neutral-400">{row.name}</p>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-amber-500">
                    {aiMatchStars(row.ai_match_pct)}
                  </span>
                  <span className="ml-1 font-semibold text-[#1F3A6D]">
                    {row.ai_match_pct}%
                  </span>
                </td>
                <td className="max-w-[140px] truncate px-3 py-2.5">
                  {row.supplier_group || "—"}
                </td>
                <td className="px-3 py-2.5">{row.country || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
