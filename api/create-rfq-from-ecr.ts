import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createRfqFromEcrCore,
  CreateRfqFromEcrError,
} from "./createRfqFromEcrCore.js";
import { RbacError, requireInternalAuth } from "./rbacAuth.js";

const ALLOWED_ROLES = ["procurement"] as const;

async function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    if (Array.isArray(req.body)) {
      throw new CreateRfqFromEcrError("Invalid JSON body.", 400);
    }
    return req.body as Record<string, unknown>;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON object required.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new CreateRfqFromEcrError("Invalid JSON body.", 400);
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
    if (!ALLOWED_ROLES.some((role) => role === principal.role)) {
      throw new RbacError(
        "Only Procurement Manager can create an RFQ from an ECR.",
        403,
      );
    }
    const body = await readJsonBody(req);
    const result = await createRfqFromEcrCore({
      ecrName: body.ecr_name ?? body.ecrName,
      principal,
    });
    res.status(result.created ? 201 : 200).json({ data: result });
  } catch (error) {
    const status = error instanceof RbacError
      ? error.status
      : error instanceof CreateRfqFromEcrError
        ? error.status
        : 500;
    const message = error instanceof Error
      ? error.message
      : "Unable to create an RFQ from this Engineering Change Request.";
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
      ...(error instanceof CreateRfqFromEcrError
        ? {
            code: error.code,
            ...(error.rfqName ? { rfq_name: error.rfqName } : {}),
            ...(error.fieldErrors ? { field_errors: error.fieldErrors } : {}),
          }
        : {}),
    });
  }
}
