import { AlertCircle, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  onRetry?: () => void;
}

/** A consistent error state with an optional Retry button. */
export default function ErrorState({
  icon: Icon = AlertCircle,
  title = "Something went wrong",
  description = "We couldn't load this data. Please check your connection and try again.",
  onRetry,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-neutral-500">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}
