import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchECRList } from "../../../api/ecr";
import ECRKpiCard from "../ECRKpiCard";
import { extendedReviewDashboardCards } from "./RoleECRDashboard";

/** ECR finance workload supplements the existing finance dashboard. */
export default function FinanceECRDashboard() {
  const query = useQuery({
    queryKey: ["ecr-dashboard", "finance", "all"],
    queryFn: () => fetchECRList({ limit: 300 }),
    staleTime: 30_000,
  });
  return (
    <section aria-label="ECR Financial Reviews" className="space-y-3">
      <h2 className="text-sm font-semibold text-neutral-900">ECR Financial Reviews</h2>
      {query.isError ? <p className="text-xs text-rose-700">ECR financial reviews could not be loaded. <button onClick={() => void query.refetch()} className="underline">Retry</button></p>
        : query.isLoading ? <p className="text-xs text-neutral-500">Loading financial reviews…</p>
          : <div className="grid gap-3 sm:grid-cols-2">{extendedReviewDashboardCards("finance", query.data ?? []).map((card) => (
            <Link key={card.label} to={card.to}><ECRKpiCard {...card} /></Link>
          ))}</div>}
    </section>
  );
}
