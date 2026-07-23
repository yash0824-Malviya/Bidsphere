import { useLayoutEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Inbox,
  Search,
  XCircle,
} from "lucide-react";

import {
  listPendingIndirectApprovals,
  type AdminApprovalRow,
} from "../../api/adminApprovals";
import {
  approveIndirectMaterialRequest,
  rejectIndirectMaterialRequest,
} from "../../api/materialRequestWorkflow";
import StatusBadge from "../../components/StatusBadge";
import ProcurementTypeBadge from "../../components/ProcurementTypeBadge";
import RequestModeBadge from "../../components/RequestModeBadge";
import ExportButton from "../../components/export/ExportButton";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import PaginationBar from "../../components/PaginationBar";
import { Skeleton } from "../../components/Skeleton";
import type { ExportColumn } from "../../utils/export";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useClientPagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";

type Decision = "approve" | "reject";

export default function PendingApprovalsPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [dialog, setDialog] = useState<{
    row: AdminApprovalRow;
    decision: Decision;
  } | null>(null);
  const [remarks, setRemarks] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-pending-approvals"],
    queryFn: listPendingIndirectApprovals,
    refetchInterval: 30_000,
  });

  const departments = useMemo(
    () =>
      Array.from(
        new Set(data.map((r) => r.department).filter(Boolean)),
      ).sort(),
    [data],
  );
  const statuses = useMemo(
    () => Array.from(new Set(data.map((r) => r.status).filter(Boolean))).sort(),
    [data],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.filter((r) => {
      if (term) {
        const haystack =
          `${r.name} ${r.department} ${r.requestedBy}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (department !== "all" && r.department !== department) return false;
      if (status !== "all" && r.status !== status) return false;
      const day = (r.requestDate ?? "").slice(0, 10);
      if (fromDate && day && day < fromDate) return false;
      if (toDate && day && day > toDate) return false;
      return true;
    });
  }, [data, search, department, status, fromDate, toDate]);

  const filterKey = `${search}|${department}|${status}|${fromDate}|${toDate}`;
  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    totalRecords,
    totalPages,
    pageRows,
  } = useClientPagination(rows, {
    defaultPageSize: 10,
    resetKey: filterKey,
    pageParam: "approvalPage",
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-pending-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["admin-approved-requests"] });
    queryClient.invalidateQueries({ queryKey: ["admin-indirect-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["material-requests-workflow"] });
    queryClient.invalidateQueries({ queryKey: ["mr-procurement-queue"] });
    queryClient.invalidateQueries({ queryKey: ["admin-kpis"] });
  };

  const mutation = useMutation({
    mutationFn: async ({
      row,
      decision,
      note,
    }: {
      row: AdminApprovalRow;
      decision: Decision;
      note: string;
    }) => {
      if (decision === "approve") {
        return approveIndirectMaterialRequest(row.name, note || undefined);
      }
      return rejectIndirectMaterialRequest(row.name, note || undefined);
    },
    onSuccess: (_res, vars) => {
      toast.success(
        vars.decision === "approve"
          ? "Request approved and forwarded to Procurement."
          : "Request rejected and returned to the requester.",
      );
      setDialog(null);
      setRemarks("");
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Action failed"),
  });

  const hasFilters =
    search.trim() !== "" ||
    department !== "all" ||
    status !== "all" ||
    fromDate !== "" ||
    toDate !== "";

  const exportColumns = useMemo<ExportColumn<AdminApprovalRow>[]>(
    () => [
      { id: "name", label: "MR Number", accessor: (r) => r.name },
      { id: "department", label: "Department", accessor: (r) => r.department },
      { id: "requestedBy", label: "Requested By", accessor: (r) => r.requestedBy },
      {
        id: "procurementType",
        label: "Request Type",
        type: "status",
        accessor: (r) => r.procurementType,
      },
      {
        id: "requestMode",
        label: "Request Mode",
        type: "status",
        accessor: (r) => r.requestMode,
      },
      {
        id: "priority",
        label: "Priority",
        type: "status",
        accessor: (r) => r.priority,
      },
      {
        id: "status",
        label: "Status",
        type: "status",
        accessor: (r) => r.status,
      },
      {
        id: "requestDate",
        label: "Request Date",
        type: "date",
        accessor: (r) => r.requestDate,
      },
      {
        id: "itemCount",
        label: "Items",
        type: "number",
        accessor: (r) => r.itemCount,
      },
    ],
    [],
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm">
          <ClipboardCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-neutral-900">
            Pending Approvals
          </h1>
          <p className="text-xs text-neutral-500">
            Indirect Material Requests awaiting your review and approval.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ExportButton
            module="Approval History"
            filenamePrefix="Approval_History_Pending"
            columns={exportColumns}
            rows={rows}
          />
          {data.length > 0 && (
            <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-primary-50 px-2.5 text-sm font-bold text-primary-700">
              {data.length}
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search request, department, requester…"
            className="input-field pl-9"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="select-field"
          aria-label="Filter by status"
        >
          <option value="all">All Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="select-field"
          aria-label="Filter by department"
        >
          <option value="all">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="input-field"
          aria-label="From date"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="input-field"
          aria-label="To date"
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState filtered={hasFilters && data.length > 0} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Request No.</th>
                  <th className="px-4 py-3">Request Date</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Requested By</th>
                  <th className="px-4 py-3">Procurement Type</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3 text-right">Total Items</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {pageRows.map((row) => (
                  <tr key={row.name} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/material-requests/${encodeURIComponent(row.name)}`}
                        className="font-semibold text-primary-600 no-underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-neutral-600">
                      {formatDate(row.requestDate)}
                    </td>
                    <td className="px-4 py-3">{row.department || "—"}</td>
                    <td className="px-4 py-3">{row.requestedBy || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <ProcurementTypeBadge type={row.procurementType} />
                        <RequestModeBadge mode={row.requestMode} />
                      </div>
                    </td>
                    <td className="px-4 py-3">{row.priority || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.itemCount}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setRemarks("");
                            setDialog({ row, decision: "approve" });
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRemarks("");
                            setDialog({ row, decision: "reject" });
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Reject
                        </button>
                        <Link
                          to={`/material-requests/${encodeURIComponent(row.name)}`}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-600 no-underline hover:bg-neutral-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              totalRecords={totalRecords}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              recordLabel="requests"
            />
          </div>
        )}
      </div>

      {dialog && (
        <ConfirmDialog
          open
          onClose={() => {
            if (!mutation.isPending) {
              setDialog(null);
              setRemarks("");
            }
          }}
          onConfirm={() => {
            mutation.mutate({
              row: dialog.row,
              decision: dialog.decision,
              note: remarks.trim(),
            });
          }}
          title={
            dialog.decision === "approve"
              ? "Approve Indirect Request"
              : "Reject Indirect Request"
          }
          description={
            dialog.decision === "approve"
              ? `Approve ${dialog.row.name} and forward it to Procurement?`
              : `Reject ${dialog.row.name} and return it to the requester?`
          }
          confirmLabel={dialog.decision === "approve" ? "Approve" : "Reject"}
          tone={dialog.decision === "approve" ? "primary" : "danger"}
          isLoading={mutation.isPending}
        >
          <label className="block text-xs font-semibold text-neutral-600">
            {dialog.decision === "approve"
              ? "Remarks (optional)"
              : "Reason for rejection"}
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            className="mt-1 w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
          />
        </ConfirmDialog>
      )}
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
        <Inbox className="h-6 w-6 text-neutral-400" />
      </div>
      <p className="text-sm font-semibold text-neutral-700">
        {filtered ? "No matching requests" : "You're all caught up"}
      </p>
      <p className="mt-1 max-w-sm text-xs text-neutral-500">
        {filtered
          ? "No pending approvals match the current filters. Try clearing them."
          : "There are no indirect material requests awaiting approval right now."}
      </p>
    </div>
  );
}
