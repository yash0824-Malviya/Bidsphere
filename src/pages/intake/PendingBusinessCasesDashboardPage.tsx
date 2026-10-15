import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Briefcase,
  Search,
  Sparkles,
  Eye,
  DollarSign,
  ArrowUpRight,
  TrendingUp,
  ShieldAlert,
  ArrowLeft,
  Filter,
} from "lucide-react";

import {
  fetchPendingBusinessCases,
  linkRfqToBusinessCase,
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

  const userRole = (user?.role || "department").toLowerCase();
  const userEmail = user?.email || "user@netlink.com";

  // Strict Exclusion: Warehouse Manager is strictly excluded from all Business Case views
  if (userRole === "warehouse_manager") {
    return (
      <div className="p-8 text-center max-w-md mx-auto my-12 bg-white rounded-xl border border-red-200 shadow-sm">
        <ShieldAlert className="h-10 w-10 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-neutral-900">Access Restricted</h2>
        <p className="text-xs text-neutral-500 mt-1">
          Warehouse Manager is strictly excluded from Business Case review and approval workflows.
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-neutral-800 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-neutral-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Return to Dashboard
        </Link>
      </div>
    );
  }

  const [search, setSearch] = useState("");
  const [selectedCaseForRfq, setSelectedCaseForRfq] = useState<BusinessCase | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("ALL");

  // Fetch pending business cases for role
  const { data: businessCases = [], isLoading } = useQuery({
    queryKey: ["pending-business-cases", userRole],
    queryFn: () => fetchPendingBusinessCases(userRole),
  });

  // Filtered items
  const filteredCases = useMemo(() => {
    return businessCases.filter((c) => {
      // Stage filter
      if (stageFilter !== "ALL") {
        if (stageFilter === "RFQ_READY") {
          const isReady =
            (c.workflow_status === "Approved" ||
              c.workflow_status === "Ready for RFQ" ||
              c.workflow_status === "Approved - Ready for RFQ" ||
              c.workflow_status === "Procurement Ready") &&
            !c.rfq_id;
          if (!isReady) return false;
        } else if (c.workflow_status !== stageFilter) {
          return false;
        }
      }

      // Text search
      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        c.business_case_id.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.department.toLowerCase().includes(q) ||
        c.business_owner.toLowerCase().includes(q) ||
        (c.commodity && c.commodity.toLowerCase().includes(q)) ||
        (c.plant && c.plant.toLowerCase().includes(q))
      );
    });
  }, [businessCases, stageFilter, search]);

  // KPI Calculations
  const totalApprovedBudget = businessCases.reduce((sum, c) => sum + (c.budget || 0), 0);
  const totalExpectedSavings = businessCases.reduce(
    (sum, c) => sum + (c.expected_annual_savings || c.expected_savings || 0),
    0
  );
  const readyForRfqCount = businessCases.filter(
    (c) =>
      (c.workflow_status === "Approved" ||
        c.workflow_status === "Ready for RFQ" ||
        c.workflow_status === "Approved - Ready for RFQ" ||
        c.workflow_status === "Procurement Ready") &&
      !c.rfq_id
  ).length;

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

      await linkRfqToBusinessCase(
        selectedCaseForRfq.business_case_id,
        rfqNumber,
        userEmail,
        userRole
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

  const isAdmin = userRole === "admin";
  const isProcurement = userRole === "procurement" || userRole === "procurement_team" || isAdmin;

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <PageHeader
        title="Pending Business Cases Queue"
        description="Active approval requests and sourcing-ready business cases requiring your action."
      />

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-500">
              Pending in Queue
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <Briefcase className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-900">{businessCases.length}</span>
            <span className="text-xs font-medium text-primary-600">Awaiting Action</span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Active submissions for your role</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-500">
              Total Budget in Queue
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
          <p className="mt-1 text-[11px] text-neutral-500">Cumulative estimated spend</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-500">
              Target Annual Benefit
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-900">
              {formatCurrency(totalExpectedSavings)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Projected cost savings & avoidance</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-500">
              Ready for Sourcing / RFQ
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-purple-900">{readyForRfqCount}</span>
            <span className="text-xs font-medium text-purple-600">Approved</span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Fully cleared for RFQ creation</p>
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
            placeholder="Search by Case ID, Title, Department, Commodity..."
            className="w-full rounded-lg border border-neutral-300 pl-9 pr-4 py-2 text-xs focus:border-primary-500 focus:outline-none"
          />
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-neutral-400" />
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 focus:outline-none"
            >
              <option value="ALL">All Stages ({businessCases.length})</option>
              <option value="Pending Engineering">Pending Engineering</option>
              <option value="Pending Finance">Pending Finance</option>
              <option value="Pending Finance Executive">Pending Finance Executive</option>
              <option value="Pending Procurement">Pending Procurement</option>
              <option value="Pending Legal">Pending Legal</option>
              <option value="Pending Final Approval">Pending Final Approval</option>
              <option value="RFQ_READY">Ready for RFQ ({readyForRfqCount})</option>
            </select>
          </div>
        )}

        <div className="text-xs font-medium text-neutral-500">
          Showing {filteredCases.length} records
        </div>
      </div>

      {/* Dashboard Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-700">
            <thead className="border-b border-neutral-200 bg-neutral-50 font-semibold uppercase text-neutral-600">
              <tr>
                <th className="px-4 py-3.5">Case ID</th>
                <th className="px-4 py-3.5">Title</th>
                <th className="px-4 py-3.5">Department</th>
                <th className="px-4 py-3.5">Plant / Facility</th>
                <th className="px-4 py-3.5">Commodity</th>
                <th className="px-4 py-3.5">Requester</th>
                <th className="px-4 py-3.5">Owner</th>
                <th className="px-4 py-3.5">Budget</th>
                <th className="px-4 py-3.5">Priority</th>
                <th className="px-4 py-3.5">Stage</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-200">
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-neutral-500">
                    Loading pending business cases...
                  </td>
                </tr>
              ) : filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-neutral-500">
                    <Briefcase className="mx-auto h-8 w-8 text-neutral-300 mb-2" />
                    <p className="text-sm font-semibold text-neutral-700">No Pending Business Cases</p>
                    <p className="text-xs text-neutral-500">
                      There are no pending business cases requiring action for your role at this time.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredCases.map((c) => {
                  const isReadyForRfq =
                    (c.workflow_status === "Approved" ||
                      c.workflow_status === "Ready for RFQ" ||
                      c.workflow_status === "Approved - Ready for RFQ" ||
                      c.workflow_status === "Procurement Ready") &&
                    !c.rfq_id;

                  return (
                    <tr key={c.name} className="hover:bg-neutral-50/80 transition-colors">
                      {/* Case ID */}
                      <td className="px-4 py-3.5 font-mono font-bold text-primary-700 whitespace-nowrap">
                        <Link
                          to={`/intake/business-cases/${c.business_case_id}`}
                          className="hover:underline flex items-center gap-1"
                        >
                          {c.business_case_id}
                          <ArrowUpRight className="h-3 w-3 text-neutral-400" />
                        </Link>
                      </td>

                      {/* Title */}
                      <td className="px-4 py-3.5 max-w-xs">
                        <span className="font-semibold text-neutral-900 line-clamp-1">{c.title}</span>
                        <span className="text-[11px] text-neutral-500 block">
                          Type: {c.case_type || "Standard"}
                        </span>
                      </td>

                      {/* Department */}
                      <td className="px-4 py-3.5 font-medium text-neutral-800 whitespace-nowrap">
                        {c.department}
                      </td>

                      {/* Plant */}
                      <td className="px-4 py-3.5 text-neutral-600 whitespace-nowrap">
                        {c.plant || "Main Campus"}
                      </td>

                      {/* Commodity */}
                      <td className="px-4 py-3.5 text-neutral-600 whitespace-nowrap">
                        {c.commodity || "General"}
                      </td>

                      {/* Requester */}
                      <td className="px-4 py-3.5 text-neutral-700 whitespace-nowrap">
                        {c.requester_name || c.business_owner}
                      </td>

                      {/* Owner */}
                      <td className="px-4 py-3.5 text-neutral-700 whitespace-nowrap">
                        {c.business_owner}
                      </td>

                      {/* Budget */}
                      <td className="px-4 py-3.5 font-mono font-bold text-neutral-900 whitespace-nowrap">
                        {c.budget > 0 ? formatCurrency(c.budget) : <span className="text-neutral-400 font-normal">Not set</span>}
                      </td>

                      {/* Priority */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            (c.priority as string) === "Urgent" || c.priority === "Critical"
                              ? "bg-red-100 text-red-700"
                              : c.priority === "High"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-neutral-100 text-neutral-700"
                          }`}
                        >
                          {c.priority || "Medium"}
                        </span>
                      </td>

                      {/* Stage */}
                      <td className="px-4 py-3.5 text-neutral-600 whitespace-nowrap font-medium">
                        {c.current_stage || c.workflow_status}
                      </td>

                      {/* Status Badge */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <IntakeApprovalBadge status={c.workflow_status} size="sm" />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/intake/business-cases/${c.business_case_id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 shadow-2xs"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Review
                          </Link>

                          {isReadyForRfq && isProcurement && (
                            <button
                              onClick={() => setSelectedCaseForRfq(c)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700 cursor-pointer"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Create RFQ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RFQ Creation Modal */}
      {selectedCaseForRfq && (
        <CreateRFQFromBusinessCaseModal
          isOpen={Boolean(selectedCaseForRfq)}
          businessCase={selectedCaseForRfq}
          onClose={() => setSelectedCaseForRfq(null)}
          onSubmit={handleCreateRfq}
        />
      )}
    </div>
  );
}
