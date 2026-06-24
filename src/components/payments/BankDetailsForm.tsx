import { Landmark } from "lucide-react";

import PaymentMethodFields from "./PaymentMethodFields";
import type { PaymentMethodDetails } from "../../utils/usPaymentMethods";

interface Props {
  method: string;
  details: PaymentMethodDetails;
  onChange: (details: PaymentMethodDetails) => void;
  disabled?: boolean;
}

/**
 * Bank information section. The actual fields (Bank Name, Account Holder,
 * Account Number, Routing Number, optional ACH Trace) are rendered per the
 * selected method by {@link PaymentMethodFields}, which also validates them.
 */
export default function BankDetailsForm({
  method,
  details,
  onChange,
  disabled = false,
}: Props) {
  return (
    <section className="card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Landmark className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-semibold text-neutral-900">
          Bank Information
        </h3>
      </div>
      <fieldset disabled={disabled} className="contents">
        <PaymentMethodFields
          method={method}
          details={details}
          onChange={onChange}
        />
      </fieldset>
    </section>
  );
}
