import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Trash2,
} from "lucide-react";

import {
  getItemMasterForRfqLine,
  getItems,
  resolveItemUomProfile,
  type ItemGroupOption,
  type ItemSearchResult,
} from "../api/sourcing";
import { Drawing2dCell } from "./warehouse/EngineeringDocCells";
import ItemAttachmentsField from "./material-requests/ItemAttachmentsField";
import SearchableSelect from "./material-requests/SearchableSelect";
import { QTY_CHANGE_REASONS } from "../utils/rfqProcurementQty";
import type { PendingAttachment } from "../utils/materialRequestItemFiles";
import {
  canDeleteInheritedRfqAttachment,
  canEditInheritedRfqAttachment,
  INHERITED_MR_LINE_TOOLTIP,
  isInheritedMrRfqLine,
  PROCUREMENT_RFQ_ADDON_DOCUMENT_TYPES,
} from "../utils/rfqItemEditRules";
import {
  hasItemMasterUom,
  ITEM_MASTER_UOM_MISSING_MESSAGE,
} from "../utils/itemMasterUom";
import type { ProcurementCategory } from "../config/procurementCategory";
import {
  filterItemGroupsForMrPicker,
  itemGroupNamesForCategory,
} from "../utils/procurementCategoryMatch";
import {
  usesItemMasterDropdowns,
  type MaterialRequestMode,
  type MaterialRequestProcurementType,
} from "../types/materialRequestWorkflow";
import {
  convertQtyBetweenUoms,
  erpConversionFactorForUom,
  type CompatibleUomOption,
} from "../utils/itemUomConversions";
import UomSelect from "./UomSelect";

export interface RFQItemLine {
  id: string;
  item_group: string;
  item_code: string;
  item_name: string;
  description: string;
  qty: number;
  uom: string;
  /** Item Master stock UOM (primary). */
  primary_uom?: string;
  /** ERPNext factor: qty × factor = qty in stock_uom. */
  uom_conversion_factor?: number;
  /** Compatible UOM choices from Item Master + UOM group. */
  compatible_uoms?: CompatibleUomOption[];
  /** Department original request (read-only when from MR). */
  department_requested_qty?: number | null;
  /** Warehouse available at forward (read-only when from MR). */
  warehouse_available_qty?: number | null;
  /** Reason when procurement final qty differs from department request. */
  qty_change_reason?: string | null;
  /** Target unit price — set at RFQ creation; analyzed later (read-only). */
  target_price?: number | null;
  /** Per-line: show Target Price to invited suppliers. */
  show_to_supplier?: boolean;
  /** Required-by / schedule date (YYYY-MM-DD). */
  required_by?: string;
  /** Optional engineering docs from MR (read-only on RFQ). */
  part_name?: string;
  drawing_2d_url?: string;
  attachments?: import("../utils/materialRequestItemFiles").EngineeringAttachment[];
  attachment_name?: string;
  attachment_url?: string;
  attachment_type?: string;
  /** True when line was prefilled from a forwarded Material Request. */
  inherited_from_mr?: boolean;
  /** Linked Material Request (read-only on inherited lines). */
  material_request?: string;
  material_request_item?: string;
  /** Warehouse at forward time (read-only on inherited lines). */
  warehouse?: string;
  pendingAttachments?: PendingAttachment[];
  attachmentsDirty?: boolean;
}

interface Props {
  row: RFQItemLine;
  rowNumber: number;
  itemGroups: ItemGroupOption[];
  groupsLoading: boolean;
  showErrors: boolean;
  canRemove: boolean;
  /** Admin / warehouse may override Item Master UOM on manual lines. */
  canEditItemMasterUom?: boolean;
  /** When set, item pickers follow MR-style category + request mode rules. */
  procurementType?: MaterialRequestProcurementType;
  procurementCategory?: string;
  requestMode?: MaterialRequestMode;
  onChange: (patch: Partial<RFQItemLine>) => void;
  onRemove: () => void;
}

const QTY_INPUT =
  "h-9 w-full max-w-[4.5rem] rounded-lg border px-2 text-center text-sm font-semibold tabular-nums shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[#1F3A6D]/20";

const CELL_INPUT =
  "h-9 w-full min-w-0 rounded-lg border border-[#E2E8F0] bg-white px-2 text-[13px] text-[#0F172A] shadow-sm transition focus:border-[#1F3A6D] focus:outline-none focus:ring-2 focus:ring-[#1F3A6D]/20";

