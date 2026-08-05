import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Database, Download, Plus, Search, Upload } from "lucide-react";

import {
  backfillItemProcurementFields,
  listItemMaster,
} from "../../api/itemMaster";
import {
  downloadItemImportTemplate,
  downloadItemMasterExport,
} from "../../api/itemMasterImport";
import { getItemGroups } from "../../api/sourcing";
import { getWarehouses } from "../../api/bom";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";
import {
  ItemLifecycleBadge,
  ProcurementTypeBadge,
} from "../../components/warehouse/item-master/ItemMasterBadges";
import ItemMasterImportDialog from "../../components/warehouse/item-master/ItemMasterImportDialog";
import ReorderStockStatusBadge from "../../components/warehouse/item-master/ReorderStockStatusBadge";
import { useAuthStore } from "../../store/authStore";
import { canEditItemMasterFields } from "../../config/itemMasterPermissions";
import { procurementCategoryFilterOptions } from "../../config/procurementCategory";
import {
  ITEM_LIFECYCLE_STATUSES,
  type ItemLifecycleStatus,
} from "../../types/itemMaster";
import type { MaterialRequestProcurementType } from "../../types/materialRequestWorkflow";
import { MATERIAL_REQUEST_PROCUREMENT_TYPES } from "../../types/materialRequestWorkflow";
import {
  formatReorderLevelDisplay,
  resolveReorderStockStatus,
  shouldHighlightReorderLevel,
} from "../../utils/reorderPlanning";

