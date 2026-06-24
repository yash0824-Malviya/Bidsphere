import { memo } from "react";

type StatusTone = "neutral" | "info" | "warning" | "success" | "danger";

/** Exact badge colors from the Netlink design system. */
const STATUS_STYLES: Record<string, string> = {
  Completed: "bg-success-100 text-success-500",
  "To Receive and Bill": "bg-warning-100 text-warning-500",
  "To Bill": "bg-primary-100 text-primary-700",
  Cancelled: "bg-danger-100 text-danger-500",
  Draft: "bg-neutral-100 text-neutral-500",
  Paid: "bg-success-100 text-success-500",
  Partial: "bg-warning-100 text-warning-500",
  Failed: "bg-danger-100 text-danger-500",
  Voided: "bg-neutral-100 text-neutral-600",
  Scheduled: "bg-primary-100 text-primary-700",
  Processing: "bg-primary-100 text-primary-700",
  Unpaid: "bg-warning-100 text-warning-500",
  Overdue: "bg-danger-100 text-danger-500",
  Submitted: "bg-primary-100 text-primary-700",
  Approved: "bg-success-100 text-success-500",
  Rejected: "bg-danger-100 text-danger-500",
  Pending: "bg-warning-100 text-warning-500",
  "Pending Acceptance": "bg-warning-100 text-warning-600",
  "To Receive": "bg-warning-100 text-warning-500",
  Accepted: "bg-warning-100 text-warning-600",
  "In Transit": "bg-primary-100 text-primary-700",
  "Partially Received": "bg-success-100 text-success-600",
  Delivered: "bg-success-100 text-success-500",
  Closed: "bg-neutral-100 text-neutral-500",
  Ordered: "bg-primary-100 text-primary-700",
  "Partly Paid": "bg-warning-100 text-warning-500",
  "On Hold": "bg-neutral-100 text-neutral-500",
  Active: "bg-success-100 text-success-500",
  Inactive: "bg-neutral-100 text-neutral-500",
  "Below Reorder": "bg-danger-100 text-danger-500",
};

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-neutral-100 text-neutral-500",
  info: "bg-primary-100 text-primary-700",
  warning: "bg-warning-100 text-warning-500",
  success: "bg-success-100 text-success-500",
  danger: "bg-danger-100 text-danger-500",
};

const STATUS_TONES: Record<string, StatusTone> = {
  Draft: "neutral",
  Pending: "warning",
  "Pending Acceptance": "warning",
  Submitted: "info",
  Accepted: "warning",
  "In Transit": "info",
  "Partially Received": "success",
  Approved: "success",
  Rejected: "danger",
  Cancelled: "danger",
  Closed: "neutral",
  Completed: "success",
  "On Hold": "neutral",
  "To Receive": "warning",
  "To Bill": "info",
  "To Receive and Bill": "warning",
  Delivered: "success",
  "Return Issued": "neutral",
  Paid: "success",
  Partial: "warning",
  Failed: "danger",
  Voided: "neutral",
  Scheduled: "info",
  Processing: "info",
  Unpaid: "warning",
  "Partly Paid": "warning",
  Overdue: "danger",
  Return: "neutral",
  "Debit Note Issued": "neutral",
  "Internal Transfer": "info",
  Ordered: "info",
};

interface Props {
  status?: string | null;
  tone?: StatusTone;
}

export default memo(function StatusBadge({ status, tone }: Props) {
  const label = status?.trim() || "—";
  const resolvedTone: StatusTone =
    tone ?? STATUS_TONES[label] ?? "neutral";
  const classes =
    STATUS_STYLES[label] ?? TONE_CLASSES[resolvedTone];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
});
