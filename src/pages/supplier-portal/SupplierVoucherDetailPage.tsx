import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, CheckCircle2, FileText, Receipt, Wallet } from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import VoucherHistory from "../../components/VoucherHistory";
import VoucherStatusBadge from "../../components/VoucherStatusBadge";
import {
  getVoucherForSupplier,
  markVoucherViewed,
  PAYMENT_STATUS_TONE,
  paymentStatus,
  supplierConfirmPaymentReceived,
  supplierRaiseInvoice,
  supplierVoucherStatusLabel,
} from "../../api/vouchers";
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
import type { Voucher } from "../../types/voucher";
import { formatCurrency, formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

const TAX_RATES = [0, 4, 5, 6, 7, 8, 8.25, 9, 10, 12, 15] as const;
const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 45", "Net 60", "Net 90"] as const;

export default function SupplierVoucherDetailPage() {
  const { supplierName, isReady } = useSupplierSession();
  const { id = "" } = useParams();
  const voucherId = decodeURIComponent(id);

  const [voucher, setVoucher] = useState<Voucher | null>(null);

  // Invoice form state
  const [taxRate, setTaxRate] = useState<number>(0);
  const [extraCharges, setExtraCharges] = useState<string>("");
  const [paymentTerms, setPaymentTerms] = useState<string>("Net 30");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Load + mark viewed once the session is ready. Validate ownership first so
  // a supplier can only open vouchers addressed to their own company.
  const syncVersion = useVoucherSyncStore((s) => s.version);
  useEffect(() => {
    if (!isReady) return;
    const owned = getVoucherForSupplier(voucherId, supplierName);
    if (!owned) {
      setVoucher(null);
      return;
    }
    const v = markVoucherViewed(voucherId) ?? owned;
    setVoucher({ ...v });
  }, [isReady, voucherId, supplierName, syncVersion]);

  const subtotal = voucher?.amount ?? 0;
  const charges = Number(extraCharges) || 0;
  const taxableBase = subtotal + charges;
  const taxAmount = useMemo(
    () => +(taxableBase * (taxRate / 100)).toFixed(2),
    [taxableBase, taxRate]
  );
  const total = +(taxableBase + taxAmount).toFixed(2);

  const invoiceNumber = useMemo(() => {
    const slug = (supplierName || "SUP")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 6)
      .toUpperCase();
    return `INV-${slug}-${String(Date.now()).slice(-4)}`;
  }, [supplierName]);

  if (!isReady) {
    return (
      <SupplierPortalLayout>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      </SupplierPortalLayout>
    );
  }

  if (!voucher) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackLink />
        <EmptyState
          icon={FileText}
          title="Voucher not found"
          description="This voucher may not be addressed to your company."
        />
      </SupplierPortalLayout>
    );
  }

  function handleRaiseInvoice() {
    setSubmitting(true);
    try {
      const updated = supplierRaiseInvoice(voucher!.id, {
        invoice_number: invoiceNumber,
        raised_at: new Date().toISOString(),
        subtotal: subtotal + charges,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total,
        payment_terms: paymentTerms,
        due_date: dueDate,
        notes,
      });
      if (updated) {
        setVoucher({ ...updated });
        toast.success("Invoice created. Awaiting review from Netlink Finance.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleConfirmReceipt() {
    const updated = supplierConfirmPaymentReceived(voucher!.id);
    if (updated) {
      setVoucher({ ...updated });
      toast.success("Payment receipt confirmed. Thank you!");
    }
  }

  const canRaiseInvoice =
    voucher.status === "sent" ||
    voucher.status === "viewed" ||
    voucher.status === "invoice_rejected";

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <BackLink />
      <PageHeader
        title={voucher.id}
        description={`Voucher from Netlink · PO ${voucher.po_reference || "—"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PdfActions
              showView={false}
              docLabel="Voucher PDF"
              filename={voucherPdfFilename(voucher)}
              build={() => buildVoucherPdf(voucher!)}
            />
            {voucher.invoice && (
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
            <VoucherStatusBadge
              status={voucher.status}
              label={supplierVoucherStatusLabel(voucher.status)}
            />
          </div>
        }
      />

      {/* Voucher summary */}
      <section className="mb-6 grid gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <SummaryField label="Voucher Number" value={voucher.id} />
        <SummaryField
          label="PO Reference"
          value={voucher.po_reference || "—"}
        />
        <SummaryField
          label="Amount"
          value={
            <span className="font-semibold text-neutral-900">
              {formatCurrency(voucher.amount)}
            </span>
          }
        />
        <SummaryField
          label="Created Date"
          value={formatDate(voucher.created_at)}
        />
        {voucher.grn_reference && (
          <SummaryField label="Linked GRN" value={voucher.grn_reference} />
        )}
        {voucher.payment_terms && (
          <SummaryField label="Payment Terms" value={voucher.payment_terms} />
        )}
        {voucher.due_date && (
          <SummaryField
            label="Due Date"
            value={formatDate(voucher.due_date)}
          />
        )}
        {voucher.notes && (
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="mb-1 text-xs font-medium text-neutral-500">
              Finance Notes
            </p>
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
              {voucher.notes}
            </p>
          </div>
        )}
      </section>

      {/* Payment confirmed banner */}
      {voucher.status === "payment_confirmed" && voucher.payment && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success-200 bg-success-50 px-5 py-4">
          <div className="flex items-center gap-2 text-sm text-success-800">
            <CheckCircle2 className="h-5 w-5 text-success-600" />
            <span>
              Payment of{" "}
              <strong>{formatCurrency(voucher.payment.amount)}</strong> received
              — Ref: <strong>{voucher.payment.reference_number}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={handleConfirmReceipt}
            className="rounded-lg bg-success-600 px-4 py-2 text-sm font-semibold text-white hover:bg-success-700"
          >
            Confirm Receipt
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Items */}
          <section className="card overflow-hidden">
            <div className="border-b border-neutral-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-neutral-900">
                Voucher Items
              </h2>
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
              </table>
            </div>
          </section>

          {/* Payment Summary — visible once an invoice exists (read-only) */}
          {voucher.invoice && (
            <section
              className={`card border-l-4 ${
                voucher.payment ? "border-l-success-500" : "border-l-neutral-300"
              }`}
            >
              <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-teal-600" />
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Payment Summary
                  </h2>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                    PAYMENT_STATUS_TONE[paymentStatus(voucher)]
                  }`}
                >
                  {paymentStatus(voucher)}
                </span>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryField
                  label="Invoice Status"
                  value={supplierVoucherStatusLabel(voucher.status)}
                />
                <SummaryField
                  label="Payment Status"
                  value={paymentStatus(voucher)}
                />
                <SummaryField
                  label="Payment Method"
                  value={voucher.payment?.payment_method ?? "—"}
                />
                <SummaryField
                  label="Payment Date"
                  value={
                    voucher.payment
                      ? formatDate(voucher.payment.confirmed_at)
                      : "—"
                  }
                />
                <SummaryField
                  label="Payment Reference"
                  value={voucher.payment?.reference_number ?? "—"}
                />
                <SummaryField
                  label="Amount Paid"
                  value={
                    voucher.payment
                      ? formatCurrency(voucher.payment.amount)
                      : "—"
                  }
                />
              </div>
            </section>
          )}

          {/* Rejection notice — supplier may re-create the invoice */}
          {voucher.status === "invoice_rejected" &&
            voucher.invoice?.rejection_reason && (
              <section className="card border-l-4 border-l-red-400">
                <div className="px-5 py-4">
                  <p className="text-sm font-semibold text-red-700">
                    Invoice {voucher.invoice.invoice_number} was rejected by
                    Netlink Finance
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">
                    {voucher.invoice.rejection_reason}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400">
                    Please review the reason and create a corrected invoice
                    below.
                  </p>
                </div>
              </section>
            )}

          {/* Create invoice */}
          {canRaiseInvoice && (
            <section className="card">
              <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
                <Receipt className="h-4 w-4 text-orange-500" />
                <h2 className="text-sm font-semibold text-neutral-900">
                  {voucher.status === "invoice_rejected"
                    ? "Re-create Invoice"
                    : "Create Invoice"}
                </h2>
              </div>
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <Field label="Invoice Number">
                  <input
                    value={invoiceNumber}
                    readOnly
                    className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
                  />
                </Field>
                <Field label="Subtotal (from voucher)">
                  <input
                    value={formatCurrency(subtotal)}
                    readOnly
                    className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
                  />
                </Field>
                <Field label="Additional Charges (USD)">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={extraCharges}
                    onChange={(e) => setExtraCharges(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="State / Sales Tax">
                  <select
                    value={taxRate}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  >
                    {TAX_RATES.map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Payment Terms">
                  <select
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  >
                    {PAYMENT_TERMS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Due Date">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Notes">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </Field>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-5 py-4">
                <div className="text-sm text-neutral-600">
                  Tax: {formatCurrency(taxAmount)} ·{" "}
                  <span className="font-semibold text-neutral-900">
                    Total: {formatCurrency(total)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRaiseInvoice}
                  disabled={submitting}
                  className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-60"
                >
                  Create Invoice
                </button>
              </div>
            </section>
          )}

          {voucher.status === "invoice_raised" && voucher.invoice && (
            <section className="card border-l-4 border-l-orange-400">
              <div className="px-5 py-4">
                <p className="text-sm font-semibold text-neutral-900">
                  Invoice {voucher.invoice.invoice_number} submitted —{" "}
                  {formatCurrency(voucher.invoice.total)}
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  Awaiting review from Netlink Finance.
                </p>
              </div>
            </section>
          )}

          {voucher.status === "invoice_approved" && voucher.invoice && (
            <section className="card border-l-4 border-l-teal-400">
              <div className="px-5 py-4">
                <p className="text-sm font-semibold text-neutral-900">
                  Invoice {voucher.invoice.invoice_number} approved —{" "}
                  {formatCurrency(voucher.invoice.total)}
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  Netlink Finance has approved your invoice. Payment will be
                  released shortly.
                </p>
              </div>
            </section>
          )}

          {voucher.status === "payment_received" && (
            <section className="card border-l-4 border-l-success-500">
              <div className="flex items-center gap-2 px-5 py-4 text-sm font-semibold text-success-700">
                <CheckCircle2 className="h-5 w-5" />
                Payment received and confirmed. This voucher is fully settled.
              </div>
            </section>
          )}
        </div>

        {/* Timeline */}
        <div>
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-neutral-900">
              Activity
            </h2>
            <VoucherHistory history={voucher.history} />
          </div>
        </div>
      </div>
    </SupplierPortalLayout>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-neutral-700">
        {label}
      </label>
      {children}
    </div>
  );
}

function SummaryField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium text-neutral-500">{label}</p>
      <p className="text-sm text-neutral-900">{value}</p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/supplier/vouchers"
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to vouchers
    </Link>
  );
}
