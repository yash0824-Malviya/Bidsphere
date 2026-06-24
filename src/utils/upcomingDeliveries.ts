/**
 * Incoming Purchase Order → "Upcoming Deliveries" logic.
 *
 * Shared by the GRN list page (Upcoming Deliveries section), the warehouse
 * dashboard receiving KPIs, and the warehouse notification center so the
 * urgency rules stay consistent across the whole application.
 */
import { differenceInCalendarDays } from "date-fns";

export type DeliveryUrgency =
  | "overdue"
  | "due-today"
  | "due-tomorrow"
  | "upcoming";

/** Raw open Purchase Order shape used for receiving views. */
export interface IncomingPORow {
  name: string;
  supplier?: string;
  supplier_name?: string;
  /** Expected delivery date (PO header `schedule_date`). */
  schedule_date?: string;
  grand_total?: number;
  currency?: string;
  status?: string;
  per_received?: number;
  transaction_date?: string;
}

export interface UpcomingDelivery extends IncomingPORow {
  /** Calendar days until expected delivery; negative = overdue, null = no date. */
  daysRemaining: number | null;
  urgency: DeliveryUrgency;
}

export interface DeliveryUrgencyMeta {
  label: string;
  /** Tailwind classes for a pill/badge (background + text + ring). */
  badgeClass: string;
  /** Tone token reused by the notification center. */
  tone: "danger" | "warning" | "info" | "neutral";
}

/** Status colour rules: Overdue=Red, Due Today=Orange, Due Tomorrow=Blue, Upcoming=Gray. */
export const DELIVERY_URGENCY_META: Record<DeliveryUrgency, DeliveryUrgencyMeta> =
  {
    overdue: {
      label: "Overdue",
      badgeClass: "bg-danger-50 text-danger-700 ring-1 ring-danger-200",
      tone: "danger",
    },
    "due-today": {
      label: "Due Today",
      badgeClass: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
      tone: "warning",
    },
    "due-tomorrow": {
      label: "Due Tomorrow",
      badgeClass: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
      tone: "info",
    },
    upcoming: {
      label: "Upcoming",
      badgeClass: "bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200",
      tone: "neutral",
    },
  };

/** Calendar days from today until `dateStr` (future positive). null when absent/invalid. */
export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const normalized = dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr;
  const target = new Date(normalized);
  if (Number.isNaN(target.getTime())) return null;
  return differenceInCalendarDays(target, new Date());
}

export function resolveDeliveryUrgency(
  daysRemaining: number | null
): DeliveryUrgency {
  if (daysRemaining === null) return "upcoming";
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining === 0) return "due-today";
  if (daysRemaining === 1) return "due-tomorrow";
  return "upcoming";
}

/** Human label for the Days Remaining column. */
export function formatDaysRemaining(daysRemaining: number | null): string {
  if (daysRemaining === null) return "—";
  if (daysRemaining < 0) {
    const n = Math.abs(daysRemaining);
    return `${n} day${n === 1 ? "" : "s"} overdue`;
  }
  if (daysRemaining === 0) return "Due today";
  if (daysRemaining === 1) return "Due tomorrow";
  return `In ${daysRemaining} days`;
}

/**
 * Map raw open POs to upcoming deliveries, sorted by nearest delivery date
 * first (most urgent / overdue at the top). POs without a delivery date are
 * pushed to the end.
 */
export function buildUpcomingDeliveries(
  rows: IncomingPORow[]
): UpcomingDelivery[] {
  return rows
    .map((row) => {
      const daysRemaining = daysUntil(row.schedule_date);
      return {
        ...row,
        daysRemaining,
        urgency: resolveDeliveryUrgency(daysRemaining),
      };
    })
    .sort((a, b) => {
      if (a.daysRemaining === null && b.daysRemaining === null) {
        return a.name.localeCompare(b.name);
      }
      if (a.daysRemaining === null) return 1;
      if (b.daysRemaining === null) return -1;
      if (a.daysRemaining !== b.daysRemaining) {
        return a.daysRemaining - b.daysRemaining;
      }
      return a.name.localeCompare(b.name);
    });
}

export interface ReceivingKpis {
  pendingReceipts: number;
  incomingThisWeek: number;
  overdueDeliveries: number;
}

/** Receiving KPI counts derived from the upcoming deliveries list. */
export function computeReceivingKpis(
  deliveries: UpcomingDelivery[]
): ReceivingKpis {
  let incomingThisWeek = 0;
  let overdueDeliveries = 0;

  for (const d of deliveries) {
    if (d.daysRemaining === null) continue;
    if (d.daysRemaining < 0) overdueDeliveries += 1;
    else if (d.daysRemaining <= 7) incomingThisWeek += 1;
  }

  return {
    pendingReceipts: deliveries.length,
    incomingThisWeek,
    overdueDeliveries,
  };
}
