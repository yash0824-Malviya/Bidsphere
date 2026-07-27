import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  PAGE_SIZE_OPTIONS,
  type PageSizeOption,
} from "../../hooks/usePagination";

export interface PaginationProps {
  /** 1-based current page. */
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  /** Noun used in the summary, e.g. "quotations". Defaults to "records". */
  recordLabel?: string;
  className?: string;
  /**
   * When false, hide the bar if everything fits on one page.
   * Default true — always show when there is at least one record.
   */
  alwaysShow?: boolean;
}

/**
 * Shared enterprise pagination control for every Bidsphere list/table.
 *
 * Desktop: Showing 1–10 of N · Previous · 1 2 3 … · Next · Rows per page
 * Mobile: Previous · Page x / y · Next · Rows per page
 */
export default function Pagination({
  currentPage,
  totalPages,
  totalRecords,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  recordLabel = "records",
  className = "",
  alwaysShow = true,
}: PaginationProps) {
  if (totalRecords <= 0) return null;
  if (!alwaysShow && totalRecords <= pageSize) return null;

  const safeTotalPages = Math.max(1, totalPages);
  const page = Math.min(Math.max(1, currentPage), safeTotalPages);
  const startRecord = (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, totalRecords);
  const pageWindow = buildPageWindow(page, safeTotalPages);

  function goTo(next: number) {
    const clamped = Math.min(Math.max(1, next), safeTotalPages);
    if (clamped !== page) onPageChange(clamped);
  }

  const btnBase =
    "inline-flex h-11 items-center justify-center gap-1 rounded-[12px] border border-[var(--color-border)] bg-white px-3 text-[14px] font-semibold text-[var(--color-text)] transition hover:border-primary-200 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--color-border)] disabled:hover:bg-white";

  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-col gap-3 border-t border-neutral-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <p className="text-[13px] text-neutral-500" aria-live="polite">
        Showing{" "}
        <span className="font-semibold tabular-nums text-neutral-900">
          {startRecord}
        </span>
        –
        <span className="font-semibold tabular-nums text-neutral-900">
          {endRecord}
        </span>{" "}
        of{" "}
        <span className="font-semibold tabular-nums text-neutral-900">
          {totalRecords}
        </span>{" "}
        {recordLabel}
      </p>

      {/* Mobile: Previous | Page x/y | Next */}
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <button
          type="button"
          onClick={() => goTo(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          className={btnBase}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Previous
        </button>
        <span className="text-[13px] font-medium tabular-nums text-neutral-500">
          Page {page} / {safeTotalPages}
        </span>
        <button
          type="button"
          onClick={() => goTo(page + 1)}
          disabled={page === safeTotalPages}
          aria-label="Next page"
          className={btnBase}
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Desktop / tablet controls */}
      <div className="hidden items-center gap-3 sm:flex">
        <div className="flex items-center gap-1" role="group" aria-label="Page navigation">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
            className={btnBase}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            <span className="hidden md:inline">Previous</span>
          </button>

          <div className="mx-1 flex items-center gap-0.5">
            {pageWindow.map((p, i) =>
              p === "…" ? (
                <span
                  key={`ellipsis-${i}`}
                  className="px-1.5 text-[13px] text-neutral-400"
                  aria-hidden
                >
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => goTo(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? "page" : undefined}
                  className={`inline-flex h-11 min-w-11 items-center justify-center rounded-[12px] px-2 text-[14px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                    p === page
                      ? "bg-primary text-white shadow-sm"
                      : "text-[var(--color-text)] hover:bg-primary-50"
                  }`}
                >
                  {p}
                </button>
              ),
            )}
          </div>

          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={page === safeTotalPages}
            aria-label="Next page"
            className={btnBase}
          >
            <span className="hidden md:inline">Next</span>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-2 border-l border-neutral-200 pl-3">
          <label
            htmlFor="pagination-page-size"
            className="whitespace-nowrap text-[12px] font-medium text-neutral-500"
          >
            Rows per page
          </label>
          <select
            id="pagination-page-size"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
            className="h-9 min-w-[4.5rem] rounded-[10px] border border-neutral-200 bg-white px-2 text-[13px] font-medium text-neutral-900 outline-none transition hover:bg-primary-50 focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mobile page-size */}
      <div className="flex items-center justify-end gap-2 sm:hidden">
        <label
          htmlFor="pagination-page-size-mobile"
          className="text-[12px] font-medium text-neutral-500"
        >
          Rows per page
        </label>
        <select
          id="pagination-page-size-mobile"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="Rows per page"
          className="h-9 min-w-[4.5rem] rounded-[10px] border border-neutral-200 bg-white px-2 text-[13px] font-medium text-neutral-900 outline-none"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}

export type { PageSizeOption };

function buildPageWindow(
  current: number,
  total: number,
): Array<number | "…"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, total, current]);
  for (let d = 1; d <= 2; d += 1) {
    if (current - d >= 1) pages.add(current - d);
    if (current + d <= total) pages.add(current + d);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const result: Array<number | "…"> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("…");
    result.push(sorted[i]);
  }
  return result;
}
