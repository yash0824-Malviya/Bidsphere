import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import type { OnboardingListRow, OnboardingStats } from "../../api/supplierOnboarding";
import { formatDate } from "../../utils/format";

interface Props {
  suppliersCount?: number | string | null;
  onboardingStats?: OnboardingStats | null;
  onboardings?: OnboardingListRow[];
  loading?: boolean;
}

export default function SupplierManagementSummarySection({
  suppliersCount = 0,
  onboardingStats,
  onboardings = [],
  loading = false,
}: Props) {
  const pendingOnboardings = useMemo(() => {
    return onboardings.slice(0, 5);
  }, [onboardings]);

  return (
    <section className="w-full rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-[#E2E8F0] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
              Supplier Management & Onboarding
            </h2>
            <span className="rounded-full bg-[#F0FDF4] px-2 py-0.5 text-[11px] font-bold text-[#059669]">
              {loading ? "…" : `${suppliersCount ?? 0} Suppliers`}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-[#64748B]">
            Vendor master directory, qualification statuses, and onboarding intake workflow
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/supplier/onboarding/new"
            className="inline-flex items-center gap-1 rounded-md bg-[#1554D1] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1042B0] no-underline"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Onboarding</span>
          </Link>
          <Link
            to="/suppliers"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1554D1] hover:underline ml-2"
          >
            <span>View All Suppliers</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 border-b border-[#E2E8F0] bg-[#F8FAFC] p-3 sm:grid-cols-4 md:grid-cols-6 gap-2 text-center text-[12px]">
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Active Suppliers</span>
          <span className="text-[16px] font-bold text-[#059669]">{suppliersCount ?? 0}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Total Onboardings</span>
          <span className="text-[16px] font-bold text-[#12213F]">{onboardingStats?.total ?? onboardings.length}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Pending Review</span>
          <span className="text-[16px] font-bold text-[#D97706]">{onboardingStats?.pending_review ?? 0}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Approved Onboarded</span>
          <span className="text-[16px] font-bold text-[#059669]">{onboardingStats?.approved ?? 0}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Rejected / Expired</span>
          <span className="text-[16px] font-bold text-[#64748B]">{(onboardingStats?.rejected ?? 0) + (onboardingStats?.expired ?? 0)}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Onboarding List</span>
          <Link to="/supplier/onboarding" className="text-[14px] font-bold text-[#1554D1] hover:underline block mt-0.5">
            Manage →
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="w-full max-w-full min-w-0 overflow-hidden">
        <table className="w-full max-w-full table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[24%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
            <tr>
              <th className="py-2.5 pl-4 pr-2">Onboarding ID</th>
              <th className="py-2.5 px-2">Company / Supplier</th>
              <th className="py-2.5 px-2">Supplier Type</th>
              <th className="py-2.5 px-2">Category</th>
              <th className="py-2.5 px-2">Status</th>
              <th className="py-2.5 px-2">Created Date</th>
              <th className="py-2.5 pl-2 pr-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading && onboardings.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-[#64748B]">
                  Loading supplier onboarding records...
                </td>
              </tr>
            ) : pendingOnboardings.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-[#64748B]">
                  No recent supplier onboarding requests found.
                </td>
              </tr>
            ) : (
              pendingOnboardings.map((ob) => (
                <tr key={ob.name} className="transition-colors hover:bg-[#F8FAFC]">
                  <td className="py-3 pl-4 pr-2 font-semibold text-[#1554D1] truncate">
                    <Link to={`/supplier/onboarding/${encodeURIComponent(ob.name)}`} className="hover:underline truncate block" title={ob.name}>
                      {ob.name}
                    </Link>
                  </td>
                  <td className="py-3 px-2 font-medium text-[#12213F] truncate" title={ob.company_name}>
                    <span className="truncate block">{ob.company_name}</span>
                  </td>
                  <td className="py-3 px-2 truncate text-[#64748B] text-[12px]" title={ob.supplier_type || "Vendor"}>
                    <span className="truncate block">{ob.supplier_type || "Vendor"}</span>
                  </td>
                  <td className="py-3 px-2 truncate text-[#64748B] text-[12px]" title={ob.supplier_category || ob.supplier_type || "General"}>
                    <span className="truncate block">{ob.supplier_category || ob.supplier_type || "General"}</span>
                  </td>
                  <td className="py-3 px-2 truncate">
                    <span
                      className={`inline-flex max-w-full items-center truncate rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${
                        ob.status === "Approved"
                          ? "bg-[#F0FDF4] text-[#059669]"
                          : ob.status === "Rejected"
                            ? "bg-[#FEF2F2] text-[#DC2626]"
                            : "bg-[#FFFBEB] text-[#D97706]"
                      }`}
                      title={ob.status || "Pending"}
                    >
                      <span className="truncate">{ob.status || "Pending"}</span>
                    </span>
                  </td>
                  <td className="py-3 px-2 truncate text-[#64748B] text-[12px]" title={ob.creation ? formatDate(ob.creation) : "—"}>
                    <span className="truncate block">{ob.creation ? formatDate(ob.creation) : "—"}</span>
                  </td>
                  <td className="py-3 pl-2 pr-4 text-right">
                    <Link
                      to={`/supplier/onboarding/${encodeURIComponent(ob.name)}`}
                      className="inline-flex items-center justify-end gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#12213F] hover:bg-[#F8FAFC] no-underline"
                    >
                      <span>Review</span>
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
