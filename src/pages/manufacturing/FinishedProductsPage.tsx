import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Factory, Loader2, Search, Star } from "lucide-react";

import { getFinishedProductsOverview } from "../../api/bom";
import { useAuthStore } from "../../store/authStore";
import { canManageBom } from "../../config/roles";

export default function FinishedProductsPage() {
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["manufacturing-finished-products"],
    queryFn: getFinishedProductsOverview,
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const all = query.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (p) =>
        p.item_code.toLowerCase().includes(term) ||
        p.item_name.toLowerCase().includes(term),
    );
  }, [query.data, search]);

  if (!canManageBom(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
          <Factory className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-base font-bold text-neutral-900">Finished Products</h1>
          <p className="text-xs text-neutral-500">
            Items that have at least one Bill of Materials in ERPNext.
          </p>
        </div>
      </header>

      <section className="card p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search finished products…"
            className="h-10 w-full rounded-lg border border-neutral-300 bg-white pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-center">BOMs</th>
                <th className="px-4 py-3">Has Default</th>
                <th className="px-4 py-3">Has Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {query.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-neutral-400" />
                  </td>
                </tr>
              ) : query.isError ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-danger-600">
                    Couldn&apos;t load finished products from ERPNext.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-14 text-center">
                    <Factory className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
                    <p className="text-sm font-semibold text-neutral-700">
                      No finished products found
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      Create a BOM to register a manufacturable finished product.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr
                    key={p.item_code}
                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{p.item_name}</div>
                      <div className="text-xs text-neutral-500">{p.item_code}</div>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-neutral-700">
                      {p.bomCount}
                    </td>
                    <td className="px-4 py-3">
                      {p.hasDefault ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-amber-400" /> Yes
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.hasActive ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Yes
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/manufacturing/boms?search=${encodeURIComponent(p.item_code)}`}
                        className="text-xs font-semibold text-primary-600 no-underline hover:text-primary-700"
                      >
                        View BOMs
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
