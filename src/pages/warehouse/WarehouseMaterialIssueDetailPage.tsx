import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package } from "lucide-react";

import {
  getMaterialIssueDetail,
  type MaterialIssueStatus,
} from "../../services/warehouseService";
import PageHeader from "../../components/PageHeader";
import ErrorState from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatDate } from "../../utils/format";

const BACK_PATH = "/warehouse/material-requests/issued";

function StatusPill({ status }: { status: MaterialIssueStatus }) {
  const cls =
    status === "Fully Issued"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "Partially Issued"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {status}
    </span>
  );
}

export default function WarehouseMaterialIssueDetailPage() {
  const { name = "" } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["material-issue-detail", name],
    queryFn: () => getMaterialIssueDetail(name),
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <Link
          to={BACK_PATH}
          className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 no-underline hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Material Issued Logs
        </Link>
        <ErrorState
          title="Material Issue not found"
          description="This Stock Entry could not be loaded from ERPNext."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const infoFields = [
    { label: "Issue Number", value: data.name },
    { label: "Material Request", value: data.mr_name },
    { label: "Department", value: data.department },
    { label: "Warehouse", value: data.warehouse },
    { label: "Issued By", value: data.issued_by },
    {
      label: "Issue Date",
      value: data.issue_date ? formatDate(data.issue_date, "dd MMM yyyy") : "",
    },
    { label: "Stock Entry Number", value: data.stock_entry_number },
  ].filter((f) => f.value && String(f.value).trim());

  return (
    <div>
      <Link
        to={BACK_PATH}
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 no-underline hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Material Issued Logs
      </Link>

      <PageHeader
        title="Material Issue Details"
        description="Read-only view of a warehouse stock issue."
        actions={<StatusPill status={data.status} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {infoFields.map((f) => (
          <div
            key={f.label}
            className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
          >
            <p className="text-xs uppercase text-neutral-500">{f.label}</p>
            {f.label === "Material Request" && data.mr_name ? (
              <button
                type="button"
                onClick={() =>
                  navigate(`/material-requests/${encodeURIComponent(data.mr_name)}`)
                }
                className="mt-1 truncate text-sm font-semibold text-primary-700 hover:underline"
              >
                {f.value}
              </button>
            ) : (
              <p className="mt-1 truncate text-sm font-medium">{f.value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="card mb-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
          <Package className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-bold">Items Issued</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2 text-left">Item Code</th>
                <th className="px-4 py-2 text-left">Item Name</th>
                <th className="px-4 py-2 text-left">Warehouse</th>
                <th className="px-4 py-2 text-right">Requested Qty</th>
                <th className="px-4 py-2 text-right">Issued Qty</th>
                <th className="px-4 py-2 text-right">Remaining Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.items.map((it) => (
                <tr key={`${it.item_code}-${it.warehouse}`}>
                  <td className="px-4 py-2 font-mono font-medium text-neutral-800">
                    {it.item_code}
                  </td>
                  <td className="px-4 py-2 text-neutral-700">{it.item_name}</td>
                  <td className="px-4 py-2 text-neutral-600">
                    {it.warehouse || "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {it.requested_qty == null
                      ? "—"
                      : `${it.requested_qty} ${it.uom}`}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-emerald-700">
                    {it.issued_qty} {it.uom}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-orange-700">
                    {it.remaining_qty == null
                      ? "—"
                      : `${it.remaining_qty} ${it.uom}`}
                  </td>
                </tr>
              ))}
              {data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-neutral-500"
                  >
                    No items on this issue.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {data.remarks ? (
        <div className="card mb-6 p-5">
          <h3 className="mb-2 text-sm font-bold">Remarks</h3>
          <p className="text-sm text-neutral-700">{data.remarks}</p>
        </div>
      ) : null}
    </div>
  );
}
