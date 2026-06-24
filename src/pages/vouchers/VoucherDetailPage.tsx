import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Receipt,
  Send,
} from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import VoucherHistory from "../../components/VoucherHistory";
import VoucherStatusBadge from "../../components/VoucherStatusBadge";
import { getVoucherById, sendVoucherToSupplier } from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import PdfActions from "../../components/PdfActions";
import {
  buildVoucherInvoicePdf,
  buildVoucherPaymentPdf,
  buildVoucherPdf,
  voucherInvoicePdfFilename,
  voucherPaymentPdfFilename,
  voucherPdfFilename,
} from "../../utils/pdf/voucherDocPdf";
import { useAuthStore } from "../../store/authStore";
import type { Voucher } from "../../types/voucher";
import { formatCurrency, formatDate } from "../../utils/format";

export default function VoucherDetailPage() {
  const { id = "" } = useParams();
  const voucherId = decodeURIComponent(id);
  const user = useAuthStore((s) => s.user);
  const canAct = user?.role === "finance" || user?.role === "admin";

  const [voucher, setVoucher] = useState<Voucher | null>(() =>
    getVoucherById(voucherId)
  );
  const syncVersion = useVoucherSyncStore((s) => s.version);
  useEffect(() => {
    setVoucher(getVoucherById(voucherId));
  }, [voucherId, syncVersion]);

  if (!voucher) {
    return (
      <div>
        <BackLink />
        <EmptyState
          icon={FileText}
          title="Voucher not found"
          description="It may have been removed."
        />
      </div>
    );
  }

  const hasInvoice = !!voucher.invoice;

  function handleSend() {
    const updated = sendVoucherToSupplier(voucher!.id);
    if (updated) {
      setVoucher({ ...updated });
      toast.success("Voucher sent to supplier.");
    }
  }

  return (
    <div>
      <BackLink />

      <PageHeader
        title={voucher.id}
        description={`Issued to ${voucher.supplier_name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PdfActions
              showView={false}
              docLabel="Voucher PDF"
              filename={voucherPdfFilename(voucher)}
              build={() => buildVoucherPdf(voucher!)}
            />
            {hasInvoice && (
              <PdfActions
                showView={false}
                docLabel="Invoice PDF"
                filename={voucherInvoicePdfFilename(voucher)}
                build={() => buildVoucherInvoicePdf(voucher!)}
              />
            )}
            {voucher.payment && (
              <PdfActions
                showView={false}
                docLabel="Payment PDF"
                filename={voucherPaymentPdfFilename(voucher)}
                build={() => buildVoucherPaymentPdf(voucher!)}
              />
            )}
            {!canAct && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-500 ring-1 ring-inset ring-neutral-200">
                <Eye className="h-3.5 w-3.5" />
                Read Only
              </span>
            )}
            <VoucherStatusBadge status={voucher.status} />
          </div>
        }
      />

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Supplier" value={voucher.supplier_name} />
        <SummaryTile
          label="Voucher Amount"
          value={formatCurrency(voucher.amount)}
        />
        <SummaryTile
          label="PO Reference"
          value={voucher.po_reference || "—"}
        />
        <SummaryTile
          label="Created"
          value={`${formatDate(voucher.created_at)} · ${voucher.created_by}`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Items */}
          <div className="card overflow-hidden">
            <div className="border-b border-neutral-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-neutral-900">
                Line Items
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {voucher.items.map((it) => (
                    <tr key={it.item_code}>
                      <td className="px-4 py-2 font-medium text-neutral-900">
                        {it.item_name}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {it.qty} {it.uom}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatCurrency(it.rate)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatCurrency(it.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-neutral-50">
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-2 text-right text-xs font-semibold uppercase text-neutral-600"
                    >
                      Total
                    </td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums">
                      {formatCurrency(voucher.amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Supplier invoice */}
          {voucher.invoice && (
            <div className="card">
              <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
                <Receipt className="h-4 w-4 text-orange-500" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Supplier Invoice — {voucher.invoice.invoice_number}
                </h3>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryTile
                  label="Subtotal"
                  value={formatCurrency(voucher.invoice.subtotal)}
                />
                <SummaryTile
                  label={`Tax (${voucher.invoice.tax_rate}%)`}
                  value={formatCurrency(voucher.invoice.tax_amount)}
                />
                <SummaryTile
                  label="Invoice Total"
                  value={formatCurrency(voucher.invoice.total)}
                />
                <SummaryTile
                  label="Payment Terms"
                  value={voucher.invoice.payment_terms}
                />
                <SummaryTile
                  label="Due Date"
                  value={
                    voucher.invoice.due_date
                      ? formatDate(voucher.invoice.due_date)
                      : "—"
                  }
                />
              </div>
              {voucher.invoice.notes && (
                <p className="px-5 pb-5 text-sm text-neutral-600">
                  {voucher.invoice.notes}
                </p>
              )}
            </div>
          )}

          {/* Payment confirmation */}
          {voucher.payment && (
            <div className="card border-l-4 border-l-teal-500">
              <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
                <CheckCircle2 className="h-4 w-4 text-teal-600" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Payment Confirmed
                </h3>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryTile
                  label="Amount Paid"
                  value={formatCurrency(voucher.payment.amount)}
                />
                <SummaryTile
                  label="Method"
                  value={voucher.payment.payment_method}
                />
                <SummaryTile
                  label="Reference"
                  value={voucher.payment.reference_number}
                />
                <SummaryTile
                  label="Confirmed By"
                  value={voucher.payment.confirmed_by}
                />
                <SummaryTile
                  label="Confirmed On"
                  value={formatDate(voucher.payment.confirmed_at)}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">
              Actions
            </h3>
            {voucher.status === "draft" && canAct && (
              <button
                type="button"
                onClick={handleSend}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
              >
                <Send className="h-4 w-4" />
                Send to Supplier
              </button>
            )}

            {(voucher.status === "sent" || voucher.status === "viewed") && (
              <WaitingMsg text="Waiting for the supplier to review and create an invoice." />
            )}

            {/* Once an invoice exists, review & payment happen on the Invoice page */}
            {hasInvoice &&
              (voucher.status === "invoice_raised" ||
                voucher.status === "under_review" ||
                voucher.status === "invoice_approved" ||
                voucher.status === "invoice_rejected") && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                  <p className="text-sm text-neutral-600">
                    {voucher.status === "invoice_raised"
                      ? "An invoice has been submitted — review it to approve or reject."
                      : voucher.status === "invoice_approved"
                      ? "Invoice approved — release payment from the invoice."
                      : voucher.status === "invoice_rejected"
                      ? "Invoice rejected — waiting for the supplier to re-submit."
                      : "Invoice is under review."}
                  </p>
                  <Link
                    to={`/p2p/invoices/${encodeURIComponent(voucher.id)}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
                  >
                    {canAct ? "Review Invoice" : "View Invoice"}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}

            {voucher.status === "payment_confirmed" && (
              <WaitingMsg text="Payment released. Waiting for the supplier to acknowledge receipt." />
            )}

            {voucher.status === "payment_received" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-100 px-3 py-1 text-sm font-semibold text-success-700 ring-1 ring-inset ring-success-200">
                <CheckCircle2 className="h-4 w-4" />
                Completed — fully settled
              </span>
            )}

            {!canAct && voucher.status === "draft" && (
              <WaitingMsg text="This voucher is awaiting action by the Finance team." />
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

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="mb-0.5 text-xs font-medium text-neutral-500">{label}</p>
      <p className="truncate text-sm font-medium text-neutral-900">{value}</p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/p2p/vouchers"
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to vouchers
    </Link>
  );
}
