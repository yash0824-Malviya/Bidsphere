/**
 * Activity timeline for quote-round creation and supplier invitations.
 */

import { memo } from "react";
import { Clock3, GitBranch, Mail, Users } from "lucide-react";

import type { RfqRoundActivityEntry } from "../../api/rfqRoundActivity";
import { formatDate } from "../../utils/format";
import { formatRfqRoundLabel } from "../../utils/rfqRoundTracking";

function iconFor(type: RfqRoundActivityEntry["type"]) {
  if (type === "suppliers_invited") return Users;
  if (type === "invitation_email") return Mail;
  return GitBranch;
}

function toneFor(type: RfqRoundActivityEntry["type"]) {
  if (type === "invitation_email") return "bg-amber-50 text-amber-700";
  if (type === "suppliers_invited") return "bg-sky-50 text-sky-700";
  return "bg-[#EEF3FA] text-[#1F3A6D]";
}

export interface RfqRoundActivityTimelineProps {
  entries: RfqRoundActivityEntry[];
}

function RfqRoundActivityTimeline({ entries }: RfqRoundActivityTimelineProps) {
  if (entries.length === 0) return null;

  return (
    <section className="rfq-card overflow-hidden p-4 md:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF3FA] text-[#1F3A6D]">
          <Clock3 className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="rfq-section-title">Activity Timeline</h2>
          <p className="mt-0.5 text-[12px] text-[#64748B]">
            Quote round creation, supplier invitations, and email status
          </p>
        </div>
      </div>

      <ol className="relative space-y-0 border-l border-[#E2E8F0] pl-5">
        {entries.map((entry) => {
          const Icon = iconFor(entry.type);
          return (
            <li key={entry.id} className="relative pb-5 last:pb-0">
              <span
                className={`absolute -left-[1.55rem] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white ${toneFor(
                  entry.type,
                )}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="rounded-xl border border-[#F1F5F9] bg-[#FCFCFD] px-3.5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-[#1E293B]">
                      {entry.message}
                    </p>
                    {entry.detail ? (
                      <p className="mt-0.5 text-[12px] text-[#64748B]">
                        {entry.detail}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#475569] ring-1 ring-[#E2E8F0]">
                    {formatRfqRoundLabel(entry.round_number)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#94A3B8]">
                  <span>{entry.user || "—"}</span>
                  <span>{formatDate(entry.timestamp)}</span>
                  {entry.email_status ? (
                    <span className="font-medium text-[#64748B]">
                      Email: {entry.email_status.replace(/_/g, " ")}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default memo(RfqRoundActivityTimeline);
