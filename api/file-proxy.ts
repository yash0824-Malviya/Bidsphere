import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RbacError, requireAnyAuth } from "./rbacAuth.js";
import {
  fetchErpFile,
  isValidErpFilePath,
} from "./fileProxyCore.js";
import {
  assertSupplierMayDownloadRfqFile,
  buildSupplierAccessCandidates,
  SupplierRfqDocumentsError,
} from "./supplierRfqDocumentsCore.js";

/**
 * Streams ERPNext files (PDF / images / ZIP / CAD) with server API-key credentials.
 * Requires a valid BidSphere access token (internal staff or supplier).
 * Never forwards HTML (login / permission pages) to the browser.
 *
 * Suppliers: when `rfq` query is present, Internal Only attachments are denied.
 */

function readErpnextBaseUrl(): string {
  const raw =
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL;
  if (!raw?.trim()) {
    throw new Error("Missing ERPNEXT_URL environment variable.");
  }
  return raw.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

function readApiCredentials(): { key: string; secret: string } | null {
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!key || !secret) return null;
  return { key, secret };
}

function extractCookie(req: VercelRequest): string | undefined {
  const raw = req.headers.cookie;
  if (typeof raw === "string" && raw.trim()) return raw;
  return undefined;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({
      success: false,
      message: "Method not allowed.",
      status: 405,
    });
    return;
  }

  try {
    const principal = requireAnyAuth(
      req.headers as Record<string, unknown>,
      undefined,
      req.query as Record<string, unknown>,
    );

    /* Supplier downloads with an RFQ context: enforce visibility server-side. */
    if (principal.typ === "supplier") {
      const rawRfq = req.query.rfq;
      const rfqName = Array.isArray(rawRfq) ? rawRfq[0] : rawRfq;
      if (typeof rfqName === "string" && rfqName.trim()) {
        const rawExplicit = req.query.erp_supplier_id;
        const explicitSupplier = Array.isArray(rawExplicit)
          ? rawExplicit[0]
          : rawExplicit;
        const supplierCandidates = buildSupplierAccessCandidates({
          explicitSupplierId:
            typeof explicitSupplier === "string" ? explicitSupplier : undefined,
          jwtSupplier: principal.supplier,
          jwtSub: principal.sub,
        });
        const supplierId = supplierCandidates[0] || "";
        const rawPath = req.query.path;
        const filePath = Array.isArray(rawPath) ? rawPath[0] : rawPath;
        if (typeof filePath === "string" && filePath.trim()) {
          try {
            await assertSupplierMayDownloadRfqFile({
              rfqName: rfqName.trim(),
              supplierId,
              supplierCandidates,
              filePath: filePath.trim(),
            });
          } catch (aclErr) {
            if (aclErr instanceof SupplierRfqDocumentsError) {
              res.status(aclErr.status).json({
                success: false,
                message: aclErr.message,
                status: aclErr.status,
              });
              return;
            }
            throw aclErr;
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof RbacError) {
      res.status(err.status).json({
        success: false,
        message:
          err.status === 401
            ? "Your ERP session has expired."
            : "You do not have permission to view this document.",
        status: err.status,
        detail: err.message,
      });
      return;
    }
    res.status(401).json({
      success: false,
      message: "Your ERP session has expired.",
      status: 401,
    });
    return;
  }

  const rawPath = req.query.path;
  const filePath = Array.isArray(rawPath) ? rawPath[0] : rawPath;
  if (!filePath || typeof filePath !== "string") {
    res.status(400).json({
      success: false,
      message: "Missing 'path' query parameter.",
      status: 400,
    });
    return;
  }
  if (!isValidErpFilePath(filePath)) {
    res.status(400).json({
      success: false,
      message: "Invalid file path.",
      status: 400,
    });
    return;
  }

  let base: string;
  try {
    base = readErpnextBaseUrl();
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unable to retrieve the PDF from ERP.",
      status: 500,
      detail: (err as Error).message,
    });
    return;
  }

  const creds = readApiCredentials();
  if (!creds) {
    console.error("[file-proxy] Missing ERP_API_KEY / ERP_API_SECRET");
    res.status(500).json({
      success: false,
      message: "Unable to retrieve the PDF from ERP.",
      status: 500,
      detail: "ERP API credentials are not configured.",
    });
    return;
  }

  const result = await fetchErpFile({
    baseUrl: base,
    filePath,
    apiKey: creds.key,
    apiSecret: creds.secret,
    cookie: extractCookie(req),
    method: req.method === "HEAD" ? "HEAD" : "GET",
  });

  // Narrow FileProxyFailure before reading `.body`.
  if ("body" in result) {
    res.status(result.status).json(result.body);
    return;
  }

  res.setHeader("Content-Type", result.contentType || "application/octet-stream");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "private, max-age=60");
  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }
  res.status(200).send(result.buffer);
}
