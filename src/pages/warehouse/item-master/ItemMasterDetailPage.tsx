import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Edit3, Loader2 } from "lucide-react";

import { getItemMaster } from "../../../api/itemMaster";
import {
  ItemLifecycleBadge,
  ProcurementTypeBadge,
} from "../../../components/warehouse/item-master/ItemMasterBadges";
import ReorderStockStatusBadge from "../../../components/warehouse/item-master/ReorderStockStatusBadge";
import { useAuthStore } from "../../../store/authStore";
import { canEditItemMasterFields } from "../../../config/itemMasterPermissions";
import {
  formatReorderLevelDisplay,
  resolveReorderStockStatus,
} from "../../../utils/reorderPlanning";

function DetailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{value || "—"}</dd>
    </div>
  );
}

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function ItemMasterDetailPage() {
  const user = useAuthStore((s) => s.user);
  const canEdit = canEditItemMasterFields(user?.role);
  const { code: routeCode } = useParams();
  const itemCode = routeCode ? decodeURIComponent(routeCode) : "";

  const itemQuery = useQuery({
    queryKey: ["item-master", itemCode],
    queryFn: () => getItemMaster(itemCode),
    enabled: Boolean(itemCode),
  });

  if (itemQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  const item = itemQuery.data;
  if (!item) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        Item not found.{" "}
        <Link to="/warehouse/inventory/items" className="font-semibold underline">
          Back to Item Master
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/warehouse/inventory/items"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Item Master
        </Link>
        {canEdit && (
          <Link
            to={`/warehouse/inventory/items/${encodeURIComponent(item.item_code)}/edit`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Edit3 className="h-4 w-4" />
            Edit Item
          </Link>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-sm font-semibold text-primary-700">
              {item.item_code}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              {item.item_name}
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <ProcurementTypeBadge
                type={item.procurement_type}
                category={item.procurement_category}
                itemGroup={item.item_group}
              />
              {item.procurement_category && (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {item.procurement_category}
                </span>
              )}
              <ItemLifecycleBadge status={item.lifecycle_status} />
            </div>
            {!item.procurement_type && !item.procurement_category && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Procurement Type and Category are Not Assigned.{" "}
                {canEdit ? (
                  <Link
                    to={`/warehouse/inventory/items/${encodeURIComponent(item.item_code)}/edit`}
                    className="font-semibold underline"
                  >
                    Edit this item
                  </Link>
                ) : (
                  "Ask a Warehouse user to assign Direct or Indirect."
                )}
              </p>
            )}
          </div>
          {item.image && (
            <img
              src={item.image}
              alt={item.item_name}
              className="h-24 w-24 rounded-xl border border-slate-200 object-cover"
            />
          )}
        </div>

        {item.description && (
          <p className="mb-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            {item.description}
          </p>
        )}

        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField
            label="Procurement Type"
            value={item.procurement_type || "Not Assigned"}
          />
          <DetailField
            label="Procurement Category"
            value={item.procurement_category || "—"}
          />
          <DetailField
            label="Item Group"
            value={item.item_group?.trim() || "—"}
          />
          <DetailField label="UOM" value={item.stock_uom?.trim() || "—"} />
          <DetailField
            label="Stock Item"
            value={item.is_stock_item ? "Yes" : "No"}
          />
          <DetailField label="Default Warehouse" value={item.default_warehouse} />
          <DetailField label="Warehouse" value={item.warehouse} />
          <DetailField
            label="Current Stock"
            value={`${item.current_stock.toLocaleString()} ${item.stock_uom}`}
          />
          <DetailField
            label="Available Stock"
            value={`${item.available_qty.toLocaleString()} ${item.stock_uom}`}
          />
          <DetailField
            label="Reorder Level"
            value={formatReorderLevelDisplay(item.reorder_level, item.stock_uom)}
          />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Stock Status
            </dt>
            <dd className="mt-1">
              <ReorderStockStatusBadge
                status={resolveReorderStockStatus(
                  item.current_stock,
                  item.reorder_level,
                )}
              />
            </dd>
          </div>
          <DetailField
            label="Minimum Stock"
            value={
              item.min_stock > 0
                ? `${item.min_stock.toLocaleString()} ${item.stock_uom}`
                : "—"
            }
          />
          <DetailField
            label="Maximum Stock"
            value={
              item.max_stock > 0
                ? `${item.max_stock.toLocaleString()} ${item.stock_uom}`
                : "—"
            }
          />
          <DetailField
            label="Unit Cost"
            value={
              item.standard_rate > 0
                ? item.standard_rate.toLocaleString(undefined, {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 2,
                  })
                : "—"
            }
          />
          <DetailField label="Manufacturer" value={item.manufacturer} />
          <DetailField label="Brand" value={item.brand} />
        </dl>

        <div className="mt-8 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Audit Trail
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Created By" value={item.owner} />
            <DetailField label="Created On" value={formatDate(item.creation)} />
            <DetailField label="Last Modified By" value={item.modified_by} />
            <DetailField
              label="Last Modified On"
              value={formatDate(item.modified)}
            />
          </dl>
        </div>
      </div>
    </div>
  );
}
