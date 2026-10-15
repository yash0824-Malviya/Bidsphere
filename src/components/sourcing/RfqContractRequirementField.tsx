import { useId } from "react";
import type { RfqContractRequired } from "../../api/rfqContractRequirement";
import { ClmLinkInput } from "../contracts/ClmFields";

export default function RfqContractRequirementField({ value, onChange, disabled = false, department }: {
  value: RfqContractRequired | ""; onChange: (value: RfqContractRequired) => void; disabled?: boolean;
  department?: { value: string; onChange: (value: string) => void; error?: string };
}) {
  const id = useId();
  return <fieldset disabled={disabled} className="rounded-xl border border-neutral-200 bg-white p-4">
    <legend className="px-1 text-sm font-semibold text-neutral-800">Contract Required? *</legend>
    <p id={`${id}-question`} className="text-sm font-medium text-neutral-700">Will this RFQ require a Contract?</p>
    <div role="radiogroup" aria-required="true" aria-labelledby={`${id}-question`} aria-describedby={`${id}-help`} className="mt-3 flex flex-wrap gap-5">
      {(["No", "Yes"] as const).map(option => <label key={option} className="inline-flex items-center gap-2 text-sm text-neutral-700">
        <input type="radio" name={`${id}-contract-required`} value={option} checked={value === option} onChange={() => onChange(option)} required className="h-4 w-4 accent-[#1F3A6D]" />{option}
      </label>)}
    </div>
    <p id={`${id}-help`} className="mt-2 text-xs text-neutral-500">If Yes, the CLM workflow will start after the supplier is awarded. No Contract Request is created before supplier award.</p>
    {value === "Yes" && department && <div className="mt-4 max-w-md">
      <label htmlFor={`${id}-department`} className="mb-1.5 block text-xs font-semibold text-neutral-700">Department *</label>
      <ClmLinkInput id={`${id}-department`} doctype="Department" value={department.value} onChange={department.onChange} required disabled={disabled} invalid={Boolean(department.error)} describedBy={department.error ? `${id}-department-error` : undefined} />
      {department.error && <p id={`${id}-department-error`} role="alert" className="mt-1 text-xs text-rose-700">{department.error}</p>}
    </div>}
  </fieldset>;
}
