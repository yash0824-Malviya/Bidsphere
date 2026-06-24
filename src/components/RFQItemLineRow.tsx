import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";

import {
  getItems,
  type ItemGroupOption,
  type ItemSearchResult,
} from "../api/sourcing";

export interface RFQItemLine {
  id: string;
  item_group: string;
  item_code: string;
  item_name: string;
  description: string;
  qty: number;
  uom: string;
}

interface Props {
  row: RFQItemLine;
  rowNumber: number;
  itemGroups: ItemGroupOption[];
  groupsLoading: boolean;
  showErrors: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<RFQItemLine>) => void;
  onRemove: () => void;
}

const selectCls = (hasError: boolean, disabled?: boolean) =>
  [
    "w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-9 text-sm shadow-sm transition",
    "focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
    hasError ? "border-danger-400" : "border-neutral-300",
    disabled ? "cursor-not-allowed bg-neutral-50 text-neutral-400" : "text-neutral-900",
  ].join(" ");

const inputCls = (hasError: boolean, readOnly?: boolean) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition",
    "focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
    hasError ? "border-danger-400" : "border-neutral-300",
    readOnly
      ? "cursor-default bg-neutral-50 text-neutral-700"
      : "bg-white text-neutral-900",
  ].join(" ");

function SelectWrap({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      {children}
      <ChevronDown
        className={`pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ${
          disabled ? "text-neutral-300" : "text-neutral-400"
        }`}
      />
    </div>
  );
}

export default function RFQItemLineRow({
  row,
  rowNumber,
  itemGroups,
  groupsLoading,
  showErrors,
  canRemove,
  onChange,
  onRemove,
}: Props) {
  const groupError = showErrors && !row.item_group;
  const itemError = showErrors && !row.item_code;
  const qtyError = showErrors && !(row.qty > 0);

  const itemsQuery = useQuery<ItemSearchResult[]>({
    queryKey: ["rfq-items-by-group", row.item_group],
    queryFn: () => getItems({ itemGroup: row.item_group, limit: 500 }),
    enabled: !!row.item_group,
    staleTime: 60_000,
  });

  const groupItems = itemsQuery.data ?? [];
  const itemsLoading = itemsQuery.isLoading || itemsQuery.isFetching;

  function handleGroupChange(itemGroup: string) {
    onChange({
      item_group: itemGroup,
      item_code: "",
      item_name: "",
      description: "",
      uom: "Nos",
    });
  }

  function handleItemChange(itemCode: string) {
    const item = groupItems.find((i) => i.item_code === itemCode);
    if (!item) {
      onChange({ item_code: "", item_name: "", description: "", uom: "Nos" });
      return;
    }
    onChange({
      item_code: item.item_code,
      item_name: item.item_name,
      description: item.description ?? item.item_name,
      uom: item.uom,
    });
  }

  return (
    <tr className="group border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60">
      <td className="px-3 py-3 align-top">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-xs font-semibold text-neutral-600">
          {rowNumber}
        </span>
      </td>
      <td className="px-3 py-3 align-top min-w-[160px]">
        <SelectWrap disabled={groupsLoading}>
          <select
            value={row.item_group}
            onChange={(e) => handleGroupChange(e.target.value)}
            disabled={groupsLoading}
            aria-invalid={groupError}
            className={selectCls(groupError, groupsLoading)}
          >
            <option value="">
              {groupsLoading ? "Loading groups…" : "Select group…"}
            </option>
            {itemGroups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.item_group_name ?? g.name}
              </option>
            ))}
          </select>
        </SelectWrap>
        {groupError && (
          <p className="mt-1 text-[11px] text-danger-600">Required</p>
        )}
      </td>
      <td className="px-3 py-3 align-top min-w-[180px]">
        <SelectWrap disabled={!row.item_group || itemsLoading}>
          <select
            value={row.item_code}
            onChange={(e) => handleItemChange(e.target.value)}
            disabled={!row.item_group || itemsLoading}
            aria-invalid={itemError}
            className={selectCls(itemError, !row.item_group || itemsLoading)}
          >
            <option value="">
              {!row.item_group
                ? "Select group first"
                : itemsLoading
                ? "Loading items…"
                : groupItems.length === 0
                ? "No items available in this group."
                : "Select item…"}
            </option>
            {groupItems.map((item) => (
              <option key={item.item_code} value={item.item_code}>
                {item.item_name}
              </option>
            ))}
          </select>
        </SelectWrap>
        {row.item_group && itemsLoading && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading items…
          </div>
        )}
        {row.item_group && !itemsLoading && groupItems.length === 0 && (
          <p className="mt-1 text-[11px] text-warning-600">
            No items available in this group.
          </p>
        )}
        {itemError && (
          <p className="mt-1 text-[11px] text-danger-600">Required</p>
        )}
      </td>
      <td className="px-3 py-3 align-top min-w-[200px]">
        <input
          value={row.description}
          onChange={(e) => onChange({ description: e.target.value })}
          disabled={!row.item_code}
          placeholder="Auto-filled from item"
          className={inputCls(false, !row.item_code)}
        />
      </td>
      <td className="px-3 py-3 align-top w-[100px]">
        <input
          type="number"
          min={1}
          step="any"
          value={row.qty}
          onChange={(e) => onChange({ qty: Number(e.target.value) })}
          className={inputCls(qtyError) + " text-right tabular-nums"}
        />
        {qtyError && (
          <p className="mt-1 text-right text-[11px] text-danger-600">
            &gt; 0
          </p>
        )}
      </td>
      <td className="px-3 py-3 align-top w-[90px]">
        <input
          value={row.uom}
          readOnly
          tabIndex={-1}
          className={inputCls(false, true) + " text-center"}
        />
      </td>
      <td className="px-3 py-3 align-top text-right">
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Remove row"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-danger-50 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}
