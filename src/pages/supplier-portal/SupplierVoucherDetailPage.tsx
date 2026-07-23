import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, CheckCircle2, FileText, Receipt, Wallet } from "lucide-react";
import type { AxiosError } from "axios";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import VoucherHistory from "../../components/VoucherHistory";
import VoucherStatusBadge from "../../components/VoucherStatusBadge";
import {
  getVoucherForSupplier,
  markVoucherViewed,
  PAYMENT_STATUS_TONE,
  paymentStatus,
  SupplierVoucherAccessError,
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
import { toERPDate, toERPDateTime } from "../../utils/erpDate";
import { useSupplierSession } from "../../hooks/useSupplierSession";

function invoiceCreateErrorMessage(err: unknown): string {
  const ax = err as AxiosError<{ message?: string; error?: string }> & {
    status?: number;
  };
  const status = ax.response?.status ?? ax.status;
  const serverMsg =
    (typeof ax.response?.data?.message === "string" && ax.response.data.message) ||
    (typeof ax.response?.data?.error === "string" && ax.response.data.error) ||
    (err instanceof Error ? err.message : "");

  switch (status) {
    case 401:
      return (
        serverMsg ||
        "Not authenticated. Please sign in again to the Supplier Portal, then retry Create Invoice."
      );
    case 400:
      return serverMsg || "Invalid invoice data. Please check the form and try again.";
    case 403:
      return (
        serverMsg ||
        "You do not have permission to create an invoice for this voucher."
      );
    case 404:
      return serverMsg || "Voucher not found. It may have been removed.";
    case 409:
      return (
        serverMsg ||
        "An invoice already exists for this voucher. Refresh the page to view it."
      );
    case 500:
      return (
        serverMsg ||
        "Server error while creating the invoice. Please try again shortly."
      );
    default:
      return (
        serverMsg ||
        "Could not create the invoice. Please try again."
      );
  }
}

const TAX_RATES = [0, 4, 5, 6, 7, 8, 8.25, 9, 10, 12, 15] as const;
const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 45", "Net 60", "Net 90"] as const;

export default function SupplierVoucherDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { supplierName, erpSupplierName, isReady } = useSupplierSession();
  const { id = "" } = useParams();
  const voucherId = decodeURIComponent(id);
  const supplierIdentity = {
    erpSupplierId: erpSupplierName || supplierName,
    displayName: supplierName || undefined,
  };

  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{
    status: number;
    message: string;
  } | null>(null);

  // Invoice form state
  const [taxRate, setTaxRate] = useState<number>(0);
  const [extraCharges, setExtraCharges] = useState<string>("");
  const [paymentTerms, setPaymentTerms] = useState<string>("Net 30");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Load + mark viewed once the session is ready. Validate ownership first so
  // a supplier can only open vouchers addressed to their own company.
  const syncVersion = useVoucherSyncStore((s) => s.version);
  useEffect(() => {
    if (!isReady) return;
    if (!voucherId) {
      setLoading(false);
      setLoadError({ status: 404, message: "Voucher not found." });
      setVoucher(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const owned = await getVoucherForSupplier(voucherId, supplierIdentity);
        if (cancelled) return;
        if (!owned) {
          setVoucher(null);
          setLoadError({ status: 404, message: "Voucher not found." });
          return;
        }
        // Never block viewing if "mark viewed" fails (permissions / network).
        let next = owned;
        try {
          next = (await markVoucherViewed(owned.id)) ?? owned;
        } catch (viewErr) {
          // eslint-disable-next-line no-console
          console.warn(
            "[SupplierVoucherDetail] markVoucherViewed skipped:",
            viewErr,
          );
        }
        if (!cancelled) {
          setVoucher({ ...next });
          setLoadError(null);
        }
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("[SupplierVoucherDetail] load failed:", err);
        setVoucher(null);
        if (err instanceof SupplierVoucherAccessError) {
          setLoadError({ status: err.status, message: err.message });
        } else {
          setLoadError({
            status: 500,
            message:
              err instanceof Error
                ? err.message
                : "Unable to load this voucher.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // supplierIdentity fields are primitives — expand for stable deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady,
    voucherId,
    supplierIdentity.erpSupplierId,
    supplierIdentity.displayName,
    syncVersion,
  ]);

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

  if (!isReady || loading) {
    return (
      
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      
    );
  }

  if (!voucher || loadError) {
    const forbidden = loadError?.status === 403;
    return (
      
        <BackLink />
        <EmptyState
          icon={FileText}
          title={forbidden ? "Access denied" : "Voucher not found"}
          description={
            loadError?.message ||
            (forbidden
              ? "This voucher is not addressed to your company."
              : "This voucher may not exist or is not addressed to your company.")
          }
        />
      
    );
  }

  const canRaiseInvoice =
    !!voucher &&
    (voucher.status === "sent" ||
      voucher.status === "viewed" ||
      voucher.status === "invoice_rejected");

  function validateInvoiceForm(): string | null {
    if (!voucher?.id) return "Voucher is not loaded yet.";
    if (!canRaiseInvoice) {
      return "This voucher is not open for invoice creation.";
    }
    if (!invoiceNumber.trim()) return "Invoice number is required.";
    if (!paymentTerms.trim()) return "Payment terms are required.";
    if (!dueDate.trim()) return "Due date is required.";
    if (Number.isNaN(Date.parse(dueDate))) {
      return "Due date is invalid.";
    }
    if (!(total > 0)) return "Invoice total must be greater than zero.";
    if (charges < 0) return "Additional charges cannot be negative.";
    return null;
  }

  async function handleRaiseInvoice(e?: FormEvent | MouseEvent) {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    if (submitting) return;

    const validationError = validateInvoiceForm();
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }

    setFormError(null);
    setSubmitting(true);

    const payload = {
      invoice_number: invoiceNumber.trim(),
      raised_at: toERPDateTime(new Date()),
      subtotal: subtotal + charges,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      payment_terms: paymentTerms.trim(),
      due_date: toERPDate(dueDate, "due_date"),
      notes: notes.trim(),
    };

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info("[Create Invoice] submitting", {
        voucher_id: voucher!.id,
        payload,
      });
    }

    try {
      const updated = await supplierRaiseInvoice(voucher!.id, payload);
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.info("[Create Invoice] success", {
          voucher_id: updated.id,
          status: updated.status,
          invoice_number: updated.invoice?.invoice_number,
        });
      }

      setVoucher({ ...updated });
      useVoucherSyncStore.getState().bump();
      void queryClient.invalidateQueries({ queryKey: ["supplier-invoices"] });
      void queryClient.invalidateQueries({
        queryKey: ["supplier-pending-vouchers"],
      });
      void queryClient.invalidateQueries({ queryKey: ["supplier-vouchers"] });

      toast.success(
        `Invoice ${updated.invoice?.invoice_number || invoiceNumber} created. Awaiting review from Netlink Finance.`,
      );

      // Supplier invoice lives on the voucher; invoices list is the post-create view.
      navigate("/supplier/invoices", { replace: false });
    } catch (err) {
      const message = invoiceCreateErrorMessage(err);
      setFormError(message);
      toast.error(message);
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error("[Create Invoice] failed", err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmReceipt() {
    const updated = await supplierConfirmPaymentReceived(voucher!.id);
    if (updated) {
      setVoucher({ ...updated });
      toast.success("Payment receipt confirmed. Thank you!");
    }
  }

  return (
    
      <BackLink />
      <PageHeader
        title="Voucher"
        description={`${voucher.id} · PO ${voucher.po_reference || "—"}`}
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
                  {(voucher.items ?? []).map((it) => (
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
                    PAYMENT_STATUS_TONE[paymentStatus(voucher)] ??
                      "bg-neutral-100 text-neutral-700 ring-neutral-200"
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
              <form
                onSubmit={(e) => {
                  void handleRaiseInvoice(e);
                }}
                noValidate
              >
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
                      disabled={submitting}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
                    />
                  </Field>
                  <Field label="State / Sales Tax">
                    <select
                      value={taxRate}
                      onChange={(e) => setTaxRate(Number(e.target.value))}
                      disabled={submitting}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
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
                      disabled={submitting}
                      required
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
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
                      onChange={(e) => {
                        setDueDate(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      disabled={submitting}
                      required
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
                    />
                  </Field>
                  <div className="md:col-span-2">
                    <Field label="Notes">
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        disabled={submitting}
                        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
                      />
                    </Field>
                  </div>
                </div>

                {formError ? (
                  <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
                    {formError}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-5 py-4">
                  <div className="text-sm text-neutral-600">
                    Tax: {formatCurrency(taxAmount)} ·{" "}
                    <span className="font-semibold text-neutral-900">
                      Total: {formatCurrency(total)}
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    aria-busy={submitting}
                    className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? "Creating Invoice…" : "Create Invoice"}
                  </button>
                </div>
              </form>
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
