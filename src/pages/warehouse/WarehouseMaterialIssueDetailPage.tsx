import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, Printer } from "lucide-react";

import {
  getMaterialIssueDetail,
  type MaterialIssueStatus,
} from "../../services/warehouseService";
import PageHeader from "../../components/PageHeader";
import ErrorState from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import PdfActions from "../../components/PdfActions";
import MaterialIssueAuditPanel from "../../components/warehouse/MaterialIssueAuditPanel";
import { formatDate } from "../../utils/format";
import {
  buildMaterialIssuePdf,
  materialIssuePdfFilename,
} from "../../utils/pdf/materialIssuePdf";
import { printMaterialIssuePdf } from "../../utils/pdf/materialIssuePdf";

const BACK_PATH = "/warehouse/material-requests/issued";

function StatusPill({ status }: { status: MaterialIssueStatus }) {
  const label = status === "Fully Issued" ? "Completed" : status;
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
      {label}
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
          <ArrowLeft className="h-4 w-4" /> Back to Issued History
        </Link>
        <ErrorState
          title="Material Issue not found"
          description="This Stock Entry could not be loaded from ERPNext."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const pdfData = {
    issue_number: data.name,
    mr_name: data.mr_name,
    department: data.department,
    warehouse: data.warehouse,
    issued_by: data.issued_by,
    receiver: data.received_by || "—",
    issue_date: data.issue_date,
    issue_type: data.issue_type || "Full Issue",
    remarks: data.remarks,
    items: data.items.map((it) => ({
      item_code: it.item_code,
      item_name: it.item_name,
      required_qty: it.requested_qty ?? 0,
      issued_qty: it.issued_qty,
      remaining_qty: it.remaining_qty ?? 0,
      uom: it.uom,
    })),
  };

  const timeline = [
    {
      label: "Material Request",
      value: data.mr_name || "—",
      done: true,
    },
    {
      label: "Stock Issue Created",
      value: data.issue_date ? formatDate(data.issue_date) : "—",
      done: true,
    },
    {
      label: "Received By",
      value: data.received_by || "—",
      done: Boolean(data.received_by),
    },
    {
      label: data.status === "Fully Issued" ? "Completed" : data.status,
      value: data.issue_type || "—",
      done: data.status !== "Cancelled",
    },
  ];

  return (
    <div className="space-y-5 pb-8">
      <Link
        to={BACK_PATH}
        className="mb-1 inline-flex items-center gap-1 text-sm text-neutral-500 no-underline hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Issued History
      </Link>

      <PageHeader
        title="Issue Details"
        description={data.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={data.status} />
            <button
              type="button"
              onClick={() => void printMaterialIssuePdf(pdfData)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
            <PdfActions
              build={() => buildMaterialIssuePdf(pdfData)}
              filename={materialIssuePdfFilename(pdfData)}
              docLabel="Issue Slip"
              variant="button"
            />
            <Link
              to="/warehouse/issue-items/receipts"
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Issue Receipts
            </Link>
          </div>
        }
      />

      {/* Summary */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Issue Summary
        </h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Issue Number
            </dt>
            <dd className="font-mono font-semibold">{data.name}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Material Request
            </dt>
            <dd>
              {data.mr_name ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/material-requests/${encodeURIComponent(data.mr_name)}`,
                    )
                  }
                  className="font-semibold text-primary-700 hover:underline"
                >
                  {data.mr_name}
                </button>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Department
            </dt>
            <dd className="font-medium">{data.department || "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Warehouse
            </dt>
            <dd className="font-medium">{data.warehouse || "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Issued By
            </dt>
            <dd className="font-medium">{data.issued_by}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Receiver
            </dt>
            <dd className="font-medium">{data.received_by || "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Issue Date
            </dt>
            <dd className="font-medium">
              {data.issue_date
                ? formatDate(data.issue_date, "dd MMM yyyy")
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Issue Type
            </dt>
            <dd className="font-medium">{data.issue_type || "—"}</dd>
          </div>
        </dl>
      </div>

      {/* Timeline */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          Issue Timeline
        </h2>
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {timeline.map((step) => (
            <li key={step.label} className="relative">
              <span
                className={`absolute -left-[1.4rem] top-1 h-3 w-3 rounded-full border-2 border-white ${
                  step.done ? "bg-emerald-500" : "bg-slate-300"
                }`}
              />
              <p className="text-[12px] font-semibold text-slate-800">
                {step.label}
              </p>
              <p className="text-[12px] text-slate-500">{step.value}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* Items */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Package className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold">Item Details</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Item Code</th>
                <th className="px-4 py-2 text-left">Item Name</th>
                <th className="px-4 py-2 text-left">Warehouse</th>
                <th className="px-4 py-2 text-right">Requested Qty</th>
                <th className="px-4 py-2 text-right">Issued Qty</th>
                <th className="px-4 py-2 text-right">Remaining Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((it) => (
                <tr key={`${it.item_code}-${it.warehouse}`}>
                  <td className="px-4 py-2 font-mono font-medium text-slate-800">
                    {it.item_code}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{it.item_name}</td>
                  <td className="px-4 py-2 text-slate-600">
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

      {/* Warehouse Remarks — business text only */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold">Warehouse Remarks</h3>
        {(data.remarks_bullets && data.remarks_bullets.length > 0) ||
        data.remarks?.trim() ? (
          <ul className="space-y-1.5 text-sm text-slate-700">
            {(data.remarks_bullets?.length
              ? data.remarks_bullets
              : data.remarks.split(/\r?\n/).filter(Boolean)
            ).map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No remarks recorded.</p>
        )}
      </div>

      <MaterialIssueAuditPanel
        audit={{
          created_by: data.audit?.created_by || data.issued_by,
          created_at: data.audit?.issue_time,
          warehouse: data.audit?.warehouse || data.warehouse,
          browser: data.audit?.browser,
          device: data.audit?.device,
          issue_type: data.issue_type,
          receiver: data.audit?.receiver || data.received_by,
          json_payload: data.audit_payload,
        }}
      />
    </div>
  );
}
