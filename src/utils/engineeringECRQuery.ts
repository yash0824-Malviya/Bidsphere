import { fetchECRList } from "../api/ecr";

/** Keep Engineering Manager dashboards and queues on the same hydrated ECR snapshot. */
export function engineeringECRQueryOptions() {
  return {
    queryKey: ["ecr-list", "engineering", "all"],
    queryFn: () => fetchECRList({ limit: 300 }),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  };
}
