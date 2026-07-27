import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, MapPin, Truck } from "lucide-react";
import toast from "react-hot-toast";

import { getSupplierPurchaseOrders } from "../../api/supplierPortal";
import { getGRNsForPO } from "../../api/purchasing";
import {
  type PODeliveryState,
  getDeliveryState,
  saveDeliveryState,
  syncDeliveryStateFromERPNext,
  updateDeliveryDetails,
  markInTransit,
  resyncLocalDeliveryStatesToErp,
} from "../../api/poDeliveryWorkflow";
import {
  listPoShipmentsForPos,
  shipmentRecordToDeliveryState,
} from "../../api/poShipment";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";
import CalendarDatePicker from "../../components/ui/CalendarDatePicker";
import { useClientPagination } from "../../hooks/usePagination";
import { formatUkDisplayDate } from "../../utils/erpNextDate";
import { formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import {
  type ScheduleDisplayStatus,
  SCHEDULE_STATUS_BADGE_CLASSES,
  SCHEDULE_STATUS_DOT_CLASSES,
  scheduleStatusFromDeliveryState,
} from "../../utils/deliveryScheduleStatus";

const LOG = "[DeliverySchedule]";

interface DeliveryRow {
  poName: string;
  transactionDate?: string;
  scheduleDate?: string;
  grandTotal?: number;
  perReceived: number;
  poStatus?: string;
  hasSubmittedGrn: boolean;
  delivery: PODeliveryState | null;
  /** Derived from PO + shipment + GRN — never a hardcoded label. */
  displayStatus: ScheduleDisplayStatus;
}

/** Read-only delivery snapshot — never seeds Pending Acceptance during render. */
function readDeliveryState(poName: string): PODeliveryState | null {
  return getDeliveryState(poName);
}

function DeliveryStatusBadge({ status }: { status: ScheduleDisplayStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SCHEDULE_STATUS_BADGE_CLASSES[status]}`}
    >
      {status}
    </span>
  );
}

interface EditState {
  vehicle_number: string;
  tracking_number: string;
  expected_delivery_date: string;
}

export default function SupplierDeliverySchedulePage() {
  const { supplierName, erpSupplierName, isReady } = useSupplierSession();
  const [editingPO, setEditingPO] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditState>({
    vehicle_number: "",
    tracking_number: "",
    expected_delivery_date: "",
  });
  /** Bumps when shipment hydrate / local edits finish so rows recompute. */
  const [deliveryTick, setDeliveryTick] = useState(0);
  /** poName → submitted GRN count (from ERP). */
  const [grnByPo, setGrnByPo] = useState<Record<string, number>>({});

  // ── 1) Fast path: load this supplier's POs only (never block on hydrate) ──
  const posQuery = useQuery({
    queryKey: ["supplier-delivery-schedule-pos", erpSupplierName],
    enabled: isReady && !!erpSupplierName,
    queryFn: async () => {
      // eslint-disable-next-line no-console
      console.info(LOG, "Fetching purchase orders", {
        erp_supplier_id: erpSupplierName,
        display_name: supplierName,
      });
      const pos = await getSupplierPurchaseOrders(erpSupplierName);
      // eslint-disable-next-line no-console
      console.info(LOG, "Purchase orders response", {
        erp_supplier_id: erpSupplierName,
        count: pos.length,
        names: pos.map((p) => p.name),
        statuses: pos.map((p) => p.status),
        per_received: pos.map((p) => ({
          po: p.name,
          per_received: p.per_received ?? 0,
        })),
      });
      return pos;
    },
  });

  // ── 2) Background: hydrate shipment + GRN facts, sync stale local status ──
  useEffect(() => {
    if (!isReady || !erpSupplierName) return;
    if (!posQuery.isSuccess || !posQuery.data) return;

    let cancelled = false;
    const pos = posQuery.data;
    const poNames = pos.map((p) => p.name);

    void (async () => {
      try {
        // eslint-disable-next-line no-console
        console.info(LOG, "Background resync + hydrate start", {
          erp_supplier_id: erpSupplierName,
          poCount: poNames.length,
        });
        try {
          await resyncLocalDeliveryStatesToErp(erpSupplierName);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(LOG, "resyncLocalDeliveryStatesToErp failed (non-fatal)", err);
        }
        if (cancelled) return;

        try {
          const shipments = await listPoShipmentsForPos(poNames);
          // eslint-disable-next-line no-console
          console.info(LOG, "PO Shipment hydrate response", {
            requested: poNames.length,
            received: shipments.length,
            statuses: shipments.map((s) => ({
              po: s.po_name,
              status: s.shipment_status,
            })),
          });
          for (const ship of shipments) {
            saveDeliveryState(shipmentRecordToDeliveryState(ship));
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(LOG, "listPoShipmentsForPos failed (non-fatal)", err);
        }
        if (cancelled) return;

        // GRN facts — drive Delivered vs In Transit correctly.
        const grnEntries = await Promise.all(
          poNames.map(async (name) => {
            try {
              const grns = await getGRNsForPO(name);
              const submitted = grns.filter((g) => (g.docstatus ?? 0) === 1);
              return [name, submitted.length] as const;
            } catch {
              return [name, 0] as const;
            }
          }),
        );
        if (cancelled) return;
        const nextGrn: Record<string, number> = {};
        for (const [name, count] of grnEntries) nextGrn[name] = count;
        setGrnByPo(nextGrn);

        // Align local cache with PO.per_received / GRN counts.
        for (const po of pos) {
          const submittedCount = nextGrn[po.name] ?? 0;
          syncDeliveryStateFromERPNext(po.name, {
            poSubmitted: (po.docstatus ?? 1) === 1,
            perReceived: Number(po.per_received) || 0,
            perBilled: 0,
            submittedGrnCount: submittedCount,
            hasSubmittedInvoice: false,
          });
        }

        // eslint-disable-next-line no-console
        console.info(LOG, "GRN hydrate complete", {
          grnByPo: nextGrn,
        });
      } finally {
        if (!cancelled) setDeliveryTick((t) => t + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, erpSupplierName, posQuery.isSuccess, posQuery.data]);

  const rows = useMemo<DeliveryRow[]>(() => {
    if (!posQuery.data) return [];

    const scheduled: DeliveryRow[] = [];
    for (const po of posQuery.data) {
      // Skip cancelled / closed POs
      const poStatus = String(po.status || "");
      if (/cancelled|closed/i.test(poStatus)) continue;

      const delivery = readDeliveryState(po.name);
      // Rejected POs are not on the delivery schedule.
      if (delivery?.status === "Rejected") continue;

      const perReceived = Number(po.per_received) || 0;
      const submittedGrnCount = grnByPo[po.name] ?? 0;
      const hasSubmittedGrn = submittedGrnCount > 0;
      const grnCompleted = perReceived >= 100 || /completed/i.test(poStatus);

      const displayStatus = scheduleStatusFromDeliveryState(
        delivery,
        {
          per_received: perReceived,
          status: po.status,
          schedule_date: po.schedule_date,
        },
        { hasSubmittedGrn, grnCompleted },
      );

      // Pending acceptance is not yet on the delivery schedule.
      if (delivery?.status === "Pending Acceptance") continue;

      // Include once supplier accepted, or receipt/dispatch facts exist.
      const onSchedule =
        !!delivery?.supplier_accepted ||
        hasSubmittedGrn ||
        perReceived > 0 ||
        displayStatus !== "Scheduled";
      if (!onSchedule) continue;

      scheduled.push({
        poName: po.name,
        transactionDate: po.transaction_date,
        scheduleDate: po.schedule_date,
        grandTotal: po.grand_total,
        perReceived,
        poStatus: po.status,
        hasSubmittedGrn,
        delivery,
        displayStatus,
      });
    }

    // eslint-disable-next-line no-console
    console.info(LOG, "Mapped delivery rows (derived status)", {
      erp_supplier_id: erpSupplierName,
      poCount: posQuery.data.length,
      scheduledCount: scheduled.length,
      tick: deliveryTick,
      rows: scheduled.map((r) => ({
        po: r.poName,
        cachedShipment: r.delivery?.status ?? null,
        per_received: r.perReceived,
        hasSubmittedGrn: r.hasSubmittedGrn,
        displayStatus: r.displayStatus,
      })),
    });

    return scheduled;
  }, [posQuery.data, erpSupplierName, deliveryTick, grnByPo]);

  const counts = useMemo(() => {
    const c = {
      scheduled: 0,
      ready: 0,
      inTransit: 0,
      arrived: 0,
      delivered: 0,
      delayed: 0,
    };
    for (const r of rows) {
      switch (r.displayStatus) {
        case "Scheduled":
          c.scheduled++;
          break;
        case "Ready for Dispatch":
          c.ready++;
          break;
        case "In Transit":
          c.inTransit++;
          break;
        case "Arrived":
          c.arrived++;
          break;
        case "Delivered":
          c.delivered++;
          break;
        case "Delayed":
          c.delayed++;
          break;
      }
    }
    return c;
  }, [rows]);

  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    totalRecords,
    totalPages,
    pageRows,
  } = useClientPagination(rows, {
    defaultPageSize: 10,
    resetKey: `${erpSupplierName}:${deliveryTick}:${rows.length}`,
  });

  async function handleMarkShipped(poName: string) {
    try {
      await markInTransit(poName, erpSupplierName);
      toast.success(
        `PO ${poName} marked as shipped — warehouse can now create GRN.`,
      );
      setDeliveryTick((t) => t + 1);
      void posQuery.refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to mark as shipped",
      );
    }
  }

  function startEditing(row: DeliveryRow) {
    setEditingPO(row.poName);
    setEditForm({
      vehicle_number: row.delivery?.vehicle_number ?? "",
      tracking_number: row.delivery?.tracking_number ?? "",
      expected_delivery_date:
        row.delivery?.expected_delivery_date ?? row.scheduleDate ?? "",
    });
  }

  function cancelEditing() {
    setEditingPO(null);
  }

  async function saveEditing(poName: string) {
    try {
      await updateDeliveryDetails(poName, editForm, erpSupplierName);
      toast.success(
        "Delivery details updated — warehouse will see the same shipment data.",
      );
      setEditingPO(null);
      setDeliveryTick((t) => t + 1);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update details",
      );
    }
  }

  /* ── Session / gate states ───────────────────────────────────────────── */
  if (!isReady) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }

  if (!erpSupplierName) {
    return (
      <>
        <PageHeader
          title="Delivery Schedule"
          description="Track and manage delivery schedules for accepted purchase orders."
        />
        <EmptyState
          icon={Truck}
          title="Supplier account not linked"
          description="Your portal login is not linked to an ERPNext Supplier record, so delivery schedules cannot be loaded."
        />
      </>
    );
  }

  const showSkeleton = posQuery.isLoading || (posQuery.isFetching && !posQuery.data);
  const showError = posQuery.isError && !posQuery.data;
  const showEmpty = posQuery.isSuccess && rows.length === 0;

  return (
    <>
      <PageHeader
        title="Delivery Schedule"
        description="Track and manage delivery schedules for accepted purchase orders."
      />

      {/* KPI Cards — counts from derived displayStatus only */}
      <DashboardKpiGrid columns={6}>
        <DashboardKpiCard
          label="Scheduled"
          value={counts.scheduled}
          icon={CalendarDays}
          iconClassName="bg-neutral-100 text-neutral-500"
        />
        <DashboardKpiCard
          label="Ready for Dispatch"
          value={counts.ready}
          icon={CalendarDays}
          iconClassName="bg-primary-50 text-primary-500"
        />
        <DashboardKpiCard
          label="In Transit"
          value={counts.inTransit}
          icon={Truck}
          iconClassName="bg-purple-50 text-purple-500"
        />
        <DashboardKpiCard
          label="Arrived"
          value={counts.arrived}
          icon={MapPin}
          iconClassName="bg-orange-50 text-orange-500"
        />
        <DashboardKpiCard
          label="Delivered"
          value={counts.delivered}
          icon={MapPin}
          iconClassName="bg-success-50 text-success-500"
        />
        <DashboardKpiCard
          label="Delayed"
          value={counts.delayed}
          icon={AlertTriangle}
          iconClassName="bg-danger-50 text-danger-500"
        />
      </DashboardKpiGrid>

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

        {showSkeleton ? (
          <TableSkeleton rows={5} columns={6} />
        ) : showError ? (
          <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-danger-500" />
            <p className="text-sm font-semibold text-neutral-900">
              Unable to load delivery schedules
            </p>
            <p className="max-w-md text-xs text-neutral-500">
              {posQuery.error instanceof Error
                ? posQuery.error.message
                : "The purchase-order request failed. Please try again."}
            </p>
            <button
              type="button"
              onClick={() => void posQuery.refetch()}
              className="rounded-md bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-700"
            >
              Retry
            </button>
          </div>
        ) : showEmpty ? (
          <EmptyState
            icon={Truck}
            title="No deliveries scheduled"
            description="Accepted purchase orders and their delivery schedules will appear here once a PO is accepted."
          />
        ) : (
          <>
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
                  {pageRows.map((row) => {
                    const isEditing = editingPO === row.poName;
                    const status = row.displayStatus;
                    const expectedDate =
                      row.delivery?.expected_delivery_date || row.scheduleDate;

                    return (
                      <tr key={row.poName} className="hover:bg-accent-50/40">
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
                          ) : expectedDate ? (
                            formatUkDisplayDate(expectedDate)
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
                            row.delivery?.vehicle_number || "—"
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
                            row.delivery?.tracking_number || "—"
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
                                {status === "Ready for Dispatch" && (
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
                                {(status === "Ready for Dispatch" ||
                                  status === "In Transit" ||
                                  status === "Delayed") && (
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
            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              totalRecords={totalRecords}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              recordLabel="records"
            />
          </>
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
                .filter((r) => r.delivery?.updated_at || r.displayStatus)
                .sort((a, b) => {
                  const at = a.delivery?.updated_at
                    ? new Date(a.delivery.updated_at).getTime()
                    : 0;
                  const bt = b.delivery?.updated_at
                    ? new Date(b.delivery.updated_at).getTime()
                    : 0;
                  return bt - at;
                })
                .slice(0, 10)
                .map((row) => (
                  <TimelineItem key={row.poName} row={row} />
                ))}
            </ol>
          </div>
        </section>
      )}
    </>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function TimelineItem({ row }: { row: DeliveryRow }) {
  const status = row.displayStatus;
  const expectedDate =
    row.delivery?.expected_delivery_date || row.scheduleDate;

  return (
    <li className="mb-6 ml-6">
      <span
        className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ring-4 ring-white ${SCHEDULE_STATUS_DOT_CLASSES[status]}`}
      />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          to={`/supplier/po/${encodeURIComponent(row.poName)}`}
          className="text-sm font-semibold text-primary-700 hover:underline"
        >
          {row.poName}
        </Link>
        <DeliveryStatusBadge status={status} />
        {row.delivery?.updated_at && (
          <time className="text-xs text-neutral-400">
            {formatDate(row.delivery.updated_at)}
          </time>
        )}
      </div>
      {expectedDate && (
        <p className="mt-1 text-xs text-neutral-500">
          Expected delivery: {formatUkDisplayDate(expectedDate)}
        </p>
      )}
      {row.delivery?.vehicle_number && (
        <p className="text-xs text-neutral-500">
          Vehicle: {row.delivery.vehicle_number}
          {row.delivery.tracking_number &&
            ` · Tracking: ${row.delivery.tracking_number}`}
        </p>
      )}
    </li>
  );
}
