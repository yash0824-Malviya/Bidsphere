import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PoShipmentError } from "./poShipmentCore.js";
import { RbacError, requireAnyAuth } from "./rbacAuth.js";
import { ClmError } from "./clmCore.js";
import { handlePoShipmentAction } from "./poShipmentAccess.js";

/**
 * POST /api/po-shipment/:action
 *
 * Privileged read/write for the shared Supplier ↔ Warehouse shipment record.
 * Accepts internal JWT or supplier portal JWT.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};

  try {
    const principal = requireAnyAuth(
      req.headers as Record<string, unknown>,
      body as Record<string, unknown>,
    );

    const result = await handlePoShipmentAction(principal, String(action ?? ""), body);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof RbacError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof PoShipmentError || err instanceof ClmError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : "PO shipment request failed.";
    // eslint-disable-next-line no-console
    console.error(`[po-shipment] action=${action} FAILED:`, message);
    res.status(500).json({ success: false, error: message });
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
