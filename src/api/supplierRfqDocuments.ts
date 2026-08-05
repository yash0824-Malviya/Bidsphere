/**
 * Supplier Portal — fetch supplier-visible RFQ documents (server-enforced).
 */

import axios from "axios";
import { readErpProxyAccessToken } from "../utils/accessToken";

export interface SupplierRfqDocument {
  id: string;
  fileName: string;
  fileUrl: string;
  documentType: string;
  fileType: string;
  version: number;
  uploadedBy: string;
  uploadedAt: string;
  fileSize: number;
  itemCode?: string;
  itemName?: string;
  previewable: boolean;
}

export async function getSupplierRfqDocuments(input: {
  rfqName: string;
  erpSupplierId: string;
  /** When set, returns documents for that RFQ line item only. */
  itemCode?: string;
}): Promise<SupplierRfqDocument[]> {
  const rfqName = String(input.rfqName || "").trim();
  const erpSupplierId = String(input.erpSupplierId || "").trim();
  const itemCode = String(input.itemCode || "").trim();
  if (!rfqName) return [];

  const token = readErpProxyAccessToken();
  const { data } = await axios.post<{
    success?: boolean;
    documents?: SupplierRfqDocument[];
    error?: string;
  }>(
    "/api/supplier-rfq-documents",
    {
      rfq_name: rfqName,
      erp_supplier_id: erpSupplierId,
      ...(itemCode ? { item_code: itemCode } : {}),
    },
    {
      headers: token
        ? { "X-Bidsphere-Access-Token": token }
        : undefined,
    },
  );

  if (!data?.success) {
    throw new Error(data?.error || "Unable to load RFQ documents.");
  }
  const documents = Array.isArray(data.documents) ? data.documents : [];
  // eslint-disable-next-line no-console
  console.info("[SupplierRFQ Documents]", {
    rfqId: rfqName,
    itemCode: itemCode || null,
    documentCount: documents.length,
  });
  return documents;
}

function normalizeErpFilePathForProxy(fileUrl: string): string {
  let path = String(fileUrl || "").trim();
  try {
    if (/^https?:\/\//i.test(path)) {
      path = new URL(path).pathname;
    }
  } catch {
    /* keep */
  }
  if (!path.startsWith("/")) path = `/${path}`;
  return path;
}

/** Authenticated file-proxy href with RFQ ACL context for suppliers. */
export function supplierRfqDocumentHref(
  fileUrl: string,
  rfqName: string,
  erpSupplierId?: string,
): string {
  const path = normalizeErpFilePathForProxy(fileUrl);
  const params = new URLSearchParams({
    path,
    rfq: String(rfqName || "").trim(),
  });
  const explicit = String(erpSupplierId || "").trim();
  if (explicit) params.set("erp_supplier_id", explicit);
  try {
    const token = readErpProxyAccessToken();
    if (token) params.set("access_token", token);
  } catch {
    /* ignore */
  }
  return `/api/file-proxy?${params.toString()}`;
}

function mimeFromFileName(fileName: string): string | null {
  const lower = fileName.split("?")[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

/**
 * Fetch a supplier-visible RFQ file as a typed Blob for in-modal preview.
 * Uses the BidSphere access token header (img/iframe cannot send it reliably).
 */
export async function fetchSupplierRfqDocumentBlob(input: {
  fileUrl: string;
  rfqName: string;
  erpSupplierId?: string;
  fileName?: string;
}): Promise<Blob> {
  const path = normalizeErpFilePathForProxy(input.fileUrl);
  if (!path) {
    throw new Error("No file URL available.");
  }

  const params = new URLSearchParams({
    path,
    rfq: String(input.rfqName || "").trim(),
  });
  const explicit = String(input.erpSupplierId || "").trim();
  if (explicit) params.set("erp_supplier_id", explicit);
  const token = readErpProxyAccessToken();
  /* Keep query token as fallback for environments that only read query auth. */
  if (token) params.set("access_token", token);

  const headers: Record<string, string> = {
    Accept: "application/pdf,image/png,image/jpeg,image/*,*/*;q=0.8",
  };
  if (token) {
    headers["X-Bidsphere-Access-Token"] = token;
  }

  const res = await fetch(`/api/file-proxy?${params.toString()}`, {
    method: "GET",
    headers,
    credentials: "same-origin",
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; detail?: string };
      detail = String(body?.message || body?.detail || detail).trim() || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || "Unable to load this document.");
  }

  const upstreamType = (res.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (
    upstreamType.includes("application/json") ||
    upstreamType.includes("text/html")
  ) {
    throw new Error("Unable to load this document for preview.");
  }

  const buffer = await res.arrayBuffer();
  if (!buffer.byteLength) {
    throw new Error("Unable to load this document for preview.");
  }

  const inferred =
    mimeFromFileName(input.fileName || path) ||
    (upstreamType &&
    upstreamType !== "application/octet-stream" &&
    upstreamType !== "binary/octet-stream"
      ? upstreamType
      : null) ||
    "application/octet-stream";

  return new Blob([buffer], { type: inferred });
}

export function isSupplierRfqDownloadOnly(fileName: string, fileType?: string): boolean {
  const path = `${fileName} ${fileType ?? ""}`.toLowerCase();
  return /\.(dwg|dxf|step|stp|zip)$/i.test(path);
}

export function supplierRfqPreviewActionLabel(
  fileName: string,
  fileType?: string,
): "View" | "Preview" {
  const path = `${fileName} ${fileType ?? ""}`.toLowerCase();
  if (/\.(png|jpe?g)$/i.test(path) || path.includes("image/")) return "Preview";
  return "View";
}

export function isSupplierRfqPreviewable(
  fileName: string,
  fileType?: string,
): boolean {
  const path = `${fileName} ${fileType ?? ""}`.toLowerCase();
  return /\.(png|jpe?g|pdf)$/i.test(path) || path.includes("pdf") ||
    path.includes("image/png") ||
    path.includes("image/jpeg") ||
    path.includes("image/jpg");
}
