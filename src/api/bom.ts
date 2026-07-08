/**
 * ERPNext BOM (Bill of Materials) service.
 *
 * Powers the Material Request "Manufacturing Details" section: resolving the
 * active/default BOM for a finished product and exploding it into component
 * lines whose required quantities scale with the production quantity.
 *
 * Every figure comes from live ERPNext data — the `BOM` DocType and its
 * `BOM Item` child rows. No mock data.
 */

import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  ENV_DEFAULTS,
  withSilent,
  type Filter,
} from "./erpnext";

const BOM_DOCTYPE = "BOM";
const WAREHOUSE_DOCTYPE = "Warehouse";
const LOG_TAG = "[BOM]";

export interface BomSummary {
  /** BOM document name (e.g. "BOM-ITEM-0001"). */
  name: string;
  /** Finished-product item code the BOM produces. */
  item: string;
  item_name?: string;
  is_active: number;
  is_default: number;
  /** Output quantity the BOM's component quantities are expressed against. */
  quantity: number;
  uom?: string;
  /** Last-modified timestamp — used to pick the latest default BOM per item. */
  modified?: string;
}

export interface BomFinishedItem {
  item_code: string;
  item_name: string;
}

export interface BomComponent {
  item_code: string;
  item_name: string;
  description?: string;
  uom: string;
  item_group?: string;
  /** Component stock quantity required to produce `bomQuantity` output units. */
  qtyForBomOutput: number;
  /** Output quantity `qtyForBomOutput` is expressed against (BOM header qty). */
  bomQuantity: number;
}

interface RawBomRow {
  name: string;
  item?: string;
  item_name?: string;
  is_active?: number;
  is_default?: number;
  quantity?: number;
  uom?: string;
  modified?: string;
}

interface RawBomItemRow {
  item_code?: string;
  item_name?: string;
  description?: string;
  qty?: number;
  stock_qty?: number;
  uom?: string;
  stock_uom?: string;
  item_group?: string;
}

interface RawBomDoc extends RawBomRow {
  items?: RawBomItemRow[];
}

const BOM_LIST_FIELDS = [
  "name",
  "item",
  "item_name",
  "is_active",
  "is_default",
  "quantity",
  "uom",
  "modified",
];

function normalizeBom(row: RawBomRow): BomSummary {
  return {
    name: row.name,
    item: row.item ?? "",
    item_name: row.item_name || row.item || row.name,
    is_active: Number(row.is_active ?? 0),
    is_default: Number(row.is_default ?? 0),
    quantity: Number(row.quantity) || 1,
    uom: row.uom,
    modified: row.modified,
  };
}

/**
 * All active, submitted BOMs (`is_active = 1`, `docstatus = 1`) — the source of
 * selectable finished products. Errors are logged with context and re-thrown so
 * the calling query surfaces a proper error state (never a false "empty").
 */
