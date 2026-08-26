import type { NeedPriority, NeedType, TechnicalRequirementItem } from "../../../types/businessIntake";
import { TechnicalRequirementsEditor } from "../TechnicalRequirementsEditor";

export interface Step1Data {
  title: string;
  problem_statement: string;
  business_justification: string;
  priority: NeedPriority | "";
  need_type: NeedType;
  requirement_category: string;
  technical_requirements_list?: TechnicalRequirementItem[];
}

interface Props {
  data: Step1Data;
  errors: Record<string, string>;
  onChange: (updates: Partial<Step1Data>) => void;
}

const CATEGORIES = [
  "Production Machinery & Equipment",
  "IT Hardware, Software & Cloud",
  "MRO, Tooling & Consumables",
  "Facilities, Utilities & Infrastructure",
  "Professional & Consulting Services",
  "Raw Materials & Sub-Assemblies",
  "Logistics, Packaging & Transport",
  "Quality Assurance & Testing Systems",
  "Environmental, Health & Safety (EHS)",
  "Other Operational Requirements",
];

/** Shared class strings for enterprise field design */
const labelCls =
  "block text-[11.5px] font-semibold uppercase tracking-wide text-neutral-500 mb-2";
const helperCls = "mt-1.5 text-[11px] leading-[1.4] text-neutral-400";
const inputBaseCls =
  "w-full h-10 rounded-[6px] border bg-white px-3 text-[13px] text-neutral-900 placeholder:text-neutral-400 transition-colors duration-150 focus:outline-none";
const inputNormalCls =
  "border-neutral-300 hover:border-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-200";
const inputErrorCls =
  "border-red-400 bg-red-50/30 focus:border-red-500 focus:ring-1 focus:ring-red-200";
const selectBaseCls =
  "w-full h-10 rounded-[6px] border bg-white px-3 text-[13px] text-neutral-900 transition-colors duration-150 focus-visible:outline-none cursor-pointer appearance-auto";
const errorMsgCls = "mt-1.5 text-[11px] font-medium text-red-600";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className={errorMsgCls}>{msg}</p>;
}

