import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MapPin, Truck } from "lucide-react";
import toast from "react-hot-toast";

import { getSupplierPurchaseOrders } from "../../api/supplierPortal";
import {
  type PODeliveryState,
  ensureDeliveryState,
  updateDeliveryDetails,
  markInTransit,
} from "../../api/poDeliveryWorkflow";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import CalendarDatePicker from "../../components/ui/CalendarDatePicker";
import { formatUkDisplayDate } from "../../utils/erpNextDate";
import { formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

type DeliveryFilterStatus =
  | "Accepted"
  | "In Transit"
  | "Partially Received"
  | "Completed";

const DELIVERY_STATUSES: DeliveryFilterStatus[] = [
  "Accepted",
  "In Transit",
  "Partially Received",
  "Completed",
];

interface DeliveryRow {
  poName: string;
  transactionDate?: string;
  grandTotal?: number;
  delivery: PODeliveryState;
}

const STATUS_BADGE_CLASSES: Record<DeliveryFilterStatus, string> = {
  Accepted: "bg-primary-100 text-primary-700",
  "In Transit": "bg-purple-100 text-purple-700",
  "Partially Received": "bg-accent-100 text-accent-700",
  Completed: "bg-success-100 text-success-700",
};

const STATUS_LABEL: Record<DeliveryFilterStatus, string> = {
  Accepted: "Shipment Pending",
  "In Transit": "In Transit",
  "Partially Received": "Partially Received",
  Completed: "Completed",
};

function DeliveryStatusBadge({ status }: { status: DeliveryFilterStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

interface EditState {
  vehicle_number: string;
  tracking_number: string;
  expected_delivery_date: string;
}

export default function SupplierDeliverySchedulePage() {
  const { supplierName, isReady } = useSupplierSession();
  const [editingPO, setEditingPO] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditState>({
    vehicle_number: "",
    tracking_number: "",
    expected_delivery_date: "",
  });
  const [refreshKey, setRefreshKey] = useState(0);

  const posQuery = useQuery({
    queryKey: ["supplier-portal-pos", supplierName, refreshKey],
    enabled: !!supplierName,
    queryFn: () => getSupplierPurchaseOrders(supplierName),
  });

  const rows = useMemo<DeliveryRow[]>(() => {
    if (!posQuery.data) return [];

    return posQuery.data
      .map((po) => {
        const delivery = ensureDeliveryState(po.name, supplierName);
        return {
          poName: po.name,
          transactionDate: po.transaction_date,
          grandTotal: po.grand_total,
          delivery,
        };
      })
      .filter((r) =>
        DELIVERY_STATUSES.includes(r.delivery.status as DeliveryFilterStatus)
      );
  }, [posQuery.data, supplierName, refreshKey]);

  const counts = useMemo(() => {
    const c = { scheduled: 0, inTransit: 0, delivered: 0, pending: 0 };
    for (const r of rows) {
      switch (r.delivery.status) {
        case "Accepted":
          c.pending++;
          c.scheduled++;
          break;
        case "In Transit":
          c.inTransit++;
          c.scheduled++;
          break;
        case "Partially Received":
          c.scheduled++;
          break;
        case "Completed":
          c.delivered++;
          break;
      }
    }
    return c;
  }, [rows]);

  function handleMarkShipped(poName: string) {
    try {
      markInTransit(poName, supplierName);
      toast.success(`PO ${poName} marked as shipped`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to mark as shipped"
      );
    }
  }

  function startEditing(row: DeliveryRow) {
    setEditingPO(row.poName);
    setEditForm({
      vehicle_number: row.delivery.vehicle_number ?? "",
      tracking_number: row.delivery.tracking_number ?? "",
      expected_delivery_date: row.delivery.expected_delivery_date ?? "",
    });
  }

  function cancelEditing() {
    setEditingPO(null);
  }

  function saveEditing(poName: string) {
    try {
      updateDeliveryDetails(poName, editForm, supplierName);
      toast.success("Delivery details updated");
      setEditingPO(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update details"
      );
    }
  }

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
        title="Delivery Schedule"
        description="Track and manage delivery schedules for accepted purchase orders."
      />

      {/* KPI Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Scheduled"
          value={counts.scheduled}
          icon={<CalendarDays className="h-5 w-5 text-primary-500" />}
          bg="bg-primary-50"
        />
        <KpiCard
          label="In Transit"
          value={counts.inTransit}
          icon={<Truck className="h-5 w-5 text-purple-500" />}
          bg="bg-purple-50"
        />
        <KpiCard
          label="Delivered"
          value={counts.delivered}
          icon={<MapPin className="h-5 w-5 text-success-500" />}
          bg="bg-success-50"
        />
        <KpiCard
          label="Pending Shipment"
          value={counts.pending}
          icon={<CalendarDays className="h-5 w-5 text-accent-500" />}
          bg="bg-accent-50"
        />
      </div>

      {/* Table */}
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900">
              Delivery Schedule
            </h2>
          </div>
          <span className="text-xs text-neutral-500">{rows.length} total</span>
        </div>

        {posQuery.isLoading ? (
          <TableSkeleton rows={5} columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No deliveries scheduled"
            description="Accepted purchase orders and their delivery schedules will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Expected Delivery</th>
                  <th className="px-4 py-3">Vehicle No.</th>
                  <th className="px-4 py-3">Tracking No.</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.map((row) => {
                  const isEditing = editingPO === row.poName;
                  const status =
                    row.delivery.status as DeliveryFilterStatus;

                  return (
                    <tr
                      key={row.poName}
                      className="hover:bg-accent-50/40"
                    >
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        <Link
                          to={`/supplier/po/${encodeURIComponent(row.poName)}`}
                          className="text-primary-700 hover:underline"
                        >
                          {row.poName}
                        </Link>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {isEditing ? (
                          <CalendarDatePicker
                            className="min-w-[140px]"
                            value={editForm.expected_delivery_date}
                            onChange={(iso) =>
                              setEditForm((f) => ({
                                ...f,
                                expected_delivery_date: iso,
                              }))
                            }
                            required
                            placeholder="DD/MM/YYYY"
                          />
                        ) : row.delivery.expected_delivery_date ? (
                          formatUkDisplayDate(row.delivery.expected_delivery_date)
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {isEditing ? (
                          <input
                            type="text"
                            className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            placeholder="e.g. KA-01-1234"
                            value={editForm.vehicle_number}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                vehicle_number: e.target.value,
                              }))
                            }
                          />
                        ) : (
                          row.delivery.vehicle_number || "—"
                        )}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {isEditing ? (
                          <input
                            type="text"
                            className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            placeholder="e.g. TRK-12345"
                            value={editForm.tracking_number}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                tracking_number: e.target.value,
                              }))
                            }
                          />
                        ) : (
                          row.delivery.tracking_number || "—"
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <DeliveryStatusBadge status={status} />
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveEditing(row.poName)}
                                className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditing}
                                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              {status === "Accepted" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleMarkShipped(row.poName)
                                  }
                                  className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
                                >
                                  <Truck className="h-3 w-3" />
                                  Mark as Shipped
                                </button>
                              )}
                              {(status === "Accepted" ||
                                status === "In Transit") && (
                                <button
                                  type="button"
                                  onClick={() => startEditing(row)}
                                  className="rounded-md border border-primary-300 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"
                                >
                                  Update Details
                                </button>
                              )}
                            </>
                          )}
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

      {/* Delivery Timeline */}
      {rows.length > 0 && (
        <section className="card mt-6">
          <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
            <CalendarDays className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900">
              Delivery Timeline
            </h2>
          </div>
          <div className="px-5 py-4">
            <ol className="relative border-l border-neutral-200">
              {rows
                .filter((r) => r.delivery.updated_at)
                .sort(
                  (a, b) =>
                    new Date(b.delivery.updated_at).getTime() -
                    new Date(a.delivery.updated_at).getTime()
                )
                .slice(0, 10)
                .map((row) => (
                  <TimelineItem key={row.poName} row={row} />
                ))}
            </ol>
          </div>
        </section>
      )}
    </SupplierPortalLayout>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  icon,
  bg,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  bg: string;
}) {
  return (
    <div className="card flex items-center gap-3 px-4 py-4">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${bg}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold tabular-nums text-neutral-900">
          {value}
        </p>
        <p className="truncate text-xs text-neutral-500">{label}</p>
      </div>
    </div>
  );
}