export async function getActiveBoms(limit = 500): Promise<BomSummary[]> {
  try {
    const rows = await apiGet<RawBomRow[]>(
      buildResourceUrl(BOM_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: BOM_LIST_FIELDS,
          filters: [
            ["is_active", "=", 1],
            ["docstatus", "=", 1],
          ],
          limit_page_length: limit,
          order_by: "item asc",
        })
      )
    );
    const boms = (rows ?? []).map(normalizeBom);
    if (boms.length === 0) {
      console.warn(
        `${LOG_TAG} No active submitted BOMs returned. Finished-product list ` +
          `will be empty. Ensure BOMs exist with docstatus=1 (Submitted) and ` +
          `is_active=1, and that the current user can read the BOM doctype.`
      );
    }
    return boms;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to load active BOMs from ERPNext:`, err);
    throw err;
  }
}

/** Active, submitted BOMs for one finished product (default first, then latest). */
export async function getBomsForItem(itemCode: string): Promise<BomSummary[]> {
  const code = (itemCode ?? "").trim();
  if (!code) return [];
  try {
    const rows = await apiGet<RawBomRow[]>(
      buildResourceUrl(BOM_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: BOM_LIST_FIELDS,
          filters: [
            ["item", "=", code],
            ["is_active", "=", 1],
            ["docstatus", "=", 1],
          ],
          limit_page_length: 100,
          order_by: "is_default desc, modified desc",
        })
      )
    );
    const boms = (rows ?? []).map(normalizeBom);
    if (boms.length === 0) {
      console.warn(`${LOG_TAG} No active submitted BOM found for item "${code}".`);
    }
    return boms;
  } catch (err) {
    console.error(
      `${LOG_TAG} Failed to load BOMs for item "${code}" from ERPNext:`,
      err
    );
    throw err;
  }
}

/** The default active BOM for an item, or the latest active one, or null. */
export async function getDefaultBomForItem(
  itemCode: string
): Promise<BomSummary | null> {
  const boms = await getBomsForItem(itemCode);
  return pickPreferredBom(boms);
}

/** Prefer the default BOM; otherwise the most recently modified. */
function pickPreferredBom(boms: BomSummary[]): BomSummary | null {
  if (boms.length === 0) return null;
  const defaults = boms.filter((b) => b.is_default === 1);
  const pool = defaults.length > 0 ? defaults : boms;
  return [...pool].sort((a, b) =>
    (b.modified ?? "").localeCompare(a.modified ?? "")
  )[0];
}

/**
 * Distinct finished products that have at least one active submitted BOM — the
 * selectable set for the "Finished Product" dropdown. Every option is guaranteed
 * to explode into components. When an item has several BOMs, the finished
 * product still appears once (its BOM is resolved on selection, preferring the
 * latest default via {@link getBomsForItem}).
 */
export async function getFinishedProducts(
  limit = 500
): Promise<BomFinishedItem[]> {
  const boms = await getActiveBoms(limit);
  // Keep the best (default → latest) BOM per finished item so the label shown
  // is the one that would actually be auto-selected.
  const bestByItem = new Map<string, BomSummary>();
  for (const b of boms) {
    if (!b.item) continue;
    const existing = bestByItem.get(b.item);
    if (!existing) {
      bestByItem.set(b.item, b);
      continue;
    }
    const better = pickPreferredBom([existing, b]);
    if (better) bestByItem.set(b.item, better);
  }
  return [...bestByItem.values()]
    .map((b) => ({ item_code: b.item, item_name: b.item_name || b.item }))
    .sort((a, b) => a.item_name.localeCompare(b.item_name));
}

/** Fetch a BOM document and normalize its component (BOM Item) child rows. */
export async function getBomComponents(bomName: string): Promise<{
  header: BomSummary;
  components: BomComponent[];
}> {
  try {
    const doc = await apiGet<RawBomDoc>(
      buildResourceUrl(BOM_DOCTYPE, bomName),
      withSilent()
    );
    const header = normalizeBom(doc);
    const bomQuantity = header.quantity > 0 ? header.quantity : 1;

    const components = (doc.items ?? [])
      .filter((row) => !!(row.item_code && row.item_code.trim()))
      .map<BomComponent>((row) => ({
        item_code: row.item_code as string,
        item_name: row.item_name || (row.item_code as string),
        description: row.description,
        uom: row.stock_uom || row.uom || "Nos",
        item_group: row.item_group,
        qtyForBomOutput: Number(row.stock_qty ?? row.qty) || 0,
        bomQuantity,
      }));

    if (components.length === 0) {
      console.warn(`${LOG_TAG} BOM "${bomName}" returned no component rows.`);
    }
    return { header, components };
  } catch (err) {
    console.error(
      `${LOG_TAG} Failed to load components for BOM "${bomName}" from ERPNext:`,
      err
    );
    throw err;
  }
}

/** Component required quantity for a given production quantity. */
export function requiredQtyForProduction(
  component: Pick<BomComponent, "qtyForBomOutput" | "bomQuantity">,
  productionQty: number
): number {
  const perOutput =
    component.bomQuantity > 0
      ? component.qtyForBomOutput / component.bomQuantity
      : component.qtyForBomOutput;
  const required = perOutput * (productionQty > 0 ? productionQty : 0);
  // Trim floating-point noise (e.g. 0.30000000000000004) to 4 decimals.
  return Math.round(required * 10000) / 10000;
}

/* ────────────────────────────────────────────────────────────────────────────
 * BOM Management — list / detail / create / update / delete
 *
 * Powers the Manufacturing module (Manufacturing / Production Manager, Admin).
 * Every read and write goes through the live ERPNext BOM DocType + BOM Item
 * child rows. No mock data.
 * ──────────────────────────────────────────────────────────────────────────── */

/** BOM as shown in the management list (all statuses, active & inactive). */
export interface BomListRow {
  name: string;
  item: string;
  item_name: string;
  is_active: number;
  is_default: number;
  quantity: number;
  uom?: string;
  docstatus: number;
  total_cost?: number;
  modified?: string;
  creation?: string;
}

interface RawBomListRow extends RawBomRow {
  docstatus?: number;
  total_cost?: number;
  creation?: string;
}

const BOM_MANAGE_LIST_FIELDS = [
  "name",
  "item",
  "item_name",
  "is_active",
  "is_default",
  "quantity",
  "uom",
  "docstatus",
  "total_cost",
  "modified",
  "creation",
];

export interface ListBomsOptions {
  /** Free-text search matched (client-side) against name / item / item_name. */
  search?: string;
  /** Filter by active flag; omit or "all" for no filter. */
  isActive?: 0 | 1 | "all";
  /** Filter by default flag; omit or "all" for no filter. */
  isDefault?: 0 | 1 | "all";
  /** Restrict to a single finished-product item code. */
  item?: string;
  limit?: number;
}

/**
 * List BOMs for the management screens. Server-side filters cover the
 * structured facets (active / default / item); free-text search is applied
 * client-side so it can span the BOM name, item code and item name at once.
 */
export async function listBoms(
  options: ListBomsOptions = {}
): Promise<BomListRow[]> {
  const filters: Filter[] = [];
  if (options.isActive === 0 || options.isActive === 1) {
    filters.push(["is_active", "=", options.isActive]);
  }
  if (options.isDefault === 0 || options.isDefault === 1) {
    filters.push(["is_default", "=", options.isDefault]);
  }
  if (options.item) {
    filters.push(["item", "=", options.item]);
  }

  try {
    const rows = await apiGet<RawBomListRow[]>(
      buildResourceUrl(BOM_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: BOM_MANAGE_LIST_FIELDS,
          filters: filters.length > 0 ? filters : undefined,
          limit_page_length: options.limit ?? 500,
          order_by: "modified desc",
        })
      )
    );

    let list = (rows ?? []).map<BomListRow>((r) => ({
      name: r.name,
      item: r.item ?? "",
      item_name: r.item_name || r.item || r.name,
      is_active: Number(r.is_active ?? 0),
      is_default: Number(r.is_default ?? 0),
      quantity: Number(r.quantity) || 1,
      uom: r.uom,
      docstatus: Number(r.docstatus ?? 0),
      total_cost: r.total_cost !== undefined ? Number(r.total_cost) : undefined,
      modified: r.modified,
      creation: r.creation,
    }));

    const term = (options.search ?? "").trim().toLowerCase();
    if (term) {
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(term) ||
          b.item.toLowerCase().includes(term) ||
          b.item_name.toLowerCase().includes(term)
      );
    }
    return list;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to list BOMs from ERPNext:`, err);
    throw err;
  }
}

