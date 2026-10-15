import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { clmRecordRoute, type ClmRecord } from "../../api/clm";
import { rfqClmRequestValue, rfqClmRequestWorkflowView } from "../../utils/rfqClmWorkflow";

function awardValue(record: ClmRecord): string {
  const amount = rfqClmRequestValue(record);
  if (amount === undefined) return "—";
  return `${String(record.currency || "")} ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
}

function formatAge(dateStr?: string): string {
  if (!dateStr) return "Recent";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Recent";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "Just now";
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) {
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    return hours <= 1 ? "Just now" : `${hours}h ago`;
  }
  return `${days}d ago`;
}

export default function PendingClmRequestsCard({
  records,
  loading,
  error,
  onRetry,
}: {
  records: ClmRecord[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const pending = records.flatMap((record) => {
    const workflow = rfqClmRequestWorkflowView(record);
    return workflow ? [{ record, workflow }] : [];
  });

  return (
    <section
      aria-label="Pending CLM Requests"
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Pending CLM Requests{" "}
              <span className="ml-2 tabular-nums">
                {loading || error ? "—" : pending.length}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Action items assigned to Procurement Team across contract requests & awards
            </p>
          </div>
        </div>
        <Link
          to="/contract-requests"
          className="text-xs font-semibold text-primary-700 hover:underline"
        >
          View Contract Requests →
        </Link>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <span>
            {error instanceof Error
              ? error.message
              : "Unable to load the Contract Request queue. Refresh and try again."}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus:outline-none"
            >
              Retry
            </button>
          )}
        </div>
      ) : loading ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-slate-500">Loading assigned requests…</p>
          <div className="h-16 w-full animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : pending.length ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {pending.slice(0, 5).map(({ record, workflow }) => (
            <li
              key={record.name}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-sm font-medium text-slate-900">
                    {workflow.rfq}
                  </p>
                  <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                    Role: {workflow.assigned_role === "procurement_team" ? "Procurement Team" : workflow.assigned_role || "Procurement"}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Age: {formatAge(record.creation || record.modified)}
                  </span>
                </div>
                <p className="mt-1 break-words text-xs text-slate-500">
                  Contract Request: {record.name} ·{" "}
                  {workflow.supplier ||
                    (workflow.initialRequest ? "Not yet awarded" : "—")}
                </p>
                <p className="mt-1 break-words text-xs text-slate-500">
                  Award: {workflow.award || (workflow.initialRequest ? "Pending" : "—")} ·{" "}
                  Award Value: {awardValue(record)}
                </p>
                {workflow.initialRequest && (
                  <>
                    <p className="mt-1 break-words text-xs text-slate-500">
                      Department: {workflow.department || "—"} · Requester:{" "}
                      {workflow.requester || "—"}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-500">
                      Contract Required: {workflow.contractRequired} · Status:{" "}
                      {workflow.status}
                    </p>
                  </>
                )}
                <p className="mt-1 break-words text-xs text-slate-500">
                  Current Stage:{" "}
                  {workflow.initialRequest
                    ? workflow.stage
                    : "Pending Procurement Team"}
                </p>
              </div>
              <Link
                to={clmRecordRoute("Contract Request", record.name)}
                className="shrink-0 rounded-lg border border-primary-200 px-3 py-2 text-xs font-semibold text-primary-700 transition hover:bg-primary-50"
              >
                {workflow.initialRequest && !workflow.award
                  ? "Open request"
                  : "Review & Create Contract"}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          No CLM requests are awaiting Procurement Team.
        </p>
      )}
    </section>
  );
}
