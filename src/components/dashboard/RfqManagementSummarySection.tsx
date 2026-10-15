import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import type { RFQListRow } from "../../api/sourcing";
import type { RfqListKpiCounts } from "../../utils/rfqListKpis";
import { formatDate } from "../../utils/format";

interface Props {
  kpis?: RfqListKpiCounts | null;
  rfqs?: RFQListRow[];
  loading?: boolean;
}

export default function RfqManagementSummarySection({
  kpis,
  rfqs = [],
  loading = false,
}: Props) {
  const stats = useMemo(() => {
    let draft = 0;
    let published = 0;
    let awaitingResponses = 0;
    let responsesReceived = 0;
    let underEvaluation = 0;
    let poCreated = 0;
    let closed = 0;

    for (const r of rfqs) {
      const st = (r.status || "").toLowerCase();
      if (st === "draft") draft += 1;
      else if (st === "published" || st === "open" || st === "submitted") published += 1;
      else if (st === "supplier invitation") awaitingResponses += 1;
      else if (st === "response received" || st === "responses") responsesReceived += 1;
      else if (st === "evaluation" || st === "under evaluation" || st === "supplier selection") underEvaluation += 1;
      else if (st === "po created" || st === "ordered") poCreated += 1;
      else if (st === "closed" || st === "completed") closed += 1;
    }

    const total = kpis?.total ?? rfqs.length;

    return {
      total,
      draft,
      published: kpis?.draftOpen ?? published,
      awaitingResponses: kpis?.awaiting ?? awaitingResponses,
      responsesReceived,
      underEvaluation,
      poCreated: kpis?.poCreated ?? poCreated,
      closed: kpis?.closed ?? closed,
    };
  }, [kpis, rfqs]);

  const actionableRfqs = useMemo(() => {
    return rfqs
      .filter((r) => r.status === "Draft" || r.status === "Evaluation" || r.status === "Published" || r.status === "Supplier Invitation")
      .slice(0, 5);
  }, [rfqs]);

  return (
    <section className="w-full rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-[#E2E8F0] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
              RFQ Management
            </h2>
            <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-bold text-[#2563EB]">
              {loading ? "…" : `${stats.total} Total RFQs`}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-[#64748B]">
            Manage quotation requests, supplier invitations, and bid evaluations
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/sourcing/rfq/new"
            className="inline-flex items-center gap-1 rounded-md bg-[#1554D1] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1042B0] no-underline"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Create RFQ</span>
          </Link>
          <Link
            to="/sourcing/rfq"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1554D1] hover:underline ml-2"
          >
            <span>View All RFQs</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 border-b border-[#E2E8F0] bg-[#F8FAFC] p-3 sm:grid-cols-4 md:grid-cols-7 gap-2 text-center text-[12px]">
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Draft</span>
          <span className="text-[16px] font-bold text-[#64748B]">{stats.draft}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Published / Open</span>
          <span className="text-[16px] font-bold text-[#1554D1]">{stats.published}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Responses</span>
          <span className="text-[16px] font-bold text-[#0D9488]">{stats.responsesReceived}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Evaluation</span>
          <span className="text-[16px] font-bold text-[#D97706]">{stats.underEvaluation}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">PO Created</span>
          <span className="text-[16px] font-bold text-[#059669]">{stats.poCreated}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Closed</span>
          <span className="text-[16px] font-bold text-[#475569]">{stats.closed}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Templates</span>
          <Link to="/sourcing/rfq-templates" className="text-[14px] font-bold text-[#1554D1] hover:underline block mt-0.5">
            Manage →
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="w-full max-w-full min-w-0 overflow-hidden">
        <table className="w-full max-w-full table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[28%]" />
            <col className="w-[14%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
            <tr>
              <th className="py-2.5 pl-4 pr-2">RFQ Number</th>
              <th className="py-2.5 px-2">Title / Description</th>
              <th className="py-2.5 px-2">Status</th>
              <th className="py-2.5 px-2">Deadline / Due</th>
              <th className="py-2.5 px-2">Owner</th>
              <th className="py-2.5 pl-2 pr-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading && rfqs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[#64748B]">
                  Loading RFQs...
                </td>
              </tr>
            ) : actionableRfqs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[#64748B]">
                  No active RFQs found.
                </td>
              </tr>
            ) : (
              actionableRfqs.map((rfq) => {
                const isDraft = rfq.status === "Draft";
                const isEvaluation = rfq.status === "Evaluation" || rfq.status === "Supplier Response";
                const title = (rfq as { title?: string }).title || `RFQ ${rfq.name}`;
                const dateVal =
                  (rfq as { schedule_date?: string }).schedule_date ||
                  (rfq as { transaction_date?: string }).transaction_date ||
                  rfq.modified;

                return (
                  <tr key={rfq.name} className="transition-colors hover:bg-[#F8FAFC]">
                    <td className="py-3 pl-4 pr-2 font-semibold text-[#1554D1] truncate">
                      <Link to={`/sourcing/rfq/${encodeURIComponent(rfq.name)}`} className="hover:underline truncate block" title={rfq.name}>
                        {rfq.name}
                      </Link>
                    </td>
                    <td className="py-3 px-2 truncate" title={title}>
                      <span className="truncate block">{title}</span>
                    </td>
                    <td className="py-3 px-2 truncate">
                      <span
                        className={`inline-flex max-w-full items-center truncate rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${
                          isDraft
                            ? "bg-[#F1F5F9] text-[#475569]"
                            : isEvaluation
                              ? "bg-[#FFFBEB] text-[#D97706]"
                              : "bg-[#EFF6FF] text-[#2563EB]"
                        }`}
                        title={rfq.status || "Draft"}
                      >
                        <span className="truncate">{rfq.status || "Draft"}</span>
                      </span>
                    </td>
                    <td className="py-3 px-2 truncate text-[#64748B] text-[12px]" title={dateVal ? formatDate(dateVal) : "—"}>
                      <span className="truncate block">{dateVal ? formatDate(dateVal) : "—"}</span>
                    </td>
                    <td className="py-3 px-2 truncate text-[#475569] text-[12px]" title={rfq.owner || "Procurement Manager"}>
                      <span className="truncate block">{rfq.owner || "Procurement Manager"}</span>
                    </td>
                    <td className="py-3 pl-2 pr-4 text-right">
                      <Link
                        to={`/sourcing/rfq/${encodeURIComponent(rfq.name)}`}
                        className={`inline-flex items-center justify-end gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold no-underline ${
                          isEvaluation
                            ? "bg-[#1554D1] text-white hover:bg-[#1042B0]"
                            : "border border-[#E2E8F0] bg-white text-[#12213F] hover:bg-[#F8FAFC]"
                        }`}
                      >
                        <span className="truncate">{isEvaluation ? "Evaluate Quotes" : "View RFQ"}</span>
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
