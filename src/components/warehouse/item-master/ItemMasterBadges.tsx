import type { MaterialRequestProcurementType } from "../../../types/materialRequestWorkflow";
import type { ItemLifecycleStatus } from "../../../types/itemMaster";
import {
  isProcurementNotAssigned,
  resolveItemProcurement,
} from "../../../utils/itemProcurementInfer";

const procurementTypeStyles: Record<
  MaterialRequestProcurementType | "Not Assigned",
  string
> = {
  Direct: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Indirect: "bg-amber-50 text-amber-900 border-amber-200",
  "Not Assigned": "bg-slate-100 text-slate-600 border-slate-300",
};

const lifecycleStyles: Record<ItemLifecycleStatus, string> = {
  Active: "bg-green-50 text-green-800 border-green-200",
  Inactive: "bg-slate-100 text-slate-600 border-slate-200",
  Obsolete: "bg-rose-50 text-rose-800 border-rose-200",
};

function Badge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

/**
 * Resolve badge label from ERP Item procurement fields.
 * "Not Assigned" only when BOTH type and category are missing (after inference).
 */
export function resolveProcurementTypeLabel(input: {
  procurement_type?: MaterialRequestProcurementType | "" | null;
  procurement_category?: string | null;
  item_group?: string | null;
}): MaterialRequestProcurementType | "Not Assigned" {
  if (isProcurementNotAssigned(input)) return "Not Assigned";
  const resolved = resolveItemProcurement(input);
  if (resolved.procurement_type) return resolved.procurement_type;
  return "Not Assigned";
}

/**
 * Procurement Type badge for Item Master.
 * Direct (green) · Indirect (amber) · Not Assigned (neutral) — never "Unclassified".
 */
export function ProcurementTypeBadge({
  type,
  category,
  itemGroup,
}: {
  type: MaterialRequestProcurementType | "" | undefined;
  category?: string | null;
  itemGroup?: string | null;
}) {
  const label = resolveProcurementTypeLabel({
    procurement_type: type,
    procurement_category: category,
    item_group: itemGroup,
  });
  return <Badge label={label} className={procurementTypeStyles[label]} />;
}

export function ItemLifecycleBadge({
  status,
}: {
  status: ItemLifecycleStatus | string | undefined;
}) {
  const normalized =
    status === "Inactive" || status === "Obsolete" ? status : "Active";
  return (
    <Badge label={normalized} className={lifecycleStyles[normalized]} />
  );
}
