import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

import type { SortDirection, SortState } from "../../utils/listSort";
import { toggleSortDirection } from "../../utils/listSort";

interface Props {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (next: SortState) => void;
  className?: string;
}

export default function SortableTableHeader({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: Props) {
  const active = sort.key === sortKey;

  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(toggleSortDirection(sort, sortKey))}
        className="inline-flex items-center gap-1 text-left text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
      >
        <span>{label}</span>
        {active ? (
          sort.direction === "desc" ? (
            <ChevronDown className="h-4 w-4 text-primary" aria-hidden />
          ) : (
            <ChevronUp className="h-4 w-4 text-primary" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="h-4 w-4 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  );
}

export type { SortDirection, SortState };
