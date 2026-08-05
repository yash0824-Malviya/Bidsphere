import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plus, Search, X } from "lucide-react";

import {
  canBypassSupplierCategoryFilter,
  fetchRecommendedSuppliers,
  type RecommendedSupplier,
} from "../../api/recommendSuppliers";
import { useDebounce } from "../../hooks/useDebounce";
import { useAuthStore } from "../../store/authStore";

export type InviteSupplierSelection = {
  supplier: string;
  supplier_name: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  alreadyInvited: Set<string>;
  alreadyInvitedCount: number;
  onInvite: (suppliers: InviteSupplierSelection[]) => void;
  inviting?: boolean;
  /** @deprecated Use procurementCategory */
  categoryHint?: string;
  procurementCategory?: string;
  commodity?: string;
  itemGroups?: string[];
}

function norm(id: string): string {
  return id.trim().toLowerCase();
}

function aiMatchStars(pct: number): string {
  const stars = Math.max(1, Math.min(5, Math.round(pct / 20)));
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

function SupplierInviteRow({
  row,
  invited,
  checked,
  inviting,
  onToggle,
}: {
  row: RecommendedSupplier;
  invited: boolean;
  checked: boolean;
  inviting: boolean;
  onToggle: () => void;
}) {
  return (
    <tr
      aria-disabled={invited}
      onClick={invited ? undefined : onToggle}
      className={`transition-colors ${
        invited
          ? "cursor-not-allowed bg-neutral-50/90 text-neutral-500 opacity-70"
          : checked
            ? "cursor-pointer bg-primary-50/50 hover:bg-primary-50/70"
            : "cursor-pointer hover:bg-neutral-50/80"
      }`}
    >
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        {invited ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Already Invited
          </span>
        ) : (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            disabled={inviting}
            aria-label={`Select ${row.supplier_name}`}
            className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          />
        )}
      </td>
      <td className="px-3 py-2.5">
        <p
          className={`font-medium ${
            invited ? "text-neutral-500" : "text-neutral-900"
          }`}
        >
          {row.supplier_name}
        </p>
        <p className="text-[10px] text-neutral-400">{row.name}</p>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-amber-500">{aiMatchStars(row.ai_match_pct)}</span>
        <span className="ml-1 font-semibold text-primary-700">
          {row.ai_match_pct}%
        </span>
      </td>
      <td className="max-w-[140px] truncate px-3 py-2.5">
        {row.supplier_group || "—"}
      </td>
      <td className="px-3 py-2.5">{row.country || "—"}</td>
      <td className="px-3 py-2.5">{row.past_po_count ?? 0}</td>
      <td className="px-3 py-2.5">{row.preferred ? "Yes" : "—"}</td>
    </tr>
  );
}

function SupplierSection({
  title,
  rows,
  alreadyInvited,
  draft,
  inviting,
  onToggle,
}: {
  title: string;
  rows: RecommendedSupplier[];
  alreadyInvited: Set<string>;
  draft: Record<string, InviteSupplierSelection>;
  inviting: boolean;
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
            <th className="px-3 py-2">Past POs</th>
            <th className="px-3 py-2">Preferred</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1F5F9]">
          {rows.map((row) => (
            <SupplierInviteRow
              key={row.name}
              row={row}
              invited={alreadyInvited.has(norm(row.name))}
              checked={!!draft[row.name]}
              inviting={inviting}
              onToggle={() => onToggle(row)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RfqInviteSuppliersDialog({
  open,
  onClose,
  alreadyInvited,
  alreadyInvitedCount,
  onInvite,
  inviting = false,
  categoryHint = "",
  procurementCategory = "",
  commodity = "",
  itemGroups = [],
}: Props) {
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 250);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false);
  const [draft, setDraft] = useState<Record<string, InviteSupplierSelection>>({});

  const resolvedCategory = procurementCategory || categoryHint;
  const canShowAll = canBypassSupplierCategoryFilter(user?.role);

  const recommendQuery = useQuery({
    queryKey: [
      "rfq-invite-recommend",
      resolvedCategory,
      commodity,
      itemGroups.join("|"),
      debounced,
      showAllSuppliers,
    ],
    enabled: open,
    staleTime: 30_000,
    queryFn: () =>
      fetchRecommendedSuppliers({
        procurement_category: resolvedCategory || undefined,
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

  useEffect(() => {
    if (!open) return;
    setDraft({});
    setSearch("");
    setShowAllSuppliers(false);
  }, [open, resolvedCategory]);

  useEffect(() => {
    setDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (alreadyInvited.has(norm(key))) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [alreadyInvited]);

  const selectedSuppliers = useMemo(() => Object.values(draft), [draft]);
  const readyToInvite = selectedSuppliers.length;

  const toggle = (row: RecommendedSupplier) => {
    if (alreadyInvited.has(norm(row.name)) || inviting) return;
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

  const handleInviteClick = () => {
    if (readyToInvite === 0) return;
    onInvite(selectedSuppliers);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rfq-invite-suppliers-title"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
          <div>
            <h3
              id="rfq-invite-suppliers-title"
              className="text-[16px] font-semibold text-[#0F172A]"
            >
              Invite More Suppliers
            </h3>
            <p className="mt-0.5 text-[12px] text-[#64748B]">
              AI-ranked suppliers for{" "}
              {resolvedCategory ? (
                <strong>{resolvedCategory}</strong>
              ) : (
                "this RFQ"
              )}
              . Already invited rows are read-only.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={inviting}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 border-b border-[#F1F5F9] px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search supplier…"
              className="w-full rounded-lg border border-neutral-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>
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
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {recommendQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading AI supplier recommendations…
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
                {resolvedCategory
                  ? "No suppliers are available for this Procurement Category."
                  : "No suppliers match the current filters."}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link
                  to="/suppliers/new"
                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  <Plus className="h-4 w-4" />
                  Add Supplier
                </Link>
                <Link
                  to="/suppliers/onboarding"
                  className="inline-flex items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-800 hover:bg-primary-100"
                >
                  Request Supplier Onboarding
                </Link>
              </div>
            </div>
          ) : (
            <>
              <SupplierSection
                title="AI Recommended Suppliers"
                rows={recommended}
                alreadyInvited={alreadyInvited}
                draft={draft}
                inviting={inviting}
                onToggle={toggle}
              />
              <SupplierSection
                title="Other Matching Suppliers"
                rows={otherMatching}
                alreadyInvited={alreadyInvited}
                draft={draft}
                inviting={inviting}
                onToggle={toggle}
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F9] px-5 py-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-600">
            <span>
              Already Invited:{" "}
              <strong className="font-semibold text-neutral-800">
                {alreadyInvitedCount}
              </strong>
            </span>
            <span>
              Selected:{" "}
              <strong className="font-semibold text-neutral-800">
                {readyToInvite}
              </strong>
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={inviting}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={inviting || readyToInvite === 0}
              onClick={handleInviteClick}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {inviting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Inviting…
                </>
              ) : (
                `Invite Selected (${readyToInvite})`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
