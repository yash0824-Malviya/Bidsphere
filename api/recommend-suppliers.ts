import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  canBypassSupplierCategoryFilter,
  RecommendSuppliersError,
  runRecommendSuppliers,
  type RecommendSuppliersRequest,
} from "./recommendSuppliersCore.js";
import {
  RbacError,
  requireInternalAuth,
  requireRoles,
} from "./rbacAuth.js";
import { logRfqApiFailure, logRfqApiRequest } from "./rfqApiLog.js";

const RECOMMEND_SUPPLIERS_ROLES = [
  "admin",
  "procurement",
  "procurement_team",
] as const;

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
      throw new RecommendSuppliersError("Invalid JSON body.", 400);
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
      message: "Method Not Allowed. Use POST /api/recommend-suppliers.",
    });
    return;
  }

  try {
    const principal = requireInternalAuth(
      req.headers as Record<string, unknown>,
    );
    requireRoles(principal, [...RECOMMEND_SUPPLIERS_ROLES]);

    const body = await readJsonBody(req);
    logRfqApiRequest(req, {
      endpoint: "/api/recommend-suppliers",
      payload: body,
    });
    const showAllRequested = body.show_all === true;
    if (showAllRequested && !canBypassSupplierCategoryFilter(principal.role)) {
      throw new RecommendSuppliersError(
        "Only Procurement Manager or Admin may show all suppliers.",
        403,
        "permission",
      );
    }

    const itemGroupsRaw = Array.isArray(body.item_groups) ? body.item_groups : [];
    const input: RecommendSuppliersRequest = {
      procurement_type: String(body.procurement_type ?? "").trim(),
      procurement_category: String(body.procurement_category ?? "").trim(),
      commodity: String(body.commodity ?? "").trim(),
      item_groups: itemGroupsRaw.map((g) => String(g ?? "").trim()).filter(Boolean),
      search: String(body.search ?? "").trim(),
      show_all: showAllRequested,
      limit: Number(body.limit) || 100,
    };

    const result = await runRecommendSuppliers(input);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof RecommendSuppliersError) {
      res.status(err.status).json({
        success: false,
        message: err.message,
        code: err.code,
      });
      return;
    }
    if (err instanceof RbacError) {
      logRfqApiFailure(req, err, { endpoint: "/api/recommend-suppliers" });
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    const message =
      err instanceof Error ? err.message : "Supplier recommendation failed.";
    logRfqApiFailure(req, err, { endpoint: "/api/recommend-suppliers" });
    res.status(500).json({ success: false, message });
  }
}
