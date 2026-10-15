import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Plus,
} from "lucide-react";
import type { BusinessCase } from "../../types/businessIntake";
import type { EngineeringChangeRequest } from "../../types/erpnext";
import { getECRCurrentStage, isECRActionableForRole, matchesECRQueueFilter, getECRListActionLabel, getECRListActionRoute } from "../../config/ecrQueues";

interface Props {
  businessCases?: BusinessCase[];
  ecrs?: EngineeringChangeRequest[];
  loading?: boolean;
}

export default function BusinessCasesAndEcrSection({
  businessCases = [],
  ecrs = [],
  loading = false,
}: Props) {
  const bcStats = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;

    for (const bc of businessCases) {
      const st = (bc.workflow_status || (bc as { status?: string }).status || "").toLowerCase();
      if (st.includes("approved")) approved += 1;
      else if (st.includes("rejected")) rejected += 1;
      else pending += 1;
    }

    return {
      total: businessCases.length,
      pending,
      approved,
      rejected,
    };
  }, [businessCases]);

  const ecrStats = useMemo(() => {
    let awaitingRfq = 0;
    let inReview = 0;
    let completed = 0;

    for (const ecr of ecrs) {
      const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
      if (matchesECRQueueFilter("rfq-pending", "procurement", ecr)) {
        awaitingRfq += 1;
      } else if (stage === "Closed" || stage === "RFQ") {
        completed += 1;
      } else {
        inReview += 1;
      }
    }

    return {
      total: ecrs.length,
      awaitingRfq,
      inReview,
      completed,
    };
  }, [ecrs]);

  const recentBc = useMemo(() => {
    return businessCases.slice(0, 4);
  }, [businessCases]);

  const actionableEcrs = useMemo(() => {
    return ecrs
      .filter((ecr) => isECRActionableForRole("procurement", ecr))
      .slice(0, 4);
  }, [ecrs]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 min-w-0 w-full max-w-full">
      {/* 1. BUSINESS CASES */}
      <section className="flex flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden min-w-0 w-full max-w-full">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#E2E8F0] p-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
                  Business Cases & Sourcing Intake
                </h3>
                <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-bold text-[#2563EB]">
                  {loading ? "…" : `${bcStats.total} Cases`}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-[#64748B]">
                Intake proposals requiring procurement review, feasibility & budget checks
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/intake/business-cases/new"
                className="inline-flex items-center gap-1 rounded-md bg-[#1554D1] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#1042B0] no-underline"
              >
                <Plus className="h-3 w-3" />
                <span>New</span>
              </Link>
              <Link
                to="/intake/business-cases"
                className="text-[12px] font-semibold text-[#1554D1] hover:underline inline-flex items-center gap-0.5"
              >
                <span>View All</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-4 border-b border-[#E2E8F0] bg-[#F8FAFC] p-3 gap-2 text-center text-[11.5px]">
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Total</span>
              <span className="text-[15px] font-bold text-[#12213F]">{bcStats.total}</span>
            </div>
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Pending</span>
              <span className="text-[15px] font-bold text-[#D97706]">{bcStats.pending}</span>
            </div>
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Approved</span>
              <span className="text-[15px] font-bold text-[#059669]">{bcStats.approved}</span>
            </div>
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Rejected</span>
              <span className="text-[15px] font-bold text-[#64748B]">{bcStats.rejected}</span>
            </div>
          </div>

          {/* Table */}
          <div className="w-full max-w-full min-w-0 overflow-hidden">
            <table className="w-full max-w-full table-fixed border-collapse text-left text-[12.5px]">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[30%]" />
                <col className="w-[23%]" />
                <col className="w-[15%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
                <tr>
                  <th className="py-2.5 pl-4 pr-2">Case #</th>
                  <th className="py-2.5 px-2">Title</th>
                  <th className="py-2.5 px-2">Status</th>
                  <th className="py-2.5 px-2">Initiator</th>
                  <th className="py-2.5 pl-2 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {loading && businessCases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-5 text-center text-[#64748B]">
                      Loading business cases...
                    </td>
                  </tr>
                ) : recentBc.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-5 text-center text-[#64748B]">
                      No business cases found.
                    </td>
                  </tr>
                ) : (
                  recentBc.map((bc) => {
                    const st = bc.workflow_status || (bc as { status?: string }).status || "Draft";
                    const isPending = st.toLowerCase().includes("pending") || st.toLowerCase().includes("review");
                    const isApproved = st.toLowerCase().includes("approved");

                    return (
                      <tr key={bc.name} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="py-2.5 pl-4 pr-2 font-semibold text-[#1554D1] truncate">
                          <Link
                            to={`/intake/business-cases/${encodeURIComponent(bc.name)}`}
                            className="hover:underline truncate block"
                            title={bc.name}
                          >
                            {bc.name}
                          </Link>
                        </td>
                        <td className="py-2.5 px-2 truncate" title={bc.title || "Business Case"}>
                          <span className="truncate block">
                            {bc.title || "Business Case"}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 truncate">
                          <span
                            className={`inline-flex max-w-full truncate rounded px-2 py-0.5 text-[11px] font-semibold ${
                              isApproved
                                ? "bg-[#F0FDF4] text-[#059669]"
                                : isPending
                                  ? "bg-[#FFFBEB] text-[#D97706]"
                                  : "bg-[#F1F5F9] text-[#475569]"
                            }`}
                            title={st}
                          >
                            <span className="truncate">{st}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-[#475569] text-[11.5px] truncate" title={(bc as { owner?: string }).owner || "Department"}>
                          <span className="truncate block">
                            {(bc as { owner?: string }).owner || "Department"}
                          </span>
                        </td>
                        <td className="py-2.5 pl-2 pr-4 text-right">
                          <Link
                            to={`/intake/business-cases/${encodeURIComponent(bc.name)}`}
                            className="inline-flex items-center justify-end gap-0.5 text-[11.5px] font-semibold text-[#1554D1] hover:underline"
                          >
                            <span>Review</span>
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

      {/* 2. ENGINEERING / ECR */}
      <section className="flex flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden min-w-0 w-full max-w-full">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#E2E8F0] p-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
                  Engineering / ECR Procurement
                </h3>
                <span className="rounded-full bg-[#FAF5FF] px-2 py-0.5 text-[11px] font-bold text-[#7C3AED]">
                  {loading ? "…" : `${ecrStats.awaitingRfq} Awaiting RFQ`}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-[#64748B]">
                Engineering change requests requiring supplier quoting and BOM adjustments
              </p>
            </div>
            <Link
              to="/ecr"
              className="text-[12px] font-semibold text-[#1554D1] hover:underline inline-flex items-center gap-0.5"
            >
              <span>View All</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-4 border-b border-[#E2E8F0] bg-[#F8FAFC] p-3 gap-2 text-center text-[11.5px]">
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Total ECRs</span>
              <span className="text-[15px] font-bold text-[#12213F]">{ecrStats.total}</span>
            </div>
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Awaiting RFQ</span>
              <span className="text-[15px] font-bold text-[#DC2626]">{ecrStats.awaitingRfq}</span>
            </div>
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">In Review</span>
              <span className="text-[15px] font-bold text-[#D97706]">{ecrStats.inReview}</span>
            </div>
            <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
              <span className="text-[#64748B] block">Completed</span>
              <span className="text-[15px] font-bold text-[#059669]">{ecrStats.completed}</span>
            </div>
          </div>

          {/* Table */}
          <div className="w-full max-w-full min-w-0 overflow-hidden">
            <table className="w-full max-w-full table-fixed border-collapse text-left text-[12.5px]">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[30%]" />
                <col className="w-[23%]" />
                <col className="w-[15%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
                <tr>
                  <th className="py-2.5 pl-4 pr-2">ECR #</th>
                  <th className="py-2.5 px-2">Title</th>
                  <th className="py-2.5 px-2">Stage</th>
                  <th className="py-2.5 px-2">Priority</th>
                  <th className="py-2.5 pl-2 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {loading && ecrs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-5 text-center text-[#64748B]">
                      Loading ECRs...
                    </td>
                  </tr>
                ) : actionableEcrs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-5 text-center text-[#64748B]">
                      <div className="flex items-center justify-center gap-1.5 text-[#059669]">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span className="truncate">No ECRs currently awaiting procurement action</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  actionableEcrs.map((ecr) => {
                    const priority = ecr.priority || "Medium";
                    const isHigh = priority === "Critical";

                    return (
                      <tr key={ecr.name} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="py-2.5 pl-4 pr-2 font-semibold text-[#1554D1] truncate">
                          <Link
                            to={`/ecr/${encodeURIComponent(ecr.name)}`}
                            className="hover:underline truncate block"
                            title={ecr.name}
                          >
                            {ecr.name}
                          </Link>
                        </td>
                        <td className="py-2.5 px-2 truncate" title={ecr.ecr_title || ecr.chnage_description || "Engineering Change"}>
                          <span className="truncate block">
                            {ecr.ecr_title || ecr.chnage_description || "Engineering Change"}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 truncate">
                          <span className="inline-flex max-w-full truncate rounded bg-[#FFFBEB] px-2 py-0.5 text-[11px] font-semibold text-[#D97706]">
                            <span className="truncate">{getECRCurrentStage(ecr.select_pxfp, ecr)}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-2 truncate">
                          <span
                            className={`inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[10.5px] font-bold ${
                              isHigh ? "bg-[#FEF2F2] text-[#DC2626]" : "bg-[#F1F5F9] text-[#475569]"
                            }`}
                          >
                            <span className="truncate">{priority}</span>
                          </span>
                        </td>
                        <td className="py-2.5 pl-2 pr-4 text-right">
                          <Link
                            to={getECRListActionRoute("procurement", ecr)}
                            className="inline-flex items-center justify-end gap-0.5 text-[11.5px] font-semibold text-[#1554D1] hover:underline"
                          >
                            <span>{getECRListActionLabel("procurement", ecr)}</span>
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
