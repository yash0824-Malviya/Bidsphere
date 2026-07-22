import { memo } from "react";
import { useTranslation } from "react-i18next";

import { translateStatus } from "../i18n/statusLabels";

type StatusTone = "neutral" | "info" | "warning" | "success" | "danger";

/**
 * Badge colors (enterprise design system):
 * Green = Completed · Yellow = Pending · Red = Rejected · Gray = Draft
 */
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "badge-draft",
  info: "bg-primary-100 text-primary-700",
  warning: "badge-pending",
  success: "badge-completed",
  danger: "badge-rejected",
};

const STATUS_TONES: Record<string, StatusTone> = {
  Draft: "neutral",
  Published: "success",
  "Under Review": "warning",
  "Waiting Warehouse Signature": "warning",
  "Waiting Department Signature": "warning",
  "Pending Department Acceptance": "warning",
  "Waiting for Department Acceptance": "warning",
  "Waiting for Acceptance": "warning",
  "Partially Issued": "warning",
  "Material Receipt Confirmed": "success",
  Confirmed: "success",
  "Acceptance Rejected": "danger",
  Tampered: "danger",
  "Not Found": "neutral",
  Pending: "warning",
  "Pending Acceptance": "warning",
  "Pending Supplier Acceptance": "warning",
  Submitted: "success",
  New: "info",
  Awarded: "success",
  "Clarification Requested": "warning",
  Accepted: "success",
  "In Transit": "info",
  "Partially Received": "success",
  Approved: "success",
  Success: "success",
  Rejected: "danger",
  Cancelled: "danger",
  Closed: "danger",
  Completed: "success",
  "On Hold": "neutral",
  "To Receive": "warning",
  "To Bill": "info",
  "To Receive and Bill": "warning",
  Delivered: "success",
  Paid: "success",
  Partial: "warning",
  Failed: "danger",
  Voided: "neutral",
  Scheduled: "info",
  Processing: "info",
  Unpaid: "warning",
  "Partly Paid": "warning",
  Overdue: "danger",
  Ordered: "info",
  Active: "success",
  Inactive: "neutral",
  "Below Reorder": "danger",
  "Admin Review": "info",
  "Under Warehouse Review": "warning",
  "Stock Available": "info",
  "Material Issued": "success",
  "Procurement Required": "info",
  "Forwarded to Procurement": "info",
  "Awaiting RFQ Creation": "warning",
  "RFQ Created": "info",
  "RFQ In Progress": "info",
  "Purchase Order Created": "success",
};

interface Props {
  status?: string | null;
  tone?: StatusTone;
  /** Visual size — use `lg` for page hero status on detail screens. */
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASSES = {
  sm: "h-5 px-1.5 text-[11px]",
  md: "",
  lg: "h-7 px-2.5 text-[13px]",
} as const;

export default memo(function StatusBadge({ status, tone, size = "md" }: Props) {
  const { t } = useTranslation();
  const label = status?.trim() || "—";
  const resolvedTone: StatusTone = tone ?? STATUS_TONES[label] ?? "neutral";
  const classes = TONE_CLASSES[resolvedTone];

  return (
    <span className={`status-badge ${SIZE_CLASSES[size]} ${classes}`}>
      {translateStatus(t, label)}
    </span>
  );
});
