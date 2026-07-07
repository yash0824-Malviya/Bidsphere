import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import {
  getItemStockSummary,
  resolveStockStatusLabel,
  type ItemStockStatusLabel,
} from "../../api/materialRequestWorkflow";
import { getItems, type ItemSearchResult } from "../../api/sourcing";

export interface MaterialRequestDraftLine {
  id: string;
  item_code: string;
  item_name: string;
  description: string;
  qty: number;
  uom: string;
  schedule_date: string;
  remarks: string;
}

const EMPTY_ITEMS: ItemSearchResult[] = [];

interface Props {
  row: MaterialRequestDraftLine;
  rowNumber: number;
  showErrors: boolean;
  canRemove: boolean;
  usedItemCodes: ReadonlySet<string>;
  /**
   * Whether warehouse stock columns (Current / Available / Status) are shown and
   * fetched. Department users never see warehouse inventory, so this is false
   * for them — no stock query runs at all.
   */
  showStock?: boolean;
  onChange: (patch: Partial<MaterialRequestDraftLine>) => void;
  onRemove: () => void;
}

const inputCls = (hasError: boolean, disabled?: boolean) =>
  [
    "h-10 w-full rounded-lg border bg-white px-3 text-sm shadow-sm transition",
    "focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
    hasError ? "border-danger-400" : "border-neutral-300",
    disabled
      ? "cursor-not-allowed bg-neutral-50 text-neutral-400"
      : "text-neutral-900",
  ].join(" ");

const readOnlyCls =
  "h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-700";

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

function itemLabel(item: ItemSearchResult): string {
  return item.item_name && item.item_name !== item.item_code
    ? `${item.item_code} - ${item.item_name}`
    : item.item_code;
}

