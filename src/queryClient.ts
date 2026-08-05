import { QueryClient } from "@tanstack/react-query";

import {
  queryRetryDelay,
  queryRetryPolicy,
} from "./utils/apiReliability";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: queryRetryPolicy,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      /** Keep showing prior data while a slow refetch runs — avoids flash errors. */
      throwOnError: false,
    },
    mutations: {
      /** Avoid duplicate side-effects — queries retry; mutations do not. */
      retry: false,
    },
  },
});
