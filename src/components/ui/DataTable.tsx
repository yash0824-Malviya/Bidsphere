import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
} from "lucide-react";
import EmptyState from "../EmptyState";
import { TableSkeleton } from "../Skeleton";
import SearchInput from "./SearchInput";

export type Align = "left" | "right" | "center";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  accessor?: (row: T) => string | number | null | undefined;
  sortFn?: (a: T, b: T) => number;
  sortable?: boolean;
  align?: Align;
  className?: string;
  width?: string;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: keyof T | ((row: T) => string);
  searchKeys?: Array<keyof T>;
  hideSearch?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}

interface SortState {
  key: string;
  dir: "asc" | "desc";
}

const ALIGN_CLASSES: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export default function DataTable<T>({
  columns,
  data,
  rowKey,
  searchKeys,
  hideSearch,
  searchPlaceholder = "Search…",
  pageSize = 10,
  isLoading,
  emptyTitle = "No results",
  emptyMessage = "There is nothing to show here yet.",
  onRowClick,
}: Props<T>) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState | null>(null);

  const showSearch = !hideSearch && !!searchKeys?.length;

  const filtered = useMemo(() => {
    if (!showSearch || !search.trim() || !searchKeys?.length) return data;
    const needle = search.trim().toLowerCase();
    return data.filter((row) =>
      searchKeys.some((k) => {
        const v = row[k];
        return v != null && String(v).toLowerCase().includes(needle);
      })
    );
  }, [data, search, searchKeys, showSearch]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    const cmp =
      col.sortFn ??
      ((a: T, b: T) => {
        const av = col.accessor ? col.accessor(a) : "";
        const bv = col.accessor ? col.accessor(b) : "";
        if (av == null && bv == null) return 0;
        if (av == null) return -1;
        if (bv == null) return 1;
        if (typeof av === "number" && typeof bv === "number") return av - bv;
        return String(av).localeCompare(String(bv));
      });
    return [...filtered].sort((a, b) => cmp(a, b) * dir);
  }, [filtered, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  function getKey(row: T): string {
    if (typeof rowKey === "function") return rowKey(row);
    return String(row[rowKey]);
  }

  function toggleSort(col: Column<T>) {
    if (!col.sortable) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: "asc" };
      if (prev.dir === "asc") return { key: col.key, dir: "desc" };
      return null;
    });
  }

  return (
    <div className="table-shell">
      {showSearch && (
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
            className="max-w-sm flex-1"
          />
          <span className="text-xs text-neutral-500">
            {sorted.length} record{sorted.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={pageSize} columns={columns.length} />
      ) : sorted.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyMessage} />
      ) : (
        <>
          {/* Mobile card list */}
          <div className="data-card-list">
            {pageRows.map((row) => (
              <div
                key={getKey(row)}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={`data-card-row ${onRowClick ? "cursor-pointer" : ""}`}
              >
                {columns.map((col) => {
                  const label =
                    typeof col.header === "string" ? col.header : col.key;
                  const value = col.render
                    ? col.render(row)
                    : col.accessor
                      ? String(col.accessor(row) ?? "—")
                      : "";
                  return (
                    <div key={col.key} className="data-card-field">
                      <span className="data-card-label">{label}</span>
                      <span className="data-card-value">{value}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Desktop / tablet table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map((col) => {
                    const align = col.align ?? "left";
                    const isSorted = sort?.key === col.key;
                    const indicator = !col.sortable ? null : !isSorted ? (
                      <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-50" />
                    ) : sort?.dir === "asc" ? (
                      <ChevronUp className="ml-1 inline h-3 w-3" />
                    ) : (
                      <ChevronDown className="ml-1 inline h-3 w-3" />
                    );
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        style={col.width ? { width: col.width } : undefined}
                        className={`${ALIGN_CLASSES[align]} ${
                          col.sortable
                            ? "cursor-pointer select-none hover:text-neutral-600"
                            : ""
                        } ${col.className ?? ""}`}
                        onClick={() => toggleSort(col)}
                      >
                        {col.header}
                        {indicator}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr
                    key={getKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? "cursor-pointer" : undefined}
                  >
                    {columns.map((col) => {
                      const align = col.align ?? "left";
                      return (
                        <td
                          key={col.key}
                          className={`${ALIGN_CLASSES[align]} ${
                            col.className ?? ""
                          }`}
                        >
                          {col.render
                            ? col.render(row)
                            : col.accessor
                              ? String(col.accessor(row) ?? "—")
                              : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {sorted.length > pageSize && (
        <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-2.5 text-xs text-neutral-600">
          <span>
            Page {safePage + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="btn-secondary h-7 px-2 disabled:opacity-50"
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="btn-secondary h-7 px-2 disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
