import { memo } from "react";

/** Shimmer block matching page layout placeholders. */
export const Shimmer = memo(function Shimmer({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`enterprise-shimmer rounded-lg ${className}`.trim()}
      aria-hidden
    />
  );
});

export type PageSkeletonVariant = "list" | "dashboard" | "form" | "table";

/**
 * Layout-aware skeleton for list / dashboard / form pages.
 * Use DocumentSkeleton for detail/document screens.
 */
export default function PageSkeleton({
  variant = "list",
  rows = 6,
  columns = 5,
  className = "",
}: {
  variant?: PageSkeletonVariant;
  rows?: number;
  columns?: number;
  className?: string;
}) {
  if (variant === "dashboard") {
    return (
      <div
        className={`space-y-5 ${className}`.trim()}
        aria-busy="true"
        aria-label="Loading"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Shimmer key={i} className="h-[88px] rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Shimmer className="h-[280px] rounded-2xl" />
          <Shimmer className="h-[280px] rounded-2xl" />
        </div>
        <Shimmer className="h-[220px] rounded-2xl" />
      </div>
    );
  }

  if (variant === "form") {
    return (
      <div
        className={`space-y-4 ${className}`.trim()}
        aria-busy="true"
        aria-label="Loading"
      >
        <Shimmer className="h-8 w-56" />
        <div className="rounded-2xl border border-neutral-100 bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Shimmer className="h-3 w-24" />
                <Shimmer className="h-10 w-full" />
              </div>
            ))}
          </div>
          <Shimmer className="mt-6 h-28 w-full" />
        </div>
      </div>
    );
  }

  // list / table
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm ${className}`.trim()}
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="border-b border-neutral-100 px-5 py-4">
        <Shimmer className="h-5 w-40" />
      </div>
      <div className="divide-y divide-neutral-100">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="grid items-center gap-4 px-5 py-3.5"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: columns }).map((__, colIdx) => (
              <Shimmer
                key={colIdx}
                className={`h-4 ${colIdx === 0 ? "w-28" : "w-20"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
