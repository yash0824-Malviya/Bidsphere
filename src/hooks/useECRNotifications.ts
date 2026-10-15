import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, withSilent } from "../api/erpnext";
import { notifyECRStageChange } from "../api/ecrBusinessCase";
import { useAuthStore } from "../store/authStore";
import type { EngineeringChangeRequest } from "../types/erpnext";

const STAGES_BY_ROLE: Partial<Record<string, string[]>> = {
  engineer: ["Technical Approved", "Rejected", "Closed"],
  engineering: ["Engineering Review"],
  finance: ["Finance Review"],
  procurement: ["Procurement BC Review", "ECR Approved", "Procurement Decision"],
  quality: ["Quality Review"],
  program_manager: ["Business Case Approved", "Final ECR Approval"],
};

/** Rebuild role alerts from persisted ECRs, including work assigned in another browser. */
export function useECRNotifications() {
  const user = useAuthStore((state) => state.user);
  const stages = STAGES_BY_ROLE[user?.role ?? ""];
  const query = useQuery({
    queryKey: ["ecr-notifications", user?.role, user?.email],
    enabled: !!user && !!stages,
    queryFn: async () => {
      const filters: unknown[] = [["ecr_workflow_version", "=", "extended_v1"], ["select_pxfp", "in", stages]];
      const params = new URLSearchParams({
        fields: JSON.stringify(["name", "ecr_number", "ecr_workflow_version", "select_pxfp", "ecr_owner", "owner", "modified"]),
        filters: JSON.stringify(filters), limit_page_length: "200", order_by: "modified desc",
      });
      const response = await apiGet<{ data: EngineeringChangeRequest[] } | EngineeringChangeRequest[]>(`/api/resource/Engineering%20Change%20Request?${params}`, withSilent());
      return Array.isArray(response) ? response : response.data ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(() => {
    for (const ecr of query.data ?? []) notifyECRStageChange(ecr, true);
  }, [query.data]);
}