export interface BomDetailComponent {
  item_code: string;
  item_name: string;
  item_group?: string;
  qty: number;
  uom: string;
  warehouse?: string;
}

export interface BomDetail {
  name: string;
  item: string;
  item_name: string;
  quantity: number;
  uom?: string;
  is_active: number;
  is_default: number;
  docstatus: number;
  company?: string;
  modified?: string;
  items: BomDetailComponent[];
}

interface RawBomDetailItemRow extends RawBomItemRow {
  source_warehouse?: string;
}

interface RawBomDetailDoc extends RawBomListRow {
  company?: string;
  items?: RawBomDetailItemRow[];
}

/** Full BOM document (header flags + component rows) for the view / edit screens. */
export async function getBomDetail(bomName: string): Promise<BomDetail> {
  try {
    const doc = await apiGet<RawBomDetailDoc>(
      buildResourceUrl(BOM_DOCTYPE, bomName),
      withSilent()
    );
    return {
      name: doc.name,
      item: doc.item ?? "",
      item_name: doc.item_name || doc.item || doc.name,
      quantity: Number(doc.quantity) || 1,
      uom: doc.uom,
      is_active: Number(doc.is_active ?? 0),
      is_default: Number(doc.is_default ?? 0),
      docstatus: Number(doc.docstatus ?? 0),
      company: doc.company,
      modified: doc.modified,
      items: (doc.items ?? [])
        .filter((row) => !!(row.item_code && row.item_code.trim()))
        .map<BomDetailComponent>((row) => ({
          item_code: row.item_code as string,
          item_name: row.item_name || (row.item_code as string),
          item_group: row.item_group,
          qty: Number(row.qty ?? row.stock_qty) || 0,
          uom: row.uom || row.stock_uom || "Nos",
          warehouse: row.source_warehouse,
        })),
    };
  } catch (err) {
    console.error(
      `${LOG_TAG} Failed to load BOM "${bomName}" from ERPNext:`,
      err
    );
    throw err;
  }
}

