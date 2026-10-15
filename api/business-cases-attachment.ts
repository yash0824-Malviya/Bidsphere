/**
 * Dedicated Business Case Attachment View, Download, and Upload Handler.
 * Serves real binary files (PDF, PNG, JPEG, WEBP, etc.) with accurate Content-Type and Content-Disposition.
 * Searches local filesystem first, then transparently queries and fetches from ERPNext.
 */
import type { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

export interface AttachmentResult {
  ok: boolean;
  status: number;
  contentType: string;
  buffer?: Buffer;
  fileName?: string;
  error?: string;
}

const STORAGE_ROOT = path.resolve(process.cwd(), "uploads", "business-cases");
const ATTACHMENTS_ROOT = path.resolve(process.cwd(), "uploads", "attachments");

export function ensureStorageDirectories(): void {
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
  if (!fs.existsSync(ATTACHMENTS_ROOT)) {
    fs.mkdirSync(ATTACHMENTS_ROOT, { recursive: true });
  }
}

/**
 * Compare filenames with Unicode normalization, multiplication sign (×) vs ASCII 'x' conversion,
 * case-insensitivity, and handling of copy suffixes like " (1)".
 */
export function areFilenamesEquivalent(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const norm = (s: string) =>
    s
      .normalize("NFC")
      .replace(/\u00D7/g, "x")
      .toLowerCase()
      .trim();

  const normA = norm(a);
  const normB = norm(b);
  if (normA === normB) return true;

  // Compare without copy suffix like " (1)"
  const stripSuffix = (s: string) => s.replace(/\s*\(\d+\)/g, "");
  const baseA = stripSuffix(normA);
  const baseB = stripSuffix(normB);
  if (baseA === baseB) return true;

  // Compare stems without extension
  const stemA = baseA.replace(/\.[^.]+$/, "");
  const stemB = baseB.replace(/\.[^.]+$/, "");
  return stemA === stemB;
}

/**
 * Determine accurate MIME content-type from magic bytes and filename extension.
 */
export function detectMimeType(buffer: Buffer, fileName: string): string {
  // Magic bytes inspection
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("utf8") === "%PDF") {
    return "application/pdf";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 6) {
    const sig = buffer.subarray(0, 6).toString("ascii");
    if (sig === "GIF87a" || sig === "GIF89a") return "image/gif";
  }

  // Filename extension fallback
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";

  return "application/octet-stream";
}

/**
 * Locate a stored file on disk across known locations with flexible Unicode matching.
 */
