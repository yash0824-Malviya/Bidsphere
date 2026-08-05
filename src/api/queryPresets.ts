import { keepPreviousData } from "@tanstack/react-query";

import {
  queryRetryDelay,
  queryRetryPolicy,
} from "../utils/apiReliability";

/**
 * Shared React Query option presets for enterprise dashboard performance.
 *
 * - `staleTime` keeps cached data authoritative for a window so navigating
 *   back to a dashboard is instant (no refetch, no spinner).
 * - `placeholderData: keepPreviousData` keeps the last good data on screen
 *   while a background refetch runs — no flicker / layout shift.
 * - `refetchOnWindowFocus: false` avoids surprise refetch storms when the user
 *   tabs back and forth.
 * - Retries (max 2) apply only to network / timeout failures.
 */
export const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 5 * 60_000,
  gcTime: 10 * 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
  refetchOnMount: false,
  placeholderData: keepPreviousData,
  retry: queryRetryPolicy,
  retryDelay: queryRetryDelay,
  throwOnError: false,
} as const;

/**
 * Master data (Suppliers, Item Groups, Warehouses, Departments, UOMs, Cost
 * Centers, Companies, …) changes rarely — cache it aggressively so it is
 * fetched at most once per long session and shared across every screen.
 */
export const MASTER_DATA_QUERY_OPTIONS = {
  staleTime: 30 * 60_000,
  gcTime: 60 * 60_000,
  refetchOnWindowFocus: false,
  placeholderData: keepPreviousData,
  retry: false,
} as const;
