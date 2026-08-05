import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Loader2, Lock, Package, Plus, Trash2 } from "lucide-react";

import {
  createBom,
  getBomDetail,
  getWarehouses,
  updateBom,
  type BomComponentInput,
} from "../../api/bom";
import { getItems, type ItemSearchResult } from "../../api/sourcing";
import SearchableSelect, {
  type SearchableOption,
} from "../../components/material-requests/SearchableSelect";
import { useAuthStore } from "../../store/authStore";
import { canManageBom } from "../../config/roles";
import { generateId } from "../../utils/id";

interface ComponentRow {
  id: string;
  item_code: string;
  item_name: string;
  item_group: string;
  qty: number;
  uom: string;
  warehouse: string;
}

function newRow(): ComponentRow {
  return {
    id: generateId(),
    item_code: "",
    item_name: "",
    item_group: "",
    qty: 1,
    uom: "Nos",
    warehouse: "",
  };
}

export default function BomFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { name: routeName } = useParams();
  const editName = routeName ? decodeURIComponent(routeName) : "";
  const isEditMode = Boolean(editName);

  const [finishedProduct, setFinishedProduct] = useState("");
  const [finishedProductName, setFinishedProductName] = useState("");
  const [bomName, setBomName] = useState("");
  const [version, setVersion] = useState("");
  const [quantity, setQuantity] = useState<number>(1);
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [rows, setRows] = useState<ComponentRow[]>([newRow()]);
  const [showErrors, setShowErrors] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const itemsQuery = useQuery({
    queryKey: ["bom-form-items"],
    queryFn: () => getItems({ limit: 2000 }),
    staleTime: 5 * 60_000,
  });
  const warehousesQuery = useQuery({
    queryKey: ["bom-form-warehouses"],
    queryFn: getWarehouses,
    staleTime: 5 * 60_000,
  });

  const editQuery = useQuery({
    queryKey: ["manufacturing-bom", editName],
    queryFn: () => getBomDetail(editName),
    enabled: isEditMode,
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const itemByCode = useMemo(() => {
    const map = new Map<string, ItemSearchResult>();
    for (const it of items) map.set(it.item_code, it);
    return map;
  }, [items]);

  const itemOptions = useMemo<SearchableOption[]>(
    () =>
      items.map((it) => ({
        value: it.item_code,
        label: it.item_code,
        sublabel:
          it.item_name && it.item_name !== it.item_code ? it.item_name : undefined,
        detail: it.description,
      })),
    [items],
  );

  const warehouseOptions = warehousesQuery.data ?? [];

  // The submitted-BOM guard: ERPNext freezes component rows and quantity once a
  // BOM is submitted. Only the active/default flags stay editable.
  const detail = editQuery.data;
  const locked = isEditMode && (detail?.docstatus ?? 0) === 1;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!detail || hydrated) return;
    setFinishedProduct(detail.item);
    setFinishedProductName(detail.item_name);
    setQuantity(detail.quantity || 1);
    setIsActive(detail.is_active === 1);
    setIsDefault(detail.is_default === 1);
    setRows(
      detail.items.length > 0
        ? detail.items.map((c) => ({
            id: generateId(),
            item_code: c.item_code,
            item_name: c.item_name,
            item_group: c.item_group ?? "",
            qty: c.qty,
            uom: c.uom || "Nos",
            warehouse: c.warehouse ?? "",
          }))
        : [newRow()],
    );
    setHydrated(true);
  }, [detail, hydrated]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const usedComponentCodes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.item_code) set.add(r.item_code);
    return set;
  }, [rows]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const components: BomComponentInput[] = rows
        .filter((r) => r.item_code && r.qty > 0)
        .map((r) => ({
          item_code: r.item_code,
          qty: r.qty,
          uom: r.uom || undefined,
          warehouse: r.warehouse || undefined,
        }));

      if (isEditMode) {
        await updateBom(editName, {
          quantity,
          is_active: isActive,
          is_default: isDefault,
          components,
        });
        return editName;
      }
      const res = await createBom({
        item: finishedProduct,
        quantity,
        is_active: isActive,
        is_default: isDefault,
        components,
      });
      return res.name;
    },
    onSuccess: (name) => {
      queryClient.invalidateQueries({ queryKey: ["manufacturing-boms"] });
      queryClient.invalidateQueries({ queryKey: ["manufacturing-finished-products"] });
      if (isEditMode) {
        queryClient.invalidateQueries({ queryKey: ["manufacturing-bom", editName] });
      }
      toast.success(isEditMode ? "BOM updated" : "BOM created");
      navigate(`/manufacturing/boms/${encodeURIComponent(name)}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save BOM");
    },
  });

  function validate(): string | null {
    if (!finishedProduct) return "Select a finished product.";
    if (!(quantity > 0)) return "Production quantity must be greater than zero.";
    const active = rows.filter((r) => r.item_code && r.qty > 0);
    if (active.length === 0) return "Add at least one component.";
    const codes = active.map((r) => r.item_code);
    if (new Set(codes).size !== codes.length) {
      return "Remove duplicate components — each item may appear once.";
    }
    return null;
  }

  function handleSave() {
    setShowErrors(true);
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    saveMutation.mutate();
  }

  function updateRow(id: string, patch: Partial<ComponentRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function handleItemSelect(id: string, opt: SearchableOption) {
    if (usedComponentCodes.has(opt.value)) {
      toast.error("This component has already been added.");
      return;
    }
    const it = itemByCode.get(opt.value);
    updateRow(id, {
      item_code: opt.value,
      item_name: it?.item_name ?? opt.value,
      item_group: it?.item_group ?? "",
      uom: it?.uom || "Nos",
    });
  }

  if (!canManageBom(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (isEditMode && editQuery.isLoading && !hydrated) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (isEditMode && editQuery.isError) {
    return (
      <div className="py-16 text-center text-neutral-500">
        BOM not found.
        <Link to="/manufacturing/boms" className="mt-2 block text-primary-600">
          Back to BOM Management
        </Link>
      </div>
    );
  }

  const busy = saveMutation.isPending;

  return (
    <div className="space-y-4">
      <Link
        to="/manufacturing/boms"
        className="mb-1 inline-flex items-center gap-1 text-sm text-neutral-500 no-underline hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to BOM Management
      </Link>

      <h1 className="text-lg font-bold text-neutral-900">
        {isEditMode ? "Edit BOM" : "Create BOM"}
      </h1>

      {locked && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            This BOM is submitted. Components and quantity are locked —
            only the Active and Default flags can be changed here.
          </span>
        </div>
      )}

      {/* BOM header */}
      <section className="card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Finished Product" required>
            <SearchableSelect
              options={itemOptions}
              selectedValue={finishedProduct}
              selectedLabel={finishedProductName || finishedProduct}
              onSelect={(opt) => {
                setFinishedProduct(opt.value);
                setFinishedProductName(
                  itemByCode.get(opt.value)?.item_name ?? opt.value,
                );
              }}
              onClear={() => {
                setFinishedProduct("");
                setFinishedProductName("");
              }}
              disabled={busy || isEditMode}
              loading={itemsQuery.isLoading}
              error={itemsQuery.isError}
              invalid={showErrors && !finishedProduct}
              placeholder="Search a finished product…"
              ariaLabel="Finished product"
              emptyText="No items found."
              errorText="Couldn't load items."
            />
          </Field>

          <Field label="Production Quantity" required>
            <input
              type="number"
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              disabled={busy || locked}
              className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-neutral-50"
            />
          </Field>

          <Field label="BOM Name">
            <input
              value={bomName}
              onChange={(e) => setBomName(e.target.value)}
              disabled={busy}
              placeholder="Auto-assigned on save"
              className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </Field>

          <Field label="Version">
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              disabled={busy}
              placeholder="e.g. Rev A / v1.0"
              className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </Field>

          <div className="flex items-center gap-6 sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={busy}
                className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
              />
              Active
            </label>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                disabled={busy}
                className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
              />
              Default BOM
            </label>
          </div>
        </div>
      </section>

      {/* Components */}
      <section className="card">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <Package className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-neutral-900">Components</h3>
              <p className="text-xs text-neutral-500">
                Each component and its quantity per {quantity || 1} unit(s) of output.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, newRow()])}
            disabled={busy || locked}
            className="inline-flex items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add Component
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed text-sm">
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: 260 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 50 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <th className="px-2 py-3 text-center">#</th>
                <th className="px-3 py-3">Item <span className="text-danger-500">*</span></th>
                <th className="px-3 py-3">Item Group</th>
                <th className="px-3 py-3">Qty <span className="text-danger-500">*</span></th>
                <th className="px-3 py-3">UOM</th>
                <th className="px-3 py-3">Warehouse</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="bg-white">
              {rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60"
                >
                  <td className="px-2 py-2 text-center align-middle">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-xs font-semibold text-neutral-600">
                      {idx + 1}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <SearchableSelect
                      options={itemOptions}
                      selectedValue={row.item_code}
                      selectedLabel={
                        row.item_code
                          ? row.item_name && row.item_name !== row.item_code
                            ? `${row.item_code} - ${row.item_name}`
                            : row.item_code
                          : ""
                      }
                      onSelect={(opt) => handleItemSelect(row.id, opt)}
                      onClear={() =>
                        updateRow(row.id, {
                          item_code: "",
                          item_name: "",
                          item_group: "",
                          uom: "Nos",
                        })
                      }
                      disabled={busy || locked}
                      loading={itemsQuery.isLoading}
                      error={itemsQuery.isError}
                      invalid={showErrors && !row.item_code}
                      placeholder="Search item…"
                      ariaLabel={`Component item for row ${idx + 1}`}
                      emptyText="No items found."
                      errorText="Couldn't load items."
                    />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <input
                      readOnly
                      value={row.item_group}
                      placeholder="Auto from item"
                      tabIndex={-1}
                      className="h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-600"
                    />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={row.qty}
                      onChange={(e) =>
                        updateRow(row.id, { qty: Number(e.target.value) })
                      }
                      disabled={busy || locked}
                      className={`h-10 w-full rounded-lg border px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-neutral-50 ${
                        showErrors && !(row.qty > 0)
                          ? "border-danger-400"
                          : "border-neutral-300"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <input
                      value={row.uom}
                      onChange={(e) => updateRow(row.id, { uom: e.target.value })}
                      disabled={busy || locked}
                      className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-neutral-50"
                    />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <select
                      value={row.warehouse}
                      onChange={(e) =>
                        updateRow(row.id, { warehouse: e.target.value })
                      }
                      disabled={busy || locked}
                      className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm focus:border-primary-500 focus:outline-none disabled:bg-neutral-50"
                    >
                      <option value="">— Optional —</option>
                      {warehouseOptions.map((w) => (
                        <option key={w.name} value={w.name}>
                          {w.warehouse_name || w.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-center align-middle">
                    <button
                      type="button"
                      title="Remove component"
                      aria-label="Remove component"
                      onClick={() =>
                        setRows((prev) =>
                          prev.length > 1
                            ? prev.filter((r) => r.id !== row.id)
                            : [newRow()],
                        )
                      }
                      disabled={busy || locked}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:border-danger-300 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditMode ? "Save Changes" : "Create BOM"}
        </button>
        <Link
          to="/manufacturing/boms"
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 no-underline hover:bg-neutral-50"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-neutral-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}
