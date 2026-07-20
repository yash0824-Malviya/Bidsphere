import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Wallet,
} from "lucide-react";

import EmptyState from "../../components/EmptyState";
import { AppLoading, EnterpriseError } from "../../components/enterprise";
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
  getInvoicesForGRN,
  getInvoicesForPO,
  getModesOfPayment,
  getPurchaseInvoice,
} from "../../api/accounts";
import { invalidateFinanceDashboardMetrics } from "../../api/financeWorkflow";
import {
  getNextPaymentReference,
  isAlreadyPaidPaymentError,
  processInvoicePayment,
  type PaymentFileInput,
} from "../../api/paymentEntry";
import { getVoucherById, releasePayment } from "../../api/vouchers";
import { useAuthStore } from "../../store/authStore";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import type { PurchaseInvoice } from "../../types/erpnext";
import type { Voucher } from "../../types/voucher";
import {
  createPaymentAttachment,
  revokePaymentAttachmentUrl,
} from "../../utils/paymentAttachmentUtils";
import { nowERPDateTime } from "../../utils/erpDate";
import {
  emptyDetailsForMethod,
  getPaymentReferenceFormatHint,
  normalizePaymentMethod,
  validatePaymentMethodDetails,
  type PaymentMethodDetails,
} from "../../utils/usPaymentMethods";
import { canReleasePayment } from "../../config/roles";
import { todayIso } from "../../utils/format";

const DEFAULT_METHOD = "ACH Transfer";

/** True when voucher / PI already shows payment completed — no further submit. */
function isPaymentAlreadyCompleted(
  voucher: Voucher | undefined,
  erpInvoice: PurchaseInvoice | null | undefined,
): boolean {
  if (!voucher) return false;

  const voucherPaid =
    voucher.status === "payment_confirmed" ||
    voucher.status === "payment_received" ||
    voucher.invoice?.status === "paid" ||
    !!voucher.payment ||
    voucher.payment?.status === "Paid" ||
    voucher.payment?.status === "Completed";

  if (voucherPaid) return true;

  if (!erpInvoice) return false;

  const status = String(erpInvoice.status ?? "").toLowerCase();
  const outstanding = Number(erpInvoice.outstanding_amount);
  const submitted = (erpInvoice.docstatus ?? 0) === 1;

  return (
    status === "paid" ||
    erpInvoice.is_paid === 1 ||
    (submitted && Number.isFinite(outstanding) && outstanding <= 0)
  );
}

async function resolveLivePurchaseInvoice(
  poReference: string,
  grnReference?: string,
): Promise<PurchaseInvoice | null> {
  if (grnReference) {
    const forGrn = (await getInvoicesForGRN(grnReference)).filter(
      (i) => i.docstatus !== 2,
    );
    const pick =
      forGrn.find((i) => i.docstatus === 1) ??
      forGrn.find((i) => i.docstatus === 0);
    if (pick) return getPurchaseInvoice(pick.name);
  }

  if (!poReference) return null;

  const forPo = (await getInvoicesForPO(poReference)).filter(
    (i) => i.docstatus !== 2,
  );
  const pick =
    forPo.find((i) => i.docstatus === 1) ??
    forPo.find((i) => i.docstatus === 0);
  return pick ? getPurchaseInvoice(pick.name) : null;
}

