/**
 * Supplier GRN Detail — read-only goods receipt view.
 * Accessible at /supplier/grn/:id
 */

import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, PackagePlus } from "lucide-react";

import { getPurchaseReceipt } from "../../api/purchasing";
import SupplierAccessDenied from "../../components/supplier-portal/SupplierAccessDenied";
import EmptyState from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import { formatDate, formatPercent } from "../../utils/format";
import {
  grnDisplayStatus,
  grnProgress,
  primaryPOFromReceipt,
  primaryWarehouseFromReceipt,
  supplierOwnsRecord,
} from "../../utils/supplierPortalUtils";
import SupplierPortalLayout from "./SupplierPortalLayout";

export default function SupplierGRNDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const name = decodeURIComponent(id);
  const { supplierName, isReady } = useSupplierSession();

  const {
    data: grn,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["supplier-portal-grn", name],
    queryFn: () => getPurchaseReceipt(name),
    enabled: !!name && isReady && !!supplierName,
  });

  if (!isReady || isLoading) {
    return (
      <SupplierPortalLayout>
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </SupplierPortalLayout>
    );
  }

  if (isError || !grn) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackLink />
        <EmptyState
          icon={PackagePlus}
          title="GRN not found"
          description={`"${name}" may have been deleted or you may not have access.`}
        />
      </SupplierPortalLayout>
    );
  }

  if (!supplierOwnsRecord(supplierName, grn)) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackLink />
        <SupplierAccessDenied description="This goods receipt does not belong to your supplier account." />
      </SupplierPortalLayout>
    );
  }

  const displayStatus = grnDisplayStatus(grn);
  const progress = grnProgress(grn);
  const poRef = primaryPOFromReceipt(grn);
  const warehouse = primaryWarehouseFromReceipt(grn);

  const statusText =
    displayStatus === "Completed"
      ? "Fully received"
      : displayStatus === "Partial"
      ? "Partially received"
      : "Pending receipt";

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <BackLink />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{grn.name}</h1>
          <p className="text-sm text-neutral-500">
            {grn.supplier_name ?? grn.supplier}
          </p>
        </div>
        <StatusBadge status={displayStatus} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <InfoCard label="GRN Number" value={grn.name} />
        <InfoCard
          label="PO Reference"
          value={
            poRef ? (
              <Link
                to={`/supplier/po/${encodeURIComponent(poRef)}`}
                className="text-primary-600 hover:underline"
              >
                {poRef}
              </Link>
            ) : (
              "—"
            )
          }
        />
        <InfoCard label="Receipt Date" value={formatDate(grn.posting_date)} />
        <InfoCard label="Warehouse" value={warehouse ?? "—"} />
      </div>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-neutral-700">
            Received {progress.received} / {progress.ordered}
          </p>
          <p className="text-sm font-semibold tabular-nums text-neutral-900">
            {formatPercent(progress.pct)}
          </p>
        </div>
        <div className="mt-3 h-2 w-full rounded-full bg-neutral-100">
          <div
            className="h-2 rounded-full bg-accent-500"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-600">
          <span>
            Remaining:{" "}
            <span className="font-medium tabular-nums text-neutral-900">
              {progress.remaining}
            </span>
          </span>
          <span className="font-medium text-neutral-700">{statusText}</span>
        </div>
      </div>

      <div className="mt-6 card">
        <div className="border-b border-neutral-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">Items</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2">Item Code</th>
                <th className="px-4 py-2">Item Name</th>
                <th className="px-4 py-2 text-right">Ordered Qty</th>
                <th className="px-4 py-2 text-right">Received Qty</th>
                <th className="px-4 py-2 text-right">Remaining Qty</th>
                <th className="px-4 py-2">UOM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {(grn.items ?? []).map((item, idx) => {
                const ordered = item.qty ?? 0;
                const received = item.received_qty ?? item.qty ?? 0;
                const remaining = Math.max(0, ordered - received);
                return (
                  <tr key={item.name ?? idx}>
                    <td className="px-4 py-2 font-medium text-neutral-900">
                      {item.item_code}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {item.item_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {ordered}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-accent-700">
                      {received}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                      {remaining}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {item.uom ?? item.stock_uom ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-neutral-400">
        This is a read-only view. Contact Netlink procurement for any queries
        about this receipt.
      </p>
    </SupplierPortalLayout>
  );
}

function BackLink() {
  return (
    <Link
      to="/supplier/grn"
      className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Goods Receipts
    </Link>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-neutral-900">
        {value}
      </p>
    </div>
  );
}
