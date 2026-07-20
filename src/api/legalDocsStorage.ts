import type { AxiosError } from "axios";
import { apiPost } from "./erpnext";
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

export const uploadFileToERPNext = async (
  file: File,
  docType: string,
  docName: string,
  options?: UploadFileOptions,
): Promise<string> => {
  const fileName = options?.fileName || file.name;
  const isPrivate = options?.isPrivate !== false;
  const formData = new FormData();
  formData.append("file", file, fileName);
  formData.append("is_private", isPrivate ? "1" : "0");
  // Frappe upload_file accepts doctype/docname (aliases for attached_to_*).
  formData.append("doctype", docType);
  formData.append("docname", docName);
  formData.append("attached_to_doctype", docType);
  formData.append("attached_to_name", docName);
  if (options?.folder) formData.append("folder", options.folder);
  if (options?.fieldname) formData.append("fieldname", options.fieldname);

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
    fieldname: options?.fieldname || "(none)",
    folder: options?.folder || "(default)",
    mimeType: file.type || "(empty)",
    size: file.size,
    note: "Content-Type must be multipart with boundary (stripped by erpnext interceptor)",
  });

  try {
    // Shared client: proxy injects Authorization. FormData Content-Type is
    // cleared in the erpnext request interceptor so the boundary is set.
    const msg = await apiPost<{ file_url?: string; name?: string }>(
      "/api/method/upload_file",
      formData,
    );
    const fileUrl = msg?.file_url;

    // eslint-disable-next-line no-console
    console.log("[UPLOAD:response]", {
      httpStatus: 200,
      doctype: docType,
      docname: docName,
      filename: fileName,
      file_url: fileUrl,
      is_private: isPrivate ? "1" : "0",
      attached_to_doctype: docType,
      attached_to_name: docName,
      fullErpNextBody: msg,
    });

    if (!fileUrl) throw new Error("Upload succeeded but no file_url returned");
    return fileUrl;
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
      is_private: isPrivate ? "1" : "0",
      attached_to_doctype: docType,
      attached_to_name: docName,
      fullErpNextResponse: data,
      frappeException: data?.exception ?? data?.exc_type,
      serverMessages: data?._server_messages,
      traceback: data?.exc,
      axiosMessage: ax.message,
    });
    throw err;
  }
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
