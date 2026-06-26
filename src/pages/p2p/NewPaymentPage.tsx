import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Building2, Loader2, ShieldCheck } from "lucide-react";

import {
  createPaymentEntry,
  getCompanyCurrency,
  getExchangeRate,
  getModesOfPayment,
  getPayableInvoices,
  getPaymentEntries,
  getPaymentFromAccounts,
  getPurchaseInvoice,
  submitPaymentEntry,
} from "../../api/accounts";
import { invalidateFinanceDashboardMetrics } from "../../api/financeWorkflow";
import { COMPANY } from "../../api/erpnext";
import ErrorBoundary from "../../components/ErrorBoundary";
import PaymentAttachments, {
  type PaymentAttachment,
} from "../../components/payments/PaymentAttachments";
import {
  createPaymentAttachment,
  revokePaymentAttachmentUrl,
} from "../../utils/paymentAttachmentUtils";
import PaymentMethodFields from "../../components/payments/PaymentMethodFields";
import PaymentSummaryPanel from "../../components/payments/PaymentSummaryPanel";
import PaymentSuccessModal, {
  type PaymentSuccessDetails,
} from "../../components/payments/PaymentSuccessModal";
import PageHeader from "../../components/PageHeader";
import { ErpNextDatePicker } from "../../components/ui";
import type { PaymentEntry, PurchaseInvoice } from "../../types/erpnext";
import { formatCurrency, todayIso } from "../../utils/format";
import { assertERPNextDate } from "../../utils/erpNextDate";
import { generateId } from "../../utils/id";
import {
  buildPaymentRemarks,
  collectExistingReferences,
  emptyDetailsForMethod,
  generatePaymentReference,
  getPaymentModeDescription,
  getPaymentModeLabel,
  getPaymentReferenceFormatHint,
  mapUsPaymentUiStatus,
  normalizePaymentMethod,
  type PaymentMethodDetails,
  validatePaymentMethodDetails,
} from "../../utils/usPaymentMethods";

type FreshInvoice = PurchaseInvoice & { company?: string };

