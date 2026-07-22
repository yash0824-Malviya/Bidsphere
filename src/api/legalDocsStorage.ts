import type { AxiosError } from "axios";
import { apiGet, apiPost, buildResourceUrl, withSilent } from "./erpnext";
import { readErpProxyAccessToken } from "../utils/accessToken";

/**
 * Upload a file to ERPNext via `/api/method/upload_file`.
 *
 * CRITICAL: Do NOT set `Content-Type: multipart/form-data` manually.
 * Axios/browser must omit Content-Type so the runtime adds
 * `multipart/form-data; boundary=...`. Without the boundary, Frappe cannot
 * parse the file part and returns HTTP 417:
 *   MandatoryError: Fields `file_name` or `file_url` must be set for File
 */
export type UploadFileOptions = {
  /** Override File.name / remote path segment (may include folders, e.g. grn/signed/MAT-GRN-001.pdf). */
  fileName?: string;
  /** Frappe folder path (default Home). */
  folder?: string;
  /** When false, file is public under /files/… (default true → /private/files/). */
  isPrivate?: boolean;
  /** Optional Attach fieldname on the target document. */
  fieldname?: string;
};

/** Canonical ERPNext File metadata returned by upload_file. */
export type UploadedErpFile = {
  /** Relative ERP path, e.g. `/private/files/quote.pdf` — never a proxy URL. */
  file_url: string;
  file_name: string;
  /** File DocType name (`name` from upload_file). */
  file_id: string;
  file_size?: number;
  attached_to_doctype?: string;
  attached_to_name?: string;
  attached_to_field?: string;
  is_private?: boolean;
};

type UploadFileMessage = {
  file_url?: string;
  file_name?: string;
  name?: string;
  file_size?: number;
  attached_to_doctype?: string;
  attached_to_name?: string;
  attached_to_field?: string;
  is_private?: number | boolean;
};

/**
 * Upload a file and return full File DocType metadata.
 * Prefer this over {@link uploadFileToERPNext} when callers need file_id.
 */
