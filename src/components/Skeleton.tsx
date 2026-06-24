import { memo } from "react";

interface SkeletonProps {
  className?: string;
}

/** A pulsing placeholder block for loading states. */
export const Skeleton = memo(function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-neutral-200/80 ${className}`}
      aria-hidden
    />
  );
});

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

/** Renders pulsing rows that match a generic table layout. */
export function TableSkeleton({ rows = 6, columns = 5 }: TableSkeletonProps) {
  return (
    <div className="divide-y divide-neutral-200">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="grid items-center gap-4 px-4 py-3"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: columns }).map((__, colIdx) => (
            <Skeleton
              key={colIdx}
              className={`h-4 ${colIdx === 0 ? "w-32" : "w-24"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
