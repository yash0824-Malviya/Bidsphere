import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createRfqFromPrCore,
  CreateRfqFromPrError,
} from "./createRfqFromPrCore.js";
import { RbacError, requireInternalAuth, requireRoles } from "./rbacAuth.js";

const ALLOWED_ROLES = ["procurement", "procurement_team", "admin"] as const;

async function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new CreateRfqFromPrError("Invalid JSON body.", 400);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method Not Allowed." });
    return;
  }

  try {
    const principal = requireInternalAuth(req.headers as Record<string, unknown>);
    requireRoles(principal, [...ALLOWED_ROLES]);
    const body = await readJsonBody(req);
    const suppliers = Array.isArray(body.suppliers)
      ? body.suppliers.map((supplier) => String(supplier ?? ""))
      : [];
    const result = await createRfqFromPrCore({
      prName: String(body.pr_name ?? body.prName ?? ""),
      suppliers,
      title: String(body.title ?? "") || undefined,
      scheduleDate: String(body.schedule_date ?? body.scheduleDate ?? "") || undefined,
    });
    res.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof RbacError
      ? error.status
      : error instanceof CreateRfqFromPrError
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : "Unable to create RFQ from Purchase Requisition.";
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
      ...(error instanceof CreateRfqFromPrError
        ? { code: error.code, rfq_name: error.rfqName }
        : {}),
    });
  }
}
