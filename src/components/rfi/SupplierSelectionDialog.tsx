import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";

import { getSuppliers } from "../../api/supplier";
import { RFI_CATEGORIES } from "../../types/rfi";
import type { Supplier } from "../../types/erpnext";
import { useDebounce } from "../../hooks/useDebounce";
import { MASTER_DATA_QUERY_OPTIONS } from "../../api/queryPresets";

export type SelectedSupplier = {
  supplier: string;
  supplier_name: string;
};

type SourcingTypeFilter = "" | "Direct" | "Indirect";
type StatusFilter = "" | "Active" | "Inactive";

interface Props {
  open: boolean;
  onClose: () => void;
  selected: Record<string, SelectedSupplier>;
  onApply: (next: Record<string, SelectedSupplier>) => void;
  /** When set, matching suppliers are pre-highlighted as suggestions. */
  categoryHint?: string;
}

function sourcingType(s: Supplier): string {
  return String(s.custom_sourcing_type || "").trim();
}

function supplierCategory(s: Supplier): string {
  return String(s.custom_supplier_category || s.supplier_group || "").trim();
}

function matchesCategoryHint(s: Supplier, hint: string): boolean {
  if (!hint) return false;
  const h = hint.toLowerCase();
  const cat = supplierCategory(s).toLowerCase();
  const group = String(s.supplier_group || "").toLowerCase();
  const name = String(s.supplier_name || s.name || "").toLowerCase();
  return (
    cat.includes(h) ||
    h.includes(cat) ||
    group.includes(h) ||
    name.includes(h.split(" ")[0] || h)
  );
}

