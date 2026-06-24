import { memo } from "react";
import { Link } from "react-router-dom";
import { Filter } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { RfqPipelineStage } from "../../utils/dashboardUtils";

interface Props {
  stages: RfqPipelineStage[];
  loading?: boolean;
}

function RfqPipelinePanel({ stages, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-[176px] w-full rounded-lg" />;
  }

  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="flex h-[176px] flex-col rounded-lg border border-neutral-200/80 bg-white shadow-sm">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            RFQ Pipeline
          </h3>
        </div>
        <Link
          to="/sourcing/rfq"
          className="text-[10px] font-medium text-primary hover:underline"
        >
          Pipeline
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-3 py-2">
        {stages.map((stage) => {
          const widthPct = Math.max(12, (stage.count / max) * 100);
          return (
            <div key={stage.stage} className="flex items-center gap-2">
              <span className="w-[72px] shrink-0 truncate text-[9px] text-neutral-600">
                {stage.stage}
              </span>
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-neutral-100">
                <div
                  className="flex h-full items-center rounded bg-primary pl-2 transition-all"
                  style={{ width: `${widthPct}%` }}
                >
                  {stage.count > 0 && (
                    <span className="text-[9px] font-bold tabular-nums text-white">
                      {stage.count}
                    </span>
                  )}
                </div>
              </div>
              {stage.count === 0 && (
                <span className="w-4 text-[9px] tabular-nums text-neutral-400">
                  0
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(RfqPipelinePanel);
