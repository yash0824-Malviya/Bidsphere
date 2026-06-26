import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Loader2, RefreshCw, Wallet } from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PaymentMethodSelector from "../../components/payments/PaymentMethodSelector";
import BankDetailsForm from "../../components/payments/BankDetailsForm";
import PaymentAttachments, {
  type PaymentAttachment,
  type PaymentAttachmentKind,
} from "../../components/payments/PaymentAttachments";
import PaymentSummary from "../../components/payments/PaymentSummary";
import PaymentSuccessModal, {
  type PaymentSuccessDetails,
} from "../../components/payments/PaymentSuccessModal";
import { ErpNextDatePicker } from "../../components/ui";
import {
  getInvoicesForPO,
  getModesOfPayment,
  getPurchaseInvoice,
} from "../../api/accounts";
import { invalidateFinanceDashboardMetrics } from "../../api/financeWorkflow";
import {
  getNextPaymentReference,
  processInvoicePayment,
  type PaymentFileInput,
} from "../../api/paymentEntry";
import { getVoucherById, releasePayment } from "../../api/vouchers";
import { useAuthStore } from "../../store/authStore";
import {
  createPaymentAttachment,
  revokePaymentAttachmentUrl,
} from "../../utils/paymentAttachmentUtils";
import {
  emptyDetailsForMethod,
  getPaymentReferenceFormatHint,
  normalizePaymentMethod,
  validatePaymentMethodDetails,
  type PaymentMethodDetails,
} from "../../utils/usPaymentMethods";
import { todayIso } from "../../utils/format";

const DEFAULT_METHOD = "ACH Transfer";

