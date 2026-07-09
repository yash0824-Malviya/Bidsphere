import { useLayoutEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Globe,
  Search,
  Truck,
  XCircle,
} from "lucide-react";

import { apiGet, buildResourceUrl, withSilent } from "../../api/erpnext";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { SUPPLIER_CATEGORIES, isSupplierCategory } from "../../config/supplierCategories";

interface SupplierRow {
  name: string;
  supplier_name: string;
  supplier_group?: string;
  country?: string;
  disabled: number;
}

type CategoryCounts = Record<(typeof SUPPLIER_CATEGORIES)[number], number>;

function emptyCategoryCounts(): CategoryCounts {
  return Object.fromEntries(SUPPLIER_CATEGORIES.map((c) => [c, 0])) as CategoryCounts;
}

async function fetchSuppliers(search?: string): Promise<{ suppliers: SupplierRow[] }> {
  try {
    const term = (search ?? "").trim();
    const fields = ["name", "supplier_name", "supplier_group", "country", "disabled"];
    const baseParams = {
      fields: JSON.stringify(fields),
      order_by: "creation desc",
      limit_page_length: 500,
    } as Record<string, string | number>;

    if (term) {
      const like = `%${term}%`;
      // Multi-field search: Supplier Name, Supplier Code, Category, Country.
      // Frappe supports `or_filters` as a JSON list of filter tuples.
      baseParams.or_filters = JSON.stringify([
        ["supplier_name", "like", like],
        ["name", "like", like],
        ["supplier_group", "like", like],
        ["country", "like", like],
      ]);
    }

    const rows = await apiGet<SupplierRow[]>(
      buildResourceUrl("Supplier"),
      {
        params: baseParams,
        ...withSilent(),
      }
    );
    return { suppliers: rows ?? [] };
  } catch {
    return { suppliers: [] };
  }
}

export default function SupplierOverviewPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [category, setCategory] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-supplier-overview", search],
    queryFn: () => fetchSuppliers(search || undefined),
    staleTime: 60_000,
  });

  const suppliers = data?.suppliers ?? [];

  const categoryCounts = useMemo(() => {
    const counts = emptyCategoryCounts();
    for (const s of suppliers) {
      if (!isSupplierCategory(s.supplier_group)) continue;
      counts[s.supplier_group] += 1;
    }
    return counts;
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    if (!category) return suppliers;
    return suppliers.filter((s) => s.supplier_group === category);
  }, [suppliers, category]);

  const kpis = useMemo(() => {
    let active = 0;
    let disabled = 0;
    for (const s of filteredSuppliers) {
      if (s.disabled) disabled += 1;
      else active += 1;
    }
    return { total: filteredSuppliers.length, active, disabled };
  }, [filteredSuppliers]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
          <Truck className="h-4 w-4 text-violet-600" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-neutral-900">Supplier Management</h1>
          <p className="text-[11px] text-neutral-500">Monitor supplier base and compliance</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <MiniKpi label="Total Suppliers" value={kpis.total} color="text-violet-600" bg="bg-violet-50" />
        <MiniKpi label="Active" value={kpis.active} color="text-emerald-600" bg="bg-emerald-50" />
        <MiniKpi label="Disabled" value={kpis.disabled} color="text-red-600" bg="bg-red-50" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_250px]">
        {/* Left: supplier list */}
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput.trim())}
                placeholder="Search by supplier, code, category, or country..."
                className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-800 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
            >
              <option value="">All categories</option>
              {SUPPLIER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSearch(searchInput.trim())}
              className="rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700 cursor-pointer border-none"
            >
              Search
            </button>
          </div>

          {isLoading ? (
            <div className="space-y-1">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
          ) : filteredSuppliers.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white py-12 text-center shadow-sm">
              <Truck className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-700">No suppliers found</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50">
                  <tr className="border-b border-neutral-200">
                    <th className="px-3 py-2 text-left font-semibold text-neutral-500">Supplier</th>
                    <th className="px-3 py-2 text-left font-semibold text-neutral-500">Category</th>
                    <th className="px-3 py-2 text-left font-semibold text-neutral-500">Country</th>
                    <th className="px-3 py-2 text-left font-semibold text-neutral-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((s) => (
                    <tr key={s.name} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 transition-colors">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded bg-neutral-100 text-[10px] font-bold text-neutral-600">
                            {(s.supplier_name || s.name).charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-neutral-900">{s.supplier_name || s.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-neutral-600">{s.supplier_group || "—"}</td>
                      <td className="px-3 py-2">
                        {s.country ? (
                          <span className="inline-flex items-center gap-1 text-neutral-600">
                            <Globe className="h-3 w-3 text-neutral-400" />{s.country}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {!s.disabled ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-px text-[10px] font-semibold text-red-700">
                            <XCircle className="h-2.5 w-2.5" /> Disabled
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-neutral-200 px-3 py-2">
                <p className="text-[11px] text-neutral-500">{filteredSuppliers.length} suppliers</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: breakdown */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
          <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            <Building2 className="h-3 w-3" /> By Category
          </h3>
          <div className="space-y-1.5">
            {SUPPLIER_CATEGORIES.map((c) => {
              const count = categoryCounts[c] ?? 0;
              const active = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory((prev) => (prev === c ? "" : c))}
                  className={`flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-xs transition-colors ${
                    active ? "bg-primary-50 text-primary-700" : "hover:bg-neutral-50 text-neutral-700"
                  }`}
                >
                  <span className="truncate">{c}</span>
                  <span className={`rounded px-1.5 py-px text-[10px] font-semibold tabular-nums ${
                    active ? "bg-primary-100 text-primary-700" : "bg-neutral-100 text-neutral-600"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniKpi({ label, value, color, bg: _bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
    </div>
  );
}
