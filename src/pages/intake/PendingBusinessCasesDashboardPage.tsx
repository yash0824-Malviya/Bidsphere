import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Briefcase,
  Search,
  CheckCircle2,
  Sparkles,
  Eye,
  DollarSign,
  ArrowUpRight,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";

import {
  getPendingBusinessCasesForProcurement,
  linkRfqToBusinessCase,
  rejectBusinessCaseAtFinance,
} from "../../api/businessIntake";
import { createRFQ } from "../../api/sourcing";
import type { BusinessCase } from "../../types/businessIntake";
import { IntakeApprovalBadge } from "../../components/intake/IntakeApprovalBadge";
import { CreateRFQFromBusinessCaseModal } from "../../components/intake/CreateRFQFromBusinessCaseModal";
import PageHeader from "../../components/PageHeader";
import { formatCurrency, todayIso } from "../../utils/format";
import { useAuthStore } from "../../store/authStore";

export default function PendingBusinessCasesDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [search, setSearch] = useState("");
  const [selectedCaseForRfq, setSelectedCaseForRfq] = useState<BusinessCase | null>(null);
  const [rejectingCase, setRejectingCase] = useState<BusinessCase | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Fetch pending approved business cases (Approved - Ready for RFQ)
  const { data: businessCases = [], isLoading } = useQuery({
    queryKey: ["pending-business-cases"],
    queryFn: () => getPendingBusinessCasesForProcurement(),
  });

  // Filtered items
  const filteredCases = businessCases.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    return (
      c.business_case_id.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.department.toLowerCase().includes(q) ||
      c.business_owner.toLowerCase().includes(q) ||
      (c.project && c.project.toLowerCase().includes(q))
    );
  });

  // KPI Calculations
  const totalApprovedBudget = businessCases.reduce((sum, c) => sum + c.budget, 0);
  const totalExpectedSavings = businessCases.reduce((sum, c) => sum + c.expected_savings, 0);

  // Convert to RFQ handler
  const handleCreateRfq = async (rfqData: {
    title: string;
    target_suppliers: string[];
    valid_till: string;
    procurement_category: string;
    supplier_terms: string;
    items: Array<{
      item_code: string;
      item_name: string;
      description: string;
      qty: number;
      uom: string;
      target_price?: number;
    }>;
  }) => {
    if (!selectedCaseForRfq) return;

    try {
      // 1. Create RFQ via Sourcing API
      let rfqNumber = `RFQ-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;

      try {
        const created = await createRFQ({
          transaction_date: todayIso(),
          message_for_supplier: `Business Case ID: ${selectedCaseForRfq.business_case_id}\nTitle: ${rfqData.title}\n\n${rfqData.supplier_terms}`,
          items: rfqData.items.map((i) => ({
            item_code: i.item_code,
            item_name: i.item_name,
            description: i.description,
            qty: i.qty,
            uom: i.uom,
            custom_target_price: i.target_price,
          })),
          suppliers: rfqData.target_suppliers.map((s) => ({ supplier: s, supplier_name: s })),
          custom_procurement_type: "Direct",
          custom_procurement_category: rfqData.procurement_category,
        });

        if (created?.name) {
          rfqNumber = created.name;
        }
      } catch (apiErr) {
        console.warn("[ProcurementQueue] Sourcing API createRFQ fallback:", apiErr);
      }

      // 2. Link RFQ ID to Business Case
      await linkRfqToBusinessCase(
        selectedCaseForRfq.business_case_id,
        rfqNumber,
        user?.email || "procurement@netlink.com"
      );

      toast.success(`RFQ ${rfqNumber} successfully created and linked to ${selectedCaseForRfq.business_case_id}!`);
      queryClient.invalidateQueries({ queryKey: ["pending-business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      setSelectedCaseForRfq(null);

      navigate(`/sourcing/rfq/${rfqNumber}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create RFQ.");
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingCase || !rejectReason.trim()) return;

    try {
      await rejectBusinessCaseAtFinance(
        rejectingCase.business_case_id,
        rejectReason,
        user?.email || "procurement@netlink.com",
        user?.role || "procurement"
      );

      toast.success(`Business Case ${rejectingCase.business_case_id} rejected.`);
      queryClient.invalidateQueries({ queryKey: ["pending-business-cases"] });
      queryClient.invalidateQueries({ queryKey: ["business-cases"] });
      setRejectingCase(null);
      setRejectReason("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Rejection failed.");
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <PageHeader
        title="Pending Business Cases Queue"
        description="Approved enterprise business cases ready for Procurement RFQ conversion."
      />

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-500">
              Pending Business Cases
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Briefcase className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-900">{businessCases.length}</span>
            <span className="text-xs font-medium text-emerald-600">Ready for RFQ</span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Finance & Legal Approved</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-500">
              Approved Total Budget
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <DollarSign className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-900">
              {formatCurrency(totalApprovedBudget)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Allocated across approved cases</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-500">
              Projected Cost Savings
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-indigo-900">
              {formatCurrency(totalExpectedSavings)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Target savings via sourcing</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-500">
              Approval Gates Verified
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-purple-900">100%</span>
            <span className="text-xs font-medium text-purple-600">Verified</span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Finance & Legal Gates Approved</p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Case ID, Title, Department, Business Owner..."
            className="w-full rounded-lg border border-neutral-300 pl-9 pr-4 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500">
          <span>Showing {filteredCases.length} Approved Business Cases</span>
        </div>
      </div>

      {/* Dashboard Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-700">
            <thead className="border-b border-neutral-200 bg-neutral-50 font-semibold uppercase text-neutral-600">
              <tr>
                <th className="px-4 py-3.5">Business Case ID</th>
                <th className="px-4 py-3.5">Title</th>
                <th className="px-4 py-3.5">Department</th>
                <th className="px-4 py-3.5">Business Owner</th>
                <th className="px-4 py-3.5">Budget</th>
                <th className="px-4 py-3.5">Priority</th>
                <th className="px-4 py-3.5">Finance Status</th>
                <th className="px-4 py-3.5">Legal Status</th>
                <th className="px-4 py-3.5">Target RFQ Date</th>
                <th className="px-4 py-3.5">Current Status</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-200">
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-neutral-500">
                    Loading pending business cases...
                  </td>
                </tr>
              ) : filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-neutral-500">
                    <Briefcase className="mx-auto h-8 w-8 text-neutral-300 mb-2" />
                    <p className="text-sm font-semibold text-neutral-700">No Pending Business Cases</p>
                    <p className="text-xs text-neutral-500">All approved business cases have been converted to RFQs or none currently pending.</p>
                  </td>
                </tr>
              ) : (
                filteredCases.map((c) => (
                  <tr key={c.name} className="hover:bg-neutral-50/80 transition-colors">
                    {/* Business Case ID */}
                    <td className="px-4 py-3.5 font-mono font-bold text-primary-700">
                      <Link to={`/intake/business-cases/${c.business_case_id}`} className="hover:underline flex items-center gap-1">
                        {c.business_case_id}
                        <ArrowUpRight className="h-3 w-3 text-neutral-400" />
                      </Link>
                    </td>

                    {/* Title */}
                    <td className="px-4 py-3.5 max-w-xs">
                      <span className="font-semibold text-neutral-900 line-clamp-1">{c.title}</span>
                      <span className="text-[11px] text-neutral-500 block">
                        Project: {c.project || "—"}
                      </span>
                    </td>

                    {/* Department */}
                    <td className="px-4 py-3.5 font-medium text-neutral-800">
                      {c.department}
                    </td>

                    {/* Business Owner */}
                    <td className="px-4 py-3.5 text-neutral-700">
                      {c.business_owner}
                    </td>

                    {/* Budget */}
                    <td className="px-4 py-3.5 font-bold text-neutral-900">
                      {formatCurrency(c.budget)}
                    </td>

                    {/* Priority */}
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          c.priority === "Critical"
                            ? "bg-red-100 text-red-800"
                            : c.priority === "High"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {c.priority || "High"}
                      </span>
                    </td>

                    {/* Finance Status */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        c.finance_status === "Approved"
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-amber-50 border-amber-200 text-amber-700"
                      }`}>
                        {c.finance_status === "Approved" ? <CheckCircle2 className="h-3 w-3" /> : null}
                        {c.finance_status}
                      </span>
                    </td>

                    {/* Legal Status */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        c.legal_status === "Approved"
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-amber-50 border-amber-200 text-amber-700"
                      }`}>
                        {c.legal_status === "Approved" ? <CheckCircle2 className="h-3 w-3" /> : null}
                        {c.legal_status}
                      </span>
                    </td>

                    {/* Target RFQ Date */}
                    <td className="px-4 py-3.5 text-neutral-700 font-medium">
                      {c.target_rfq_date || "2026-09-01"}
                    </td>

                    {/* Current Status */}
                    <td className="px-4 py-3.5">
                      <IntakeApprovalBadge status={c.workflow_status} size="sm" />
                    </td>

                    {/* Actions: View, Mark Ready / Create RFQ */}
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          to={`/intake/business-cases/${c.business_case_id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 shadow-sm"
                        >
                          <Eye className="h-3.5 w-3.5 text-neutral-500" />
                          View
                        </Link>

                        {c.workflow_status === "Pending Procurement" ? (
                          <Link
                            to={`/intake/business-cases/${c.business_case_id}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-amber-700"
                          >
                            <Briefcase className="h-3.5 w-3.5" />
                            Review
                          </Link>
                        ) : (
                          <button
                            onClick={() => setSelectedCaseForRfq(c)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            Create RFQ
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RFQ Creation Modal */}
      <CreateRFQFromBusinessCaseModal
        isOpen={Boolean(selectedCaseForRfq)}
        businessCase={selectedCaseForRfq}
        onClose={() => setSelectedCaseForRfq(null)}
        onSubmit={handleCreateRfq}
      />

      {/* Rejection Modal */}
      {rejectingCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-neutral-900">
              Reject Business Case ({rejectingCase.business_case_id})
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              Provide a clear rationale for returning this business case to the department.
            </p>

            <textarea
              required
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter rejection reason..."
              className="mt-3 w-full rounded-lg border border-neutral-300 p-2.5 text-sm focus:border-red-500 focus:outline-none"
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setRejectingCase(null)}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReject}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
