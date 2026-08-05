import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Loader2, PackagePlus, Save } from "lucide-react";

import {
  createItemMaster,
  getItemMaster,
  listItemCodes,
  updateItemMaster,
  type CreateItemMasterInput,
  type UpdateItemMasterInput,
} from "../../../api/itemMaster";
import { getItemGroups } from "../../../api/sourcing";
import { getWarehouses } from "../../../api/bom";
import SearchableSelect, {
  type SearchableOption,
} from "../../../components/material-requests/SearchableSelect";
import { useAuthStore } from "../../../store/authStore";
import { canEditItemMasterFields } from "../../../config/itemMasterPermissions";
import {
  procurementCategoriesForType,
  procurementCategoryBelongsToType,
  procurementCategoryFilterOptions,
  type ProcurementCategory,
} from "../../../config/procurementCategory";
import {
  ITEM_LIFECYCLE_STATUSES,
  type ItemLifecycleStatus,
} from "../../../types/itemMaster";
import type { MaterialRequestProcurementType } from "../../../types/materialRequestWorkflow";
import { MATERIAL_REQUEST_PROCUREMENT_TYPES } from "../../../types/materialRequestWorkflow";
import UomSelect from "../../../components/UomSelect";
import { isValidImportUom, normalizeToEnterpriseUom } from "../../../config/uomMaster";

interface FormState {
  item_code: string;
  item_name: string;
  /** Empty = Not Assigned (edit legacy items until Warehouse assigns a type). */
  procurement_type: MaterialRequestProcurementType | "";
  procurement_category: string;
  description: string;
  item_group: string;
  stock_uom: string;
  is_stock_item: boolean;
  reorder_level: string;
  min_stock: string;
  max_stock: string;
  default_warehouse: string;
  standard_rate: string;
  manufacturer: string;
  brand: string;
  lifecycle_status: ItemLifecycleStatus;
}

function emptyForm(): FormState {
  return {
    item_code: "",
    item_name: "",
    procurement_type: "",
    procurement_category: "",
    description: "",
    item_group: "",
    stock_uom: "Nos",
    is_stock_item: true,
    reorder_level: "",
    min_stock: "",
    max_stock: "",
    default_warehouse: "",
    standard_rate: "",
    manufacturer: "",
    brand: "",
    lifecycle_status: "Active",
  };
}

function fieldClass(hasError?: boolean) {
  return `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
    hasError
      ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500"
      : "border-slate-200 focus:border-primary-500 focus:ring-primary-500"
  }`;
}

