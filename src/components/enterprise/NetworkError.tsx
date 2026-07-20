import { WifiOff, RotateCw } from "lucide-react";
import { ENTERPRISE_COPY } from "../../utils/enterpriseUserMessage";

export interface NetworkErrorProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

/** Dedicated connection-lost panel (no technical details). */
export default function NetworkError({
  title = ENTERPRISE_COPY.networkTitle,
  description = ENTERPRISE_COPY.networkBody,
  onRetry,
  className = "",
  compact = false,
}: NetworkErrorProps) {
  return (
    <div
      className={`enterprise-fade-in flex flex-col items-center justify-center rounded-2xl border border-amber-100 bg-white text-center shadow-sm ${
        compact ? "px-4 py-10" : "px-6 py-16"
      } ${className}`.trim()}
      role="alert"
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100">
        <WifiOff className="h-7 w-7" strokeWidth={1.75} />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-600">
        {description}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#146CE8] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0F5BC7]"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}
