import { AlertTriangle } from "lucide-react";
import { toEnterpriseUserMessage } from "../../utils/enterpriseUserMessage";

interface Props {
  title?: string;
  /** Prefer omitting — technical exceptions are sanitized automatically. */
  message?: string;
  /** When set, `message` is derived via toEnterpriseUserMessage. */
  error?: unknown;
  className?: string;
  onRetry?: () => void;
}

/** Shown when a dashboard widget query fails — never leave a skeleton forever. */
export default function DashboardWidgetError({
  title = "Unable to load dashboard data",
  message,
  error,
  className = "",
  onRetry,
}: Props) {
  const displayMessage =
    message ??
    (error !== undefined
      ? toEnterpriseUserMessage(
          error,
          "Unable to load dashboard data. Please try again.",
        )
      : "Unable to load dashboard data. Please try again.");

  return (
    <div
      className={`flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border border-neutral-100 bg-white px-4 py-6 text-center shadow-sm ${className}`}
      role="alert"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-neutral-900">{title}</p>
      <p className="max-w-md text-xs text-neutral-500">{displayMessage}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-xl bg-[#146CE8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0F5BC7]"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