export interface BomComponentInput {
  item_code: string;
  qty: number;
  uom?: string;
  warehouse?: string;
}

export interface SaveBomInput {
  /** Finished-product item code the BOM produces. */
  item: string;
  quantity?: number;
  is_active?: boolean;
  is_default?: boolean;
  company?: string;
  components: BomComponentInput[];
}

function buildBomChildRows(components: BomComponentInput[]) {
  return components
    .filter((c) => c.item_code && Number(c.qty) > 0)
    .map((c) => {
      const row: Record<string, unknown> = {
        doctype: "BOM Item",
        item_code: c.item_code,
        qty: Number(c.qty),
      };
      if (c.uom) row.uom = c.uom;
      if (c.warehouse) row.source_warehouse = c.warehouse;
      return row;
    });
}

/**
 * Create a BOM in ERPNext. Saved via the whitelisted `frappe.client.save`
 * method (draft), then submitted so it becomes an active, usable BOM when
 * `is_active` is requested. Submission failures are non-fatal — the BOM is
 * still created as a draft and the caller is informed via the returned flag.
 */
export async function createBom(
  input: SaveBomInput
): Promise<{ name: string; submitted: boolean }> {
  const doc: Record<string, unknown> = {
    doctype: BOM_DOCTYPE,
    item: input.item,
    company: input.company || ENV_DEFAULTS.company,
    quantity: input.quantity && input.quantity > 0 ? input.quantity : 1,
    is_active: input.is_active === false ? 0 : 1,
    is_default: input.is_default ? 1 : 0,
    with_operations: 0,
    items: buildBomChildRows(input.components),
  };

  try {
    const saved = await apiPost<{ name: string }>(
      "/api/method/frappe.client.save",
      { doc }
    );
    const name = saved?.name;
    if (!name) throw new Error("ERPNext did not return a BOM name.");

    let submitted = false;
    if (input.is_active !== false) {
      try {
        await submitBom(name);
        submitted = true;
      } catch (submitErr) {
        console.warn(
          `${LOG_TAG} BOM "${name}" was created as a draft but could not be ` +
            `submitted automatically. Activate it in ERPNext if required.`,
          submitErr
        );
      }
    }
    return { name, submitted };
  } catch (err) {
    console.error(`${LOG_TAG} Failed to create BOM in ERPNext:`, err);
    throw err;
  }
}

/** Submit a BOM (docstatus 0 → 1) so it becomes active/usable. */
export async function submitBom(bomName: string): Promise<void> {
  const fresh = await apiGet<{ modified?: string }>(
    buildResourceUrl(BOM_DOCTYPE, bomName),
    withSilent()
  );
  const payload: Record<string, unknown> = { docstatus: 1 };
  if (fresh?.modified) payload.modified = fresh.modified;
  await apiPut(buildResourceUrl(BOM_DOCTYPE, bomName), payload);
}

export interface UpdateBomInput {
  quantity?: number;
  is_active?: boolean;
  is_default?: boolean;
  /** Only applied when the BOM is still a draft (docstatus 0). */
  components?: BomComponentInput[];
}