export const uploadFileToERPNextDetailed = async (
  file: File,
  docType: string,
  docName: string,
  options?: UploadFileOptions,
): Promise<UploadedErpFile> => {
  const fileName = options?.fileName || file.name;
  const isPrivate = options?.isPrivate !== false;
  const fieldname = options?.fieldname || "";
  const formData = new FormData();
  formData.append("file", file, fileName);
  formData.append("is_private", isPrivate ? "1" : "0");
  // Frappe upload_file accepts doctype/docname (aliases for attached_to_*).
  formData.append("doctype", docType);
  formData.append("docname", docName);
  formData.append("attached_to_doctype", docType);
  formData.append("attached_to_name", docName);
  if (options?.folder) formData.append("folder", options.folder);
  if (fieldname) formData.append("fieldname", fieldname);

  // eslint-disable-next-line no-console
  console.log("[UPLOAD:request]", {
    url: "/api/method/upload_file",
    method: "POST",
    doctype: docType,
    docname: docName,
    filename: fileName,
    file_url: "(pending)",
    is_private: isPrivate ? "1" : "0",
    attached_to_doctype: docType,
    attached_to_name: docName,
    attached_to_field: fieldname || "(none)",
    fieldname: fieldname || "(none)",
    folder: options?.folder || "(default)",
    mimeType: file.type || "(empty)",
    size: file.size,
    note: "Content-Type must be multipart with boundary (stripped by erpnext interceptor)",
  });

  // eslint-disable-next-line no-console
  console.log("[UPLOAD:started]", {
    doctype: docType,
    docname: docName,
    filename: fileName,
    folder: options?.folder || "Home",
  });

  try {
    // Shared client: proxy injects Authorization. FormData Content-Type is
    // cleared in the erpnext request interceptor so the boundary is set.
    // Silent: callers show precise upload errors (global toast remaps 404s).
    const msg = await apiPost<UploadFileMessage>(
      "/api/method/upload_file",
      formData,
      withSilent(),
    );
    const fileUrl = String(msg?.file_url || "").trim();
    const fileId = String(msg?.name || "").trim();
    const resolvedName = String(msg?.file_name || fileName).trim() || fileName;

    // eslint-disable-next-line no-console
    console.log("[UPLOAD:response]", {
      httpStatus: 200,
      file_url: fileUrl || null,
      file_name: resolvedName,
      file_id: fileId || null,
      file_size: msg?.file_size ?? file.size,
      attached_to_doctype: msg?.attached_to_doctype || docType,
      attached_to_name: msg?.attached_to_name || docName,
      attached_to_field: msg?.attached_to_field || fieldname || null,
      is_private: msg?.is_private ?? (isPrivate ? 1 : 0),
      fullErpNextBody: msg,
    });

    if (!fileUrl) {
      throw new Error("Upload succeeded but no file_url returned");
    }
    if (!/^\/?(private\/)?files\//.test(fileUrl) && !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Upload returned an invalid file_url: ${fileUrl}`);
    }

    const saved: UploadedErpFile = {
      file_url: fileUrl.startsWith("/") || /^https?:\/\//i.test(fileUrl)
        ? fileUrl
        : `/${fileUrl}`,
      file_name: resolvedName,
      file_id: fileId || fileUrl,
      file_size:
        typeof msg?.file_size === "number" && msg.file_size > 0
          ? msg.file_size
          : file.size,
      attached_to_doctype: msg?.attached_to_doctype || docType,
      attached_to_name: msg?.attached_to_name || docName,
      attached_to_field: msg?.attached_to_field || fieldname || undefined,
      is_private: isPrivate,
    };

    // eslint-disable-next-line no-console
    console.log("[UPLOAD:file-saved]", {
      file_url: saved.file_url,
      file_id: saved.file_id,
      file_name: saved.file_name,
    });
    // eslint-disable-next-line no-console
    console.log("[UPLOAD:attachment-linked]", {
      attached_to_doctype: saved.attached_to_doctype,
      attached_to_name: saved.attached_to_name,
      attached_to_field: saved.attached_to_field ?? null,
    });

    return saved;
  } catch (err) {
    const ax = err as AxiosError<Record<string, unknown>>;
    const data = ax.response?.data;
    // eslint-disable-next-line no-console
    console.error("[UPLOAD:response]", {
      httpStatus: ax.response?.status,
      doctype: docType,
      docname: docName,
      filename: fileName,
      file_url: null,
      file_name: null,
      file_id: null,
      is_private: isPrivate ? "1" : "0",
      attached_to_doctype: docType,
      attached_to_name: docName,
      attached_to_field: fieldname || null,
      fullErpNextResponse: data,
      frappeException: data?.exception ?? data?.exc_type,
      serverMessages: data?._server_messages,
      traceback: data?.exc,
      axiosMessage: ax.message,
    });
    throw err;
  }
};

export const uploadFileToERPNext = async (
  file: File,
  docType: string,
  docName: string,
  options?: UploadFileOptions,
): Promise<string> => {
  const uploaded = await uploadFileToERPNextDetailed(
    file,
    docType,
    docName,
    options,
  );
  return uploaded.file_url;
};

/**
 * Resolve an ERPNext `file_url` (e.g. `/private/files/quote.pdf`) into a
 * browser-loadable URL.
 *
 * ERPNext serves `/private/files/*` ONLY to requests carrying a valid
 * session cookie or Authorization header — the browser has neither (this
 * app authenticates via a server-held API key, never a Frappe session
 * cookie), so linking directly to `${ERPNEXT_URL}${relativeUrl}` always
 * returned a hard 403 "You don't have permission to access this file" in
 * every module. Route through `/api/file-proxy`, which attaches the API
 * key server-side and streams the bytes back.
 */
