import { useTranslation } from "react-i18next";
import { Factory, Briefcase } from "lucide-react";

import {
  procurementTypeBadgeClasses,
} from "../config/procurementType";
import type { MaterialRequestProcurementType } from "../types/materialRequestWorkflow";

interface Props {
  type: MaterialRequestProcurementType;
  size?: "sm" | "md";
  withIcon?: boolean;
  className?: string;
}

/**
 * Direct = blue, Indirect = orange badge shown wherever a Material Request (or
 * downstream document) is listed. Label is fully localized.
 */
export default function ProcurementTypeBadge({
  type,
  size = "sm",
  withIcon = true,
  className = "",
}: Props) {
  const { t } = useTranslation();
  const Icon = type === "Direct" ? Factory : Briefcase;
  const sizeClasses =
    size === "md"
      ? "px-2.5 py-1 text-xs"
      : "px-2 py-0.5 text-[11px]";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses} ${procurementTypeBadgeClasses(
        type,
      )} ${className}`}
    >
      {withIcon && <Icon className="h-3 w-3" />}
      {type === "Direct"
        ? t("procurementType.direct")
        : t("procurementType.indirect")}
    </span>
  );
}
