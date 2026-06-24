/**
 * Supplier Payment Detail — read-only payment receipt view.
 * Accessible at /supplier/payments/:id
 */

import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, CreditCard, Download, FileText, Printer } from "lucide-react";

import { getPaymentEntry } from "../../api/accounts";
import SupplierAccessDenied from "../../components/supplier-portal/SupplierAccessDenied";
import EmptyState from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import { formatCurrency, formatDate } from "../../utils/format";
import { getPaymentModeLabel } from "../../utils/usPaymentMethods";
import {
  downloadPaymentReceiptPdf,
  printPaymentReceiptPdf,
} from "../../utils/pdf";
import {
  paymentDisplayStatus,
  supplierOwnsRecord,
} from "../../utils/supplierPortalUtils";
import SupplierPortalLayout from "./SupplierPortalLayout";

export default function SupplierPaymentDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const name = decodeURIComponent(id);
  const { supplierName, isReady } = useSupplierSession();

  const {
    data: payment,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["supplier-portal-payment", name],
    queryFn: () => getPaymentEntry(name),
    enabled: !!name && isReady && !!supplierName,
  });

  if (!isReady || isLoading) {
    return (
      <SupplierPortalLayout>
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </SupplierPortalLayout>
    );
  }

  if (isError || !payment) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackLink />
        <EmptyState
          icon={CreditCard}
          title="Payment not found"
          description={`"${name}" may have been deleted or you may not have access.`}
        />
      </SupplierPortalLayout>
    );
  }

  if (!supplierOwnsRecord(supplierName, payment)) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackLink />
        <SupplierAccessDenied description="This payment does not belong to your supplier account." />
      </SupplierPortalLayout>
    );
  }

  const displayStatus = paymentDisplayStatus(payment);
  const references = payment.references ?? [];

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <BackLink />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">
            {payment.name ?? name}
          </h1>
          <p className="text-sm text-neutral-500">
            {payment.party_name ?? payment.party}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PdfButton
            icon={Download}
            label="Download Receipt"
            onClick={() => {
              void downloadPaymentReceiptPdf(payment).catch((err: Error) =>
                toast.error(err.message || "Could not generate PDF.")
              );
            }}
          />
          <PdfButton
            icon={Printer}
            label="Print"
            onClick={() => {
              void printPaymentReceiptPdf(payment).catch((err: Error) =>
                toast.error(err.message || "Could not open print preview.")
              );
            }}
          />
          <StatusBadge status={displayStatus} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <InfoCard label="Payment Date" value={formatDate(payment.posting_date)} />
        <InfoCard
          label="Mode of Payment"
          value={
            payment.mode_of_payment
              ? getPaymentModeLabel(payment.mode_of_payment)
              : "—"
          }
        />
        <InfoCard label="Reference No." value={payment.reference_no ?? "—"} />
        <InfoCard
          label="Reference Date"
          value={
            payment.reference_date
              ? formatDate(payment.reference_date)
              : "—"
          }
        />
        <InfoCard label="Company" value={payment.company ?? "—"} />
        <InfoCard
          label="Amount Paid"
          value={formatCurrency(payment.paid_amount)}
        />
        {payment.received_amount != null && (
          <InfoCard
            label="Amount Received"
            value={formatCurrency(payment.received_amount)}
          />
        )}
      </div>

      {references.length > 0 && (
        <div className="mt-6 card">
          <div className="border-b border-neutral-200 px-5 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              <FileText className="h-4 w-4 text-neutral-400" />
              Linked Invoices
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2">Document Type</th>
                  <th className="px-4 py-2">Invoice</th>
                  <th className="px-4 py-2 text-right">Invoice Total</th>
                  <th className="px-4 py-2 text-right">Allocated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {references.map((ref, idx) => (
                  <tr key={ref.name ?? idx}>
                    <td className="px-4 py-2 text-neutral-600">
                      {ref.reference_doctype ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-medium text-neutral-900">
                      {ref.reference_doctype === "Purchase Invoice" &&
                      ref.reference_name ? (
                        <Link
                          to={`/supplier/invoices/${encodeURIComponent(ref.reference_name)}`}
                          className="text-primary-600 hover:underline"
                        >
                          {ref.reference_name}
                        </Link>
                      ) : (
                        ref.reference_name ?? "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                      {formatCurrency(ref.total_amount)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(ref.allocated_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-50">
                  <td
                    colSpan={3}
                    className="px-4 py-3 text-right text-sm font-medium"
                  >
                    Total Allocated
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                    {formatCurrency(
                      references.reduce(
                        (sum, ref) => sum + (ref.allocated_amount ?? 0),
                        0
                      )
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-xs text-neutral-400">
        This is a read-only view. Contact Netlink accounts payable for payment
        queries.
      </p>
    </SupplierPortalLayout>
  );
}

function BackLink() {
  return (
    <Link
      to="/supplier/payments"
      className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Payments
    </Link>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-neutral-900">
        {value}
      </p>
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
