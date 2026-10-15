import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowUpRight, Loader2, RefreshCw, Search } from "lucide-react";

export interface UrgentItem {
  id: string;
  type: "MR" | "ECR" | "RFQ" | "Quote" | "Approval";
  code: string;
  title: string;
  status: string;
  statusTone: "blue" | "green" | "amber" | "rose" | "slate";
  priority: "High" | "Medium" | "Low";
  dueDate: string;
  overdueText: string;
  isOverdue: boolean;
  assignedTo: string;
  actionText: "Create RFQ" | "View RFQ" | "Evaluate Quotes" | "Review" | "View";
  actionRoute: string;
}

interface Props {
  items?: UrgentItem[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

export default function UrgentOverdueTable({
  items = [],
  isLoading = false,
  isError = false,
  onRetry,
}: Props) {
  const [filterType, setFilterType] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const filtered = items.filter((item) => {
    if (filterType !== "all" && item.type.toLowerCase() !== filterType.toLowerCase()) {
      return false;
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (
        item.code.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.status.toLowerCase().includes(q) ||
        item.assignedTo.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const overdueCount = items.filter((i) => i.isOverdue).length;

  return (
    <section className="w-full rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
      {/* Table Header Controls */}
      <div className="flex flex-col gap-3 border-b border-[#E2E8F0] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold text-[#12213F]">
              Urgent & Overdue Items
            </h2>
            {overdueCount > 0 ? (
              <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[11px] font-bold text-[#DC2626]">
                {overdueCount} Overdue
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12px] text-[#64748B]">
            High priority procurement items requiring immediate action
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Type Filter */}
          <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-0.5">
            {[
              { id: "all", label: "All" },
              { id: "mr", label: "MR" },
              { id: "ecr", label: "ECR" },
              { id: "rfq", label: "RFQ" },
              { id: "quote", label: "Quotes" },
              { id: "approval", label: "Approvals" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-all ${
                  filterType === tab.id
                    ? "bg-white text-[#1554D1] shadow-xs"
                    : "text-[#64748B] hover:text-[#12213F]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Quick Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter items..."
              className="h-[32px] w-36 rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-2 text-[12px] text-[#12213F] placeholder:text-[#94A3B8] focus:border-[#1554D1] focus:outline-none sm:w-48"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="w-full max-w-full min-w-0 overflow-hidden">
        <table className="w-full max-w-full table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[8%]" />
            <col className="w-[12%]" />
            <col className="w-[24%]" />
            <col className="w-[14%]" />
            <col className="w-[9%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[13%]" />
          </colgroup>
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
            <tr>
              <th className="py-2.5 pl-4 pr-2">Type</th>
              <th className="py-2.5 px-2">ID</th>
              <th className="py-2.5 px-2">Title</th>
              <th className="py-2.5 px-2">Status</th>
              <th className="py-2.5 px-2">Priority</th>
              <th className="py-2.5 px-2">Due Date</th>
              <th className="py-2.5 px-2">Assigned To</th>
              <th className="py-2.5 pl-2 pr-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-[#64748B]">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-[#1554D1]" />
                    <span className="text-[13px]">Loading actionable items...</span>
                  </div>
                </td>
              </tr>
            ) : isError && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-rose-600">
                  <p className="text-[13.5px] font-semibold">Unable to load actionable items.</p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 shadow-xs"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-[#64748B]">
                  <p className="text-[13.5px] font-semibold text-[#12213F]">
                    No urgent or overdue items
                  </p>
                  <p className="mt-1 text-[12px] text-[#94A3B8]">
                    All procurement workflows, RFQs, and deadlines are currently up to date.
                  </p>
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const priorityBg =
                  item.priority === "High"
                    ? "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]"
                    : item.priority === "Medium"
                      ? "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]"
                      : "bg-[#F0FDF4] text-[#059669] border-[#BBF7D0]";

                const statusBg =
                  item.statusTone === "amber"
                    ? "bg-[#FFFBEB] text-[#D97706]"
                    : item.statusTone === "blue"
                      ? "bg-[#EFF6FF] text-[#2563EB]"
                      : item.statusTone === "rose"
                        ? "bg-[#FEF2F2] text-[#DC2626]"
                        : item.statusTone === "green"
                          ? "bg-[#ECFDF5] text-[#059669]"
                          : "bg-[#F1F5F9] text-[#475569]";

                const isPrimaryAction =
                  item.actionText === "Create RFQ" ||
                  item.actionText === "Evaluate Quotes";

                return (
                  <tr
                    key={item.id + item.code}
                    className="transition-colors hover:bg-[#F8FAFC]"
                  >
                    {/* Type */}
                    <td className="py-3 pl-4 pr-2">
                      <span className="inline-flex items-center rounded bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-bold text-[#475569]">
                        {item.type}
                      </span>
                    </td>

                    {/* ID */}
                    <td className="py-3 px-2 font-semibold text-[#1554D1] truncate">
                      <Link
                        to={item.actionRoute}
                        className="hover:underline text-[#1554D1] truncate block"
                        title={item.code}
                      >
                        {item.code}
                      </Link>
                    </td>

                    {/* Title */}
                    <td className="py-3 px-2 truncate">
                      <p className="truncate font-medium text-[#12213F]" title={item.title}>
                        {item.title}
                      </p>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-2 truncate">
                      <span
                        className={`inline-flex max-w-full items-center truncate rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${statusBg}`}
                        title={item.status}
                      >
                        <span className="truncate">{item.status}</span>
                      </span>
                    </td>

                    {/* Priority */}
                    <td className="py-3 px-2">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11.5px] font-semibold ${priorityBg}`}
                      >
                        {item.priority}
                      </span>
                    </td>

                    {/* Due Date & Overdue */}
                    <td className="py-3 px-2 truncate text-[12px]">
                      <div className="truncate text-[#64748B]" title={item.dueDate}>
                        {item.dueDate}
                      </div>
                      {item.isOverdue && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#DC2626] truncate">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          <span className="truncate">{item.overdueText}</span>
                        </span>
                      )}
                    </td>

                    {/* Assigned To */}
                    <td className="py-3 px-2 text-[12.5px] text-[#475569] truncate" title={item.assignedTo}>
                      <span className="truncate block">{item.assignedTo}</span>
                    </td>

                    {/* Action */}
                    <td className="py-3 pl-2 pr-4 text-right">
                      <Link
                        to={item.actionRoute}
                        className={`inline-flex items-center justify-end gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition-all no-underline ${
                          isPrimaryAction
                            ? "bg-[#1554D1] text-white hover:bg-[#1042B0] shadow-xs"
                            : "border border-[#E2E8F0] bg-white text-[#12213F] hover:bg-[#F8FAFC]"
                        }`}
                      >
                        <span className="truncate">{item.actionText}</span>
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

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5 text-[12px] text-[#64748B]">
        <span>Showing {filtered.length} priority items</span>
        <Link
          to="/ecr?filter=rfq-pending"
          className="font-semibold text-[#1554D1] hover:underline"
        >
          View all actionable items →
        </Link>
      </div>
    </section>
  );
}
