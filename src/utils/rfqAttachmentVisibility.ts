/**
 * Pure RFQ / engineering attachment visibility helpers.
 * Shared by the SPA and serverless APIs (no ERP client imports).
 */

export type AttachmentVisibility = "supplier" | "internal";

export const RFQ_DOCUMENT_TYPES = [
  "RFQ Specification",
  "Technical Drawing",
  "2D Drawing",
  "CAD/PDF Reference",
  "BOQ",
  "Scope of Work",
  "Quality Requirements",
  "Packaging Requirements",
  "Inspection Standards",
  "General RFQ Attachment",
] as const;

export type RfqDocumentType = (typeof RFQ_DOCUMENT_TYPES)[number];

export interface AttachmentVisibilityRow {
  id?: string;
  fileName?: string;
  fileUrl: string;
  fileType?: string;
  fileSize?: number;
  uploadedBy?: string;
  uploadedAt?: string;
  source?: string;
  version?: number;
  visibility?: AttachmentVisibility | string;
  documentType?: string;
}

function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function fileLabelFromUrl(url: string): string {
  try {
    const path = url.split("?")[0] ?? url;
    const seg = path.split("/").pop() ?? path;
    return decodeURIComponent(seg);
  } catch {
    return url;
  }
}

export function normalizeAttachmentVisibility(
  raw: unknown,
): AttachmentVisibility {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (
    s === "internal" ||
    s === "internal_only" ||
    s === "internal-only" ||
    s === "private"
  ) {
    return "internal";
  }
  return "supplier";
}

/** True unless explicitly marked Internal Only (legacy rows default to visible). */
export function isSupplierVisibleAttachment(
  att: Pick<AttachmentVisibilityRow, "visibility"> | null | undefined,
): boolean {
  if (!att) return true;
  return normalizeAttachmentVisibility(att.visibility) !== "internal";
}

export function filterSupplierVisibleAttachments<T extends AttachmentVisibilityRow>(
  attachments: T[] | null | undefined,
): T[] {
  return (attachments ?? []).filter(isSupplierVisibleAttachment);
}

/** Infer a document type label from the file name when none was set. */
export function inferDocumentTypeFromFileName(fileName: string): string {
  const n = fileName.toLowerCase();
  if (/boq|bill[_\s-]?of[_\s-]?quant/.test(n)) return "BOQ";
  if (/packag/.test(n)) return "Packaging Requirements";
  if (/inspect/.test(n)) return "Inspection Standards";
  if (/quality|qa[_\s-]?standard/.test(n)) return "Quality Requirements";
  if (/scope|sow\b/.test(n)) return "Scope of Work";
  if (/\.(dwg|dxf)$/.test(n) || /2d|drawing/.test(n)) return "2D Drawing";
  if (/\.(step|stp|iges|igs|stl)$/.test(n) || /\bcad\b/.test(n)) {
    return "CAD/PDF Reference";
  }
  if (/tech(nical)?/.test(n)) return "Technical Drawing";
  if (/spec/.test(n)) return "RFQ Specification";
  return "General RFQ Attachment";
}

export function parseAttachmentVisibilityRows(
  raw: unknown,
): AttachmentVisibilityRow[] {
  if (!raw) return [];
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: AttachmentVisibilityRow[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const fileUrl = String(r.fileUrl ?? r.url ?? "").trim();
    if (!fileUrl) continue;
    const fileName = String(
      r.fileName ?? r.name ?? fileLabelFromUrl(fileUrl),
    ).trim();
    const versionRaw = Number(r.version ?? 1);
    const resolvedName = fileName || fileLabelFromUrl(fileUrl);
    const documentType = String(
      r.documentType ?? r.document_type ?? "",
    ).trim();
    out.push({
      id: r.id != null ? String(r.id) : undefined,
      fileName: resolvedName,
      fileUrl,
      fileType: String(
        r.fileType ?? (fileExtension(fileName).replace(".", "") || "file"),
      ),
      fileSize: Number(r.fileSize ?? r.size ?? 0) || 0,
      uploadedBy: r.uploadedBy ? String(r.uploadedBy) : undefined,
      uploadedAt: String(r.uploadedAt ?? r.uploaded_at ?? ""),
      source: r.source ? String(r.source) : undefined,
      version: Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1,
      visibility: normalizeAttachmentVisibility(
        r.visibility ?? r.visibility_mode,
      ),
      documentType:
        documentType || inferDocumentTypeFromFileName(resolvedName),
    });
  }
  return out;
}

/** Normalize ERP file paths for ACL comparison. */
export function normalizeErpFilePath(path: string): string {
  let p = String(path || "").trim();
  try {
    if (/^https?:\/\//i.test(p)) {
      p = new URL(p).pathname;
    }
  } catch {
    /* keep raw */
  }
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/{2,}/g, "/");
}

/**
 * Whether a supplier may download `filePath` given attachment metadata rows
 * that reference it. Missing rows → allow (legacy default supplier-visible).
 * Explicit Internal Only → deny.
 */
export function supplierMayAccessAttachmentPath(
  filePath: string,
  rows: AttachmentVisibilityRow[],
): boolean {
  const target = normalizeErpFilePath(filePath);
  const matches = rows.filter(
    (r) => normalizeErpFilePath(r.fileUrl) === target,
  );
  if (matches.length === 0) return true;
  return matches.every(isSupplierVisibleAttachment);
}