export function findAttachmentFile(caseId: string, attIdOrName: string): { filePath: string; fileName: string } | null {
  ensureStorageDirectories();
  const cleanId = decodeURIComponent(attIdOrName).trim();
  const decodedCaseId = decodeURIComponent(caseId).trim();

  const candidateDirs = [
    path.join(STORAGE_ROOT, decodedCaseId),
    STORAGE_ROOT,
    ATTACHMENTS_ROOT,
    path.resolve(process.cwd(), "public", "files"),
  ];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    // 1. Direct path check
    const directPath = path.join(dir, cleanId);
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      return { filePath: directPath, fileName: path.basename(directPath) };
    }

    // 2. Scan directory files for equivalent match
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const full = path.join(dir, file);
        if (!fs.statSync(full).isFile()) continue;

        if (areFilenamesEquivalent(file, cleanId) || areFilenamesEquivalent(cleanId, file)) {
          return { filePath: full, fileName: file };
        }
      }
    } catch {
      /* ignore directory read error */
    }
  }

  // Check user's Downloads folder as fallback
  try {
    const userDownloads = path.join(process.env.USERPROFILE || "C:\\Users\\VICTUS", "Downloads");
    if (fs.existsSync(userDownloads)) {
      const directDownload = path.join(userDownloads, cleanId);
      if (fs.existsSync(directDownload) && fs.statSync(directDownload).isFile()) {
        return { filePath: directDownload, fileName: cleanId };
      }
      const files = fs.readdirSync(userDownloads);
      for (const file of files) {
        if (areFilenamesEquivalent(file, cleanId)) {
          const full = path.join(userDownloads, file);
          if (fs.statSync(full).isFile()) {
            return { filePath: full, fileName: file };
          }
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Query ERPNext File records attached to this Business Case and fetch the file bytes.
 */
async function fetchFromErpNext(
  caseId: string,
  attIdOrName: string,
): Promise<{ buffer: Buffer; fileName: string; contentType: string } | null> {
  const base = (
    process.env.ERPNEXT_URL ||
    process.env.VITE_PROXY_TARGET ||
    process.env.VITE_ERPNEXT_URL ||
    "http://80.225.204.210:8090"
  ).replace(/\/+$/, "").replace(/\/api$/, "");

  const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
  const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";

  if (!key || !secret) {
    return null;
  }

  const cleanId = decodeURIComponent(attIdOrName).trim();
  const cleanCaseId = decodeURIComponent(caseId).trim();

  try {
    const url = `${base}/api/resource/File?filters=${encodeURIComponent(
      JSON.stringify([
        ["attached_to_doctype", "=", "Business Case"],
        ["attached_to_name", "=", cleanCaseId],
        ["is_folder", "=", 0],
      ]),
    )}&fields=${encodeURIComponent(
      JSON.stringify(["name", "file_name", "file_url", "file_size", "is_private"]),
    )}&limit_page_length=50`;

    const res = await fetch(url, {
      headers: {
        Authorization: `token ${key}:${secret}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: Array<{
        name: string;
        file_name?: string;
        file_url?: string;
        file_size?: number;
        is_private?: number;
      }>;
    };

    const records = json.data || [];
    const match = records.find(
      (f) =>
        f.name === cleanId ||
        areFilenamesEquivalent(cleanId, f.file_name || "") ||
        areFilenamesEquivalent(cleanId, (f.file_url || "").split("/").pop() || ""),
    );

    if (!match || !match.file_url) return null;

    // Fetch the physical file bytes from ERPNext
    const upstreamUrl = `${base}${match.file_url.startsWith("/") ? match.file_url : `/${match.file_url}`}`;
    const fileRes = await fetch(upstreamUrl, {
      headers: {
        Authorization: `token ${key}:${secret}`,
        Accept: "*/*",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!fileRes.ok) return null;

    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) return null;

    const resolvedFileName = match.file_name || match.file_url.split("/").pop() || cleanId;
    const contentType = detectMimeType(buffer, resolvedFileName);

    return {
      buffer,
      fileName: resolvedFileName,
      contentType,
    };
  } catch (err) {
    console.warn(`[BusinessCaseAttachment] ERP fetch failed for ${caseId} / ${attIdOrName}:`, err);
    return null;
  }
}

/**
 * Handle GET attachment requests: stream binary bytes with correct headers.
 */
export async function handleBusinessCaseAttachment(
  _req: IncomingMessage,
  res: ServerResponse,
  urlStr: string,
): Promise<boolean> {
  const parsedUrl = new URL(urlStr, "http://localhost");
  const pathname = parsedUrl.pathname;

  // Regex pattern matching:
  // /api/business-cases/:caseId/attachments/:attId/view
  // /api/business-cases/:caseId/attachments/:attId/download
  const match = pathname.match(
    /^\/api\/business-cases\/([^/]+)\/attachments\/([^/]+)\/(view|download)$/i,
  );

  if (!match) return false;

  const caseId = match[1];
  const attIdOrName = match[2];
  const action = match[3].toLowerCase();
  const isDownload =
    action === "download" ||
    parsedUrl.searchParams.get("download") === "1" ||
    parsedUrl.searchParams.get("disposition") === "attachment";

  // 1. Try local storage
  const foundLocal = findAttachmentFile(caseId, attIdOrName);
  let buffer: Buffer | null = null;
  let fileName = "";
  let contentType = "";

  if (foundLocal) {
    try {
      buffer = fs.readFileSync(foundLocal.filePath);
      fileName = foundLocal.fileName;
      contentType = detectMimeType(buffer, fileName);
    } catch {
      buffer = null;
    }
  }

  // 2. Fall back to ERPNext
  if (!buffer || buffer.length === 0) {
    const erpResult = await fetchFromErpNext(caseId, attIdOrName);
    if (erpResult) {
      buffer = erpResult.buffer;
      fileName = erpResult.fileName;
      contentType = erpResult.contentType;
    }
  }

  if (!buffer || buffer.length === 0) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        status: 404,
        message: "Document could not be found or is no longer available.",
      }),
    );
    return true;
  }

  try {
    const disposition = isDownload ? "attachment" : "inline";
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType || "application/octet-stream");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${encodeURIComponent(fileName)}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.end(buffer);
    return true;
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        status: 500,
        message: "Failed to read attachment from storage.",
        detail: err?.message || String(err),
      }),
    );
    return true;
  }
}

export default async function handler(req: any, res: any): Promise<void> {
  let url = req.url;
  if (!url || !url.startsWith("/api/business-cases/")) {
    if (req.query?.caseId && req.query?.path) {
      const action = req.query.download === "1" ? "download" : "view";
      url = `/api/business-cases/${encodeURIComponent(req.query.caseId)}/attachments/${encodeURIComponent(req.query.path)}/${action}`;
    } else if (req.query?.path) {
      url = `/api/business-cases/${req.query.path}`;
    }
  }

  const handled = await handleBusinessCaseAttachment(req, res, url || "");
  if (!handled && !res.writableEnded) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        status: 404,
        message: "Document could not be found or is no longer available.",
      }),
    );
  }
}
