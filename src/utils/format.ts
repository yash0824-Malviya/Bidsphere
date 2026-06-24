import { format, isValid, parseISO } from "date-fns";

import {
  erpNextDateOffset,
  parseERPNextDateInput,
  todayERPNextDate,
} from "./erpNextDate";

export const DEFAULT_CURRENCY = "USD";

/** Format a numeric amount as USD currency. */
export const formatCurrency = (
  amount: number | string | undefined | null
): string => {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: DEFAULT_CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
};

/** Compact USD for dashboards and KPI cards (e.g. $949.5K, $7.5M). */
export function formatCurrencyCompact(amount: number): string {
  if (Number.isNaN(amount)) return "—";
  const abs = Math.abs(amount);
  if (abs >= 1_000) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: DEFAULT_CURRENCY,
        notation: "compact",
        maximumFractionDigits: abs >= 1_000_000 ? 1 : abs >= 100_000 ? 1 : 0,
      }).format(amount);
    } catch {
      /* fall through */
    }
  }
  return formatCurrency(amount);
};

/** Format an ISO / ERPNext date for US display (MM/DD/YYYY). */
export function formatDate(
  value: string | Date | undefined | null,
  pattern = "MM/dd/yyyy"
): string {
  if (!value) return "—";
  const parsed =
    typeof value === "string" ? parseERPNextDateInput(value) : null;
  const d =
    parsed?.isValid() === true
      ? parsed.toDate()
      : typeof value === "string"
        ? parseISO(value)
        : value;
  return isValid(d) ? format(d, pattern) : "—";
}

/** Format a relative date / time stamp (with seconds). */
export function formatDateTime(
  value: string | Date | undefined | null
): string {
  return formatDate(value, "MMM d, yyyy · HH:mm");
}

/** Premium display date — e.g. Jun 25, 2026 */
export function formatDisplayDate(
  value: string | Date | undefined | null
): string {
  return formatDate(value, "MMM d, yyyy");
}

/** Premium display date/time — e.g. Jun 23, 2026, 5:06 PM */
export function formatDisplayDateTime(
  value: string | Date | undefined | null
): string {
  return formatDate(value, "MMM d, yyyy, h:mm a");
}

/** Format a number with thousand separators. */
export function formatNumber(
  value: number | string | undefined | null,
  fractionDigits = 0
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

/** Clamp a percentage to the 0–100 range and round to one decimal. */
export function formatPercent(value: number | undefined | null): string {
  if (value === null || value === undefined) return "0%";
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped.toFixed(1)}%`;
}

/** Today's date as YYYY-MM-DD in the local timezone (Frappe calendar date). */
export function todayLocalIso(): string {
  return todayERPNextDate();
}

/** Today's date as YYYY-MM-DD (Frappe's expected format). */
export function todayIso(): string {
  return todayLocalIso();
}

/** Add `days` to today and return YYYY-MM-DD. */
export function isoDateOffset(days: number): string {
  return erpNextDateOffset(days);
}

/** Returns true if a YYYY-MM-DD due date is strictly before today. */
export function isOverdue(due?: string | null): boolean {
  if (!due) return false;
  const parsed = parseERPNextDateInput(due);
  const d = parsed?.isValid() ? parsed.toDate() : parseISO(due);
  if (!isValid(d)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}
