import type { BudgetType } from "../../../types/businessIntake";

export interface Step4Data {
  estimated_budget: number | "";
  currency: string;
  budget_type: BudgetType;
  estimated_quantity: number | "";
  requirement_type: string;
  funding_source: string;
}

interface Props {
  data: Step4Data;
  errors: Record<string, string>;
  onChange: (updates: Partial<Step4Data>) => void;
}

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AED", "SGD", "JPY"];

const BUDGET_TYPES: { value: BudgetType; label: string; desc: string }[] = [
  { value: "CAPEX", label: "CAPEX", desc: "Capital equipment or long-term asset" },
  { value: "OPEX", label: "OPEX", desc: "Operating expense, consumable or service" },
  { value: "Mixed", label: "Mixed", desc: "Equipment acquisition with service contract" },
  { value: "Not Yet Determined", label: "Undetermined", desc: "Finance will classify in Business Case" },
];

const REQUIREMENT_TYPES = [
  "New Capability / New Asset Acquisition",
  "Capacity Expansion / Throughput Upgrade",
  "Obsolescence Replacement & Modernization",
  "Maintenance, Repair & Overhaul (MRO)",
  "Regulatory, Safety & Compliance Mandate",
  "Efficiency, Automation & Cost Reduction",
  "Proof of Concept / Pilot Equipment",
];

const labelCls =
  "block text-[11.5px] font-semibold uppercase tracking-wide text-neutral-500 mb-2";
const helperCls = "mt-1.5 text-[11px] leading-[1.4] text-neutral-400";
const inputBaseCls =
  "w-full h-10 rounded-[6px] border px-3 text-[13px] text-neutral-900 placeholder:text-neutral-400 transition-colors duration-150 focus:outline-none";
const inputNormalCls =
  "border-neutral-300 hover:border-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-200";
const inputErrorCls =
  "border-red-400 bg-red-50/30 focus:border-red-500 focus:ring-1 focus:ring-red-200";
const selectCls =
  "w-full h-10 rounded-[6px] border bg-white px-3 text-[13px] text-neutral-900 transition-colors duration-150 focus-visible:outline-none cursor-pointer border-neutral-300 hover:border-neutral-400 focus-visible:border-primary-500 focus-visible:ring-1 focus-visible:ring-primary-200";
const errorMsgCls = "mt-1.5 text-[11px] font-medium text-red-600";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className={errorMsgCls}>{msg}</p>;
}

export function Step4Budget({ data, errors, onChange }: Props) {
  return (
    <div className="space-y-0">
      {/* ── Section Header ── */}
      <div className="px-6 sm:px-8 py-5 border-b border-neutral-100">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-bold text-neutral-900 tracking-tight">
            Requirement Nature &amp; Budget Estimate
          </h2>
          <span className="text-[11px] font-medium text-neutral-400">
            Step 4 of 6 &middot; Budget &amp; Classification
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-neutral-500">
          Provide an initial budget estimate and classify the nature of the requirement.
        </p>
      </div>

      {/* ── Form Body ── */}
      <div className="px-6 sm:px-8 py-6 space-y-6">
        {/* Row 1: Budget Amount & Currency */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="sm:col-span-2">
            <label className={labelCls}>
              Estimated Initial Budget{" "}
              <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-neutral-400 pointer-events-none">
                {data.currency}
              </span>
              <input
                type="number"
                min="1"
                step="any"
                value={data.estimated_budget}
                onChange={(e) =>
                  onChange({
                    estimated_budget: e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
                placeholder="e.g. 350000"
                className={`${inputBaseCls} pl-12 font-semibold ${
                  errors.estimated_budget ? inputErrorCls : inputNormalCls
                }`}
              />
            </div>
            {errors.estimated_budget ? (
              <FieldError msg={errors.estimated_budget} />
            ) : (
              <p className={helperCls}>Initial rough estimate of anticipated spend.</p>
            )}
          </div>

          <div>
            <label className={labelCls}>
              Currency{" "}
              <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
            </label>
            <select
              value={data.currency}
              onChange={(e) => onChange({ currency: e.target.value })}
              className={`${selectCls} font-semibold`}
            >
              {CURRENCIES.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Budget Classification */}
        <div>
          <label className={labelCls}>Budget Classification</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BUDGET_TYPES.map((bt) => {
              const isSelected = data.budget_type === bt.value;
              return (
                <button
                  key={bt.value}
                  type="button"
                  onClick={() => onChange({ budget_type: bt.value })}
                  className={`flex flex-col text-left px-3 py-2.5 rounded-[8px] border transition-all duration-150 ${
                    isSelected
                      ? "border-primary-600 bg-primary-50/60 shadow-sm ring-1 ring-primary-500/20"
                      : "border-neutral-200 bg-white hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-neutral-900">{bt.label}</span>
                    <span
                      className={`h-3 w-3 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected ? "border-primary-600 bg-primary-600" : "border-neutral-300"
                      }`}
                    >
                      {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-neutral-500 mt-1 leading-tight">{bt.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-neutral-100 my-2" />

        {/* Row 3: Quantity & Requirement Nature */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <label className={labelCls}>
              Estimated Quantity / Units{" "}
              <span className="text-[10px] font-normal text-neutral-400 normal-case tracking-normal ml-1">optional</span>
            </label>
            <input
              type="number"
              min="1"
              value={data.estimated_quantity}
              onChange={(e) =>
                onChange({
                  estimated_quantity: e.target.value === "" ? "" : Number(e.target.value),
                })
              }
              placeholder="e.g. 1"
              className={`${inputBaseCls} ${inputNormalCls}`}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelCls}>Requirement Nature</label>
            <select
              value={data.requirement_type}
              onChange={(e) => onChange({ requirement_type: e.target.value })}
              className={selectCls}
            >
              <option value="">Select Nature of Requirement…</option>
              {REQUIREMENT_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {rt}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
