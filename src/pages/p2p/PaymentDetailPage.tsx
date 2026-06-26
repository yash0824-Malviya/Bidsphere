import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Banknote,
  Building2,
  Calendar,
  CreditCard,
  Download,
  FileText,
  Hash,
  Loader2,
  Printer,
  Receipt,
  Send,
} from "lucide-react";

import {
  getModesOfPayment,
  getPaymentEntry,
  submitPaymentEntry,
  updatePaymentEntry,
} from "../../api/accounts";
import { invalidateFinanceDashboardMetrics } from "../../api/financeWorkflow";
import PaymentAttachments, {
  type PaymentAttachment,
} from "../../components/payments/PaymentAttachments";
import {
  createPaymentAttachment,
  revokePaymentAttachmentUrl,
} from "../../utils/paymentAttachmentUtils";
import PaymentMethodFields from "../../components/payments/PaymentMethodFields";
import PaymentSummaryPanel from "../../components/payments/PaymentSummaryPanel";
import PaymentTraceability from "../../components/payments/PaymentTraceability";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { ErpNextDatePicker } from "../../components/ui";
import { formatCurrency } from "../../utils/format";
import { formatUsDisplayDate } from "../../utils/erpNextDate";
import {
  mapPaymentUiStatus,
  paymentAmount,
  paymentCurrency,
} from "../../utils/paymentUtils";
import {
  buildPaymentRemarks,
  emptyDetailsForMethod,
  getFieldsForPaymentMethod,
  getPaymentModeDescription,
  getPaymentModeLabel,
  normalizePaymentMethod,
  parsePaymentMeta,
  validatePaymentMethodDetails,
  type PaymentMethodDetails,
} from "../../utils/usPaymentMethods";
import {
  downloadPaymentReceiptPdf,
  printPaymentReceiptPdf,
} from "../../utils/pdf";

