import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";

import {
  countDepartmentAcceptedItems,
  countDepartmentPendingAcceptance,
  departmentReceiptStatusLabel,
  isDepartmentIssuedSyncInProgress,
  listDepartmentAcceptedItemsLocal,
  listDepartmentIssueReceipts,
  listDepartmentIssueReceiptsLocal,
  listDepartmentPendingAcceptance,
  listDepartmentPendingAcceptanceLocal,
  onDepartmentIssuedItemsSynced,
  scheduleDepartmentIssuedBackgroundSync,
  wasDepartmentIssuedSyncTimedOut,
  type DepartmentIssuedFilter,
} from "../../api/departmentIssuedItems";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import Pagination from "../../components/ui/Pagination";
import { useClientPagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";
import { downloadMaterialIssueReceiptPdf } from "../../utils/pdf/materialIssueReceiptPdf";
import type { MaterialIssueReceipt } from "../../types/materialIssueReceipt";

type Mode = "pending" | "all";

const CACHE_STALE_MS = 45_000;

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
 * Cache-first: render local receipts immediately, sync ERP in background.
 *
 * Workflow: Pending Acceptance → accept → Issue Receipts (historical record).
 */
export default function DepartmentIssuedItemsPage({
  mode = "pending",
}: {
  mode?: Mode;
}) {
  const queryClient = useQueryClient();
  const pageStart = useMemo(() => performance.now(), []);
  const [mrFilter, setMrFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "accepted"
  >("all");
  const [syncBanner, setSyncBanner] = useState(false);

  const filter: DepartmentIssuedFilter = useMemo(
    () => ({
      status: mode === "all" ? statusFilter : "pending",
      mrName: mrFilter,
      dateFrom,
      dateTo,
    }),
    [mode, statusFilter, mrFilter, dateFrom, dateTo],
  );

  const localSeed = useMemo(() => {
    if (mode === "pending") return listDepartmentPendingAcceptanceLocal();
    return listDepartmentIssueReceiptsLocal(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const listQuery = useQuery({
    queryKey: ["department-issued-items", mode, filter],
    queryFn: async () => {
      const start = performance.now();
      const rows =
        mode === "pending"
          ? await listDepartmentPendingAcceptance()
          : await listDepartmentIssueReceipts(filter);
      // eslint-disable-next-line no-console
      console.log("[DeptIssued Perf] page listQuery", {
        mode,
        rowCount: rows.length,
        durationMs: Math.round(performance.now() - start),
        totalSinceMountMs: Math.round(performance.now() - pageStart),
      });
      return rows;
    },
    initialData: localSeed,
    placeholderData: (prev) => prev ?? localSeed,
    staleTime: CACHE_STALE_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  const kpiQuery = useQuery({
    queryKey: ["department-issued-items", "kpi"],
    queryFn: async () => {
      const [pending, accepted] = await Promise.all([
        countDepartmentPendingAcceptance(),
        countDepartmentAcceptedItems(),
      ]);
      return { pending, accepted };
    },
    initialData: {
      pending: listDepartmentPendingAcceptanceLocal().length,
      accepted: listDepartmentAcceptedItemsLocal().length,
    },
    staleTime: CACHE_STALE_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Background sync — never block first paint; refresh when sync finishes.
  useEffect(() => {
    scheduleDepartmentIssuedBackgroundSync();
    setSyncBanner(
      isDepartmentIssuedSyncInProgress() || wasDepartmentIssuedSyncTimedOut(),
    );
    const off = onDepartmentIssuedItemsSynced(() => {
      setSyncBanner(isDepartmentIssuedSyncInProgress());
      void queryClient.invalidateQueries({
        queryKey: ["department-issued-items"],
      });
      // eslint-disable-next-line no-console
      console.log("[DeptIssued Perf] background sync notified UI", {
        totalSinceMountMs: Math.round(performance.now() - pageStart),
      });
    });
    const poll = window.setInterval(() => {
      setSyncBanner(
        isDepartmentIssuedSyncInProgress() || wasDepartmentIssuedSyncTimedOut(),
      );
    }, 500);
    return () => {
      off();
      window.clearInterval(poll);
    };
  }, [queryClient, pageStart]);

  const rows = listQuery.data ?? localSeed;
  const {
    pageRows,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(rows, {
    resetKey: `${mode}|${statusFilter}|${mrFilter}|${dateFrom}|${dateTo}`,
  });
  const showInitialSpinner =
    listQuery.isLoading && rows.length === 0 && !listQuery.isFetching;
  const title = mode === "pending" ? "Pending Acceptance" : "Issue Receipts";
  const description =
    mode === "pending"
      ? "Material Issue Receipts waiting for your acceptance and digital signature."
      : "Official historical record of Material Issue Receipts for your department.";

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

      {(syncBanner || listQuery.isFetching) && rows.length > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Background sync in progress…
        </div>
      ) : null}

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
        {showInitialSpinner ? (
          <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading receipts…
          </div>
        ) : listQuery.isError && rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-rose-600">
            Could not load Material Issue Receipts.{" "}
            {listQuery.error instanceof Error ? listQuery.error.message : ""}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {listQuery.isFetching || syncBanner ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Background sync in progress…
              </span>
            ) : mode === "pending" ? (
              <>
                No receipts waiting for acceptance. After Warehouse issues
                material, records appear here automatically.
              </>
            ) : (
              <>
                No issue receipts yet. Accepted materials are recorded here as
                the official history.
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Receipt No.</th>
                  <th className="px-4 py-3">Material Request</th>
                  <th className="px-4 py-3">Warehouse</th>
                  <th className="px-4 py-3">Issue Date</th>
                  <th className="px-4 py-3">Receiver</th>
                  <th className="px-4 py-3 text-right">Requested</th>
                  <th className="px-4 py-3 text-right">Issued</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((r) => {
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
                      <td className="px-4 py-3">{r.warehouse || "—"}</td>
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
                          {mode === "all" && r.status === "Confirmed" ? (
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
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalRecords={totalRecords}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              recordLabel="receipts"
            />
          </div>
        )}
      </div>
    </div>
  );
}
