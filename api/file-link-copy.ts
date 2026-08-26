import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  copyBusinessNeedFileToCaseCore,
  FileLinkCopyError,
} from "./fileLinkCopyCore.js";
import {
  RbacError,
  requireInternalAuth,
} from "./rbacAuth.js";

async function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    if (Array.isArray(req.body)) {
      throw new FileLinkCopyError("A JSON object is required.", 422, "validation");
    }
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
    throw new FileLinkCopyError("Invalid JSON body.", 400, "validation");
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
    const result = await copyBusinessNeedFileToCaseCore({ payload, principal });
    res.status(result.created ? 201 : 200).json({ data: result });
  } catch (error) {
    const status = error instanceof RbacError
      ? error.status
      : error instanceof FileLinkCopyError
        ? error.status
        : 500;
    const message = error instanceof Error
      ? error.message
      : "Unable to link the Business Need attachment to the Business Case.";
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
      ...(error instanceof FileLinkCopyError
        ? {
            code: error.code,
            ...(error.fieldErrors ? { field_errors: error.fieldErrors } : {}),
          }
        : {}),
    });
  }
}
