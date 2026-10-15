import type { MaterialRequestWorkflowStatus } from "../types/materialRequestWorkflow";
import type { MaterialRequestWorkflowRecord } from "../api/materialRequestWorkflow";
import type { StatusTone } from "../components/StatusBadge";

export type ProcurementMrStatusCategory =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface ProcurementDisplayStatus {
  label: string;
  category: ProcurementMrStatusCategory;
  tone: StatusTone;
}

/**
 * Calculate difference in calendar days: (dateA - dateB)
 * Both dates are converted to midnight in local time so timestamp hours do not skew the day count.
 */
export function differenceInCalendarDays(dateA: Date, dateB: Date): number {
  const aMidnight = new Date(
    dateA.getFullYear(),
    dateA.getMonth(),
    dateA.getDate(),
  ).getTime();
  const bMidnight = new Date(
    dateB.getFullYear(),
    dateB.getMonth(),
    dateB.getDate(),
  ).getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((aMidnight - bMidnight) / MS_PER_DAY);
}

/**
 * Check if the given date string represents today's calendar date in the local timezone.
 */
export function isReceivedToday(dateStr?: string | null): boolean {
  if (!dateStr || dateStr === "—") return false;
  const trimmed = dateStr.trim();
  if (!trimmed) return false;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayYMD = `${year}-${month}-${day}`;

  if (trimmed.startsWith(todayYMD)) {
    return true;
  }

  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return false;

  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Check if the Material Request is overdue relative to today's date based on the 7-day rule.
 *
 * Business Rule:
 * Required Date + 7 days <= Today (calendar days)
 *
 * In other words:
 * differenceInCalendarDays(Today, Required Date) >= 7
 *
 * - Future, today, or 1–6 days ago: NOT OVERDUE
 * - Exactly 7 days ago, or >7 days ago: OVERDUE
 * - Completed, Cancelled, or already has RFQ: NOT OVERDUE
 */
export function isMrOverdue(
  requiredDateStr?: string | null,
  status?: string | null,
  hasRFQ = false,
  baseDate = new Date(),
): boolean {
  if (
    !requiredDateStr ||
    requiredDateStr === "—" ||
    hasRFQ ||
    status === "Completed" ||
    status === "Cancelled" ||
    status === "RFQ Created"
  ) {
    return false;
  }

  const reqDate = new Date(requiredDateStr);
  if (Number.isNaN(reqDate.getTime())) return false;

  const daysPast = differenceInCalendarDays(baseDate, reqDate);
  return daysPast >= 7;
}

/**
 * Resolve display status and category for Procurement Manager views
 * based on the underlying workflow status, RFQ existence, and document state.
 */
export function resolveProcurementMrDisplayStatus(
  status: MaterialRequestWorkflowStatus | string | undefined,
  mrOrHasRfq?: Partial<MaterialRequestWorkflowRecord> | boolean | null,
): ProcurementDisplayStatus {
  const normStatus = status?.trim() || "";

  const hasRfq =
    typeof mrOrHasRfq === "boolean"
      ? mrOrHasRfq
      : Boolean(mrOrHasRfq?.custom_linked_rfq);

  if (normStatus === "Completed") {
    return { label: "Completed", category: "completed", tone: "success" };
  }

  if (normStatus === "Cancelled") {
    return { label: "Cancelled", category: "cancelled", tone: "cancelled" };
  }

  if (hasRfq || normStatus === "RFQ Created") {
    return { label: "RFQ Created", category: "in_progress", tone: "review" };
  }

  if (normStatus === "Partially Issued") {
    return { label: "Partially Issued", category: "in_progress", tone: "warning" };
  }

  if (
    normStatus === "Forwarded to Procurement" ||
    normStatus === "Procurement Required" ||
    normStatus === "Submitted" ||
    normStatus === "Under Warehouse Review" ||
    normStatus === "Stock Available"
  ) {
    return {
      label: "Awaiting RFQ Creation",
      category: "pending",
      tone: "pending",
    };
  }

  return {
    label: normStatus || "Awaiting RFQ Creation",
    category: "pending",
    tone: "pending",
  };
}
