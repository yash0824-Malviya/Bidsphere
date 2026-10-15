/** Shared by the award form and its API; generic CLM contracts retain their own types. */
export const RFQ_CONTRACT_TYPES = [
  "Supply / Procurement Contract",
  "Service Agreement",
  "NDA",
  "Master Service Agreement",
  "Other",
] as const;

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateRfqContractDetails(
  values: Record<string, unknown>,
  { requireType = true }: { requireType?: boolean } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  const type = text(values.contract_type);
  if (!type) errors.contract_type = "Select a contract type.";
  else if (requireType && !(RFQ_CONTRACT_TYPES as readonly string[]).includes(type)) errors.contract_type = "Select a supported contract type.";
  if (!text(values.contract_purpose)) errors.contract_purpose = "Contract Purpose is required.";
  if (!text(values.description)) errors.description = "Contract Description is required.";
  const start = text(values.contract_start_date);
  const end = text(values.contract_end_date);
  if (!validDate(start)) errors.contract_start_date = "Enter a valid Contract Start Date.";
  if (!validDate(end)) errors.contract_end_date = "Enter a valid Contract End Date.";
  if (!errors.contract_start_date && !errors.contract_end_date && end <= start) errors.contract_end_date = "Contract End Date must be after Contract Start Date.";
  return errors;
}
