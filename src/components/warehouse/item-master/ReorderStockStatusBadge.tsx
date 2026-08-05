import type { WarehouseReorderStockStatus } from "../../../utils/reorderPlanning";

const STYLES: Record<WarehouseReorderStockStatus, string> = {
  "In Stock": "bg-emerald-50 text-emerald-800 border-emerald-200",
  "Reorder Required": "bg-amber-50 text-amber-800 border-amber-200",
  "Out of Stock": "bg-rose-50 text-rose-800 border-rose-200",
};

interface Props {
  status: WarehouseReorderStockStatus;
  className?: string;
}

/** In Stock (green) · Reorder Required (orange) · Out of Stock (red). */
export default function ReorderStockStatusBadge({ status, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STYLES[status]} ${className}`}
    >
      {status}
    </span>
  );
}
