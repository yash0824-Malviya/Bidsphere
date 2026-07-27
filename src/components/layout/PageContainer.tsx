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
 * Global content shell — dense layout (~90% zoom at 100% browser zoom).
 * max-width 1600px · side inset 24px · top 20px · bottom 28px · gap 20px
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