export default function MaterialRequestItemLineRow({
  row,
  rowNumber,
  showErrors,
  canRemove,
  usedItemCodes,
  showStock = false,
  onChange,
  onRemove,
}: Props) {
  const [itemSearch, setItemSearch] = useState("");
  const [itemsOpen, setItemsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const itemPickerRef = useRef<HTMLDivElement>(null);
  const itemInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const itemError = showErrors && !row.item_code;
  const qtyError = showErrors && !(row.qty > 0);

  const itemsQuery = useQuery<ItemSearchResult[]>({
    queryKey: ["mr-active-items"],
    queryFn: () => getItems({ limit: 5000 }),
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

  const allItems = itemsQuery.data ?? EMPTY_ITEMS;
  const selectableItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          item.item_code === row.item_code ||
          !usedItemCodes.has(item.item_code),
      ),
    [allItems, row.item_code, usedItemCodes],
  );

  const filteredItems = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    if (!query) return selectableItems;

    return selectableItems.filter((item) =>
      [item.item_code, item.item_name, item.description]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [itemSearch, selectableItems]);

  const itemsLoading = itemsQuery.isLoading || itemsQuery.isFetching;
  const stock = stockQuery.data;
  const stockStatus =
    row.item_code && stock
      ? resolveStockStatusLabel(stock.available_qty, row.qty)
      : "-";
  const highlightedIndex =
    filteredItems.length > 0
      ? Math.min(activeIndex, filteredItems.length - 1)
      : 0;

  useEffect(() => {
    if (!itemsOpen) return;

    function updatePosition() {
      const input = itemInputRef.current;
      if (!input) return;

      const rect = input.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        itemPickerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setItemsOpen(false);
    }

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [itemsOpen]);

  useEffect(() => {
    if (!itemsOpen || !dropdownRef.current) return;

    const activeElement = dropdownRef.current.querySelector<HTMLElement>(
      `[data-item-index="${highlightedIndex}"]`,
    );
    activeElement?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, itemsOpen]);

  function clearItem() {
    onChange({
      item_code: "",
      item_name: "",
      description: "",
      uom: "Nos",
    });
  }

  function handleItemSearchChange(value: string) {
    setItemSearch(value);
    setItemsOpen(true);
    setActiveIndex(0);

    if (!value.trim() && row.item_code) {
      clearItem();
    }
  }

  function handleItemSelect(item: ItemSearchResult) {
    if (usedItemCodes.has(item.item_code)) {
      toast.error("This item has already been added.");
      return;
    }

    onChange({
      item_code: item.item_code,
      item_name: item.item_name,
      description: item.description ?? item.item_name,
      uom: item.uom,
    });
    setItemSearch(itemLabel(item));
    setItemsOpen(false);
  }

  function handleItemKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!itemsOpen && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      setItemsOpen(true);
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex((current) =>
          current + 1 >= filteredItems.length ? 0 : current + 1,
        );
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex((current) =>
          current - 1 < 0 ? filteredItems.length - 1 : current - 1,
        );
      }
      return;
    }

    if (event.key === "Enter") {
      if (!itemsOpen || filteredItems.length === 0) return;
      event.preventDefault();
      handleItemSelect(filteredItems[highlightedIndex] ?? filteredItems[0]);
      return;
    }

    if (event.key === "Escape") {
      setItemsOpen(false);
    }
  }

  const dropdown =
    itemsOpen && dropdownStyle
      ? createPortal(
          <div
            ref={dropdownRef}
            className="z-[1000] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
            style={{
              position: "fixed",
              top: dropdownStyle.top,
              left: dropdownStyle.left,
              width: dropdownStyle.width,
              maxHeight: 300,
            }}
            role="listbox"
            aria-label={`Item suggestions for row ${rowNumber}`}
          >
            <div className="max-h-[300px] overflow-y-auto py-1">
              {!itemsLoading && allItems.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-neutral-500">
                  No items available.
                </div>
              ) : !itemsLoading && filteredItems.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-neutral-500">
                  {selectableItems.length === 0
                    ? "All items are already selected."
                    : "No matching items."}
                </div>
              ) : (
                <ul>
                  {filteredItems.map((item, index) => {
                    const isActive = index === highlightedIndex;
                    const isSelected = item.item_code === row.item_code;

                    return (
                      <li key={item.item_code}>
                        <button
                          type="button"
                          data-item-index={index}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => handleItemSelect(item)}
                          className={[
                            "flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition",
                            isActive || isSelected
                              ? "bg-primary-50"
                              : "hover:bg-neutral-50",
                          ].join(" ")}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <span className="text-sm font-semibold text-neutral-900">
                            {item.item_code}
                          </span>
                          {item.item_name &&
                            item.item_name !== item.item_code && (
                              <span className="text-xs text-neutral-500">
                                {item.item_name}
                              </span>
                            )}
                          {item.description &&
                            item.description !== item.item_name && (
                              <span className="line-clamp-1 text-[11px] text-neutral-400">
                                {item.description}
                              </span>
                            )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <tr className="h-14 border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60">
        <td className="w-[40px] px-2 py-2 align-middle">
          <div className="flex items-center justify-center">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-xs font-semibold text-neutral-600">
              {rowNumber}
            </span>
          </div>
        </td>

        <td className="w-[320px] px-3 py-2 align-middle">
          <div ref={itemPickerRef} className="relative">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                ref={itemInputRef}
                type="text"
                value={itemSearch}
                onChange={(event) => handleItemSearchChange(event.target.value)}
                onFocus={() => setItemsOpen(true)}
                onKeyDown={handleItemKeyDown}
                aria-invalid={itemError}
                aria-expanded={itemsOpen}
                aria-autocomplete="list"
                className={`${inputCls(itemError)} pl-8 pr-9`}
                placeholder={
                  itemsLoading ? "Loading items..." : "Type to search item"
                }
              />
              {itemsLoading && (
                <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-neutral-400" />
              )}
            </div>
          </div>
        </td>

        <td className="w-[420px] px-3 py-2 align-middle">
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
            className={inputCls(qtyError)}
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

      {dropdown}
    </>
  );
}
