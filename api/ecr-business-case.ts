import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyEcrBusinessCaseActionCore, fetchEcrBusinessCaseCore } from "./ecrBusinessCaseCore.js";
import { EcrWorkflowError } from "./ecrWorkflowCore.js";
import { RbacError, requireInternalAuth } from "./rbacAuth.js";

async function readBody(req: VercelRequest): Promise<Record<string, unknown>> {
  let value: unknown = req.body;
  if (value === undefined) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 256_000) throw new EcrWorkflowError("Business Case request is too large.", 413);
      chunks.push(buffer);
    }
    value = Buffer.concat(chunks).toString("utf8");
  }
  if (typeof value === "string" || Buffer.isBuffer(value)) {
    try { value = JSON.parse(String(value)); } catch { throw new EcrWorkflowError("Invalid JSON body.", 400); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EcrWorkflowError("Request body must be an object.", 400);
  return value as Record<string, unknown>;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!["GET", "POST"].includes(req.method ?? "")) { res.status(405).json({ message: "Method Not Allowed." }); return; }
  try {
    const principal = requireInternalAuth(req.headers as Record<string, unknown>);
    const data = req.method === "GET"
      ? await fetchEcrBusinessCaseCore({ ecr_name: req.query.ecr, principal })
      : await (async () => {
        const body = await readBody(req);
        return applyEcrBusinessCaseActionCore({ ecr_name: body.ecr_name, action: body.action, payload: body.payload, comment: body.comment, role: body.role, expected_modified: body.expected_modified, rfq_required: body.rfq_required, rfq_decision_reason: body.rfq_decision_reason, principal });
      })();
    res.status(200).json({ data });
  } catch (error) {
    const status = error instanceof EcrWorkflowError || error instanceof RbacError ? error.status : 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false, message: error instanceof Error ? error.message : "Unable to process the ECR Business Case.",
      ...(error instanceof EcrWorkflowError ? { code: error.code, ...(error.fieldErrors ? { field_errors: error.fieldErrors } : {}) } : {}),
    });
  }
}
