import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Factory, Hammer, Loader2 } from "lucide-react";

import {
  requiredQtyForProduction,
  type BomComponent,
  type BomFinishedItem,
  type BomSummary,
} from "../../api/bom";
import { getItemStockSummary } from "../../api/materialRequestWorkflow";
import SearchableSelect, { type SearchableOption } from "./SearchableSelect";

interface Props {
  visible: boolean;
  disabled?: boolean;
  /** Whether component warehouse stock / shortage may be shown (never for department users). */
  showStock: boolean;

  finishedProduct: string;
  finishedProductLabel: string;
  finishedProducts: BomFinishedItem[];
  finishedProductsLoading: boolean;
  finishedProductsError: boolean;
  onFinishedProductSelect: (itemCode: string, itemName: string) => void;
  onFinishedProductClear: () => void;

  selectedBom: string;
  boms: BomSummary[];
  bomsLoading: boolean;
  bomsError: boolean;
  onBomSelect: (bomName: string) => void;
  onBomClear: () => void;

  productionQty: number;
  onProductionQtyChange: (qty: number) => void;

  components: BomComponent[] | undefined;
  componentsLoading: boolean;
  componentsError: boolean;
}

function formatQty(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function ManufacturingDetailsSection({
  visible,
  disabled = false,
  showStock,
  finishedProduct,
  finishedProductLabel,
  finishedProducts,
  finishedProductsLoading,
  finishedProductsError,
  onFinishedProductSelect,
  onFinishedProductClear,
  selectedBom,
  boms,
  bomsLoading,
  bomsError,
  onBomSelect,
  onBomClear,
  productionQty,
  onProductionQtyChange,
  components,
  componentsLoading,
  componentsError,
}: Props) {
  const productOptions = useMemo<SearchableOption[]>(
    () =>
      finishedProducts.map((p) => ({
        value: p.item_code,
        label: p.item_code,
        sublabel:
          p.item_name && p.item_name !== p.item_code ? p.item_name : undefined,
      })),
    [finishedProducts]
  );

  const bomOptions = useMemo<SearchableOption[]>(
    () =>
      boms.map((b) => ({
        value: b.name,
        label: b.name,
        sublabel: b.is_default ? "Default BOM" : undefined,
        detail: `Produces ${formatQty(b.quantity)} ${b.uom ?? ""}`.trim(),
      })),
    [boms]
  );

  const selectedBomLabel = useMemo(() => {
    if (!selectedBom) return "";
    return boms.find((b) => b.name === selectedBom)?.name ?? selectedBom;
  }, [boms, selectedBom]);

  if (!visible) return null;

  const noBomForProduct =
    !!finishedProduct && !bomsLoading && !bomsError && boms.length === 0;
  const colSpan = showStock ? 7 : 5;

  return (
    <section className="card">
      <div className="flex items-start gap-2 border-b border-neutral-200 px-5 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <Factory className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-neutral-900">
            Manufacturing Details
          </h3>
          <p className="text-xs text-neutral-500">
            Select a finished product and its BOM — components explode into the
            Items Required table below, scaled by the production quantity. Data
            is live from ERPNext.
          </p>
        </div>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600">
            Finished Product <span className="text-red-500">*</span>
          </label>
          <SearchableSelect
            options={productOptions}
            selectedValue={finishedProduct}
            selectedLabel={finishedProductLabel}
            onSelect={(opt) =>
              onFinishedProductSelect(opt.value, opt.sublabel ?? opt.label)
            }
            onClear={onFinishedProductClear}
            disabled={disabled}
            loading={finishedProductsLoading}
            error={finishedProductsError}
            placeholder="Search finished product"
            ariaLabel="Finished product"
            emptyText="No manufacturable items found. Create an active BOM in ERPNext first."
            errorText="Couldn't load finished products."
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600">
            BOM <span className="text-red-500">*</span>
          </label>
          <SearchableSelect
            options={bomOptions}
            selectedValue={selectedBom}
            selectedLabel={selectedBomLabel}
            onSelect={(opt) => onBomSelect(opt.value)}
            onClear={onBomClear}
            disabled={disabled || !finishedProduct}
            loading={bomsLoading}
            error={bomsError}
            placeholder="Select BOM"
            disabledPlaceholder="Select a finished product first"
            ariaLabel="Bill of materials"
            emptyText="No active BOM for this product."
            errorText="Couldn't load BOMs."
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600">
            Production Quantity <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={0.01}
            step="any"
            value={productionQty || ""}
            disabled={disabled || !selectedBom}
            onChange={(e) => {
              const raw = e.target.value;
              onProductionQtyChange(raw === "" ? 0 : Number(raw));
            }}
            placeholder="e.g. 100"
            className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400"
          />
        </div>
      </div>

      {/* Component explosion preview */}
      {noBomForProduct ? (
        <div className="mx-5 mb-5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          No active BOM was found for this finished product in ERPNext.
        </div>
      ) : selectedBom ? (
        <div className="border-t border-neutral-200">
          <div className="flex items-center gap-2 px-5 py-3">
            <Hammer className="h-4 w-4 text-neutral-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              BOM Components
            </h4>
            {productionQty > 0 && components && components.length > 0 && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                {components.length} item{components.length === 1 ? "" : "s"} ×{" "}
                {formatQty(productionQty)}
              </span>
            )}
          </div>

          <div className="overflow-x-auto px-5 pb-5">
            {componentsLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading BOM
                components…
              </div>
            ) : componentsError ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-danger-600">
                <AlertTriangle className="h-4 w-4" /> Couldn&apos;t load BOM
                components. Please retry.
              </div>
            ) : !components || components.length === 0 ? (
              <div className="py-8 text-center text-sm text-neutral-500">
                This BOM has no components.
              </div>
            ) : productionQty <= 0 ? (
              <div className="py-6 text-center text-sm text-neutral-500">
                Enter a production quantity to calculate required quantities.
              </div>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    <th className="px-3 py-2">Item Group</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-center">UOM</th>
                    <th className="px-3 py-2 text-right">Required Qty</th>
                    {showStock && (
                      <>
                        <th className="px-3 py-2 text-right">Available Stock</th>
                        <th className="px-3 py-2 text-right">Shortage</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {components.map((component, idx) => (
                    <BomComponentRow
                      key={`${component.item_code}-${idx}`}
                      component={component}
                      productionQty={productionQty}
                      showStock={showStock}
                    />
                  ))}
                </tbody>
                {showStock && (
                  <tfoot>
                    <tr>
                      <td colSpan={colSpan} className="px-3 pt-2 text-[11px] text-neutral-400">
                        Shortage = Required Qty − Available Warehouse Stock.
                        Components are added to the Items Required table below.
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BomComponentRow({
  component,
  productionQty,
  showStock,
}: {
  component: BomComponent;
  productionQty: number;
  showStock: boolean;
}) {
  const requiredQty = requiredQtyForProduction(component, productionQty);

  const stockQuery = useQuery({
    queryKey: ["bom-comp-stock", component.item_code],
    queryFn: () => getItemStockSummary(component.item_code),
    enabled: showStock && !!component.item_code,
    staleTime: 30_000,
  });

  const available = stockQuery.data?.available_qty ?? 0;
  const shortage = Math.max(0, requiredQty - available);

  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <td className="px-3 py-2 text-neutral-600">
        {component.item_group || "—"}
      </td>
      <td className="px-3 py-2 font-medium text-neutral-900">
        {component.item_code}
        {component.item_name && component.item_name !== component.item_code && (
          <span className="block text-[11px] font-normal text-neutral-400">
            {component.item_name}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-neutral-600">
        <span className="line-clamp-1">
          {component.description || component.item_name}
        </span>
      </td>
      <td className="px-3 py-2 text-center text-neutral-600">{component.uom}</td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">
        {formatQty(requiredQty)}
      </td>
      {showStock && (
        <>
          <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
            {stockQuery.isLoading ? (
              <Loader2 className="ml-auto h-4 w-4 animate-spin text-neutral-400" />
            ) : (
              formatQty(available)
            )}
          </td>
          <td
            className={`px-3 py-2 text-right font-semibold tabular-nums ${
              shortage > 0 ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {stockQuery.isLoading ? "—" : formatQty(shortage)}
          </td>
        </>
      )}
    </tr>
  );
}