export default function ItemMasterFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canEdit = canEditItemMasterFields(user?.role);
  const { code: routeCode } = useParams();
  const editCode = routeCode ? decodeURIComponent(routeCode) : "";
  const isEditMode = Boolean(editCode);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>(
    {},
  );
  const [showErrors, setShowErrors] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const itemQuery = useQuery({
    queryKey: ["item-master", editCode],
    queryFn: () => getItemMaster(editCode),
    enabled: isEditMode,
  });

  const groupsQuery = useQuery({
    queryKey: ["item-groups"],
    queryFn: () => getItemGroups(),
    staleTime: 5 * 60_000,
  });

  const warehousesQuery = useQuery({
    queryKey: ["item-master-warehouses"],
    queryFn: getWarehouses,
    staleTime: 5 * 60_000,
  });

  const codesQuery = useQuery({
    queryKey: ["item-master-codes"],
    queryFn: listItemCodes,
    enabled: !isEditMode,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!isEditMode || !itemQuery.data || hydrated) return;
    const item = itemQuery.data;
    setForm({
      item_code: item.item_code,
      item_name: item.item_name,
      procurement_type:
        item.procurement_type === "Direct" || item.procurement_type === "Indirect"
          ? item.procurement_type
          : "",
      procurement_category: item.procurement_category,
      description: item.description,
      item_group: item.item_group,
      stock_uom: item.stock_uom,
      is_stock_item: item.is_stock_item,
      reorder_level: item.reorder_level ? String(item.reorder_level) : "",
      min_stock: item.min_stock ? String(item.min_stock) : "",
      max_stock: item.max_stock ? String(item.max_stock) : "",
      default_warehouse: item.default_warehouse,
      standard_rate: item.standard_rate ? String(item.standard_rate) : "",
      manufacturer: item.manufacturer,
      brand: item.brand,
      lifecycle_status: item.lifecycle_status,
    });
    setHydrated(true);
  }, [isEditMode, itemQuery.data, hydrated]);

  // Strict: Procurement Category master for selected type — never Item Groups.
  const categoryOptions = useMemo(
    () =>
      form.procurement_type
        ? procurementCategoryFilterOptions(form.procurement_type)
        : [],
    [form.procurement_type],
  );

  const groupOptions = useMemo<SearchableOption[]>(
    () =>
      (groupsQuery.data ?? []).map((g) => ({
        value: g.name,
        label: g.item_group_name || g.name,
      })),
    [groupsQuery.data],
  );

  const warehouseOptions = useMemo<SearchableOption[]>(
    () =>
      (warehousesQuery.data ?? []).map((w) => ({
        value: w.name,
        label: w.warehouse_name || w.name,
      })),
    [warehousesQuery.data],
  );

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "procurement_type") {
        if (!value) {
          next.procurement_category = "";
        } else {
          const cats = procurementCategoriesForType(
            value as MaterialRequestProcurementType,
          );
          if (!cats.includes(prev.procurement_category as ProcurementCategory)) {
            next.procurement_category = "";
          }
        }
      }
      return next;
    });
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!isEditMode && !form.item_code.trim()) {
      next.item_code = "Item Code is required.";
    }
    if (!isEditMode) {
      const code = form.item_code.trim();
      const exists = (codesQuery.data ?? []).some(
        (c) => c.toLowerCase() === code.toLowerCase(),
      );
      if (code && exists) {
        next.item_code = `Item Code "${code}" already exists.`;
      }
    }
    if (!form.item_name.trim()) next.item_name = "Item Name is required.";
    if (!form.procurement_type) {
      next.procurement_type = "Procurement Type is required (Direct or Indirect).";
    }
    if (!form.procurement_category.trim()) {
      next.procurement_category = "Procurement Category is required.";
    } else if (
      form.procurement_type &&
      !procurementCategoryBelongsToType(
        form.procurement_category,
        form.procurement_type,
      )
    ) {
      next.procurement_category = `Select a category valid for ${form.procurement_type} items.`;
    }
    if (!form.item_group.trim()) {
      next.item_group = "Item Group is required.";
    }
    if (!form.stock_uom.trim()) {
      next.stock_uom = "UOM is required.";
    } else if (!isValidImportUom(form.stock_uom)) {
      next.stock_uom = "Select a valid enterprise UOM.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.procurement_type) {
        throw new Error("Procurement Type is required (Direct or Indirect).");
      }
      const payload = {
        item_name: form.item_name.trim(),
        procurement_type: form.procurement_type,
        procurement_category: form.procurement_category.trim(),
        description: form.description.trim(),
        item_group: form.item_group.trim(),
        stock_uom:
          normalizeToEnterpriseUom(form.stock_uom) || form.stock_uom.trim(),
        is_stock_item: form.is_stock_item,
        reorder_level: Number(form.reorder_level) || 0,
        min_stock: Number(form.min_stock) || 0,
        max_stock: Number(form.max_stock) || 0,
        default_warehouse: form.default_warehouse.trim(),
        standard_rate: Number(form.standard_rate) || 0,
        manufacturer: form.manufacturer.trim(),
        brand: form.brand.trim(),
        lifecycle_status: form.lifecycle_status,
      };

      if (isEditMode) {
        return updateItemMaster(editCode, payload);
      }
      return createItemMaster({
        item_code: form.item_code.trim(),
        ...payload,
      });
    },
    onSuccess: (saved) => {
      toast.success(
        isEditMode ? "Item updated successfully." : "Item created successfully.",
      );
      void queryClient.invalidateQueries({ queryKey: ["item-master-list"] });
      void queryClient.invalidateQueries({ queryKey: ["item-master", saved.item_code] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      navigate(`/warehouse/inventory/items/${encodeURIComponent(saved.item_code)}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not save item.");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (!validate()) return;
    saveMutation.mutate();
  }

  if (!canEdit) {
    return <Navigate to="/warehouse/inventory/items" replace />;
  }

  if (isEditMode && itemQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (isEditMode && itemQuery.isError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        Item not found.{" "}
        <Link to="/warehouse/inventory/items" className="font-semibold underline">
          Back to Item Master
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-3">
        <Link
          to={
            isEditMode
              ? `/warehouse/inventory/items/${encodeURIComponent(editCode)}`
              : "/warehouse/inventory/items"
          }
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="mb-8 flex items-start gap-4">
          <div className="rounded-xl bg-primary-50 p-3 text-primary-700">
            <PackagePlus className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {isEditMode ? `Edit Item — ${editCode}` : "Add Item"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Maintain procurement classification, stock thresholds, and lifecycle
              status for the Item Master catalog.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-6">
          <section className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Item Code *
              </label>
              <input
                value={form.item_code}
                disabled={isEditMode}
                onChange={(e) => setField("item_code", e.target.value)}
                className={fieldClass(showErrors && !!errors.item_code)}
                placeholder="e.g. AB001"
              />
              {showErrors && errors.item_code && (
                <p className="mt-1 text-xs text-rose-600">{errors.item_code}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Item Name *
              </label>
              <input
                value={form.item_name}
                onChange={(e) => setField("item_name", e.target.value)}
                className={fieldClass(showErrors && !!errors.item_name)}
                placeholder="e.g. Bumper Assembly"
              />
              {showErrors && errors.item_name && (
                <p className="mt-1 text-xs text-rose-600">{errors.item_name}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Procurement Type *
              </label>
              <select
                value={form.procurement_type}
                onChange={(e) =>
                  setField(
                    "procurement_type",
                    e.target.value as MaterialRequestProcurementType | "",
                  )
                }
                className={fieldClass(showErrors && !!errors.procurement_type)}
              >
                <option value="">Select Procurement Type</option>
                {MATERIAL_REQUEST_PROCUREMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {showErrors && errors.procurement_type && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.procurement_type}
                </p>
              )}
              {isEditMode && !form.procurement_type && (
                <p className="mt-1 text-xs text-amber-700">
                  This item is Not Assigned. Select Direct or Indirect before
                  saving.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Procurement Category *
              </label>
              <select
                value={form.procurement_category}
                onChange={(e) => setField("procurement_category", e.target.value)}
                className={fieldClass(showErrors && !!errors.procurement_category)}
              >
                <option value="">Select procurement category</option>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {form.procurement_type
                  ? `Categories for ${form.procurement_type} only — not item groups.`
                  : "Select Procurement Type first to load valid categories."}
              </p>
              {showErrors && errors.procurement_category && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.procurement_category}
                </p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
                rows={3}
                className={fieldClass()}
                placeholder="Item specification or usage notes"
              />
            </div>
          </section>

          <section className="grid gap-4 border-t border-slate-100 pt-6 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Item Group *
              </label>
              <SearchableSelect
                value={form.item_group}
                onChange={(v) => setField("item_group", v)}
                options={groupOptions}
                placeholder="Select item group"
              />
              <p className="mt-1 text-xs text-slate-500">
                Item group hierarchy — separate from Procurement
                Category. Item Groups never appear in the Category dropdown.
              </p>
              {showErrors && errors.item_group && (
                <p className="mt-1 text-xs text-rose-600">{errors.item_group}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                UOM *
              </label>
              <UomSelect
                value={form.stock_uom}
                onChange={(v) => setField("stock_uom", v)}
                className={fieldClass(showErrors && !!errors.stock_uom)}
                erpUoms={form.stock_uom ? [form.stock_uom] : []}
              />
              {showErrors && errors.stock_uom && (
                <p className="mt-1 text-xs text-rose-600">{errors.stock_uom}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Stock Item
              </label>
              <select
                value={form.is_stock_item ? "yes" : "no"}
                onChange={(e) => setField("is_stock_item", e.target.value === "yes")}
                className={fieldClass()}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Status
              </label>
              <select
                value={form.lifecycle_status}
                onChange={(e) =>
                  setField("lifecycle_status", e.target.value as ItemLifecycleStatus)
                }
                className={fieldClass()}
              >
                {ITEM_LIFECYCLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Reorder Level
              </label>
              <input
                type="number"
                min={0}
                value={form.reorder_level}
                onChange={(e) => setField("reorder_level", e.target.value)}
                className={fieldClass()}
                placeholder="e.g. 10"
              />
              <p className="mt-1 text-xs text-slate-500">
                When current stock reaches this level, status becomes Reorder
                Required. Leave empty for Not Configured.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Minimum Stock
              </label>
              <input
                type="number"
                min={0}
                value={form.min_stock}
                onChange={(e) => setField("min_stock", e.target.value)}
                className={fieldClass()}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Maximum Stock
              </label>
              <input
                type="number"
                min={0}
                value={form.max_stock}
                onChange={(e) => setField("max_stock", e.target.value)}
                className={fieldClass()}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Default Warehouse
              </label>
              <SearchableSelect
                value={form.default_warehouse}
                onChange={(v) => setField("default_warehouse", v)}
                options={warehouseOptions}
                placeholder="Select warehouse"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Unit Cost (Optional)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.standard_rate}
                onChange={(e) => setField("standard_rate", e.target.value)}
                className={fieldClass()}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Manufacturer
              </label>
              <input
                value={form.manufacturer}
                onChange={(e) => setField("manufacturer", e.target.value)}
                className={fieldClass()}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Brand
              </label>
              <input
                value={form.brand}
                onChange={(e) => setField("brand", e.target.value)}
                className={fieldClass()}
              />
            </div>
          </section>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-6">
            <Link
              to="/warehouse/inventory/items"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isEditMode ? "Save Changes" : "Create Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
