import { Loader2, ShieldCheck } from "lucide-react";

import {
  getPaymentModeDescription,
  getPaymentModeLabel,
} from "../../utils/usPaymentMethods";

interface Props {
  /** Live ERPNext "Mode of Payment" names. */
  methods: string[];
  selected: string;
  onSelect: (method: string) => void;
  loading?: boolean;
  disabled?: boolean;
}

/**
 * Payment method cards driven by ERPNext "Mode of Payment" records — never a
 * hardcoded list. The selected value is the exact ERPNext mode name.
 */
export default function PaymentMethodSelector({
  methods,
  selected,
  onSelect,
  loading = false,
  disabled = false,
}: Props) {
  return (
    <section className="card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-semibold text-neutral-900">
          Payment Method
        </h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading payment methods…
        </div>
      ) : methods.length === 0 ? (
        <p className="py-4 text-sm text-neutral-500">
          No payment methods are currently available.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {methods.map((method) => {
            const description = getPaymentModeDescription(method);
            const active = selected === method;
            return (
              <button
                key={method}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(method)}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
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
      )}
    </section>
  );
}
