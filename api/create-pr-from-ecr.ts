import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createPrFromEcrCore,
  CreatePrFromEcrError,
} from "./createPrFromEcrCore.js";
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
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON object required.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new CreatePrFromEcrError("Invalid JSON body.", 400);
  }
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
    res.status(405).json({ success: false, message: "Method Not Allowed." });
    return;
  }

  try {
    const principal = requireInternalAuth(req.headers as Record<string, unknown>);
    requireRoles(principal, [...ALLOWED_ROLES]);
    const body = await readJsonBody(req);
    const result = await createPrFromEcrCore({
      ecrName: String(body.ecr_name ?? body.ecrName ?? ""),
      principal,
    });
    res.status(result.created ? 201 : 200).json({ data: result });
  } catch (error) {
    const status = error instanceof RbacError
      ? error.status
      : error instanceof CreatePrFromEcrError
        ? error.status
        : 500;
    const message = error instanceof Error
      ? error.message
      : "Unable to create Purchase Requisition from Engineering Change Request.";
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
      ...(error instanceof CreatePrFromEcrError
        ? {
            code: error.code,
            ...(error.prName ? { pr_name: error.prName } : {}),
            ...(error.fieldErrors ? { field_errors: error.fieldErrors } : {}),
          }
        : {}),
    });
  }
}
