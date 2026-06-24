import { Banknote, Calendar, FileText, Receipt, Wallet } from "lucide-react";

import { formatCurrency } from "../../utils/format";
import { formatUsDisplayDate } from "../../utils/erpNextDate";

interface Props {
  supplier: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueDate?: string;
  /** True once the summary reflects a live ERPNext Purchase Invoice. */
  fromErpInvoice?: boolean;
}

function Row({
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

/**
 * Read-only payment summary sourced from the live ERPNext invoice/PO. No
 * frontend-generated amounts.
 */
export default function PaymentSummary({
  supplier,
  invoiceNumber,
  amount,
  currency,
  dueDate,
  fromErpInvoice = false,
}: Props) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-neutral-900">
            Payment Summary
          </h3>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {fromErpInvoice
            ? "Verified purchase invoice"
            : "Invoice will be created on submit"}
        </p>
      </div>

      <div className="divide-y divide-neutral-100 px-5">
        <Row icon={Receipt} label="Supplier" value={supplier} />
        <Row icon={FileText} label="Invoice Number" value={invoiceNumber} />
        <Row
          icon={Banknote}
          label="Amount"
          value={formatCurrency(amount)}
          highlight
        />
        <Row icon={Banknote} label="Currency" value={currency} />
        <Row
          icon={Calendar}
          label="Due Date"
          value={dueDate ? formatUsDisplayDate(dueDate) || "—" : "—"}
        />
      </div>
    </div>
  );
}
