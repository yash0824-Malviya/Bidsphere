import {
  CheckCircle2,
  Circle,
  CircleDot,
  Clock3,
  AlertCircle,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import type { ECRComment } from "../../api/ecr";
import type { ECRStatus, EngineeringChangeRequest } from "../../types/erpnext";
import {
  getECRDecisionHistory,
  getECRApprovalTimeline,
  type ApprovalTimelineItem,
} from "./ecrDetailModel";

interface ECRApprovalHistoryProps {
  status?: ECRStatus | string | null;
  ecr?: Partial<EngineeringChangeRequest> | null;
  comments?: ECRComment[];
}

function formatDecisionDate(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function findLegacyComment(
  comments: ECRComment[],
  item: ApprovalTimelineItem,
): ECRComment | undefined {
  const stageTerm = item.stage.toLowerCase();
  const fieldTerms: Record<ApprovalTimelineItem["stage"], string[]> = {
    "Engineering Review": ["technical feasibility", "engineering impact"],
    "Procurement Review": ["procurement assessment", "supplier requirement", "rfq requirement"],
    "RFQ Pending": ["rfq creation", "create rfq"],
  };

  return [...comments].reverse().find((comment) => {
    const content = String(comment.content ?? "").toLowerCase();
    return content.includes(stageTerm) || fieldTerms[item.stage].some((term) => content.includes(term));
  });
}

function stateLabel(item: ApprovalTimelineItem): string {
  switch (item.state) {
    case "completed":
      return item.stage === "RFQ Pending" ? "RFQ Created" : "Approved";
    case "current":
      return "Pending";
    case "unassigned":
      return "Not Assigned";
    case "sent-back":
      return "Sent Back";
    case "rejected":
      return "Rejected";
    default:
      return "Upcoming";
  }
}

function StateIcon({ state }: { state: ApprovalTimelineItem["state"] }) {
  if (state === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === "current") return <CircleDot className="h-4 w-4 text-primary-600" />;
  if (state === "unassigned") return <AlertCircle className="h-4 w-4 text-amber-600" />;
  if (state === "sent-back") return <RotateCcw className="h-4 w-4 text-amber-600" />;
  if (state === "rejected") return <XCircle className="h-4 w-4 text-rose-600" />;
  return <Circle className="h-4 w-4 text-neutral-300" />;
}

export default function ECRApprovalHistory({
  status,
  ecr,
  comments = [],
}: ECRApprovalHistoryProps) {
  const timeline = getECRApprovalTimeline(status, ecr?.approval_requirements ?? []);
  const decisionHistory = getECRDecisionHistory(ecr?.approval_requirements ?? []);

  return (
    <section className="space-y-3" aria-labelledby="ecr-approval-history-title">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
        <div className="flex items-start gap-2 border-b border-neutral-100 pb-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
          <div>
            <h2 id="ecr-approval-history-title" className="text-sm font-bold text-neutral-900">
              Approval History
            </h2>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              Completed decisions are read-only. Only the current stage is assigned for action.
            </p>
          </div>
        </div>

        <ol className="mt-3 space-y-0" aria-label="Sequential ECR approval history">
          {timeline.map((item, index) => {
            const legacyComment = item.decision?.comments
              ? undefined
              : findLegacyComment(comments, item);
            const decisionComment = item.decision?.comments || legacyComment?.content;
            const approver = item.decision?.approver || legacyComment?.comment_by || legacyComment?.owner;
            const decisionDate = formatDecisionDate(
              item.decision?.approval_date || legacyComment?.creation,
            );
            const emphasized = item.state === "current";
            const negative = item.state === "rejected" || item.state === "sent-back" || item.state === "unassigned";

            return (
              <li key={item.stage} className="relative flex gap-3 pb-3 last:pb-0">
                {index < timeline.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={`absolute left-[7px] top-5 h-[calc(100%-12px)] w-px ${
                      item.state === "completed" ? "bg-emerald-200" : "bg-neutral-200"
                    }`}
                  />
                ) : null}
                <span className="relative z-10 mt-3 shrink-0 bg-white">
                  <StateIcon state={item.state} />
                </span>
                <div
                  className={`min-w-0 flex-1 rounded-lg px-3 py-2.5 ${
                    emphasized
                      ? "border border-primary-200 bg-primary-50/60 ring-1 ring-primary-100"
                      : negative
                        ? "border border-neutral-200 bg-neutral-50/60"
                        : "border border-transparent bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-neutral-900">{item.stage}</p>
                      <p className="text-[11px] text-neutral-500">{item.role}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        item.state === "completed"
                          ? "bg-emerald-50 text-emerald-700"
                          : item.state === "current"
                             ? "bg-primary-600 text-white"
                            : item.state === "unassigned"
                              ? "bg-amber-50 text-amber-800"
                            : item.state === "rejected"
                              ? "bg-rose-50 text-rose-700"
                              : item.state === "sent-back"
                                ? "bg-amber-50 text-amber-800"
                                : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {stateLabel(item)}
                    </span>
                  </div>

                  {item.state === "current" ? (
                    <p className="mt-1.5 text-[11px] font-medium text-primary-800">
                      Assigned to {item.role} for {item.stage === "RFQ Pending" ? "RFQ creation" : "review and decision"}.
                    </p>
                  ) : item.state === "unassigned" ? (
                    <p className="mt-1.5 text-[11px] font-medium text-amber-800">
                      No active approval task is assigned for this workflow stage.
                    </p>
                  ) : item.state === "upcoming" ? (
                    <p className="mt-1.5 text-[11px] text-neutral-400">
                      Available after the preceding review is approved.
                    </p>
                  ) : (
                    <div className="mt-1.5 space-y-1 text-[11px] text-neutral-600">
                      <p>
                        {stateLabel(item)}{approver ? ` by ${approver}` : ""}
                        {decisionDate ? ` · ${decisionDate}` : ""}
                      </p>
                      {decisionComment ? (
                        <p className="whitespace-pre-wrap rounded-md bg-neutral-50 px-2.5 py-2 text-xs leading-relaxed text-neutral-700">
                          {decisionComment}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {decisionHistory.length > 0 ? (
          <div className="mt-3 border-t border-neutral-100 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">
              Decision Log
            </p>
            <ol className="mt-2 space-y-2" aria-label="Complete ECR decision log">
              {decisionHistory.map((decision, index) => (
                <li
                  key={decision.name || `${decision.approval_role}-${decision.status}-${index}`}
                  className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-800">
                      {decision.approval_role || "Workflow Review"} · {decision.status}
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      {formatDecisionDate(decision.approval_date)}
                    </span>
                  </div>
                  {decision.approver ? (
                    <p className="mt-0.5">Decision by {decision.approver}</p>
                  ) : null}
                  {decision.comments ? (
                    <p className="mt-1 whitespace-pre-wrap text-neutral-700">{decision.comments}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2.5">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-neutral-900">
            <MessageSquare className="h-4 w-4 text-neutral-500" />
            Activity
          </h2>
          <span className="text-[11px] text-neutral-400">
            {comments.length} update{comments.length === 1 ? "" : "s"}
          </span>
        </div>

        {comments.length === 0 ? (
          <p className="py-5 text-center text-xs text-neutral-400">No recorded activity yet.</p>
        ) : (
          <ol className="mt-3 space-y-3" aria-label="ECR activity timeline">
            {comments.map((comment) => (
              <li key={comment.name} className="flex gap-3 text-xs">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
                  <Clock3 className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1 border-b border-neutral-100 pb-3 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-semibold text-neutral-800">
                      {comment.comment_by || comment.owner || "System"}
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      {formatDecisionDate(comment.creation)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-neutral-700">
                    {comment.content}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