export default function PaymentDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const name = decodeURIComponent(id);

  const {
    data: payment,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["payment-entry", name],
    queryFn: () => getPaymentEntry(name),
    enabled: !!name,
    staleTime: 0,
  });

  const { data: paymentModes = [] } = useQuery({
    queryKey: ["modes-of-payment"],
    queryFn: getModesOfPayment,
    staleTime: 5 * 60_000,
  });

  const parsedMeta = useMemo(
    () => parsePaymentMeta(payment?.remarks, paymentModes),
    [payment?.remarks, paymentModes]
  );

  const [postingDate, setPostingDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("ACH Transfer");
  const [methodDetails, setMethodDetails] = useState<PaymentMethodDetails>(
    () => emptyDetailsForMethod("ACH Transfer")
  );
  const [paymentReference, setPaymentReference] = useState("");
  const [attachments, setAttachments] = useState<PaymentAttachment[]>([]);

  useEffect(() => {
    if (!payment) return;
    const method = normalizePaymentMethod(
      parsedMeta?.method ?? payment.mode_of_payment,
      paymentModes
    );
    setPostingDate(payment.posting_date ?? "");
    setPaymentMethod(method);
    setMethodDetails(
      parsedMeta?.details ?? emptyDetailsForMethod(method)
    );
    setPaymentReference(payment.reference_no ?? "");
    setAttachments(
      (parsedMeta?.attachments ?? []).map((label, i) => {
        const [kind, fileName] = label.split(":");
        const ext = (fileName ?? "").split(".").pop()?.toLowerCase();
        const mimeType =
          ext === "pdf"
            ? "application/pdf"
            : ext === "png"
              ? "image/png"
              : "image/jpeg";
        return {
          id: `stored-${i}`,
          kind:
            (kind as PaymentAttachment["kind"]) ?? "payment_confirmation",
          fileName: fileName ?? label,
          size: 0,
          mimeType,
          uploadedAt: payment.modified ?? payment.creation ?? "",
        };
      })
    );
  }, [payment, parsedMeta, paymentModes]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const methodErr = validatePaymentMethodDetails(
        paymentMethod,
        methodDetails
      );
      if (methodErr) throw new Error(methodErr);
      if (
        paymentModes.length > 0 &&
        !paymentModes.includes(paymentMethod)
      ) {
        throw new Error(
          "Selected payment method is not currently available."
        );
      }

      const remarks = buildPaymentRemarks({
        v: 1,
        method: paymentMethod,
        details: methodDetails,
        attachments: attachments.map((a) => `${a.kind}:${a.fileName}`),
        uiStatus: "Pending",
      });

      await updatePaymentEntry(name, {
        posting_date: postingDate,
        mode_of_payment: paymentMethod,
        reference_no: paymentReference,
        reference_date: postingDate,
        remarks,
      });
      return submitPaymentEntry(name);
    },
    onSuccess: (entry) => {
      toast.success(`Payment ${entry.name} submitted successfully.`);
      queryClient.invalidateQueries({ queryKey: ["payment-entry", name] });
      queryClient.invalidateQueries({ queryKey: ["payment-entries"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payable-invoices"] });
      invalidateFinanceDashboardMetrics(queryClient);
      for (const ref of entry.references ?? []) {
        if (
          ref.reference_doctype === "Purchase Invoice" &&
          ref.reference_name
        ) {
          queryClient.invalidateQueries({
            queryKey: ["purchase-invoice", ref.reference_name],
          });
        }
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not submit payment.");
    },
  });

  if (isLoading) {
    return (
      <div>
        <BackLink />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError || !payment) {
    return (
      <div>
        <BackLink />
        <EmptyState
          icon={CreditCard}
          title="Payment not found"
          description={`Could not load Payment Entry "${name}". It may have been deleted or you may not have access.`}
        />
      </div>
    );
  }

  const docstatus = payment.docstatus ?? 0;
  const isDraft = docstatus === 0;
  const isSubmitted = docstatus === 1;
  const isCancelled = docstatus === 2;
  const displayStatus = mapPaymentUiStatus(payment);
  const currency = paymentCurrency(payment);
  const amount = paymentAmount(payment);

  const references = (payment.references ?? []) as Array<{
    reference_doctype?: string;
    reference_name?: string;
    allocated_amount?: number;
    total_amount?: number;
    outstanding_amount?: number;
  }>;

  const primaryRef = references[0];
  const invoiceTotal = primaryRef?.total_amount ?? 0;
  const allocated = primaryRef?.allocated_amount ?? amount;
  const remaining = Math.max(
    0,
    (primaryRef?.outstanding_amount ?? 0) - allocated
  );

  return (
    <div>
      <BackLink />

      <PageHeader
        title={payment.name ?? name}
        description={
          isDraft
            ? "Draft payment — review and submit to post to the ledger"
            : isCancelled
              ? "Voided payment — read only"
              : "Submitted payment — read only"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PdfButton
              icon={Download}
              label="Download Receipt"
              onClick={() => downloadPaymentReceiptPdf(payment)}
            />
            <PdfButton
              icon={Printer}
              label="Print"
              onClick={() => printPaymentReceiptPdf(payment)}
            />
            <StatusBadge status={displayStatus} />
            {isDraft && (
              <button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-600 disabled:opacity-60"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit Payment
              </button>
            )}
          </div>
        }
      />

      {isDraft && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-warning-300 bg-warning-50 p-4 shadow-sm">
          <Send className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning-600" />
          <div className="flex-1 text-sm text-warning-800">
            <p className="font-semibold text-warning-900">Draft payment</p>
            <p className="mt-0.5 text-xs">
              This payment is not yet posted. Update payment details below, then
              submit to update invoice balances.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-4 card p-5 shadow-sm sm:grid-cols-2">
            <DetailField
              icon={Building2}
              label="Supplier"
              value={payment.party_name ?? payment.party ?? "—"}
            />
            <DetailField
              icon={Banknote}
              label={`Amount Paid (${currency})`}
              value={formatCurrency(amount)}
              valueClass="text-lg font-semibold text-neutral-900"
            />
            {payment.paid_to && (
              <DetailField icon={Receipt} label="Paid To" value={payment.paid_to} />
            )}
            {payment.owner && (
              <DetailField
                icon={FileText}
                label="Authorized By"
                value={payment.owner}
              />
            )}
          </div>

          <section className="card p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-neutral-900">
              Payment Details
            </h3>
            {isDraft ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                      Payment Date
                    </label>
                    <ErpNextDatePicker
                      value={postingDate}
                      onChange={setPostingDate}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                      Payment Method
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => {
                        const method = e.target.value;
                        setPaymentMethod(method);
                        setMethodDetails(emptyDetailsForMethod(method));
                      }}
                      className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                    >
                      {paymentModes.map((m) => {
                        const desc = getPaymentModeDescription(m);
                        const label = getPaymentModeLabel(m);
                        return (
                          <option key={m} value={m}>
                            {desc ? `${label} — ${desc}` : label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                      Payment Reference
                    </label>
                    <input
                      type="text"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm"
                    />
                  </div>
                </div>
                <PaymentMethodFields
                  method={paymentMethod}
                  details={methodDetails}
                  onChange={setMethodDetails}
                />
                <PaymentAttachments
                  attachments={attachments}
                  onAdd={(kind, file) =>
                    setAttachments((prev) => {
                      const existing = prev.find((a) => a.kind === kind);
                      if (existing) revokePaymentAttachmentUrl(existing);
                      return [
                        ...prev.filter((a) => a.kind !== kind),
                        createPaymentAttachment(kind, file),
                      ];
                    })
                  }
                  onReplace={(id, file) =>
                    setAttachments((prev) => {
                      const target = prev.find((a) => a.id === id);
                      if (!target) return prev;
                      revokePaymentAttachmentUrl(target);
                      return prev.map((a) =>
                        a.id === id ? createPaymentAttachment(a.kind, file) : a
                      );
                    })
                  }
                  onRemove={(id) =>
                    setAttachments((prev) => {
                      const target = prev.find((a) => a.id === id);
                      if (target) revokePaymentAttachmentUrl(target);
                      return prev.filter((a) => a.id !== id);
                    })
                  }
                />
              </div>
            ) : (
              <ReadOnlyMethodDetails
                method={paymentMethod}
                details={methodDetails}
                paymentReference={payment.reference_no}
                postingDate={payment.posting_date}
              />
            )}
          </section>

          <PaymentTraceability payment={payment} />

          {references.length > 0 && (
            <div className="card">
              <div className="border-b border-neutral-200 px-5 py-3.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
                  <FileText className="h-4 w-4 text-neutral-400" />
                  Linked Invoices
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-200 text-sm">
                  <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-5 py-3">Document</th>
                      <th className="px-5 py-3 text-right">Invoice Total</th>
                      <th className="px-5 py-3 text-right">Allocated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {references.map((ref, idx) => (
                      <tr key={idx} className="hover:bg-neutral-50">
                        <td className="px-5 py-3 font-medium text-neutral-900">
                          {ref.reference_doctype === "Purchase Invoice" &&
                          ref.reference_name ? (
                            <Link
                              to={`/p2p/invoices/${encodeURIComponent(ref.reference_name)}`}
                              className="text-primary-700 hover:underline"
                            >
                              {ref.reference_name}
                            </Link>
                          ) : (
                            ref.reference_name ?? "—"
                          )}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatCurrency(ref.total_amount)}
                        </td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums">
                          {formatCurrency(ref.allocated_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div>
          <PaymentSummaryPanel
            invoiceName={primaryRef?.reference_name}
            supplierName={payment.party_name ?? payment.party}
            invoiceAmount={invoiceTotal}
            amountPaid={allocated}
            remainingBalance={remaining}
            currency={currency}
            paymentMethod={paymentMethod}
            paymentReference={payment.reference_no ?? ""}
            paymentDate={payment.posting_date ?? ""}
            status={submitMutation.isPending ? "Processing" : displayStatus}
          />
        </div>
      </div>

      {isSubmitted && (
        <p className="mt-4 text-xs text-neutral-500">
          This payment has been submitted and can no longer be edited.
        </p>
      )}
      {isCancelled && (
        <p className="mt-4 text-xs text-neutral-500">
          This payment has been voided and is read-only.
        </p>
      )}
    </div>
  );
}

function ReadOnlyMethodDetails({
  method,
  details,
  paymentReference,
  postingDate,
}: {
  method: string;
  details: PaymentMethodDetails;
  paymentReference?: string;
  postingDate?: string;
}) {
  const fields = getFieldsForPaymentMethod(method);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DetailField
        icon={CreditCard}
        label="Payment Method"
        value={getPaymentModeLabel(method)}
      />
      <DetailField
        icon={Calendar}
        label="Payment Date"
        value={formatUsDisplayDate(postingDate) || "—"}
      />
      <DetailField
        icon={Hash}
        label="Payment Reference"
        value={paymentReference ?? "—"}
      />
      {fields.map((field) => {
        const val = details[field.key]?.trim();
        if (!val) return null;
        return (
          <DetailField
            key={field.key}
            icon={FileText}
            label={field.label}
            value={field.type === "date" ? formatUsDisplayDate(val) || "—" : val}
          />
        );
      })}
    </div>
  );
}

function PdfButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function BackLink() {
  return (
    <Link
      to="/p2p/payments"
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" /> Back to Payments
    </Link>
  );
}

interface DetailFieldProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  valueClass?: string;
}

function DetailField({ icon: Icon, label, value, valueClass }: DetailFieldProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
      <div className="min-w-0">
        <p className="text-xs text-neutral-500">{label}</p>
        <p
          className={`mt-0.5 truncate text-sm ${
            valueClass ?? "font-medium text-neutral-800"
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
