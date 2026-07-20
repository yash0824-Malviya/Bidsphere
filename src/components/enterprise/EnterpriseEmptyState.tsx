import type { LucideIcon } from "lucide-react";
import { FileX2 } from "lucide-react";
import type { ReactNode } from "react";
import { ENTERPRISE_COPY } from "../../utils/enterpriseUserMessage";

export interface EnterpriseEmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Empty / not-available document state with large illustration icon.
 */
export default function EnterpriseEmptyState({
  icon: Icon = FileX2,
  title = ENTERPRISE_COPY.emptyTitle,
  description = ENTERPRISE_COPY.emptyBody,
  action,
  className = "",
}: EnterpriseEmptyStateProps) {
  return (
    <div
      className={`enterprise-fade-in flex flex-col items-center justify-center px-6 py-16 text-center ${className}`.trim()}
    >
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-[#146CE8]/8 text-[#146CE8] ring-1 ring-inset ring-[#146CE8]/15">
        <Icon className="h-10 w-10" strokeWidth={1.5} />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
        {title}
      </h2>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-500">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
