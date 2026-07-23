import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  /**
   * When true, skips the default vertical section gap utility.
   * Use for pages that manage their own internal stacking.
   */
  bare?: boolean;
}

/**
 * Global content shell for Procurement + Supplier portals.
 * Provides consistent max-width, side insets, and top/bottom spacing.
 */
export default function PageContainer({
  children,
  className = "",
  bare = false,
}: Props) {
  return (
    <div
      className={`page-container${bare ? "" : " page-container--stack"}${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </div>
  );
}
