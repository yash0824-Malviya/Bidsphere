import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  FileCode,
  FileText,
  Plus,
} from "lucide-react";
import type { ReverseBidding } from "../../types/reverseBidding";
import type { ReverseBiddingStats } from "../../api/reverseBidding";
import { formatDate } from "../../utils/format";

export interface SourcingStats {
  draft: number;
  published: number;
  underReview: number;
  closed: number;
  total: number;
}

interface Props {
  rfiStats?: SourcingStats | null;
  rfpStats?: SourcingStats | null;
  reverseBids?: ReverseBidding[];
  reverseBiddingStats?: ReverseBiddingStats | null;
  loading?: boolean;
}

export default function RfiRfpAndReverseBiddingSection({
  rfiStats,
  rfpStats,
  reverseBids = [],
  reverseBiddingStats,
  loading = false,
}: Props) {
  const activeAuctions = useMemo(() => {
    return reverseBids.slice(0, 4);
  }, [reverseBids]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 min-w-0 w-full max-w-full">
      {/* LEFT: RFI / RFP */}
      <section className="flex flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden min-w-0 w-full max-w-full">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#E2E8F0] p-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
                  RFI / RFP Sourcing
                </h3>
              </div>
              <p className="mt-0.5 text-[12px] text-[#64748B]">
                Information requests and complex proposal solicitations
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/sourcing/rfi"
                className="text-[12px] font-semibold text-[#1554D1] hover:underline"
              >
                RFI
              </Link>
              <span className="text-[#CBD5E1]">|</span>
              <Link
                to="/sourcing/rfp"
                className="text-[12px] font-semibold text-[#1554D1] hover:underline"
              >
                RFP
              </Link>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* RFI Block */}
            <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFCFF] p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#FDF2F8] text-[#DB2777]">
                    <FileText className="h-4 w-4" />
                  </div>
                  <span className="text-[13.5px] font-bold text-[#12213F]">
                    Request for Information (RFI)
                  </span>
                </div>
                <Link
                  to="/sourcing/rfi/new"
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#1554D1] hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  <span>New RFI</span>
                </Link>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11.5px]">
                <div className="rounded bg-white p-2 border border-[#E2E8F0]">
                  <span className="text-[#64748B] block text-[10.5px]">Total</span>
                  <span className="text-[14px] font-bold text-[#12213F]">
                    {rfiStats?.total ?? 0}
                  </span>
                </div>
                <div className="rounded bg-white p-2 border border-[#E2E8F0]">
                  <span className="text-[#64748B] block text-[10.5px]">Open / Published</span>
                  <span className="text-[14px] font-bold text-[#1554D1]">
                    {rfiStats?.published ?? 0}
                  </span>
                </div>
                <div className="rounded bg-white p-2 border border-[#E2E8F0]">
                  <span className="text-[#64748B] block text-[10.5px]">Under Review</span>
                  <span className="text-[14px] font-bold text-[#0D9488]">
                    {rfiStats?.underReview ?? 0}
                  </span>
                </div>
                <div className="rounded bg-white p-2 border border-[#E2E8F0]">
                  <span className="text-[#64748B] block text-[10.5px]">Closed</span>
                  <span className="text-[14px] font-bold text-[#64748B]">
                    {rfiStats?.closed ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* RFP Block */}
            <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFCFF] p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#FFF1F2] text-[#E11D48]">
                    <FileCode className="h-4 w-4" />
                  </div>
                  <span className="text-[13.5px] font-bold text-[#12213F]">
                    Request for Proposal (RFP)
                  </span>
                </div>
                <Link
                  to="/sourcing/rfp/new"
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#1554D1] hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  <span>New RFP</span>
                </Link>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11.5px]">
                <div className="rounded bg-white p-2 border border-[#E2E8F0]">
                  <span className="text-[#64748B] block text-[10.5px]">Total</span>
                  <span className="text-[14px] font-bold text-[#12213F]">
                    {rfpStats?.total ?? 0}
                  </span>
                </div>
                <div className="rounded bg-white p-2 border border-[#E2E8F0]">
                  <span className="text-[#64748B] block text-[10.5px]">Open / Published</span>
                  <span className="text-[14px] font-bold text-[#1554D1]">
                    {rfpStats?.published ?? 0}
                  </span>
                </div>
                <div className="rounded bg-white p-2 border border-[#E2E8F0]">
                  <span className="text-[#64748B] block text-[10.5px]">Evaluation</span>
                  <span className="text-[14px] font-bold text-[#D97706]">
                    {rfpStats?.underReview ?? 0}
                  </span>
                </div>
                <div className="rounded bg-white p-2 border border-[#E2E8F0]">
                  <span className="text-[#64748B] block text-[10.5px]">Closed</span>
                  <span className="text-[14px] font-bold text-[#64748B]">
                    {rfpStats?.closed ?? 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RIGHT: Reverse Bidding */}
      <section className="flex flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden min-w-0 w-full max-w-full">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#E2E8F0] p-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
                  Reverse Bidding
                </h3>
                <span className="rounded-full bg-[#FFFBEB] px-2 py-0.5 text-[11px] font-bold text-[#D97706]">
                  {loading ? "…" : `${reverseBiddingStats?.live ?? 0} Live`}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-[#64748B]">
                Competitive supplier reverse auction events and live biddings
              </p>
            </div>
            <Link
              to="/reverse-bidding"
              className="text-[12px] font-semibold text-[#1554D1] hover:underline inline-flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-3 border-b border-[#E2E8F0] bg-[#F8FAFC] p-3 gap-2 text-center text-[11.5px]">
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Active / Live</span>
              <span className="text-[15px] font-bold text-[#DC2626]">
                {reverseBiddingStats?.live ?? 0}
              </span>
            </div>
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Scheduled</span>
              <span className="text-[15px] font-bold text-[#2563EB]">
                {reverseBiddingStats?.scheduled ?? 0}
              </span>
            </div>
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Completed</span>
              <span className="text-[15px] font-bold text-[#059669]">
                {reverseBiddingStats?.completed ?? 0}
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="w-full max-w-full min-w-0 overflow-hidden">
            <table className="w-full max-w-full table-fixed border-collapse text-left text-[12.5px]">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[30%]" />
                <col className="w-[20%]" />
                <col className="w-[16%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
                <tr>
                  <th className="py-2.5 pl-4 pr-2">Auction ID</th>
                  <th className="py-2.5 px-2">Title</th>
                  <th className="py-2.5 px-2">Status</th>
                  <th className="py-2.5 px-2">Start Date</th>
                  <th className="py-2.5 pl-2 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {loading && reverseBids.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-5 text-center text-[#64748B]">
                      Loading auctions...
                    </td>
                  </tr>
                ) : activeAuctions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-5 text-center text-[#64748B]">
                      No active reverse bidding events found.
                    </td>
                  </tr>
                ) : (
                  activeAuctions.map((a) => {
                    const title = (a as { title?: string }).title || a.rfq || a.name;
                    const startTime =
                      (a as { start_time?: string }).start_time ||
                      (a as { scheduled_start_time?: string }).scheduled_start_time ||
                      (a as { auction_start_time?: string }).auction_start_time;

                    return (
                      <tr key={a.name} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="py-2.5 pl-4 pr-2 font-semibold text-[#1554D1] truncate">
                          <Link
                            to={`/reverse-bidding/${encodeURIComponent(a.name)}`}
                            className="hover:underline truncate block"
                            title={a.name}
                          >
                            {a.name}
                          </Link>
                        </td>
                        <td className="py-2.5 px-2 truncate" title={title}>
                          <span className="truncate block">{title}</span>
                        </td>
                        <td className="py-2.5 px-2 truncate">
                          <span
                            className={`inline-flex max-w-full items-center truncate rounded px-2 py-0.5 text-[11px] font-semibold ${
                              a.auction_status === "Live"
                                ? "bg-[#FEF2F2] text-[#DC2626]"
                                : a.auction_status === "Scheduled"
                                  ? "bg-[#EFF6FF] text-[#2563EB]"
                                  : "bg-[#F1F5F9] text-[#475569]"
                            }`}
                            title={a.auction_status || "Draft"}
                          >
                            <span className="truncate">{a.auction_status || "Draft"}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-[#64748B] truncate text-[11.5px]" title={startTime ? formatDate(startTime) : "—"}>
                          <span className="truncate block">{startTime ? formatDate(startTime) : "—"}</span>
                        </td>
                        <td className="py-2.5 pl-2 pr-4 text-right">
                          <Link
                            to={`/reverse-bidding/${encodeURIComponent(a.name)}`}
                            className="inline-flex items-center justify-end gap-0.5 text-[11.5px] font-semibold text-[#1554D1] hover:underline"
                          >
                            <span>Manage</span>
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
        </div>
      </section>
    </div>
  );
}
