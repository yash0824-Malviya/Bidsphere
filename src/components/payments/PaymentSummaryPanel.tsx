import {
  Banknote,
  Calendar,
  CreditCard,
  FileText,
  Hash,
  Receipt,
} from "lucide-react";

import StatusBadge from "../StatusBadge";
import { formatCurrency } from "../../utils/format";
import { formatUsDisplayDate } from "../../utils/erpNextDate";
import type { UsPaymentUiStatus } from "../../utils/usPaymentMethods";

interface Props {
  invoiceName?: string;
  supplierName?: string;
  invoiceAmount: number;
  amountPaid: number;
  remainingBalance: number;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  paymentDate: string;
  status: UsPaymentUiStatus;
}

function SummaryRow({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-neutral-500">{label}</p>
        <p
          className={`mt-0.5 text-sm ${
            highlight
              ? "font-semibold text-neutral-900"
              : "font-medium text-neutral-800"
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

export default function PaymentSummaryPanel({
  invoiceName,
  supplierName,
  invoiceAmount,
  amountPaid,
  remainingBalance,
  currency,
  paymentMethod,
  paymentReference,
  paymentDate,
  status,
}: Props) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-900">
            Payment Summary
          </h3>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Accounts Payable disbursement overview
        </p>
      </div>

      <div className="divide-y divide-neutral-100 px-5">
        {invoiceName && (
          <SummaryRow
            icon={FileText}
            label="Invoice"
            value={invoiceName}
          />
        )}
        {supplierName && (
          <SummaryRow
            icon={Receipt}
            label="Supplier"
            value={supplierName}
          />
        )}

        <div className="py-3">
          <div className="rounded-lg bg-neutral-50 p-3">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>Invoice Amount</span>
              <span className="font-medium tabular-nums text-neutral-700">
                {formatCurrency(invoiceAmount)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
              <span>Amount Paid</span>
              <span className="font-semibold tabular-nums text-primary-700">
                {formatCurrency(amountPaid)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-neutral-200 pt-2 text-xs">
              <span className="font-medium text-neutral-600">
                Remaining Balance
              </span>
              <span className="font-semibold tabular-nums text-neutral-900">
                {formatCurrency(remainingBalance)}
              </span>
            </div>
          </div>
        </div>

        <SummaryRow
          icon={CreditCard}
          label="Payment Method"
          value={paymentMethod}
        />
        <SummaryRow
          icon={Hash}
          label="Payment Reference"
          value={paymentReference || "—"}
        />
        <SummaryRow
          icon={Calendar}
          label="Payment Date"
          value={formatUsDisplayDate(paymentDate) || "—"}
        />
        <SummaryRow
          icon={Banknote}
          label="Currency"
          value={currency}
        />
      </div>
    </div>
  );
}
