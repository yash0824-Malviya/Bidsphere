export interface Step3Data {
  project_name: string;
  project_code: string;
  program_name: string;
  required_by_date: string;
  expected_completion_date: string;
  business_area: string;
}

interface Props {
  data: Step3Data;
  errors: Record<string, string>;
  onChange: (updates: Partial<Step3Data>) => void;
}

const labelCls =
  "block text-[11.5px] font-semibold uppercase tracking-wide text-neutral-500 mb-2";
const helperCls = "mt-1.5 text-[11px] leading-[1.4] text-neutral-400";
const inputBaseCls =
  "w-full h-10 rounded-[6px] border px-3 text-[13px] text-neutral-900 placeholder:text-neutral-400 transition-colors duration-150 focus:outline-none border-neutral-300 hover:border-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-200";

export function Step3ProjectContext({ data, errors: _errors, onChange }: Props) {
  return (
    <div className="space-y-0">
      {/* ── Section Header ── */}
      <div className="px-6 sm:px-8 py-5 border-b border-neutral-100">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-bold text-neutral-900 tracking-tight">
            Project Context &amp; Timeline
          </h2>
          <span className="text-[11px] font-medium text-neutral-400">
            Step 3 of 6 &middot; Project &amp; Schedule
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-neutral-500">
          Link this requirement to an existing project or program and define the delivery timeline.
        </p>
      </div>

      {/* ── Form Body ── */}
      <div className="px-6 sm:px-8 py-6 space-y-6">
        {/* Row 1: Project Name, Project Code, Program Name */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <label className={labelCls}>
              Project Name{" "}
              <span className="text-[10px] font-normal text-neutral-400 normal-case tracking-normal ml-1">optional</span>
            </label>
            <input
              type="text"
              value={data.project_name}
              onChange={(e) => onChange({ project_name: e.target.value })}
              placeholder="e.g. Line 3 Modernization Project"
              className={inputBaseCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              Project Code{" "}
              <span className="text-[10px] font-normal text-neutral-400 normal-case tracking-normal ml-1">optional</span>
            </label>
            <input
              type="text"
              value={data.project_code}
              onChange={(e) => onChange({ project_code: e.target.value })}
              placeholder="e.g. PRJ-2026-MFG-04"
              className={inputBaseCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              Program Name{" "}
              <span className="text-[10px] font-normal text-neutral-400 normal-case tracking-normal ml-1">optional</span>
            </label>
            <input
              type="text"
              value={data.program_name}
              onChange={(e) => onChange({ program_name: e.target.value })}
              placeholder="e.g. Smart Factory & Industry 4.0"
              className={inputBaseCls}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-neutral-100 my-2" />

        {/* Row 2: Dates & Business Area */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <label className={labelCls}>Expected Requirement Date</label>
            <input
              type="date"
              value={data.required_by_date}
              onChange={(e) => onChange({ required_by_date: e.target.value })}
              className={inputBaseCls}
            />
            <p className={helperCls}>When does the business need delivery or initial rollout?</p>
          </div>

          <div>
            <label className={labelCls}>Target Completion Date</label>
            <input
              type="date"
              value={data.expected_completion_date}
              onChange={(e) => onChange({ expected_completion_date: e.target.value })}
              className={inputBaseCls}
            />
            <p className={helperCls}>Target commissioning or completion date.</p>
          </div>

          <div>
            <label className={labelCls}>
              Business Area / Section{" "}
              <span className="text-[10px] font-normal text-neutral-400 normal-case tracking-normal ml-1">optional</span>
            </label>
            <input
              type="text"
              value={data.business_area}
              onChange={(e) => onChange({ business_area: e.target.value })}
              placeholder="e.g. Primary Robotic Cell"
              className={inputBaseCls}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
