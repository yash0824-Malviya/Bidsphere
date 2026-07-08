import { useQuery } from "@tanstack/react-query";

import { fetchServerTimeMs } from "../api/erpnext";

/**
 * Difference (server − client) in milliseconds, used to synchronize countdowns
 * to server time instead of the (possibly skewed) browser clock.
 *
 * Fetched once and cached for the session. Returns 0 while loading or when the
 * server time can't be resolved, so callers can add it unconditionally.
 */
export function useServerTimeOffset(): number {
  const { data } = useQuery({
    queryKey: ["server-time-offset"],
    queryFn: async () => {
      const t0 = Date.now();
      const serverMs = await fetchServerTimeMs();
      const t1 = Date.now();
      if (serverMs == null) return 0;
      // Anchor to the midpoint of the round-trip to cancel most network latency.
      const clientMid = t0 + (t1 - t0) / 2;
      return serverMs - clientMid;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return data ?? 0;
}
