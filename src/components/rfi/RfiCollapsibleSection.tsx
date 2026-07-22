import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  badge?: ReactNode;
  children: ReactNode;
}

export default function RfiCollapsibleSection({
  title,
  subtitle,
  open,
  onToggle,
  badge,
  children,
}: Props) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-[#F8FAFC]"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold tracking-tight text-[#0F172A]">
              {title}
            </h2>
            {badge}
          </div>
          {subtitle ? (
            <p className="mt-0.5 text-[12px] text-[#64748B]">{subtitle}</p>
          ) : null}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#94A3B8] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open ? (
        <div className="border-t border-[#F1F5F9] px-4 py-4">{children}</div>
      ) : null}
    </section>
  );
}
