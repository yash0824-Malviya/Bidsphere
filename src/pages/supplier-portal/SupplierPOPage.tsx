/**
 * Supplier Purchase Order Detail — read-only view for suppliers.
 *
 * Accessible at /supplier/po/:poName. Mirrors the buyer-side
 * PurchaseOrderDetailPage layout but strips every write action
 * (Submit, Create GRN, Create Invoice, edit controls).
 *
 * Access control: if the PO's `supplier` field does not match
 * the logged-in supplier's session name the page shows an
 * "Access denied" error rather than the PO data.
 *
 * Includes PO acceptance/rejection workflow and delivery tracking.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Circle,
  FileText,
  PackagePlus,
  ShoppingCart,
  Truck,
  XCircle,
} from "lucide-react";

import { getInvoicesForPO } from "../../api/accounts";
import { getSupplierPaymentSummaries } from "../../api/supplierPortal";
import {
  getGRNsForPO,
  getPurchaseOrder,
} from "../../api/purchasing";
import { getSupplierQuotation, getSupplierQuotationsBySupplier } from "../../api/sourcing";
import {
  type PODeliveryState,
  type AcceptPOPayload,
  type RejectPOPayload,
  ensureDeliveryState,
  acceptPO,
  rejectPO,
  markInTransit,
} from "../../api/poDeliveryWorkflow";
import ProcurementTimeline from "../../components/supplier-portal/ProcurementTimeline";
import EmptyState from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import CalendarDatePicker from "../../components/ui/CalendarDatePicker";
import { formatUkDisplayDate } from "../../utils/erpNextDate";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPercent,
} from "../../utils/format";
import SupplierPortalLayout from "./SupplierPortalLayout";

interface SupplierSession {
  supplierName: string;
  loggedIn: boolean;
}

export default function SupplierPOPage() {
  const { poName = "" } = useParams<{ poName: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const name = decodeURIComponent(poName);

  /* ── Session gate ─────────────────────────────────────────────────────── */
  const [supplierName, setSupplierName] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("supplier_session");
    if (!raw) {
      navigate("/supplier/login", { replace: true });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SupplierSession;
      if (!parsed.loggedIn || !parsed.supplierName) {
        navigate("/supplier/login", { replace: true });
        return;
      }
      setSupplierName(parsed.supplierName);
    } catch {
      navigate("/supplier/login", { replace: true });
    }
  }, [navigate]);

  /* ── Modal state ──────────────────────────────────────────────────────── */
  const [acceptModalOpen, setAcceptModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);

  /* ── Accept form state ────────────────────────────────────────────────── */
  const [acceptForm, setAcceptForm] = useState<AcceptPOPayload>({
    expected_delivery_date: "",
    vehicle_number: "",
    tracking_number: "",
    shipping_notes: "",
  });
  const [acceptSubmitting, setAcceptSubmitting] = useState(false);

  /* ── Reject form state ────────────────────────────────────────────────── */
  const [rejectForm, setRejectForm] = useState<RejectPOPayload>({
    rejection_reason: "",
  });
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  /* ── Delivery state ───────────────────────────────────────────────────── */
  const [deliveryState, setDeliveryState] = useState<PODeliveryState | null>(
    null
  );

  /* ── Data fetch ───────────────────────────────────────────────────────── */
  const {
    data: po,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["supplier-portal-po", name],
    queryFn: () => getPurchaseOrder(name),
    enabled: !!name && !!supplierName,
  });

  // Initialise / refresh delivery state whenever PO loads
  useEffect(() => {
    if (po?.name) {
      const state = ensureDeliveryState(po.name, supplierName ?? undefined);
      setDeliveryState(state);
    }
  }, [po?.name, supplierName]);

  const rfqRef = po?.rfq_name ?? po?.rfq;

  const sqListQuery = useQuery({
    queryKey: ["supplier-portal-po-sqs", supplierName],
    queryFn: () => getSupplierQuotationsBySupplier(supplierName!),
    enabled: !!supplierName && !!po,
  });

  const sqDetailsQuery = useQuery({
    queryKey: [
      "supplier-portal-po-sq-details",
      (sqListQuery.data ?? []).map((s) => s.name).join("|"),
    ],
    queryFn: async () => {
      const submitted = (sqListQuery.data ?? []).filter(
        (s) => s.status === "Submitted"
      );
      const results = await Promise.allSettled(
        submitted.map((sq) => getSupplierQuotation(sq.name))
      );
      return results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
    },
    enabled: (sqListQuery.data ?? []).some((s) => s.status === "Submitted"),
  });

  const grnsQuery = useQuery({
    queryKey: ["supplier-portal-po-grns", name],
    queryFn: () => getGRNsForPO(name),
    enabled: !!name && !!po,
  });

  const invoicesQuery = useQuery({
    queryKey: ["supplier-portal-po-invoices", name],
    queryFn: () => getInvoicesForPO(name),
    enabled: !!name && !!po,
  });

  const paymentsQuery = useQuery({
    queryKey: ["supplier-portal-po-payments", supplierName],
    queryFn: () => getSupplierPaymentSummaries(supplierName!),
    enabled: !!supplierName && !!po,
  });

  const lifecycleSteps = useMemo(() => {
    if (!po) return [];

    const rfqDone = !!rfqRef;
    const sqDone = (sqDetailsQuery.data ?? []).some((sq) =>
      (sq.items ?? []).some(
        (it) =>
          (it as { request_for_quotation?: string }).request_for_quotation ===
          rfqRef
      )
    );
    const poDone = (po.docstatus ?? 0) >= 1;
    const grns = grnsQuery.data ?? [];
    const grnDone = grns.length > 0;
    const invoices = (invoicesQuery.data ?? []).filter(
      (i) => (i.docstatus ?? 0) >= 1
    );
    const invoiceDone = invoices.length > 0;
    const invoiceNames = new Set(invoices.map((i) => i.name));
    const paymentDone = (paymentsQuery.data ?? []).some((p) =>
      invoiceNames.has(p.invoiceReference ?? "")
    );

    return [
      { label: "RFQ Created", done: rfqDone, sublabel: rfqRef },
      {
        label: "Quotation Submitted",
        done: sqDone,
      },
      {
        label: "Purchase Order Issued",
        done: poDone,
        sublabel: po.name,
      },
      {
        label: "Goods Received",
        done: grnDone,
        sublabel: grnDone ? `${grns.length} GRN(s)` : undefined,
      },
      {
        label: "Invoice Submitted",
        done: invoiceDone,
        sublabel: invoiceDone ? invoices[0]?.name : undefined,
      },
      {
        label: "Payment Released",
        done: paymentDone,
      },
    ];
  }, [
    po,
    rfqRef,
    sqDetailsQuery.data,
    grnsQuery.data,
    invoicesQuery.data,
    paymentsQuery.data,
  ]);

  /* ── Workflow handlers ────────────────────────────────────────────────── */

  function handleAcceptPO() {
    if (!acceptForm.expected_delivery_date.trim()) {
      toast.error("Expected Delivery Date is required.");
      return;
    }
    setAcceptSubmitting(true);
    try {
      const updated = acceptPO(name, acceptForm, supplierName ?? undefined);
      setDeliveryState(updated);
      toast.success("Purchase Order accepted successfully.");
      setAcceptModalOpen(false);
      setAcceptForm({
        expected_delivery_date: "",
        vehicle_number: "",
        tracking_number: "",
        shipping_notes: "",
      });
      queryClient.invalidateQueries({ queryKey: ["supplier-portal-po", name] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to accept PO.");
    } finally {
      setAcceptSubmitting(false);
    }
  }

  function handleRejectPO() {
    if (!rejectForm.rejection_reason.trim()) {
      toast.error("Rejection reason is required.");
      return;
    }
    setRejectSubmitting(true);
    try {
      const updated = rejectPO(name, rejectForm, supplierName ?? undefined);
      setDeliveryState(updated);
      toast.success("Purchase Order rejected.");
      setRejectModalOpen(false);
      setRejectForm({ rejection_reason: "" });
      queryClient.invalidateQueries({ queryKey: ["supplier-portal-po", name] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to reject PO.");
    } finally {
      setRejectSubmitting(false);
    }
  }

  function handleMarkAsShipped() {
    try {
      const updated = markInTransit(name, supplierName ?? undefined);
      setDeliveryState(updated);
      toast.success("Purchase Order marked as shipped.");
      queryClient.invalidateQueries({ queryKey: ["supplier-portal-po", name] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to mark as shipped.");
    }
  }

  /* ── Loading skeleton ─────────────────────────────────────────────────── */
  if (!supplierName || isLoading) {
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

  /* ── Error / not found ────────────────────────────────────────────────── */
  if (isError || !po) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackLink />
        <EmptyState
          icon={FileText}
          title="Purchase order not found"
          description={`"${name}" may have been deleted or you may not have access.`}
        />
      </SupplierPortalLayout>
    );
  }

  /* ── Access control ───────────────────────────────────────────────────── */
  const poSupplier = po.supplier ?? "";
  const poSupplierName = po.supplier_name ?? po.supplier ?? "";
  const isOwner =
    poSupplier === supplierName || poSupplierName === supplierName;

  if (!isOwner) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackLink />
        <EmptyState
          icon={ShoppingCart}
          title="Access denied"
          description="This purchase order does not belong to your supplier account."
        />
      </SupplierPortalLayout>
    );
  }

  /* ── Derived state ────────────────────────────────────────────────────── */
  const isSubmitted = (po.docstatus ?? 0) >= 1;
  const receivedPct = po.per_received ?? 0;
  const billedPct = po.per_billed ?? 0;

  const receivingLabel =
    receivedPct >= 100
      ? "Fully Received"
      : receivedPct > 0
      ? "Partially Received"
      : isSubmitted
      ? "To Receive"
      : "Draft";

  const deliveryStatus = deliveryState?.status ?? "Pending Acceptance";
  const isPendingAcceptance = deliveryStatus === "Pending Acceptance";
  const isAccepted = deliveryStatus === "Accepted";
  const isRejected = deliveryStatus === "Rejected";
  const isInTransit = deliveryStatus === "In Transit";
  const showDeliveryInfo =
    isAccepted || isInTransit || deliveryStatus === "Partially Received" || deliveryStatus === "Completed";

  /* ── Enhanced timeline ────────────────────────────────────────────────── */
  const timeline = [
    { label: "PO Created", ts: po.creation, icon: Circle, done: true },
    ...(isRejected
      ? [
          {
            label: "Supplier Rejected",
            ts: deliveryState?.rejected_date ?? null,
            icon: XCircle,
            done: true,
          },
        ]
      : [
          {
            label: "Supplier Accepted",
            ts: deliveryState?.supplier_acceptance_date ?? null,
            icon: CheckCircle2,
            done: deliveryState?.supplier_accepted ?? false,
          },
        ]),
    ...(isInTransit || deliveryStatus === "Partially Received" || deliveryStatus === "Completed"
      ? [
          {
            label: "Shipment Scheduled",
            ts: deliveryState?.updated_at ?? null,
            icon: Truck,
            done: true,
          },
        ]
      : isAccepted
      ? [
          {
            label: "Shipment Scheduled",
            ts: null as string | null,
            icon: Truck,
            done: false,
          },
        ]
      : []),
    {
      label: `Goods Received — ${receivingLabel}`,
      ts: receivedPct > 0 ? po.modified : null,
      icon: PackagePlus,
      done: receivedPct > 0,
    },
    {
      label: "Invoice / Payment",
      ts: billedPct > 0 ? po.modified : null,
      icon: FileText,
      done: billedPct > 0,
    },
  ];

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <BackLink />

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{po.name}</h1>
          <p className="text-sm text-neutral-500">
            {po.supplier_name ?? po.supplier}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={deliveryStatus} />
          <StatusBadge status={po.status ?? "Submitted"} />
        </div>
      </div>

      {/* ── PO Acceptance / Rejection action buttons ────────────────────── */}
      {isPendingAcceptance && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="mb-3 text-sm font-medium text-amber-800">
            This Purchase Order is awaiting your acceptance. Please review the
            details below and accept or reject.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setAcceptModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-700 transition-colors"
            >
              <CheckCircle2 className="h-4 w-4" />
              Accept PO
            </button>
            <button
              onClick={() => setRejectModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-50 transition-colors"
            >
              <XCircle className="h-4 w-4" />
              Reject PO
            </button>
          </div>
        </div>
      )}

      {/* ── Rejected banner ─────────────────────────────────────────────── */}
      {isRejected && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <p className="text-sm font-medium text-red-800">
            You rejected this Purchase Order
            {deliveryState?.rejected_date &&
              ` on ${formatDateTime(deliveryState.rejected_date)}`}
            .
          </p>
          {deliveryState?.rejection_reason && (
            <p className="mt-1 text-sm text-red-700">
              <span className="font-medium">Reason:</span>{" "}
              {deliveryState.rejection_reason}
            </p>
          )}
        </div>
      )}

      {/* ── Mark as Shipped button ──────────────────────────────────────── */}
      {isAccepted && (
        <div className="mb-4 flex">
          <button
            onClick={handleMarkAsShipped}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 transition-colors"
          >
            <Truck className="h-4 w-4" />
            Mark as Shipped
          </button>
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <InfoCard label="Order Date" value={formatDate(po.transaction_date)} />
        <InfoCard
          label="Required By"
          value={po.schedule_date ? formatDate(po.schedule_date) : "—"}
        />
        <InfoCard label="Company" value={po.company ?? "—"} />
        <InfoCard label="Currency" value={po.currency ?? "—"} />
      </div>

      {/* Progress bars */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ProgressCard
          label={`Goods Received — ${receivingLabel}`}
          value={receivedPct}
          tone="accent"
        />
        <ProgressCard label="Billed" value={billedPct} tone="primary" />
      </div>

      {/* ── Supplier Delivery Information ───────────────────────────────── */}
      {showDeliveryInfo && deliveryState && (
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary-600" />
            <h3 className="text-sm font-semibold text-neutral-900">
              Supplier Delivery Information
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-neutral-500">
                <CalendarDays className="h-3.5 w-3.5" />
                Acceptance Date
              </p>
              <p className="mt-1 text-sm font-medium text-neutral-900">
                {deliveryState.supplier_acceptance_date
                  ? formatDateTime(deliveryState.supplier_acceptance_date)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-neutral-500">
                <CalendarDays className="h-3.5 w-3.5" />
                Expected Delivery Date
              </p>
              <p className="mt-1 text-sm font-medium text-neutral-900">
                {deliveryState.expected_delivery_date
                  ? formatUkDisplayDate(deliveryState.expected_delivery_date)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Vehicle Number
              </p>
              <p className="mt-1 text-sm font-medium text-neutral-900">
                {deliveryState.vehicle_number || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Tracking Number
              </p>
              <p className="mt-1 text-sm font-medium text-neutral-900">
                {deliveryState.tracking_number || "—"}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Shipping Notes
              </p>
              <p className="mt-1 text-sm text-neutral-900">
                {deliveryState.shipping_notes || "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Items table — read-only */}
      <div className="mt-6 card">
        <div className="border-b border-neutral-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Order Items
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Rate</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2 text-right">Received</th>
                <th className="px-4 py-2 text-right">Billed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {(po.items ?? []).map((item, idx) => (
                <tr key={item.name ?? idx}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-neutral-900">
                      {item.item_code}
                    </div>
                    {item.item_name && item.item_name !== item.item_code && (
                      <div className="text-xs text-neutral-500">
                        {item.item_name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {item.qty}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatCurrency(item.rate)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {formatCurrency(item.amount)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                    {item.received_qty ?? 0}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                    {formatCurrency(item.billed_amt ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-neutral-50">
                <td
                  colSpan={3}
                  className="px-4 py-3 text-right text-sm font-medium"
                >
                  Grand Total
                </td>
                <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                  {formatCurrency(po.grand_total)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Procurement lifecycle */}
      <div className="mt-6">
        <ProcurementTimeline steps={lifecycleSteps} />
      </div>

      {/* Activity timeline */}
      <div className="mt-6 card p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-neutral-900">
          Order Timeline
        </h3>
        <ol className="relative ml-3 border-l border-neutral-200">
          {timeline.map((step, idx) => {
            const Icon = step.icon;
            return (
              <li key={idx} className="mb-5 ml-4 last:mb-0">
                <span
                  className={`absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white ${
                    step.done
                      ? step.icon === XCircle
                        ? "bg-red-500 text-white"
                        : "bg-accent text-white"
                      : "bg-neutral-200 text-neutral-400"
                  }`}
                >
                  <Icon className="h-2.5 w-2.5" />
                </span>
                <div className="flex items-baseline justify-between gap-3">
                  <p
                    className={`text-sm font-medium ${
                      step.done
                        ? step.icon === XCircle
                          ? "text-red-700"
                          : "text-neutral-900"
                        : "text-neutral-400"
                    }`}
                  >
                    {step.label}
                  </p>
                  {step.ts && (
                    <span className="text-xs text-neutral-500">
                      {formatDateTime(step.ts)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Read-only notice */}
      <p className="mt-4 text-center text-xs text-neutral-400">
        This is a read-only view. Contact Netlink procurement for any queries
        about this order.
      </p>

      {/* ── Accept PO Modal ─────────────────────────────────────────────── */}
      {acceptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-neutral-950/50"
            onClick={() => setAcceptModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-1 text-lg font-bold text-neutral-900">
              Accept Purchase Order
            </h2>
            <p className="mb-5 text-sm text-neutral-500">
              Confirm acceptance and provide delivery details for{" "}
              <span className="font-medium text-neutral-700">{po.name}</span>.
            </p>

            <div className="space-y-4">
              {/* Expected Delivery Date */}
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">
                  Expected Delivery Date{" "}
                  <span className="text-red-500">*</span>
                </label>
                <CalendarDatePicker
                  value={acceptForm.expected_delivery_date}
                  onChange={(iso) =>
                    setAcceptForm((f) => ({
                      ...f,
                      expected_delivery_date: iso,
                    }))
                  }
                  required
                  placeholder="DD/MM/YYYY"
                />
              </div>

              {/* Vehicle Number */}
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">
                  Vehicle Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. TN-01-AB-1234"
                  value={acceptForm.vehicle_number}
                  onChange={(e) =>
                    setAcceptForm((f) => ({
                      ...f,
                      vehicle_number: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              {/* Tracking Number */}
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">
                  Tracking Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. TRACK-20250622-001"
                  value={acceptForm.tracking_number}
                  onChange={(e) =>
                    setAcceptForm((f) => ({
                      ...f,
                      tracking_number: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              {/* Shipping Notes */}
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">
                  Shipping Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Any additional shipping or delivery notes..."
                  value={acceptForm.shipping_notes}
                  onChange={(e) =>
                    setAcceptForm((f) => ({
                      ...f,
                      shipping_notes: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setAcceptModalOpen(false)}
                disabled={acceptSubmitting}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAcceptPO}
                disabled={acceptSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-700 disabled:opacity-50 transition-colors"
              >
                {acceptSubmitting ? "Accepting…" : "Accept PO"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject PO Modal ─────────────────────────────────────────────── */}
      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-neutral-950/50"
            onClick={() => setRejectModalOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-1 text-lg font-bold text-neutral-900">
              Reject Purchase Order
            </h2>
            <p className="mb-5 text-sm text-neutral-500">
              Provide a reason for rejecting{" "}
              <span className="font-medium text-neutral-700">{po.name}</span>.
              This action cannot be undone.
            </p>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                Rejection Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={4}
                placeholder="Please explain why you are rejecting this purchase order..."
                value={rejectForm.rejection_reason}
                onChange={(e) =>
                  setRejectForm({ rejection_reason: e.target.value })
                }
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setRejectModalOpen(false)}
                disabled={rejectSubmitting}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectPO}
                disabled={rejectSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {rejectSubmitting ? "Rejecting…" : "Reject PO"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SupplierPortalLayout>
  );
}

/* ── helper components ───────────────────────────────────────────────────── */

function BackLink() {
  return (
    <Link
      to="/supplier/purchase-orders"
      className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Purchase Orders
    </Link>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium text-neutral-900">
        {value}
      </p>
    </div>
  );
}

function ProgressCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "primary" | "accent";
}) {
  const pct = Math.max(0, Math.min(100, value));
  const color = tone === "accent" ? "bg-accent-500" : "bg-primary-500";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-700">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-neutral-900">
          {formatPercent(pct)}
        </p>
      </div>
      <div className="mt-3 h-2 w-full rounded-full bg-neutral-100">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
