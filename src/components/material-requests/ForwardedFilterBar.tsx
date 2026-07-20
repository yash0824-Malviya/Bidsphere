import { Search, X } from "lucide-react";

export interface ForwardedFilters {
  search: string;
  department: string;
  warehouse: string;
  priority: string;
  status: string;
  procurementType: string;
  requestMode: string;
  forwardDate: string;
}

export const EMPTY_FORWARDED_FILTERS: ForwardedFilters = {
  search: "",
  department: "",
  warehouse: "",
  priority: "",
  status: "",
  procurementType: "",
  requestMode: "",
  forwardDate: "",
};

interface Props {
  value: ForwardedFilters;
  onChange: (next: ForwardedFilters) => void;
  departments: string[];
  warehouses: string[];
  priorities: string[];
  /** Optional — pass [] to hide the Status select (e.g. the active queue). */
  statuses?: string[];
  /** Show the Request Type select. Default true. */
  showProcurementType?: boolean;
  /** Show the Request Mode select. Default true. */
  showRequestMode?: boolean;
}

/**
 * Shared filter bar for the Forwarded Material Requests queue and Forwarded
 * History. Keeps the same visual tokens (neutral inputs, rounded-lg) as the
 * rest of the procurement module.
 */
export default function ForwardedFilterBar({
  value,
  onChange,
  departments,
  warehouses,
  priorities,
  statuses = [],
  showProcurementType = true,
  showRequestMode = true,
}: Props) {
  const set = (patch: Partial<ForwardedFilters>) =>
    onChange({ ...value, ...patch });

  const hasActive = Object.values(value).some((v) => v !== "");

  const selectCls =
    "rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-sm text-neutral-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="relative min-w-[200px] flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          placeholder="Search MR number or department…"
          value={value.search}
          onChange={(e) => set({ search: e.target.value })}
          className="w-full rounded-lg border border-neutral-200 py-2 pl-10 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      <Select
        label="Department"
        value={value.department}
        options={departments}
        onChange={(v) => set({ department: v })}
        cls={selectCls}
      />
      <Select
        label="Warehouse"
        value={value.warehouse}
        options={warehouses}
        onChange={(v) => set({ warehouse: v })}
        cls={selectCls}
      />
      <Select
        label="Priority"
        value={value.priority}
        options={priorities}
        onChange={(v) => set({ priority: v })}
        cls={selectCls}
      />
      {showProcurementType && (
        <Select
          label="Request Type"
          value={value.procurementType}
          options={["Direct", "Indirect"]}
          onChange={(v) => set({ procurementType: v })}
          cls={selectCls}
        />
      )}
      {showRequestMode && (
        <Select
          label="Request Mode"
          value={value.requestMode}
          options={["Existing", "New"]}
          onChange={(v) => set({ requestMode: v })}
          cls={selectCls}
        />
      )}
      {statuses.length > 0 && (
        <Select
          label="Status"
          value={value.status}
          options={statuses}
          onChange={(v) => set({ status: v })}
          cls={selectCls}
        />
      )}

      <input
        type="date"
        value={value.forwardDate}
        onChange={(e) => set({ forwardDate: e.target.value })}
        title="Forwarded on or after"
        className={selectCls}
      />

      {hasActive && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FORWARDED_FILTERS)}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  cls,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  cls: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
      aria-label={label}
    >
      <option value="">{label}: All</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
