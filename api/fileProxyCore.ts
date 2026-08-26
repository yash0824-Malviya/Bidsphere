/**
 * Shared ERPNext file-proxy logic (production handler + Vite dev middleware).
 * Streams PDF, images, and other ERP file binaries with the correct
 * Content-Type. Never streams HTML login/permission pages to the browser.
 */

export type FileProxyErrorBody = {
  success: false;
  message: string;
  status: number;
  detail?: string;
  erpStatus?: number;
  contentType?: string;
  file?: {
    name?: string;
    file_name?: string;
    file_url?: string;
    is_private?: number | boolean;
    attached_to_doctype?: string;
    attached_to_name?: string;
    attached_to_field?: string;
    exists: boolean;
  };
};

export type FileProxyFileRecord = {
  name: string;
  file_name?: string;
  file_url: string;
  is_private?: number | boolean;
  is_folder?: number | boolean;
  attached_to_doctype?: string;
  attached_to_name?: string;
  attached_to_field?: string;
};

export type FileProxySuccess = {
  ok: true;
  status: number;
  buffer: Buffer;
  contentType: string;
  targetUrl: string;
};

export type FileProxyFailure = {
  ok: false;
  status: number;
  body: FileProxyErrorBody;
  targetUrl: string;
};

export function canonicalErpFilePath(filePath: string): string | null {
  if (typeof filePath !== "string" || !filePath || filePath !== filePath.trim()) return null;
  let decoded = filePath;
  let stable = false;
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        stable = true;
        break;
      }
      decoded = next;
    }
  } catch {
    return null;
  }
  if (!stable) return null;
  let normalized = decoded.startsWith("/") ? decoded : `/${decoded}`;
  if (
    /[\\?#\0\r\n]/.test(normalized) ||
    !(/^\/files\//i.test(normalized) || /^\/private\/files\//i.test(normalized))
  ) {
    return null;
  }
  if (/^\/private\/files\//i.test(normalized)) {
    normalized = `/private/files/${normalized.slice(15)}`;
  } else if (/^\/files\//i.test(normalized)) {
    normalized = `/files/${normalized.slice(7)}`;
  }

  const segments = normalized.split("/");
  const fileSegments = normalized.startsWith("/private/files/")
    ? segments.slice(3)
    : segments.slice(2);
  if (
    fileSegments.length === 0 ||
    fileSegments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function normalizeFilePath(filePath: string): string {
  return canonicalErpFilePath(filePath) || "";
}

/** Encode path segments for an HTTP request URL (not for ERP file_url params). */
function encodeFilePathForHttp(filePath: string): string {
  return normalizeFilePath(filePath)
    .split("/")
    .map((segment, idx) => (idx === 0 ? segment : encodeURIComponent(segment)))
    .join("/");
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.byteLength >= 4 && buffer.subarray(0, 4).toString("utf8") === "%PDF";
}

function isPngBuffer(buffer: Buffer): boolean {
  return (
    buffer.byteLength >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

function isJpegBuffer(buffer: Buffer): boolean {
  return (
    buffer.byteLength >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function isGifBuffer(buffer: Buffer): boolean {
  if (buffer.byteLength < 6) return false;
  const sig = buffer.subarray(0, 6).toString("ascii");
  return sig === "GIF87a" || sig === "GIF89a";
}

function isWebpBuffer(buffer: Buffer): boolean {
  return (
    buffer.byteLength >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function isZipBuffer(buffer: Buffer): boolean {
  return (
    buffer.byteLength >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  );
}

function contentTypeOf(headers: Headers): string {
  return (headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
}

/** Guess MIME from path extension when upstream omits a useful Content-Type. */
export function contentTypeFromFilePath(filePath: string): string | null {
  const lower = filePath.split("?")[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".dwg")) return "application/acad";
  if (lower.endsWith(".dxf")) return "application/dxf";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) {
    return "application/step";
  }
  if (lower.endsWith(".iges") || lower.endsWith(".igs")) {
    return "application/iges";
  }
  if (lower.endsWith(".stl")) return "model/stl";
  return null;
}

/**
 * Resolve the Content-Type to send to the browser.
 * Prefer magic bytes, then upstream header, then path extension.
 */
export function resolveFileContentType(
  buffer: Buffer,
  upstreamContentType: string,
  filePath: string,
): string {
  if (isPdfBuffer(buffer)) return "application/pdf";
  if (isPngBuffer(buffer)) return "image/png";
  if (isJpegBuffer(buffer)) return "image/jpeg";
  if (isGifBuffer(buffer)) return "image/gif";
  if (isWebpBuffer(buffer)) return "image/webp";
  if (isZipBuffer(buffer)) return "application/zip";

  const upstream = (upstreamContentType || "").split(";")[0].trim().toLowerCase();
  if (
    upstream &&
    !upstream.includes("text/html") &&
    !upstream.includes("application/json") &&
    upstream !== "application/octet-stream" &&
    upstream !== "binary/octet-stream"
  ) {
    return upstream;
  }

  return contentTypeFromFilePath(filePath) || upstream || "application/octet-stream";
}

function isBinaryFileSuccess(
  status: number,
  buffer: Buffer,
  contentType: string,
  method: string = "GET",
): boolean {
  if (status < 200 || status >= 300) return false;
  // HEAD has no body — trust status + content-type (still reject HTML/JSON errors).
  if (method === "HEAD") {
    if (contentType.includes("text/html")) return false;
    if (contentType.includes("application/json")) return false;
    return true;
  }
  if (buffer.byteLength === 0) return false;
  const preview = previewText(buffer, 300);
  if (looksLikeHtml(contentType, preview)) return false;
  // ERP sometimes returns JSON error bodies with HTTP 200.
  if (
    contentType.includes("application/json") &&
    !isPdfBuffer(buffer) &&
    !isPngBuffer(buffer) &&
    !isJpegBuffer(buffer)
  ) {
    return false;
  }
  return true;
}

function looksLikeHtml(contentType: string, preview: string): boolean {
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    return true;
  }
  const sample = preview.toLowerCase();
  return (
    sample.includes("<!doctype html") ||
    sample.includes("<html") ||
    sample.includes("<head") ||
    (sample.includes("login") && sample.includes("<form"))
  );
}

function previewText(buffer: Buffer, max = 300): string {
  return buffer.subarray(0, Math.min(max, buffer.byteLength)).toString("utf8");
}

function extractErpJsonMessage(preview: string): string | null {
  try {
    const parsed = JSON.parse(preview) as {
      message?: unknown;
      exc_type?: string;
      exception?: string;
      _server_messages?: string;
    };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    if (parsed._server_messages) {
      try {
        const arr = JSON.parse(parsed._server_messages) as unknown;
        if (Array.isArray(arr) && arr.length > 0) {
          const first =
            typeof arr[0] === "string" ? JSON.parse(arr[0]) : arr[0];
          const msg = (first as { message?: string })?.message;
          if (typeof msg === "string" && msg.trim()) {
            return msg.replace(/<[^>]+>/g, "").trim();
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (parsed.exc_type === "PermissionError") {
      return "You do not have permission to view this document.";
    }
    if (parsed.exc_type === "DoesNotExistError") {
      return "Document not found.";
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/**
 * Map ERP upstream status / body to a BidSphere JSON error.
 * Prefer exact ERP status semantics over generic copy.
 */
export function classifyNonPdfResponse(
  upstreamStatus: number,
  contentType: string,
  preview: string,
): FileProxyErrorBody {
  const sample = preview.toLowerCase();
  const html = looksLikeHtml(contentType, preview);
  const erpMessage = extractErpJsonMessage(preview);

  const loginPage =
    html &&
    (sample.includes("login") ||
      sample.includes("sign in") ||
      sample.includes("forgot password") ||
      sample.includes("/api/method/login"));

  const permissionDenied =
    upstreamStatus === 403 ||
    sample.includes("permission") ||
    sample.includes("not permitted") ||
    sample.includes("don't have permission") ||
    sample.includes("do not have permission") ||
    sample.includes("forbidden") ||
    sample.includes("permissionerror");

  const notFound =
    upstreamStatus === 404 ||
    sample.includes("not found") ||
    sample.includes("does not exist") ||
    sample.includes("no such file") ||
    sample.includes("doesnotexisterror");

  const detail = html
    ? "ERP returned HTML instead of PDF"
    : contentType.includes("json")
      ? `ERP JSON: ${preview.slice(0, 180)}`
      : `Unexpected content-type: ${contentType || "(none)"}`;

  if (upstreamStatus === 401 || loginPage) {
    return {
      success: false,
      status: 401,
      message: erpMessage || "Your ERP session has expired.",
      detail: "ERP returned HTML instead of PDF",
      erpStatus: upstreamStatus,
      contentType,
    };
  }

  // Prefer 404 over 403 when the direct file lookup clearly missed.
  if (notFound && !loginPage) {
    return {
      success: false,
      status: 404,
      message: erpMessage || "Document not found.",
      detail,
      erpStatus: upstreamStatus,
      contentType,
    };
  }

  if (permissionDenied) {
    return {
      success: false,
      status: 403,
      message: erpMessage || "You do not have permission to view this document.",
      detail,
      erpStatus: upstreamStatus,
      contentType,
    };
  }

  if (upstreamStatus >= 500 || upstreamStatus === 0) {
    return {
      success: false,
      status: 500,
      message: erpMessage || "Unable to retrieve the PDF from ERP.",
      detail: `ERP status ${upstreamStatus || "network"}`,
      erpStatus: upstreamStatus,
      contentType,
    };
  }

  if (html) {
    return {
      success: false,
      status: upstreamStatus >= 400 ? upstreamStatus : 502,
      message: erpMessage || "ERP returned HTML instead of PDF",
      detail,
      erpStatus: upstreamStatus,
      contentType,
    };
  }

  return {
    success: false,
    status: upstreamStatus >= 400 ? upstreamStatus : 502,
    message: erpMessage || "Unable to retrieve the PDF from ERP.",
    detail,
    erpStatus: upstreamStatus,
    contentType,
  };
}

function buildUpstreamHeaders(opts: {
  apiKey?: string;
  apiSecret?: string;
  cookie?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept:
      "application/pdf,image/*,application/zip,application/octet-stream;q=0.9,*/*;q=0.1",
  };
  if (opts.apiKey && opts.apiSecret) {
    headers.Authorization = `token ${opts.apiKey}:${opts.apiSecret}`;
  }
  if (opts.cookie && /\bsid=/.test(opts.cookie)) {
    headers.Cookie = opts.cookie;
  }
  return headers;
}

async function fetchOnce(
  url: string,
  headers: Record<string, string>,
  method: string,
): Promise<{ status: number; headers: Headers; buffer: Buffer }> {
  const upstream = await fetch(url, {
    method,
    headers,
    redirect: "follow",
  });
  const buffer = Buffer.from(await upstream.arrayBuffer());
  return { status: upstream.status, headers: upstream.headers, buffer };
}

class FileProxyLookupError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FileProxyLookupError";
    this.status = status;
  }
}

export async function resolveExactErpFileRecord(
  base: string,
  filePath: string,
  headers: Record<string, string>,
  fileId?: string,
): Promise<FileProxyFileRecord> {
  try {
    // If explicit persistent fileId is provided, resolve directly by primary key
    if (
      fileId &&
      typeof fileId === "string" &&
      fileId.trim() &&
      !fileId.startsWith("/") &&
      !fileId.startsWith("att-") &&
      !fileId.startsWith("direct-")
    ) {
      const idUrl = `${base}/api/resource/File/${encodeURIComponent(fileId.trim())}`;
      const idRes = await fetch(idUrl, {
        headers: { ...headers, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (idRes.ok) {
        const json = (await idRes.json()) as { data?: FileProxyFileRecord };
        if (json.data?.name && json.data?.file_url) {
          return json.data;
        }
      }
    }

    const filters = encodeURIComponent(
      JSON.stringify([["file_url", "=", filePath]]),
    );
    const fields = encodeURIComponent(
      JSON.stringify([
        "name",
        "file_name",
        "file_url",
        "is_private",
        "is_folder",
        "attached_to_doctype",
        "attached_to_name",
        "attached_to_field",
      ]),
    );
    const url =
      `${base}/api/resource/File?filters=${filters}&fields=${fields}` +
      `&limit_page_length=2`;
    const res = await fetch(url, {
      headers: { ...headers, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new FileProxyLookupError(
        "Unable to verify the requested File record.",
        res.status >= 500 ? 502 : res.status,
      );
    }
    const json = (await res.json()) as {
      data?: FileProxyFileRecord[];
    };
    const rows = (Array.isArray(json.data) ? json.data : []).filter((row) =>
      canonicalErpFilePath(String(row.file_url || "")) === filePath
    );
    if (rows.length === 0) {
      throw new FileProxyLookupError("File is no longer available.", 404);
    }
    if (rows.length !== 1 || !rows[0]?.name) {
      throw new FileProxyLookupError("The requested file path is ambiguous.", 403);
    }
    return rows[0];
  } catch (err) {
    if (err instanceof FileProxyLookupError) throw err;
    console.warn("[file-proxy] File DocType lookup failed:", err);
    throw new FileProxyLookupError("Unable to verify the requested File record.", 502);
  }
}

/**
 * Fetch a private/public ERPNext file (PDF, image, ZIP, CAD, …).
 * Tries direct `/files` or `/private/files`, then download_file RPC.
 * Rejects HTML/login pages. Returns the real Content-Type for the browser.
 */
export async function fetchErpFile(opts: {
  baseUrl: string;
  filePath: string;
  fileId?: string;
  apiKey?: string;
  apiSecret?: string;
  cookie?: string;
  method?: "GET" | "HEAD";
  authorizeFile: (file: FileProxyFileRecord) => Promise<void>;
}): Promise<FileProxySuccess | FileProxyFailure> {
  const base = opts.baseUrl.replace(/\/+$/, "").replace(/\/api$/, "");
  const rawPath = normalizeFilePath(opts.filePath);
  const headers = buildUpstreamHeaders(opts);
  const method = opts.method || "GET";
  if (!rawPath) {
    return {
      ok: false,
      status: 400,
      targetUrl: "",
      body: {
        success: false,
        status: 400,
        message: "Invalid file path.",
      },
    };
  }
  const httpPath = encodeFilePathForHttp(rawPath);
  const isPrivate = rawPath.startsWith("/private/files/");

  const directUrl = `${base}${httpPath}`;
  let targetUrl = directUrl;

  console.info("[file-proxy] incoming", {
    filePath: rawPath,
    fileId: opts.fileId,
    isPrivate,
    isPublicFiles: rawPath.startsWith("/files/"),
    hasApiKey: Boolean(opts.apiKey && opts.apiSecret),
    hasSidCookie: Boolean(opts.cookie && /\bsid=/.test(opts.cookie)),
    method,
  });

  let file: FileProxyFileRecord;
  try {
    file = await resolveExactErpFileRecord(base, rawPath, headers, opts.fileId);
    await opts.authorizeFile(file);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err
      ? Number((err as { status?: number }).status) || 403
      : 403;
    const safeStatus = status >= 400 && status < 600 ? status : 403;
    return {
      ok: false,
      status: safeStatus,
      targetUrl,
      body: {
        success: false,
        status: safeStatus,
        message: safeStatus === 404
          ? "Document not found."
          : safeStatus >= 500
            ? "Unable to verify the requested file."
            : "You do not have permission to view this document.",
        detail: err instanceof Error ? err.message : "File authorization failed.",
      },
    };
  }

  try {
    let result = await fetchOnce(directUrl, headers, method);
    let contentType = contentTypeOf(result.headers);
    let preview = previewText(result.buffer, 300);

    console.info("[file-proxy] ERP direct response", {
      incomingPath: rawPath,
      erpRequestUrl: directUrl,
      erpStatus: result.status,
      contentType,
      bytes: result.buffer.byteLength,
      bodyPreview: isPdfBuffer(result.buffer)
        ? "%PDF…"
        : isPngBuffer(result.buffer) || isJpegBuffer(result.buffer)
          ? "(image bytes)"
          : preview.slice(0, 300),
    });

    let ok = isBinaryFileSuccess(
      result.status,
      result.buffer,
      contentType,
      method,
    );

    if (!ok) {
      const downloadUrl =
        `${base}/api/method/frappe.utils.file_manager.download_file` +
        `?file_url=${encodeURIComponent(rawPath)}`;
      targetUrl = downloadUrl;
      const fallback = await fetchOnce(downloadUrl, headers, method);
      contentType = contentTypeOf(fallback.headers);
      preview = previewText(fallback.buffer, 300);

      console.info("[file-proxy] ERP download_file response", {
        incomingPath: rawPath,
        erpRequestUrl: downloadUrl,
        erpStatus: fallback.status,
        contentType,
        bytes: fallback.buffer.byteLength,
        bodyPreview: isPdfBuffer(fallback.buffer)
          ? "%PDF…"
          : isPngBuffer(fallback.buffer) || isJpegBuffer(fallback.buffer)
            ? "(image bytes)"
            : preview.slice(0, 300),
      });

      if (
        isBinaryFileSuccess(
          fallback.status,
          fallback.buffer,
          contentType,
          method,
        )
      ) {
        result = fallback;
        ok = true;
      } else {
        // Prefer the direct 404 when the file path itself is missing.
        const classifyFrom =
          result.status === 404
            ? result
            : looksLikeHtml(contentType, preview) || fallback.status >= 400
              ? fallback
              : result;
        const classifyType = contentTypeOf(classifyFrom.headers);
        const classifyPreview = previewText(classifyFrom.buffer, 300);
        const body = classifyNonPdfResponse(
          classifyFrom.status,
          classifyType,
          classifyPreview,
        );
        return {
          ok: false,
          status: body.status,
          body: { ...body, file: { ...file, exists: true } },
          targetUrl,
        };
      }
    }

    const resolvedType = resolveFileContentType(
      result.buffer,
      contentTypeOf(result.headers),
      rawPath,
    );

    if (method === "HEAD") {
      if (result.status === 200 || ok) {
        return {
          ok: true,
          status: result.status,
          buffer: Buffer.alloc(0),
          contentType: resolvedType || contentTypeFromFilePath(rawPath) || "application/octet-stream",
          targetUrl,
        };
      }
    }

    return {
      ok: true,
      status: 200,
      buffer: result.buffer,
      contentType: resolvedType,
      targetUrl,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "File proxy request failed.";
    console.error("[file-proxy] upstream error:", targetUrl, message);
    return {
      ok: false,
      status: 500,
      targetUrl,
      body: {
        success: false,
        status: 500,
        message: "Unable to retrieve the file from ERP.",
        detail: message,
        erpStatus: 500,
      },
    };
  }
}

/** @deprecated Prefer {@link fetchErpFile} — kept for PDF-only call sites. */
export async function fetchErpPdf(opts: {
  baseUrl: string;
  filePath: string;
  apiKey?: string;
  apiSecret?: string;
  cookie?: string;
  method?: "GET" | "HEAD";
  authorizeFile: (file: FileProxyFileRecord) => Promise<void>;
}): Promise<FileProxySuccess | FileProxyFailure> {
  const result = await fetchErpFile(opts);
  if (!result.ok) return result;
  if (
    result.contentType === "application/pdf" ||
    isPdfBuffer(result.buffer) ||
    opts.method === "HEAD"
  ) {
    return { ...result, contentType: "application/pdf" };
  }
  // Non-PDF success from fetchErpFile — still return bytes with real type
  // so /api/file-proxy can serve images/CAD/ZIP for engineering previews.
  return result;
}

export function isValidErpFilePath(filePath: string): boolean {
  return canonicalErpFilePath(filePath) !== null;
}
