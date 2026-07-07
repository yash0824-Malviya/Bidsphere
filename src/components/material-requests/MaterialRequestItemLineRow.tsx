import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import {
  getItemStockSummary,
  resolveStockStatusLabel,
  type ItemStockStatusLabel,
} from "../../api/materialRequestWorkflow";
import {
  getItemGroups,
  getItems,
  type ItemGroupOption,
  type ItemSearchResult,
} from "../../api/sourcing";
import { filterItemGroupsByProcurementType } from "../../config/materialRequestCategories";
import type { MaterialRequestProcurementType } from "../../types/materialRequestWorkflow";
import SearchableSelect, {
  type SearchableOption,
} from "./SearchableSelect";

export interface MaterialRequestDraftLine {
  id: string;
  item_group: string;
  item_code: string;
  item_name: string;
  description: string;
  qty: number;
  uom: string;
  schedule_date: string;
  remarks: string;
  /** True when the row was auto-generated from a BOM explosion. */
  generated?: boolean;
  /** Source BOM document name (present only for generated rows). */
  bom?: string;
}

const EMPTY_ITEMS: ItemSearchResult[] = [];
const EMPTY_GROUPS: ItemGroupOption[] = [];

interface Props {
  row: MaterialRequestDraftLine;
  rowNumber: number;
  showErrors: boolean;
  canRemove: boolean;
  usedItemCodes: ReadonlySet<string>;
  /**
   * Procurement Type of the parent request. Item Groups are filtered to the
   * matching category (Direct → manufacturing, Indirect → office/support).
   */
  procurementType: MaterialRequestProcurementType;
  /**
   * Whether warehouse stock columns (Current / Available / Status) are shown and
   * fetched. Department users never see warehouse inventory, so this is false
   * for them — no stock query runs at all.
   */
  showStock?: boolean;
  onChange: (patch: Partial<MaterialRequestDraftLine>) => void;
  onRemove: () => void;
}

const readOnlyCls =
  "h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-700";

const qtyInputCls = (hasError: boolean) =>
  [
    "h-10 w-full rounded-lg border bg-white px-3 text-sm shadow-sm transition",
    "focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
    hasError ? "border-danger-400" : "border-neutral-300 text-neutral-900",
  ].join(" ");