export default function PaymentProcessingPage() {
  const { invoiceId = "" } = useParams();
  const voucherId = decodeURIComponent(invoiceId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const canAct = role === "finance" || role === "admin";

  const voucher = useMemo(() => getVoucherById(voucherId), [voucherId]);
  const invoiceBackLink = `/p2p/invoices/${encodeURIComponent(voucherId)}`;


  const [postingDate, setPostingDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState(DEFAULT_METHOD);
  const [methodDetails, setMethodDetails] = useState<PaymentMethodDetails>(() =>
    emptyDetailsForMethod(DEFAULT_METHOD)
  );
  const [paymentReference, setPaymentReference] = useState("");
  const [referenceLocked, setReferenceLocked] = useState(true);
  const [generatingRef, setGeneratingRef] = useState(false);
  const [attachments, setAttachments] = useState<PaymentAttachment[]>([]);
  const [filesByKind, setFilesByKind] = useState<
    Partial<Record<PaymentAttachmentKind, File>>
  >({});
  const [successDetails, setSuccessDetails] =
    useState<PaymentSuccessDetails | null>(null);

  // Revoke any object URLs on unmount.
  useEffect(
    () => () => {
      setAttachments((prev) => {
        prev.forEach(revokePaymentAttachmentUrl);
        return prev;
      });
    },
    []
  );

  const { data: paymentModes = [], isLoading: modesLoading } = useQuery({
    queryKey: ["modes-of-payment"],
    queryFn: getModesOfPayment,
    staleTime: 5 * 60_000,
  });

  // Live ERPNext Purchase Invoice for the PO (drives the read-only summary).
  const poReference = voucher?.po_reference ?? "";
  const { data: erpInvoice } = useQuery({
    queryKey: ["erp-invoice-for-po", poReference],
    enabled: !!poReference,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = (await getInvoicesForPO(poReference)).filter(
        (i) => i.docstatus !== 2
      );
      const pick =
        rows.find((i) => i.docstatus === 1) ?? rows.find((i) => i.docstatus === 0);
      return pick ? getPurchaseInvoice(pick.name) : null;
    },
  });

  // Keep the selected method valid against ERPNext's configured modes.
  useEffect(() => {
    if (paymentModes.length === 0) return;
    if (!paymentModes.includes(paymentMethod)) {
      const next = normalizePaymentMethod(paymentMethod, paymentModes);
      setPaymentMethod(next);
      setMethodDetails(emptyDetailsForMethod(next));
    }
  }, [paymentModes, paymentMethod]);

  // Backend-derived reference: read existing ERPNext references and increment.
  const generateReference = useCallback(async () => {
    setGeneratingRef(true);
    try {
      const ref = await getNextPaymentReference(paymentMethod, postingDate);
      setPaymentReference(ref);
    } catch {
      toast.error("Could not generate a reference. Please enter one manually.");
    } finally {
      setGeneratingRef(false);
    }
  }, [paymentMethod, postingDate]);

  useEffect(() => {
    if (referenceLocked) void generateReference();
  }, [referenceLocked, generateReference]);

  const summary = useMemo(() => {
    if (erpInvoice) {
      return {
        supplier:
          (erpInvoice as { supplier_name?: string }).supplier_name ??
          erpInvoice.supplier ??
          voucher?.supplier_name ??
          "—",
        invoiceNumber: erpInvoice.name,
        amount:
          erpInvoice.outstanding_amount ??
          erpInvoice.grand_total ??
          voucher?.invoice?.total ??
          0,
        currency: erpInvoice.currency ?? voucher?.currency ?? "USD",
        dueDate:
          (erpInvoice as { due_date?: string }).due_date ??
          voucher?.invoice?.due_date,
        fromErp: true,
      };
    }
    return {
      supplier: voucher?.supplier_name ?? "—",
      invoiceNumber: voucher?.invoice?.invoice_number ?? voucher?.id ?? "—",
      amount: voucher?.invoice?.total ?? 0,
      currency: voucher?.currency ?? "USD",
      dueDate: voucher?.invoice?.due_date,
      fromErp: false,
    };
  }, [erpInvoice, voucher]);

  const mutation = useMutation({
    mutationFn: () => {
      const files: PaymentFileInput[] = (
        Object.entries(filesByKind) as [PaymentAttachmentKind, File][]
      )
        .filter(([, file]) => !!file)
        .map(([kind, file]) => ({ kind, file }));
      return processInvoicePayment({
        poReference,
        paymentMethod,
        paymentReference,
        methodDetails,
        files,
        postingDate,
      });
    },
    onSuccess: (result) => {
      releasePayment(voucherId, {
        payment_id: result.paymentEntry,
        confirmed_at: new Date(`${postingDate}T00:00:00`).toISOString(),
        confirmed_by: user?.full_name ?? "Finance Team",
        payment_method: paymentMethod,
        reference_number: paymentReference.trim(),
        amount: result.amountPaid,
      });
      queryClient.invalidateQueries({ queryKey: ["payment-entries"] });
      queryClient.invalidateQueries({ queryKey: ["payable-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      invalidateFinanceDashboardMetrics(queryClient);
      toast.success("Payment processed successfully.");
      setSuccessDetails({
        paymentEntryId: result.paymentEntry,
        paymentReference: paymentReference.trim(),
        invoiceNumber: result.purchaseInvoice,
        supplier: summary.supplier,
        amountPaid: result.amountPaid,
        paymentDate: postingDate,
        paymentMethod: paymentMethod,
      });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Unable to process payment. Please contact administrator.",
        { id: "process-payment-error" }
      );
    },
  });

  if (!canAct) {
    return (
      <div>
        <BackLink to={invoiceBackLink} />
        <EmptyState
          icon={Wallet}
          title="Restricted"
          description="Only the Finance team can release supplier payments."
        />
      </div>
    );
  }

  if (!voucher || !voucher.invoice) {
    return (
      <div>
        <BackLink to="/p2p/invoices" />
        <EmptyState
          icon={Wallet}
          title="Invoice not found"
          description="No supplier invoice could be loaded for this record."
        />
      </div>
    );
  }

  function handleMethodChange(method: string) {
    setPaymentMethod(method);
    setMethodDetails(emptyDetailsForMethod(method));
    setReferenceLocked(true);
  }

  function handleAddAttachment(kind: PaymentAttachmentKind, file: File) {
    setAttachments((prev) => {
      const existing = prev.find((a) => a.kind === kind);
      if (existing) revokePaymentAttachmentUrl(existing);
      return [
        ...prev.filter((a) => a.kind !== kind),
        createPaymentAttachment(kind, file),
      ];
    });
    setFilesByKind((prev) => ({ ...prev, [kind]: file }));
  }

  function handleReplaceAttachment(id: string, file: File) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (!target) return prev;
      revokePaymentAttachmentUrl(target);
      setFilesByKind((f) => ({ ...f, [target.kind]: file }));
      return prev.map((a) =>
        a.id === id ? createPaymentAttachment(a.kind, file) : a
      );
    });
  }

  function handleRemoveAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) {
        revokePaymentAttachmentUrl(target);
        setFilesByKind((f) => {
          const next = { ...f };
          delete next[target.kind];
          return next;
        });
      }
      return prev.filter((a) => a.id !== id);
    });
  }

  function handleSubmit() {
    if (!poReference) {
      toast.error(
        "This invoice has no linked Purchase Order, so a payment cannot be processed."
      );
      return;
    }
    if (!paymentReference.trim()) {
      toast.error("Payment reference is required.");
      return;
    }
    if (paymentModes.length > 0 && !paymentModes.includes(paymentMethod)) {
      toast.error("Selected payment method is not currently available.");
      return;
    }
    const methodErr = validatePaymentMethodDetails(paymentMethod, methodDetails);
    if (methodErr) {
      toast.error(methodErr);
      return;
    }
    mutation.mutate();
  }

  const busy = mutation.isPending;

  return (
    <div>
      <BackLink to={invoiceBackLink} />

      <PageHeader
        title="Process Payment"
        description={`Process supplier payment for ${voucher.supplier_name}`}
      />

      <div className="mt-2 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Payment date */}
          <section className="card p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">
              Payment Date
            </h3>
            <div className="max-w-xs">
              <ErpNextDatePicker
                value={postingDate}
                onChange={setPostingDate}
                required
              />
            </div>
          </section>

          {/* Payment method */}
          <PaymentMethodSelector
            methods={paymentModes}
            selected={paymentMethod}
            onSelect={handleMethodChange}
            loading={modesLoading}
            disabled={busy}
          />

          {/* Payment reference */}
          <section className="card p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">
              Payment Reference
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={paymentReference}
                disabled={busy}
                onChange={(e) => {
                  setReferenceLocked(false);
                  setPaymentReference(e.target.value);
                }}
                className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60"
              />
              <button
                type="button"
                disabled={busy || generatingRef}
                onClick={() => {
                  setReferenceLocked(true);
                  void generateReference();
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
              >
                {generatingRef ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Auto Generate
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Reference sequence is derived from existing payment records.
              Format: {" "}
              <span className="font-mono">
                {getPaymentReferenceFormatHint(paymentMethod)}
              </span>
            </p>
          </section>

          {/* Bank information */}
          <BankDetailsForm
            method={paymentMethod}
            details={methodDetails}
            onChange={setMethodDetails}
            disabled={busy}
          />

          {/* Attachments */}
          <section className="card p-5 shadow-sm">
            <PaymentAttachments
              attachments={attachments}
              onAdd={handleAddAttachment}
              onReplace={handleReplaceAttachment}
              onRemove={handleRemoveAttachment}
              disabled={busy}
            />
          </section>
        </div>

        {/* Summary + actions */}
        <div className="lg:col-span-1">
          <PaymentSummary
            supplier={summary.supplier}
            invoiceNumber={summary.invoiceNumber}
            amount={summary.amount}
            currency={summary.currency}
            dueDate={summary.dueDate}
            fromErpInvoice={summary.fromErp}
          />

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Processing Payment..." : "Submit Payment"}
            </button>
            <Link
              to={invoiceBackLink}
              className={`w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-neutral-700 hover:bg-neutral-50 ${
                busy ? "pointer-events-none opacity-60" : ""
              }`}
            >
              Cancel
            </Link>
          </div>

          {!poReference && (
            <p className="mt-3 text-xs text-amber-600">
              No linked Purchase Order — a payment cannot be processed for
              this invoice.
            </p>
          )}
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

function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to invoice
    </Link>
  );
}
