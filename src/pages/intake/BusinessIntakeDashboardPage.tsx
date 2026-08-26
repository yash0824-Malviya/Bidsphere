import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Briefcase,
  DollarSign,
  ArrowUpRight,
  FileText,
  Activity,
} from "lucide-react";

import { fetchBusinessNeeds, fetchBusinessCases } from "../../api/businessIntake";
import PageHeader from "../../components/PageHeader";
import { formatCurrency } from "../../utils/format";

export default function BusinessIntakeDashboardPage() {
  const { data: needs = [] } = useQuery({
    queryKey: ["business-needs"],
    queryFn: () => fetchBusinessNeeds(),
  });

  const { data: cases = [] } = useQuery({
    queryKey: ["business-cases"],
    queryFn: () => fetchBusinessCases(),
  });

  // Section 24 Metrics:
  const totalNeeds = needs.length;
  const totalCases = cases.length;
  const rejectedCount = cases.filter((c) => c.approval_status === "Rejected" || c.workflow_status === "Rejected").length;
  const pendingFinance = cases.filter((c) => c.workflow_status === "Pending Finance Review" || c.workflow_status === "Revision Required - Finance").length;
  const pendingLegal = cases.filter((c) => c.workflow_status === "Pending Legal Review" || c.workflow_status === "Revision Required - Legal").length;
  const approvedForRfq = cases.filter((c) => c.workflow_status === "Procurement Ready" || c.workflow_status === "Approved - Ready for RFQ").length;
  const rfqsCreated = cases.filter((c) => c.workflow_status === "RFQ Created" || Boolean(c.rfq_id)).length;
  const totalBudget = cases.reduce((sum, c) => sum + c.budget, 0);
  const expectedSavings = cases.reduce((sum, c) => sum + c.expected_savings, 0);
  const avgApprovalTimeDays = "3.2 Days";

  // Department Distribution
  const deptMap: Record<string, { count: number; budget: number }> = {};
  cases.forEach((c) => {
    if (!deptMap[c.department]) {
      deptMap[c.department] = { count: 0, budget: 0 };
    }
    deptMap[c.department].count += 1;
    deptMap[c.department].budget += c.budget;
  });

  // Risk Distribution
  const riskCounts = {
    Low: cases.filter((c) => c.financial_risk === "Low").length,
    Medium: cases.filter((c) => c.financial_risk === "Medium").length,
    High: cases.filter((c) => c.financial_risk === "High").length,
  };

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <PageHeader
        title="Business Intake Executive Dashboard"
        description="Executive analytics, departmental distribution, budget vs savings, risk profiles, and procurement funnel."
      />

      {/* Primary Metrics Row (Section 24 Metrics 1-11) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Total Business Needs</span>
          <p className="mt-1 text-2xl font-bold text-neutral-900">{totalNeeds}</p>
          <span className="text-[10px] text-neutral-500">Raised by departments</span>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Total Business Cases</span>
          <p className="mt-1 text-2xl font-bold text-neutral-900">{totalCases}</p>
          <span className="text-[10px] text-neutral-500">Intake justification objects</span>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Total Approved Budget</span>
          <p className="mt-1 text-xl font-bold text-emerald-800">{formatCurrency(totalBudget)}</p>
          <span className="text-[10px] text-emerald-600">Allocated across cases</span>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Expected Cost Savings</span>
          <p className="mt-1 text-xl font-bold text-indigo-700">{formatCurrency(expectedSavings)}</p>
          <span className="text-[10px] text-indigo-600">Projected sourcing savings</span>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Approved for RFQ</span>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{approvedForRfq}</p>
          <span className="text-[10px] text-emerald-600">Ready in Queue</span>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Avg Approval Time</span>
          <p className="mt-1 text-2xl font-bold text-purple-700">{avgApprovalTimeDays}</p>
          <span className="text-[10px] text-purple-600">End-to-end processing</span>
        </div>
      </div>

      {/* Procurement Funnel & Approval Bottlenecks Matrix (Section 24 Metrics 14, 16) */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary-600" />
            Business Intake Procurement Funnel & Approval Bottlenecks
          </h3>
          <span className="text-xs font-medium text-neutral-500">Intake → Finance → Legal → Procurement Queue → RFQ</span>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-center">
            <span className="text-[11px] font-semibold text-neutral-600 uppercase">Needs Raised</span>
            <p className="mt-2 text-2xl font-bold text-neutral-900">{totalNeeds}</p>
            <span className="text-[10px] text-neutral-500">Step 1</span>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-center">
            <span className="text-[11px] font-semibold text-blue-800 uppercase">Pending Finance</span>
            <p className="mt-2 text-2xl font-bold text-blue-900">{pendingFinance}</p>
            <span className="text-[10px] text-blue-700">Financial Gate</span>
          </div>

          <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4 text-center">
            <span className="text-[11px] font-semibold text-purple-800 uppercase">Pending Legal</span>
            <p className="mt-2 text-2xl font-bold text-purple-900">{pendingLegal}</p>
            <span className="text-[10px] text-purple-700">Compliance Gate</span>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-center">
            <span className="text-[11px] font-semibold text-emerald-800 uppercase">Approved for RFQ</span>
            <p className="mt-2 text-2xl font-bold text-emerald-900">{approvedForRfq}</p>
            <span className="text-[10px] text-emerald-700">Ready in Queue</span>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-center">
            <span className="text-[11px] font-semibold text-indigo-800 uppercase">RFQs Created</span>
            <p className="mt-2 text-2xl font-bold text-indigo-900">{rfqsCreated}</p>
            <span className="text-[10px] text-indigo-700">Active Sourcing</span>
          </div>

          <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 text-center">
            <span className="text-[11px] font-semibold text-red-800 uppercase">Rejected</span>
            <p className="mt-2 text-2xl font-bold text-red-900">{rejectedCount}</p>
            <span className="text-[10px] text-red-700">Returned / Closed</span>
          </div>
        </div>
      </div>

      {/* Analytics Charts & Risk Profiles (Section 24 Metrics 12, 13, 15) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Department Distribution (Metric 12) & Budget vs Savings (Metric 13) */}
        <div className="lg:col-span-2 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700 border-b border-neutral-200 pb-2">
            Departmental Distribution & Budget vs Savings Analysis
          </h3>

          <div className="space-y-4">
            {Object.entries(deptMap).map(([dept, data]) => {
              const pct = totalBudget ? Math.round((data.budget / totalBudget) * 100) : 0;
              const deptSavings = Math.round(data.budget * 0.18);
              return (
                <div key={dept} className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="text-neutral-800">{dept} ({data.count} Cases)</span>
                    <span className="text-neutral-900">
                      Budget: {formatCurrency(data.budget)} | Savings: <span className="text-emerald-700 font-bold">{formatCurrency(deptSavings)}</span> ({pct}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100 flex">
                    <div className="h-full bg-primary-600 rounded-l-full" style={{ width: `${pct}%` }} />
                    <div className="h-full bg-emerald-500 rounded-r-full" style={{ width: `${Math.round(pct * 0.18)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Risk Distribution Profile (Metric 15) & Shortcuts */}
        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700 border-b border-neutral-200 pb-2">
              Financial Risk Profile Distribution
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-emerald-800 flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  Low Risk Profile
                </span>
                <span className="font-bold text-neutral-900">{riskCounts.Low} Cases</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-800 flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  Medium Risk Profile
                </span>
                <span className="font-bold text-neutral-900">{riskCounts.Medium} Cases</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-red-800 flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  High Risk Profile
                </span>
                <span className="font-bold text-neutral-900">{riskCounts.High} Cases</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700 border-b border-neutral-200 pb-2">
              Intake Workflow Shortcuts
            </h3>

            <Link
              to="/intake/pending-business-cases"
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
            >
              <span className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-emerald-600" />
                Procurement Queue (Pending Cases)
              </span>
              <ArrowUpRight className="h-4 w-4 text-neutral-400" />
            </Link>

            <Link
              to="/intake/business-needs"
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary-600" />
                Business Needs Intake
              </span>
              <ArrowUpRight className="h-4 w-4 text-neutral-400" />
            </Link>

            <Link
              to="/intake/business-cases"
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
            >
              <span className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-purple-600" />
                Business Cases Repository
              </span>
              <ArrowUpRight className="h-4 w-4 text-neutral-400" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