export default function WarehouseItemMasterPage() {
  const user = useAuthStore((s) => s.user);
  const canEdit = canEditItemMasterFields(user?.role);

  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [procurementType, setProcurementType] = useState<
    MaterialRequestProcurementType | ""
  >("");
  const [procurementCategory, setProcurementCategory] = useState("");
  const [itemGroup, setItemGroup] = useState("");
  const [status, setStatus] = useState<ItemLifecycleStatus | "">("");
  const [warehouse, setWarehouse] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const itemsQuery = useQuery({
    queryKey: [
      "item-master-list",
      procurementType,
      procurementCategory,
      itemGroup,
      status,
      warehouse,
    ],
    queryFn: () =>
      listItemMaster({
        procurementType: procurementType || undefined,
        procurementCategory: procurementCategory || undefined,
        itemGroup: itemGroup || undefined,
        status: status || undefined,
        warehouse: warehouse || undefined,
        limit: 1000,
      }),
    retry: false,
  });

  // One-time ERP backfill for legacy items missing Procurement Type/Category.
  useEffect(() => {
    const key = "bidsphere.item-master.procurement-backfill.v5";
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(key) === "done") return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await backfillItemProcurementFields({ limit: 2000 });
        if (cancelled) return;
        window.localStorage.setItem(key, "done");
        if (result.updated > 0) {
          void itemsQuery.refetch();
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ItemMaster] procurement backfill skipped", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const groupsQuery = useQuery({
    queryKey: ["item-groups"],
    queryFn: () => getItemGroups(),
    staleTime: 5 * 60_000,
  });

  const warehousesQuery = useQuery({
    queryKey: ["item-master-warehouses"],
    queryFn: getWarehouses,
    staleTime: 5 * 60_000,
  });

  // Category filter ← typed master only. Item Group filter ← ERP getItemGroups().
  const categoryOptions = useMemo(
    () => procurementCategoryFilterOptions(procurementType),
    [procurementType],
  );

  const itemGroupOptions = useMemo(() => {
    const groups = groupsQuery.data ?? [];
    return groups
      .map((g) => ({
        value: g.name,
        label: g.item_group_name || g.name,
      }))
      .filter((g) => g.value.trim().length > 0)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [groupsQuery.data]);

  const filteredData = useMemo(() => {
    if (!itemsQuery.data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return itemsQuery.data;
    return itemsQuery.data.filter(
      (item) =>
        item.item_code.toLowerCase().includes(q) ||
        item.item_name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.item_group.toLowerCase().includes(q) ||
        item.procurement_category.toLowerCase().includes(q),
    );
  }, [itemsQuery.data, search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, procurementType, procurementCategory, itemGroup, status, warehouse]);

  // Changing Procurement Type refreshes category options and clears invalid selection.
  useEffect(() => {
    if (
      procurementCategory &&
      !categoryOptions.includes(procurementCategory as never)
    ) {
      setProcurementCategory("");
    }
  }, [procurementCategory, categoryOptions]);

  const totalItems = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedData = filteredData.slice(
    startIndex,
    startIndex + itemsPerPage,
  );

  if (itemsQuery.isError) {
    const err = itemsQuery.error;
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unknown Item Master error";
    // eslint-disable-next-line no-console
    console.error("[ItemMaster] page load error", err);
    if (err instanceof Error && err.stack) {
      // eslint-disable-next-line no-console
      console.error("[ItemMaster] stack", err.stack);
    }

    const isDev = import.meta.env.DEV;
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load Item Master"
            description={
              isDev
                ? message
                : "We couldn't retrieve the item catalog. Check the browser console for details, then try again."
            }
            error={err}
            onRetry={() => void itemsQuery.refetch()}
          />
          {isDev && (
            <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 whitespace-pre-wrap">
              {message}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Item Master</h1>
          <p className="text-sm text-slate-500">
            Single source of truth for procurement items across Material
            Requests and RFQs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadItemMasterExport(filteredData)}
            disabled={filteredData.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Export Excel
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => downloadItemImportTemplate()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                Sample Template
              </button>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Upload className="h-4 w-4" />
                Import Items
              </button>
              <Link
                to="/warehouse/inventory/items/new"
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </Link>
            </>
          )}
        </div>
      </div>

      <ItemMasterImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          void itemsQuery.refetch();
        }}
      />

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search code, name, group, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <select
          value={procurementType}
          onChange={(e) => {
            setProcurementType(
              e.target.value as MaterialRequestProcurementType | "",
            );
            setProcurementCategory("");
          }}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          aria-label="Filter by Procurement Type"
        >
          <option value="">All Types</option>
          {MATERIAL_REQUEST_PROCUREMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={procurementCategory}
          onChange={(e) => setProcurementCategory(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          aria-label="Filter by Procurement Category"
          title="Procurement Category master (not ERP Item Groups)"
        >
          <option value="">All Procurement Categories</option>
          {categoryOptions.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <select
          value={itemGroup}
          onChange={(e) => setItemGroup(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          aria-label="Filter by Item Group"
          title="Item groups only"
        >
          <option value="">All Item Groups</option>
          {itemGroupOptions.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) =>
            setStatus(e.target.value as ItemLifecycleStatus | "")
          }
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          {ITEM_LIFECYCLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={warehouse}
          onChange={(e) => setWarehouse(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm lg:col-span-1"
        >
          <option value="">All Warehouses</option>
          {(warehousesQuery.data ?? []).map((w) => (
            <option key={w.name} value={w.name}>
              {w.warehouse_name || w.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {itemsQuery.isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={8} columns={12} />
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex min-h-[360px] items-center justify-center p-12">
            <EmptyState
              icon={Database}
              title="No Items Found"
              description="Adjust filters or add a new item to the catalog."
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Item Code</th>
                    <th className="px-4 py-3">Item Name</th>
                    <th className="px-4 py-3">Procurement Type</th>
                    <th className="px-4 py-3">Procurement Category</th>
                    <th className="px-4 py-3">Item Group</th>
                    <th className="px-4 py-3">UOM</th>
                    <th className="px-4 py-3">Warehouse</th>
                    <th className="px-4 py-3 text-right">Current Stock</th>
                    <th className="px-4 py-3 text-right">Available Qty</th>
                    <th className="px-4 py-3 text-right">Reorder Level</th>
                    <th className="px-4 py-3">Stock Status</th>
                    <th className="px-4 py-3">Lifecycle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {paginatedData.map((row) => {
                    const stockStatus = resolveReorderStockStatus(
                      row.current_stock,
                      row.reorder_level,
                    );
                    const highlightReorder = shouldHighlightReorderLevel(
                      row.current_stock,
                      row.reorder_level,
                    );
                    return (
                    <tr
                      key={row.item_code}
                      className="transition-colors hover:bg-slate-50/75"
                    >
                      <td className="px-4 py-3 font-mono font-semibold">
                        <Link
                          to={`/warehouse/inventory/items/${encodeURIComponent(row.item_code)}`}
                          className="text-primary-700 hover:underline"
                        >
                          {row.item_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {row.item_name}
                      </td>
                      <td className="px-4 py-3">
                        <ProcurementTypeBadge
                          type={row.procurement_type}
                          category={row.procurement_category}
                          itemGroup={row.item_group}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {row.procurement_category || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.item_group?.trim() || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.stock_uom || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.warehouse || row.default_warehouse || "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                        {row.current_stock.toLocaleString()} {row.stock_uom}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                        {row.available_qty.toLocaleString()} {row.stock_uom}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          highlightReorder
                            ? "bg-amber-50 font-semibold text-amber-900"
                            : "text-slate-800"
                        }`}
                      >
                        {formatReorderLevelDisplay(
                          row.reorder_level,
                          row.stock_uom,
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ReorderStockStatusBadge status={stockStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <ItemLifecycleBadge status={row.lifecycle_status} />
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-xs text-slate-500">
                  Showing {startIndex + 1}–
                  {Math.min(startIndex + itemsPerPage, totalItems)} of {totalItems}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
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
