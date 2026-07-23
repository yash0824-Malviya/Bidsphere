import { apiGet, COMPANY, buildListConfig, buildResourceUrl } from "../api/erpnext";

/**
 * Validates that a warehouse exists and belongs to the specified company.
 * Returns true if valid, false otherwise.
 */
export async function validateWarehouseBelongsToCompany(
  warehouseName: string,
  company: string = COMPANY,
): Promise<boolean> {
  if (!warehouseName || !company) return false;
  try {
    const warehouse = await apiGet<{ company?: string }>(
      `/api/resource/Warehouse/${encodeURIComponent(warehouseName)}`,
    );
    return warehouse?.company === company;
  } catch (error) {
    console.error(
      `Failed to validate warehouse ${warehouseName} for company ${company}:`,
      error,
    );
    return false;
  }
}

/** Fetch Warehouse.company for a warehouse name. */
export async function getWarehouseCompany(
  warehouseName: string,
): Promise<string | null> {
  if (!warehouseName) return null;
  try {
    const warehouse = await apiGet<{ company?: string }>(
      `/api/resource/Warehouse/${encodeURIComponent(warehouseName)}`,
    );
    return warehouse?.company?.trim() || null;
  } catch {
    return null;
  }
}

/** Short user-facing copy required by Warehouse Review Process Selected. */
export const SELECTED_WAREHOUSE_OTHER_COMPANY_MESSAGE =
  "Selected warehouse belongs to another company.";

/** Reason code shown on Forward Failed workflow rows. */
export const WAREHOUSE_COMPANY_MISMATCH_REASON = "Warehouse Company Mismatch";

/**
 * True when an ERP / app error is a warehouse↔company mismatch
 * (e.g. Warehouse "Stores - B" does not belong to company "Netlink").
 */
export function isWarehouseCompanyMismatchError(message: string): boolean {
  return /does not belong to company|belongs to (Company |another company)|Warehouse Company Mismatch|Selected warehouse belongs to another company/i.test(
    message,
  );
}

/**
 * User-facing error when a warehouse is not on the Material Request company.
 * Example: Selected Warehouse belongs to Company A. Please choose a warehouse from Company Netlink.
 */
export function warehouseCompanyMismatchMessage(
  warehouseName: string,
  warehouseCompany: string | null | undefined,
  expectedCompany: string,
): string {
  const actual = warehouseCompany?.trim() || "another company";
  // Prefer the short Process Selected message; keep detail in logs.
  // eslint-disable-next-line no-console
  console.warn("[WarehouseValidation] company mismatch", {
    warehouseName,
    warehouseCompany: actual,
    expectedCompany,
  });
  return SELECTED_WAREHOUSE_OTHER_COMPANY_MESSAGE;
}

/**
 * Assert warehouse belongs to expected company (typically Material Request.company).
 * Throws a clear UI error — never rely on ERPNext's cryptic company validation.
 */
export async function assertWarehouseBelongsToCompany(
  warehouseName: string,
  expectedCompany: string,
  role: "Source" | "Target" | "Warehouse" = "Warehouse",
): Promise<void> {
  if (!warehouseName?.trim()) {
    throw new Error(
      `${role} warehouse could not be resolved for company "${expectedCompany}". ` +
        `Please configure a non-group warehouse under Company ${expectedCompany}.`,
    );
  }
  if (!expectedCompany?.trim()) {
    throw new Error(
      `Material Request has no company. Cannot validate ${role.toLowerCase()} warehouse.`,
    );
  }
  const actualCompany = await getWarehouseCompany(warehouseName);
  if (!actualCompany) {
    throw new Error(
      `${role} warehouse "${warehouseName}" was not found in ERPNext.`,
    );
  }
  if (actualCompany !== expectedCompany) {
    throw new Error(
      warehouseCompanyMismatchMessage(
        warehouseName,
        actualCompany,
        expectedCompany,
      ),
    );
  }
}

/**
 * Leaf warehouses for a single company — no cross-company fallback.
 * Used for Stock Entry / Issue Material (Warehouse.company == MR.company).
 */
export async function resolveCompanyWarehouses(
  company: string,
): Promise<string[]> {
  const companyName = company?.trim();
  if (!companyName) return [];
  try {
    const list = await apiGet<Array<{ name?: string; company?: string }>>(
      buildResourceUrl("Warehouse"),
      {
        ...buildListConfig({
          fields: ["name", "company"],
          filters: [
            ["company", "=", companyName],
            ["is_group", "=", 0],
            ["disabled", "=", 0],
          ],
          limit_page_length: 500,
          order_by: "name asc",
        }),
        timeout: 15_000,
      },
    );
    const names = (Array.isArray(list) ? list : [])
      .map((w) => w.name)
      .filter((n): n is string => Boolean(n));
    // eslint-disable-next-line no-console
    console.log("[WarehouseValidation] resolveCompanyWarehouses", {
      company: companyName,
      count: names.length,
      sample: names.slice(0, 10),
    });
    return names;
  } catch (err) {
    console.error(
      `[WarehouseValidation] resolveCompanyWarehouses failed for ${companyName}`,
      err,
    );
    return [];
  }
}

/**
 * Prefer a "Stores …" warehouse for the company, else first leaf warehouse.
 * Never returns a warehouse from another company. Never hardcodes names.
 */
export async function resolvePreferredCompanyWarehouse(
  company: string,
): Promise<string> {
  const names = await resolveCompanyWarehouses(company);
  if (names.length === 0) return "";
  const stores = names.find((w) => w.toLowerCase().includes("stores"));
  return stores ?? names[0] ?? "";
}
