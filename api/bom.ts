import type { VercelRequest, VercelResponse } from "@vercel/node";
import multiparty from "multiparty";
import {
  BomError,
  processBomUpload,
  createRfqFromBom,
  getBomHistory,
  buildSampleBomWorkbook,
  type BomParsedRow,
  type BomRowStatus,
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

const BOM_ROW_STATUSES = new Set<BomRowStatus>([
  "exists",
  "new",
  "missing_uom",
  "duplicate",
  "invalid",
]);

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
): Promise<{
  fields: Record<string, string[] | undefined>;
  files: Record<string, multiparty.File[] | undefined>;
}> {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBomRowStatus(value: unknown): BomRowStatus {
  const status = String(value ?? "");
  return BOM_ROW_STATUSES.has(status as BomRowStatus)
    ? (status as BomRowStatus)
    : "invalid";
}

function parseBomParsedRow(raw: unknown, index: number): BomParsedRow {
  if (!isPlainObject(raw)) {
    throw new BomError(`Invalid BOM row at index ${index}.`);
  }
  return {
    row_number: Number(raw.row_number) || index + 1,
    item_code: String(raw.item_code ?? ""),
    item_name: String(raw.item_name ?? ""),
    description: String(raw.description ?? ""),
    qty: Number(raw.qty) || 0,
    uom: String(raw.uom ?? ""),
    required_date: String(raw.required_date ?? ""),
    commodity: String(raw.commodity ?? ""),
    category: String(raw.category ?? ""),
    manufacturer: String(raw.manufacturer ?? ""),
    manufacturer_part_number: String(raw.manufacturer_part_number ?? ""),
    drawing_number: String(raw.drawing_number ?? ""),
    revision: String(raw.revision ?? ""),
    remarks: String(raw.remarks ?? ""),
    status: parseBomRowStatus(raw.status),
    status_label: String(raw.status_label ?? ""),
    exists_in_erp: Boolean(raw.exists_in_erp),
    erp_item_group:
      typeof raw.erp_item_group === "string" ? raw.erp_item_group : undefined,
    errors: Array.isArray(raw.errors)
      ? raw.errors.map((e) => String(e))
      : [],
  };
}

/** Validate JSON body and build a typed CreateBomRfqInput (no unsafe casts). */
function parseCreateBomRfqInput(body: Record<string, unknown>): CreateBomRfqInput {
  if (!Array.isArray(body.rows)) {
    throw new BomError("Missing required field: rows.");
  }
  if (!Array.isArray(body.suppliers)) {
    throw new BomError("Missing required field: suppliers.");
  }

  const rows = body.rows.map((row, index) => parseBomParsedRow(row, index));
  const suppliers = body.suppliers.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new BomError(`Invalid suppliers[${index}].`);
    }
    const supplier = String(entry.supplier ?? "").trim();
    if (!supplier) {
      throw new BomError(`Invalid suppliers[${index}]: supplier is required.`);
    }
    return {
      supplier,
      supplier_name:
        typeof entry.supplier_name === "string"
          ? entry.supplier_name
          : undefined,
    };
  });

  const input: CreateBomRfqInput = {
    rows,
    suppliers,
  };

  if (typeof body.uploaded_by === "string") input.uploaded_by = body.uploaded_by;
  if (typeof body.remarks === "string") input.remarks = body.remarks;
  if (typeof body.message_for_supplier === "string") {
    input.message_for_supplier = body.message_for_supplier;
  }
  if (typeof body.company === "string") input.company = body.company;
  if (typeof body.file_name === "string") input.file_name = body.file_name;
  if (typeof body.file_base64 === "string") input.file_base64 = body.file_base64;
  if (typeof body.file_mime === "string") input.file_mime = body.file_mime;

  return input;
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
      const body = await readJsonBody(req);
      const input = parseCreateBomRfqInput(body);
      const result = await createRfqFromBom(input);
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
