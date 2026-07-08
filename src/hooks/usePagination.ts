import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/** Standard page-size choices offered across every paginated list page. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_PAGE_SIZE: PageSizeOption = 10;

export interface UsePaginationOptions {
  /** Defaults to 10 per the Procurement System pagination spec. */
  defaultPageSize?: PageSizeOption;
  /** URL query param name for the page number. */
  pageParam?: string;
  /** URL query param name for the page size. */
  pageSizeParam?: string;
  /**
   * Opaque value representing the current filters/search/sort. Whenever this
   * changes (e.g. the user types a search term or picks a status filter),
   * pagination resets to page 1 — otherwise a filter change could strand the
   * user on a now-empty page. Pass something stable, e.g. `JSON.stringify(filters)`.
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
 * Page + page-size state for a server-paginated list, persisted in the URL
 * query string (`?page=2&pageSize=20` by default) so it survives a refresh
 * or back/forward navigation. Multiple tables on the same route can each get
 * their own independent state via distinct `pageParam`/`pageSizeParam` names.
 */
export function usePagination(
  options: UsePaginationOptions = {}
): UsePaginationResult {
  const {
    defaultPageSize = DEFAULT_PAGE_SIZE,
    pageParam = "page",
    pageSizeParam = "pageSize",
    resetKey,
  } = options;

  const [searchParams, setSearchParams] = useSearchParams();

  const rawPage = Number(searchParams.get(pageParam));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

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
      { replace: true }
    );
  };

  const setPageSize = (next: number) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set(pageSizeParam, String(next));
        // Changing page size while sitting on, say, page 5 of a 10-per-page
        // list is almost always disorienting once page size jumps — always
        // land back on page 1.
        params.set(pageParam, "1");
        return params;
      },
      { replace: true }
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
