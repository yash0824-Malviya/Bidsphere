import {
  classifyEnterpriseError,
} from "../utils/enterpriseUserMessage";
import EnterpriseError from "./enterprise/EnterpriseError";
import NetworkError from "./enterprise/NetworkError";

interface Props {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  description?: string;
  /** Compact rendering for inline (sub-section) use cases. */
  compact?: boolean;
  onBack?: () => void;
}

/**
 * Standard list/fetch failure panel. Never renders raw exception text.
 */
export default function ConnectionError({
  error,
  onRetry,
  title,
  description,
  compact = false,
  onBack,
}: Props) {
  const kind = classifyEnterpriseError(error);

  if (kind === "network" || kind === "timeout") {
    return (
      <NetworkError
        title={
          title ??
          (kind === "timeout" ? "Still Working..." : undefined)
        }
        description={
          description ??
          (kind === "timeout"
            ? "This request is taking longer than expected. Please wait a few moments."
            : undefined)
        }
        onRetry={onRetry}
        compact={compact}
      />
    );
  }

  return (
    <EnterpriseError
      error={error}
      kind={kind === "empty" ? "empty" : "document"}
      title={title}
      description={description}
      onRetry={onRetry}
      onBack={onBack}
      compact={compact}
    />
  );
}
