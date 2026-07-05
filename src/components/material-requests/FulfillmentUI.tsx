/**
 * Small presentational building blocks shared by the Department and Warehouse
 * Material Request screens: quantity chips, an issued-vs-pending progress bar,
 * and the colored per-item fulfillment badge.
 */

import {
  itemStatusClasses,
  type ItemFulfillmentStatus,
} from "../../utils/materialRequestFulfillment";

type ChipTone = "neutral" | "issued" | "remaining" | "procurement" | "requested";

const CHIP_TONES: Record<ChipTone, string> = {
  requested: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  issued: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  remaining: "bg-orange-50 text-orange-700 ring-orange-200",
  procurement: "bg-blue-50 text-blue-700 ring-blue-200",
};

/** A labelled quantity chip, e.g. `Issued 25`. */
export function QtyChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: ChipTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${CHIP_TONES[tone]}`}
    >
      <span className="font-medium opacity-70">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

/** Colored badge for a per-item fulfillment status. */
export function ItemStatusBadge({ status }: { status: ItemFulfillmentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${itemStatusClasses(status)}`}
    >
      {status}
    </span>
  );
}

/**
 * Issued-vs-pending progress bar. `issued` fills green, any `procurement`
 * portion fills blue, the remainder stays gray.
 */
export function FulfillmentBar({
  requested,
  issued,
  procurement = 0,
  className = "",
}: {
  requested: number;
  issued: number;
  procurement?: number;
  className?: string;
}) {
  const total = requested > 0 ? requested : 1;
  const issuedPct = Math.min(100, Math.round((issued / total) * 100));
  const procPct = Math.min(100 - issuedPct, Math.round((procurement / total) * 100));

  return (
    <div
      className={`flex h-2 w-full overflow-hidden rounded-full bg-neutral-100 ${className}`}
      title={`Issued ${issued} of ${requested}`}
    >
      <div
        className="h-full bg-emerald-500 transition-all"
        style={{ width: `${issuedPct}%` }}
      />
      <div
        className="h-full bg-blue-400 transition-all"
        style={{ width: `${procPct}%` }}
      />
    </div>
  );
}
