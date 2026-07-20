import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getPoShipment,
  listPoShipments,
  listReadyForGrnShipments,
  upsertPoShipment,
  PoShipmentError,
} from "./poShipmentCore.js";
import {
  RbacError,
  requireAnyAuth,
  requireRoles,
  type AccessPrincipal,
  type AppRole,
} from "./rbacAuth.js";

const INTERNAL_READ_ROLES: AppRole[] = [
  "admin",
  "procurement",
  "warehouse",
  "finance",
  "finance_executive",
];

const INTERNAL_WRITE_ROLES: AppRole[] = ["admin", "procurement", "warehouse"];

function assertCanRead(principal: AccessPrincipal): void {
  if (principal.typ === "supplier") return;
  requireRoles(principal, INTERNAL_READ_ROLES);
}

function assertCanWrite(principal: AccessPrincipal): void {
  if (principal.typ === "supplier") return;
  requireRoles(principal, INTERNAL_WRITE_ROLES);
}

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

    switch (action) {
      case "get": {
        assertCanRead(principal);
        const record = await getPoShipment(String(body.po_name ?? ""));
        res.status(200).json({ success: true, record });
        return;
      }
      case "list": {
        assertCanRead(principal);
        const records = await listPoShipments({
          poNames: Array.isArray(body.po_names) ? body.po_names : undefined,
          statuses: Array.isArray(body.statuses) ? body.statuses : undefined,
          readyForGrn: body.ready_for_grn === true,
          warehouseVisible: body.warehouse_visible === true,
          limit: typeof body.limit === "number" ? body.limit : undefined,
        });
        res.status(200).json({ success: true, records });
        return;
      }
      case "list-ready": {
        assertCanRead(principal);
        const records = await listReadyForGrnShipments(
          typeof body.limit === "number" ? body.limit : 200,
        );
        res.status(200).json({ success: true, records });
        return;
      }
      case "upsert": {
        assertCanWrite(principal);
        const record = await upsertPoShipment(body);
        res.status(200).json({ success: true, record });
        return;
      }
      default:
        res.status(404).json({ error: `Unknown po-shipment action: ${action}` });
    }
  } catch (err) {
    if (err instanceof RbacError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof PoShipmentError) {
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
