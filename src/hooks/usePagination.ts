import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** Standard page-size choices offered across every paginated list page. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_PAGE_SIZE: PageSizeOption = 10;

const PAGE_SIZE_STORAGE_KEY = "bidsphere.pagination.pageSize";

export function readStoredPageSize(
  fallback: PageSizeOption = DEFAULT_PAGE_SIZE,
): PageSizeOption {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(raw)) {
      return raw as PageSizeOption;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export function persistPageSize(pageSize: number) {
  try {
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSize)) {
      localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
    }
  } catch {
    /* ignore */
  }
}

export function normalizePageSize(value: number): PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value)
    ? (value as PageSizeOption)
    : readStoredPageSize();
}

/** ERPNext / API paging helpers */
export function toLimitStart(page: number, pageSize: number): number {
  return Math.max(0, (Math.max(1, page) - 1) * pageSize);
}

export function totalPagesFromCount(
  totalRecords: number,
  pageSize: number,
): number {
  return Math.max(
    1,
    Math.ceil(Math.max(0, totalRecords) / Math.max(1, pageSize)),
  );
}

export interface PaginatedResponse<T> {
  records: T[];
  totalRecords: number;
  totalPages: number;
  currentPage: number;
  page_size: number;
}

export function buildPaginatedResponse<T>(
  records: T[],
  totalRecords: number,
  page: number,
  pageSize: number,
): PaginatedResponse<T> {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = totalPagesFromCount(totalRecords, safePageSize);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  return {
    records,
    totalRecords,
    totalPages,
    currentPage,
    page_size: safePageSize,
  };
}

/** Map `fetchPagedList` / ERPNext result → Pagination props. */
export function pagedListToPaginationProps(result: {
  total_records: number;
  total_pages: number;
  current_page: number;
  page_size: number;
}) {
  return {
    currentPage: result.current_page,
    totalPages: result.total_pages,
    totalRecords: result.total_records,
    pageSize: result.page_size,
  };
}

export interface UsePaginationOptions {
  /** Defaults to stored preference, then 10. */
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
  /** When false, keep state in React only (no URL). Default true. */
  syncUrl?: boolean;
}

export interface UsePaginationResult {
  page: number;
  pageSize: PageSizeOption;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

/**
 * Page + page-size state. Page size is remembered in localStorage.
 * Optionally synced to the URL for refresh / back-forward.
 */
export function usePagination(
  options: UsePaginationOptions = {},
): UsePaginationResult {
  const {
    defaultPageSize,
    pageParam = "page",
    pageSizeParam = "pageSize",
    resetKey,
    syncUrl = true,
  } = options;

  const storedDefault = defaultPageSize ?? readStoredPageSize();
  const [searchParams, setSearchParams] = useSearchParams();
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] =
    useState<PageSizeOption>(storedDefault);

  const rawPage = Number(searchParams.get(pageParam));
  const urlPage =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawPageSize = Number(searchParams.get(pageSizeParam));
  const urlPageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(
    rawPageSize,
  )
    ? (rawPageSize as PageSizeOption)
    : storedDefault;

  const page = syncUrl ? urlPage : localPage;
  const pageSize = syncUrl ? urlPageSize : localPageSize;

  const setPage = (next: number) => {
    const value = Math.max(1, Math.floor(next) || 1);
    if (!syncUrl) {
      setLocalPage(value);
      return;
    }
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set(pageParam, String(value));
        return params;
      },
      { replace: true },
    );
  };

  const setPageSize = (next: number) => {
    const normalized = normalizePageSize(next);
    persistPageSize(normalized);
    if (!syncUrl) {
      setLocalPageSize(normalized);
      setLocalPage(1);
      return;
    }
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set(pageSizeParam, String(normalized));
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
 * Client-side pagination helper: page state + sliced rows.
 * Use when the API returns the full list and the UI pages locally.
 */
export function useClientPagination<T>(
  rows: readonly T[],
  options: UsePaginationOptions = {},
): UseClientPaginationResult<T> {
  const { page, pageSize, setPage, setPageSize } = usePagination(options);
  const totalRecords = rows.length;
  const totalPages = totalPagesFromCount(totalRecords, pageSize);
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
