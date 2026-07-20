import type { VercelRequest, VercelResponse } from "@vercel/node";
import multiparty from "multiparty";
import {
  BomError,
  processBomUpload,
  createRfqFromBom,
  getBomHistory,
  buildSampleBomWorkbook,
  type CreateBomRfqInput,
} from "./bomCore.js";
import { RbacError, requireInternalAuth, requireRoles, BOM_ROLES } from "./rbacAuth.js";

/**
 * Procurement BOM Reader API
 * Requires signed BidSphere access token + procurement/manufacturing/admin.
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

function readAction(req: VercelRequest): string {
  const q = req.query.action;
  if (Array.isArray(q)) return q[0] ?? "";
  if (typeof q === "string" && q) return q;
  // Fallback: path suffix when rewrite didn't set action
  const url = req.url ?? "";
  const m = /\/api\/bom\/([^/?]+)/.exec(url);
  return m?.[1] ?? "";
}

function parseMultipart(
  req: VercelRequest,
): Promise<{ fields: Record<string, string[]>; files: Record<string, multiparty.File[]> }> {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form({ maxFilesSize: 20 * 1024 * 1024 });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

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
    throw new BomError("Invalid JSON body.");
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

  const action = readAction(req);

  try {
    // Sample template is public-ish for UX; still require auth so keys aren't open
    if (action !== "sample") {
      const principal = requireInternalAuth(req.headers as Record<string, unknown>);
      requireRoles(principal, BOM_ROLES);
    } else {
      // sample download: any authenticated internal user
      requireInternalAuth(req.headers as Record<string, unknown>);
    }

    if (action === "sample" && (req.method === "GET" || req.method === "POST")) {
      const buf = buildSampleBomWorkbook();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="BidSphere_BOM_Sample_Template.xlsx"',
      );
      res.status(200).send(buf);
      return;
    }

    if (action === "history" && req.method === "GET") {
      const history = await getBomHistory();
      res.status(200).json({ success: true, history });
      return;
    }

    if (action === "upload" && req.method === "POST") {
      const { files } = await parseMultipart(req);
      const fileList = files.file ?? files.bom ?? files.upload ?? [];
      const file = fileList[0];
      if (!file?.path) {
        throw new BomError("No file uploaded. Attach an Excel file as 'file'.");
      }
      const fs = await import("node:fs/promises");
      const buffer = await fs.readFile(file.path);
      const fileName = file.originalFilename || file.path.split(/[/\\]/).pop() || "bom.xlsx";
      const result = await processBomUpload(buffer, fileName);
      // cleanup temp
      try {
        await fs.unlink(file.path);
      } catch {
        /* ignore */
      }
      res.status(200).json(result);
      return;
    }

    if (action === "create-rfq" && req.method === "POST") {
      const body = (await readJsonBody(req)) as CreateBomRfqInput;
      const result = await createRfqFromBom(body);
      res.status(200).json(result);
      return;
    }

    res.status(404).json({ error: `Unknown BOM action: ${action || "(none)"}` });
  } catch (err) {
    if (err instanceof RbacError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    const status = err instanceof BomError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Unexpected BOM processing error.";
    res.status(status).json({ success: false, error: message });
  }
}
