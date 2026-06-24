import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Truck } from "lucide-react";

import { getSupplierGRNSummaries } from "../../api/supplierPortal";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import { formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

export default function SupplierGRNListPage() {
  const { supplierName, isReady } = useSupplierSession();

  const grnQuery = useQuery({
    queryKey: ["supplier-portal-grn", supplierName],
    enabled: !!supplierName,
    queryFn: () => getSupplierGRNSummaries(supplierName),
  });

  const rows = grnQuery.data ?? [];

  if (!isReady) {
    return (
      <SupplierPortalLayout>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      </SupplierPortalLayout>
    );
  }

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <PageHeader
        title="Goods Receipts (GRN)"
        description="Goods receipt notes recorded against your purchase orders."
      />

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900">
              All GRNs
            </h2>
          </div>
          <span className="text-xs text-neutral-500">{rows.length} total</span>
        </div>

        {grnQuery.isLoading ? (
          <TableSkeleton rows={5} columns={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No goods receipts yet"
            description="When Netlink records receipt of goods against your POs, they will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">GRN Number</th>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Receipt Date</th>
                  <th className="px-4 py-3">Warehouse</th>
                  <th className="px-4 py-3 text-right">Item Count</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.map((grn) => (
                  <tr key={grn.name} className="hover:bg-accent-50/40">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {grn.name}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {grn.poNumber ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                      {grn.posting_date
                        ? formatDate(grn.posting_date)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {grn.warehouse ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-900">
                      {grn.itemCount}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={grn.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/supplier/grn/${encodeURIComponent(grn.name)}`}
                        className="inline-flex items-center gap-1 rounded-md border border-primary-300 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"
                      >
                        View GRN
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SupplierPortalLayout>
  );
}