export const getFullFileUrl = (relativeUrl: string): string => {
  if (!relativeUrl) return "";

  let path = relativeUrl;
  if (/^https?:\/\//i.test(relativeUrl)) {
    try {
      path = new URL(relativeUrl).pathname;
    } catch {
      return relativeUrl; // unparsable — return as-is rather than break the link
    }
  }

  // Only ERPNext's own file namespaces need proxying; anything else
  // (external URLs unrelated to ERPNext file storage) passes through as-is.
  if (!/^\/?(private\/)?files\//.test(path)) {
    console.info("[LegalPdf] getFullFileUrl passthrough (non-ERP file path)", {
      relativeUrl,
      path,
    });
    return relativeUrl;
  }

  if (!path.startsWith("/")) path = `/${path}`;
  let url = `/api/file-proxy?path=${encodeURIComponent(path)}`;
  try {
    // Supplier Portal uses a dedicated JWT key; staff uses the shared key.
    // Prefer whichever is available so engineering / legal previews work in both apps.
    const token = readErpProxyAccessToken();
    if (token) {
      url += `&access_token=${encodeURIComponent(token)}`;
    } else {
      console.warn(
        "[LegalPdf] getFullFileUrl: no BidSphere access_token in storage; production file-proxy will return 401",
      );
    }
  } catch {
    /* ignore */
  }
  console.info("[LegalPdf] getFullFileUrl resolved", {
    relativeUrl,
    path,
    isPrivate: path.startsWith("/private/files/"),
    isPublic: path.startsWith("/files/"),
    proxyUrl: url.replace(/access_token=[^&]+/, "access_token=***"),
  });
  return url;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Confirm the File DocType exists and bytes are readable via file-proxy.
 * Retries briefly to absorb ERPNext commit / filesystem lag after upload_file.
 */
export async function confirmUploadedErpFile(
  uploaded: UploadedErpFile,
  opts?: { attempts?: number; delayMs?: number },
): Promise<UploadedErpFile> {
  const attempts = opts?.attempts ?? 10;
  const delayMs = opts?.delayMs ?? 300;
  const fileUrl = String(uploaded.file_url || "").trim();
  const fileId = String(uploaded.file_id || "").trim();

  if (!fileUrl) {
    throw new Error("Upload response missing file_url.");
  }

  // 1) Confirm File DocType row when we have an id.
  if (fileId && !fileId.startsWith("/") && !fileId.startsWith("data:")) {
    try {
      // eslint-disable-next-line no-console
      console.log("[UPLOAD:document-created] verifying File DocType", {
        file_id: fileId,
      });
      const doc = await apiGet<{
        name?: string;
        file_url?: string;
        file_name?: string;
        file_size?: number;
        attached_to_doctype?: string;
        attached_to_name?: string;
        attached_to_field?: string;
      }>(buildResourceUrl("File", fileId), withSilent());

      // eslint-disable-next-line no-console
      console.log("[UPLOAD:document-created]", {
        file_id: doc?.name || fileId,
        file_url: doc?.file_url || fileUrl,
        attached_to_doctype: doc?.attached_to_doctype || uploaded.attached_to_doctype,
        attached_to_name: doc?.attached_to_name || uploaded.attached_to_name,
        attached_to_field:
          doc?.attached_to_field || uploaded.attached_to_field || null,
      });

      if (doc?.file_url) {
        uploaded = {
          ...uploaded,
          file_url: String(doc.file_url).trim() || uploaded.file_url,
          file_name: String(doc.file_name || uploaded.file_name).trim(),
          file_size:
            typeof doc.file_size === "number" && doc.file_size > 0
              ? doc.file_size
              : uploaded.file_size,
          attached_to_doctype:
            doc.attached_to_doctype || uploaded.attached_to_doctype,
          attached_to_name: doc.attached_to_name || uploaded.attached_to_name,
          attached_to_field:
            doc.attached_to_field || uploaded.attached_to_field,
        };
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[UPLOAD:document-created] File DocType not readable yet; continuing with proxy verify",
        err,
      );
    }
  }

  // 2) Confirm bytes are served through file-proxy (commit timing).
  const proxyUrl = getFullFileUrl(uploaded.file_url);
  if (!proxyUrl) {
    throw new Error("Could not build a readable URL for the uploaded file.");
  }

  let lastDetail = "File not readable yet.";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // eslint-disable-next-line no-console
    console.log("[UPLOAD:verify-readable]", {
      attempt,
      attempts,
      file_url: uploaded.file_url,
      file_id: uploaded.file_id,
    });
    try {
      let res = await fetch(proxyUrl, { method: "HEAD" });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(proxyUrl, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
        });
      }
      if (res.ok || res.status === 206) {
        // eslint-disable-next-line no-console
        console.log("[UPLOAD:commit-completed]", {
          attempt,
          status: res.status,
          file_url: uploaded.file_url,
          file_id: uploaded.file_id,
        });
        return uploaded;
      }
      let bodyMsg = "";
      try {
        const body = (await res.json()) as { message?: string };
        bodyMsg = String(body?.message || "").trim();
      } catch {
        bodyMsg = "";
      }
      lastDetail = bodyMsg || `File proxy returned HTTP ${res.status}`;
      // eslint-disable-next-line no-console
      console.warn("[UPLOAD:verify-readable] not ready", {
        attempt,
        status: res.status,
        detail: lastDetail,
      });
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn("[UPLOAD:verify-readable] fetch failed", {
        attempt,
        detail: lastDetail,
      });
    }
    if (attempt < attempts) await sleep(delayMs);
  }

  throw new Error(
    `Upload saved but the file is not available for viewing yet (${lastDetail}). Please try again in a moment.`,
  );
}

