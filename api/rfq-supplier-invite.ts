import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  inviteSuppliersToRfqCore,
  RfqSupplierInviteError,
  type InviteSupplierInput,
} from "./rfqSupplierInviteCore.js";
import {
  RbacError,
  requireInternalAuth,
  requireRoles,
} from "./rbacAuth.js";
import { logRfqApiFailure, logRfqApiRequest } from "./rfqApiLog.js";

const INVITE_ROLES = ["procurement", "procurement_team", "admin"] as const;

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
      throw new RfqSupplierInviteError("Invalid JSON body.", 400);
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
      message: "Method Not Allowed. Use POST /api/rfq-supplier-invite.",
    });
    return;
  }

  try {
    const principal = requireInternalAuth(
      req.headers as Record<string, unknown>,
    );
    requireRoles(principal, [...INVITE_ROLES]);

    const body = await readJsonBody(req);
    const rfqName = String(body.rfq_name ?? body.rfqName ?? "").trim();
    logRfqApiRequest(req, {
      endpoint: "/api/rfq-supplier-invite",
      rfqName: rfqName || undefined,
      payload: body,
    });
    const suppliersRaw = Array.isArray(body.suppliers) ? body.suppliers : [];
    const suppliers: InviteSupplierInput[] = suppliersRaw
      .map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        return {
          supplier: String(r.supplier ?? "").trim(),
          supplier_name: String(r.supplier_name ?? r.supplierName ?? "").trim(),
          email_id: String(r.email_id ?? r.emailId ?? "").trim() || undefined,
        };
      })
      .filter((s) => s.supplier);

    const result = await inviteSuppliersToRfqCore({ rfqName, suppliers });

    res.status(200).json({
      success: true,
      rfq: result.rfq,
      invited: result.invited,
    });
  } catch (err) {
    const status =
      err instanceof RfqSupplierInviteError
        ? err.status
        : err instanceof RbacError
          ? err.status
          : 500;
    const message =
      err instanceof Error
        ? err.message
        : "Could not invite suppliers to this RFQ.";
    const code =
      err instanceof RfqSupplierInviteError ? err.code : undefined;

    logRfqApiFailure(req, err, {
      endpoint: "/api/rfq-supplier-invite",
      rfqName: String(
        (req.body as { rfq_name?: string } | undefined)?.rfq_name ?? "",
      ).trim() || undefined,
      payload: req.body,
    });

    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
      ...(code ? { code } : {}),
    });
  }
}
