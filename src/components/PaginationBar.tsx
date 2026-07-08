import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { PAGE_SIZE_OPTIONS } from "../hooks/usePagination";

interface PaginationBarProps {
  /** 1-based current page. */
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}

/**
 * Shared "Showing X–Y of Z records" pagination control used by every
 * server-paginated list page in the Procurement System. Renders bottom-right
 * per the design spec: record-range summary, page-size selector, and
 * First/Previous/page-numbers/Next/Last controls.
 */
export default function PaginationBar({
  currentPage,
  totalPages,
  totalRecords,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className = "",
}: PaginationBarProps) {
  if (totalRecords === 0) return null;

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
      className={`flex flex-col gap-3 border-t border-neutral-200 bg-neutral-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-end ${className}`}
    >
      <p className="text-xs text-neutral-500 sm:mr-auto">
        Showing <span className="font-semibold text-neutral-800">{startRecord}</span>
        –<span className="font-semibold text-neutral-800">{endRecord}</span> of{" "}
        <span className="font-semibold text-neutral-800">{totalRecords}</span> records
      </p>

      <div className="flex items-center gap-1.5">
        <label
          htmlFor="pagination-page-size"
          className="text-xs font-medium text-neutral-500"
        >
          Rows per page
        </label>
        <select
          id="pagination-page-size"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="select-field h-8 min-w-0 py-0 text-xs"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1">
        <NavButton
          label="First"
          icon={ChevronsLeft}
          onClick={() => goTo(1)}
          disabled={page === 1}
        />
        <NavButton
          label="Previous"
          icon={ChevronLeft}
          onClick={() => goTo(page - 1)}
          disabled={page === 1}
          showLabel
        />

        <div className="flex items-center gap-0.5">
          {pageWindow.map((p, i) =>
            p === "…" ? (
              <span
                key={`ellipsis-${i}`}
                className="px-1.5 text-xs text-neutral-400"
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
                className={`h-8 min-w-[2rem] rounded-lg px-2 text-xs font-semibold transition ${
                  p === page
                    ? "bg-primary-600 text-white shadow-sm"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {p}
              </button>
            )
          )}
        </div>

        <NavButton
          label="Next"
          icon={ChevronRight}
          onClick={() => goTo(page + 1)}
          disabled={page === safeTotalPages}
          showLabel
          trailingIcon
        />
        <NavButton
          label="Last"
          icon={ChevronsRight}
          onClick={() => goTo(safeTotalPages)}
          disabled={page === safeTotalPages}
        />
      </div>
    </div>
  );
}

function NavButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  showLabel = false,
  trailingIcon = false,
}: {
  label: string;
  icon: typeof ChevronLeft;
  onClick: () => void;
  disabled: boolean;
  showLabel?: boolean;
  trailingIcon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-8 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {!trailingIcon && <Icon className="h-3.5 w-3.5" />}
      {showLabel && <span className="hidden sm:inline">{label}</span>}
      {trailingIcon && <Icon className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * Builds a windowed page-number list with ellipses, e.g. for page 5 of 20:
 * `[1, "…", 3, 4, 5, 6, 7, "…", 20]`. Always keeps the first and last page
 * visible plus up to 2 neighbours on either side of the current page.
 */
function buildPageWindow(
  current: number,
  total: number
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
