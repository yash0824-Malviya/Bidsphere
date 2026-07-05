import { apiGet, COMPANY } from "../api/erpnext";

/**
 * Validates that a warehouse exists and belongs to the specified company.
 * Returns true if valid, false otherwise.
 */
export async function validateWarehouseBelongsToCompany(
  warehouseName: string,
  company: string = COMPANY
): Promise<boolean> {
  if (!warehouseName || !company) return false;
  try {
    const warehouse = await apiGet<{ company?: string }>(
      `/api/resource/Warehouse/${encodeURIComponent(warehouseName)}`
    );
    return warehouse?.company === company;
  } catch (error) {
    console.error(`Failed to validate warehouse ${warehouseName} for company ${company}:`, error);
    return false;
  }
}
