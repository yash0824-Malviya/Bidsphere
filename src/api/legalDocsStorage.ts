import axios from "axios";

export const uploadFileToERPNext = async (
  file: File,
  docType: string,
  docName: string
): Promise<string> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("is_private", "1");
  formData.append("doctype", docType);
  formData.append("docname", docName);

  // Token auth only — never attach Desk's csrf_token cookie (shared host).
  const response = await axios.post("/api/method/upload_file", formData, {
    withCredentials: false,
    headers: {
      Authorization: `token ${import.meta.env.VITE_API_KEY}:${import.meta.env.VITE_API_SECRET}`,
      "Content-Type": "multipart/form-data",
    },
  });

  const fileUrl = response?.data?.message?.file_url;
  if (!fileUrl) throw new Error("Upload succeeded but no file_url returned");
  return fileUrl;
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
  if (!/^\/?(private\/)?files\//.test(path)) return relativeUrl;

  if (!path.startsWith("/")) path = `/${path}`;
  return `/api/file-proxy?path=${encodeURIComponent(path)}`;
};
