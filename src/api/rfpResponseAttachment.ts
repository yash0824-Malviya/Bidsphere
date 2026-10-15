import { readErpProxyAccessToken } from "../utils/accessToken";

/** Keep the response document UUID and ERPNext File ID distinct. */
export function getRfpResponseAttachmentUrl(
  rfpName: string,
  responseName: string,
  document: { document_id: string; file: { file_url: string; file_id?: string } },
): string {
  let path = document.file.file_url.trim();
  // Preserve existing embedded attachments on legacy responses.
  if (path.startsWith("data:")) return path;
  if (!rfpName.trim() || !responseName.trim() || !document.document_id.trim()) return "";
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch { return ""; }
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (!/^\/(private\/)?files\//.test(path)) return "";
  const query = new URLSearchParams({
    path,
    rfp: rfpName,
    rfp_response: responseName,
    response_document: document.document_id,
  });
  if (document.file.file_id?.trim()) query.set("file_id", document.file.file_id.trim());
  return `/api/file-proxy?${query}`;
}

export function isRfpResponseAttachmentUrl(value: string): boolean {
  try {
    const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const url = new URL(value, origin);
    return url.origin === origin && url.pathname === "/api/file-proxy" &&
      ["rfp", "rfp_response", "response_document"].every(key => url.searchParams.has(key));
  } catch { return false; }
}

function documentError(status: number): Error & { status: number } {
  const message = status === 401 ? "Your session has expired. Please sign in again."
    : status === 403 ? "You do not have permission to view this document."
    : status === 404 ? "Document not found."
    : "Unable to load the document. Please try again.";
  return Object.assign(new Error(message), { status });
}

/** Preview and download share both the persisted attachment scope and live session. */
export async function fetchRfpResponseAttachmentBlob(value: string): Promise<Blob> {
  if (!isRfpResponseAttachmentUrl(value)) throw documentError(403);
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(value, origin);
  url.searchParams.delete("access_token");
  const token = readErpProxyAccessToken();
  let response: Response;
  try {
    response = await fetch(`${url.pathname}${url.search}`, {
      credentials: "omit",
      cache: "no-store",
      headers: {
        ...(token ? { "X-Bidsphere-Access-Token": token } : {}),
        "ngrok-skip-browser-warning": "1",
      },
    });
  } catch {
    throw new Error("Unable to connect to the document service.");
  }
  // Never display upstream JSON, exception details or HTML login responses.
  if (!response.ok) throw documentError(response.status);
  if (response.headers.get("Content-Type")?.toLowerCase().includes("text/html")) throw documentError(500);
  try { return await response.blob(); }
  catch { throw new Error("Unable to connect to the document service."); }
}
