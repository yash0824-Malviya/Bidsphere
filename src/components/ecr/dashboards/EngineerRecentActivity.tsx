import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Clock3, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { getECRComments } from "../../../api/ecr";
import type { EngineeringChangeRequest } from "../../../types/erpnext";
import { buildECRActivityEvents, selectECRActivityRecords } from "./engineerEcrActivity";

interface EngineerRecentActivityProps {
  /** Already restricted to the signed-in Engineer's visible records. */
  ecrs: EngineeringChangeRequest[];
  loading?: boolean;
}

export default function EngineerRecentActivity({ ecrs, loading = false }: EngineerRecentActivityProps) {
  const records = useMemo(() => selectECRActivityRecords(ecrs), [ecrs]);
  const query = useQuery({
    queryKey: ["engineer-ecr-activity", records.map((ecr) => [ecr.name, ecr.modified || ecr.creation || ""])],
    queryFn: async () => buildECRActivityEvents(await Promise.all(records.map(async (ecr) => ({
      ecr,
      comments: await getECRComments(ecr.name),
    })))),
    enabled: !loading && records.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const events = query.data ?? [];
  const pending = loading || (records.length > 0 && query.isLoading);

  return (
    <section className="engineer-ecr-activity rounded-xl border border-[#E3E8F0] bg-white" aria-labelledby="engineer-ecr-activity-heading">
      <header className="border-b border-[#E3E8F0] px-5 py-4">
        <h2 id="engineer-ecr-activity-heading" className="text-base font-semibold text-[#0F1B36]">Recent ECR Activity</h2>
        <p className="mt-1 text-xs text-slate-500">Latest updates from your recently updated ECRs.</p>
      </header>
      {pending ? (
        <p role="status" className="px-5 py-5 text-sm text-slate-500">Loading recent activity…</p>
      ) : query.isError ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 text-sm text-slate-500">
          <p>Recent activity is unavailable.</p>
          <button type="button" onClick={() => void query.refetch()} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-[#146CE8] hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#146CE8]">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
          </button>
        </div>
      ) : events.length === 0 ? (
        <p className="px-5 py-5 text-sm text-slate-500">No recent activity.</p>
      ) : (
        <ol className="divide-y divide-[#E3E8F0] px-5" aria-label="Recent ECR activity timeline">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3 py-3.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <Link to={`/ecr/${encodeURIComponent(event.ecrNumber)}`} className="text-[13px] font-semibold text-[#146CE8] hover:underline">{event.ecrNumber}</Link>
                  <time dateTime={event.timestamp} title={new Date(event.time).toLocaleString()} className="text-xs text-slate-500">{formatDistanceToNow(event.time, { addSuffix: true })}</time>
                </div>
                <p className="mt-1 line-clamp-2 break-words text-[13px] leading-5 text-slate-600" title={event.content}>{event.content}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