/**
 * Update a BOM. The active/default flags are editable even on submitted BOMs
 * (ERPNext allows those on-submit). Quantity and component rows are only
 * updatable while the BOM is a draft — submitted BOMs are immutable in ERPNext
 * without an amendment, so those fields are skipped for them.
 */
export async function updateBom(
  bomName: string,
  input: UpdateBomInput
): Promise<void> {
  try {
    const fresh = await apiGet<{ docstatus?: number; modified?: string }>(
      buildResourceUrl(BOM_DOCTYPE, bomName),
      withSilent()
    );
    const isDraft = Number(fresh?.docstatus ?? 0) === 0;

    const payload: Record<string, unknown> = {};
    if (fresh?.modified) payload.modified = fresh.modified;
    if (input.is_active !== undefined) payload.is_active = input.is_active ? 1 : 0;
    if (input.is_default !== undefined)
      payload.is_default = input.is_default ? 1 : 0;
    if (isDraft && input.quantity !== undefined && input.quantity > 0) {
      payload.quantity = input.quantity;
    }
    if (isDraft && input.components) {
      payload.items = buildBomChildRows(input.components);
    }

    await apiPut(buildResourceUrl(BOM_DOCTYPE, bomName), payload);
  } catch (err) {
    console.error(`${LOG_TAG} Failed to update BOM "${bomName}":`, err);
    throw err;
  }
}

/**
 * Delete a BOM. Submitted BOMs are cancelled first (docstatus 1 → 2) because
 * ERPNext refuses to delete a submitted document. Any linkage error (e.g. the
 * BOM is used by another BOM or a work order) is surfaced to the caller.
 */
export async function deleteBom(bomName: string): Promise<void> {
  try {
    const fresh = await apiGet<{ docstatus?: number; modified?: string }>(
      buildResourceUrl(BOM_DOCTYPE, bomName),
      withSilent()
    );
    if (Number(fresh?.docstatus ?? 0) === 1) {
      const cancelPayload: Record<string, unknown> = { docstatus: 2 };
      if (fresh?.modified) cancelPayload.modified = fresh.modified;
      await apiPut(buildResourceUrl(BOM_DOCTYPE, bomName), cancelPayload);
    }
    await apiDelete(buildResourceUrl(BOM_DOCTYPE, bomName), withSilent());
  } catch (err) {
    console.error(`${LOG_TAG} Failed to delete BOM "${bomName}":`, err);
    throw err;
  }
}

export interface FinishedProductSummary {
  item_code: string;
  item_name: string;
  bomCount: number;
  hasDefault: boolean;
  hasActive: boolean;
}

/** Distinct finished products across all BOMs, with per-item BOM stats. */
export async function getFinishedProductsOverview(): Promise<
  FinishedProductSummary[]
> {
  const rows = await listBoms({ limit: 1000 });
  const byItem = new Map<string, FinishedProductSummary>();
  for (const r of rows) {
    if (!r.item) continue;
    const current =
      byItem.get(r.item) ??
      ({
        item_code: r.item,
        item_name: r.item_name || r.item,
        bomCount: 0,
        hasDefault: false,
        hasActive: false,
      } satisfies FinishedProductSummary);
    current.bomCount += 1;
    if (r.is_default === 1) current.hasDefault = true;
    if (r.is_active === 1) current.hasActive = true;
    byItem.set(r.item, current);
  }
  return [...byItem.values()].sort((a, b) =>
    a.item_name.localeCompare(b.item_name)
  );
}

export interface WarehouseOption {
  name: string;
  warehouse_name?: string;
}

/** Active (non-group) warehouses for the BOM component "Warehouse" selector. */
export async function getWarehouses(): Promise<WarehouseOption[]> {
  try {
    const rows = await apiGet<WarehouseOption[]>(
      buildResourceUrl(WAREHOUSE_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: ["name", "warehouse_name"],
          filters: [
            ["is_group", "=", 0],
            ["disabled", "=", 0],
          ],
          limit_page_length: 500,
          order_by: "warehouse_name asc",
        })
      )
    );
    return rows ?? [];
  } catch (err) {
    console.error(`${LOG_TAG} Failed to load warehouses from ERPNext:`, err);
    throw err;
  }
}
