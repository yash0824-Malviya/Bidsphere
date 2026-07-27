import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { getPendingMaterialRequests } from "../../services/warehouseService";
import ProcurementTypeBadge from "../../components/ProcurementTypeBadge";
import RequestModeBadge from "../../components/RequestModeBadge";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import Pagination from "../../components/ui/Pagination";
import { SearchInput } from "../../components/ui";
import { useClientPagination } from "../../hooks/usePagination";

export default function WarehousePendingReviewPage() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");

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

  const {
    pageRows: paginatedData,
    totalRecords: totalItems,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(filteredData, {
    resetKey: `${search}|${priorityFilter}|${deptFilter}`,
  });

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
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by MR number, department, or requested by..."
          />
        </div>

        <div className="w-full md:w-48">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="select-field"
          >
            <option value="">All Priorities</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Urgent">Urgent</option>
          </select>
        </div>

        <div className="w-full md:w-48">
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="select-field"
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
              <table className="data-table">
                <thead>
                  <tr>
                    <th>MR Number</th>
                    <th>Type</th>
                    <th>Department</th>
                    <th>Requested By</th>
                    <th className="text-center">Items Count</th>
                    <th>Priority</th>
                    <th>Required Date</th>
                    <th>Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.map((mr) => (
                    <tr
                      key={mr.name}
                      onClick={() => navigate(`/warehouse/material-requests/review/${mr.name}`)}
                      className="cursor-pointer group"
                    >
                      <td className="font-semibold text-slate-900 group-hover:text-primary">
                        {mr.name}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          <ProcurementTypeBadge type={mr.procurement_type} />
                          <RequestModeBadge mode={mr.request_mode} />
                        </div>
                      </td>
                      <td className="text-slate-600">{mr.department}</td>
                      <td className="text-slate-600">{mr.requested_by}</td>
                      <td className="text-center font-medium tabular-nums text-slate-900">
                        {mr.items_count}
                      </td>
                      <td>
                        <StatusBadge
                          status={mr.priority}
                          tone={
                            mr.priority === "Urgent"
                              ? "danger"
                              : mr.priority === "High"
                                ? "warning"
                                : mr.priority === "Medium"
                                  ? "info"
                                  : "neutral"
                          }
                        />
                      </td>
                      <td className="tabular-nums text-slate-600">
                        {mr.required_date}
                      </td>
                      <td>
                        <StatusBadge status={mr.status} />
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => navigate(`/warehouse/material-requests/review/${mr.name}`)}
                          className="btn-secondary"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalRecords={totalItems}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              recordLabel="requests"
            />
          </>
        )}
      </div>
    </div>
  );
}
