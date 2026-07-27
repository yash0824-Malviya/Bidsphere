import { memo, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import {
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  Lock,
  Pencil,
  Trophy,
  XCircle,
} from "lucide-react";

import { translateStatus } from "../i18n/statusLabels";

/**
 * Visual tones for the shared enterprise status badge.
 * Colors/icons are resolved from the document status string — not per page.
 */
export type StatusTone =
  | "neutral"
  | "info"
  | "warning"
  | "pending"
  | "success"
  | "danger"
  | "closed"
  | "awarded"
  | "review"
  | "cancelled";

type IconComp = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

const TONE_TO_CLASS: Record<StatusTone, string> = {
  neutral: "status-badge-draft",
  info: "status-badge-info",
  warning: "status-badge-warning",
  pending: "status-badge-pending",
  success: "status-badge-submitted",
  danger: "status-badge-rejected",
  closed: "status-badge-closed",
  awarded: "status-badge-awarded",
  review: "status-badge-review",
  cancelled: "status-badge-cancelled",
};

const TONE_ICONS: Partial<Record<StatusTone, IconComp>> = {
  neutral: Pencil,
  pending: Clock,
  review: Eye,
  info: Eye,
  success: CheckCircle2,
  awarded: Trophy,
  danger: XCircle,
  cancelled: Ban,
  closed: Lock,
  warning: Clock,
};

/**
 * Normalize ERP / workflow status labels to a visual tone.
 * Matching is case-insensitive and tolerant of common synonyms.
 */
export function resolveStatusTone(status?: string | null): StatusTone {
  const raw = (status ?? "").trim();
  if (!raw) return "neutral";
  const s = raw.toLowerCase();

  if (s === "draft" || s === "inactive" || s === "voided" || s === "not found") {
    return "neutral";
  }
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (
    s === "rejected" ||
    s === "failed" ||
    s === "tampered" ||
    s === "overdue" ||
    s === "expired" ||
    s === "acceptance rejected"
  ) {
    return "danger";
  }
  if (
    s === "awarded" ||
    s === "ordered" ||
    s === "partially ordered" ||
    s === "purchase order created" ||
    s === "po created"
  ) {
    return "awarded";
  }
  if (s === "closed") return "closed";
  if (
    s === "submitted" ||
    s === "approved" ||
    s === "accepted" ||
    s === "completed" ||
    s === "paid" ||
    s === "delivered" ||
    s === "confirmed" ||
    s === "published" ||
    s === "active" ||
    s === "success" ||
    s === "material receipt confirmed" ||
    s === "material issued" ||
    s === "stock available"
  ) {
    return "success";
  }
  if (
    s.includes("pending approval") ||
    s === "pending" ||
    s.startsWith("waiting") ||
    s.includes("pending acceptance") ||
    s.includes("awaiting") ||
    s.includes("changes requested") ||
    s === "to receive" ||
    s === "to receive and bill" ||
    s === "unpaid" ||
    s.includes("awaiting rfq")
  ) {
    return "pending";
  }
  if (
    s.includes("review") ||
    s === "in progress" ||
    s === "open" ||
    s === "opened" ||
    s === "new" ||
    s === "processing" ||
    s === "scheduled" ||
    s === "to bill" ||
    s === "link generated" ||
    s.includes("clarification") ||
    s.includes("ai analysis") ||
    s.includes("forwarded") ||
    s.includes("procurement required") ||
    s.includes("rfq")
  ) {
    return "review";
  }
  if (s.includes("partial") || s === "on hold" || s.includes("below reorder")) {
    return "warning";
  }

  return "neutral";
}

interface Props {
  status?: string | null;
  /** Override auto-resolved tone when a page needs a specific visual. */
  tone?: StatusTone;
  /** Kept for API compatibility — visual size is standardized. */
  size?: "sm" | "md" | "lg";
  /** Show leading status icon (default true). */
  showIcon?: boolean;
  className?: string;
}

export default memo(function StatusBadge({
  status,
  tone,
  showIcon = true,
  className = "",
}: Props) {
  const { t } = useTranslation();
  const label = status?.trim() || "—";
  const resolvedTone: StatusTone = tone ?? resolveStatusTone(label);
  const classes = TONE_TO_CLASS[resolvedTone] ?? TONE_TO_CLASS.neutral;
  const Icon = TONE_ICONS[resolvedTone];

  return (
    <span
      className={`status-badge ${classes}${className ? ` ${className}` : ""}`}
      title={label}
    >
      {showIcon && Icon ? (
        <Icon className="status-badge-icon" aria-hidden />
      ) : null}
      <span className="status-badge-label">{translateStatus(t, label)}</span>
    </span>
  );
});
