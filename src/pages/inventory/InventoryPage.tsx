import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Boxes,
  Loader2,
  Plus,
  X,
} from "lucide-react";

import {
  createInventoryItem,
  getItemHsnFieldConfig,
} from "../../api/inventory";
import { apiGet } from "../../api/erpnext";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { FilterBar, FilterField, SearchInput } from "../../components/ui";
import { useDebounce } from "../../hooks/useDebounce";
import type { Bin, Item } from "../../types/erpnext";
import { formatNumber } from "../../utils/format";
import { generateItemCode } from "../../utils/itemCode";

/* ── Add-Item form state ─────────────────────────────────────────────────── */

interface NewItemForm {
  item_code: string;
  item_name: string;
  item_group: string;
  stock_uom: string;
  gst_hsn_code: string;
  description: string;
}

const EMPTY_FORM: NewItemForm = {
  item_code: "",
  item_name: "",
  item_group: "",
  stock_uom: "Nos",
  gst_hsn_code: "",
  description: "",
};

interface ItemGroupRow {
  name: string;
  item_group_name?: string;
}

interface InventoryRow extends Item {
  stock_level: number;
  reorder_level: number;
  is_below_reorder: boolean;
}

export default function InventoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [group, setGroup] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);

  /* ── Add-Item modal ──────────────────────────────────────────────────── */
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<NewItemForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<NewItemForm>>({});
  const firstInputRef = useRef<HTMLInputElement>(null);

  function openModal() {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setModalOpen(true);
    // Focus the first field on next tick after the modal renders.
    setTimeout(() => firstInputRef.current?.focus(), 50);
  }

  function closeModal() {
    setModalOpen(false);
    setForm(EMPTY_FORM);
    setFormErrors({});
  }

  function patch(field: keyof NewItemForm, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "item_name") {
        next.item_code = generateItemCode(value, allItemCodes);
      }
      return next;
    });
    if (formErrors[field])
      setFormErrors((prev) => ({ ...prev, [field]: undefined }));
    if (field === "item_name" && formErrors.item_code)
      setFormErrors((prev) => ({ ...prev, item_code: undefined }));
  }

  const hsnConfigQuery = useQuery({
    queryKey: ["item-hsn-field-config"],
    queryFn: getItemHsnFieldConfig,
    staleTime: 10 * 60_000,
  });

  const hsnConfig = hsnConfigQuery.data;
  const hsnRequired = hsnConfig?.required ?? true;

  /** Client-side validation. Returns true if valid. */
  function validate(): boolean {
    const errs: Partial<NewItemForm> = {};
    if (!form.item_name.trim()) errs.item_name = "Item Name is required.";
    if (!form.item_code.trim())
      errs.item_code = "Enter an Item Name to generate a code.";

    const existing = allItemCodes.some(
      (code) => code.toLowerCase() === form.item_code.trim().toLowerCase()
    );
    if (existing)
      errs.item_code = `Item Code "${form.item_code.trim()}" already exists.`;

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createInventoryItem({
        item_code: form.item_code.trim(),
        item_name: form.item_name.trim(),
        item_group: form.item_group.trim() || "All Item Groups",
        stock_uom: form.stock_uom.trim() || "Nos",
        gst_hsn_code: form.gst_hsn_code.trim() || undefined,
        description: form.description.trim() || undefined,
        is_stock_item: 1,
      }),
    onSuccess: (created) => {
      toast.success(`Item ${created.item_code} created successfully`, {
        id: "inventory-create-item",
      });
      closeModal();
      // Refresh the items list and item-group list.
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["item-codes-all"] });
      void queryClient.invalidateQueries({ queryKey: ["item-groups"] });
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : "Could not create item.";
      toast.error(message, { id: "inventory-create-item", duration: 8_000 });
    },
  });

  function handleCreate() {
    if (!validate()) return;
    createMutation.mutate();
  }

  const { data: groups = [] } = useQuery<ItemGroupRow[]>({
    queryKey: ["item-groups"],
    queryFn: () =>
      apiGet<ItemGroupRow[]>("/api/resource/Item Group", {
        params: {
          filters: JSON.stringify([["is_group", "=", 0]]),
          fields: JSON.stringify(["name", "item_group_name"]),
          limit_page_length: 200,
          order_by: "item_group_name asc",
        },
      }),
    staleTime: 5 * 60_000,
  });

  /** All item codes — used for auto-generation (unaffected by list filters). */
  const allItemCodesQuery = useQuery<Item[]>({
    queryKey: ["item-codes-all"],
    queryFn: () =>
      apiGet<Item[]>("/api/resource/Item", {
        params: {
          filters: JSON.stringify([["disabled", "=", 0]]),
          fields: JSON.stringify(["item_code"]),
          limit_page_length: 2000,
          order_by: "item_code asc",
        },
      }),
    staleTime: 60_000,
  });

  const allItemCodes = useMemo(
    () => (allItemCodesQuery.data ?? []).map((i) => i.item_code),
    [allItemCodesQuery.data]
  );

  const itemsQuery = useQuery<Item[]>({
    queryKey: ["items", debouncedSearch, group],
    queryFn: () => {
      const filters: Array<[string, string, string | number]> = [
        ["disabled", "=", 0],
      ];
      if (group) filters.push(["item_group", "=", group]);
      if (debouncedSearch) {
        filters.push(["item_name", "like", `%${debouncedSearch}%`]);
      }
      return apiGet<Item[]>("/api/resource/Item", {
        params: {
          filters: JSON.stringify(filters),
          fields: JSON.stringify([
            "name",
            "item_code",
            "item_name",
            "item_group",
            "stock_uom",
            "is_stock_item",
            "safety_stock",
          ]),
          limit_page_length: 200,
          order_by: "item_name asc",
        },
      });
    },
  });

  const itemCodes = useMemo(
    () => (itemsQuery.data ?? []).map((i) => i.item_code),
    [itemsQuery.data]
  );

  const binsQuery = useQuery<Bin[]>({
    queryKey: ["bins", itemCodes],
    enabled: itemCodes.length > 0,
    queryFn: () =>
      apiGet<Bin[]>("/api/resource/Bin", {
        params: {
          filters: JSON.stringify([["item_code", "in", itemCodes]]),
          fields: JSON.stringify(["item_code", "warehouse", "actual_qty"]),
          limit_page_length: 1000,
        },
      }),
    staleTime: 60_000,
  });

  const stockByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of binsQuery.data ?? []) {
      if (!b.item_code) continue;
      map.set(b.item_code, (map.get(b.item_code) ?? 0) + (b.actual_qty ?? 0));
    }
    return map;
  }, [binsQuery.data]);

  const rows: InventoryRow[] = useMemo(() => {
    return (itemsQuery.data ?? []).map((item) => {
      const stock = stockByItem.get(item.item_code) ?? 0;
      const reorder = item.safety_stock ?? 0;
      return {
        ...item,
        stock_level: stock,
        reorder_level: reorder,
        is_below_reorder: reorder > 0 && stock < reorder,
      };
    });
  }, [itemsQuery.data, stockByItem]);

  const visibleRows = showLowOnly
    ? rows.filter((r) => r.is_below_reorder)
    : rows;

  const lowStockCount = useMemo(
    () => rows.filter((r) => r.is_below_reorder).length,
    [rows]
  );

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Live item catalog with on-hand quantities across all warehouses."
        actions={
          <div className="flex items-center gap-2">
            {lowStockCount > 0 && (
              <button
                type="button"
                onClick={() => setShowLowOnly((v) => !v)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  showLowOnly
                    ? "border-danger-500 bg-danger-500 text-white"
                    : "border-danger-300 bg-danger-50 text-danger-700 hover:bg-danger-100"
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {showLowOnly ? "Showing" : "Show"} {lowStockCount} below reorder
              </button>
            )}
            <button type="button" onClick={openModal} className="btn-primary">
              <Plus className="h-4 w-4" />
              Add Item
            </button>
          </div>
        }
      />

      <FilterBar>
        <FilterField label="Search" className="min-w-[220px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Item name or code…"
          />
        </FilterField>
        <FilterField label="Item Group" className="min-w-[220px]">
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="select-field"
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.item_group_name ?? g.name}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      <div className="table-shell">
        {itemsQuery.isError ? (
          <ConnectionError
            title="Could not load items"
            error={itemsQuery.error}
            onRetry={() => itemsQuery.refetch()}
          />
        ) : itemsQuery.isLoading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={showLowOnly ? "Nothing is low on stock" : "No items match"}
            description={
              showLowOnly
                ? "All items are at or above their reorder threshold."
                : "Adjust the filters above to find items."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Name</th>
                  <th>Group</th>
                  <th>UOM</th>
                  <th className="text-right">Stock Level</th>
                  <th className="text-right">Reorder Level</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.name}
                    onClick={() =>
                      navigate(`/inventory/${encodeURIComponent(row.item_code)}`)
                    }
                    className="cursor-pointer"
                  >
                    <td>
                      <span className="table-link">{row.item_code}</span>
                    </td>
                    <td className="text-neutral-700">
                      {row.item_name}
                    </td>
                    <td className="text-neutral-600">
                      {row.item_group ?? "—"}
                    </td>
                    <td className="text-neutral-600">
                      {row.stock_uom ?? "—"}
                    </td>
                    <td
                      className={`text-right font-medium tabular-nums ${
                        row.is_below_reorder
                          ? "text-danger-500"
                          : "text-neutral-900"
                      }`}
                    >
                      {formatNumber(row.stock_level)}
                    </td>
                    <td className="text-right tabular-nums text-neutral-600">
                      {row.reorder_level > 0
                        ? formatNumber(row.reorder_level)
                        : "—"}
                    </td>
                    <td>
                      {row.is_below_reorder && (
                        <StatusBadge status="Below Reorder" tone="danger" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add Item Modal ─────────────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            // Close when clicking the backdrop (not the modal itself).
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-card bg-white shadow-card-hover">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-primary-600" />
                <h2 className="text-sm font-semibold text-neutral-900">
                  Add New Item
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="space-y-4 px-5 py-4">
              {/* Row 1: Item Name + auto-generated Item Code */}
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Item Name"
                  required
                  error={formErrors.item_name}
                >
                  <input
                    ref={firstInputRef}
                    value={form.item_name}
                    onChange={(e) => patch("item_name", e.target.value)}
                    placeholder="e.g. Dell Laptop"
                    className={inputCls(!!formErrors.item_name)}
                  />
                </Field>
                <Field
                  label="Item Code"
                  required
                  hint="Item Code is automatically generated."
                  error={formErrors.item_code}
                >
                  <input
                    value={form.item_code}
                    readOnly
                    tabIndex={-1}
                    placeholder="Generated from item name"
                    aria-readonly="true"
                    className={
                      inputCls(!!formErrors.item_code) +
                      " cursor-not-allowed bg-neutral-50 text-neutral-700"
                    }
                  />
                </Field>
              </div>

              {/* Row 2: Item Group + UOM */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Item Group">
                  <select
                    value={form.item_group}
                    onChange={(e) => patch("item_group", e.target.value)}
                    className={inputCls(false)}
                  >
                    <option value="">All Item Groups</option>
                    {groups.map((g) => (
                      <option key={g.name} value={g.name}>
                        {g.item_group_name ?? g.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Unit of Measure (UOM)">
                  <input
                    value={form.stock_uom}
                    onChange={(e) => patch("stock_uom", e.target.value)}
                    placeholder="Nos"
                    className={inputCls(false)}
                  />
                </Field>
              </div>

              {/* HSN/SAC — required when ERPNext Item metadata marks it mandatory */}
              <Field
                label={hsnConfig?.label ?? "HSN/SAC Code"}
                required={hsnRequired}
                hint={
                  hsnRequired
                    ? `Required (${hsnConfig?.fieldname ?? "gst_hsn_code"}). Missing codes are created automatically.`
                    : "Optional GST HSN/SAC Code. Missing codes are created automatically."
                }
                error={formErrors.gst_hsn_code}
              >
                <input
                  value={form.gst_hsn_code}
                  onChange={(e) => patch("gst_hsn_code", e.target.value)}
                  placeholder="e.g. 87089900"
                  className={inputCls(!!formErrors.gst_hsn_code)}
                />
              </Field>

              {/* Description */}
              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => patch("description", e.target.value)}
                  rows={2}
                  placeholder="Specifications, brand, notes…"
                  className={
                    inputCls(false) + " resize-none leading-relaxed"
                  }
                />
              </Field>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={createMutation.isPending}
                className="btn-secondary disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="btn-primary disabled:opacity-60"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Create Item
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Modal helper components ─────────────────────────────────────────────── */

function inputCls(hasError: boolean) {
  return [
    "input-field",
    hasError ? "border-danger-400 focus:border-danger-500" : "",
  ].join(" ");
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label-field">
        {label}
        {required && <span className="ml-0.5 text-danger-500">*</span>}
        {hint && (
          <span className="ml-1 font-normal text-neutral-400">— {hint}</span>
        )}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-xs text-danger-600">{error}</p>
      )}
    </div>
  );
}
