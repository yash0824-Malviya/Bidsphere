import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createEcrDraftCore,
  EcrCreateError,
} from "./ecrCreateCore.js";
import {
  EcrProcurementValidationError,
} from "./ecrProcurementValidation.js";
import {
  RbacError,
  requireInternalAuth,
} from "./rbacAuth.js";

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
    throw new EcrCreateError("Invalid JSON body.", 400, "validation");
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
    const payload = await readJsonBody(req);
    const result = await createEcrDraftCore({ payload, principal });
    res.status(201).json({ data: result });
  } catch (error) {
    const status = error instanceof RbacError
      ? error.status
      : error instanceof EcrProcurementValidationError
        ? error.status
        : error instanceof EcrCreateError
          ? error.status
          : 500;
    const message = error instanceof Error
      ? error.message
      : "Unable to create the Engineering Change Request.";
    const fieldErrors = error instanceof EcrProcurementValidationError
      ? error.fieldErrors
      : error instanceof EcrCreateError
        ? error.fieldErrors
        : undefined;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
      ...(error instanceof EcrCreateError ? { code: error.code } : {}),
      ...(fieldErrors ? { field_errors: fieldErrors } : {}),
    });
  }
}
