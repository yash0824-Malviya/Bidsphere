/**
 * Budget consumption helpers — PO commitments from ERPNext.
 * Extracted to avoid circular imports between budget.ts and erpBudget.ts.
 */

import { apiGet, buildListConfig, buildResourceUrl, withSilent } from "./erpnext";

const LOG_TAG = "[BudgetConsumption]";

export interface SubmittedPORow {
  name: string;
  grand_total?: number;
  custom_rfq_reference?: string;
  transaction_date?: string;
}

export function logBudgetConsumption(op: string, data?: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`${LOG_TAG} ${op}`, data ?? "");
}

/** Submitted Purchase Orders from ERPNext (docstatus = 1). */
export async function fetchSubmittedPurchaseOrders(): Promise<SubmittedPORow[]> {
  logBudgetConsumption("FETCH submitted POs");
  try {
    const rows = await apiGet<SubmittedPORow[]>(
      buildResourceUrl("Purchase Order"),
      {
        ...buildListConfig({
          fields: ["name", "grand_total", "custom_rfq_reference", "transaction_date"],
          filters: [["docstatus", "=", 1]],
          limit_page_length: 500,
        }),
        ...withSilent(),
      }
    );
    return rows ?? [];
  } catch (err) {
    logBudgetConsumption("FETCH submitted POs — error", err);
    return [];
  }
}
