/**
 * Supplier Invoice Detail — read-only invoice view.
 * Accessible at /supplier/invoices/:id
 */

import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Download, FileText, Printer, Receipt } from "lucide-react";

import { getPurchaseInvoice } from "../../api/accounts";
import SupplierAccessDenied from "../../components/supplier-portal/SupplierAccessDenied";
import EmptyState from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import { formatCurrency, formatDate } from "../../utils/format";
import { downloadInvoicePdf, printInvoicePdf } from "../../utils/pdf";
import {
  invoiceDisplayStatus,
  primaryPOFromInvoice,
  supplierOwnsRecord,
} from "../../utils/supplierPortalUtils";
import SupplierPortalLayout from "./SupplierPortalLayout";

export default function SupplierInvoiceDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const name = decodeURIComponent(id);
  const { supplierName, isReady } = useSupplierSession();

  const {
    data: invoice,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["supplier-portal-invoice", name],
    queryFn: () => getPurchaseInvoice(name),
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

  if (isError || !invoice) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackLink />
        <EmptyState
          icon={FileText}
          title="Invoice not found"
          description={`"${name}" may have been deleted or you may not have access.`}
        />
      </SupplierPortalLayout>
    );
  }

  if (!supplierOwnsRecord(supplierName, invoice)) {
    return (
      <SupplierPortalLayout supplierName={supplierName}>
        <BackLink />
        <SupplierAccessDenied description="This invoice does not belong to your supplier account." />
      </SupplierPortalLayout>
    );
  }

  const displayStatus = invoiceDisplayStatus(invoice);
  const poRef = primaryPOFromInvoice(invoice);
  const hasOutstanding = (invoice.outstanding_amount ?? 0) > 0;

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <BackLink />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{invoice.name}</h1>
          <p className="text-sm text-neutral-500">
            {invoice.supplier_name ?? invoice.supplier}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PdfButton
            icon={Download}
            label="Download PDF"
            onClick={() => {
              void downloadInvoicePdf(invoice, displayStatus).catch((err: Error) =>
                toast.error(err.message || "Could not generate PDF.")
              );
            }}
          />
          <PdfButton
            icon={Printer}
            label="Print"
            onClick={() => {
              void printInvoicePdf(invoice, displayStatus).catch((err: Error) =>
                toast.error(err.message || "Could not open print preview.")
              );
            }}
          />
          <StatusBadge status={displayStatus} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <InfoCard label="Invoice Date" value={formatDate(invoice.posting_date)} />
        <InfoCard
          label="Due Date"
          value={invoice.due_date ? formatDate(invoice.due_date) : "—"}
        />
        <InfoCard
          label="PO Reference"
          value={
            poRef ? (
              <Link
                to={`/supplier/po/${encodeURIComponent(poRef)}`}
                className="text-primary-600 hover:underline"
              >
                {poRef}
              </Link>
            ) : (
              "—"
            )
          }
        />
        <InfoCard label="Bill No." value={invoice.bill_no ?? "—"} />
        <InfoCard label="Company" value={invoice.company ?? "—"} />
        <InfoCard label="Currency" value={invoice.currency ?? "—"} />
      </div>

      <div className="mt-6 card">
        <div className="border-b border-neutral-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">Items</h3>
        </div>

        {(invoice.items ?? []).length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No items"
            description="This invoice has no line items."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Purchase Order</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2">UOM</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {(invoice.items ?? []).map((item, idx) => (
                  <tr key={item.name ?? idx}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-neutral-900">
                        {item.item_code}
                      </div>
                      {item.item_name && item.item_name !== item.item_code && (
                        <div className="text-xs text-neutral-500">
                          {item.item_name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {item.purchase_order ? (
                        <Link
                          to={`/supplier/po/${encodeURIComponent(item.purchase_order)}`}
                          className="text-primary-600 hover:underline"
                        >
                          {item.purchase_order}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {item.qty ?? 0}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {item.uom ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(item.rate)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-col items-end gap-2 border-t-2 border-neutral-200 px-5 py-4">
              <TotalRow
                label="Subtotal"
                value={formatCurrency(invoice.net_total)}
              />
              {(invoice.total_taxes_and_charges ?? 0) > 0 && (
                <TotalRow
                  label="Tax"
                  value={formatCurrency(
                    invoice.total_taxes_and_charges)}
                />
              )}
              <TotalRow
                label="Grand Total"
                value={formatCurrency(invoice.grand_total)}
                bold
              />
              {hasOutstanding && (
                <TotalRow
                  label="Outstanding"
                  value={formatCurrency(
                    invoice.outstanding_amount)}
                  danger
                />
              )}
            </div>
          </div>
        )}
      </div>

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
      to="/supplier/invoices"
      className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Invoices
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

function TotalRow({
  label,
  value,
  bold,
  danger,
}: {
  label: string;
  value: string;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex gap-12 ${bold ? "text-base font-bold text-neutral-900" : "text-sm text-neutral-700"} ${danger ? "font-semibold text-danger-600" : ""}`}
    >
      <span className="w-28 text-right text-neutral-500">{label}</span>
      <span className="w-28 text-right tabular-nums">{value}</span>
    </div>
  );
}
