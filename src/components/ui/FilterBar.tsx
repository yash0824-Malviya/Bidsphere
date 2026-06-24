import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
}

/** White card wrapper for list-page filter controls. */
export default function FilterBar({ children, className = "" }: Props) {
  return (
    <div className={`filter-card ${className}`}>{children}</div>
  );
}

interface FilterFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function FilterField({ label, children, className = "" }: FilterFieldProps) {
  return (
    <div className={`flex w-full min-w-0 flex-col sm:min-w-[140px] sm:w-auto ${className}`}>
      <label className="label-field">{label}</label>
      {children}
    </div>
  );
}
