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
  Banknote,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  Package,
  PackagePlus,
  Receipt,
  ShoppingCart,
  Truck,
  X,
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
} from "../../utils/format";
import SupplierPortalLayout from "./SupplierPortalLayout";
import type { PurchaseOrder } from "../../types/erpnext";
import type { PaymentSummary } from "../../api/supplierPortal";
import type { TimelineStep } from "../../components/supplier-portal/ProcurementTimeline";

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
  const [acceptModalStep, setAcceptModalStep] = useState(1);

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
  void rfqRef;

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
  void sqDetailsQuery;

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

  const workflowContext = useMemo(() => {
    if (!po) return null;
    return deriveSupplierPOWorkflow({
      po,
      deliveryState,
      grns: grnsQuery.data ?? [],
      invoices: invoicesQuery.data ?? [],
      payments: paymentsQuery.data ?? [],
    });
  }, [
    po,
    deliveryState,
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
      setAcceptModalStep(1);
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
  const wf = workflowContext!;
  const receivedPct = wf.displayReceivedPct;
  const billedPct = wf.displayBilledPct;
  const isPendingAcceptance = wf.isPendingAcceptance;
  const isAccepted = wf.isAccepted;
  const isRejected = wf.isRejected;
  const supplierAccepted = wf.supplierAccepted;
  const showDeliveryInfo = wf.showDeliveryInfo;
  const displayStatus = wf.displayStatus;
  const poWorkflowSteps = wf.steps;

  const itemCount = (po.items ?? []).length;

  function closeAcceptModal() {
    setAcceptModalOpen(false);
    setAcceptModalStep(1);
  }

  function getItemReceiveStatus(qty: number, received: number) {
    if (!supplierAccepted) return { label: "Pending", tone: "neutral" as const };
    if (received >= qty && qty > 0) return { label: "Received", tone: "success" as const };
    if (received > 0) return { label: "Partial", tone: "warning" as const };
    return { label: "Pending", tone: "neutral" as const };
  }

  function getItemBillStatus(billed: number) {
    if (!supplierAccepted || !wf.grnDone) return { label: "Unbilled", tone: "neutral" as const };
    if (billed > 0) return { label: "Billed", tone: "info" as const };
    return { label: "Unbilled", tone: "neutral" as const };
  }

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <BackLink />

      {/* PO summary header */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">
              Purchase Order
            </p>
            <h1 className="mt-0.5 text-lg font-bold text-neutral-900 sm:text-xl">{po.name}</h1>
            <p className="mt-0.5 text-xs font-medium text-neutral-500">
              {po.supplier_name ?? po.supplier}
            </p>
          </div>
          <StatusBadge status={displayStatus} />
        </div>
      </div>

      {/* Compact acceptance banner */}
      {isPendingAcceptance && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-amber-50/40 px-3.5 py-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium text-amber-900 sm:text-sm">
            Action required — review and accept or reject this purchase order.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => {
                setAcceptModalStep(1);
                setAcceptModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-accent-700 sm:px-4 sm:py-2 sm:text-sm"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Accept PO
            </button>
            <button
              onClick={() => setRejectModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm transition hover:bg-red-50 sm:px-4 sm:py-2 sm:text-sm"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm shadow-sm">
          <p className="font-medium text-red-800">
            Rejected
            {deliveryState?.rejected_date &&
              ` · ${formatDateTime(deliveryState.rejected_date)}`}
          </p>
          {deliveryState?.rejection_reason && (
            <p className="mt-0.5 text-xs text-red-700">{deliveryState.rejection_reason}</p>
          )}
        </div>
      )}

      {isAccepted && (
        <div className="mt-3">
          <button
            onClick={handleMarkAsShipped}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 hover:shadow-md"
          >
            <Truck className="h-4 w-4" />
            Mark as Shipped
          </button>
        </div>
      )}

      {/* Procurement workflow timeline */}
      <div className="mt-3">
        <ProcurementTimeline steps={poWorkflowSteps} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="space-y-3">
          {/* Information grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <InfoCard
              icon={ShoppingCart}
              label="Supplier"
              value={po.supplier_name ?? po.supplier ?? "—"}
            />
            <InfoCard icon={Building2} label="Company" value={po.company ?? "—"} />
            <InfoCard
              icon={CalendarDays}
              label="Order Date"
              value={formatDate(po.transaction_date)}
            />
            <InfoCard
              icon={CalendarDays}
              label="Required By"
              value={po.schedule_date ? formatDate(po.schedule_date) : "—"}
            />
            <InfoCard icon={Banknote} label="Currency" value={po.currency ?? "—"} />
            <InfoCard
              icon={Receipt}
              label="PO Value"
              value={formatCurrency(po.grand_total ?? 0)}
              highlight
            />
          </div>

          {/* Delivery information */}
          {showDeliveryInfo && deliveryState && (
            <section className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-3 flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary-600" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Supplier Delivery Information
                </h3>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                <MetaField
                  label="Acceptance Date"
                  value={
                    deliveryState.supplier_acceptance_date
                      ? formatDateTime(deliveryState.supplier_acceptance_date)
                      : "—"
                  }
                />
                <MetaField
                  label="Expected Delivery"
                  value={
                    deliveryState.expected_delivery_date
                      ? formatUkDisplayDate(deliveryState.expected_delivery_date)
                      : "—"
                  }
                />
                <MetaField label="Vehicle Number" value={deliveryState.vehicle_number || "—"} />
                <MetaField label="Tracking Number" value={deliveryState.tracking_number || "—"} />
                <MetaField
                  label="Shipping Notes"
                  value={deliveryState.shipping_notes || "—"}
                  className="sm:col-span-2 lg:col-span-3"
                />
              </div>
            </section>
          )}

          {/* Order items */}
          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center justify-between border-b border-neutral-100 px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <PackagePlus className="h-4 w-4 text-primary-600" />
                <h3 className="text-sm font-semibold text-neutral-900">Order Items</h3>
              </div>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                {itemCount} items
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    <th className="px-3.5 py-2.5">Item</th>
                    <th className="px-3 py-2.5 text-right">Qty</th>
                    <th className="px-3 py-2.5 text-right">Rate</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5 text-right">Received</th>
                    <th className="px-3.5 py-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(po.items ?? []).map((item, idx) => {
                    const received = item.received_qty ?? 0;
                    const receiveStatus = getItemReceiveStatus(item.qty, received);
                    const billStatus = getItemBillStatus(item.billed_amt ?? 0);
                    return (
                      <tr
                        key={item.name ?? idx}
                        className="transition-colors hover:bg-neutral-50/60"
                      >
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-primary-100">
                              <Package className="h-4 w-4 text-primary-600" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold text-neutral-900">{item.item_code}</p>
                              {item.item_name && item.item_name !== item.item_code && (
                                <p className="text-xs text-neutral-500">{item.item_name}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                          {item.qty}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                          {formatCurrency(item.rate)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                          {formatCurrency(item.amount)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                          {supplierAccepted ? received : "—"}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <div className="flex flex-wrap justify-end gap-1">
                            <ItemStatusBadge label={receiveStatus.label} tone={receiveStatus.tone} />
                            <ItemStatusBadge label={billStatus.label} tone={billStatus.tone} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-neutral-200 bg-neutral-50/80">
                    <td colSpan={3} className="px-3.5 py-3 text-right text-sm font-semibold text-neutral-700">
                      Grand Total
                    </td>
                    <td className="px-3 py-3 text-right text-base font-bold tabular-nums text-primary-600">
                      {formatCurrency(po.grand_total ?? 0)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <p className="pb-2 text-center text-xs text-neutral-400">
            Read-only view — contact Netlink procurement for order queries.
          </p>
        </div>

        {/* Sticky PO summary — desktop */}
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          <POSummaryPanel
            poName={po.name}
            grandTotal={po.grand_total ?? 0}
            itemCount={itemCount}
            receivedPct={receivedPct}
            billedPct={billedPct}
            status={displayStatus}
            expectedDelivery={deliveryState?.expected_delivery_date}
          />
        </aside>
      </div>

      {/* Mobile summary */}
      <div className="sticky top-16 z-10 mt-3 lg:hidden">
        <POSummaryPanel
          poName={po.name}
          grandTotal={po.grand_total ?? 0}
          itemCount={itemCount}
          receivedPct={receivedPct}
          billedPct={billedPct}
          status={displayStatus}
          expectedDelivery={deliveryState?.expected_delivery_date}
        />
      </div>

      {/* Accept PO Modal — step-based */}
      {acceptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-neutral-950/50 backdrop-blur-sm" onClick={closeAcceptModal} />
          <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-neutral-200">
            <div className="border-b border-neutral-100 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">Accept Purchase Order</h2>
                  <p className="mt-0.5 text-xs text-neutral-500">{po.name}</p>
                </div>
                <button
                  type="button"
                  onClick={closeAcceptModal}
                  className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 flex items-center gap-2">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex flex-1 items-center gap-2">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
                        acceptModalStep >= step
                          ? "bg-primary-600 text-white"
                          : "bg-neutral-100 text-neutral-400"
                      }`}
                    >
                      {step}
                    </div>
                    {step < 3 && (
                      <div
                        className={`h-0.5 flex-1 rounded ${
                          acceptModalStep > step ? "bg-primary-500" : "bg-neutral-200"
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-medium text-neutral-500">
                {acceptModalStep === 1 && "Step 1 — Expected delivery date"}
                {acceptModalStep === 2 && "Step 2 — Shipping details"}
                {acceptModalStep === 3 && "Step 3 — Review & confirm"}
              </p>
            </div>

            <div className="px-5 py-4">
              {acceptModalStep === 1 && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-neutral-700">
                    Expected Delivery Date <span className="text-red-500">*</span>
                  </label>
                  <CalendarDatePicker
                    value={acceptForm.expected_delivery_date}
                    onChange={(iso) =>
                      setAcceptForm((f) => ({ ...f, expected_delivery_date: iso }))
                    }
                    required
                    placeholder="DD/MM/YYYY"
                  />
                  <p className="mt-2 text-xs text-neutral-500">
                    Select the date you expect to deliver goods to the buyer.
                  </p>
                </div>
              )}

              {acceptModalStep === 2 && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-700">
                      Vehicle Number
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. TN-01-AB-1234"
                      value={acceptForm.vehicle_number}
                      onChange={(e) =>
                        setAcceptForm((f) => ({ ...f, vehicle_number: e.target.value }))
                      }
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-700">
                      Tracking Number
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. TRACK-20250622-001"
                      value={acceptForm.tracking_number}
                      onChange={(e) =>
                        setAcceptForm((f) => ({ ...f, tracking_number: e.target.value }))
                      }
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-700">
                      Shipping Notes
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Additional shipping or delivery notes…"
                      value={acceptForm.shipping_notes}
                      onChange={(e) =>
                        setAcceptForm((f) => ({ ...f, shipping_notes: e.target.value }))
                      }
                      className="input-field min-h-[72px] resize-y"
                    />
                  </div>
                </div>
              )}

              {acceptModalStep === 3 && (
                <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/80 p-3 text-sm">
                  <ReviewRow
                    label="Expected Delivery"
                    value={
                      acceptForm.expected_delivery_date
                        ? formatUkDisplayDate(acceptForm.expected_delivery_date)
                        : "—"
                    }
                  />
                  <ReviewRow label="Vehicle" value={acceptForm.vehicle_number || "—"} />
                  <ReviewRow label="Tracking" value={acceptForm.tracking_number || "—"} />
                  <ReviewRow label="Notes" value={acceptForm.shipping_notes || "—"} />
                </div>
              )}
            </div>

            <div className="flex justify-between gap-3 border-t border-neutral-100 px-5 py-4">
              <button
                type="button"
                onClick={() =>
                  acceptModalStep === 1 ? closeAcceptModal() : setAcceptModalStep((s) => s - 1)
                }
                disabled={acceptSubmitting}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
              >
                {acceptModalStep === 1 ? "Cancel" : "Back"}
              </button>
              {acceptModalStep < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (acceptModalStep === 1 && !acceptForm.expected_delivery_date.trim()) {
                      toast.error("Expected Delivery Date is required.");
                      return;
                    }
                    setAcceptModalStep((s) => s + 1);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700"
                >
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleAcceptPO}
                  disabled={acceptSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-700 disabled:opacity-50"
                >
                  {acceptSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Accepting…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Confirm Acceptance
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject PO Modal */}
      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-neutral-950/50 backdrop-blur-sm"
            onClick={() => setRejectModalOpen(false)}
          />
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-neutral-200">
            <div className="border-b border-neutral-100 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">Reject Purchase Order</h2>
                  <p className="mt-0.5 text-xs text-neutral-500">{po.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRejectModalOpen(false)}
                  className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="px-5 py-4">
              <label className="mb-1.5 block text-sm font-medium text-neutral-700">
                Rejection Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={4}
                placeholder="Explain why you are rejecting this purchase order…"
                value={rejectForm.rejection_reason}
                onChange={(e) => setRejectForm({ rejection_reason: e.target.value })}
                className="input-field min-h-[96px] resize-y"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-neutral-100 px-5 py-4">
              <button
                onClick={() => setRejectModalOpen(false)}
                disabled={rejectSubmitting}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectPO}
                disabled={rejectSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
              >
                {rejectSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Rejecting…
                  </>
                ) : (
                  "Reject PO"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </SupplierPortalLayout>
  );
}

/* ── Workflow derivation (UI-only gating) ─────────────────────────────────── */

const PENDING_SUPPLIER_ACCEPTANCE = "Pending Supplier Acceptance";

interface SupplierPOWorkflowContext {
  rawStatus: PODeliveryState["status"];
  displayStatus: string;
  isPendingAcceptance: boolean;
  isAccepted: boolean;
  isRejected: boolean;
  isInTransit: boolean;
  supplierAccepted: boolean;
  grnDone: boolean;
  invoiceDone: boolean;
  paymentDone: boolean;
  showDeliveryInfo: boolean;
  displayReceivedPct: number;
  displayBilledPct: number;
  steps: TimelineStep[];
}

function deriveSupplierPOWorkflow({
  po,
  deliveryState,
  grns,
  invoices,
  payments,
}: {
  po: PurchaseOrder;
  deliveryState: PODeliveryState | null;
  grns: Array<{ name?: string }>;
  invoices: Array<{ name: string; docstatus?: number }>;
  payments: PaymentSummary[];
}): SupplierPOWorkflowContext {
  const rawStatus = deliveryState?.status ?? "Pending Acceptance";
  const isPendingAcceptance = rawStatus === "Pending Acceptance";
  const isRejected = rawStatus === "Rejected";
  const isAccepted = rawStatus === "Accepted";
  const isInTransit = rawStatus === "In Transit";

  const supplierAccepted =
    !isPendingAcceptance &&
    !isRejected &&
    (deliveryState?.supplier_accepted === true ||
      ["Accepted", "In Transit", "Partially Received", "Completed"].includes(rawStatus));

  const poCreated = (po.docstatus ?? 0) >= 1;

  const hasGrnDocuments = grns.length > 0 || (po.per_received ?? 0) > 0;
  const grnDone = supplierAccepted && hasGrnDocuments;

  const submittedInvoices = invoices.filter((i) => (i.docstatus ?? 0) >= 1);
  const hasInvoiceDocuments = submittedInvoices.length > 0;
  const invoiceDone = supplierAccepted && grnDone && hasInvoiceDocuments;

  const invoiceNames = new Set(submittedInvoices.map((i) => i.name));
  const hasPaymentDocuments = payments.some((p) =>
    invoiceNames.has(p.invoiceReference ?? "")
  );
  const paymentDone = invoiceDone && hasPaymentDocuments;

  const inTransitDone =
    supplierAccepted &&
    ["In Transit", "Partially Received", "Completed"].includes(rawStatus);

  const completedDone =
    supplierAccepted && inTransitDone && grnDone && invoiceDone && paymentDone;

  let displayStatus: string;
  if (isRejected) {
    displayStatus = "Rejected";
  } else if (isPendingAcceptance) {
    displayStatus = PENDING_SUPPLIER_ACCEPTANCE;
  } else if (completedDone || rawStatus === "Completed") {
    displayStatus = "Completed";
  } else {
    displayStatus = rawStatus;
  }

  const displayReceivedPct = supplierAccepted ? po.per_received ?? 0 : 0;
  const displayBilledPct = supplierAccepted && grnDone ? po.per_billed ?? 0 : 0;

  const showDeliveryInfo =
    supplierAccepted &&
    (isAccepted ||
      isInTransit ||
      rawStatus === "Partially Received" ||
      rawStatus === "Completed");

  const steps: TimelineStep[] = [
    { label: "PO Created", done: poCreated, sublabel: po.name },
    {
      label: "Supplier Accepted",
      done: supplierAccepted,
      sublabel: deliveryState?.supplier_acceptance_date
        ? formatDate(deliveryState.supplier_acceptance_date)
        : undefined,
    },
    {
      label: "In Transit",
      done: inTransitDone,
      sublabel: deliveryState?.tracking_number || undefined,
    },
    {
      label: "GRN Received",
      done: grnDone,
      sublabel: grnDone ? `${grns.length || 1} receipt(s)` : undefined,
    },
    {
      label: "Invoice Generated",
      done: invoiceDone,
      sublabel: invoiceDone ? submittedInvoices[0]?.name : undefined,
    },
    {
      label: "Supplier Payment Confirmed",
      done: paymentDone,
    },
    {
      label: "Completed",
      done: completedDone,
    },
  ];

  return {
    rawStatus,
    displayStatus,
    isPendingAcceptance,
    isAccepted,
    isRejected,
    isInTransit,
    supplierAccepted,
    grnDone,
    invoiceDone,
    paymentDone,
    showDeliveryInfo,
    displayReceivedPct,
    displayBilledPct,
    steps,
  };
}

/* ── helper components ───────────────────────────────────────────────────── */

function BackLink() {
  return (
    <Link
      to="/supplier/purchase-orders"
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 transition hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Purchase Orders
    </Link>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-2.5 shadow-sm transition hover:border-primary-100 hover:shadow-md">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary-600" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">{label}</p>
      </div>
      <p
        className={`mt-1 truncate text-sm font-semibold ${
          highlight ? "text-primary-600" : "text-neutral-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function MetaField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-neutral-900">{value}</p>
    </div>
  );
}

function ItemStatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "info" | "neutral";
}) {
  const styles = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
    info: "bg-primary-50 text-primary-700 ring-primary-200",
    neutral: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  };
  return (
    <span
      className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ring-inset ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function POSummaryPanel({
  poName,
  grandTotal,
  itemCount,
  receivedPct,
  billedPct,
  status,
  expectedDelivery,
}: {
  poName: string;
  grandTotal: number;
  itemCount: number;
  receivedPct: number;
  billedPct: number;
  status: string;
  expectedDelivery?: string;
}) {
  return (
    <div className="rounded-xl border border-primary-100 bg-gradient-to-b from-primary-50/80 to-white p-3.5 shadow-md ring-1 ring-primary-100/80 transition-shadow hover:shadow-lg">
      <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700">
        PO Summary
      </h3>
      <p className="mt-0.5 truncate text-[11px] font-medium text-neutral-500">{poName}</p>
      <div className="mt-2.5 rounded-lg border border-primary-100/80 bg-white/70 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          Order Value
        </p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums leading-none text-primary-600">
          {formatCurrency(grandTotal)}
        </p>
      </div>
      <div className="mt-2.5 space-y-2 text-sm">
        <SummaryRow label="Status" value={status} />
        <SummaryRow label="Line Items" value={String(itemCount)} />
        <SummaryRow label="Received" value={`${Math.round(receivedPct)}%`} />
        <SummaryRow label="Billed" value={`${Math.round(billedPct)}%`} />
        {expectedDelivery && (
          <SummaryRow label="Expected Delivery" value={formatUkDisplayDate(expectedDelivery)} />
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-500">{label}</span>
      <span className="font-semibold text-neutral-900">{value}</span>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-neutral-100 pb-2 last:border-none last:pb-0">
      <span className="text-neutral-500">{label}</span>
      <span className="max-w-[60%] text-right font-medium text-neutral-900">{value}</span>
    </div>
  );
}
