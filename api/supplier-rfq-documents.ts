import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RbacError, requireSupplierAuth } from "./rbacAuth.js";
import { logRfqApiFailure, logRfqApiRequest } from "./rfqApiLog.js";
import {
  buildSupplierAccessCandidates,
  listSupplierRfqDocuments,
  SupplierRfqDocumentsError,
} from "./supplierRfqDocumentsCore.js";

/**
 * POST /api/supplier-rfq-documents
 * Body: { rfq_name, erp_supplier_id? }
 * Auth: supplier portal JWT only.
 *
 * Returns supplier-visible RFQ attachments only (Internal Only stripped).
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed." });
    return;
  }

  const body =
    (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};

  try {
    const principal = requireSupplierAuth(
      req.headers as Record<string, unknown>,
      body as Record<string, unknown>,
    );
    const supplierId = String(
      (body as { erp_supplier_id?: string }).erp_supplier_id ||
        principal.supplier ||
        principal.sub ||
        "",
    ).trim();
    const supplierCandidates = buildSupplierAccessCandidates({
      explicitSupplierId: (body as { erp_supplier_id?: string }).erp_supplier_id,
      jwtSupplier: principal.supplier,
      jwtSub: principal.sub,
    });
    const rfqName = String(
      (body as { rfq_name?: string; rfqName?: string }).rfq_name ||
        (body as { rfqName?: string }).rfqName ||
        "",
    ).trim();
    const itemCode = String(
      (body as { item_code?: string; itemCode?: string }).item_code ||
        (body as { itemCode?: string }).itemCode ||
        "",
    ).trim();

    logRfqApiRequest(req, {
      endpoint: "/api/supplier-rfq-documents",
      rfqName: rfqName || undefined,
      payload: { rfq_name: rfqName, item_code: itemCode || undefined },
    });

    const documents = await listSupplierRfqDocuments({
      rfqName,
      supplierId,
      supplierCandidates,
      itemCode: itemCode || undefined,
    });

    console.info("[supplier-rfq-documents]", {
      rfqId: rfqName,
      supplierId,
      itemCode: itemCode || null,
      documentCount: documents.length,
    });

    res.status(200).json({
      success: true,
      documents,
      rfq_id: rfqName,
      document_count: documents.length,
    });
  } catch (err) {
    if (err instanceof RbacError) {
      logRfqApiFailure(req, err, { endpoint: "/api/supplier-rfq-documents" });
      res.status(err.status).json({
        success: false,
        error: err.message,
      });
      return;
    }
    if (err instanceof SupplierRfqDocumentsError) {
      logRfqApiFailure(req, err, { endpoint: "/api/supplier-rfq-documents" });
      res.status(err.status).json({
        success: false,
        error: err.message,
      });
      return;
    }
    logRfqApiFailure(req, err, { endpoint: "/api/supplier-rfq-documents" });
    res.status(500).json({
      success: false,
      error: "Unable to load RFQ documents.",
    });
  }
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
