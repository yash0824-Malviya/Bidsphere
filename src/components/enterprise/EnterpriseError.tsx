import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import {
  ENTERPRISE_COPY,
  classifyEnterpriseError,
  type EnterpriseErrorKind,
} from "../../utils/enterpriseUserMessage";

export interface EnterpriseErrorProps {
  error?: unknown;
  /** Force a specific presentation; otherwise inferred from `error`. */
  kind?: EnterpriseErrorKind;
  title?: string;
  description?: string;
  onRetry?: () => void;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
  /** Compact for inline / widget use. */
  compact?: boolean;
}

/**
 * Enterprise document-load failure UI. Never renders raw backend messages.
 */
export default function EnterpriseError({
  error,
  kind: kindProp,
  title,
  description,
  onRetry,
  onBack,
  backLabel = "Back",
  className = "",
  compact = false,
}: EnterpriseErrorProps) {
  const kind = kindProp ?? (error != null ? classifyEnterpriseError(error) : "document");

  if (kind === "network") {
    return (
      <EnterprisePanel
        compact={compact}
        className={className}
        accent="warning"
        title={title ?? ENTERPRISE_COPY.networkTitle}
        description={description ?? ENTERPRISE_COPY.networkBody}
        onRetry={onRetry}
        onBack={onBack}
        backLabel={backLabel}
      />
    );
  }

  if (kind === "timeout") {
    return (
      <EnterprisePanel
        compact={compact}
        className={className}
        accent="info"
        title={title ?? ENTERPRISE_COPY.timeoutTitle}
        description={description ?? ENTERPRISE_COPY.timeoutBody}
        onRetry={onRetry}
        onBack={onBack}
        backLabel={backLabel}
      />
    );
  }

  if (kind === "empty") {
    return (
      <EnterprisePanel
        compact={compact}
        className={className}
        accent="neutral"
        title={title ?? ENTERPRISE_COPY.emptyTitle}
        description={description ?? ENTERPRISE_COPY.emptyBody}
        onRetry={undefined}
        onBack={onBack}
        backLabel={backLabel}
      />
    );
  }

  return (
    <EnterprisePanel
      compact={compact}
      className={className}
      accent="warning"
      title={title ?? ENTERPRISE_COPY.documentTitle}
      description={description ?? ENTERPRISE_COPY.documentBody}
      reasons={ENTERPRISE_COPY.documentReasons}
      onRetry={onRetry}
      onBack={onBack}
      backLabel={backLabel}
    />
  );
}

function EnterprisePanel({
  title,
  description,
  reasons,
  onRetry,
  onBack,
  backLabel,
  compact,
  className,
  accent,
}: {
  title: string;
  description: string;
  reasons?: readonly string[];
  onRetry?: () => void;
  onBack?: () => void;
  backLabel: string;
  compact: boolean;
  className: string;
  accent: "warning" | "info" | "neutral";
}) {
  const iconWrap =
    accent === "warning"
      ? "bg-amber-50 text-amber-600 ring-amber-100"
      : accent === "info"
        ? "bg-[#146CE8]/10 text-[#146CE8] ring-[#146CE8]/15"
        : "bg-neutral-100 text-neutral-500 ring-neutral-200";

  return (
    <div
      className={`enterprise-fade-in flex flex-col items-center justify-center text-center ${
        compact ? "px-4 py-10" : "px-6 py-16"
      } ${className}`.trim()}
      role="alert"
    >
      <div
        className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ring-1 ring-inset ${iconWrap}`}
      >
        <AlertTriangle className="h-7 w-7" strokeWidth={1.75} />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-600">
        {description}
      </p>

      {reasons && reasons.length > 0 && (
        <div className="mt-5 w-full max-w-md rounded-2xl border border-neutral-100 bg-white px-5 py-4 text-left shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
            Possible reasons
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-neutral-600">
            {reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#146CE8]" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(onRetry || onBack) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {backLabel}
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-xl bg-[#146CE8] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0F5BC7]"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
