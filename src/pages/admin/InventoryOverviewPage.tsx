import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  Package,
  Search,
  Warehouse,
} from "lucide-react";

import { apiGet, buildResourceUrl, buildListConfig, withSilent } from "../../api/erpnext";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";

interface ItemRow {
  name: string;
  item_name: string;
  item_group?: string;
  stock_uom?: string;
  disabled: number;
}

async function fetchInventoryStats(search?: string) {
  try {
    const filters = search ? [["item_name", "like", `%${search}%`]] : undefined;
    const items = await apiGet<ItemRow[]>(
      buildResourceUrl("Item"),
      {
        ...buildListConfig({
          fields: ["name", "item_name", "item_group", "stock_uom", "disabled"],
          filters: filters as never,
          order_by: "creation desc",
          limit_page_length: 200,
        }),
        ...withSilent(),
      }
    );
    const data = items ?? [];
    const groups: Record<string, number> = {};
    let active = 0;
    for (const i of data) {
      if (!i.disabled) active++;
      const g = i.item_group || "Uncategorized";
      groups[g] = (groups[g] ?? 0) + 1;
    }
    return { items: data, total: data.length, active, disabled: data.length - active, groups };
  } catch {
    return { items: [], total: 0, active: 0, disabled: 0, groups: {} };
  }
}

export default function InventoryOverviewPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-inventory-overview", search],
    queryFn: () => fetchInventoryStats(search || undefined),
    staleTime: 60_000,
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50">
          <Boxes className="h-4 w-4 text-orange-600" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-neutral-900">Inventory Overview</h1>
          <p className="text-[11px] text-neutral-500">Monitor items, stock groups, and material status</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <KpiSmall icon={Package} bg="bg-blue-50" color="text-blue-600" label="Total Items" value={data?.total ?? 0} />
        <KpiSmall icon={Warehouse} bg="bg-emerald-50" color="text-emerald-600" label="Active" value={data?.active ?? 0} />
        <KpiSmall icon={AlertTriangle} bg="bg-red-50" color="text-red-600" label="Disabled" value={data?.disabled ?? 0} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_250px]">
        <div>
          {/* Search */}
          <div className="mb-2 flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput.trim())}
                placeholder="Search items..."
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
          ) : (data?.items ?? []).length === 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white py-12 text-center shadow-sm">
              <Package className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-700">No items found</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
              <div className="max-h-[55vh] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-neutral-50 z-10">
                    <tr className="border-b border-neutral-200">
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Item Code</th>
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Group</th>
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">UOM</th>
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items ?? []).map((item) => (
                      <tr key={item.name} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60">
                        <td className="px-3 py-2 font-mono text-[11px] font-medium text-primary-600">{item.name}</td>
                        <td className="px-3 py-2 font-medium text-neutral-900">{item.item_name}</td>
                        <td className="px-3 py-2 text-neutral-600">{item.item_group ?? "—"}</td>
                        <td className="px-3 py-2 text-neutral-500">{item.stock_uom ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${
                            item.disabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                          }`}>
                            {item.disabled ? "Disabled" : "Active"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-neutral-200 px-3 py-2">
                <p className="text-[11px] text-neutral-500">{data?.total ?? 0} items</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: item groups */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm h-fit">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Item Groups</h3>
          {Object.keys(data?.groups ?? {}).length === 0 ? (
            <p className="text-[11px] text-neutral-500">No data</p>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(data?.groups ?? {})
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

function KpiSmall({ icon: Icon, bg, color, label, value }: { icon: typeof Package; bg: string; color: string; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
    </div>
  );
}
