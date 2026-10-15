import { getFullFileUrl } from "../api/legalDocsStorage";
import type { IntakeAttachment } from "../types/businessIntake";

export interface AttachmentLike {
  id?: string;
  file_id?: string;
  name?: string;
  file_name?: string;
  fileName?: string;
  file_url?: string;
  url?: string;
  is_private?: boolean | number;
  content_type?: string;
  type?: string;
  fileType?: string;
  document_type?: string;
  category?: string;
}

/**
 * Detect MIME content-type from filename, URL or Frappe file_type.
 */
export function detectContentType(fileNameOrUrl?: string, frappeFileType?: string): string {
  const normalizedType = String(frappeFileType || "").trim().toUpperCase();
  if (normalizedType === "PNG") return "image/png";
  if (normalizedType === "JPG" || normalizedType === "JPEG") return "image/jpeg";
  if (normalizedType === "WEBP") return "image/webp";
  if (normalizedType === "GIF") return "image/gif";
  if (normalizedType === "SVG") return "image/svg+xml";
  if (normalizedType === "PDF") return "application/pdf";

  const lower = String(fileNameOrUrl || "").split("?")[0].toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt")) return "text/plain";

  return "application/octet-stream";
}

/**
 * Check if the attachment is an image based on its content-type or filename.
 */
export function isImageAttachment(
  file?: AttachmentLike | string | null,
): boolean {
  if (!file) return false;
  if (typeof file === "string") {
    const type = detectContentType(file);
    return type.startsWith("image/");
  }
  const mime = file.content_type || file.fileType || detectContentType(file.file_name || file.name || file.file_url, file.type);
  return mime.startsWith("image/");
}

/**
 * Check if the attachment is a PDF based on its content-type or filename.
 */
export function isPdfAttachment(
  file?: AttachmentLike | string | null,
): boolean {
  if (!file) return false;
  if (typeof file === "string") {
    const type = detectContentType(file);
    return type === "application/pdf";
  }
  const mime = file.content_type || file.fileType || detectContentType(file.file_name || file.name || file.file_url, file.type);
  return mime === "application/pdf";
}

/**
 * Central authoritative resolver for attachment URLs across BidSphere.
 *
 * 1. Prefers the backend-provided authoritative `file_url`.
 * 2. Preserves absolute URLs, blob URLs, data URLs.
 * 3. Handles private files securely through the authenticated `/api/file-proxy` endpoint.
 * 4. Correctly handles relative URLs.
 * 5. Does not invent URLs from filename unless as an explicit fallback.
 */
export function resolveAttachmentUrl(
  file?: IntakeAttachment | AttachmentLike | string | null,
  fallbackCaseId?: string,
): string {
  if (!file) return "";

  // String input
  if (typeof file === "string") {
    const trimmed = file.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;
    if (trimmed.startsWith("/api/file-proxy") || trimmed.includes("/api/file-proxy")) {
      return trimmed;
    }
    if (/^\/?(private\/)?files\//i.test(trimmed)) {
      return getFullFileUrl(trimmed);
    }
    return trimmed;
  }

  // Object input:
  // If file.url is already resolved (e.g. proxy with token or blob/data), use it
  if (file.url && (file.url.startsWith("/api/file-proxy") || file.url.startsWith("blob:") || file.url.startsWith("data:"))) {
    return file.url;
  }

  const rawPath = file.file_url || file.url;
  const fileId = file.file_id || file.id;

  if (rawPath && typeof rawPath === "string") {
    const trimmed = rawPath.trim();
    if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;
    if (trimmed.startsWith("/api/file-proxy") || trimmed.includes("/api/file-proxy")) {
      return trimmed;
    }
    if (/^\/?(private\/)?files\//i.test(trimmed)) {
      return getFullFileUrl(trimmed, fileId);
    }
    return trimmed;
  }

  // Fallback if only filename & caseId exist
  const fileName = file.file_name || file.fileName || file.name;
  if (fallbackCaseId && fileName) {
    return `/api/business-cases/${encodeURIComponent(fallbackCaseId)}/attachments/${encodeURIComponent(fileName)}/view`;
  }

  return "";
}
