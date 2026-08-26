import type { LucideIcon } from "lucide-react";

export default function ECRKpiCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-neutral-200 bg-white px-3.5 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase leading-4 tracking-[0.05em] text-neutral-500">
          {label}
        </p>
        <Icon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
      </div>
      <p className="mt-1 text-xl font-bold leading-7 text-neutral-900">{value}</p>
      {hint ? <p className="truncate text-[11px] text-neutral-500">{hint}</p> : null}
    </div>
  );
}
