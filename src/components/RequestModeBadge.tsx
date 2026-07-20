import { useTranslation } from "react-i18next";

import type { MaterialRequestMode } from "../types/materialRequestWorkflow";
import { resolveRequestMode } from "../types/materialRequestWorkflow";

interface Props {
  mode: MaterialRequestMode | string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Existing = emerald, New = amber. Legacy empty mode resolves to Existing.
 */
export default function RequestModeBadge({
  mode,
  size = "sm",
  className = "",
}: Props) {
  const { t } = useTranslation();
  const resolved = resolveRequestMode(mode);
  const sizeClasses =
    size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  const tone =
    resolved === "New"
      ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
      : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses} ${tone} ${className}`}
    >
      {resolved === "New" ? t("requestMode.new") : t("requestMode.existing")}
    </span>
  );
}
