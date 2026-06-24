import { AlertTriangle, RotateCw } from "lucide-react";

interface Props {
  /**
   * The error thrown by react-query / fetch. Its `.message` is rendered
   * under the description so the user can identify the issue.
   */
  error: unknown;
  onRetry?: () => void;
  title?: string;
  description?: string;
  /** Compact rendering for inline (sub-section) use cases. */
  compact?: boolean;
}

/**
 * Standard connectivity-error panel used by every list page when a
 * react-query call fails. Provides a consistent retry experience.
 */
export default function ConnectionError({
  error,
  onRetry,
  title = "Unable to load data",
  description = "Please check your connection and try again.",
  compact = false,
}: Props) {
  const message = errorMessage(error);

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border border-warning-200 bg-warning-50/60 text-center ${
        compact ? "px-4 py-8" : "px-6 py-16"
      }`}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-warning-100 text-warning-700 ring-1 ring-inset ring-warning-200">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-neutral-600">{description}</p>
      {message && (
        <p className="mt-2 max-w-md break-words text-xs text-danger-600">
          {message}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-600"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in (error as object)) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return "";
}
