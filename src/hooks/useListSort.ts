import { useMemo, useState } from "react";

import type { SortState } from "../utils/listSort";
import { sortNewestFirst, sortRows } from "../utils/listSort";

export function useListSort<T>(
  rows: T[],
  defaultSort: SortState,
  comparators: Record<
    string,
    (a: T, b: T, direction: SortState["direction"]) => number
  >,
  newestFirstPickers?: {
    date: (row: T) => string | undefined | null;
    creation?: (row: T) => string | undefined | null;
    name: (row: T) => string;
  }
) {
  const [sort, setSort] = useState<SortState>(defaultSort);

  const sortedRows = useMemo(() => {
    const base = newestFirstPickers
      ? sortNewestFirst(rows, newestFirstPickers)
      : rows;
    return sortRows(base, sort, comparators);
  }, [rows, sort, comparators, newestFirstPickers]);

  return { sort, setSort, sortedRows };
}
