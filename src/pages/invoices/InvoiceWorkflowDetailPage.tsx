import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  Receipt,
  ThumbsDown,
  ThumbsUp,
  Wallet,
} from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PdfActions from "../../components/PdfActions";
import ProcurementTimeline from "../../components/supplier-portal/ProcurementTimeline";
import type { TimelineStep } from "../../components/supplier-portal/ProcurementTimeline";
import VoucherHistory from "../../components/VoucherHistory";
import {
  buildVoucherInvoicePdf,
  buildVoucherPaymentPdf,
  voucherInvoicePdfFilename,
  voucherPaymentPdfFilename,
} from "../../utils/pdf/voucherDocPdf";
import {
  approveInvoice,
  getVoucherById,
  INVOICE_DISPLAY_TONE,
  type InvoiceDisplayStatus,
  invoiceDisplayStatus,
  PAYMENT_STATUS_TONE,
  paymentStatus,
  rejectInvoice,
} from "../../api/vouchers";
import { useAuthStore } from "../../store/authStore";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import type { Voucher } from "../../types/voucher";
import { formatCurrency, formatDate } from "../../utils/format";

const ACTIVITY_PREVIEW_LIMIT = 4;

export default function InvoiceWorkflowDetailPage() {
  const { id = "" } = useParams();
  const voucherId = decodeURIComponent(id);
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canAct = role === "finance" || role === "admin";

  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const [voucher, setVoucher] = useState<Voucher | null>(() =>
    getVoucherById(voucherId)
  );
  const syncVersion = useVoucherSyncStore((s) => s.version);
  useEffect(() => {
    setVoucher(getVoucherById(voucherId));
  }, [voucherId, syncVersion]);

  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showFullTimeline, setShowFullTimeline] = useState(false);

  if (!voucher || !voucher.invoice) {
    return (
      <div>
        <BackLink />
        <EmptyState
          icon={Receipt}
          title="Invoice not found"
          description="No supplier invoice has been raised for this record."
        />
      </div>
    );
  }

  const invoice = voucher.invoice;
  const invoiceStatus = invoice.status ?? "submitted";
  const payableAmount = invoice.total;
  const headerStatus = invoiceDisplayStatus(voucher);
  const payStatus = paymentStatus(voucher);
  const workflowSteps = deriveInvoiceWorkflow(voucher);
  const expectedRelease = deriveExpectedRelease(voucher, payStatus);
  const hasMoreActivity = voucher.history.length > ACTIVITY_PREVIEW_LIMIT;

  function handleApprove() {
    const updated = approveInvoice(voucher!.id);
    if (updated) {
      setVoucher({ ...updated });
      toast.success("Invoice approved.");
    }
  }

  function handleReject() {
    if (!rejectReason.trim()) {
      toast.error("Please add a reason for rejection.");
      return;
    }
    const updated = rejectInvoice(voucher!.id, rejectReason.trim());
    if (updated) {
      setVoucher({ ...updated });
      setShowReject(false);
      setRejectReason("");
      toast.success("Invoice rejected. Supplier has been notified.");
    }
  }

  return (
    <div className="space-y-3 pb-4">
      <BackLink />

      {/* Content header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">
            Supplier Invoice
          </p>
          <h1 className="mt-0.5 text-xl font-bold text-neutral-900 sm:text-2xl">
            {invoice.invoice_number}
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500">{voucher.supplier_name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PdfActions
            docLabel="Invoice PDF"
            filename={voucherInvoicePdfFilename(voucher)}
            build={() => buildVoucherInvoicePdf(voucher)}
          />
          {voucher.payment && canAct && (
            <PdfActions
              showView={false}
              docLabel="Payment PDF"
              filename={voucherPaymentPdfFilename(voucher)}
              build={() => buildVoucherPaymentPdf(voucher)}
            />
          )}
          <InvoiceWorkflowStatusBadge status={headerStatus} />
        </div>
      </div>

      {/* Linkage strip */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <DetailField
              label="Voucher"
              value={
                <Link
                  to={`/p2p/vouchers/${encodeURIComponent(voucher.id)}`}
                  className="font-semibold text-primary-600 hover:underline"
                >
                  {voucher.id}
                </Link>
              }
            />
            <DetailField
              label="PO Reference"
              value={
                voucher.po_reference ? (
                  <Link
                    to={`/p2p/purchase-orders/${encodeURIComponent(voucher.po_reference)}`}
                    className="font-semibold text-primary-600 hover:underline"
                  >
                    {voucher.po_reference}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
          </div>
          <div className="space-y-2 sm:border-l sm:border-neutral-100 sm:pl-4">
            <DetailField
              label="GRN Reference"
              value={
                voucher.grn_reference ? (
                  <Link
                    to={`/p2p/grn/${encodeURIComponent(voucher.grn_reference)}`}
                    className="font-semibold text-primary-600 hover:underline"
                  >
                    {voucher.grn_reference}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <DetailField label="Supplier" value={voucher.supplier_name} />
          </div>
        </div>
      </div>

      {/* Invoice workflow timeline */}
      <ProcurementTimeline steps={workflowSteps} title="Invoice Workflow" />

      {/* Sticky finance review actions */}
      {canAct && invoiceStatus === "submitted" && (
        <div className="sticky top-[52px] z-20 rounded-xl border border-primary-200 bg-white/95 p-3 shadow-md backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                Finance Review
              </p>
              <p className="mt-0.5 text-sm text-neutral-700">
                Approve or reject this supplier invoice to continue payment processing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleApprove}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700"
              >
                <ThumbsUp className="h-4 w-4" />
                Approve Invoice
              </button>
              <button
                type="button"
                onClick={() => setShowReject((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-50"
              >
                <ThumbsDown className="h-4 w-4" />
                Reject
              </button>
            </div>
          </div>
          {showReject && (
            <div className="mt-3 grid max-w-lg gap-2 border-t border-neutral-100 pt-3">
              <label className="text-xs font-medium text-neutral-700">
                Reason for rejection
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="e.g. Tax rate incorrect; please revise and re-submit."
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <div>
                <button
                  type="button"
                  onClick={handleReject}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
        <div className="min-w-0 space-y-3">
          {/* Invoice details — compact two-column */}
          <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-neutral-100 px-3.5 py-2.5">
              <Receipt className="h-4 w-4 text-primary-600" />
              <h2 className="text-sm font-semibold text-neutral-900">Invoice Details</h2>
            </div>
            <div className="grid gap-x-6 gap-y-2 p-3.5 sm:grid-cols-2">
              <DetailField label="Subtotal" value={formatCurrency(invoice.subtotal)} />
              <DetailField
                label={`Tax (${invoice.tax_rate}%)`}
                value={formatCurrency(invoice.tax_amount)}
              />
              <DetailField
                label="Invoice Total"
                value={formatCurrency(invoice.total)}
                highlight
              />
              <DetailField
                label="Payment Terms"
                value={invoice.payment_terms || "—"}
              />
              <DetailField
                label="Due Date"
                value={invoice.due_date ? formatDate(invoice.due_date) : "—"}
              />
              <DetailField
                label="Submitted On"
                value={formatDate(invoice.raised_at)}
              />
            </div>
            {invoice.notes && (
              <p className="border-t border-neutral-100 px-3.5 py-2.5 text-sm text-neutral-600">
                {invoice.notes}
              </p>
            )}
          </section>

          {/* Rejection notice */}
          {invoiceStatus === "rejected" && invoice.rejection_reason && (
            <section className="rounded-xl border border-red-200 bg-red-50/60 p-3.5 shadow-sm">
              <p className="text-sm font-semibold text-red-700">Invoice rejected</p>
              <p className="mt-1 text-sm text-neutral-700">{invoice.rejection_reason}</p>
              <p className="mt-1 text-xs text-neutral-500">
                Waiting for the supplier to re-submit a corrected invoice.
              </p>
            </section>
          )}

          {/* Payment summary — simplified */}
          <section
            className={`rounded-xl border bg-white shadow-sm ${
              voucher.payment ? "border-teal-200" : "border-neutral-200"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-teal-600" />
                <h2 className="text-sm font-semibold text-neutral-900">Payment Summary</h2>
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${PAYMENT_STATUS_TONE[payStatus]}`}
              >
                {payStatus}
              </span>
            </div>
            <div className="grid gap-x-6 gap-y-2 p-3.5 sm:grid-cols-2">
              <DetailField label="Payment Status" value={payStatus} />
              <DetailField
                label="Amount"
                value={formatCurrency(
                  voucher.payment?.amount ?? invoice.total
                )}
                highlight
              />
              <DetailField
                label="Due Date"
                value={
                  invoice.due_date
                    ? formatDate(invoice.due_date)
                    : voucher.due_date
                      ? formatDate(voucher.due_date)
                      : "—"
                }
              />
              <DetailField label="Expected Release" value={expectedRelease} />
              {voucher.payment?.payment_method && (
                <DetailField
                  label="Payment Method"
                  value={voucher.payment.payment_method}
                />
              )}
              {voucher.payment?.confirmed_at && (
                <DetailField
                  label="Payment Date"
                  value={formatDate(voucher.payment.confirmed_at)}
                />
              )}
              {voucher.payment?.reference_number && (
                <DetailField
                  label="Reference"
                  value={voucher.payment.reference_number}
                />
              )}
              {voucher.payment?.confirmed_by && (
                <DetailField
                  label="Released By"
                  value={voucher.payment.confirmed_by}
                />
              )}
            </div>
          </section>

          {/* Post-review actions */}
          <section className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
            <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-neutral-500">
              {canAct ? "Actions" : "Status"}
            </h2>

            {!canAct && (
              <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-600">
                <Eye className="h-4 w-4 shrink-0 text-neutral-400" />
                Read-only view. Invoice review and payment are handled by the Finance
                team.
              </div>
            )}

            {canAct && invoiceStatus === "approved" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/payments/process/${encodeURIComponent(voucher.id)}`
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-600"
                >
                  <Wallet className="h-4 w-4" />
                  Release Payment ({formatCurrency(payableAmount)})
                </button>
                {!voucher.po_reference && (
                  <p className="text-xs text-amber-600">
                    No linked Purchase Order — a payment cannot be processed for this
                    invoice.
                  </p>
                )}
              </div>
            )}

            {invoiceStatus === "rejected" && canAct && (
              <WaitingMsg text="Invoice rejected — waiting for the supplier to re-submit." />
            )}

            {invoiceStatus === "paid" && voucher.status !== "payment_received" && (
              <WaitingMsg text="Payment released. Waiting for the supplier to confirm receipt." />
            )}

            {voucher.status === "payment_received" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-100 px-3 py-1 text-sm font-semibold text-success-700 ring-1 ring-inset ring-success-200">
                <CheckCircle2 className="h-4 w-4" />
                Completed — fully settled
              </span>
            )}

            {canAct &&
              invoiceStatus === "submitted" &&
              !showReject && (
                <p className="text-xs text-neutral-500">
                  Use the review bar above to approve or reject this invoice.
                </p>
              )}
          </section>
        </div>

        {/* Activity sidebar — compact */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">
              Activity
            </h2>
            <VoucherHistory
              history={voucher.history}
              limit={showFullTimeline ? undefined : ACTIVITY_PREVIEW_LIMIT}
              compact
            />
            {hasMoreActivity && (
              <button
                type="button"
                onClick={() => setShowFullTimeline((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
              >
                {showFullTimeline ? (
                  <>
                    Show less
                    <ChevronUp className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    View Full Timeline
                    <ChevronDown className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ── UI helpers (display-only derivation) ─────────────────────────────────── */

function deriveInvoiceWorkflow(voucher: Voucher): TimelineStep[] {
  const inv = voucher.invoice;
  const reviewComplete =
    !!inv &&
    (inv.status === "approved" ||
      inv.status === "rejected" ||
      inv.status === "paid" ||
      voucher.status === "invoice_approved" ||
      voucher.status === "invoice_rejected");
  const paymentReleased =
    !!voucher.payment ||
    voucher.status === "payment_confirmed" ||
    inv?.status === "paid";
  const fullyPaid = voucher.status === "payment_received";

  return [
    {
      label: "PO Created",
      done: !!voucher.po_reference,
      sublabel: voucher.po_reference,
    },
    {
      label: "GRN Completed",
      done: !!voucher.grn_reference,
      sublabel: voucher.grn_reference,
    },
    {
      label: "Voucher Created",
      done: true,
      sublabel: voucher.id,
    },
    {
      label: "Invoice Submitted",
      done: !!inv,
      sublabel: inv?.invoice_number,
    },
    {
      label: "Finance Review",
      done: reviewComplete,
    },
    {
      label: "Payment Pending",
      done: paymentReleased,
    },
    {
      label: "Paid",
      done: fullyPaid,
    },
  ];
}

function deriveExpectedRelease(
  voucher: Voucher,
  payStatus: ReturnType<typeof paymentStatus>
): string {
  if (voucher.status === "payment_received") return "Completed";
  if (voucher.payment?.confirmed_at) {
    return formatDate(voucher.payment.confirmed_at);
  }
  if (payStatus === "Payment Pending") {
    const due = voucher.invoice?.due_date ?? voucher.due_date;
    return due ? formatDate(due) : "Pending finance release";
  }
  if (payStatus === "Awaiting Approval") return "After invoice approval";
  if (payStatus === "Paid") return "Payment released";
  return "—";
}

function InvoiceWorkflowStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-xl px-3.5 py-1.5 text-sm font-bold ring-2 ring-inset ${INVOICE_DISPLAY_TONE[status]}`}
    >
      {status}
    </span>
  );
}

function DetailField({
  label,
  value,
  highlight,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <span
        className={`min-w-0 truncate text-right font-semibold ${
          highlight ? "text-primary-600" : "text-neutral-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function WaitingMsg({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-600">
      <Clock className="h-4 w-4 shrink-0 text-neutral-400" />
      {text}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/p2p/invoices"
      className="inline-flex items-center gap-1 text-sm text-neutral-500 transition hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Invoices
    </Link>
  );
}