/**
 * Open an ERP/private file through file-proxy as a blob (View / Download).
 * Avoids SPA-router false "document not found" pages from bare /private/files paths.
 */
export async function openErpFileInBrowser(
  relativeOrProxyUrl: string,
  opts?: { fileName?: string; mode?: "view" | "download" },
): Promise<void> {
  const mode = opts?.mode || "view";
  const raw = String(relativeOrProxyUrl || "").trim();
  if (!raw) {
    throw new Error("No file URL available to open.");
  }

  // eslint-disable-next-line no-console
  console.log(mode === "download" ? "[DOWNLOAD:request]" : "[VIEW:request]", {
    file_url: raw.startsWith("data:") ? "(data-url)" : raw,
    file_name: opts?.fileName || null,
  });

  if (raw.startsWith("data:")) {
    if (mode === "download") {
      const a = document.createElement("a");
      a.href = raw;
      a.download = opts?.fileName || "document";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    window.open(raw, "_blank", "noopener,noreferrer");
    return;
  }

  const openUrl =
    raw.includes("/api/file-proxy") || /^https?:\/\//i.test(raw)
      ? raw
      : getFullFileUrl(raw);
  if (!openUrl) {
    throw new Error("Could not resolve a readable URL for this file.");
  }

  const res = await fetch(openUrl);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; detail?: string };
      detail = String(body?.message || body?.detail || detail).trim() || detail;
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.error(mode === "download" ? "[DOWNLOAD:failed]" : "[VIEW:failed]", {
      status: res.status,
      detail,
    });
    throw new Error(
      mode === "download"
        ? `Download failed: ${detail}`
        : `View failed: ${detail}`,
    );
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  // eslint-disable-next-line no-console
  console.log(mode === "download" ? "[DOWNLOAD:ok]" : "[VIEW:ok]", {
    bytes: blob.size,
    type: blob.type || "(unknown)",
  });

  if (mode === "download") {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = opts?.fileName || "document";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(objectUrl, "_blank", "noopener,noreferrer");
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
