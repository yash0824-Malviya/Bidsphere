import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

export interface ActivityRow {
  id: string;
  dateTime: string;
  type: "MR" | "Business Case" | "ECR" | "RFQ" | "Onboarding" | "PO" | "Reverse Bid";
  reference: string;
  activity: string;
  user: string;
  status: string;
  route: string;
}

interface Props {
  activities?: ActivityRow[];
  loading?: boolean;
}

export default function RecentProcurementActivitySection({
  activities = [],
  loading = false,
}: Props) {
  return (
    <section className="w-full rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-[#E2E8F0] p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
              Recent Procurement Activity
            </h2>
            <span className="rounded-full bg-[#F8FAFC] border border-[#E2E8F0] px-2 py-0.5 text-[11px] font-bold text-[#475569]">
              Audit & Event Stream
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-[#64748B]">
            Chronological log of procurement actions, submissions, reviews and updates
          </p>
        </div>
      </div>

      <div className="w-full max-w-full min-w-0 overflow-hidden">
        <table className="w-full max-w-full table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[11%]" />
            <col className="w-[15%]" />
            <col className="w-[30%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
            <tr>
              <th className="py-2.5 pl-4 pr-2">Date / Time</th>
              <th className="py-2.5 px-2">Type</th>
              <th className="py-2.5 px-2">Reference</th>
              <th className="py-2.5 px-2">Activity</th>
              <th className="py-2.5 px-2">User</th>
              <th className="py-2.5 px-2">Status</th>
              <th className="py-2.5 pl-2 pr-4 text-right">View</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading && activities.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[#64748B]">
                  Loading recent activity...
                </td>
              </tr>
            ) : activities.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[#64748B]">
                  No recent activity records found.
                </td>
              </tr>
            ) : (
              activities.map((act) => {
                const typeBg =
                  act.type === "MR"
                    ? "bg-[#EEF4FF] text-[#1554D1]"
                    : act.type === "Business Case"
                      ? "bg-[#EFF6FF] text-[#2563EB]"
                      : act.type === "ECR"
                        ? "bg-[#F5F3FF] text-[#7C3AED]"
                        : act.type === "RFQ"
                          ? "bg-[#F0F9FF] text-[#0284C7]"
                          : act.type === "Onboarding"
                            ? "bg-[#F0FDFA] text-[#0D9488]"
                            : act.type === "Reverse Bid"
                              ? "bg-[#FFFBEB] text-[#D97706]"
                              : "bg-[#ECFDF5] text-[#059669]";

                return (
                  <tr key={act.id + act.reference} className="transition-colors hover:bg-[#F8FAFC]">
                    <td className="py-3 pl-4 pr-2 truncate text-[12px] text-[#64748B]" title={act.dateTime}>
                      <span className="truncate block">{act.dateTime}</span>
                    </td>
                    <td className="py-3 px-2 truncate">
                      <span className={`inline-flex max-w-full items-center truncate rounded px-2 py-0.5 text-[11px] font-bold ${typeBg}`} title={act.type}>
                        <span className="truncate">{act.type}</span>
                      </span>
                    </td>
                    <td className="py-3 px-2 font-semibold text-[#1554D1] truncate">
                      <Link to={act.route} className="hover:underline truncate block" title={act.reference}>
                        {act.reference}
                      </Link>
                    </td>
                    <td className="py-3 px-2 truncate text-[#12213F]" title={act.activity}>
                      <span className="truncate block">{act.activity}</span>
                    </td>
                    <td className="py-3 px-2 text-[#475569] truncate text-[12.5px]" title={act.user}>
                      <span className="truncate block">{act.user}</span>
                    </td>
                    <td className="py-3 px-2 truncate">
                      <span className="inline-flex max-w-full items-center truncate rounded-md bg-[#F1F5F9] px-2 py-0.5 text-[11.5px] font-semibold text-[#475569]" title={act.status}>
                        <span className="truncate">{act.status}</span>
                      </span>
                    </td>
                    <td className="py-3 pl-2 pr-4 text-right">
                      <Link
                        to={act.route}
                        className="inline-flex items-center justify-end gap-0.5 text-[12px] font-semibold text-[#1554D1] hover:underline"
                      >
                        <span>Open</span>
                        <ArrowUpRight className="h-3 w-3 shrink-0" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
