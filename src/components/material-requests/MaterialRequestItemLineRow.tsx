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
import type { ProcurementCategory } from "../../config/procurementCategory";
import {
  filterItemGroupsForMrPicker,
  itemGroupNamesForCategory,
} from "../../utils/procurementCategoryMatch";
import type {
  MaterialRequestMode,
  MaterialRequestProcurementType,
} from "../../types/materialRequestWorkflow";
import { usesItemMasterDropdowns } from "../../types/materialRequestWorkflow";
import type {
  EngineeringAttachment,
  PendingAttachment,
} from "../../utils/materialRequestItemFiles";
import UomSelect from "../UomSelect";
import ItemAttachmentsField from "./ItemAttachmentsField";
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
  /** Optional free-text part label (not Item Master). */
  part_name?: string;
  /** Persisted multi-file engineering attachments. */
  attachments?: EngineeringAttachment[];
  /** Local files waiting to upload after MR save. */
  pendingAttachments?: PendingAttachment[];
  /** True when attachments were edited and need sync. */
  attachmentsDirty?: boolean;
  /** @deprecated Prefer attachments[0].fileUrl — kept for sync/legacy. */
  drawing_2d_url?: string;
  /** @deprecated Prefer pendingAttachments. */
  drawing_2d_file?: File;
  /** @deprecated Prefer pendingAttachments. */
  drawing_2d_local_url?: string;
  /** @deprecated Prefer emptying attachments. */
  drawing_2d_clear?: boolean;
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
   * Request Type of the parent request (Direct / Indirect).
   */
  procurementType: MaterialRequestProcurementType;
  /** Selected procurement category — drives automatic item filtering. */
  procurementCategory?: ProcurementCategory | "";
  /**
   * Request Mode — Existing uses catalog/ERP dropdowns for Direct;
   * New and all Indirect modes use manual entry.
   */
  requestMode: MaterialRequestMode;
  /**
   * Whether warehouse stock columns (Current / Available / Status) are shown and
   * fetched. Department users never see warehouse inventory, so this is false
   * for them — no stock query runs at all.
   */
  showStock?: boolean;
  /** When true, attachments are view/download only (no upload/delete). */
  attachmentsReadOnly?: boolean;
  /** Per-file delete gate for persisted attachments. */
  canDeleteAttachment?: (att: EngineeringAttachment) => boolean;
  onChange: (patch: Partial<MaterialRequestDraftLine>) => void;
  onRemove: () => void;
}

const readOnlyCls =
  "h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-700";