export default function SupplierSelectionDialog({
  open,
  onClose,
  selected,
  onApply,
  categoryHint = "",
}: Props) {
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 250);
  const [sourcing, setSourcing] = useState<SourcingTypeFilter>("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<StatusFilter>("Active");
  const [draft, setDraft] = useState<Record<string, SelectedSupplier>>({});
  const [visibleCount, setVisibleCount] = useState(40);

  const suppliersQuery = useQuery({
    queryKey: ["rfi-supplier-dialog"],
    enabled: open,
    queryFn: async () => {
      const richFields = [
        "name",
        "supplier_name",
        "supplier_group",
        "supplier_type",
        "custom_sourcing_type",
        "custom_supplier_category",
        "email_id",
        "disabled",
        "modified",
      ];
      const safeFields = [
        "name",
        "supplier_name",
        "supplier_group",
        "email_id",
        "disabled",
        "modified",
      ];
      try {
        return await getSuppliers({
          fields: richFields,
          limit_page_length: 500,
          order_by: "supplier_name asc",
        });
      } catch {
        // Custom fields may be unavailable — fall back without breaking the dialog.
        return getSuppliers({
          fields: safeFields,
          limit_page_length: 500,
          order_by: "supplier_name asc",
        });
      }
    },
    ...MASTER_DATA_QUERY_OPTIONS,
  });

  useEffect(() => {
    if (!open) return;
    setDraft(selected);
    setSearch("");
    setSourcing("");
    setCategory(categoryHint || "");
    setStatus("Active");
    setVisibleCount(40);
  }, [open, selected, categoryHint]);

  const suggested = useMemo(() => {
    const all = suppliersQuery.data ?? [];
    if (!categoryHint) return [];
    return all.filter((s) => matchesCategoryHint(s, categoryHint)).slice(0, 12);
  }, [suppliersQuery.data, categoryHint]);

  const filtered = useMemo(() => {
    const all = suppliersQuery.data ?? [];
    const q = debounced.trim().toLowerCase();
    return all.filter((s) => {
      if (status === "Active" && s.disabled === 1) return false;
      if (status === "Inactive" && s.disabled !== 1) return false;
      if (sourcing && sourcingType(s).toLowerCase() !== sourcing.toLowerCase()) {
        return false;
      }
      if (category) {
        const cat = supplierCategory(s).toLowerCase();
        if (!cat.includes(category.toLowerCase())) return false;
      }
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.supplier_name || "").toLowerCase().includes(q) ||
        (s.email_id || "").toLowerCase().includes(q) ||
        supplierCategory(s).toLowerCase().includes(q)
      );
    });
  }, [suppliersQuery.data, debounced, sourcing, category, status]);

  const visible = filtered.slice(0, visibleCount);

  const toggle = (s: Supplier) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (next[s.name]) delete next[s.name];
      else {
        next[s.name] = {
          supplier: s.name,
          supplier_name: s.supplier_name || s.name,
        };
      }
      return next;
    });
  };

  const addSuggested = () => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const s of suggested) {
        next[s.name] = {
          supplier: s.name,
          supplier_name: s.supplier_name || s.name,
        };
      }
      return next;
    });
  };

  if (!open) return null;

  const selectedCount = Object.keys(draft).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rfi-supplier-dialog-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
          <div>
            <h3
              id="rfi-supplier-dialog-title"
              className="text-[16px] font-semibold text-[#0F172A]"
            >
              Add Suppliers
            </h3>
            <p className="mt-0.5 text-[12px] text-[#64748B]">
              Search and select suppliers to invite. Selected rows populate the
              RFI supplier list.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
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
              placeholder="Search supplier name, email, category…"
              className="w-full rounded-lg border border-neutral-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-[11px] font-medium text-neutral-600">
              Supplier Type
              <select
                value={sourcing}
                onChange={(e) =>
                  setSourcing(e.target.value as SourcingTypeFilter)
                }
                className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm"
              >
                <option value="">All</option>
                <option value="Direct">Direct</option>
                <option value="Indirect">Indirect</option>
              </select>
            </label>
            <label className="block text-[11px] font-medium text-neutral-600">
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm"
              >
                <option value="">All</option>
                {Array.from(new Set(RFI_CATEGORIES)).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-medium text-neutral-600">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm"
              >
                <option value="">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>
          </div>

          {categoryHint && suggested.length > 0 ? (
            <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-[#0369A1]">
                  Smart suggestions for “{categoryHint}” ({suggested.length})
                </p>
                <button
                  type="button"
                  onClick={addSuggested}
                  className="text-[11px] font-semibold text-[#0369A1] hover:underline"
                >
                  Add all suggested
                </button>
              </div>
              <p className="mt-1 text-[11px] text-[#0C4A6E]">
                {suggested
                  .map((s) => s.supplier_name || s.name)
                  .slice(0, 6)
                  .join(" · ")}
                {suggested.length > 6 ? "…" : ""}
              </p>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {suppliersQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading suppliers…
            </div>
          ) : visible.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-neutral-500">
              No suppliers match the current filters.
            </div>
          ) : (
            <table className="w-full min-w-[780px] text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-[#E2E8F0] text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2">Supplier Name</th>
                  <th className="px-3 py-2">Supplier Type</th>
                  <th className="px-3 py-2">Categories</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {visible.map((s) => {
                  const checked = !!draft[s.name];
                  const suggestedRow = matchesCategoryHint(s, categoryHint);
                  return (
                    <tr
                      key={s.name}
                      className={`${checked ? "bg-primary-50/40" : ""} ${
                        suggestedRow ? "bg-[#F0F9FF]/40" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(s)}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-neutral-900">
                          {s.supplier_name || s.name}
                        </p>
                        <p className="text-[10px] text-neutral-400">{s.name}</p>
                      </td>
                      <td className="px-3 py-2.5 text-neutral-600">
                        {sourcingType(s) || s.supplier_type || "—"}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-2.5 text-neutral-600">
                        {supplierCategory(s) || "—"}
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2.5 text-neutral-600">
                        {s.email_id || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            s.disabled === 1
                              ? "bg-neutral-100 text-neutral-500"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {s.disabled === 1 ? "Inactive" : "Active"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {visibleCount < filtered.length ? (
            <div className="px-4 py-3 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + 40)}
                className="text-[12px] font-semibold text-primary-700 hover:underline"
              >
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F9] px-5 py-3">
          <p className="text-[12px] text-neutral-500">
            {selectedCount} selected
            {filtered.length ? ` · ${filtered.length} shown after filters` : ""}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(draft);
                onClose();
              }}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Add Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
