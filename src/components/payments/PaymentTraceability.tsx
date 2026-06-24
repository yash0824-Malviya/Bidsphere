import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, CreditCard, FileText, Link2, ShoppingCart } from "lucide-react";

import { getPurchaseInvoice } from "../../api/accounts";
import type { PaymentEntry, PaymentEntryReference } from "../../types/erpnext";

interface Props {
  payment: PaymentEntry;
}

export default function PaymentTraceability({ payment }: Props) {
  const invoiceRefs = (payment.references ?? []).filter(
    (r): r is PaymentEntryReference & { reference_name: string } =>
      r.reference_doctype === "Purchase Invoice" && !!r.reference_name
  );

  const invoiceQueries = useQueries({
    queries: invoiceRefs.map((ref) => ({
      queryKey: ["purchase-invoice-trace", ref.reference_name],
      queryFn: () => getPurchaseInvoice(ref.reference_name),
      staleTime: 60_000,
    })),
  });

  if (invoiceRefs.length === 0) {
    return (
      <div className="mt-4 card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <Link2 className="h-4 w-4 text-primary" />
          Source Document Traceability
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          No linked invoices — traceability chain unavailable for this payment.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 card overflow-hidden">
      <div className="border-b border-neutral-100 bg-gradient-to-r from-primary-50/80 to-white px-5 py-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <Link2 className="h-4 w-4 text-primary" />
          Source Document Traceability
        </h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          Payment → Invoice → Purchase Order
        </p>
      </div>

      <div className="space-y-3 p-5">
        {invoiceRefs.map((ref, idx) => {
          const invQuery = invoiceQueries[idx];
          const invoiceName = ref.reference_name;
          const poNames = [
            ...new Set(
              (invQuery.data?.items ?? [])
                .map((item) => item.purchase_order)
                .filter(Boolean) as string[]
            ),
          ];
          const primaryPo = poNames[0];

          return (
            <div
              key={invoiceName}
              className="flex flex-col gap-3 rounded-xl border border-neutral-100 bg-neutral-50/50 p-4 shadow-sm transition hover:border-primary-100 hover:shadow-md sm:flex-row sm:items-center"
            >
              <TraceNode
                icon={CreditCard}
                label="Payment"
                value={payment.name ?? "—"}
                to={`/p2p/payments/${encodeURIComponent(payment.name ?? "")}`}
                active
              />
              <ArrowRight className="hidden h-4 w-4 shrink-0 text-neutral-300 sm:block" />
              <TraceNode
                icon={FileText}
                label="Invoice"
                value={invoiceName}
                to={`/p2p/invoices/${encodeURIComponent(invoiceName)}`}
                loading={invQuery.isLoading}
              />
              <ArrowRight className="hidden h-4 w-4 shrink-0 text-neutral-300 sm:block" />
              <TraceNode
                icon={ShoppingCart}
                label="Purchase Order"
                value={
                  invQuery.isLoading
                    ? "Loading…"
                    : primaryPo ?? "Not linked"
                }
                to={
                  primaryPo
                    ? `/p2p/purchase-orders/${encodeURIComponent(primaryPo)}`
                    : undefined
                }
                muted={!primaryPo && !invQuery.isLoading}
                extra={
                  poNames.length > 1 ? (
                    <span className="text-[10px] text-neutral-400">
                      +{poNames.length - 1} more
                    </span>
                  ) : null
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TraceNode({
  icon: Icon,
  label,
  value,
  to,
  active,
  loading,
  muted,
  extra,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  to?: string;
  active?: boolean;
  loading?: boolean;
  muted?: boolean;
  extra?: React.ReactNode;
}) {
  const content = (
    <div
      className={`flex min-w-0 flex-1 items-start gap-3 rounded-lg px-3 py-2 ${
        active ? "bg-primary-50 ring-1 ring-primary-100" : "bg-white"
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          active
            ? "bg-primary text-white shadow-sm"
            : "bg-neutral-100 text-neutral-500"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          {label}
        </p>
        <p
          className={`truncate text-sm font-semibold ${
            muted
              ? "text-neutral-400"
              : loading
              ? "text-neutral-400"
              : "text-neutral-900"
          }`}
        >
          {value}
        </p>
        {extra}
      </div>
    </div>
  );

  if (to && !muted && !loading) {
    return (
      <Link to={to} className="min-w-0 flex-1 transition hover:opacity-90">
        {content}
      </Link>
    );
  }

  return <div className="min-w-0 flex-1">{content}</div>;
}
