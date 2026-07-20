/**
 * Build ERPNext filters / or_filters for the All RFQs list page.
 * Minimal set: Search · Status · Owner · Date Range.
 */

import type { Filter } from "../api/erpnext";
import { todayERPNextDate } from "./erpNextDate";
import dayjs from "dayjs";

export type RfqStatusFilter =
  | ""
  | "Draft"
  | "Submitted"
  | "Completed"
  | "Cancelled"
  | "Closed";

export type RfqDatePreset =
  | ""
  | "today"
  | "last_7"
  | "last_30"
  | "custom";

export interface RfqListFilterState {
  search: string;
  status: RfqStatusFilter;
  owner: string;
  datePreset: RfqDatePreset;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_RFQ_FILTERS: RfqListFilterState = {
  search: "",
  status: "",
  owner: "",
  datePreset: "",
  dateFrom: "",
  dateTo: "",
};

export const RFQ_STATUS_OPTIONS: RfqStatusFilter[] = [
  "",
  "Draft",
  "Submitted",
  "Completed",
  "Cancelled",
  "Closed",
];

export const RFQ_DATE_PRESET_OPTIONS: Array<{
  value: RfqDatePreset;
  label: string;
}> = [
  { value: "", label: "All Dates" },
  { value: "today", label: "Today" },
  { value: "last_7", label: "Last 7 Days" },
  { value: "last_30", label: "Last 30 Days" },
  { value: "custom", label: "Custom Range" },
];

export interface BuiltRfqFilters {
  filters: Filter[];
  or_filters: Filter[];
}

function resolveDateRange(state: RfqListFilterState): {
  from?: string;
  to?: string;
} {
  const today = todayERPNextDate();
  switch (state.datePreset) {
    case "today":
      return { from: today, to: today };
    case "last_7":
      return {
        from: dayjs(today).subtract(6, "day").format("YYYY-MM-DD"),
        to: today,
      };
    case "last_30":
      return {
        from: dayjs(today).subtract(29, "day").format("YYYY-MM-DD"),
        to: today,
      };
    case "custom":
      return {
        from: state.dateFrom.trim() || undefined,
        to: state.dateTo.trim() || undefined,
      };
    default:
      return {};
  }
}

/** Map UI status to ERPNext `status` filter values. */
function statusFilters(status: RfqStatusFilter): Filter[] {
  switch (status) {
    case "Draft":
      return [["status", "=", "Draft"]];
    case "Submitted":
      return [["status", "in", ["Submitted", "Open", "Replied"]]];
    case "Completed":
      return [["status", "in", ["Ordered", "Closed", "Partially Ordered"]]];
    case "Cancelled":
      return [["status", "=", "Cancelled"]];
    case "Closed":
      return [["status", "=", "Closed"]];
    default:
      return [];
  }
}

export function buildRfqListFilters(
  state: RfqListFilterState,
  options?: { openPreset?: boolean },
): BuiltRfqFilters {
  const filters: Filter[] = [];
  const or_filters: Filter[] = [];

  if (options?.openPreset && !state.status) {
    filters.push(["status", "in", ["Submitted", "Open"]]);
  }

  filters.push(...statusFilters(state.status));

  const owner = state.owner.trim();
  if (owner) {
    filters.push(["owner", "like", `%${owner}%`]);
  }

  const { from, to } = resolveDateRange(state);
  if (from) filters.push(["modified", ">=", `${from} 00:00:00`]);
  if (to) filters.push(["modified", "<=", `${to} 23:59:59`]);

  const q = state.search.trim();
  if (q) {
    const like = `%${q}%`;
    or_filters.push(
      ["name", "like", like],
      ["Request for Quotation Item", "material_request", "like", like],
      ["Request for Quotation Supplier", "supplier", "like", like],
      ["Request for Quotation Supplier", "supplier_name", "like", like],
    );
  }

  return { filters, or_filters };
}

export interface RfqFilterChip {
  key: keyof RfqListFilterState;
  label: string;
  value: string;
}

export function getActiveRfqFilterChips(
  state: RfqListFilterState,
): RfqFilterChip[] {
  const chips: RfqFilterChip[] = [];
  if (state.search.trim()) {
    chips.push({
      key: "search",
      label: "Search",
      value: state.search.trim(),
    });
  }
  if (state.status) {
    chips.push({ key: "status", label: "Status", value: state.status });
  }
  if (state.owner.trim()) {
    chips.push({ key: "owner", label: "Owner", value: state.owner.trim() });
  }
  if (state.datePreset === "today") {
    chips.push({ key: "datePreset", label: "Date", value: "Today" });
  } else if (state.datePreset === "last_7") {
    chips.push({ key: "datePreset", label: "Date", value: "Last 7 Days" });
  } else if (state.datePreset === "last_30") {
    chips.push({ key: "datePreset", label: "Date", value: "Last 30 Days" });
  } else if (state.datePreset === "custom") {
    const range = [state.dateFrom, state.dateTo].filter(Boolean).join(" → ");
    chips.push({
      key: "datePreset",
      label: "Date",
      value: range || "Custom Range",
    });
  }
  return chips;
}

export function clearRfqFilterKey(
  state: RfqListFilterState,
  key: keyof RfqListFilterState,
): RfqListFilterState {
  if (key === "datePreset") {
    return { ...state, datePreset: "", dateFrom: "", dateTo: "" };
  }
  return { ...state, [key]: EMPTY_RFQ_FILTERS[key] };
}

export function hasActiveRfqFilters(state: RfqListFilterState): boolean {
  return getActiveRfqFilterChips(state).length > 0;
}