function TimelineItem({ row }: { row: DeliveryRow }) {
  const status = row.delivery.status as DeliveryFilterStatus;
  const dotColor: Record<DeliveryFilterStatus, string> = {
    Accepted: "bg-primary-500",
    "In Transit": "bg-purple-500",
    "Partially Received": "bg-accent-500",
    Completed: "bg-success-500",
  };

  return (
    <li className="mb-6 ml-6">
      <span
        className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ring-4 ring-white ${dotColor[status]}`}
      />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          to={`/supplier/po/${encodeURIComponent(row.poName)}`}
          className="text-sm font-semibold text-primary-700 hover:underline"
        >
          {row.poName}
        </Link>
        <DeliveryStatusBadge status={status} />
        <time className="text-xs text-neutral-400">
          {formatDate(row.delivery.updated_at)}
        </time>
      </div>
      {row.delivery.expected_delivery_date && (
        <p className="mt-1 text-xs text-neutral-500">
          Expected delivery:{" "}
          {formatUkDisplayDate(row.delivery.expected_delivery_date)}
        </p>
      )}
      {row.delivery.vehicle_number && (
        <p className="text-xs text-neutral-500">
          Vehicle: {row.delivery.vehicle_number}
          {row.delivery.tracking_number &&
            ` · Tracking: ${row.delivery.tracking_number}`}
        </p>
      )}
    </li>
  );
}
