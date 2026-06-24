import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Globe,
  Search,
  Truck,
  XCircle,
} from "lucide-react";

import { apiGet, buildResourceUrl, buildListConfig, withSilent } from "../../api/erpnext";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";

interface SupplierRow {
  name: string;
  supplier_name: string;
  supplier_group?: string;
  country?: string;
  disabled: number;
}

async function fetchSuppliers(search?: string): Promise<{ suppliers: SupplierRow[]; total: number; active: number; disabled: number; groups: Record<string, number> }> {
  try {
    const filters = search ? [["supplier_name", "like", `%${search}%`]] : undefined;
    const rows = await apiGet<SupplierRow[]>(
      buildResourceUrl("Supplier"),
      {
        ...buildListConfig({
          fields: ["name", "supplier_name", "supplier_group", "country", "disabled"],
          filters: filters as never,
          order_by: "creation desc",
          limit_page_length: 200,
        }),
        ...withSilent(),
      }
    );
    const data = rows ?? [];
    const groups: Record<string, number> = {};
    let active = 0;
    let disabled = 0;
    for (const s of data) {
      if (s.disabled) disabled++;
      else active++;
      const g = s.supplier_group || "Uncategorized";
      groups[g] = (groups[g] ?? 0) + 1;
    }
    return { suppliers: data, total: data.length, active, disabled, groups };
  } catch {
    return { suppliers: [], total: 0, active: 0, disabled: 0, groups: {} };
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

  const { data, isLoading } = useQuery({
    queryKey: ["admin-supplier-overview", search],
    queryFn: () => fetchSuppliers(search || undefined),
    staleTime: 60_000,
  });

  const groups = data?.groups ?? {};

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
        <MiniKpi label="Total Suppliers" value={data?.total ?? 0} color="text-violet-600" bg="bg-violet-50" />
        <MiniKpi label="Active" value={data?.active ?? 0} color="text-emerald-600" bg="bg-emerald-50" />
        <MiniKpi label="Disabled" value={data?.disabled ?? 0} color="text-red-600" bg="bg-red-50" />
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
                placeholder="Search suppliers..."
                className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
              />
            </div>
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
          ) : (data?.suppliers ?? []).length === 0 ? (
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
                    <th className="px-3 py-2 text-left font-semibold text-neutral-500">Group</th>
                    <th className="px-3 py-2 text-left font-semibold text-neutral-500">Country</th>
                    <th className="px-3 py-2 text-left font-semibold text-neutral-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.suppliers ?? []).map((s) => (
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
                <p className="text-[11px] text-neutral-500">{data?.total ?? 0} suppliers</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: breakdown */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
          <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            <Building2 className="h-3 w-3" /> By Group
          </h3>
          {Object.keys(groups).length === 0 ? (
            <p className="text-[11px] text-neutral-500">No data</p>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(groups)
                .sort((a, b) => b[1] - a[1])
                .map(([group, count]) => (
                  <div key={group} className="flex items-center justify-between text-xs">
                    <span className="text-neutral-700 truncate">{group}</span>
                    <span className="rounded bg-neutral-100 px-1.5 py-px text-[10px] font-semibold text-neutral-600 tabular-nums">{count}</span>
                  </div>
                ))}
            </div>
          )}
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
