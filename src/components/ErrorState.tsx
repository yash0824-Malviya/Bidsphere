import type { LucideIcon } from "lucide-react";
import EnterpriseError from "./enterprise/EnterpriseError";

interface Props {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  onRetry?: () => void;
  onBack?: () => void;
  backLabel?: string;
  error?: unknown;
}

/**
 * Page-level error state — enterprise document failure UI.
 * Never surfaces raw backend / ERP messages.
 */
export default function ErrorState({
  title,
  description,
  onRetry,
  onBack,
  backLabel,
  error,
}: Props) {
  return (
    <EnterpriseError
      error={error}
      title={title}
      description={description}
      onRetry={onRetry}
      onBack={onBack}
      backLabel={backLabel}
    />
  );
}
