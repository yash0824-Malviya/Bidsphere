import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  runStockCheck,
  StockCheckError,
  type StockCheckItemInput,
} from "./stockCheckCore.js";
import {
  RbacError,
  requireInternalAuth,
  requireRoles,
} from "./rbacAuth.js";

const STOCK_CHECK_ROLES = ["warehouse", "admin", "procurement"] as const;

function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body as Record<string, unknown>);
  }
  return (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new StockCheckError("Invalid JSON body.", 400);
    }
  })();
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      message: "Method Not Allowed. Use POST /api/stock-check.",
    });
    return;
  }

  try {
    const principal = requireInternalAuth(
      req.headers as Record<string, unknown>,
    );
    requireRoles(principal, [...STOCK_CHECK_ROLES]);

    const body = await readJsonBody(req);
    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    const items: StockCheckItemInput[] = itemsRaw.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        item_code: String(r.item_code ?? "").trim(),
        requested_qty: Number(r.requested_qty) || 0,
        mr_warehouse: String(r.mr_warehouse ?? "").trim() || undefined,
      };
    });

    const warehousesRaw = Array.isArray(body.warehouses) ? body.warehouses : [];
    const warehouses = warehousesRaw
      .map((w) => String(w ?? "").trim())
      .filter(Boolean);

    const result = await runStockCheck({
      mr_number: String(body.mr_number ?? "").trim(),
      company: String(body.company ?? "").trim(),
      mr_company: String(body.mr_company ?? "").trim() || undefined,
      warehouse: String(body.warehouse ?? "").trim(),
      warehouses: warehouses.length ? warehouses : undefined,
      items,
      user:
        String(body.user ?? "").trim() ||
        principal.email ||
        "Warehouse",
    });

    res.status(200).json(result);
  } catch (err) {
    console.error("=== ERROR ===");
    if (err instanceof Error) {
      console.error(err.stack || err.message);
    } else {
      console.error(err);
    }

    if (err instanceof RbacError) {
      res.status(err.status).json({
        success: false,
        message: err.message,
        code: "permission",
      });
      return;
    }
    if (err instanceof StockCheckError) {
      res.status(err.status).json({
        success: false,
        message: err.message,
        code: err.code,
      });
      return;
    }
    const message =
      err instanceof Error
        ? err.message
        : "Unable to fetch stock availability.";
    res.status(500).json({ success: false, message });
  }
}
