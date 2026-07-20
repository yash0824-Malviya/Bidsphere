import { Shimmer } from "./PageSkeleton";

/**
 * Document / detail page skeleton — header, meta cards, and content blocks
 * matching typical BidSphere document layouts (RFQ, PO, Invoice, Legal, etc.).
 */
export default function DocumentSkeleton({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`space-y-5 ${className}`.trim()}
      aria-busy="true"
      aria-label="Loading document"
    >
      <div className="space-y-2">
        <Shimmer className="h-4 w-32" />
        <Shimmer className="h-8 w-72 max-w-full" />
        <div className="flex flex-wrap gap-2">
          <Shimmer className="h-6 w-20 rounded-full" />
          <Shimmer className="h-6 w-28 rounded-full" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm"
          >
            <Shimmer className="mb-2 h-3 w-20" />
            <Shimmer className="h-5 w-36" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm">
        <Shimmer className="mb-4 h-5 w-40" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Shimmer key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm">
        <Shimmer className="mb-4 h-5 w-48" />
        <Shimmer className="h-40 w-full" />
      </div>
    </div>
  );
}
