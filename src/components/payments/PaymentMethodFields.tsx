import { ErpNextDatePicker } from "../ui";
import {
  getFieldsForPaymentMethod,
  type PaymentMethodDetails,
  type PaymentMethodFieldDef,
} from "../../utils/usPaymentMethods";

const INPUT_CLS =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

interface Props {
  /** Exact ERPNext Mode of Payment name. */
  method: string;
  details: PaymentMethodDetails;
  onChange: (details: PaymentMethodDetails) => void;
  disabled?: boolean;
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: PaymentMethodFieldDef;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  if (field.type === "date") {
    return (
      <ErpNextDatePicker
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={field.required}
      />
    );
  }

  if (field.type === "select") {
    return (
      <select
        value={value}
        disabled={disabled}
        required={field.required}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLS}
      >
        <option value="">Select…</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "textarea") {
    return (
      <textarea
        value={value}
        disabled={disabled}
        rows={3}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLS} resize-y`}
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      disabled={disabled}
      required={field.required}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      inputMode={field.inputMode}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT_CLS}
    />
  );
}

export default function PaymentMethodFields({
  method,
  details,
  onChange,
  disabled = false,
}: Props) {
  const fields = getFieldsForPaymentMethod(method);

  function updateField(key: string, value: string) {
    onChange({ ...details, [key]: value });
  }

  if (fields.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={field.key}
          className={field.type === "textarea" ? "sm:col-span-2" : undefined}
        >
          <label className="mb-1.5 block text-xs font-medium text-neutral-700">
            {field.label}
            {field.required && (
              <span className="text-danger-500"> *</span>
            )}
          </label>
          <FieldInput
            field={field}
            value={details[field.key] ?? ""}
            onChange={(v) => updateField(field.key, v)}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}
