/**
 * Contract Effective Period Validation Utility
 *
 * Implements strict calendar-date boundary validation for Contract Activation
 * in BidSphere CLM.
 *
 * Uses the documented system business timezone (Asia/Kolkata) without
 * browser or client UTC date shifting.
 */

export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Kolkata";

const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates whether a value is a valid ISO date-only string (YYYY-MM-DD)
 * representing a real calendar date (e.g., rejects 2026-02-30 or 2026-13-40)
 * without suffering from browser timezone conversion shifts.
 */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!YMD_REGEX.test(trimmed)) return false;
  const [yStr, mStr, dStr] = trimmed.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  // Validate using UTC to prevent browser/local timezone shifting
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return (
    utcDate.getUTCFullYear() === year &&
    utcDate.getUTCMonth() + 1 === month &&
    utcDate.getUTCDate() === day
  );
}

/**
 * Resolves the business calendar date (YYYY-MM-DD) in the documented ERP timezone.
 */
export function getBusinessToday(
  now = new Date(),
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback if environment lacks timezone data
  }
  return now.toISOString().slice(0, 10);
}

/**
 * Extracts normalized start and end date strings from a Contract record,
 * supporting standard ERPNext fields (start_date / end_date) and request fallbacks.
 */
export function getContractEffectiveDates(record: Record<string, unknown>): {
  startDate: string;
  endDate: string;
} {
  const start =
    typeof record.start_date === "string" && record.start_date.trim()
      ? record.start_date.trim()
      : typeof record.contract_start_date === "string" && record.contract_start_date.trim()
      ? record.contract_start_date.trim()
      : "";
  const end =
    typeof record.end_date === "string" && record.end_date.trim()
      ? record.end_date.trim()
      : typeof record.contract_end_date === "string" && record.contract_end_date.trim()
      ? record.contract_end_date.trim()
      : "";
  return { startDate: start, endDate: end };
}

export type ContractPeriodValidationReason =
  | "missing_start_date"
  | "missing_end_date"
  | "invalid_start_date"
  | "invalid_end_date"
  | "end_before_start"
  | "future_start_date"
  | "contract_expired";

export interface ContractActivationPeriodEvaluation {
  valid: boolean;
  reason?: ContractPeriodValidationReason;
  message?: string;
  startDate?: string;
  endDate?: string;
  permittedActivationDate?: string;
  businessDate: string;
}

/**
 * Evaluates whether a contract can be activated on the specified business date.
 *
 * Rules:
 * - Start date and end date must both exist and be valid YYYY-MM-DD calendar dates.
 * - End date cannot precede start date.
 * - Activation is only allowed when startDate <= businessDate <= endDate (inclusive).
 * - If start date is in the future, specifies the permitted activation date.
 * - If end date is in the past, explains that the effective period has ended.
 */
export function evaluateContractEffectivePeriod(
  record: Record<string, unknown>,
  currentBusinessDate?: string,
): ContractActivationPeriodEvaluation {
  const businessDate = currentBusinessDate?.trim() || getBusinessToday();
  const { startDate, endDate } = getContractEffectiveDates(record);

  if (!startDate) {
    return {
      valid: false,
      reason: "missing_start_date",
      message: "Contract Start Date is required before activation.",
      businessDate,
    };
  }

  if (!endDate) {
    return {
      valid: false,
      reason: "missing_end_date",
      message: "Contract End Date is required before activation.",
      startDate,
      businessDate,
    };
  }

  if (!isValidIsoDate(startDate)) {
    return {
      valid: false,
      reason: "invalid_start_date",
      message: `Contract Start Date (${startDate}) is not a valid calendar date (expected YYYY-MM-DD).`,
      startDate,
      businessDate,
    };
  }

  if (!isValidIsoDate(endDate)) {
    return {
      valid: false,
      reason: "invalid_end_date",
      message: `Contract End Date (${endDate}) is not a valid calendar date (expected YYYY-MM-DD).`,
      startDate,
      endDate,
      businessDate,
    };
  }

  if (endDate < startDate) {
    return {
      valid: false,
      reason: "end_before_start",
      message: `Contract End Date (${endDate}) cannot be before Contract Start Date (${startDate}).`,
      startDate,
      endDate,
      businessDate,
    };
  }

  // Future start date check
  if (businessDate < startDate) {
    return {
      valid: false,
      reason: "future_start_date",
      permittedActivationDate: startDate,
      message: `The Contract can become Active only during its effective period. Activation will be permitted on or after ${startDate} (current business date: ${businessDate}).`,
      startDate,
      endDate,
      businessDate,
    };
  }

  // Expired contract check
  if (businessDate > endDate) {
    return {
      valid: false,
      reason: "contract_expired",
      message: `The Contract can become Active only during its effective period. The effective period ended on ${endDate} (current business date: ${businessDate}).`,
      startDate,
      endDate,
      businessDate,
    };
  }

  // Active period (inclusive of boundaries)
  return {
    valid: true,
    startDate,
    endDate,
    businessDate,
  };
}
