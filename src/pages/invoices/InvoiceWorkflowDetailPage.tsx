import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  Receipt,
  ThumbsDown,
  ThumbsUp,
  Wallet,
} from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PdfActions from "../../components/PdfActions";
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
  invoiceDisplayStatus,
  PAYMENT_STATUS_TONE,
  paymentStatus,
  rejectInvoice,
} from "../../api/vouchers";
import { useAuthStore } from "../../store/authStore";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import type { Voucher } from "../../types/voucher";
import { formatCurrency, formatDate } from "../../utils/format";

export default function InvoiceWorkflowDetailPage() {
  const { id = "" } = useParams();
  const voucherId = decodeURIComponent(id);
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canAct = role === "finance" || role === "admin";

  const [voucher, setVoucher] = useState<Voucher | null>(() =>
    getVoucherById(voucherId)
  );
  // Refresh from the shared store on sync (load/focus) so approval / payment
  // state stays identical across environments.
  const syncVersion = useVoucherSyncStore((s) => s.version);
  useEffect(() => {
    setVoucher(getVoucherById(voucherId));
  }, [voucherId, syncVersion]);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

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
    <div>
      <BackLink />

      <PageHeader
        title={invoice.invoice_number}
        description={`Invoice from ${voucher.supplier_name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PdfActions
              docLabel="Invoice PDF"
              filename={voucherInvoicePdfFilename(voucher)}
              build={() => buildVoucherInvoicePdf(voucher!)}
            />
            {voucher.payment && canAct && (
              <PdfActions
                showView={false}
                docLabel="Payment PDF"
                filename={voucherPaymentPdfFilename(voucher)}
                build={() => buildVoucherPaymentPdf(voucher!)}
              />
            )}
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold uppercase tracking-wide ring-1 ring-inset ${INVOICE_DISPLAY_TONE[headerStatus]}`}
            >
              {headerStatus}
            </span>
          </div>
        }
      />

      {/* Linkage chain — Invoice → Voucher → PO → GRN */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Supplier" value={voucher.supplier_name} />
        <SummaryTile
          label="Voucher"
          value={voucher.id}
          to={`/p2p/vouchers/${encodeURIComponent(voucher.id)}`}
        />
        <SummaryTile
          label="PO Reference"
          value={voucher.po_reference || "—"}
          to={
            voucher.po_reference
              ? `/p2p/purchase-orders/${encodeURIComponent(voucher.po_reference)}`
              : undefined
          }
        />
        <SummaryTile
          label="GRN Reference"
          value={voucher.grn_reference || "—"}
          to={
            voucher.grn_reference
              ? `/p2p/grn/${encodeURIComponent(voucher.grn_reference)}`
              : undefined
          }
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Invoice breakdown */}
          <div className="card">
            <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
              <Receipt className="h-4 w-4 text-orange-500" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Invoice Details
              </h3>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryTile
                label="Subtotal"
                value={formatCurrency(invoice.subtotal)}
              />
              <SummaryTile
                label={`Tax (${invoice.tax_rate}%)`}
                value={formatCurrency(invoice.tax_amount)}
              />
              <SummaryTile
                label="Invoice Total"
                value={formatCurrency(invoice.total)}
              />
              <SummaryTile
                label="Payment Terms"
                value={invoice.payment_terms || "—"}
              />
              <SummaryTile
                label="Due Date"
                value={invoice.due_date ? formatDate(invoice.due_date) : "—"}
              />
              <SummaryTile
                label="Submitted On"
                value={formatDate(invoice.raised_at)}
              />
            </div>
            {invoice.notes && (
              <p className="border-t border-neutral-100 px-5 py-3 text-sm text-neutral-600">
                {invoice.notes}
              </p>
            )}
          </div>

          {/* Rejection notice */}
          {invoiceStatus === "rejected" && invoice.rejection_reason && (
            <div className="card border-l-4 border-l-red-400">
              <div className="px-5 py-4">
                <p className="text-sm font-semibold text-red-700">
                  Invoice rejected
                </p>
                <p className="mt-1 text-sm text-neutral-600">
                  {invoice.rejection_reason}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  Waiting for the supplier to re-submit a corrected invoice.
                </p>
              </div>
            </div>
          )}

          {/* Payment Summary — single source of truth for payment status */}
          <div
            className={`card border-l-4 ${
              voucher.payment ? "border-l-teal-500" : "border-l-neutral-300"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-teal-600" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Payment Summary
                </h3>
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${PAYMENT_STATUS_TONE[payStatus]}`}
              >
                {payStatus}
              </span>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryTile label="Payment Status" value={payStatus} />
              <SummaryTile
                label="Payment Method"
                value={voucher.payment?.payment_method ?? "—"}
              />
              <SummaryTile
                label="Payment Date"
                value={
                  voucher.payment
                    ? formatDate(voucher.payment.confirmed_at)
                    : "—"
                }
              />
              <SummaryTile
                label="Reference"
                value={voucher.payment?.reference_number ?? "—"}
              />
              <SummaryTile
                label="Amount Paid"
                value={
                  voucher.payment
                    ? formatCurrency(voucher.payment.amount)
                    : formatCurrency(0)
                }
              />
              <SummaryTile
                label="Released By"
                value={voucher.payment?.confirmed_by ?? "—"}
              />
            </div>
          </div>

          {/* Finance actions */}
          <div className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">
              {canAct ? "Review & Actions" : "Status"}
            </h3>

            {!canAct && (
              <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                <Eye className="h-4 w-4 flex-shrink-0 text-neutral-400" />
                Read-only view. Invoice review and payment are handled by the
                Finance team.
              </div>
            )}

            {canAct && invoiceStatus === "submitted" && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleApprove}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
                >
                  <ThumbsUp className="h-4 w-4" />
                  Approve Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setShowReject((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  <ThumbsDown className="h-4 w-4" />
                  Reject
                </button>
              </div>
            )}

            {canAct && invoiceStatus === "submitted" && showReject && (
              <div className="mt-3 grid max-w-lg gap-2">
                <label className="text-xs font-medium text-neutral-700">
                  Reason for rejection
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Tax rate incorrect; please revise and re-submit."
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
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

            {canAct && invoiceStatus === "approved" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/payments/process/${encodeURIComponent(voucher!.id)}`
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
                >
                  <Wallet className="h-4 w-4" />
                  Release Payment ({formatCurrency(payableAmount)})
                </button>
                {!voucher.po_reference && (
                  <p className="text-xs text-amber-600">
                    No linked Purchase Order — a payment cannot be processed
                    for this invoice.
                  </p>
                )}
              </div>
            )}

            {invoiceStatus === "rejected" && canAct && (
              <WaitingMsg text="Invoice rejected — waiting for the supplier to re-submit." />
            )}

            {invoiceStatus === "paid" &&
              voucher.status !== "payment_received" && (
                <WaitingMsg text="Payment released. Waiting for the supplier to confirm receipt." />
              )}

            {voucher.status === "payment_received" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-100 px-3 py-1 text-sm font-semibold text-success-700 ring-1 ring-inset ring-success-200">
                <CheckCircle2 className="h-4 w-4" />
                Completed — fully settled
              </span>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div>
          <div className="card p-5">
            <h3 className="mb-4 text-sm font-semibold text-neutral-900">
              Activity
            </h3>
            <VoucherHistory history={voucher.history} />
          </div>
        </div>
      </div>
    </div>
  );
}

function WaitingMsg({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
      <Clock className="h-4 w-4 flex-shrink-0 text-neutral-400" />
      {text}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  to,
}: {
  label: string;
  value: string;
  to?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="mb-0.5 text-xs font-medium text-neutral-500">{label}</p>
      {to ? (
        <Link
          to={to}
          className="truncate text-sm font-medium text-primary-700 hover:underline"
        >
          {value}
        </Link>
      ) : (
        <p className="truncate text-sm font-medium text-neutral-900">{value}</p>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/p2p/invoices"
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to invoices
    </Link>
  );
}