const CELL_SELECT =
  "h-9 w-full min-w-0 appearance-none rounded-lg border border-[#E2E8F0] bg-white px-2 pr-7 text-[13px] text-[#0F172A] shadow-sm transition focus:border-[#1F3A6D] focus:outline-none focus:ring-2 focus:ring-[#1F3A6D]/20";

const FIELD_INPUT =
  "h-11 w-full rounded-xl border border-[#E2E8F0] bg-white px-3 text-[15px] text-[#0F172A] shadow-sm transition focus:border-[#1F3A6D] focus:outline-none focus:ring-2 focus:ring-[#1F3A6D]/20";

const READONLY_FIELD =
  "h-11 w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-[15px] text-[#475569] shadow-sm cursor-default";

const DETAIL_LABEL = "mb-1 block text-[13px] font-medium text-[#475569]";

function DetailLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className={`${DETAIL_LABEL} flex items-center gap-1.5`}>
      <span>{children}</span>
      {hint}
    </div>
  );
}

const UOM_INPUT_CLS =
  "h-11 w-full rounded-xl border bg-white pl-8 pr-9 text-[15px] shadow-sm transition focus:border-[#1F3A6D] focus:outline-none focus:ring-2 focus:ring-[#1F3A6D]/20";

function uomSearchOptions(
  compatible: CompatibleUomOption[] | undefined,
): Array<{ value: string; label: string }> {
  return (compatible ?? []).map((opt) => ({
    value: opt.uom,
    label: opt.is_primary ? `${opt.uom} (Default)` : opt.uom,
  }));
}

function RfqUomSelect({
  row,
  disabled,
  loading,
  invalid,
  onChange,
}: {
  row: RFQItemLine;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  onChange: (patch: Partial<RFQItemLine>) => void;
}) {
  const options = uomSearchOptions(row.compatible_uoms);
  const hasAlternates = options.length > 1;
  const uomMissing = !!row.item_code && !hasItemMasterUom(row.uom);

  function handleSelect(nextUom: string) {
    if (!nextUom || nextUom === row.uom) return;
    const list = row.compatible_uoms ?? [];
    const factor = erpConversionFactorForUom(nextUom, list);
    const nextQty = convertQtyBetweenUoms(
      Number(row.qty) || 0,
      row.uom,
      nextUom,
      list,
    );
    onChange({
      uom: nextUom,
      uom_conversion_factor: factor,
      qty: nextQty > 0 ? nextQty : row.qty,
    });
  }

  return (
    <>
      <SearchableSelect
        options={options}
        selectedValue={row.uom}
        selectedLabel={row.uom}
        disabled={disabled || !row.item_code || !hasAlternates}
        loading={loading}
        invalid={invalid}
        placeholder="Select UOM…"
        disabledPlaceholder={
          !row.item_code
            ? "Select item first"
            : row.uom || "No UOM configured"
        }
        loadingPlaceholder="Loading UOMs…"
        ariaLabel="Unit of Measure"
        emptyText="No compatible UOMs."
        inputClassName={`${UOM_INPUT_CLS} ${
          invalid ? "border-rose-400" : "border-[#E2E8F0]"
        } ${disabled || !row.item_code || !hasAlternates ? "cursor-not-allowed bg-[#F8FAFC] text-[#64748B]" : "text-[#0F172A]"}`}
        onSelect={(opt) => handleSelect(opt.value)}
      />
      {uomMissing ? (
        <p className="mt-1.5 text-[12px] font-medium text-amber-700">
          {ITEM_MASTER_UOM_MISSING_MESSAGE}
        </p>
      ) : null}
    </>
  );
}

function PartNumberValue({ value }: { value?: string | null }) {
  const text = value?.trim();
  if (!text) {
    return (
      <p className="flex min-h-[44px] items-center text-[15px] text-[#94A3B8]">
        No Part Number Available
      </p>
    );
  }
  return (
    <p
      className="flex min-h-[44px] items-center text-[15px] text-[#0F172A]"
      title={text}
    >
      {text}
    </p>
  );
}