function NewPaymentPageInner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [invoiceName, setInvoiceName] = useState(
    searchParams.get("invoice") ?? ""
  );
  const [postingDate, setPostingDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState("ACH Transfer");
  const [methodDetails, setMethodDetails] = useState<PaymentMethodDetails>(
    () => emptyDetailsForMethod("ACH Transfer")
  );
  const [paymentReference, setPaymentReference] = useState("");
  const [receivedAmount, setReceivedAmount] = useState(0);
  const [attachments, setAttachments] = useState<PaymentAttachment[]>([]);
  const [referenceLocked, setReferenceLocked] = useState(true);
  const [successDetails, setSuccessDetails] =
    useState<PaymentSuccessDetails | null>(null);

  const { data: invoices = [], isLoading: invoicesLoading } =
    useQuery<PurchaseInvoice[]>({
      queryKey: ["payable-invoices"],
      queryFn: getPayableInvoices,
      staleTime: 0,
      refetchOnWindowFocus: true,
    });

  const { data: paymentModes = [], isLoading: modesLoading } = useQuery({
    queryKey: ["modes-of-payment"],
    queryFn: getModesOfPayment,
    staleTime: 5 * 60_000,
  });

  const { data: existingPayments = [] } = useQuery({
    queryKey: ["payment-entries", "refs"],
    queryFn: () =>
      getPaymentEntries({
        filters: [["payment_type", "=", "Pay"]],
        fields: ["reference_no"],
        limit_page_length: 500,
        order_by: "creation desc",
      }),
    staleTime: 60_000,
  });

  const { data: fromAccounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["payment-from-accounts", COMPANY],
    queryFn: () => getPaymentFromAccounts(COMPANY),
    staleTime: 5 * 60_000,
  });

  const { data: companyCurrency = "USD" } = useQuery({
    queryKey: ["company-currency", COMPANY],
    queryFn: () => getCompanyCurrency(COMPANY),
    staleTime: Infinity,
  });

  const { data: freshInvoice } = useQuery<FreshInvoice>({
    queryKey: ["invoice-fresh", invoiceName],
    queryFn: () => getPurchaseInvoice(invoiceName),
    enabled: !!invoiceName,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const selected = useMemo(
    () => invoices.find((i) => i.name === invoiceName),
    [invoices, invoiceName]
  );

  const paidToCurrency =
    freshInvoice?.payable_currency ??
    selected?.payable_currency ??
    selected?.currency ??
    companyCurrency;

  const paidFromAccount = useMemo(() => {
    if (fromAccounts.length === 0) return null;
    const matching = paidToCurrency
      ? fromAccounts.filter((a) => a.account_currency === paidToCurrency)
      : fromAccounts;
    const pool = matching.length > 0 ? matching : fromAccounts;
    return (
      pool.find((a) => a.account_type === "Bank") ??
      pool.find((a) => a.account_type === "Cash") ??
      pool[0]
    );
  }, [fromAccounts, paidToCurrency]);

  const paidFrom = paidFromAccount?.name ?? "";
  const paidFromCurrency =
    paidFromAccount?.account_currency ?? companyCurrency;

  const { data: sourceRate = 1 } = useQuery({
    queryKey: ["exchange-rate", paidFromCurrency, companyCurrency, postingDate],
    enabled: !!paidFromCurrency && !!companyCurrency,
    staleTime: 5 * 60_000,
    queryFn: () =>
      getExchangeRate(paidFromCurrency, companyCurrency, postingDate),
  });

  const { data: targetRate = 1 } = useQuery({
    queryKey: ["exchange-rate", paidToCurrency, companyCurrency, postingDate],
    enabled: !!paidToCurrency && !!companyCurrency,
    staleTime: 5 * 60_000,
    queryFn: () =>
      getExchangeRate(paidToCurrency, companyCurrency, postingDate),
  });

  const paidAmountInBank =
    sourceRate > 0 ? receivedAmount * (targetRate / sourceRate) : receivedAmount;

  const invoiceTotal = selected?.grand_total ?? 0;
  const outstanding =
    freshInvoice?.outstanding_amount ?? selected?.outstanding_amount ?? 0;
  const remainingAfterPayment = Math.max(0, outstanding - receivedAmount);

  const uiStatus = useMemo(() => {
    const draft: Partial<PaymentEntry> = {
      docstatus: 0,
      posting_date: postingDate,
      references: selected
        ? [
            {
              name: "",
              reference_doctype: "Purchase Invoice",
              reference_name: selected.name,
              total_amount: invoiceTotal,
              outstanding_amount: outstanding,
              allocated_amount: receivedAmount,
            },
          ]
        : [],
    };
    return mapUsPaymentUiStatus(draft as PaymentEntry, todayIso());
  }, [postingDate, selected, invoiceTotal, outstanding, receivedAmount]);

  useEffect(() => {
    if (paymentModes.length === 0) return;
    if (!paymentModes.includes(paymentMethod)) {
      const next = normalizePaymentMethod(paymentMethod, paymentModes);
      setPaymentMethod(next);
      setMethodDetails(emptyDetailsForMethod(next));
    }
  }, [paymentModes, paymentMethod]);

  useEffect(() => {
    const refs = collectExistingReferences(existingPayments);
    const generated = generatePaymentReference(
      paymentMethod,
      refs,
      postingDate
    );
    if (referenceLocked) setPaymentReference(generated);
  }, [paymentMethod, postingDate, existingPayments, referenceLocked]);

  useEffect(() => {
    if (selected) setReceivedAmount(selected.outstanding_amount ?? 0);
  }, [selected]);

  function handleMethodChange(method: string) {
    setPaymentMethod(method);
    setMethodDetails(emptyDetailsForMethod(method));
    setReferenceLocked(true);
  }

  function handleAddAttachment(
    kind: PaymentAttachment["kind"],
    file: File
  ) {
    setAttachments((prev) => {
      const existing = prev.find((a) => a.kind === kind);
      if (existing) revokePaymentAttachmentUrl(existing);
      return [
        ...prev.filter((a) => a.kind !== kind),
        createPaymentAttachment(kind, file),
      ];
    });
  }

  function handleReplaceAttachment(id: string, file: File) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (!target) return prev;
      revokePaymentAttachmentUrl(target);
      return prev.map((a) =>
        a.id === id ? createPaymentAttachment(a.kind, file) : a
      );
    });
  }

  function handleRemoveAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) revokePaymentAttachmentUrl(target);
      return prev.filter((a) => a.id !== id);
    });
  }

  function buildPayload(): Partial<PaymentEntry> {
    if (!selected) throw new Error("Select an invoice first.");
    if (!paidFrom) throw new Error("No payment account available.");

    const backendOutstanding =
      freshInvoice?.outstanding_amount ?? selected.outstanding_amount ?? 0;
    const alloc = Math.min(receivedAmount, backendOutstanding);
    const postingIso = assertERPNextDate(postingDate, "posting_date");

    const remarks = buildPaymentRemarks({
      v: 1,
      method: paymentMethod,
      details: methodDetails,
      attachments: attachments.map((a) => `${a.kind}:${a.fileName}`),
      uiStatus: uiStatus,
    });

    return {
      payment_type: "Pay",
      party_type: "Supplier",
      party: selected.supplier,
      posting_date: postingIso,
      company: COMPANY,
      mode_of_payment: paymentMethod,
      paid_from: paidFrom,
      paid_from_account_currency: paidFromCurrency,
      paid_amount: paidAmountInBank,
      source_exchange_rate: sourceRate,
      paid_to: selected.credit_to,
      paid_to_account_currency: paidToCurrency,
      received_amount: receivedAmount,
      target_exchange_rate: targetRate,
      reference_no: paymentReference.trim(),
      reference_date: postingIso,
      remarks,
      references: [
        {
          name: generateId(),
          reference_doctype: "Purchase Invoice",
          reference_name: selected.name,
          total_amount: selected.grand_total ?? 0,
          outstanding_amount: backendOutstanding,
          allocated_amount: alloc,
        },
      ],
    };
  }

  function validate(): string | null {
    if (!invoiceName) return "Please select an invoice.";
    if (!paidFrom) {
      return `No bank account found for ${paidToCurrency}. Please contact your administrator.`;
    }
    if (receivedAmount <= 0) return "Amount must be greater than zero.";
    if (!paymentReference.trim()) return "Payment reference is required.";

    if (!paymentModes.includes(paymentMethod)) {
      return "Selected payment method is not currently available.";
    }

    const methodErr = validatePaymentMethodDetails(
      paymentMethod,
      methodDetails
    );
    if (methodErr) return methodErr;

    if (!sourceRate || sourceRate <= 0 || !targetRate || targetRate <= 0) {
      return "Exchange rate unavailable. Please retry.";
    }

    if (freshInvoice) {
      if (freshInvoice.company && freshInvoice.company !== COMPANY) {
        return "Unable to create payment. Please contact administrator.";
      }
      if ((freshInvoice.docstatus ?? 0) !== 1) {
        return "Invoice must be submitted before payment.";
      }
      if ((freshInvoice.outstanding_amount ?? 0) <= 0) {
        return "This invoice has no outstanding balance.";
      }
      if (receivedAmount > (freshInvoice.outstanding_amount ?? 0)) {
        return `Amount exceeds outstanding balance of ${formatCurrency(freshInvoice.outstanding_amount)}.`;
      }
    } else if (selected && receivedAmount > (selected.outstanding_amount ?? 0)) {
      return `Amount exceeds outstanding balance of ${formatCurrency(selected.outstanding_amount)}.`;
    }

    return null;
  }

  const createMutation = useMutation({
    mutationFn: async (payload: Partial<PaymentEntry>) => {
      const draft = await createPaymentEntry(payload);
      return submitPaymentEntry(draft.name);
    },
    onSuccess: (entry) => {
      toast.success("Payment processed successfully.");
      queryClient.invalidateQueries({ queryKey: ["payment-entries"] });
      queryClient.invalidateQueries({ queryKey: ["payable-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      invalidateFinanceDashboardMetrics(queryClient);
      setSuccessDetails({
        paymentEntryId: entry.name,
        paymentReference:
          entry.reference_no?.trim() || paymentReference.trim() || entry.name,
        invoiceNumber: invoiceName || selected?.name || "—",
        supplier:
          entry.party_name ??
          selected?.supplier_name ??
          selected?.supplier ??
          "—",
        amountPaid: entry.paid_amount ?? receivedAmount,
        paymentDate: entry.posting_date ?? postingDate,
        paymentMethod: entry.mode_of_payment ?? paymentMethod,
      });
    },
    onError: (err) => {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Unable to create payment. Please contact administrator.";
      toast.error(msg, { id: "payment-create-error" });
    },
  });

  function handleSubmit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    const payload = buildPayload();
    // eslint-disable-next-line no-console
    console.log("Posting Date UI:", postingDate);
    // eslint-disable-next-line no-console
    console.log("Posting Date Payload:", payload.posting_date);
    // eslint-disable-next-line no-console
    console.log("Final API Payload", payload);
    createMutation.mutate(payload);
  }

  if (invoicesLoading || accountsLoading || modesLoading) {
    return (
      <div>
        <BackLink />
        <PageHeader
          title="Record Supplier Payment"
          description="Enterprise Accounts Payable disbursement against an open invoice."
        />
        <div className="flex items-center justify-center card p-12 shadow-sm">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-3 text-sm text-neutral-500">Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackLink />

      <PageHeader
        title="Record Supplier Payment"
        description="Process ACH, wire, check, or card payments for supplier invoices."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Invoice selection */}
          <section className="card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-semibold text-neutral-900">
                Invoice & Amount
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                  Linked Invoice<span className="text-danger-500">*</span>
                </label>
                <select
                  value={invoiceName}
                  onChange={(e) => setInvoiceName(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value="">Select an unpaid invoice…</option>
                  {invoices.map((inv) => (
                    <option key={inv.name} value={inv.name}>
                      {inv.name} — {inv.supplier_name ?? inv.supplier} —{" "}
                      {formatCurrency(inv.outstanding_amount)} outstanding
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                  Payment Date<span className="text-danger-500">*</span>
                </label>
                <ErpNextDatePicker
                  value={postingDate}
                  onChange={setPostingDate}
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                  Amount to Pay ({paidToCurrency})
                  <span className="text-danger-500">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={receivedAmount}
                  onChange={(e) =>
                    setReceivedAmount(Number(e.target.value) || 0)
                  }
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-right text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
                {selected && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Outstanding:{" "}
                    <span className="font-medium text-neutral-700">
                      {formatCurrency(outstanding)}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Payment method */}
          <section className="card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-semibold text-neutral-900">
                Payment Method
              </h2>
            </div>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {paymentModes.map((method) => {
                const description = getPaymentModeDescription(method);
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => handleMethodChange(method)}
                    className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      paymentMethod === method
                        ? "border-primary-500 bg-primary-50 font-semibold text-primary-800 ring-1 ring-primary-500/30"
                        : "border-neutral-200 bg-white text-neutral-700 hover:border-primary-200 hover:bg-neutral-50"
                    }`}
                  >
                    {getPaymentModeLabel(method)}
                    {description && (
                      <span className="mt-0.5 block text-xs font-normal text-neutral-500">
                        {description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium text-neutral-700">
                Payment Reference
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => {
                    setReferenceLocked(false);
                    setPaymentReference(e.target.value);
                  }}
                  className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
                <button
                  type="button"
                  onClick={() => setReferenceLocked(true)}
                  className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Auto-generate
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Auto-generated format:{" "}
                <span className="font-mono">
                  {getPaymentReferenceFormatHint(paymentMethod)}
                </span>
              </p>
            </div>

            <PaymentMethodFields
              method={paymentMethod}
              details={methodDetails}
              onChange={setMethodDetails}
            />
          </section>

          {/* Attachments */}
          <section className="card p-5 shadow-sm">
            <PaymentAttachments
              attachments={attachments}
              onAdd={handleAddAttachment}
              onReplace={handleReplaceAttachment}
              onRemove={handleRemoveAttachment}
            />
          </section>
        </div>

        <div className="lg:col-span-1">
          <PaymentSummaryPanel
            invoiceName={selected?.name}
            supplierName={selected?.supplier_name ?? selected?.supplier}
            invoiceAmount={invoiceTotal}
            amountPaid={receivedAmount}
            remainingBalance={remainingAfterPayment}
            currency={paidToCurrency}
            paymentMethod={paymentMethod}
            paymentReference={paymentReference}
            paymentDate={postingDate}
            status={createMutation.isPending ? "Processing" : uiStatus}
          />

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {createMutation.isPending
                ? "Processing Payment..."
                : "Submit Payment"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/p2p/payments")}
              disabled={createMutation.isPending}
              className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <PaymentSuccessModal
        open={!!successDetails}
        details={successDetails}
        onViewReceipt={() => {
          if (!successDetails) return;
          navigate(
            `/p2p/payments/${encodeURIComponent(successDetails.paymentEntryId)}`
          );
        }}
        onGoToPayments={() => navigate("/p2p/payments")}
        onBackToDashboard={() => navigate("/dashboard")}
      />
    </div>
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

export default function NewPaymentPage() {
  return (
    <ErrorBoundary>
      <NewPaymentPageInner />
    </ErrorBoundary>
  );
}