export default function PaymentProcessingPage() {
  const { invoiceId = "" } = useParams();
  const voucherId = decodeURIComponent(invoiceId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const canAct = canReleasePayment(role);

  const syncVersion = useVoucherSyncStore((s) => s.version);
  const {
    data: voucher,
    isLoading: voucherLoading,
    isError: voucherIsError,
    error: voucherError,
    refetch: refetchVoucher,
  } = useQuery({
    queryKey: ["voucher", voucherId, syncVersion],
    queryFn: () => getVoucherById(voucherId),
    enabled: !!voucherId,
  });
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
  // Sync lock + React state must be declared before any early return
  // (Rules of Hooks). isPending alone is too late for double-click.
  const submittingRef = useRef(false);
  const [submitLocked, setSubmitLocked] = useState(false);

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

  // Live ERPNext Purchase Invoice (GRN-first, same as payment orchestration).
  const poReference = voucher?.po_reference ?? "";
  const grnReference = voucher?.grn_reference ?? "";
  const {
    data: erpInvoice,
    isLoading: erpInvoiceLoading,
    isFetching: erpInvoiceFetching,
  } = useQuery({
    queryKey: ["erp-invoice-for-payment", poReference, grnReference],
    enabled: !!poReference || !!grnReference,
    staleTime: 30_000,
    queryFn: () => resolveLivePurchaseInvoice(poReference, grnReference || undefined),
  });

  const alreadyPaid = useMemo(
    () => isPaymentAlreadyCompleted(voucher, erpInvoice),
    [voucher, erpInvoice],
  );

  // Keep the selected method valid against ERPNext's configured modes.
  useEffect(() => {
    if (alreadyPaid || paymentModes.length === 0) return;
    if (!paymentModes.includes(paymentMethod)) {
      const next = normalizePaymentMethod(paymentMethod, paymentModes);
      setPaymentMethod(next);
      setMethodDetails(emptyDetailsForMethod(next));
    }
  }, [paymentModes, paymentMethod, alreadyPaid]);

  // Backend-derived reference: read existing ERPNext references and increment.
  const generateReference = useCallback(async () => {
    if (alreadyPaid) return;
    setGeneratingRef(true);
    try {
      const ref = await getNextPaymentReference(paymentMethod, postingDate);
      setPaymentReference(ref);
    } catch {
      toast.error("Could not generate a reference. Please enter one manually.");
    } finally {
      setGeneratingRef(false);
    }
  }, [paymentMethod, postingDate, alreadyPaid]);

  useEffect(() => {
    if (alreadyPaid) return;
    if (referenceLocked) void generateReference();
  }, [referenceLocked, generateReference, alreadyPaid]);

  const summary = useMemo(() => {
    if (erpInvoice) {
      const paid =
        String(erpInvoice.status ?? "").toLowerCase() === "paid" ||
        erpInvoice.is_paid === 1 ||
        ((erpInvoice.docstatus ?? 0) === 1 &&
          Number(erpInvoice.outstanding_amount) <= 0);
      return {
        supplier:
          erpInvoice.supplier_name ??
          erpInvoice.supplier ??
          voucher?.supplier_name ??
          "—",
        invoiceNumber: erpInvoice.name,
        amount: paid
          ? (erpInvoice.grand_total ??
            erpInvoice.paid_amount ??
            voucher?.invoice?.total ??
            0)
          : (erpInvoice.outstanding_amount ??
            erpInvoice.grand_total ??
            voucher?.invoice?.total ??
            0),
        currency: erpInvoice.currency ?? voucher?.currency ?? "USD",
        dueDate: erpInvoice.due_date ?? voucher?.invoice?.due_date,
        fromErp: true,
      };
    }
    return {
      supplier: voucher?.supplier_name ?? "—",
      invoiceNumber: voucher?.invoice?.invoice_number ?? voucher?.id ?? "—",
      amount: voucher?.invoice?.total ?? voucher?.payment?.amount ?? 0,
      currency: voucher?.currency ?? "USD",
      dueDate: voucher?.invoice?.due_date,
      fromErp: false,
    };
  }, [erpInvoice, voucher]);

  const mutation = useMutation({
    mutationFn: () => {
      if (alreadyPaid) {
        throw new Error(
          "Payment has already been completed. No further payment is required.",
        );
      }
      const files: PaymentFileInput[] = (
        Object.entries(filesByKind) as [PaymentAttachmentKind, File][]
      )
        .filter(([, file]) => !!file)
        .map(([kind, file]) => ({ kind, file }));
      return processInvoicePayment({
        poReference,
        grnReference: voucher?.grn_reference,
        paymentMethod,
        paymentReference,
        methodDetails,
        files,
        postingDate,
      });
    },
    onSuccess: async (result) => {
      await releasePayment(voucherId, {
        payment_id: result.paymentEntry,
        confirmed_at: nowERPDateTime(),
        confirmed_by: user?.full_name ?? "Finance Team",
        payment_method: paymentMethod,
        reference_number: paymentReference.trim(),
        amount: result.amountPaid,
      });
      queryClient.invalidateQueries({ queryKey: ["payment-entries"] });
      queryClient.invalidateQueries({ queryKey: ["payable-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({
        queryKey: ["erp-invoice-for-payment", poReference, grnReference],
      });
      queryClient.invalidateQueries({ queryKey: ["voucher", voucherId] });
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
      // Already-paid / duplicate PE — surface as UI state, not an error toast.
      if (isAlreadyPaidPaymentError(err)) {
        void queryClient.invalidateQueries({
          queryKey: ["erp-invoice-for-payment", poReference, grnReference],
        });
        void refetchVoucher();
        return;
      }
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Unable to process payment. Please contact administrator.",
        { id: "process-payment-error" },
      );
    },
  });

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
    if (alreadyPaid) return;
    if (submittingRef.current || mutation.isPending || submitLocked) return;
    if (erpInvoiceLoading || erpInvoiceFetching) return;

    if (!voucher?.invoice) {
      toast.error("No supplier invoice is available for payment.");
      return;
    }
    if (!poReference) {
      toast.error(
        "This invoice has no linked Purchase Order, so a payment cannot be processed.",
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
    submittingRef.current = true;
    setSubmitLocked(true);
    mutation.mutate(undefined, {
      onSettled: () => {
        submittingRef.current = false;
        setSubmitLocked(false);
      },
    });
  }

  const busy = mutation.isPending || submitLocked;
  const readOnly = alreadyPaid || busy;
  const awaitingInvoiceStatus =
    !alreadyPaid &&
    (!!poReference || !!grnReference) &&
    (erpInvoiceLoading || erpInvoiceFetching);

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

  if (!voucherId) {
    return (
      <div>
        <BackLink to="/p2p/invoices" />
        <EmptyState
          icon={Wallet}
          title="Missing invoice"
          description="No invoice id was provided in the URL."
        />
      </div>
    );
  }

  if (voucherLoading) {
    return (
      <div>
        <BackLink to={invoiceBackLink} />
        <AppLoading variant="document" title="Loading document..." />
      </div>
    );
  }

  if (voucherIsError) {
    return (
      <div>
        <EnterpriseError
          error={voucherError}
          onRetry={() => void refetchVoucher()}
          onBack={() => {
            window.location.assign(invoiceBackLink);
          }}
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
          description="No supplier invoice could be loaded for this record. Finance can only pay after the supplier submits an invoice."
        />
      </div>
    );
  }

  return (
    <div>
      <BackLink to={invoiceBackLink} />

      <PageHeader
        title="Process Payment"
        description={`Process supplier payment for ${voucher.supplier_name || "supplier"}`}
        actions={
          alreadyPaid ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-100 px-3 py-1 text-xs font-semibold text-success-700 ring-1 ring-success-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Payment Completed
            </span>
          ) : undefined
        }
      />

      {alreadyPaid && (
        <div
          role="status"
          className="mt-3 flex items-start gap-3 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-800"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-600" />
          <p className="font-medium">
            Payment has already been completed. No further payment is required.
          </p>
        </div>
      )}

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
                disabled={readOnly}
              />
            </div>
          </section>

          {/* Payment method */}
          <PaymentMethodSelector
            methods={paymentModes}
            selected={paymentMethod}
            onSelect={handleMethodChange}
            loading={modesLoading}
            disabled={readOnly}
          />

          {/* Payment reference */}
          <section className="card p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">
              Payment Reference
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={
                  alreadyPaid
                    ? (voucher.payment?.reference_number ||
                      paymentReference ||
                      "—")
                    : paymentReference
                }
                disabled={readOnly}
                readOnly={alreadyPaid}
                onChange={(e) => {
                  if (alreadyPaid) return;
                  setReferenceLocked(false);
                  setPaymentReference(e.target.value);
                }}
                className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-neutral-50 disabled:opacity-60"
              />
              {!alreadyPaid && (
                <button
                  type="button"
                  disabled={readOnly || generatingRef}
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
              )}
            </div>
            {!alreadyPaid && (
              <p className="mt-1 text-xs text-neutral-500">
                Reference sequence is derived from existing payment records.
                Format:{" "}
                <span className="font-mono">
                  {getPaymentReferenceFormatHint(paymentMethod)}
                </span>
              </p>
            )}
          </section>

          {/* Bank information */}
          <BankDetailsForm
            method={paymentMethod}
            details={methodDetails}
            onChange={setMethodDetails}
            disabled={readOnly}
          />

          {/* Attachments */}
          <section className="card p-5 shadow-sm">
            <PaymentAttachments
              attachments={attachments}
              onAdd={handleAddAttachment}
              onReplace={handleReplaceAttachment}
              onRemove={handleRemoveAttachment}
              disabled={readOnly}
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
            {alreadyPaid ? (
              <div className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-success-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">
                <CheckCircle2 className="h-4 w-4" />
                Payment Completed
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy || awaitingInvoiceStatus || !poReference}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {(busy || awaitingInvoiceStatus) && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {busy
                  ? "Processing Payment..."
                  : awaitingInvoiceStatus
                    ? "Checking payment status…"
                    : "Submit Payment"}
              </button>
            )}
            <Link
              to={invoiceBackLink}
              className={`w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-neutral-700 hover:bg-neutral-50 ${
                busy ? "pointer-events-none opacity-60" : ""
              }`}
            >
              {alreadyPaid ? "Back to invoice" : "Cancel"}
            </Link>
          </div>

          {!poReference && !alreadyPaid && (
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
