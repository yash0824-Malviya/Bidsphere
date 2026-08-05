import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  activateRfqRoundCore,
  createNextRfqRoundCore,
  ensureInitialRfqRoundCore,
  getActiveRfqRoundCore,
  getRfqRoundCore,
  listRfqRoundsCore,
  RfqQuoteRoundError,
} from "./rfqQuoteRoundCore.js";
import {
  RbacError,
  requireInternalAuth,
  requireRoles,
} from "./rbacAuth.js";
import { logRfqApiFailure, logRfqApiRequest } from "./rfqApiLog.js";

const ROUND_ROLES = ["procurement", "procurement_team", "admin"] as const;

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
      throw new RfqQuoteRoundError("Invalid JSON body.", 400);
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

  const action =
    String(req.query.action ?? "").trim() ||
    String((req.body as Record<string, unknown> | undefined)?.action ?? "").trim();

  try {
    const principal = requireInternalAuth(
      req.headers as Record<string, unknown>,
    );
    requireRoles(principal, [...ROUND_ROLES]);

    const rfqName = String(req.query.rfq ?? req.query.rfq_name ?? "").trim();
    logRfqApiRequest(req, {
      endpoint: "/api/rfq-quote-round",
      action: action || "list",
      rfqName: rfqName || undefined,
    });

    if (req.method === "GET") {
      const roundName = String(req.query.name ?? req.query.round ?? "").trim();

      if (action === "get" && roundName) {
        const round = await getRfqRoundCore(roundName);
        res.status(200).json({ success: true, round });
        return;
      }

      if (action === "active" && rfqName) {
        const round = await getActiveRfqRoundCore(rfqName);
        res.status(200).json({ success: true, round });
        return;
      }

      if (rfqName) {
        const rounds = await listRfqRoundsCore(rfqName);
        res.status(200).json({ success: true, rounds });
        return;
      }

      throw new RfqQuoteRoundError(
        "Provide rfq query parameter or action=get with name.",
        400,
      );
    }

    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        message: "Method Not Allowed.",
      });
      return;
    }

    const body = await readJsonBody(req);
    const rfqName = String(body.rfq_name ?? body.rfqName ?? "").trim();
    const createdBy =
      String(body.created_by ?? body.createdBy ?? principal.email ?? "Procurement").trim();

    if (action === "ensure-initial") {
      if (!rfqName) throw new RfqQuoteRoundError("rfq_name is required.", 400);
      const result = await ensureInitialRfqRoundCore({ rfqName, createdBy });
      res.status(200).json({ success: true, ...result });
      return;
    }

    if (action === "create-next") {
      const reasonCode = String(body.reason_code ?? body.reasonCode ?? "").trim();
      const remarks = String(body.remarks ?? "").trim();
      if (!rfqName) throw new RfqQuoteRoundError("rfq_name is required.", 400);
      const rawSuppliers = body.associate_suppliers ?? body.associateSuppliers;
      const rawInvite =
        body.invite_suppliers ?? body.inviteSuppliers ?? rawSuppliers;
      const mapSuppliers = (rows: unknown) =>
        Array.isArray(rows)
          ? rows
              .map((row) => {
                const r = row as Record<string, unknown>;
                const supplier = String(r.supplier ?? "").trim();
                if (!supplier) return null;
                return {
                  supplier,
                  supplier_name: String(r.supplier_name ?? r.supplierName ?? supplier),
                  email_id: String(r.email_id ?? r.emailId ?? "") || undefined,
                };
              })
              .filter((s): s is NonNullable<typeof s> => !!s)
          : undefined;
      const associateSuppliers = mapSuppliers(rawSuppliers);
      const inviteSuppliers = mapSuppliers(rawInvite);
      const result = await createNextRfqRoundCore({
        rfqName,
        reasonCode,
        remarks,
        createdBy,
        associateSuppliers,
        inviteSuppliers,
      });
      res.status(200).json({ success: true, ...result });
      return;
    }

    if (action === "activate") {
      const roundName = String(body.round_name ?? body.roundName ?? "").trim();
      if (!roundName) throw new RfqQuoteRoundError("round_name is required.", 400);
      const round = await activateRfqRoundCore({ roundName, createdBy });
      res.status(200).json({ success: true, round });
      return;
    }

    throw new RfqQuoteRoundError(`Unknown action: ${action || "(none)"}`, 400);
  } catch (err) {
    const status =
      err instanceof RfqQuoteRoundError
        ? err.status
        : err instanceof RbacError
          ? err.status
          : 500;
    const message =
      err instanceof Error ? err.message : "RFQ quote round request failed.";
    const code =
      err instanceof RfqQuoteRoundError ? err.code : undefined;

    logRfqApiFailure(req, err, {
      endpoint: "/api/rfq-quote-round",
      action: action || undefined,
      rfqName: String(req.query.rfq ?? req.query.rfq_name ?? "").trim() || undefined,
      payload: req.method === "POST" ? req.body : undefined,
    });

    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
      ...(code ? { code } : {}),
    });
  }
}
