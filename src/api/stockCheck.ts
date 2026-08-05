/**
 * Client for Warehouse Stock Decision stock availability.
 * Calls privileged `/api/stock-check` (Bin across company warehouses + SLE).
 */

export type StockCheckWarehouseQty = {
  warehouse: string;
  available_qty: number;
  reserved_qty: number;
  source: "bin" | "get_stock_balance";
};

export type StockCheckRecommendation =
  | "Issue Material"
  | "Stock available in another warehouse"
  | "Issue Partial Stock"
  | "Forward to Procurement";

export type StockCheckLine = {
  item_code: string;
  requested_qty: number;
  available_qty: number;
  local_available_qty: number;
  reserved_qty: number;
  shortage_qty: number;
  recommendation: StockCheckRecommendation;
  warehouse: string;
  best_warehouse: string;
  best_warehouse_qty: number;
  item_default_warehouse?: string;
  mr_warehouse?: string;
  by_warehouse: StockCheckWarehouseQty[];
  source: "bin" | "get_stock_balance" | "bin+aggregated";
};

export type StockCheckSuccess = {
  success: true;
  mr_number: string;
  company: string;
  warehouse: string;
  mr_company?: string;
  notice?: string;
  lines: StockCheckLine[];
};

export type StockCheckFailure = {
  success: false;
  message: string;
  code?: string;
};

export class StockCheckApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "StockCheckApiError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchStockCheck(input: {
  mr_number: string;
  company: string;
  mr_company?: string;
  warehouse: string;
  warehouses?: string[];
  items: Array<{
    item_code: string;
    requested_qty: number;
    mr_warehouse?: string;
  }>;
  user?: string;
}): Promise<StockCheckSuccess> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    const token =
      sessionStorage.getItem("bidsphere-access-token") ||
      localStorage.getItem("bidsphere-access-token-remember");
    if (token) headers["X-Bidsphere-Access-Token"] = token;
  } catch {
    /* ignore */
  }

  // eslint-disable-next-line no-console
  console.log("[stock-check] HTTP REQUEST", {
    url: "/api/stock-check",
    payload: input,
  });

  const res = await fetch("/api/stock-check", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });

  let json: (StockCheckSuccess | StockCheckFailure) & Record<string, unknown>;
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {
      success: false,
      message: `Stock check failed (${res.status}).`,
    };
  }

  // eslint-disable-next-line no-console
  console.log("[stock-check] HTTP RESPONSE", {
    status: res.status,
    body: json,
  });

  if (!res.ok || json.success === false) {
    const message =
      (json as StockCheckFailure).message ||
      `Unable to fetch stock availability. (HTTP ${res.status})`;
    // eslint-disable-next-line no-console
    console.error("[stock-check] FAILED", {
      status: res.status,
      message,
      erpException: (json as { exception?: string }).exception,
      body: json,
    });
    throw new StockCheckApiError(
      message,
      res.status,
      (json as StockCheckFailure).code,
    );
  }

  return json as StockCheckSuccess;
}
