import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  applyEcrWorkflowActionCore,
  EcrWorkflowError,
} from "./ecrWorkflowCore.js";
import { RbacError, requireInternalAuth } from "./rbacAuth.js";

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
    throw new EcrWorkflowError("Invalid JSON body.", 400);
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
    const body = await readJsonBody(req);
    const ecrIdentifier =
      body.name ?? body.ecr_name ?? body.ecrId ?? body.ecr_number ?? body.id;
    const result = await applyEcrWorkflowActionCore({
      name: ecrIdentifier,
      action: body.action,
      comment: body.comment,
      reviewFields:
        body.reviewFields && typeof body.reviewFields === "object" && !Array.isArray(body.reviewFields)
          ? body.reviewFields as Record<string, unknown>
          : {},
      principal,
    });
    res.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof RbacError
      ? error.status
      : error instanceof EcrWorkflowError
        ? error.status
        : 500;
    const message = error instanceof Error
      ? error.message
      : "Unable to apply the ECR workflow action.";
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
      ...(error instanceof EcrWorkflowError ? { code: error.code } : {}),
      ...(error instanceof EcrWorkflowError && error.fieldErrors
        ? { field_errors: error.fieldErrors }
        : {}),
    });
  }
}