function StockStatusBadge({ status }: { status: ItemStockStatusLabel | "-" }) {
  if (status === "-") {
    return <span className="text-xs text-neutral-400">-</span>;
  }

  const styles: Record<ItemStockStatusLabel, string> = {
    "In Stock": "border-emerald-200 bg-emerald-50 text-emerald-800",
    "Low Stock": "border-amber-200 bg-amber-50 text-amber-800",
    "Out of Stock": "border-red-200 bg-red-50 text-red-800",
  };

  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function formatQty(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function MaterialRequestItemLineRow({
  row,
  rowNumber,
  showErrors,
  canRemove,
  usedItemCodes,
  procurementType,
  showStock = false,
  onChange,
  onRemove,
}: Props) {
  const groupError = showErrors && !row.item_group;
  const itemError = showErrors && !row.item_code;
  const qtyError = showErrors && !(row.qty > 0);

  // Item Groups — a single shared, cached fetch across every row.
  const groupsQuery = useQuery<ItemGroupOption[]>({
    queryKey: ["mr-item-groups"],
    queryFn: getItemGroups,
    staleTime: 5 * 60_000,
  });

  // Items scoped to the selected group. Cached per group so multiple rows using
  // the same group reuse one ERPNext call. Never runs until a group is chosen.
  const itemsQuery = useQuery<ItemSearchResult[]>({
    queryKey: ["mr-items-by-group", row.item_group],
    queryFn: () => getItems({ itemGroup: row.item_group, limit: 5000 }),
    enabled: !!row.item_group,
    staleTime: 60_000,
  });

  // Warehouse stock is only fetched when stock columns are visible. Department
  // users never trigger this query — they must not see warehouse inventory.
  const stockQuery = useQuery({
    queryKey: ["mr-item-stock", row.item_code],
    queryFn: () => getItemStockSummary(row.item_code),
    enabled: !!row.item_code && showStock,
    staleTime: 30_000,
  });

  const groups = groupsQuery.data ?? EMPTY_GROUPS;
  const items = itemsQuery.data ?? EMPTY_ITEMS;

  // Item Groups filtered to the request's Procurement Type — Direct shows
  // manufacturing categories, Indirect shows office/support categories.
  const visibleGroups = useMemo(
    () => filterItemGroupsByProcurementType(groups, procurementType),
    [groups, procurementType],
  );

  const groupOptions = useMemo<SearchableOption[]>(
    () =>
      visibleGroups.map((g) => ({
        value: g.name,
        label: g.item_group_name || g.name,
      })),
    [visibleGroups],
  );

  const itemOptions = useMemo<SearchableOption[]>(
    () =>
      items.map((it) => ({
        value: it.item_code,
        label: it.item_code,
        sublabel:
          it.item_name && it.item_name !== it.item_code
            ? it.item_name
            : undefined,
        detail: it.description,
        // Disabled when another row already uses this item (parent excludes the
        // current row's own code from `usedItemCodes`).
        disabled: usedItemCodes.has(it.item_code),
      })),
    [items, usedItemCodes],
  );

  const selectedGroupLabel = useMemo(() => {
    if (!row.item_group) return "";
    const match = groups.find((g) => g.name === row.item_group);
    return match?.item_group_name || row.item_group;
  }, [groups, row.item_group]);

  const selectedItemLabel = row.item_code
    ? row.item_name && row.item_name !== row.item_code
      ? `${row.item_code} - ${row.item_name}`
      : row.item_code
    : "";

  const stock = stockQuery.data;
  const stockStatus =
    row.item_code && stock
      ? resolveStockStatusLabel(stock.available_qty, row.qty)
      : "-";

  function handleGroupSelect(opt: SearchableOption) {
    if (opt.value === row.item_group) return;
    // Changing the group always clears the selected item (Req. 5).
    onChange({
      item_group: opt.value,
      item_code: "",
      item_name: "",
      description: "",
      uom: "Nos",
    });
  }

  function handleGroupClear() {
    onChange({
      item_group: "",
      item_code: "",
      item_name: "",
      description: "",
      uom: "Nos",
    });
  }

  function handleItemSelect(opt: SearchableOption) {
    if (usedItemCodes.has(opt.value)) {
      toast.error("This item has already been added.");
      return;
    }
    const item = items.find((it) => it.item_code === opt.value);
    if (!item) return;
    onChange({
      item_code: item.item_code,
      item_name: item.item_name,
      description: item.description ?? item.item_name,
      uom: item.uom,
    });
  }

  function handleItemClear() {
    onChange({ item_code: "", item_name: "", description: "", uom: "Nos" });
  }

  return (
    <tr className="h-14 border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60">
      <td className="w-[40px] px-2 py-2 align-middle">
        <div className="flex flex-col items-center justify-center gap-1">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-xs font-semibold text-neutral-600">
            {rowNumber}
          </span>
          {row.generated && (
            <span
              className="rounded-full bg-indigo-50 px-1.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600"
              title="Generated from BOM"
            >
              BOM
            </span>
          )}
        </div>
      </td>

      {/* Item Group — cascades into Item */}
      <td className="w-[220px] px-3 py-2 align-middle">
        <SearchableSelect
          options={groupOptions}
          selectedValue={row.item_group}
          selectedLabel={selectedGroupLabel}
          onSelect={handleGroupSelect}
          onClear={handleGroupClear}
          loading={groupsQuery.isLoading}
          error={groupsQuery.isError}
          invalid={groupError}
          placeholder="Search item group"
          ariaLabel={`Item group for row ${rowNumber}`}
          emptyText="No item groups available."
          errorText="Couldn't load item groups."
        />
      </td>

      {/* Item — disabled until a group is selected */}
      <td className="w-[300px] px-3 py-2 align-middle">
        <SearchableSelect
          options={itemOptions}
          selectedValue={row.item_code}
          selectedLabel={selectedItemLabel}
          onSelect={handleItemSelect}
          onClear={handleItemClear}
          disabled={!row.item_group}
          loading={itemsQuery.isLoading || itemsQuery.isFetching}
          error={itemsQuery.isError}
          invalid={itemError}
          placeholder="Type to search item"
          disabledPlaceholder="Select an item group first"
          ariaLabel={`Item for row ${rowNumber}`}
          emptyText="No items in this group."
          errorText="Couldn't load items."
        />
      </td>

      <td className="w-[360px] px-3 py-2 align-middle">
        <input
          readOnly
          value={row.description}
          placeholder="Auto-filled from item"
          className={readOnlyCls}
          tabIndex={-1}
        />
      </td>

      <td className="w-[90px] px-3 py-2 align-middle text-center">
        <input
          readOnly
          value={row.uom}
          className={`${readOnlyCls} text-center`}
          tabIndex={-1}
        />
      </td>

      <td className="w-[90px] px-3 py-2 align-middle">
        <input
          type="number"
          min={0.01}
          step="any"
          value={row.qty || ""}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({ qty: raw === "" ? 0 : Number(raw) });
          }}
          aria-invalid={qtyError}
          className={qtyInputCls(qtyError)}
        />
      </td>

      {showStock && (
        <>
          <td className="w-[110px] px-3 py-2 align-middle text-right tabular-nums text-sm text-neutral-700">
            {stockQuery.isLoading && row.item_code ? (
              <Loader2 className="ml-auto h-4 w-4 animate-spin text-neutral-400" />
            ) : stock ? (
              formatQty(stock.current_stock)
            ) : (
              "-"
            )}
          </td>

          <td className="w-[110px] px-3 py-2 align-middle text-right tabular-nums text-sm font-medium text-neutral-900">
            {stock ? formatQty(stock.available_qty) : "-"}
          </td>

          <td className="w-[120px] px-3 py-2 align-middle">
            <div className="flex items-center">
              <StockStatusBadge status={stockStatus} />
            </div>
          </td>
        </>
      )}

      <td className="w-[50px] px-2 py-2 align-middle">
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            className="rounded-lg p-2 text-neutral-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
            title="Remove line"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
