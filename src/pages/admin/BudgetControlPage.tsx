import { useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { apiGet, buildResourceUrl, buildListConfig, withSilent } from "../../api/erpnext";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatCurrencyCompact } from "../../utils/format";

interface BudgetStats {
  totalCommitted: number;
  totalBilled: number;
  totalPaid: number;
  poCount: number;
  topSuppliers: Array<{ supplier: string; total: number }>;
}

async function fetchBudgetStats(): Promise<BudgetStats> {
  try {
    const pos = await apiGet<Array<{ supplier: string; grand_total: number; per_billed: number }>>(
      buildResourceUrl("Purchase Order"),
      {
        ...buildListConfig({
          fields: ["supplier", "grand_total", "per_billed"],
          filters: [["docstatus", "=", "1"]],
          limit_page_length: 0,
        }),
        ...withSilent(),
      }
    );
    const data = pos ?? [];
    const totalCommitted = data.reduce((s, p) => s + (p.grand_total ?? 0), 0);
    const totalBilled = data.reduce((s, p) => s + (p.grand_total ?? 0) * ((p.per_billed ?? 0) / 100), 0);

    const supplierTotals: Record<string, number> = {};
    for (const p of data) {
      const s = p.supplier || "Unknown";
      supplierTotals[s] = (supplierTotals[s] ?? 0) + (p.grand_total ?? 0);
    }
    const topSuppliers = Object.entries(supplierTotals)
      .map(([supplier, total]) => ({ supplier, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    return { totalCommitted, totalBilled, totalPaid: 0, poCount: data.length, topSuppliers };
  } catch {
    return { totalCommitted: 0, totalBilled: 0, totalPaid: 0, poCount: 0, topSuppliers: [] };
  }
}

export default function BudgetControlPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-budget-control"],
    queryFn: fetchBudgetStats,
    staleTime: 60_000,
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50">
          <Wallet className="h-4 w-4 text-green-600" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-neutral-900">Budget Control</h1>
          <p className="text-[11px] text-neutral-500">Monitor spend commitments, billing, and supplier distribution</p>
        </div>
      </div>

      {/* KPIs */}
      {isLoading ? (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[80px] rounded-lg" />)}
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <BudgetKpi icon={DollarSign} bg="bg-emerald-50" color="text-emerald-600" label="Total Committed" value={formatCurrencyCompact(data?.totalCommitted ?? 0)} />
          <BudgetKpi icon={TrendingUp} bg="bg-blue-50" color="text-blue-600" label="Total Billed" value={formatCurrencyCompact(data?.totalBilled ?? 0)} />
          <BudgetKpi icon={TrendingDown} bg="bg-amber-50" color="text-amber-600" label="Outstanding" value={formatCurrencyCompact((data?.totalCommitted ?? 0) - (data?.totalBilled ?? 0))} />
          <BudgetKpi icon={Wallet} bg="bg-violet-50" color="text-violet-600" label="Submitted POs" value={String(data?.poCount ?? 0)} />
        </div>
      )}

      {/* Top Suppliers by Spend */}
      <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 px-3 py-2.5">
          <h3 className="text-xs font-bold text-neutral-900">Top Suppliers by Spend</h3>
        </div>
        {isLoading ? (
          <div className="p-3 space-y-1">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 rounded" />)}</div>
        ) : (data?.topSuppliers ?? []).length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-500">No spend data available</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {(data?.topSuppliers ?? []).map((s, idx) => {
              const maxVal = data?.topSuppliers[0]?.total ?? 1;
              const pct = Math.round((s.total / maxVal) * 100);
              return (
                <div key={s.supplier} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-5 text-right text-[10px] font-bold text-neutral-400">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-neutral-900 truncate">{s.supplier}</p>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-neutral-100">
                      <div
                        className="h-1.5 rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-neutral-900">{formatCurrencyCompact(s.total)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function BudgetKpi({ icon: Icon, bg, color, label, value }: { icon: typeof DollarSign; bg: string; color: string; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <p className="text-lg font-bold tabular-nums text-neutral-900">{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
    </div>
  );
}
