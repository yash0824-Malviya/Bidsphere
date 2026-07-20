import type { ReactNode } from "react";

/** Smooth content entrance after loading completes. */
export default function FadeIn({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`enterprise-fade-in ${className}`.trim()}>{children}</div>
  );
}
