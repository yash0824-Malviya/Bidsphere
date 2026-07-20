import BrandLogo from "../BrandLogo";
import { APP_NAME } from "../../config/branding";
import { ENTERPRISE_COPY } from "../../utils/enterpriseUserMessage";
import DocumentSkeleton from "./DocumentSkeleton";
import PageSkeleton, { type PageSkeletonVariant } from "./PageSkeleton";

export type AppLoadingVariant = "document" | PageSkeletonVariant;

/**
 * Enterprise full-page / section loading experience:
 * BidSphere logo, status copy, and layout-matched skeleton with shimmer.
 */
export default function AppLoading({
  variant = "document",
  title = ENTERPRISE_COPY.loadingPrimary,
  subtitle = ENTERPRISE_COPY.loadingSecondary,
  className = "",
  /** Hide logo header for compact inline sections. */
  compact = false,
}: {
  variant?: AppLoadingVariant;
  title?: string;
  subtitle?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`enterprise-fade-in w-full ${compact ? "py-4" : "py-6"} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {!compact && (
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#146CE8]/15 bg-white shadow-sm ring-1 ring-[#146CE8]/10">
            <BrandLogo size="xs" className="max-h-9 max-w-[2.5rem]" />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#146CE8]">
            {APP_NAME}
          </p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-neutral-900">
            {title}
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-neutral-500">{subtitle}</p>
          <div
            className="enterprise-progress-bar mt-5 h-1 w-40 overflow-hidden rounded-full bg-[#146CE8]/10"
            aria-hidden
          />
        </div>
      )}

      {variant === "document" ? (
        <DocumentSkeleton />
      ) : (
        <PageSkeleton variant={variant} />
      )}
    </div>
  );
}
