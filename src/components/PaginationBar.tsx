import { ChevronLeft, ChevronRight } from "lucide-react";

import { PAGE_SIZE_OPTIONS } from "../hooks/usePagination";

export interface PaginationBarProps {
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
}

/**
 * Shared enterprise pagination control for every Bidsphere list/table.
 *
 * Layout: Showing 1–10 of 243 records · < Previous · 1 2 3 … · Next > · Rows/page
 * Hidden automatically when totalRecords <= pageSize (or zero).
 */
export default function PaginationBar({
  currentPage,
  totalPages,
  totalRecords,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  recordLabel = "records",
  className = "",
}: PaginationBarProps) {
  if (totalRecords <= 0 || totalRecords <= pageSize) return null;

  const safeTotalPages = Math.max(1, totalPages);
  const page = Math.min(Math.max(1, currentPage), safeTotalPages);
  const startRecord = (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, totalRecords);
  const pageWindow = buildPageWindow(page, safeTotalPages);

  function goTo(next: number) {
    const clamped = Math.min(Math.max(1, next), safeTotalPages);
    if (clamped !== page) onPageChange(clamped);
  }

  return (
    <div
      className={`flex flex-col gap-3 border-t border-[#E8EDF5] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <p className="text-[13px] text-[#64748B]">
        Showing{" "}
        <span className="font-semibold text-[#111827]">{startRecord}</span>–
        <span className="font-semibold text-[#111827]">{endRecord}</span> of{" "}
        <span className="font-semibold text-[#111827]">{totalRecords}</span>{" "}
        {recordLabel}
      </p>

      {/* Mobile: Previous | Page x/y | Next */}
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <button
          type="button"
          onClick={() => goTo(page - 1)}
          disabled={page === 1}
          className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-[#E8EDF5] bg-white px-3 text-[13px] font-medium text-[#334155] transition hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>
        <span className="text-[13px] font-medium tabular-nums text-[#64748B]">
          Page {page}/{safeTotalPages}
        </span>
        <button
          type="button"
          onClick={() => goTo(page + 1)}
          disabled={page === safeTotalPages}
          className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-[#E8EDF5] bg-white px-3 text-[13px] font-medium text-[#334155] transition hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Desktop controls */}
      <div className="hidden items-center gap-3 sm:flex">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page === 1}
            className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-[#E8EDF5] bg-white px-3 text-[13px] font-medium text-[#334155] transition hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>

          <div className="mx-1 flex items-center gap-0.5">
            {pageWindow.map((p, i) =>
              p === "…" ? (
                <span
                  key={`ellipsis-${i}`}
                  className="px-1.5 text-[13px] text-[#94A3B8]"
                  aria-hidden
                >
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => goTo(p)}
                  aria-current={p === page ? "page" : undefined}
                  className={`inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-[10px] px-2 text-[13px] font-semibold transition ${
                    p === page
                      ? "bg-[#146CE8] text-white shadow-sm"
                      : "text-[#334155] hover:bg-[#F1F5F9]"
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
            className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-[#E8EDF5] bg-white px-3 text-[13px] font-medium text-[#334155] transition hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-l border-[#E8EDF5] pl-3">
          <label
            htmlFor="pagination-page-size"
            className="whitespace-nowrap text-[12px] font-medium text-[#64748B]"
          >
            Rows per page
          </label>
          <select
            id="pagination-page-size"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-9 min-w-[4.5rem] rounded-[10px] border border-[#E8EDF5] bg-white px-2 text-[13px] font-medium text-[#111827] outline-none transition hover:bg-[#F8FAFC] focus:border-[#146CE8] focus:ring-2 focus:ring-[#146CE8]/15"
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
          className="text-[12px] font-medium text-[#64748B]"
        >
          Rows per page
        </label>
        <select
          id="pagination-page-size-mobile"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-9 min-w-[4.5rem] rounded-[10px] border border-[#E8EDF5] bg-white px-2 text-[13px] font-medium text-[#111827] outline-none"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Alias for clearer imports on future tables. */
export { PaginationBar as Pagination };

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
