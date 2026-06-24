import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShoppingCart } from "lucide-react";

import { getSupplierPurchaseOrders } from "../../api/supplierPortal";
import {
  ensureDeliveryState,
  type PODeliveryStatus,
} from "../../api/poDeliveryWorkflow";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import { formatCurrency, formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

const DELIVERY_BADGE_STYLES: Record<PODeliveryStatus, string> = {
  "Pending Acceptance": "bg-warning-100 text-warning-700",
  Accepted: "bg-primary-100 text-primary-700",
  Rejected: "bg-danger-100 text-danger-700",
  "In Transit": "bg-purple-100 text-purple-700",
  "Partially Received": "bg-accent-100 text-accent-700",
  Completed: "bg-success-100 text-success-700",
};

type FilterTab = "All" | "Pending" | "Accepted" | "In Transit" | "Completed";

const FILTER_TABS: FilterTab[] = [
  "All",
  "Pending",
  "Accepted",
  "In Transit",
  "Completed",
];

const TAB_TO_STATUSES: Record<FilterTab, PODeliveryStatus[] | null> = {
  All: null,
  Pending: ["Pending Acceptance"],
  Accepted: ["Accepted"],
  "In Transit": ["In Transit"],
  Completed: ["Completed", "Partially Received"],
};

function DeliveryBadge({ status }: { status: PODeliveryStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${DELIVERY_BADGE_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export default function SupplierPOListPage() {
  const { supplierName, isReady } = useSupplierSession();
  const [activeTab, setActiveTab] = useState<FilterTab>("All");

  const posQuery = useQuery({
    queryKey: ["supplier-portal-pos", supplierName],
    enabled: !!supplierName,
    queryFn: () => getSupplierPurchaseOrders(supplierName),
  });

  const rawRows = posQuery.data ?? [];

  const enrichedRows = useMemo(
    () =>
      rawRows.map((po) => ({
        ...po,
        deliveryState: ensureDeliveryState(po.name),
      })),
    [rawRows],
  );

  const filteredRows = useMemo(() => {
    const statuses = TAB_TO_STATUSES[activeTab];
    if (!statuses) return enrichedRows;
    return enrichedRows.filter((r) =>
      statuses.includes(r.deliveryState.status),
    );
  }, [enrichedRows, activeTab]);

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
        title="Purchase Orders"
        description="Purchase orders issued to your company by Netlink procurement."
      />

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900">
              All Purchase Orders
            </h2>
          </div>
          <span className="text-xs text-neutral-500">
            {filteredRows.length} of {enrichedRows.length} total
          </span>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 border-b border-neutral-200 px-5 py-2">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? "bg-primary-100 text-primary-700"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {posQuery.isLoading ? (
          <TableSkeleton rows={5} columns={7} />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No purchase orders yet"
            description="Purchase orders issued to you by Netlink procurement will appear here once submitted."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Order Date</th>
                  <th className="px-4 py-3">Required By</th>
                  <th className="px-4 py-3 text-right">Total Value</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Delivery Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredRows.map((po) => {
                  const isPending =
                    po.deliveryState.status === "Pending Acceptance";
                  return (
                    <tr key={po.name} className="hover:bg-accent-50/40">
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        {po.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {po.transaction_date
                          ? formatDate(po.transaction_date)
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {po.schedule_date
                          ? formatDate(po.schedule_date)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                        {po.grand_total
                          ? formatCurrency(po.grand_total)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={po.status ?? "Submitted"} />
                      </td>
                      <td className="px-4 py-3">
                        <DeliveryBadge status={po.deliveryState.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {isPending && (
                            <span className="inline-block whitespace-nowrap rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-700">
                              Action Required
                            </span>
                          )}
                          <Link
                            to={`/supplier/po/${encodeURIComponent(po.name)}`}
                            className="inline-flex items-center gap-1 rounded-md border border-primary-300 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"
                          >
                            View PO
                            <ArrowRight className="h-3 w-3" />
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
      </section>
    </SupplierPortalLayout>
  );
}