function LockedFieldHint({ title }: { title: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center text-[#64748B]"
      title={title}
      aria-label={title}
    >
      <Lock className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}
const SELECT_CLS = (hasError: boolean, disabled?: boolean) =>
  [
    FIELD_INPUT,
    "appearance-none pr-9",
    hasError ? "border-rose-400" : "",
    disabled ? "cursor-not-allowed bg-[#F8FAFC] text-[#94A3B8]" : "",
  ]
    .filter(Boolean)
    .join(" ");

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
          disabled ? "text-[#CBD5E1]" : "text-[#94A3B8]"
        }`}
      />
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#1F3A6D]/30 ${
        checked ? "bg-[#1F3A6D]" : "bg-[#CBD5E1]"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function RFQItemLineRow({
  row,
  rowNumber,
  itemGroups,
  groupsLoading,
  showErrors,
  canRemove,
  canEditItemMasterUom: _canEditItemMasterUom,
  procurementType,
  procurementCategory = "",
  requestMode,
  onChange,
  onRemove,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [itemResolving, setItemResolving] = useState(false);
  const isLocked = isInheritedMrRfqLine(row);
  const lockTooltip = INHERITED_MR_LINE_TOOLTIP;
  const directPickerActive =
    procurementType != null && requestMode != null && !isLocked;
  const useDropdowns = directPickerActive
    ? usesItemMasterDropdowns(procurementType, requestMode)
    : true;
  const uomMissing =
    useDropdowns && !!row.item_code && !hasItemMasterUom(row.uom);
  const uomError = showErrors && uomMissing;

  const filteredGroups = useMemo(
    () =>
      directPickerActive
        ? filterItemGroupsForMrPicker(itemGroups, {
            procurementType,
            procurementCategory: procurementCategory as ProcurementCategory | "",
          })
        : itemGroups,
    [directPickerActive, itemGroups, procurementCategory, procurementType],
  );

  const categoryItemGroups = useMemo(
    () =>
      directPickerActive
        ? itemGroupNamesForCategory(
            itemGroups,
            procurementCategory as ProcurementCategory | "",
          )
        : [],
    [directPickerActive, itemGroups, procurementCategory],
  );

  const groupError = showErrors && !row.item_group;
  const itemError = showErrors && !row.item_code;
  const nameError = showErrors && !useDropdowns && !row.item_name.trim();
  const qtyError = showErrors && !(row.qty > 0);
  const deptQty =
    row.department_requested_qty != null &&
    Number.isFinite(Number(row.department_requested_qty))
      ? Number(row.department_requested_qty)
      : null;
  const whAvail =
    row.warehouse_available_qty != null &&
    Number.isFinite(Number(row.warehouse_available_qty))
      ? Math.max(0, Number(row.warehouse_available_qty))
      : null;
  const requestedDisplay = deptQty ?? row.qty;
  const qtyChanged =
    deptQty != null && Number.isFinite(deptQty) && Math.abs(deptQty - row.qty) > 1e-9;
  const reasonError = showErrors && qtyChanged && !String(row.qty_change_reason || "").trim();
  const hasShortage =
    whAvail != null &&
    requestedDisplay > 0 &&
    whAvail + 1e-9 < requestedDisplay;

  const itemsQuery = useQuery<ItemSearchResult[]>({
    queryKey: [
      "rfq-items-by-group",
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
      !isLocked &&
      useDropdowns &&
      (!!row.item_group ||
        (directPickerActive &&
          categoryItemGroups.length > 0 &&
          !!procurementCategory)),
    staleTime: 60_000,
  });

  const groupItems = itemsQuery.data ?? [];
  const itemsLoading = itemsQuery.isLoading || itemsQuery.isFetching;

  const uomProfileQuery = useQuery({
    queryKey: ["item-uom-profile", row.item_code],
    queryFn: () => resolveItemUomProfile(row.item_code),
    enabled: !!row.item_code && !(row.compatible_uoms?.length ?? 0),
    staleTime: 300_000,
  });

  useEffect(() => {
    const profile = uomProfileQuery.data;
    if (!profile || (row.compatible_uoms?.length ?? 0) > 0) return;
    const defaultUom = profile.default_uom ?? profile.primary_uom;
    onChange({
      primary_uom: defaultUom,
      compatible_uoms: profile.compatible_uoms ?? profile.options,
      uom: defaultUom,
      uom_conversion_factor: 1,
    });
    // Hydrate compatible UOM list once per item — avoid fighting user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uomProfileQuery.data, row.item_code]);

  function handleGroupChange(itemGroup: string) {
    if (isLocked) return;
    onChange({
      item_group: itemGroup,
      item_code: "",
      item_name: "",
      description: "",
      uom: "",
      primary_uom: undefined,
      uom_conversion_factor: 1,
      compatible_uoms: [],
      part_name: undefined,
    });
  }

  async function handleItemChange(itemCode: string) {
    if (isLocked) return;
    if (!itemCode) {
      onChange({
        item_code: "",
        item_name: "",
        description: "",
        uom: "",
        primary_uom: undefined,
        uom_conversion_factor: 1,
        compatible_uoms: [],
        part_name: undefined,
      });
      return;
    }

    setItemResolving(true);
    try {
      const detail = await getItemMasterForRfqLine(itemCode);
      if (detail) {
        onChange({
          item_code: detail.item_code,
          item_name: detail.item_name,
          description: detail.description ?? detail.item_name,
          uom: detail.default_uom || detail.uom,
          primary_uom: detail.default_uom || detail.primary_uom,
          uom_conversion_factor: detail.uom_conversion_factor,
          compatible_uoms: detail.compatible_uoms,
          item_group: detail.item_group || row.item_group,
          part_name: detail.part_name ?? undefined,
        });
        return;
      }

      const item = groupItems.find((i) => i.item_code === itemCode);
      if (!item) {
        onChange({
          item_code: "",
          item_name: "",
          description: "",
          uom: "",
          primary_uom: undefined,
          uom_conversion_factor: 1,
          compatible_uoms: [],
          part_name: undefined,
        });
        return;
      }
      onChange({
        item_code: item.item_code,
        item_name: item.item_name,
        description: item.description ?? item.item_name,
        uom: item.uom,
        primary_uom: item.uom,
        uom_conversion_factor: 1,
        compatible_uoms: [],
        item_group: item.item_group || row.item_group,
        part_name: item.part_name ?? undefined,
      });
    } finally {
      setItemResolving(false);
    }
  }

  function handleMainUomChange(nextUom: string) {
    if (!nextUom || nextUom === row.uom) return;
    const list = row.compatible_uoms ?? [];
    const factor = erpConversionFactorForUom(nextUom, list);
    const nextQty = convertQtyBetweenUoms(
      Number(row.qty) || 0,
      row.uom,
      nextUom,
      list,
    );
    onChange({
      uom: nextUom,
      uom_conversion_factor: factor,
      qty: nextQty > 0 ? nextQty : row.qty,
    });
  }

  const uomOptions = row.compatible_uoms ?? [];
  const canPickUom =
    !isLocked && !!row.item_code && useDropdowns && uomOptions.length > 1;

  return (
    <Fragment>
      <tr className="group border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]/80">
        {/* # */}
        <td className="px-2 py-2 align-middle text-center">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-xs font-semibold text-neutral-600">
            {rowNumber}
          </span>
        </td>

        {/* Item Group */}
        <td className="px-2 py-2 align-middle">
          {isLocked ? (
            <p
              className="truncate text-[13px] font-medium text-[#0F172A]"
              title={row.item_group || undefined}
            >
              {row.item_group || "—"}
            </p>
          ) : useDropdowns ? (
            <div className="relative min-w-0">
              <select
                value={row.item_group}
                onChange={(e) => handleGroupChange(e.target.value)}
                disabled={groupsLoading}
                aria-invalid={groupError}
                aria-label={`Item group for row ${rowNumber}`}
                className={`${CELL_SELECT} ${
                  groupError ? "border-rose-400" : ""
                } ${groupsLoading ? "cursor-not-allowed bg-[#F8FAFC] text-[#94A3B8]" : ""}`}
              >
                <option value="">
                  {groupsLoading ? "Loading…" : "Select group…"}
                </option>
                {filteredGroups.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.item_group_name ?? g.name}
                  </option>
                ))}
                {row.item_group &&
                  !filteredGroups.some(
                    (g) =>
                      g.name === row.item_group ||
                      g.item_group_name === row.item_group,
                  ) && (
                    <option value={row.item_group}>{row.item_group}</option>
                  )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
            </div>
          ) : (
            <input
              value={row.item_group}
              onChange={(e) => onChange({ item_group: e.target.value })}
              placeholder="Item group"
              aria-invalid={groupError}
              aria-label={`Item group for row ${rowNumber}`}
              className={`${CELL_INPUT} ${groupError ? "border-rose-400" : ""}`}
            />
          )}
        </td>

        {/* Item */}
        <td className="px-2 py-2 align-middle">
          {isLocked ? (
            <div className="min-w-0">
              <p
                className="truncate text-[13px] font-semibold text-[#0F172A]"
                title={row.item_name || row.item_code || undefined}
              >
                {row.item_name || row.item_code || "—"}
              </p>
              {row.item_code ? (
                <p className="truncate font-mono text-[11px] text-[#64748B]">
                  {row.item_code}
                </p>
              ) : null}
            </div>
          ) : useDropdowns ? (
            <div className="relative min-w-0">
              <select
                value={row.item_code}
                onChange={(e) => void handleItemChange(e.target.value)}
                disabled={
                  (directPickerActive && !procurementCategory) ||
                  (!row.item_group && categoryItemGroups.length === 0) ||
                  itemsLoading ||
                  itemResolving
                }
                aria-invalid={itemError}
                aria-label={`Item for row ${rowNumber}`}
                className={`${CELL_SELECT} ${
                  itemError ? "border-rose-400" : ""
                }`}
              >
                <option value="">
                  {itemsLoading || itemResolving
                    ? "Loading…"
                    : !row.item_group && categoryItemGroups.length === 0
                      ? "Select group first"
                      : "Select item…"}
                </option>
                {groupItems.map((item) => (
                  <option key={item.item_code} value={item.item_code}>
                    {item.item_name}
                  </option>
                ))}
                {row.item_code &&
                  !groupItems.some((i) => i.item_code === row.item_code) && (
                    <option value={row.item_code}>
                      {row.item_name || row.item_code}
                    </option>
                  )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-1">
              <input
                value={row.item_code}
                onChange={(e) => onChange({ item_code: e.target.value })}
                placeholder="Item code"
                aria-invalid={itemError}
                className={`${CELL_INPUT} ${itemError ? "border-rose-400" : ""}`}
              />
              <input
                value={row.item_name}
                onChange={(e) => onChange({ item_name: e.target.value })}
                placeholder="Item name"
                aria-invalid={nameError}
                className={`${CELL_INPUT} ${nameError ? "border-rose-400" : ""}`}
              />
            </div>
          )}
        </td>

        {/* Qty */}
        <td className="px-2 py-2 align-middle text-right">
          <div className="flex justify-end">
            <input
              type="number"
              min={1}
              step="any"
              value={row.qty}
              onChange={(e) => {
                const n = Number(e.target.value);
                const nextQty = Number.isFinite(n) ? n : 0;
                const changed =
                  deptQty != null && Math.abs(deptQty - nextQty) > 1e-9;
                onChange({
                  qty: nextQty,
                  qty_change_reason: changed ? row.qty_change_reason : null,
                });
              }}
              title={
                hasShortage
                  ? `Shortage — Available: ${whAvail ?? "—"} / Requested: ${deptQty ?? row.qty}`
                  : "Procurement Final RFQ Qty"
              }
              aria-invalid={qtyError}
              className={`${QTY_INPUT} ml-auto border-[#E2E8F0] bg-white text-[#0F172A] focus:border-[#1F3A6D] ${
                qtyError ? "border-rose-400 ring-1 ring-rose-200" : ""
              }`}
            />
          </div>
        </td>

        {/* UOM */}
        <td className="px-2 py-2 align-middle text-center">
          {canPickUom ? (
            <div className="relative mx-auto max-w-full">
              <select
                value={row.uom}
                onChange={(e) => handleMainUomChange(e.target.value)}
                aria-label={`UOM for row ${rowNumber}`}
                aria-invalid={uomError}
                className={`${CELL_SELECT} text-center ${
                  uomError ? "border-rose-400" : ""
                }`}
              >
                {uomOptions.map((opt) => (
                  <option key={opt.uom} value={opt.uom}>
                    {opt.uom}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
            </div>
          ) : !useDropdowns && !isLocked ? (
            <UomSelect
              value={row.uom}
              onChange={(v) => onChange({ uom: v })}
              className={`${CELL_INPUT} text-center`}
              erpUoms={row.uom ? [row.uom] : []}
            />
          ) : (
            <span
              className={`block truncate text-[13px] font-medium tabular-nums ${
                uomError || uomMissing ? "text-amber-700" : "text-[#0F172A]"
              }`}
              title={row.uom || undefined}
            >
              {row.uom || "—"}
            </span>
          )}
        </td>

        {/* Required By */}
        <td className="px-2 py-2 align-middle">
          <input
            type="date"
            value={row.required_by ?? ""}
            onChange={(e) => onChange({ required_by: e.target.value })}
            className={CELL_INPUT}
            aria-label={`Required by for row ${rowNumber}`}
          />
        </td>

        {/* Target Price */}
        <td className="px-2 py-2 align-middle">
          <div className="relative min-w-0">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] font-medium text-[#64748B]">
              $
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={row.target_price ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  onChange({ target_price: null });
                  return;
                }
                const n = Number(raw);
                onChange({
                  target_price: Number.isFinite(n) && n > 0 ? n : null,
                });
              }}
              placeholder="0.00"
              title="Target Price ($)"
              aria-label={`Target price for row ${rowNumber}`}
              className={`${CELL_INPUT} pl-5 text-right tabular-nums`}
            />
          </div>
        </td>

        {/* Show to Supplier */}
        <td className="px-2 py-2 align-middle text-center">
          <div className="flex justify-center">
            <ToggleSwitch
              checked={!!row.show_to_supplier}
              onChange={(next) => onChange({ show_to_supplier: next })}
              label={`Show Target Price to Supplier for row ${rowNumber}`}
            />
          </div>
        </td>

        {/* Part Name */}
        <td className="px-2 py-2 align-middle">
          <p
            className="truncate text-[13px] text-[#0F172A]"
            title={row.part_name?.trim() || undefined}
          >
            {row.part_name?.trim() || (
              <span className="text-[#94A3B8]">—</span>
            )}
          </p>
        </td>

        {/* Actions */}
        <td className="px-2 py-2 align-middle">
          <div className="flex items-center justify-center gap-0.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse details" : "Expand details"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#64748B] transition hover:bg-[#F1F5F9] hover:text-[#1F3A6D]"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={!canRemove}
              aria-label="Remove row"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#94A3B8] transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>

      {expanded ? (
        <tr className="border-b border-[#F1F5F9]">
          <td colSpan={10} className="border-t-2 border-[#1F3A6D]/10 bg-[#F8FAFC]/50 px-4 py-3 sm:px-6">
            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
              <h4 className="text-[18px] font-semibold text-[#1F3A6D]">
                Item Details
              </h4>

              {/* Item Information */}
              <div className="mt-4 space-y-4">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-[#64748B]">
                  Item Information
                </p>

                {isLocked ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <DetailLabel hint={<LockedFieldHint title={lockTooltip} />}>
                        Item Name
                      </DetailLabel>
                      <input
                        value={row.item_name || row.item_code}
                        readOnly
                        tabIndex={-1}
                        className={READONLY_FIELD}
                      />
                    </div>
                    <div>
                      <DetailLabel hint={<LockedFieldHint title={lockTooltip} />}>
                        Item Code
                      </DetailLabel>
                      <input
                        value={row.item_code}
                        readOnly
                        tabIndex={-1}
                        className={`${READONLY_FIELD} font-mono`}
                      />
                    </div>
                    <div>
                      <DetailLabel hint={<LockedFieldHint title={lockTooltip} />}>
                        UOM
                      </DetailLabel>
                      <RfqUomSelect
                        row={row}
                        disabled
                        loading={uomProfileQuery.isLoading}
                        invalid={uomError}
                        onChange={onChange}
                      />
                    </div>
                    <div>
                      <DetailLabel>Part Number</DetailLabel>
                      <PartNumberValue value={row.part_name} />
                    </div>
                    <div>
                      <DetailLabel hint={<LockedFieldHint title={lockTooltip} />}>
                        Material Request
                      </DetailLabel>
                      <input
                        value={row.material_request ?? "—"}
                        readOnly
                        tabIndex={-1}
                        className={`${READONLY_FIELD} font-mono text-[13px]`}
                      />
                    </div>
                    <div>
                      <DetailLabel hint={<LockedFieldHint title={lockTooltip} />}>
                        Warehouse
                      </DetailLabel>
                      <input
                        value={row.warehouse ?? "—"}
                        readOnly
                        tabIndex={-1}
                        className={READONLY_FIELD}
                      />
                    </div>
                    <div>
                      <DetailLabel hint={<LockedFieldHint title={lockTooltip} />}>
                        Dept. Requested Qty
                      </DetailLabel>
                      <input
                        value={deptQty ?? "—"}
                        readOnly
                        tabIndex={-1}
                        className={`${READONLY_FIELD} text-center tabular-nums`}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 sm:col-span-2">
                      <div>
                        <p className="text-[13px] font-medium text-[#334155]">
                          Show Target Price to Supplier
                        </p>
                        <p className="text-[12px] text-[#64748B]">
                          Share target price on the RFQ
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={!!row.show_to_supplier}
                        onChange={(next) => onChange({ show_to_supplier: next })}
                        label={`Show Target Price to Supplier for ${row.item_code || "line"}`}
                      />
                    </div>
                    {row.description &&
                    row.description !== row.item_name ? (
                      <div className="sm:col-span-2">
                        <DetailLabel>Description</DetailLabel>
                        <p className="text-[15px] leading-relaxed text-[#475569]">
                          {row.description}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : useDropdowns ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <DetailLabel>
                        Item Group <span className="text-rose-500">*</span>
                      </DetailLabel>
                      <SelectWrap disabled={groupsLoading}>
                        <select
                          value={row.item_group}
                          onChange={(e) => handleGroupChange(e.target.value)}
                          disabled={groupsLoading}
                          aria-invalid={groupError}
                          className={SELECT_CLS(groupError, groupsLoading)}
                        >
                          <option value="">
                            {groupsLoading
                              ? "Loading groups…"
                              : directPickerActive && !procurementCategory
                                ? "Select procurement category first"
                                : "Select group…"}
                          </option>
                          {filteredGroups.map((g) => (
                            <option key={g.name} value={g.name}>
                              {g.item_group_name ?? g.name}
                            </option>
                          ))}
                          {row.item_group &&
                            !filteredGroups.some(
                              (g) =>
                                g.name === row.item_group ||
                                g.item_group_name === row.item_group,
                            ) && (
                              <option key={row.item_group} value={row.item_group}>
                                {row.item_group}
                              </option>
                            )}
                        </select>
                      </SelectWrap>
                    </div>

                    <div>
                      <DetailLabel>
                        Item <span className="text-rose-500">*</span>
                      </DetailLabel>
                      <SelectWrap
                        disabled={
                          (directPickerActive && !procurementCategory) ||
                          (!row.item_group && categoryItemGroups.length === 0) ||
                          itemsLoading ||
                          itemResolving
                        }
                      >
                        <select
                          value={row.item_code}
                          onChange={(e) => void handleItemChange(e.target.value)}
                          disabled={
                            (directPickerActive && !procurementCategory) ||
                            (!row.item_group && categoryItemGroups.length === 0) ||
                            itemsLoading ||
                            itemResolving
                          }
                          aria-invalid={itemError}
                          className={SELECT_CLS(
                            itemError,
                            (directPickerActive && !procurementCategory) ||
                              (!row.item_group && categoryItemGroups.length === 0) ||
                              itemsLoading ||
                              itemResolving,
                          )}
                        >
                          <option value="">
                            {directPickerActive && !procurementCategory
                              ? "Select procurement category first"
                              : !row.item_group && categoryItemGroups.length === 0
                                ? "Select group first"
                                : itemsLoading
                                  ? "Loading items…"
                                  : groupItems.length === 0 && !row.item_code
                                    ? "No items in group"
                                    : "Select item…"}
                          </option>
                          {groupItems.map((item) => (
                            <option key={item.item_code} value={item.item_code}>
                              {item.item_name}
                            </option>
                          ))}
                          {row.item_code &&
                            !groupItems.some(
                              (i) => i.item_code === row.item_code,
                            ) && (
                              <option key={row.item_code} value={row.item_code}>
                                {row.item_name || row.item_code}
                              </option>
                            )}
                        </select>
                      </SelectWrap>
                      {(row.item_group && itemsLoading) || itemResolving ? (
                        <div className="mt-1 flex items-center gap-1 text-[12px] text-[#64748B]">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {itemResolving
                            ? "Loading item details…"
                            : "Loading items…"}
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <DetailLabel>UOM</DetailLabel>
                      <RfqUomSelect
                        row={row}
                        loading={
                          uomProfileQuery.isLoading || itemResolving
                        }
                        invalid={uomError}
                        onChange={onChange}
                      />
                    </div>

                    <div>
                      <DetailLabel>Part Number</DetailLabel>
                      <PartNumberValue value={row.part_name} />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 sm:col-span-2">
                      <div>
                        <p className="text-[13px] font-medium text-[#334155]">
                          Show Target Price to Supplier
                        </p>
                        <p className="text-[12px] text-[#64748B]">
                          Share target price on the RFQ
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={!!row.show_to_supplier}
                        onChange={(next) => onChange({ show_to_supplier: next })}
                        label={`Show Target Price to Supplier for ${row.item_code || "line"}`}
                      />
                    </div>

                    {row.description ? (
                      <div className="sm:col-span-2">
                        <DetailLabel>Description</DetailLabel>
                        <p className="text-[15px] leading-relaxed text-[#475569]">
                          {row.description}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <DetailLabel>
                        Item Group <span className="text-rose-500">*</span>
                      </DetailLabel>
                      <input
                        value={row.item_group}
                        onChange={(e) =>
                          onChange({ item_group: e.target.value })
                        }
                        placeholder="Item group"
                        aria-invalid={groupError}
                        className={FIELD_INPUT}
                      />
                    </div>
                    <div>
                      <DetailLabel>
                        Item Code <span className="text-rose-500">*</span>
                      </DetailLabel>
                      <input
                        value={row.item_code}
                        onChange={(e) =>
                          onChange({ item_code: e.target.value })
                        }
                        placeholder="Proposed item code"
                        aria-invalid={itemError}
                        className={FIELD_INPUT}
                      />
                    </div>
                    <div>
                      <DetailLabel>
                        Item Name <span className="text-rose-500">*</span>
                      </DetailLabel>
                      <input
                        value={row.item_name}
                        onChange={(e) =>
                          onChange({ item_name: e.target.value })
                        }
                        placeholder="Item name"
                        aria-invalid={nameError}
                        className={FIELD_INPUT}
                      />
                    </div>
                    <div>
                      <DetailLabel>UOM</DetailLabel>
                      <UomSelect
                        value={row.uom}
                        onChange={(v) => onChange({ uom: v })}
                        className={FIELD_INPUT}
                        erpUoms={row.uom ? [row.uom] : []}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <DetailLabel>Description</DetailLabel>
                      <input
                        value={row.description}
                        onChange={(e) =>
                          onChange({ description: e.target.value })
                        }
                        placeholder="Description"
                        className={FIELD_INPUT}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 sm:col-span-2">
                      <div>
                        <p className="text-[13px] font-medium text-[#334155]">
                          Show Target Price to Supplier
                        </p>
                        <p className="text-[12px] text-[#64748B]">
                          Share target price on the RFQ
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={!!row.show_to_supplier}
                        onChange={(next) => onChange({ show_to_supplier: next })}
                        label={`Show Target Price to Supplier for ${row.item_code || "line"}`}
                      />
                    </div>
                  </div>
                )}
              </div>

              {qtyChanged ? (
                <div className="mt-4 border-t border-[#E2E8F0] pt-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <DetailLabel>
                        Qty Change Reason{" "}
                        <span className="text-rose-500">*</span>
                      </DetailLabel>
                      <SelectWrap>
                        <select
                          value={row.qty_change_reason || ""}
                          onChange={(e) =>
                            onChange({
                              qty_change_reason: e.target.value || null,
                            })
                          }
                          aria-invalid={reasonError}
                          className={SELECT_CLS(reasonError)}
                          title="Reason for quantity change"
                        >
                          <option value="">Select reason…</option>
                          {QTY_CHANGE_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </SelectWrap>
                      {reasonError ? (
                        <p className="mt-1.5 text-[12px] text-rose-600">
                          Required when Final Qty differs from Requested Qty
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Documents */}
              <div className="mt-4 border-t border-[#E2E8F0] pt-4">
                <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#64748B]">
                  {isLocked ? "Documents & Attachments" : "Attachments"}
                </p>
                {isLocked ? (
                  <p className="mb-3 text-[13px] text-[#64748B]">
                    Inherited files are read-only. Add procurement documents
                    below — existing files are never removed.
                  </p>
                ) : null}
                <ItemAttachmentsField
                  variant="enterprise"
                  rowNumber={rowNumber}
                  attachments={row.attachments ?? []}
                  pending={row.pendingAttachments ?? []}
                  canDeleteAttachment={
                    isLocked ? canDeleteInheritedRfqAttachment : undefined
                  }
                  canEditAttachment={
                    isLocked ? canEditInheritedRfqAttachment : undefined
                  }
                  documentTypes={
                    isLocked ? PROCUREMENT_RFQ_ADDON_DOCUMENT_TYPES : undefined
                  }
                  onChange={({
                    attachments,
                    pendingAttachments,
                    attachmentsDirty,
                  }) =>
                    onChange({
                      attachments,
                      pendingAttachments,
                      attachmentsDirty,
                    })
                  }
                />
                {!isLocked &&
                row.drawing_2d_url &&
                (row.attachments?.length ?? 0) === 0 &&
                !(row.pendingAttachments?.length ?? 0) ? (
                  <div className="mt-3">
                    <Drawing2dCell
                      url={row.drawing_2d_url}
                      attachments={row.attachments}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}

      {/* Qty reason hint on main row when changed but collapsed */}
      {qtyChanged && !expanded ? (
        <tr className="border-b border-[#F1F5F9] bg-amber-50/40">
          <td colSpan={10} className="px-4 py-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-[12px] font-medium text-amber-800 underline-offset-2 hover:underline"
            >
              Final Qty differs from Requested — expand row to provide a reason
              {reasonError ? " (required)" : ""}
            </button>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
