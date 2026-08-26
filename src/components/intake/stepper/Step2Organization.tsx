import { User } from "lucide-react";

export interface Step2Data {
  department: string;
  company: string;
  business_unit: string;
  plant: string;
  requester: string;
  requester_email: string;
  business_owner: string;
  business_owner_email: string;
  cost_center: string;
  project: string;
  program: string;
}

interface Props {
  data: Step2Data;
  companies: { name: string; company_name: string; abbr: string; default_currency: string }[];
  loadingCompanies: boolean;
  errors: Record<string, string>;
  onChange: (updates: Partial<Step2Data>) => void;
}

const DEPARTMENTS = [
  "IT & Digital Transformation",
  "Manufacturing Engineering",
  "Supply Chain & Logistics",
  "Facilities & EHS",
  "Operations & Production",
  "Research & Development",
  "Quality Assurance",
  "Finance & Administration",
  "Human Resources",
];

const PLANTS = [
  "Plant 01 - Main Manufacturing Hub",
  "Plant 02 - Chassis & Assembly Center",
  "Plant 03 - Precision BioTech Facility",
  "HQ Corporate Center",
  "Tech Center - R&D Facility",
];

const BUSINESS_UNITS = [
  "Industrial Operations",
  "Manufacturing & Assembly",
  "Engineering & Technology",
  "Digital Solutions & Systems",
  "Global Supply Chain",
  "Corporate & Shared Services",
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
  "w-full h-10 rounded-[6px] border bg-white px-3 text-[13px] text-neutral-900 transition-colors duration-150 focus-visible:outline-none cursor-pointer";
const selectNormalCls =
  "border-neutral-300 hover:border-neutral-400 focus-visible:border-primary-500 focus-visible:ring-1 focus-visible:ring-primary-200";
const selectErrorCls =
  "border-red-400 bg-red-50/30 focus-visible:border-red-500 focus-visible:ring-1 focus-visible:ring-red-200";
const errorMsgCls = "mt-1.5 text-[11px] font-medium text-red-600";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className={errorMsgCls}>{msg}</p>;
}

export function Step2Organization({
  data,
  companies,
  loadingCompanies,
  errors,
  onChange,
}: Props) {
  return (
    <div className="space-y-0">
      {/* ── Section Header ── */}
      <div className="px-6 sm:px-8 py-5 border-b border-neutral-100">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-bold text-neutral-900 tracking-tight">
            Organization &amp; Ownership
          </h2>
          <span className="text-[11px] font-medium text-neutral-400">
            Step 2 of 6 &middot; Organizational Unit
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-neutral-500">
          Identify the organizational unit, location, and individuals accountable for this requirement.
        </p>
      </div>

      {/* ── Form Body ── */}
      <div className="px-6 sm:px-8 py-6 space-y-6">
        {/* Row 1: Company, Department, Plant */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <label className={labelCls}>
              Company <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
            </label>
            <select
              value={data.company}
              onChange={(e) => onChange({ company: e.target.value })}
              disabled={loadingCompanies || companies.length === 0}
              className={`${selectCls} ${errors.company ? selectErrorCls : selectNormalCls}`}
            >
              {loadingCompanies ? (
                <option>Loading companies from ERPNext…</option>
              ) : companies.length === 0 ? (
                <option value="Netlink">Netlink</option>
              ) : (
                companies.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.company_name || c.name} ({c.abbr || c.default_currency})
                  </option>
                ))
              )}
            </select>
            <FieldError msg={errors.company} />
          </div>

          <div>
            <label className={labelCls}>
              Department <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
            </label>
            <select
              value={data.department}
              onChange={(e) => onChange({ department: e.target.value })}
              className={`${selectCls} ${errors.department ? selectErrorCls : selectNormalCls}`}
            >
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
            <FieldError msg={errors.department} />
          </div>

          <div>
            <label className={labelCls}>
              Plant / Location <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
            </label>
            <select
              value={data.plant}
              onChange={(e) => onChange({ plant: e.target.value })}
              className={`${selectCls} ${errors.plant ? selectErrorCls : selectNormalCls}`}
            >
              {PLANTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <FieldError msg={errors.plant} />
          </div>
        </div>

        {/* Row 2: Business Unit, Cost Center, Program */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <label className={labelCls}>Business Unit</label>
            <select
              value={data.business_unit}
              onChange={(e) => onChange({ business_unit: e.target.value })}
              className={`${selectCls} ${selectNormalCls}`}
            >
              {BUSINESS_UNITS.map((bu) => (
                <option key={bu} value={bu}>
                  {bu}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>
              Cost Center{" "}
              <span className="text-[10px] font-normal text-neutral-400 normal-case tracking-normal ml-1">
                optional
              </span>
            </label>
            <input
              type="text"
              value={data.cost_center}
              onChange={(e) => onChange({ cost_center: e.target.value })}
              placeholder="e.g. CC-1010 - Manufacturing"
              className={`${inputBaseCls} ${inputNormalCls}`}
            />
          </div>

          <div>
            <label className={labelCls}>
              Program / Initiative{" "}
              <span className="text-[10px] font-normal text-neutral-400 normal-case tracking-normal ml-1">
                optional
              </span>
            </label>
            <input
              type="text"
              value={data.program}
              onChange={(e) => onChange({ program: e.target.value })}
              placeholder="e.g. FY26 Automation Initiative"
              className={`${inputBaseCls} ${inputNormalCls}`}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-neutral-100 my-2" />

        {/* Row 3: Requester & Business Owner */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className={labelCls}>Requester</label>
            <div className="flex h-10 items-center rounded-[6px] border border-neutral-200 bg-neutral-50/80 px-3 text-[13px] text-neutral-700">
              <User className="h-3.5 w-3.5 text-neutral-400 mr-2 shrink-0" />
              <span className="truncate font-medium">
                {data.requester || data.requester_email || "Authenticated User"}
              </span>
            </div>
            <p className={helperCls}>Automatically defaulted to your logged-in identity.</p>
          </div>

          <div>
            <label className={labelCls}>
              Business Owner / Lead{" "}
              <span className="text-red-500 normal-case tracking-normal font-semibold">*</span>
            </label>
            <input
              type="text"
              value={data.business_owner}
              onChange={(e) =>
                onChange({
                  business_owner: e.target.value,
                  business_owner_email: e.target.value.includes("@")
                    ? e.target.value
                    : data.business_owner_email,
                })
              }
              placeholder="e.g. Robert Miller (Engineering Director)"
              className={`${inputBaseCls} ${errors.business_owner ? inputErrorCls : inputNormalCls}`}
            />
            {errors.business_owner ? (
              <FieldError msg={errors.business_owner} />
            ) : (
              <p className={helperCls}>
                Person accountable for operational ownership of this requirement.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
