import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ClipboardList,
  Clock,
  Copy,
  FileText,
  Link2,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  Split,
  Truck,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  getMaterialRequestMode,
  getMaterialRequestProcurementType,
  getMaterialRequestWorkflowStatus,
  listMaterialRequestsWorkflow,
} from "../../api/materialRequestWorkflow";
import { canCreateMaterialRequest } from "../../config/materialRequestPermissions";
import type {
  MaterialRequestMode,
  MaterialRequestProcurementType,
  MaterialRequestWorkflowStatus,
} from "../../types/materialRequestWorkflow";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import StatusBadge from "../../components/StatusBadge";
import ProcurementTypeBadge from "../../components/ProcurementTypeBadge";
import RequestModeBadge from "../../components/RequestModeBadge";
import ExportButton from "../../components/export/ExportButton";
import { SearchInput, TableRowActions } from "../../components/ui";
import type { ExportColumn } from "../../utils/export";
import { usePagination } from "../../hooks/usePagination";
import { useAuthStore } from "../../store/authStore";
import { formatDate } from "../../utils/format";
import {
  computeRequestFulfillment,
  type RequestFulfillmentStatus,
} from "../../utils/materialRequestFulfillment";

/** Card key → the fulfillment roll-up statuses it counts. */
const FULFILLMENT_FILTERS: Record<string, RequestFulfillmentStatus[]> = {
  pending: ["Pending Review"],
  partial: ["Partially Fulfilled"],
  issued: ["Fully Issued", "Completed"],
  procurement: ["Sent to Procurement"],
  // "Items Received" = anything the warehouse has issued (fully or partially).
  received: ["Fully Issued", "Partially Fulfilled", "Completed"],
};

