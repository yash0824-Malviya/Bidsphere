import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";

import {
  countDepartmentAcceptedItems,
  countDepartmentPendingAcceptance,
  departmentReceiptStatusLabel,
  listDepartmentAcceptedItems,
  listDepartmentIssueReceipts,
  listDepartmentPendingAcceptance,
  type DepartmentIssuedFilter,
} from "../../api/departmentIssuedItems";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { formatDate } from "../../utils/format";
import { downloadMaterialIssueReceiptPdf } from "../../utils/pdf/materialIssueReceiptPdf";
import type { MaterialIssueReceipt } from "../../types/materialIssueReceipt";

type Mode = "pending" | "accepted" | "all";

function totals(r: MaterialIssueReceipt) {
  return r.items.reduce(
    (acc, i) => {
      acc.requested += Number(i.requested_qty) || 0;
      acc.issued += Number(i.issued_qty) || 0;
      return acc;
    },
    { requested: 0, issued: 0 },
  );
}

/**
 * Department → Issued Items module lists.
 * Data source: syncDepartmentIssuedItems (Stock Entry + MR MIR + local cache).
 */
export default function DepartmentIssuedItemsPage({
  mode = "pending",
}: {
  mode?: Mode;
}) {
  const [mrFilter, setMrFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "accepted"
  >("all");

  const filter: DepartmentIssuedFilter = useMemo(
    () => ({
      status: mode === "all" ? statusFilter : mode === "pending" ? "pending" : "accepted",
      mrName: mrFilter,
      department: deptFilter,
      dateFrom,
      dateTo,
    }),
    [mode, statusFilter, mrFilter, deptFilter, dateFrom, dateTo],
  );

  const listQuery = useQuery({
    queryKey: ["department-issued-items", mode, filter],
    queryFn: async () => {
      if (mode === "pending") return listDepartmentPendingAcceptance();
      if (mode === "accepted") return listDepartmentAcceptedItems();
      return listDepartmentIssueReceipts(filter);
    },
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const kpiQuery = useQuery({
    queryKey: ["department-issued-items", "kpi"],
    queryFn: async () => ({
      pending: await countDepartmentPendingAcceptance(),
      accepted: await countDepartmentAcceptedItems(),
    }),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const rows = listQuery.data ?? [];
  const title =
    mode === "pending"
      ? "Pending Acceptance"
      : mode === "accepted"
        ? "Accepted Items"
        : "Issue Receipts";
  const description =
    mode === "pending"
      ? "Material Issue Receipts waiting for your acceptance and digital signature."
      : mode === "accepted"
        ? "Receipts you have digitally accepted."
        : "Complete Material Issue Receipt history for your department.";

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase text-amber-700">
                Pending
              </p>
              <p className="text-lg font-bold text-amber-900">
                {kpiQuery.data?.pending ?? "—"}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase text-emerald-700">
                Accepted
              </p>
              <p className="text-lg font-bold text-emerald-900">
                {kpiQuery.data?.accepted ?? "—"}
              </p>
            </div>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          to="/department/issued-items/pending-acceptance"
          className={`rounded-lg border px-3 py-1.5 no-underline ${
            mode === "pending"
              ? "border-primary-200 bg-primary-50 text-primary-800"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Pending Acceptance
        </Link>
        <Link
          to="/department/issued-items/accepted-items"
          className={`rounded-lg border px-3 py-1.5 no-underline ${
            mode === "accepted"
              ? "border-primary-200 bg-primary-50 text-primary-800"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Accepted Items
        </Link>
        <Link
          to="/department/issued-items/issue-receipts"
          className={`rounded-lg border px-3 py-1.5 no-underline ${
            mode === "all"
              ? "border-primary-200 bg-primary-50 text-primary-800"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Issue Receipts
        </Link>
      </div>

      {mode === "all" ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="text-xs font-semibold text-slate-600">
            Status
            <select
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "pending" | "accepted")
              }
            >
              <option value="all">All</option>
              <option value="pending">Pending Acceptance</option>
              <option value="accepted">Accepted</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Material Request
            <input
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={mrFilter}
              onChange={(e) => setMrFilter(e.target.value)}
              placeholder="MAT-MR-…"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Department
            <input
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              placeholder="Department"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            From
            <input
              type="date"
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            To
            <input
              type="date"
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
      ) : null}

      <div className="rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
        {listQuery.isLoading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Synchronizing receipts…
          </div>
        ) : listQuery.isError ? (
          <div className="px-6 py-12 text-center text-sm text-rose-600">
            Could not load Material Issue Receipts.{" "}
            {listQuery.error instanceof Error ? listQuery.error.message : ""}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No receipts in this view yet. After Warehouse issues material, records
            appear here automatically.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Receipt No.</th>
                  <th className="px-4 py-3">Material Request</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Warehouse</th>
                  {mode === "accepted" ? (
                    <>
                      <th className="px-4 py-3">Accepted Date</th>
                      <th className="px-4 py-3">Accepted By</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3">Issue Date</th>
                      <th className="px-4 py-3">Receiver</th>
                      <th className="px-4 py-3 text-right">Requested</th>
                      <th className="px-4 py-3 text-right">Issued</th>
                    </>
                  )}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const qty = totals(r);
                  const pending =
                    r.status === "Pending Department Acceptance" ||
                    r.status === "Waiting Warehouse Signature";
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-mono font-semibold">
                        {r.issue_number}
                      </td>
                      <td className="px-4 py-3 font-mono">{r.mr_name}</td>
                      <td className="px-4 py-3">{r.department || "—"}</td>
                      <td className="px-4 py-3">{r.warehouse || "—"}</td>
                      {mode === "accepted" ? (
                        <>
                          <td className="px-4 py-3">
                            {formatDate(
                              r.confirmed_at || r.department_signed_at || "",
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {r.department_signature?.signer_name || "—"}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3">
                            {formatDate(r.issue_date)}
                          </td>
                          <td className="px-4 py-3">{r.received_by || "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {qty.requested}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">
                            {qty.issued}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={
                            r.status === "Confirmed"
                              ? "Accepted"
                              : departmentReceiptStatusLabel(r.status)
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {(mode === "accepted" || mode === "all") &&
                          r.status === "Confirmed" ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:underline"
                              onClick={() =>
                                void downloadMaterialIssueReceiptPdf(r)
                              }
                            >
                              <Download className="h-3.5 w-3.5" />
                              PDF
                            </button>
                          ) : null}
                          <Link
                            to={`/department/issued-items/receipts/${encodeURIComponent(r.issue_number)}`}
                            className="text-sm font-medium text-primary-700 hover:underline"
                          >
                            {pending ? "Accept Material" : "View Receipt"}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
