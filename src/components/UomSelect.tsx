import { mergeUomDropdownOptions } from "../config/uomMaster";

interface UomSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Extra ERP UOM names already in use (kept under "Other (ERP)"). */
  erpUoms?: readonly string[];
  /** Include empty "Select UOM" option. */
  allowEmpty?: boolean;
  id?: string;
  "aria-label"?: string;
}

/**
 * Enterprise UOM dropdown — logical groups from the BidSphere UOM master.
 * Existing non-master ERP values remain selectable when passed via `erpUoms`
 * or when `value` is outside the master (so edit forms never blank out).
 */
export default function UomSelect({
  value,
  onChange,
  className,
  disabled,
  invalid,
  erpUoms = [],
  allowEmpty = false,
  id,
  "aria-label": ariaLabel = "Unit of Measure",
}: UomSelectProps) {
  const extras = [...erpUoms];
  if (
    value.trim() &&
    !extras.some((u) => u.toLowerCase() === value.trim().toLowerCase())
  ) {
    extras.push(value.trim());
  }
  const { groups } = mergeUomDropdownOptions(extras);

  return (
    <select
      id={id}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {allowEmpty && <option value="">Select UOM</option>}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.uoms.map((uom) => (
            <option key={`${group.label}-${uom}`} value={uom}>
              {uom}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
