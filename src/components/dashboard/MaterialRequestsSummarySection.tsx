import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import type { MaterialRequest } from "../../types/erpnext";
import { normalizeWorkflowStatus } from "../../types/materialRequestWorkflow";
import { getLinkedRfqName } from "../../api/materialRequestWorkflow";
import { isMrOverdue } from "../../utils/materialRequestProcurementStatus";
import { formatDate } from "../../utils/format";

interface Props {
  mrs?: MaterialRequest[];
  loading?: boolean;
}

export default function MaterialRequestsSummarySection({
  mrs = [],
  loading = false,
}: Props) {
  const stats = useMemo(() => {
    let awaitingRfq = 0;
    let rfqCreated = 0;
    let inProgress = 0;
    let overdue = 0;
    let highUrgent = 0;
    const today = new Date();

    for (const mr of mrs) {
      const wfStatus = normalizeWorkflowStatus(mr.custom_bidsphere_status || mr.status);
      const hasRFQ = Boolean(mr.custom_linked_rfq || getLinkedRfqName(mr as unknown as Parameters<typeof getLinkedRfqName>[0])) || wfStatus === "RFQ Created";
      const isOver = isMrOverdue(mr.schedule_date, wfStatus, hasRFQ, today);
      const priority = mr.custom_priority || "Medium";

      if (isOver) overdue += 1;
      if (priority === "High") highUrgent += 1;

      if (!hasRFQ && (wfStatus === "Forwarded to Procurement" || wfStatus === "Procurement Required")) {
        awaitingRfq += 1;
      } else if (hasRFQ) {
        rfqCreated += 1;
      } else if (wfStatus !== "Completed" && wfStatus !== "Cancelled") {
        inProgress += 1;
      }
    }

    return {
      total: mrs.length,
      awaitingRfq,
      rfqCreated,
      inProgress,
      overdue,
      highUrgent,
    };
  }, [mrs]);

  const actionableMrs = useMemo(() => {
    const today = new Date();
    return mrs
      .filter((mr) => {
        const wfStatus = normalizeWorkflowStatus(mr.custom_bidsphere_status || mr.status);
        const hasRFQ = Boolean(mr.custom_linked_rfq || getLinkedRfqName(mr as unknown as Parameters<typeof getLinkedRfqName>[0])) || wfStatus === "RFQ Created";
        return !hasRFQ && wfStatus !== "Completed" && wfStatus !== "Cancelled";
      })
      .slice(0, 5)
      .map((mr) => {
        const wfStatus = normalizeWorkflowStatus(mr.custom_bidsphere_status || mr.status);
        const isOver = isMrOverdue(mr.schedule_date, wfStatus, false, today);
        return { mr, isOver, wfStatus };
      });
  }, [mrs]);

  return (
    <section className="w-full rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
      {/* Section Header */}
      <div className="flex flex-col gap-3 border-b border-[#E2E8F0] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
              Material Requests
            </h2>
            <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-bold text-[#2563EB]">
              {loading ? "…" : `${stats.total} Total MRs`}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-[#64748B]">
            Forwarded plant & warehouse demand requiring procurement action
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/material-requests/procurement"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1554D1] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-[#1042B0] transition-colors"
          >
            <span>Process MRs</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/material-requests"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1554D1] hover:underline"
          >
            <span>View All Material Requests</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 border-b border-[#E2E8F0] bg-[#F8FAFC] p-3 sm:grid-cols-3 md:grid-cols-6 gap-2 text-center text-[12px]">
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Total Active</span>
          <span className="text-[16px] font-bold text-[#12213F]">{stats.total}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Awaiting RFQ</span>
          <span className="text-[16px] font-bold text-[#DC2626]">{stats.awaitingRfq}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">RFQ Created</span>
          <span className="text-[16px] font-bold text-[#059669]">{stats.rfqCreated}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">In Progress</span>
          <span className="text-[16px] font-bold text-[#2563EB]">{stats.inProgress}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Overdue</span>
          <span className="text-[16px] font-bold text-[#DC2626]">{stats.overdue}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">High / Urgent</span>
          <span className="text-[16px] font-bold text-[#D97706]">{stats.highUrgent}</span>
        </div>
      </div>

      {/* Table */}
      <div className="w-full max-w-full min-w-0 overflow-hidden">
        <table className="w-full max-w-full table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[18%]" />
            <col className="w-[24%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
            <tr>
              <th className="py-2.5 pl-4 pr-2">MR Number</th>
              <th className="py-2.5 px-2">Type</th>
              <th className="py-2.5 px-2">Priority</th>
              <th className="py-2.5 px-2">Required Date</th>
              <th className="py-2.5 px-2">Status</th>
              <th className="py-2.5 pl-2 pr-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading && mrs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[#64748B]">
                  Loading material requests...
                </td>
              </tr>
            ) : actionableMrs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[#64748B]">
                  No material requests currently awaiting RFQ creation.
                </td>
              </tr>
            ) : (
              actionableMrs.map(({ mr, isOver, wfStatus }) => (
                <tr key={mr.name} className="transition-colors hover:bg-[#F8FAFC]">
                  <td className="py-3 pl-4 pr-2 font-semibold text-[#1554D1] truncate">
                    <Link to={`/material-requests/${encodeURIComponent(mr.name)}`} className="hover:underline truncate block" title={mr.name}>
                      {mr.name}
                    </Link>
                  </td>
                  <td className="py-3 px-2 text-[#475569] truncate" title={mr.material_request_type || "Purchase"}>
                    <span className="truncate block">{mr.material_request_type || "Purchase"}</span>
                  </td>
                  <td className="py-3 px-2">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-bold ${
                        mr.custom_priority === "High"
                          ? "bg-[#FEF2F2] text-[#DC2626]"
                          : "bg-[#F1F5F9] text-[#475569]"
                      }`}
                    >
                      {mr.custom_priority || "Medium"}
                    </span>
                  </td>
                  <td className="py-3 px-2 truncate">
                    <div className="flex items-center gap-1 truncate">
                      <span className="text-[#12213F] truncate">
                        {mr.schedule_date ? formatDate(mr.schedule_date) : "—"}
                      </span>
                      {isOver && (
                        <span className="shrink-0 rounded bg-[#FEF2F2] px-1 py-0.5 text-[9.5px] font-extrabold tracking-wide text-[#DC2626]">
                          OVERDUE
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-2 truncate">
                    <span
                      className="inline-flex max-w-full items-center truncate rounded-md bg-[#FFFBEB] px-2 py-0.5 text-[11.5px] font-semibold text-[#D97706]"
                      title={wfStatus === "Forwarded to Procurement" || wfStatus === "Procurement Required"
                        ? "Awaiting RFQ Creation"
                        : wfStatus}
                    >
                      <span className="truncate">
                        {wfStatus === "Forwarded to Procurement" || wfStatus === "Procurement Required"
                          ? "Awaiting RFQ Creation"
                          : wfStatus}
                      </span>
                    </span>
                  </td>
                  <td className="py-3 pl-2 pr-4 text-right">
                    <Link
                      to={`/sourcing/rfq/new?mr=${encodeURIComponent(mr.name)}`}
                      className="inline-flex items-center justify-end gap-1 rounded-md bg-[#1554D1] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#1042B0] no-underline"
                    >
                      <Plus className="h-3 w-3 shrink-0" />
                      <span>Create RFQ</span>
                      <ArrowUpRight className="h-3 w-3 shrink-0" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
