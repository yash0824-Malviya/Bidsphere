import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList,
  Clock,
  Loader2,
  PackageCheck,
  Plus,
  Split,
  Truck,
} from "lucide-react";

import {
  getMaterialRequestWorkflowStatus,
  listMaterialRequestsWorkflow,
} from "../../api/materialRequestWorkflow";
import { canCreateMaterialRequest } from "../../config/materialRequestPermissions";
import type { MaterialRequestWorkflowStatus } from "../../types/materialRequestWorkflow";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
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
  const [params] = useSearchParams();
  const statusFilter = params.get(
    "status",
  ) as MaterialRequestWorkflowStatus | null;
  const user = useAuthStore((s) => s.user);
  const canCreate = canCreateMaterialRequest(user?.role);

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
  }, [data, statusFilter, fParam]);

  return (
    <div>
      <PageHeader
        title="My Requests"
        description="Request items and track their fulfillment."
        actions={
          canCreate ? (
            <Link
              to="/material-requests/new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white no-underline"
            >
              <Plus className="h-4 w-4" />
              New Request
            </Link>
          ) : undefined
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard
          to="/material-requests/list"
          active={!fParam}
          icon={ClipboardList}
          label="Total Requests"
          value={summary.total}
          tone="neutral"
        />
        <SummaryCard
          to="/material-requests/list?f=pending"
          active={fParam === "pending"}
          icon={Clock}
          label="Pending Review"
          value={summary.pending}
          tone="neutral"
        />
        <SummaryCard
          to="/material-requests/list?f=partial"
          active={fParam === "partial"}
          icon={Split}
          label="Partially Fulfilled"
          value={summary.partial}
          tone="orange"
        />
        <SummaryCard
          to="/material-requests/list?f=issued"
          active={fParam === "issued"}
          icon={PackageCheck}
          label="Fully Issued"
          value={summary.issued}
          tone="emerald"
        />
        <SummaryCard
          to="/material-requests/list?f=procurement"
          active={fParam === "procurement"}
          icon={Truck}
          label="Sent to Procurement"
          value={summary.procurement}
          tone="blue"
        />
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">MR Number</th>
                  <th className="px-4 py-3">Request Date</th>
                  <th className="px-4 py-3">Required Date</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.map((mr) => (
                  <tr key={mr.name} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/material-requests/${encodeURIComponent(mr.name)}`}
                        className="font-semibold text-primary-600 no-underline"
                      >
                        {mr.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {formatDate(mr.transaction_date)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDate(mr.schedule_date)}
                    </td>
                    <td className="px-4 py-3">{mr.custom_department ?? "—"}</td>
                    <td className="px-4 py-3">{mr.custom_priority ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={getMaterialRequestWorkflowStatus(mr)}
                      />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-neutral-500"
                    >
                      No material requests found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const CARD_TONES = {
  neutral: "text-neutral-500",
  orange: "text-orange-500",
  emerald: "text-emerald-500",
  blue: "text-blue-500",
} as const;

function SummaryCard({
  to,
  active,
  icon: Icon,
  label,
  value,
  tone,
}: {
  to: string;
  active: boolean;
  icon: typeof ClipboardList;
  label: string;
  value: number;
  tone: keyof typeof CARD_TONES;
}) {
  return (
    <Link
      to={to}
      className={`flex flex-col gap-1 rounded-xl border bg-white p-4 no-underline shadow-sm transition hover:shadow-md ${
        active ? "border-primary-400 ring-1 ring-primary-200" : "border-neutral-200"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${CARD_TONES[tone]}`} />
      </div>
      <span className="text-2xl font-bold tabular-nums text-neutral-900">
        {value}
      </span>
    </Link>
  );
}