const textInputCls = (hasError: boolean) =>
  [
    "h-10 w-full rounded-lg border bg-white px-3 text-sm shadow-sm transition",
    "focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
    hasError ? "border-danger-400" : "border-neutral-300 text-neutral-900",
  ].join(" ");

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
    "Reorder Required": "border-amber-200 bg-amber-50 text-amber-800",
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
  return Math.max(0, Number(value) || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

export default function MaterialRequestItemLineRow({
  row,
  rowNumber,
  showErrors,
  canRemove,
  usedItemCodes,
  procurementType,
  procurementCategory = "",
  requestMode,
  showStock = false,
  attachmentsReadOnly = false,
  canDeleteAttachment,
  onChange,
  onRemove,
}: Props) {
  const useDropdowns = usesItemMasterDropdowns(procurementType, requestMode);
  const groupError = showErrors && !row.item_group;
  const itemError = showErrors && !row.item_code;
  const nameError = showErrors && !useDropdowns && !row.item_name.trim();
  const qtyError = showErrors && !(row.qty > 0);

  const groupsQuery = useQuery<ItemGroupOption[]>({
    queryKey: ["item-groups", procurementType, procurementCategory],
    queryFn: () => getItemGroups(),
    enabled: useDropdowns,
    staleTime: 5 * 60_000,
  });

  const groups = groupsQuery.data ?? EMPTY_GROUPS;

  const filteredGroups = useMemo(
    () =>
      filterItemGroupsForMrPicker(groups, {
        procurementType,
        procurementCategory: procurementCategory as ProcurementCategory | "",
      }),
    [groups, procurementType, procurementCategory],
  );

  const categoryItemGroups = useMemo(
    () =>
      itemGroupNamesForCategory(
        groups,
        procurementCategory as ProcurementCategory | "",
      ),
    [groups, procurementCategory],
  );

  const groupOptions = useMemo<SearchableOption[]>(
    () =>
      filteredGroups.map((g) => ({
        value: g.name,
        label: g.item_group_name || g.name,
      })),
    [filteredGroups],
  );

  const itemsQuery = useQuery<ItemSearchResult[]>({
    queryKey: [
      "mr-items",
      procurementType,
      procurementCategory,
      row.item_group,
      categoryItemGroups.join("|"),
    ],
    queryFn: async () => {
      const pickerFilters = {
        limit: 500,
        procurementType,
        procurementCategory: procurementCategory || undefined,
        activeOnly: true,
      };
      if (row.item_group) {
        return getItems({ ...pickerFilters, itemGroup: row.item_group });
      }
      if (categoryItemGroups.length > 0) {
        return getItems({ ...pickerFilters, itemGroups: categoryItemGroups });
      }
      return [];
    },
    enabled:
      useDropdowns &&
      Boolean(row.item_group || categoryItemGroups.length > 0),
    staleTime: 60_000,
  });

  const items = itemsQuery.data ?? EMPTY_ITEMS;

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
        disabled: usedItemCodes.has(it.item_code),
      })),
    [items, usedItemCodes],
  );

  const stockQuery = useQuery({
    queryKey: ["mr-item-stock", row.item_code],
    queryFn: () => getItemStockSummary(row.item_code),
    enabled: !!row.item_code && showStock && useDropdowns,
    staleTime: 30_000,
  });

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
      item_group: item.item_group || row.item_group,
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
          {requestMode === "New" && (
            <span
              className="rounded-full bg-amber-50 px-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-700"
              title="New item"
            >
              New
            </span>
          )}
        </div>
      </td>

      {/* Item Group */}
      <td className="w-[220px] px-3 py-2 align-middle">
        {useDropdowns ? (
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
            emptyText={
              procurementCategory
                ? "No item groups for this procurement category."
                : "Select a procurement category first."
            }
            errorText="Couldn't load item groups."
          />
        ) : (
          <input
            value={row.item_group}
            onChange={(e) => onChange({ item_group: e.target.value })}
            placeholder="Item group"
            aria-invalid={groupError}
            className={textInputCls(groupError)}
          />
        )}
      </td>

      {/* Item code (+ name when manual) */}
      <td className="w-[300px] px-3 py-2 align-middle">
        {useDropdowns ? (
          <SearchableSelect
            options={itemOptions}
            selectedValue={row.item_code}
            selectedLabel={selectedItemLabel}
            onSelect={handleItemSelect}
            onClear={handleItemClear}
            disabled={
              !procurementCategory ||
              (!row.item_group && categoryItemGroups.length === 0)
            }
            loading={itemsQuery.isLoading || itemsQuery.isFetching}
            error={itemsQuery.isError}
            invalid={itemError}
            placeholder="Search by item code or name"
            disabledPlaceholder={
              !procurementCategory
                ? "Select a procurement category first"
                : "Select an item group first"
            }
            ariaLabel={`Item for row ${rowNumber}`}
            emptyText="No items in this group."
            errorText="Couldn't load items."
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <input
              value={row.item_code}
              onChange={(e) => onChange({ item_code: e.target.value })}
              placeholder={
                requestMode === "New" ? "Proposed item code" : "Item code"
              }
              aria-invalid={itemError}
              className={textInputCls(itemError)}
            />
            <input
              value={row.item_name}
              onChange={(e) => onChange({ item_name: e.target.value })}
              placeholder="Item name"
              aria-invalid={nameError}
              className={textInputCls(nameError)}
            />
          </div>
        )}
      </td>

      <td className="w-[360px] px-3 py-2 align-middle">
        {useDropdowns ? (
          <input
            readOnly
            value={row.description}
            placeholder="Auto-filled from item"
            className={readOnlyCls}
            tabIndex={-1}
          />
        ) : (
          <input
            value={row.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Description"
            className={textInputCls(false)}
          />
        )}
      </td>

      <td className="w-[90px] px-3 py-2 align-middle text-center">
        {useDropdowns ? (
          <input
            readOnly
            value={row.uom}
            className={`${readOnlyCls} text-center`}
            tabIndex={-1}
          />
        ) : (
          <UomSelect
            value={row.uom}
            onChange={(v) => onChange({ uom: v })}
            className={`${textInputCls(false)} text-center`}
            erpUoms={row.uom ? [row.uom] : []}
          />
        )}
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

      {/* Optional Part Name — free text, not Item Master */}
      <td className="w-[180px] px-3 py-2 align-middle">
        <input
          value={row.part_name ?? ""}
          onChange={(e) => onChange({ part_name: e.target.value })}
          placeholder="Optional"
          aria-label={`Part name for row ${rowNumber}`}
          className={textInputCls(false)}
        />
      </td>

      {/* Optional multi-file engineering attachments for this item row */}
      <td className="min-w-[240px] px-3 py-2 align-top">
        <ItemAttachmentsField
          rowNumber={rowNumber}
          attachments={row.attachments ?? []}
          pending={row.pendingAttachments ?? []}
          readOnly={attachmentsReadOnly}
          canDeleteAttachment={canDeleteAttachment}
          onChange={(next) =>
            onChange({
              attachments: next.attachments,
              pendingAttachments: next.pendingAttachments,
              attachmentsDirty: next.attachmentsDirty,
              drawing_2d_url: next.attachments[0]?.fileUrl,
              drawing_2d_clear:
                next.attachments.length === 0 &&
                next.pendingAttachments.length === 0,
            })
          }
        />
      </td>

      {showStock && (
        <>
          <td className="w-[90px] px-3 py-2 align-middle text-right tabular-nums text-sm text-neutral-700">
            {stockQuery.isLoading ? (
              <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-neutral-400" />
            ) : stock ? (
              formatQty(stock.current_stock)
            ) : (
              "—"
            )}
          </td>
          <td className="w-[90px] px-3 py-2 align-middle text-right tabular-nums text-sm text-neutral-700">
            {stock ? formatQty(stock.available_qty) : "—"}
          </td>
          <td className="w-[110px] px-3 py-2 align-middle">
            <StockStatusBadge status={stockStatus} />
          </td>
        </>
      )}

      <td className="w-[48px] px-2 py-2 align-middle">
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
            aria-label={`Remove row ${rowNumber}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  );
}
