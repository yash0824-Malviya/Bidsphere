import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Search } from "lucide-react";
import { getInventorySummary } from "../../services/warehouseService";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";

export default function WarehouseItemMasterPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const itemsQuery = useQuery({
    queryKey: ["warehouse", "inventory"],
    queryFn: getInventorySummary,
    retry: false,
  });

  const handleRetry = () => {
    void itemsQuery.refetch();
  };

  // Extract unique categories for filter dropdown
  const categories = useMemo(() => {
    if (!itemsQuery.data) return [];
    const cats = itemsQuery.data.map((item) => item.category);
    return [...new Set(cats)].filter(Boolean);
  }, [itemsQuery.data]);

  // Filter and Search Logic
  const filteredData = useMemo(() => {
    if (!itemsQuery.data) return [];
    
    return itemsQuery.data.filter((item) => {
      const matchesSearch =
        item.item_name.toLowerCase().includes(search.toLowerCase()) ||
        item.item_code.toLowerCase().includes(search.toLowerCase()) ||
        item.description.toLowerCase().includes(search.toLowerCase());

      const matchesCategory = categoryFilter === "" || item.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [itemsQuery.data, search, categoryFilter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, categoryFilter]);

  // Pagination calculations
  const totalItems = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedData = useMemo(() => {
    return filteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredData, startIndex]);

  if (itemsQuery.isError) {
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load Warehouse data."
            description="We couldn't retrieve the Item Master catalog. Please try again."
            onRetry={handleRetry}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6 animate-in fade-in duration-300">
      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search items by code, name, or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {/* Category Filter */}
        <div className="w-full md:w-56">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table Container */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col min-h-[400px]">
        {itemsQuery.isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={6} columns={6} />
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <EmptyState
              icon={Database}
              title="No Items Found"
              description={
                search || categoryFilter
                  ? "Adjust your filters or search terms to find item definitions."
                  : "No items are defined in the master registry."
              }
            />
          </div>
        ) : (
          <>
            {/* Scrollable table viewport */}
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-4 px-6">Item Code</th>
                    <th className="py-4 px-6">Item Name</th>
                    <th className="py-4 px-6">Category</th>
                    <th className="py-4 px-6">Description</th>
                    <th className="py-4 px-6 text-center">UOM</th>
                    <th className="py-4 px-6 text-right">Reorder Threshold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {paginatedData.map((row) => (
                    <tr
                      key={row.item_code}
                      className="hover:bg-slate-50/75 transition-colors"
                    >
                      <td className="py-4 px-6 font-mono font-semibold text-slate-900">
                        {row.item_code}
                      </td>
                      <td className="py-4 px-6 font-semibold text-slate-800">{row.item_name}</td>
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-xs font-medium border border-slate-200">
                          {row.category}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-slate-500 max-w-sm truncate" title={row.description}>
                        {row.description}
                      </td>
                      <td className="py-4 px-6 text-center text-slate-600">{row.uom}</td>
                      <td className="py-4 px-6 text-right font-medium text-slate-900 tabular-nums">
                        {row.reorder_level} {row.uom}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            {totalPages > 1 && (
              <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Showing <span className="font-semibold text-slate-800">{startIndex + 1}</span> to{" "}
                  <span className="font-semibold text-slate-800">
                    {Math.min(startIndex + itemsPerPage, totalItems)}
                  </span>{" "}
                  of <span className="font-semibold text-slate-800">{totalItems}</span> items
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
