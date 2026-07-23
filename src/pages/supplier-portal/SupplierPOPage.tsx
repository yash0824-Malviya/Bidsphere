/**
 * Supplier Purchase Order Detail — read-only view for suppliers.
 *
 * Accessible at /supplier/po/:poName. Mirrors the buyer-side
 * PurchaseOrderDetailPage layout but strips every write action
 * (Submit, Create GRN, Create Voucher, edit controls).
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
  Download,
  FileText,
  Loader2,
  Mail,
  MessageSquareWarning,
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
  acceptPO,
  rejectPO,
  markInTransit,
  updateDeliveryDetails,
  hydrateDeliveryStateFromErp,
  isPoPendingSupplierAcceptance,
  saveDeliveryState,
} from "../../api/poDeliveryWorkflow";
import {
  fetchPoShipment,
  shipmentRecordToDeliveryState,
} from "../../api/poShipment";
import ProcurementTimeline from "../../components/supplier-portal/ProcurementTimeline";
import EmptyState from "../../components/EmptyState";
import { AppLoading, EnterpriseError } from "../../components/enterprise";
import StatusBadge from "../../components/StatusBadge";
import CalendarDatePicker from "../../components/ui/CalendarDatePicker";
import { formatUkDisplayDate } from "../../utils/erpNextDate";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from "../../utils/format";
import { SUPPORT_EMAIL } from "../../utils/supplierPortalUtils";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import type { PurchaseOrder } from "../../types/erpnext";
import type { PaymentSummary } from "../../api/supplierPortal";
import type { TimelineStep } from "../../components/supplier-portal/ProcurementTimeline";

export default function SupplierPOPage() {
  const { poName = "" } = useParams<{ poName: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const name = decodeURIComponent(poName);

  /* ── Session gate — ERP Link id for ownership, display name for chrome ── */
  const {
    supplierName,
    erpSupplierName,
    isReady: sessionReady,
    isAuthenticated,
  } = useSupplierSession();

  useEffect(() => {
    if (sessionReady && !isAuthenticated) {
      navigate("/supplier/login", { replace: true });
    }
  }, [sessionReady, isAuthenticated, navigate]);

  /* ── Modal state ──────────────────────────────────────────────────────── */
  const [acceptModalOpen, setAcceptModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [acceptModalStep, setAcceptModalStep] = useState(1);
  /** 1 = reason, 2 = confirm rejection */
  const [rejectModalStep, setRejectModalStep] = useState(1);

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
  const [deliveryEditOpen, setDeliveryEditOpen] = useState(false);
  const [deliveryEditForm, setDeliveryEditForm] = useState<AcceptPOPayload>({
    expected_delivery_date: "",
    vehicle_number: "",
    tracking_number: "",
    shipping_notes: "",
  });
  const [deliveryEditSubmitting, setDeliveryEditSubmitting] = useState(false);

  /* ── PO PDF download ──────────────────────────────────────────────────── */
  const [pdfDownloading, setPdfDownloading] = useState(false);

  /* ── Data fetch ───────────────────────────────────────────────────────── */
  const {
    data: po,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["supplier-portal-po", name],
    queryFn: () => getPurchaseOrder(name),
    enabled: !!name && sessionReady && isAuthenticated,
  });

  // ERP PO Shipment is the SSoT — hydrate local cache so Accept buttons match backend.
  const shipmentQuery = useQuery({
    queryKey: ["po-shipment", name],
    queryFn: async () => {
      const remote = await fetchPoShipment(name);
      if (remote?.po_name && remote.shipment_status) {
        const mapped = shipmentRecordToDeliveryState(remote);
        saveDeliveryState(mapped);
        return mapped;
      }
      return hydrateDeliveryStateFromErp(
        name,
        erpSupplierName || supplierName || undefined,
      );
    },
    enabled: !!name && sessionReady && isAuthenticated,
    staleTime: 0,
  });

  useEffect(() => {
    if (shipmentQuery.data) {
      setDeliveryState(shipmentQuery.data);
    }
  }, [shipmentQuery.data]);

  // Never leave the Accept modal open once the PO is no longer pending.
  useEffect(() => {
    if (
      acceptModalOpen &&
      deliveryState &&
      !isPoPendingSupplierAcceptance(deliveryState.status)
    ) {
      setAcceptModalOpen(false);
      setAcceptModalStep(1);
    }
  }, [acceptModalOpen, deliveryState]);

  const rfqRef =
    po?.rfq_name ||
    po?.rfq ||
    (po as { custom_rfq_reference?: string } | undefined)?.custom_rfq_reference ||
    "";

  const sqListQuery = useQuery({
    queryKey: ["supplier-portal-po-sqs", erpSupplierName],
    queryFn: () => getSupplierQuotationsBySupplier(erpSupplierName),
    enabled: !!erpSupplierName && !!po,
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
    queryKey: ["supplier-portal-po-payments", erpSupplierName],
    queryFn: () => getSupplierPaymentSummaries(erpSupplierName),
    enabled: !!erpSupplierName && !!po,
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

  function openAcceptModal() {
    const status = deliveryState?.status ?? "Pending Acceptance";
    if (!isPoPendingSupplierAcceptance(status)) {
      toast("This Purchase Order has already been accepted.", { icon: "ℹ️" });
      void queryClient.invalidateQueries({ queryKey: ["po-shipment", name] });
      return;
    }
    setAcceptModalStep(1);
    setAcceptModalOpen(true);
  }

  function openRejectModal() {
    const status = deliveryState?.status ?? "Pending Acceptance";
    if (!isPoPendingSupplierAcceptance(status)) {
      toast("This Purchase Order has already been accepted.", { icon: "ℹ️" });
      void queryClient.invalidateQueries({ queryKey: ["po-shipment", name] });
      return;
    }
    setRejectModalStep(1);
    setRejectModalOpen(true);
  }

  async function refreshAfterWorkflowAction(next?: PODeliveryState) {
    if (next) setDeliveryState(next);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["supplier-portal-po", name] }),
      queryClient.invalidateQueries({ queryKey: ["po-shipment", name] }),
      queryClient.invalidateQueries({ queryKey: ["supplier-portal-pos"] }),
      queryClient.invalidateQueries({ queryKey: ["supplier-portal-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["rfq-linked-pos"] }),
      queryClient.invalidateQueries({ queryKey: ["po-shipments"] }),
      queryClient.invalidateQueries({ queryKey: ["supplier-portal-delivery"] }),
    ]);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["supplier-portal-po", name] }),
      queryClient.refetchQueries({ queryKey: ["po-shipment", name] }),
    ]);
  }

  async function handleAcceptPO() {
    if (acceptSubmitting) return;
    if (!acceptForm.expected_delivery_date.trim()) {
      toast.error("Expected Delivery Date is required.");
      return;
    }
    if (!isPoPendingSupplierAcceptance(deliveryState?.status)) {
      toast("This Purchase Order has already been accepted.", { icon: "ℹ️" });
      setAcceptModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["po-shipment", name] });
      return;
    }
    setAcceptSubmitting(true);
    try {
      const actor = erpSupplierName || supplierName || undefined;
      const updated = await acceptPO(name, acceptForm, actor);
      toast.success("Purchase Order accepted successfully.");
      setAcceptModalOpen(false);
      setAcceptModalStep(1);
      setAcceptForm({
        expected_delivery_date: "",
        vehicle_number: "",
        tracking_number: "",
        shipping_notes: "",
      });
      await refreshAfterWorkflowAction(updated);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to accept PO.";
      if (/cannot accept po in status/i.test(message)) {
        toast("This Purchase Order has already been accepted.", { icon: "ℹ️" });
        setAcceptModalOpen(false);
        await refreshAfterWorkflowAction();
      } else {
        toast.error(message);
        // Local may already be Accepted if ERP sync failed mid-flight — resync UI.
        await refreshAfterWorkflowAction();
      }
    } finally {
      setAcceptSubmitting(false);
    }
  }

  function closeRejectModal() {
    setRejectModalOpen(false);
    setRejectModalStep(1);
  }

  async function handleRejectPO() {
    if (rejectSubmitting) return;
    if (!rejectForm.rejection_reason.trim()) {
      toast.error("Rejection reason is required.");
      setRejectModalStep(1);
      return;
    }
    if (rejectModalStep < 2) {
      setRejectModalStep(2);
      return;
    }
    if (!isPoPendingSupplierAcceptance(deliveryState?.status)) {
      toast("This Purchase Order has already been accepted.", { icon: "ℹ️" });
      closeRejectModal();
      await refreshAfterWorkflowAction();
      return;
    }
    setRejectSubmitting(true);
    try {
      const actor = erpSupplierName || supplierName || undefined;
      const updated = await rejectPO(name, rejectForm, actor);
      toast.success("Purchase Order rejected.");
      closeRejectModal();
      setRejectForm({ rejection_reason: "" });
      await refreshAfterWorkflowAction(updated);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reject PO.");
      await refreshAfterWorkflowAction();
    } finally {
      setRejectSubmitting(false);
    }
  }

  async function handleMarkAsShipped() {
    try {
      const actor = erpSupplierName || supplierName || undefined;
      const updated = await markInTransit(name, actor);
      toast.success("Purchase Order marked as shipped — warehouse can now create GRN.");
      await refreshAfterWorkflowAction(updated);
      void queryClient.invalidateQueries({
        queryKey: ["incoming-purchase-orders"],
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["warehouse", "incoming-pos"],
        refetchType: "active",
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to mark as shipped.");
    }
  }

  function openDeliveryEditModal() {
    setDeliveryEditForm({
      expected_delivery_date: deliveryState?.expected_delivery_date || "",
      vehicle_number: deliveryState?.vehicle_number || "",
      tracking_number: deliveryState?.tracking_number || "",
      shipping_notes: deliveryState?.shipping_notes || "",
    });
    setDeliveryEditOpen(true);
  }

  async function handleSaveDeliveryDetails() {
    if (deliveryEditSubmitting) return;
    setDeliveryEditSubmitting(true);
    try {
      const actor = erpSupplierName || supplierName || undefined;
      const updated = await updateDeliveryDetails(name, deliveryEditForm, actor);
      toast.success("Delivery details updated.");
      setDeliveryEditOpen(false);
      await refreshAfterWorkflowAction(updated);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update delivery details.",
      );
    } finally {
      setDeliveryEditSubmitting(false);
    }
  }

  /**
   * Client-side PO PDF (jsPDF) — same path as buyer PO detail.
   *
   * ERPNext `download_pdf` fails on this host: wkhtmltopdf cannot fetch print
   * CSS/assets (ContentNotFoundError → "broken image links"). Do not call that
   * endpoint from the browser.
   */
  async function handleDownloadPoPdf() {
    if (pdfDownloading || !po) return;
    setPdfDownloading(true);
    try {
      const { downloadPurchaseOrderPdf } = await import("../../utils/pdf");
      await downloadPurchaseOrderPdf(po);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Supplier PO PDF] Download failed:", err);
      toast.error("Unable to generate Purchase Order PDF. Please try again later.");
    } finally {
      setPdfDownloading(false);
    }
  }

  /* ── Loading skeleton ─────────────────────────────────────────────────── */
  if (!sessionReady || !supplierName || isLoading) {
    return (
      
        <AppLoading variant="document" />
      
    );
  }

  /* ── Error / not found ────────────────────────────────────────────────── */
  if (isError || !po) {
    return (
      
        <EnterpriseError
          error={error ?? new Error("not found")}
          onRetry={() => void refetch()}
          onBack={() => window.history.back()}
        />
      
    );
  }

  /* ── Access control — match Link id and/or display name ───────────────── */
  const poSupplier = (po.supplier ?? "").trim();
  const poSupplierDisplay = (po.supplier_name ?? "").trim();
  const sessionErp = (erpSupplierName || "").trim();
  const sessionDisplay = (supplierName || "").trim();
  const isOwner =
    (!!sessionErp && (poSupplier === sessionErp || poSupplierDisplay === sessionErp)) ||
    (!!sessionDisplay &&
      (poSupplier === sessionDisplay || poSupplierDisplay === sessionDisplay));

  if (!isOwner) {
    return (
      
        <BackLink />
        <EmptyState
          icon={ShoppingCart}
          title="Access denied"
          description="This purchase order does not belong to your supplier account."
        />
      
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
  const currency = po.currency || "USD";
  const requiredDate = po.schedule_date ? formatDate(po.schedule_date) : "—";
  const expectedDeliveryLabel = deliveryState?.expected_delivery_date
    ? formatUkDisplayDate(deliveryState.expected_delivery_date)
    : po.schedule_date
      ? formatDate(po.schedule_date)
      : "—";
  const taxesTotal = Number(po.total_taxes_and_charges ?? 0);
  const contactMailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `Purchase Order ${po.name} — supplier inquiry`,
  )}&body=${encodeURIComponent(
    `Hello Procurement,\n\nRegarding Purchase Order ${po.name}.\nSupplier: ${po.supplier_name ?? po.supplier ?? ""}\n\nMessage:\n`,
  )}`;
  const changeMailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `Change request — ${po.name}`,
  )}&body=${encodeURIComponent(
    `Hello Procurement,\n\nI am requesting a change to Purchase Order ${po.name}.\n\nRequested change:\n\nReason:\n`,
  )}`;

  function closeAcceptModal() {
    setAcceptModalOpen(false);
    setAcceptModalStep(1);
  }

  function getItemReceiveStatus(qty: number, received: number) {
    if (!supplierAccepted) return { label: "Awaiting", tone: "neutral" as const };
    if (received >= qty && qty > 0) return { label: "Received", tone: "success" as const };
    if (received > 0) return { label: "Partial", tone: "warning" as const };
    return { label: "Pending", tone: "warning" as const };
  }

  function getItemBillStatus(billed: number) {
    if (!supplierAccepted || !wf.grnDone) return { label: "Unbilled", tone: "neutral" as const };
    if (billed > 0) return { label: "Billed", tone: "info" as const };
    return { label: "Unbilled", tone: "neutral" as const };
  }

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    
      <BackLink />

      {/* PO header */}
      <header className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-600">
              Purchase Order
            </p>
            <h1 className="mt-1 break-all text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
              {po.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-600">
              <span className="font-semibold text-neutral-800">
                {po.supplier_name ?? po.supplier}
              </span>
              <span className="hidden text-neutral-300 sm:inline" aria-hidden>
                ·
              </span>
              <span>PO Date {formatDate(po.transaction_date)}</span>
              <span className="hidden text-neutral-300 sm:inline" aria-hidden>
                ·
              </span>
              <span>Required {requiredDate}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <StatusBadge status={displayStatus} size="lg" />
          </div>
        </div>

        {/* Enterprise actions */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
          <button
            type="button"
            onClick={() => void handleDownloadPoPdf()}
            disabled={pdfDownloading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
          >
            {pdfDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download PDF
          </button>
          {rfqRef ? (
            <Link
              to={`/supplier/rfq/${encodeURIComponent(rfqRef)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 no-underline shadow-sm transition hover:bg-neutral-50 sm:text-sm"
            >
              <FileText className="h-4 w-4" />
              View RFQ
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title="No linked RFQ on this purchase order"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-400 sm:text-sm"
            >
              <FileText className="h-4 w-4" />
              View RFQ
            </button>
          )}
          <a
            href={contactMailto}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 no-underline shadow-sm transition hover:bg-neutral-50 sm:text-sm"
          >
            <Mail className="h-4 w-4" />
            Contact Procurement
          </a>
          <a
            href={changeMailto}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 no-underline shadow-sm transition hover:bg-neutral-50 sm:text-sm"
          >
            <MessageSquareWarning className="h-4 w-4" />
            Request Change
          </a>
        </div>
      </header>

      {/* Action Required banner */}
      {isPendingAcceptance && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-amber-50/80 to-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                Action Required
              </p>
              <p className="mt-1 text-sm font-semibold text-amber-950 sm:text-base">
                Review this purchase order and accept or reject it to continue the
                procurement workflow.
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-amber-100 bg-white/80 px-3 py-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-amber-700/80">
                    Required / Due Date
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-neutral-900">
                    {requiredDate}
                  </dd>
                </div>
                <div className="rounded-lg border border-amber-100 bg-white/80 px-3 py-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-amber-700/80">
                    Expected Delivery
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-neutral-900">
                    {expectedDeliveryLabel}
                  </dd>
                </div>
                <div className="rounded-lg border border-amber-100 bg-white/80 px-3 py-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-amber-700/80">
                    Order Value
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-900">
                    {formatCurrency(po.grand_total ?? 0)} {currency}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:flex-row lg:w-auto lg:flex-col">
              <button
                type="button"
                onClick={openAcceptModal}
                disabled={acceptSubmitting}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-accent-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-accent-700 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 sm:text-base lg:min-w-[220px]"
              >
                <CheckCircle2 className="h-5 w-5" />
                Accept Purchase Order
              </button>
              <button
                type="button"
                onClick={openRejectModal}
                disabled={rejectSubmitting}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-white px-6 py-3 text-sm font-bold text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base lg:min-w-[220px]"
              >
                <XCircle className="h-5 w-5" />
                Reject Purchase Order
              </button>
            </div>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm shadow-sm">
          <p className="font-semibold text-red-800">
            Purchase Order Rejected
            {deliveryState?.rejected_date &&
              ` · ${formatDateTime(deliveryState.rejected_date)}`}
          </p>
          {deliveryState?.rejection_reason && (
            <p className="mt-1 text-sm text-red-700">{deliveryState.rejection_reason}</p>
          )}
        </div>
      )}

      {supplierAccepted && !isRejected && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to="/supplier/delivery-schedule"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-primary-200 bg-white px-5 py-2.5 text-sm font-semibold text-primary-700 no-underline shadow-sm transition hover:bg-primary-50"
          >
            <CalendarDays className="h-4 w-4" />
            View Delivery Schedule
          </Link>
          <button
            type="button"
            onClick={openDeliveryEditModal}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-neutral-200 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50"
          >
            <Truck className="h-4 w-4" />
            Update Delivery Details
          </button>
          {isAccepted && (
            <button
              type="button"
              onClick={() => void handleMarkAsShipped()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 hover:shadow-md"
            >
              <Truck className="h-4 w-4" />
              Mark as Shipped
            </button>
          )}
        </div>
      )}

      {/* Procurement workflow timeline */}
      <div className="mt-4">
        <ProcurementTimeline steps={poWorkflowSteps} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="space-y-4">
          {/* Information grid — equal height cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <InfoCard
              icon={ShoppingCart}
              label="Supplier"
              value={po.supplier_name ?? po.supplier ?? "—"}
            />
            <InfoCard icon={Building2} label="Company" value={po.company ?? "—"} />
            <InfoCard
              icon={CalendarDays}
              label="PO Date"
              value={formatDate(po.transaction_date)}
            />
            <InfoCard icon={CalendarDays} label="Required Date" value={requiredDate} />
            <InfoCard icon={Banknote} label="Currency" value={currency} />
            <InfoCard
              icon={Truck}
              label="Expected Delivery"
              value={expectedDeliveryLabel}
            />
            <InfoCard
              icon={Receipt}
              label="PO Value"
              value={formatCurrency(po.grand_total ?? 0)}
              highlight
              className="col-span-2 sm:col-span-3"
            />
          </div>

          {/* Delivery information */}
          {showDeliveryInfo && deliveryState && (
            <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary-600" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Supplier Delivery Information
                </h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <PackagePlus className="h-4 w-4 text-primary-600" />
                <h3 className="text-sm font-semibold text-neutral-900">Order Items</h3>
              </div>
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-semibold text-neutral-600">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/90 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-3 py-3 text-left">Description</th>
                    <th className="px-3 py-3 text-center">Qty</th>
                    <th className="px-3 py-3 text-center">Unit Price</th>
                    <th className="px-3 py-3 text-center">Subtotal</th>
                    <th className="px-3 py-3 text-center">Tax</th>
                    <th className="px-3 py-3 text-center">Delivery Date</th>
                    <th className="px-3 py-3 text-center">Receiving</th>
                    <th className="px-4 py-3 text-center">Billing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(po.items ?? []).map((item, idx) => {
                    const received = item.received_qty ?? 0;
                    const receiveStatus = getItemReceiveStatus(item.qty, received);
                    const billStatus = getItemBillStatus(item.billed_amt ?? 0);
                    const lineDelivery =
                      item.schedule_date ||
                      item.expected_delivery_date ||
                      po.schedule_date;
                    const description =
                      item.description?.trim() ||
                      item.item_name ||
                      item.item_code ||
                      "—";
                    return (
                      <tr
                        key={item.name ?? idx}
                        className="transition-colors hover:bg-neutral-50/70"
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-primary-100">
                              <Package className="h-4 w-4 text-primary-600" />
                            </span>
                            <p className="font-semibold text-neutral-900">{item.item_code}</p>
                          </div>
                        </td>
                        <td className="max-w-[220px] px-3 py-3 align-top text-neutral-600">
                          <p className="line-clamp-2 text-sm">{description}</p>
                        </td>
                        <td className="px-3 py-3 text-center tabular-nums text-neutral-700">
                          {item.qty}
                          {item.uom ? (
                            <span className="ml-1 text-xs text-neutral-400">{item.uom}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-center tabular-nums text-neutral-700">
                          {formatCurrency(item.rate)}
                        </td>
                        <td className="px-3 py-3 text-center font-semibold tabular-nums text-neutral-900">
                          {formatCurrency(item.amount ?? item.rate * item.qty)}
                        </td>
                        <td className="px-3 py-3 text-center tabular-nums text-neutral-500">
                          —
                        </td>
                        <td className="px-3 py-3 text-center text-neutral-700">
                          {lineDelivery ? formatDate(lineDelivery) : "—"}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <ItemStatusBadge
                            label={receiveStatus.label}
                            tone={receiveStatus.tone}
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ItemStatusBadge label={billStatus.label} tone={billStatus.tone} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {taxesTotal > 0 && (
                    <tr className="border-t border-neutral-100 bg-neutral-50/50">
                      <td
                        colSpan={4}
                        className="px-4 py-2.5 text-right text-sm font-medium text-neutral-600"
                      >
                        Taxes & Charges
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm font-semibold tabular-nums text-neutral-800">
                        {formatCurrency(taxesTotal)}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  )}
                  <tr className="border-t border-neutral-200 bg-neutral-50/90">
                    <td
                      colSpan={4}
                      className="px-4 py-3.5 text-right text-sm font-semibold text-neutral-700"
                    >
                      Grand Total
                    </td>
                    <td className="px-3 py-3.5 text-center text-base font-bold tabular-nums text-primary-600">
                      {formatCurrency(po.grand_total ?? 0)}
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <p className="pb-2 text-center text-xs text-neutral-400">
            Questions about this order? Use Contact Procurement or Request Change above.
          </p>
        </div>

        {/* Sticky PO summary — desktop */}
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          <POSummaryPanel
            poName={po.name}
            supplier={po.supplier_name ?? po.supplier ?? "—"}
            poDate={formatDate(po.transaction_date)}
            requiredDate={requiredDate}
            currency={currency}
            grandTotal={po.grand_total ?? 0}
            itemCount={itemCount}
            receivedPct={receivedPct}
            billedPct={billedPct}
            status={displayStatus}
            expectedDelivery={expectedDeliveryLabel}
          />
        </aside>
      </div>

      {/* Mobile summary */}
      <div className="sticky bottom-0 z-10 mt-4 border-t border-neutral-200 bg-white/95 p-3 backdrop-blur lg:hidden">
        <POSummaryPanel
          poName={po.name}
          supplier={po.supplier_name ?? po.supplier ?? "—"}
          poDate={formatDate(po.transaction_date)}
          requiredDate={requiredDate}
          currency={currency}
          grandTotal={po.grand_total ?? 0}
          itemCount={itemCount}
          receivedPct={receivedPct}
          billedPct={billedPct}
          status={displayStatus}
          expectedDelivery={expectedDeliveryLabel}
          compact
        />
      </div>

      {/* Accept PO Modal — step-based (pending acceptance only) */}
      {acceptModalOpen && isPendingAcceptance && (
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
                <div className="space-y-3">
                  <div className="rounded-xl border border-accent-100 bg-accent-50/50 px-3 py-2.5 text-sm text-accent-900">
                    Confirm that you accept purchase order{" "}
                    <span className="font-semibold">{po.name}</span> and will fulfill
                    delivery as stated below.
                  </div>
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
                  onClick={() => void handleAcceptPO()}
                  disabled={acceptSubmitting || !isPendingAcceptance}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {acceptSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Accepting…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Confirm Accept Purchase Order
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject PO Modal — reason then confirmation (pending acceptance only) */}
      {rejectModalOpen && isPendingAcceptance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-neutral-950/50 backdrop-blur-sm"
            onClick={closeRejectModal}
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
                  onClick={closeRejectModal}
                  className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-neutral-500">
                <span
                  className={
                    rejectModalStep >= 1 ? "font-semibold text-red-700" : undefined
                  }
                >
                  1. Reason
                </span>
                <ChevronRight className="h-3.5 w-3.5" />
                <span
                  className={
                    rejectModalStep >= 2 ? "font-semibold text-red-700" : undefined
                  }
                >
                  2. Confirm
                </span>
              </div>
            </div>
            <div className="px-5 py-4">
              {rejectModalStep === 1 ? (
                <>
                  <label className="mb-1.5 block text-sm font-medium text-neutral-700">
                    Rejection Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Explain why you are rejecting this purchase order…"
                    value={rejectForm.rejection_reason}
                    onChange={(e) => setRejectForm({ rejection_reason: e.target.value })}
                    className="input-field min-h-[96px] resize-y"
                    required
                  />
                  <p className="mt-2 text-xs text-neutral-500">
                    A reason is mandatory. Procurement will review your response.
                  </p>
                </>
              ) : (
                <div className="rounded-xl border border-red-100 bg-red-50/70 p-4">
                  <p className="text-sm font-semibold text-red-900">
                    Confirm rejection of {po.name}?
                  </p>
                  <p className="mt-2 text-sm text-red-800">
                    This cannot be undone from the portal. Procurement will be notified.
                  </p>
                  <p className="mt-3 rounded-lg border border-red-100 bg-white px-3 py-2 text-sm text-neutral-800">
                    <span className="font-medium text-neutral-500">Reason: </span>
                    {rejectForm.rejection_reason}
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-between gap-3 border-t border-neutral-100 px-5 py-4">
              <button
                type="button"
                onClick={() =>
                  rejectModalStep === 1
                    ? closeRejectModal()
                    : setRejectModalStep(1)
                }
                disabled={rejectSubmitting}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
              >
                {rejectModalStep === 1 ? "Cancel" : "Back"}
              </button>
              <button
                type="button"
                onClick={handleRejectPO}
                disabled={
                  rejectSubmitting ||
                  (rejectModalStep === 1 && !rejectForm.rejection_reason.trim())
                }
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rejectSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Rejecting…
                  </>
                ) : rejectModalStep === 1 ? (
                  "Continue to Confirm"
                ) : (
                  <>
                    <XCircle className="h-4 w-4" />
                    Confirm Rejection
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Update Delivery Details modal */}
      {deliveryEditOpen && supplierAccepted && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-neutral-950/50 backdrop-blur-sm"
            onClick={() => !deliveryEditSubmitting && setDeliveryEditOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-neutral-200">
            <div className="border-b border-neutral-100 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">
                    Update Delivery Details
                  </h2>
                  <p className="mt-0.5 text-xs text-neutral-500">{po.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeliveryEditOpen(false)}
                  disabled={deliveryEditSubmitting}
                  className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-neutral-700">
                  Expected Delivery Date
                </label>
                <CalendarDatePicker
                  value={deliveryEditForm.expected_delivery_date || ""}
                  onChange={(iso) =>
                    setDeliveryEditForm((f) => ({
                      ...f,
                      expected_delivery_date: iso,
                    }))
                  }
                  placeholder="DD/MM/YYYY"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">
                  Vehicle Number
                </label>
                <input
                  type="text"
                  value={deliveryEditForm.vehicle_number || ""}
                  onChange={(e) =>
                    setDeliveryEditForm((f) => ({
                      ...f,
                      vehicle_number: e.target.value,
                    }))
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
                  value={deliveryEditForm.tracking_number || ""}
                  onChange={(e) =>
                    setDeliveryEditForm((f) => ({
                      ...f,
                      tracking_number: e.target.value,
                    }))
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
                  value={deliveryEditForm.shipping_notes || ""}
                  onChange={(e) =>
                    setDeliveryEditForm((f) => ({
                      ...f,
                      shipping_notes: e.target.value,
                    }))
                  }
                  className="input-field min-h-[72px] resize-y"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-neutral-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setDeliveryEditOpen(false)}
                disabled={deliveryEditSubmitting}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveDeliveryDetails()}
                disabled={deliveryEditSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-50"
              >
                {deliveryEditSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save Delivery Details"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    
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
  const isPendingAcceptance = isPoPendingSupplierAcceptance(rawStatus);
  const isRejected = rawStatus === "Rejected";
  const isAccepted = rawStatus === "Accepted";
  const isInTransit = rawStatus === "In Transit";

  const supplierAccepted =
    !isPendingAcceptance &&
    !isRejected &&
    (deliveryState?.supplier_accepted === true ||
      [
        "Accepted",
        "In Transit",
        "Delivered",
        "Arrived",
        "Partially Received",
        "Completed",
      ].includes(rawStatus));

  // PO document exists ⇒ Created. Do not require Submit for timeline progress
  // so "Pending Supplier Acceptance" stays the single Current stage.
  const poCreated = Boolean(po.name);

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

  const acceptanceLabel = isRejected
    ? "Supplier Rejected"
    : supplierAccepted
      ? "Supplier Accepted"
      : PENDING_SUPPLIER_ACCEPTANCE;

  const steps: TimelineStep[] = [
    { label: "PO Created", done: poCreated, sublabel: po.name },
    {
      label: acceptanceLabel,
      done: supplierAccepted,
      rejected: isRejected,
      sublabel: isRejected
        ? deliveryState?.rejected_date
          ? formatDate(deliveryState.rejected_date)
          : "Rejected"
        : deliveryState?.supplier_acceptance_date
          ? formatDate(deliveryState.supplier_acceptance_date)
          : isPendingAcceptance
            ? "Awaiting response"
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
  className = "",
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex h-full min-h-[88px] flex-col rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm transition hover:border-primary-100 hover:shadow-md ${className}`}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary-600" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          {label}
        </p>
      </div>
      <p
        className={`mt-auto pt-2 text-sm font-semibold leading-snug ${
          highlight ? "text-lg text-primary-600 tabular-nums" : "text-neutral-900"
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
    success: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    warning: "bg-amber-100 text-amber-800 ring-amber-200",
    info: "bg-primary-100 text-primary-800 ring-primary-200",
    neutral: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  };
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function POSummaryPanel({
  poName,
  supplier,
  poDate,
  requiredDate,
  currency,
  grandTotal,
  itemCount,
  receivedPct,
  billedPct,
  status,
  expectedDelivery,
  compact,
}: {
  poName: string;
  supplier: string;
  poDate: string;
  requiredDate: string;
  currency: string;
  grandTotal: number;
  itemCount: number;
  receivedPct: number;
  billedPct: number;
  status: string;
  expectedDelivery?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-primary-100 bg-gradient-to-b from-primary-50/80 to-white shadow-md ring-1 ring-primary-100/80 ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700">
        PO Summary
      </h3>
      <p className="mt-0.5 truncate text-[11px] font-medium text-neutral-500">{poName}</p>
      <div className="mt-3 rounded-lg border border-primary-100/80 bg-white/80 px-3 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          Order Value
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums leading-none text-primary-600">
          {formatCurrency(grandTotal)}
        </p>
        <p className="mt-1 text-xs font-medium text-neutral-500">{currency}</p>
      </div>
      <div className={`mt-3 space-y-2 text-sm ${compact ? "space-y-1.5" : ""}`}>
        <SummaryRow label="Status" value={status} />
        <SummaryRow label="Supplier" value={supplier} />
        <SummaryRow label="PO Date" value={poDate} />
        <SummaryRow label="Required Date" value={requiredDate} />
        <SummaryRow label="Currency" value={currency} />
        <SummaryRow label="Expected Delivery" value={expectedDelivery || "—"} />
        {!compact && (
          <>
            <SummaryRow label="Line Items" value={String(itemCount)} />
            <SummaryRow label="Received" value={`${Math.round(receivedPct)}%`} />
            <SummaryRow label="Billed" value={`${Math.round(billedPct)}%`} />
          </>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-neutral-500">{label}</span>
      <span className="max-w-[60%] text-right text-sm font-semibold leading-snug text-neutral-900">
        {value}
      </span>
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