export default function MaterialRequestsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const statusFilter = params.get(
    "status",
  ) as MaterialRequestWorkflowStatus | null;
  const typeParam = params.get("type");
  const typeFilter: MaterialRequestProcurementType | null =
    typeParam === "Direct" || typeParam === "Indirect" ? typeParam : null;
  const modeParam = params.get("mode");
  const modeFilter: MaterialRequestMode | null =
    modeParam === "Existing" || modeParam === "New" ? modeParam : null;
  const user = useAuthStore((s) => s.user);
  const canCreate = canCreateMaterialRequest(user?.role);
  const [search, setSearch] = useState("");

  const setTypeFilter = (next: MaterialRequestProcurementType | null) => {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set("type", next);
    else nextParams.delete("type");
    setParams(nextParams, { replace: true });
  };

  const setModeFilter = (next: MaterialRequestMode | null) => {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set("mode", next);
    else nextParams.delete("mode");
    setParams(nextParams, { replace: true });
  };

  const { data = [], isLoading } = useQuery({
    queryKey: ["material-requests-workflow", statusFilter, "all"],
    queryFn: async () => {
      const all = await listMaterialRequestsWorkflow();

      if (import.meta.env.DEV) {
        console.log("[MR List] ERPNext response", {
          count: all.length,
          firstRecord: all[0]
            ? {
                name: all[0].name,
                creation: all[0].creation,
                status: all[0].status,
                docstatus: all[0].docstatus,
              }
            : null,
          lastRecord: all.at(-1)
            ? {
                name: all.at(-1)?.name,
                creation: all.at(-1)?.creation,
                status: all.at(-1)?.status,
                docstatus: all.at(-1)?.docstatus,
              }
            : null,
        });
      }

      return all;
    },
  });

  const fParam = params.get("f");

  // Roll-up counts for the summary cards (single source: fulfillment model).
  const summary = useMemo(() => {
    const counts = {
      total: data.length,
      pending: 0,
      partial: 0,
      issued: 0,
      procurement: 0,
    };
    for (const m of data) {
      const rollup = computeRequestFulfillment(m).rollup;
      if (rollup === "Pending Review") counts.pending += 1;
      else if (rollup === "Partially Fulfilled") counts.partial += 1;
      else if (rollup === "Fully Issued" || rollup === "Completed")
        counts.issued += 1;
      else if (rollup === "Sent to Procurement") counts.procurement += 1;
    }
    return counts;
  }, [data]);

  const rows = useMemo(() => {
    let base = data;
    const q = search.trim().toLowerCase();

    if (q) {
      base = base.filter((m) => {
        const haystack = [
          m.name,
          m.custom_priority,
          getMaterialRequestWorkflowStatus(m),
          getMaterialRequestProcurementType(m),
          getMaterialRequestMode(m),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    if (typeFilter) {
      base = base.filter(
        (m) => getMaterialRequestProcurementType(m) === typeFilter,
      );
    }

    if (modeFilter) {
      base = base.filter((m) => getMaterialRequestMode(m) === modeFilter);
    }

    if (fParam && FULFILLMENT_FILTERS[fParam]) {
      const allowed = new Set(FULFILLMENT_FILTERS[fParam]);
      base = base.filter((m) =>
        allowed.has(computeRequestFulfillment(m).rollup),
      );
    }

    if (!statusFilter) return base;

    return base.filter((m) => {
      const workflow = getMaterialRequestWorkflowStatus(m);
      const status = (m.status ?? "").trim();

      if (statusFilter === "Completed") {
        return (
          workflow === "Completed" ||
          workflow === "Material Issued" ||
          status === "Issued" ||
          status === "Completed"
        );
      }

      if (statusFilter === "Submitted") {
        return (
          workflow === "Submitted" ||
          workflow === "Under Warehouse Review" ||
          workflow === "Stock Available" ||
          workflow === "Procurement Required" ||
          workflow === "Forwarded to Procurement" ||
          workflow === "RFQ Created" ||
          status === "Pending" ||
          status === "Submitted"
        );
      }

      if (statusFilter === "Draft") {
        return (
          workflow === "Draft" || status === "Draft" || (m.docstatus ?? 0) === 0
        );
      }

      return workflow === statusFilter || status === statusFilter;
    });
  }, [data, statusFilter, fParam, typeFilter, modeFilter, search]);

  // This queue is built from a computed workflow-status roll-up (not a raw
  // ERPNext column), so the underlying fetch stays a single bulk query —
  // pagination is applied client-side, over the already-filtered rows, purely
  // to cap how many are rendered per page.
  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: `${statusFilter ?? ""}|${fParam ?? ""}|${typeFilter ?? ""}|${modeFilter ?? ""}|${search}`,
  });
  const totalRecords = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize]
  );

  const exportColumns = useMemo<ExportColumn<(typeof rows)[number]>[]>(
    () => [
      { id: "name", label: "MR Number", accessor: (r) => r.name },
      {
        id: "type",
        label: "Request Type",
        type: "status",
        accessor: (r) => getMaterialRequestProcurementType(r),
      },
      {
        id: "mode",
        label: "Request Mode",
        type: "status",
        accessor: (r) => getMaterialRequestMode(r),
      },
      {
        id: "request_date",
        label: "Request Date",
        type: "date",
        accessor: (r) => r.transaction_date,
      },
      {
        id: "required_date",
        label: "Required Date",
        type: "date",
        accessor: (r) => r.schedule_date,
      },
      {
        id: "priority",
        label: "Priority",
        type: "status",
        accessor: (r) => r.custom_priority,
      },
      {
        id: "status",
        label: "Status",
        type: "status",
        accessor: (r) => getMaterialRequestWorkflowStatus(r),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Request History"
        description="Search, filter, and manage all of your Material Requests in one place."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton
              module="Material Requests"
              filenamePrefix="Material_Requests"
              columns={exportColumns}
              rows={rows}
            />
            {canCreate ? (
              <Link to="/material-requests/new" className="btn-primary no-underline">
                <Plus className="h-4 w-4" />
                New Request
              </Link>
            ) : null}
          </div>
        }
      />

      <DashboardKpiGrid columns={5} className="mb-5">
        <DashboardKpiCard
          to="/material-requests/list"
          icon={ClipboardList}
          label="Total Requests"
          value={summary.total}
          iconClassName="bg-neutral-100 text-neutral-500"
          className={!fParam ? "ring-1 ring-primary-200 border-primary-400" : ""}
        />
        <DashboardKpiCard
          to="/material-requests/list?f=pending"
          icon={Clock}
          label="Pending Review"
          value={summary.pending}
          iconClassName="bg-amber-50 text-amber-600"
          className={fParam === "pending" ? "ring-1 ring-primary-200 border-primary-400" : ""}
        />
        <DashboardKpiCard
          to="/material-requests/list?f=partial"
          icon={Split}
          label="Partially Fulfilled"
          value={summary.partial}
          iconClassName="bg-orange-50 text-orange-600"
          className={fParam === "partial" ? "ring-1 ring-primary-200 border-primary-400" : ""}
        />
        <DashboardKpiCard
          to="/material-requests/list?f=issued"
          icon={PackageCheck}
          label="Fully Issued"
          value={summary.issued}
          iconClassName="bg-emerald-50 text-emerald-600"
          className={fParam === "issued" ? "ring-1 ring-primary-200 border-primary-400" : ""}
        />
        <DashboardKpiCard
          to="/material-requests/list?f=procurement"
          icon={Truck}
          label="Sent to Procurement"
          value={summary.procurement}
          iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]"
          className={fParam === "procurement" ? "ring-1 ring-primary-200 border-primary-400" : ""}
        />
      </DashboardKpiGrid>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="min-w-[220px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by MR number, status, or priority…"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t("procurementType.filterLabel")}
          </span>
          {([null, "Direct", "Indirect"] as const).map((opt) => {
            const active = typeFilter === opt;
            const label =
              opt === null
                ? t("procurementType.all")
                : opt === "Direct"
                  ? t("procurementType.direct")
                  : t("procurementType.indirect");
            return (
              <button
                key={opt ?? "all"}
                type="button"
                onClick={() => setTypeFilter(opt)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "bg-primary-600 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {label}
              </button>
            );
          })}
          <span className="ml-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t("requestMode.filterLabel")}
          </span>
          {([null, "Existing", "New"] as const).map((opt) => {
            const active = modeFilter === opt;
            const label =
              opt === null
                ? t("requestMode.all")
                : opt === "Existing"
                  ? t("requestMode.existing")
                  : t("requestMode.new");
            return (
              <button
                key={opt ?? "all-mode"}
                type="button"
                onClick={() => setModeFilter(opt)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "bg-primary-600 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table table-fixed">
              <thead>
                <tr>
                  <th className="w-[15%]">MR Number</th>
                  <th className="w-[11%]">{t("procurementType.label")}</th>
                  <th className="w-[11%]">{t("requestMode.label")}</th>
                  <th className="w-[13%]">Request Date</th>
                  <th className="w-[13%]">Required Date</th>
                  <th className="w-[10%]">Priority</th>
                  <th className="w-[17%]">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((mr) => {
                  const detailPath = `/material-requests/${encodeURIComponent(mr.name)}`;
                  return (
                    <tr key={mr.name}>
                      <td>
                        <Link
                          to={detailPath}
                          className="table-link no-underline"
                        >
                          {mr.name}
                        </Link>
                      </td>
                      <td>
                        <ProcurementTypeBadge
                          type={getMaterialRequestProcurementType(mr)}
                        />
                      </td>
                      <td>
                        <RequestModeBadge mode={getMaterialRequestMode(mr)} />
                      </td>
                      <td>{formatDate(mr.transaction_date)}</td>
                      <td>{formatDate(mr.schedule_date)}</td>
                      <td>{mr.custom_priority ?? "—"}</td>
                      <td>
                        <StatusBadge
                          status={getMaterialRequestWorkflowStatus(mr)}
                        />
                      </td>
                      <td className="col-actions">
                        <TableRowActions
                          label={mr.name}
                          viewTo={detailPath}
                          items={[
                            {
                              id: "edit",
                              label: "Edit",
                              icon: Pencil,
                              onClick: () => navigate(detailPath),
                            },
                            {
                              id: "duplicate",
                              label: "Duplicate",
                              icon: Copy,
                              onClick: () =>
                                toast("Duplicate from Material Request details", {
                                  icon: "ℹ️",
                                }),
                            },
                            {
                              id: "pdf",
                              label: "Export PDF",
                              icon: FileText,
                              onClick: () =>
                                toast("Open the Material Request to export PDF", {
                                  icon: "ℹ️",
                                }),
                            },
                            {
                              id: "copy",
                              label: "Copy Link",
                              icon: Link2,
                              onClick: () => {
                                void navigator.clipboard
                                  .writeText(
                                    `${window.location.origin}${detailPath}`,
                                  )
                                  .then(() => toast.success("Link copied"))
                                  .catch(() =>
                                    toast.error("Could not copy link"),
                                  );
                              },
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-neutral-500">
                      No material requests found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>
    </div>
  );
}

