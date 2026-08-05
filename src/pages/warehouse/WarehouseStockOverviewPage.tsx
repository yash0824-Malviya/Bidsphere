import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Database } from "lucide-react";
import { useDebounce } from "../../hooks/useDebounce";
import {
  fetchWarehouseNames,
  fetchWarehouseStockSummary,
  WAREHOUSE_NAMES_QUERY_KEY,
  WAREHOUSE_STOCK_PAGE_SIZE,
  WAREHOUSE_STOCK_QUERY_KEY,
  WAREHOUSE_STOCK_STALE_MS,
  type WarehouseStockStatus,
} from "../../api/warehouseStock";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";
import ReorderStockStatusBadge from "../../components/warehouse/item-master/ReorderStockStatusBadge";
import {
  formatReorderLevelDisplay,
  shouldHighlightReorderLevel,
} from "../../utils/reorderPlanning";

export default function WarehouseStockOverviewPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<WarehouseStockStatus | "">("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const debouncedSearch = useDebounce(search, 250);

  const warehouseNamesQuery = useQuery({
    queryKey: WAREHOUSE_NAMES_QUERY_KEY,
    queryFn: fetchWarehouseNames,
    staleTime: WAREHOUSE_STOCK_STALE_MS,
    retry: 1,
  });

  const stockQuery = useQuery({
    queryKey: [...WAREHOUSE_STOCK_QUERY_KEY, warehouseFilter],
    queryFn: () =>
      fetchWarehouseStockSummary({
        warehouse: warehouseFilter,
      }),
    staleTime: WAREHOUSE_STOCK_STALE_MS,
    retry: 1,
  });

  const filteredData = useMemo(() => {
    if (!stockQuery.data) return [];
    const searchLower = debouncedSearch.trim().toLowerCase();
    return stockQuery.data.rows.filter((row) => {
      const matchesSearch =
        !searchLower ||
        row.item_name.toLowerCase().includes(searchLower) ||
        row.item_code.toLowerCase().includes(searchLower) ||
        row.description.toLowerCase().includes(searchLower);
      const matchesStatus = !statusFilter || row.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [stockQuery.data, debouncedSearch, statusFilter]);

  const kpis = useMemo(() => {
    if (!stockQuery.data) {
      return { totalQty: 0, lowStock: 0, outOfStock: 0, grnsLast30Days: 0 };
    }
    const fromFiltered = {
      totalQty: filteredData.reduce(
        (acc, row) => acc + Math.max(0, Number(row.available_qty) || 0),
        0,
      ),
      lowStock: filteredData.filter(
        (row) => row.status === "Reorder Required",
      ).length,
      outOfStock: filteredData.filter((row) => row.status === "Out of Stock")
        .length,
    };
    return {
      ...fromFiltered,
      grnsLast30Days: stockQuery.data.kpis.grnsLast30Days,
    };
  }, [stockQuery.data, filteredData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, statusFilter, warehouseFilter]);

  const totalItems = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / WAREHOUSE_STOCK_PAGE_SIZE));
  const startIndex = (currentPage - 1) * WAREHOUSE_STOCK_PAGE_SIZE;
  const paginatedData = useMemo(
    () => filteredData.slice(startIndex, startIndex + WAREHOUSE_STOCK_PAGE_SIZE),
    [filteredData, startIndex]
  );

  const warehouses = warehouseNamesQuery.data ?? [];

  if (stockQuery.isError) {
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load stock data."
            description="We couldn't retrieve inventory. Check your connection and try again."
            onRetry={() => void stockQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6 animate-in fade-in duration-300">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Total Available Qty
          </p>
          <div className="mt-2 flex items-baseline justify-between">
            {stockQuery.isLoading ? (
              <div className="h-8 w-20 animate-pulse rounded bg-slate-100" />
            ) : (
              <span className="text-2xl font-bold text-slate-900 tabular-nums">
                {kpis.totalQty.toLocaleString()}
              </span>
            )}
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              Units
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Reorder Required
          </p>
          <div className="mt-2 flex items-baseline justify-between">
            {stockQuery.isLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-slate-100" />
            ) : (
              <span className="text-2xl font-bold text-slate-900 tabular-nums">
                {kpis.lowStock}
              </span>
            )}
            {kpis.lowStock > 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 border border-amber-100">
                Action Required
              </span>
            ) : (
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">
                Optimal
              </span>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Out of Stock Items
          </p>
          <div className="mt-2 flex items-baseline justify-between">
            {stockQuery.isLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-slate-100" />
            ) : (
              <span className="text-2xl font-bold text-slate-900 tabular-nums">
                {kpis.outOfStock}
              </span>
            )}
            {kpis.outOfStock > 0 ? (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-100">
                Critical Shortage
              </span>
            ) : (
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">
                None
              </span>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            GRNs Posted (30d)
          </p>
          <div className="mt-2 flex items-baseline justify-between">
            {stockQuery.isLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-slate-100" />
            ) : (
              <span className="text-2xl font-bold text-slate-900 tabular-nums">
                {kpis.grnsLast30Days}
              </span>
            )}
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
              Receipts
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search items by code, name, or specifications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div className="w-full md:w-48">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as WarehouseStockStatus | "")}
            className="w-full rounded-lg border border-slate-200 py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Items</option>
            <option value="In Stock">In Stock</option>
            <option value="Reorder Required">Reorder Required</option>
            <option value="Out of Stock">Out of Stock</option>
          </select>
        </div>

        <div className="w-full md:w-48">
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Warehouses</option>
            {warehouses.map((wh) => (
              <option key={wh} value={wh}>
                {wh}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col min-h-[400px]">
        {stockQuery.isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={6} columns={7} />
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <EmptyState
              icon={Database}
              title="No stock data available"
              description={
                search || statusFilter || warehouseFilter
                  ? "Adjust your filters or search terms to find records."
                  : "No warehouse stock records were returned. Stock will appear here once items are received into inventory."
              }
            />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-4 px-6">Item</th>
                    <th className="py-4 px-6">Warehouse</th>
                    <th className="py-4 px-6 text-right">Current Stock</th>
                    <th className="py-4 px-6 text-right">Available Qty</th>
                    <th className="py-4 px-6 text-right">Reserved Qty</th>
                    <th className="py-4 px-6 text-right">Reorder Level</th>
                    <th className="py-4 px-6 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {paginatedData.map((row) => (
                    <tr
                      key={`${row.item_code}-${row.warehouse}`}
                      className="hover:bg-slate-50/75 transition-colors"
                    >
                      <td className="py-4 px-6">
                        <div>
                          <p className="font-semibold text-slate-900">{row.item_name}</p>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{row.item_code}</p>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-slate-600">{row.warehouse}</td>
                      <td className="py-4 px-6 text-right text-slate-600 tabular-nums">
                        {Math.max(0, row.current_stock).toLocaleString()} {row.uom}
                      </td>
                      <td className="py-4 px-6 text-right font-medium text-slate-900 tabular-nums">
                        {Math.max(0, row.available_qty).toLocaleString()} {row.uom}
                      </td>
                      <td className="py-4 px-6 text-right text-slate-500 tabular-nums">
                        {Math.max(0, row.reserved_qty).toLocaleString()} {row.uom}
                      </td>
                      <td
                        className={`py-4 px-6 text-right tabular-nums ${
                          shouldHighlightReorderLevel(
                            row.current_stock,
                            row.reorder_level,
                          )
                            ? "bg-amber-50 font-semibold text-amber-900"
                            : "text-slate-500"
                        }`}
                      >
                        {formatReorderLevelDisplay(row.reorder_level, row.uom)}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <ReorderStockStatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Showing <span className="font-semibold text-slate-800">{startIndex + 1}</span> to{" "}
                  <span className="font-semibold text-slate-800">
                    {Math.min(startIndex + WAREHOUSE_STOCK_PAGE_SIZE, totalItems)}
                  </span>{" "}
                  of <span className="font-semibold text-slate-800">{totalItems}</span> records
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    Previous
                  </button>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
