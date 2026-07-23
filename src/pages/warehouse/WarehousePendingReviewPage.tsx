import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Search } from "lucide-react";
import { getPendingMaterialRequests } from "../../services/warehouseService";
import ProcurementTypeBadge from "../../components/ProcurementTypeBadge";
import RequestModeBadge from "../../components/RequestModeBadge";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";

export default function WarehousePendingReviewPage() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const pendingQuery = useQuery({
    queryKey: ["warehouse", "pending-requests"],
    queryFn: getPendingMaterialRequests,
    retry: false,
  });

  const handleRetry = () => {
    void pendingQuery.refetch();
  };

  // Get unique departments for filter dropdown
  const departments = useMemo(() => {
    if (!pendingQuery.data) return [];
    const depts = pendingQuery.data.map((mr) => mr.department);
    return [...new Set(depts)].filter(Boolean);
  }, [pendingQuery.data]);

  // Filter and Search Logic
  const filteredData = useMemo(() => {
    if (!pendingQuery.data) return [];
    
    return pendingQuery.data.filter((mr) => {
      const matchesSearch =
        mr.name.toLowerCase().includes(search.toLowerCase()) ||
        mr.department.toLowerCase().includes(search.toLowerCase()) ||
        mr.requested_by.toLowerCase().includes(search.toLowerCase());

      const matchesPriority = priorityFilter === "" || mr.priority === priorityFilter;
      const matchesDept = deptFilter === "" || mr.department === deptFilter;

      return matchesSearch && matchesPriority && matchesDept;
    });
  }, [pendingQuery.data, search, priorityFilter, deptFilter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, priorityFilter, deptFilter]);

  // Pagination calculations
  const totalItems = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedData = useMemo(() => {
    return filteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredData, startIndex]);

  if (pendingQuery.isError) {
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load Warehouse data."
            description="We couldn't retrieve the pending material requests list. Please try again."
            onRetry={handleRetry}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6 animate-in fade-in duration-300">
      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by MR number, department, or requested by..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {/* Priority Filter */}
        <div className="w-full md:w-48">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Priorities</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Urgent">Urgent</option>
          </select>
        </div>

        {/* Department Filter */}
        <div className="w-full md:w-48">
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Departments</option>
            {departments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table Container */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col min-h-[400px]">
        {pendingQuery.isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={6} columns={8} />
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <EmptyState
              icon={ClipboardList}
              title="No Pending Material Requests"
              description={
                search || priorityFilter || deptFilter
                  ? "Adjust your filters or search term to see requests."
                  : "All material requests are reviewed and up to date!"
              }
            />
          </div>
        ) : (
          <>
            {/* Scrollable table viewport */}
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-4 px-6">MR Number</th>
                    <th className="py-4 px-6">Type</th>
                    <th className="py-4 px-6">Department</th>
                    <th className="py-4 px-6">Requested By</th>
                    <th className="py-4 px-6 text-center">Items Count</th>
                    <th className="py-4 px-6">Priority</th>
                    <th className="py-4 px-6">Required Date</th>
                    <th className="py-4 px-6">Status</th>
                    <th className="py-4 px-6 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {paginatedData.map((mr) => (
                    <tr
                      key={mr.name}
                      onClick={() => navigate(`/warehouse/material-requests/review/${mr.name}`)}
                      className="hover:bg-slate-50/75 transition-colors cursor-pointer group"
                    >
                      <td className="py-4 px-6 font-semibold text-slate-900 group-hover:text-primary transition-colors">
                        {mr.name}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex flex-wrap items-center gap-1">
                          <ProcurementTypeBadge type={mr.procurement_type} />
                          <RequestModeBadge mode={mr.request_mode} />
                        </div>
                      </td>
                      <td className="py-4 px-6 text-slate-600">{mr.department}</td>
                      <td className="py-4 px-6 text-slate-600">{mr.requested_by}</td>
                      <td className="py-4 px-6 text-center font-medium text-slate-900 tabular-nums">
                        {mr.items_count}
                      </td>
                      <td className="py-4 px-6">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                            mr.priority === "Urgent"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : mr.priority === "High"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : mr.priority === "Medium"
                                  ? "bg-blue-50 text-blue-700 border-blue-200"
                                  : "bg-slate-50 text-slate-600 border-slate-200"
                          }`}
                        >
                          {mr.priority}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-slate-600 tabular-nums">
                        {mr.required_date}
                      </td>
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 px-2.5 py-0.5 text-xs font-medium border border-amber-200">
                          {mr.status}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/warehouse/material-requests/review/${mr.name}`)}
                          className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 transition-all hover:border-slate-300 active:scale-95 cursor-pointer"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            {totalPages > 1 && (
              <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Showing <span className="font-semibold text-slate-800">{startIndex + 1}</span> to{" "}
                  <span className="font-semibold text-slate-800">
                    {Math.min(startIndex + itemsPerPage, totalItems)}
                  </span>{" "}
                  of <span className="font-semibold text-slate-800">{totalItems}</span> requests
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    Previous
                  </button>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
