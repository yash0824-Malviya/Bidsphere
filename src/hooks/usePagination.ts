import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/** Standard page-size choices offered across every paginated list page. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_PAGE_SIZE: PageSizeOption = 10;

export interface UsePaginationOptions {
  /** Defaults to 10 per the enterprise pagination spec. */
  defaultPageSize?: PageSizeOption;
  /** URL query param name for the page number. */
  pageParam?: string;
  /** URL query param name for the page size. */
  pageSizeParam?: string;
  /**
   * Opaque value representing the current filters/search/sort. Whenever this
   * changes, pagination resets to page 1.
   */
  resetKey?: unknown;
}

export interface UsePaginationResult {
  page: number;
  pageSize: PageSizeOption;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

/**
 * Page + page-size state persisted in the URL query string so it survives
 * refresh and browser back/forward navigation.
 */
export function usePagination(
  options: UsePaginationOptions = {},
): UsePaginationResult {
  const {
    defaultPageSize = DEFAULT_PAGE_SIZE,
    pageParam = "page",
    pageSizeParam = "pageSize",
    resetKey,
  } = options;

  const [searchParams, setSearchParams] = useSearchParams();

  const rawPage = Number(searchParams.get(pageParam));
  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawPageSize = Number(searchParams.get(pageSizeParam));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPageSize)
    ? (rawPageSize as PageSizeOption)
    : defaultPageSize;

  const setPage = (next: number) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set(pageParam, String(Math.max(1, Math.floor(next) || 1)));
        return params;
      },
      { replace: true },
    );
  };

  const setPageSize = (next: number) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set(pageSizeParam, String(next));
        params.set(pageParam, "1");
        return params;
      },
      { replace: true },
    );
  };

  const resetKeyRef = useRef(resetKey);
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      resetKeyRef.current = resetKey;
      return;
    }
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return { page, pageSize, setPage, setPageSize };
}

export interface UseClientPaginationResult<T> extends UsePaginationResult {
  totalRecords: number;
  totalPages: number;
  /** Safe current page clamped to totalPages. */
  currentPage: number;
  pageRows: T[];
}

/**
 * Client-side pagination helper: URL-backed page state + sliced rows.
 * Use when the API returns the full list and the UI pages locally.
 */
export function useClientPagination<T>(
  rows: readonly T[],
  options: UsePaginationOptions = {},
): UseClientPaginationResult<T> {
  const { page, pageSize, setPage, setPageSize } = usePagination(options);
  const totalRecords = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageRows = useMemo(
    () =>
      rows.slice((currentPage - 1) * pageSize, currentPage * pageSize) as T[],
    [rows, currentPage, pageSize],
  );

  return {
    page,
    pageSize,
    setPage,
    setPageSize,
    totalRecords,
    totalPages,
    currentPage,
    pageRows,
  };
}