export function Step1Requirement({ data, errors, onChange }: Props) {
  return (
    <div className="space-y-0">
      {/* ── Section Header ── */}
      <div className="px-6 sm:px-8 py-5 border-b border-neutral-100">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-bold text-neutral-900 tracking-tight">
            Requirement
          </h2>
          <span className="text-[11px] font-medium text-neutral-400">
            Step 1 of 6 &middot; Business Requirement
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-neutral-500">
          What does the business need and why? Provide a clear, structured requirement for review.
        </p>
      </div>

      {/* ── Form Body ── */}
      <div className="px-6 sm:px-8 py-6 space-y-6">
        {/* Requirement Title */}
        <div>
          <label className={labelCls}>
            Requirement Title <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
          </label>
          <input
            type="text"
            value={data.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="e.g. Automated High Precision Robotic Welding Cells"
            className={`${inputBaseCls} ${errors.title ? inputErrorCls : inputNormalCls}`}
          />
          <p className={helperCls}>
            Provide a clear, descriptive title for this procurement or operational need.
          </p>
          <FieldError msg={errors.title} />
        </div>

        {/* Priority | Need Type | Category — 3 equal columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Priority */}
          <div>
            <label className={labelCls}>
              Priority <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
            </label>
            <select
              value={data.priority}
              onChange={(e) => onChange({ priority: e.target.value as NeedPriority })}
              className={`${selectBaseCls} ${
                errors.priority
                  ? "border-red-400 bg-red-50/30 focus-visible:border-red-500 focus-visible:ring-1 focus-visible:ring-red-200"
                  : "border-neutral-300 hover:border-neutral-400 focus-visible:border-primary-500 focus-visible:ring-1 focus-visible:ring-primary-200"
              }`}
            >
              <option value="">Select priority…</option>
              <option value="Low">Low — Standard Timeline</option>
              <option value="Medium">Medium — Scheduled Need</option>
              <option value="High">High — Urgent Operational Need</option>
              <option value="Critical">Critical — Line Stoppage / Safety</option>
            </select>
            <FieldError msg={errors.priority} />
          </div>

          {/* Need Type */}
          <div>
            <label className={labelCls}>
              Need Type <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
            </label>
            <select
              value={data.need_type}
              onChange={(e) => onChange({ need_type: e.target.value as NeedType })}
              className={`${selectBaseCls} border-neutral-300 hover:border-neutral-400 focus-visible:border-primary-500 focus-visible:ring-1 focus-visible:ring-primary-200`}
            >
              <option value="Direct">Direct — Production / Manufacturing</option>
              <option value="Indirect">Indirect — Corporate / Facilities / IT</option>
            </select>
          </div>

          {/* Category */}
          <div>
            <label className={labelCls}>
              Requirement Category{" "}
              <span className="text-[10px] font-normal text-neutral-400 normal-case tracking-normal ml-1">
                optional
              </span>
            </label>
            <select
              value={data.requirement_category}
              onChange={(e) => onChange({ requirement_category: e.target.value })}
              className={`${selectBaseCls} border-neutral-300 hover:border-neutral-400 focus-visible:border-primary-500 focus-visible:ring-1 focus-visible:ring-primary-200`}
            >
              <option value="">Select Category…</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-neutral-100 my-2" />

        {/* Business Problem / Requirement Description */}
        <div>
          <label className={labelCls}>
            Business Problem / Requirement Description{" "}
            <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
          </label>
          <textarea
            value={data.problem_statement}
            onChange={(e) => onChange({ problem_statement: e.target.value })}
            placeholder="Describe the problem, operational bottleneck, or required equipment/service…"
            style={{ resize: "vertical", minHeight: 120, maxHeight: 260 }}
            className={`w-full rounded-[6px] border p-3 text-[13px] text-neutral-900 placeholder:text-neutral-400 leading-relaxed transition-colors duration-150 focus:outline-none ${
              errors.problem_statement
                ? "border-red-400 bg-red-50/30 focus:border-red-500 focus:ring-1 focus:ring-red-200"
                : "border-neutral-300 hover:border-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
            }`}
          />
          <p className={helperCls}>
            Describe the current situation, business impact, and required capability.
          </p>
          <FieldError msg={errors.problem_statement} />
        </div>

        {/* Business Justification */}
        <div>
          <label className={labelCls}>
            Business Justification{" "}
            <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
          </label>
          <textarea
            value={data.business_justification}
            onChange={(e) => onChange({ business_justification: e.target.value })}
            placeholder="Explain the justification, expected efficiency gains, or risk mitigation…"
            style={{ resize: "vertical", minHeight: 108, maxHeight: 220 }}
            className={`w-full rounded-[6px] border p-3 text-[13px] text-neutral-900 placeholder:text-neutral-400 leading-relaxed transition-colors duration-150 focus:outline-none ${
              errors.business_justification
                ? "border-red-400 bg-red-50/30 focus:border-red-500 focus:ring-1 focus:ring-red-200"
                : "border-neutral-300 hover:border-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
            }`}
          />
          <p className={helperCls}>
            Explain why this requirement is needed and what business outcome is expected.
          </p>
          <FieldError msg={errors.business_justification} />
        </div>

        {/* Divider */}
        <div className="border-t border-neutral-100 my-2" />

        {/* Technical Requirements & Specifications Section */}
        <div>
          <TechnicalRequirementsEditor
            requirements={data.technical_requirements_list || []}
            onChange={(updated) => onChange({ technical_requirements_list: updated })}
            title="Technical Requirements & Specifications"
            subtitle="Add all technical specifications, equipment details, quantities, UOMs, and supplier deliverables."
          />
          <FieldError msg={errors.technical_requirements} />
        </div>
      </div>
    </div>
  );
}
