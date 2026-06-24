/**
 * ERPNext Supplier service.
 *
 * Wraps the `Supplier` and `Supplier Group` REST endpoints with typed helpers
 * that share the central Axios instance (and therefore the auth interceptor)
 * defined in `./erpnext.ts`.
 */

import {
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
} from "./erpnext";
import type { ListParams } from "./erpnext";
import type { Supplier, SupplierGroup } from "../types/erpnext";

const SUPPLIER_DOCTYPE = "Supplier";
const SUPPLIER_GROUP_DOCTYPE = "Supplier Group";

/**
 * List suppliers, optionally filtered.
 *
 * @example
 * await getSuppliers({
 *   filters: [["disabled", "=", 0]],
 *   fields: ["name", "supplier_name", "supplier_group"],
 *   limit_page_length: 50,
 * });
 */
export async function getSuppliers(filters?: ListParams): Promise<Supplier[]> {
  return apiGet<Supplier[]>(
    buildResourceUrl(SUPPLIER_DOCTYPE),
    buildListConfig({
      fields: [
        "name",
        "supplier_name",
        "supplier_group",
        "country",
        "disabled",
        "modified",
      ],
      filters: [["disabled", "=", 0]],
      order_by: "supplier_name asc",
      limit_page_length: 100,
      ...filters,
    })
  );
}

/** Fetch a single supplier by primary key (`name`). */
export async function getSupplier(name: string): Promise<Supplier> {
  return apiGet<Supplier>(buildResourceUrl(SUPPLIER_DOCTYPE, name));
}

/**
 * Create a new supplier.
 *
 * Pass any subset of `Supplier` fields; ERPNext will fill in defaults.
 */
export async function createSupplier(
  data: Partial<Supplier>
): Promise<Supplier> {
  return apiPost<Supplier>(buildResourceUrl(SUPPLIER_DOCTYPE), data);
}

/** Update an existing supplier. Only the supplied fields are changed. */
export async function updateSupplier(
  name: string,
  data: Partial<Supplier>
): Promise<Supplier> {
  return apiPut<Supplier>(buildResourceUrl(SUPPLIER_DOCTYPE, name), data);
}

/**
 * Resolve the active/inactive state for a set of suppliers in one round-trip.
 *
 * A supplier is "Active" when its ERPNext `disabled` flag is 0 (the default).
 * Returns a map keyed by supplier `name`; suppliers not found in the result are
 * omitted (callers decide how to treat unknowns).
 */
export async function getSupplierActiveMap(
  names: string[]
): Promise<Map<string, boolean>> {
  const unique = [...new Set(names.filter(Boolean))];
  const map = new Map<string, boolean>();
  if (unique.length === 0) return map;

  // First try matching by ERPNext document `name` (the link ID)
  const rows = await apiGet<Supplier[]>(
    buildResourceUrl(SUPPLIER_DOCTYPE),
    buildListConfig({
      fields: ["name", "supplier_name", "disabled"],
      filters: [["name", "in", unique]],
      limit_page_length: unique.length,
    })
  );
  for (const row of rows) {
    map.set(row.name, row.disabled !== 1);
  }

  // For any names not found by document ID, try matching by `supplier_name`.
  // This handles cases where a display name was stored instead of the link ID.
  const missing = unique.filter((n) => !map.has(n));
  if (missing.length > 0) {
    const byNameRows = await apiGet<Supplier[]>(
      buildResourceUrl(SUPPLIER_DOCTYPE),
      buildListConfig({
        fields: ["name", "supplier_name", "disabled"],
        filters: [["supplier_name", "in", missing]],
        limit_page_length: missing.length,
      })
    );
    for (const row of byNameRows) {
      // Map the display name to the result so callers can look it up
      map.set(row.supplier_name, row.disabled !== 1);
      map.set(row.name, row.disabled !== 1);
    }
  }

  return map;
}

/**
 * Guard used by RFQ and Purchase Order creation: reject the operation if any of
 * the referenced suppliers is inactive (disabled). This enforces the
 * Active-supplier rule at the data layer so an inactive supplier can never be
 * assigned to a new procurement document — even via direct API calls or a
 * stale dropdown.
 */
export async function assertSuppliersActive(names: string[]): Promise<void> {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return;

  const activeMap = await getSupplierActiveMap(unique);

  const notFound = unique.filter((name) => !activeMap.has(name));
  if (notFound.length > 0) {
    throw new Error(
      notFound.length === 1
        ? `Supplier "${notFound[0]}" not found in ERPNext Supplier Master.`
        : `The following suppliers were not found: ${notFound.join(", ")}.`
    );
  }

  const inactive = unique.filter((name) => activeMap.get(name) === false);
  if (inactive.length > 0) {
    throw new Error(
      inactive.length === 1
        ? `${inactive[0]} is inactive and cannot be assigned to new procurement activities. Reactivate the supplier or choose an active one.`
        : `The following suppliers are inactive and cannot be used: ${inactive.join(
            ", "
          )}. Reactivate them or choose active suppliers.`
    );
  }
}

/**
 * Resolve a supplier identifier (display name or doc ID) to the canonical
 * ERPNext Supplier document `name`. Returns `null` if no match is found.
 *
 * Searches first by document `name`, then by `supplier_name` as a fallback,
 * ensuring full supplier names like "Atlantic Precision Manufacturing" are
 * never truncated or split.
 */
export async function resolveSupplierERPNextId(
  identifier: string
): Promise<string | null> {
  if (!identifier) return null;

  // Try exact match by document name
  const byId = await apiGet<Supplier[]>(
    buildResourceUrl(SUPPLIER_DOCTYPE),
    buildListConfig({
      fields: ["name"],
      filters: [["name", "=", identifier]],
      limit_page_length: 1,
    })
  );
  if (byId.length > 0) return byId[0].name;

  // Fallback: match by display name
  const byName = await apiGet<Supplier[]>(
    buildResourceUrl(SUPPLIER_DOCTYPE),
    buildListConfig({
      fields: ["name"],
      filters: [["supplier_name", "=", identifier]],
      limit_page_length: 1,
    })
  );
  return byName.length > 0 ? byName[0].name : null;
}

/** List supplier groups (used to populate the "Supplier Group" dropdown). */
export async function getSupplierGroups(
  filters?: ListParams
): Promise<SupplierGroup[]> {
  return apiGet<SupplierGroup[]>(
    buildResourceUrl(SUPPLIER_GROUP_DOCTYPE),
    buildListConfig({
      fields: ["name", "supplier_group_name", "is_group", "modified"],
      order_by: "supplier_group_name asc",
      limit_page_length: 100,
      ...filters,
    })
  );
}
