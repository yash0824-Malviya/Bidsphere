import { formatPercent } from "../../utils/format";

interface Props {
  value: number;
  className?: string;
}

/** Slim pill-style progress bar for table cells. */
export default function ProgressCell({ value, className = "" }: Props) {
  const pct = Math.max(0, Math.min(100, value));

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 min-w-[72px] flex-1 rounded-full bg-neutral-200">
        <div
          className="h-1.5 rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-neutral-500">
        {formatPercent(pct)}
      </span>
    </div>
  );
}
