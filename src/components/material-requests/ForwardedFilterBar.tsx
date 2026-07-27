import { X } from "lucide-react";

import { SearchInput } from "../ui";

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
 * History. Uses design-system control sizes (search 48px, selects 48px).
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

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="min-w-[200px] flex-1">
        <SearchInput
          value={value.search}
          onChange={(search) => set({ search })}
          placeholder="Search MR number or department…"
        />
      </div>

      <Select
        label="Department"
        value={value.department}
        options={departments}
        onChange={(v) => set({ department: v })}
      />
      <Select
        label="Warehouse"
        value={value.warehouse}
        options={warehouses}
        onChange={(v) => set({ warehouse: v })}
      />
      <Select
        label="Priority"
        value={value.priority}
        options={priorities}
        onChange={(v) => set({ priority: v })}
      />
      {showProcurementType && (
        <Select
          label="Request Type"
          value={value.procurementType}
          options={["Direct", "Indirect"]}
          onChange={(v) => set({ procurementType: v })}
        />
      )}
      {showRequestMode && (
        <Select
          label="Request Mode"
          value={value.requestMode}
          options={["Existing", "New"]}
          onChange={(v) => set({ requestMode: v })}
        />
      )}
      {statuses.length > 0 && (
        <Select
          label="Status"
          value={value.status}
          options={statuses}
          onChange={(v) => set({ status: v })}
        />
      )}

      <input
        type="date"
        value={value.forwardDate}
        onChange={(e) => set({ forwardDate: e.target.value })}
        title="Forwarded on or after"
        className="input-field w-auto"
      />

      {hasActive && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FORWARDED_FILTERS)}
          className="btn-secondary"
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
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="select-field w-auto"
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
