import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Streams a private (or public) ERPNext file back to the browser with the
 * server's API-key credentials attached.
 *
 * Background: every file the platform uploads (Legal terms/warranty/
 * insurance PDFs, invoices, GRN attachments, etc.) is stored with
 * `is_private: 1`. ERPNext only serves `/private/files/*` to a request
 * carrying a valid session cookie OR an `Authorization` header — neither of
 * which the browser ever has, because this SPA authenticates purely via a
 * server-held API key/secret (see `api/proxy.ts`), not a Frappe session
 * cookie. Every direct `window.open()`/`<a href>` to
 * `${ERPNEXT_URL}/private/files/...` therefore returned a hard
 * "403 Forbidden — You don't have permission to access this file" across
 * every module (Supplier, Legal, Finance, Warehouse, Admin) — uploaded
 * documents were completely unviewable in production.
 *
 * This endpoint fetches the file server-side (where the API key IS
 * attached) and streams the bytes straight through, so `getFullFileUrl()`
 * can point the browser at `/api/file-proxy?path=<file_url>` instead of the
 * raw ERPNext host.
 */

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "content-security-policy",
  "x-frame-options",
]);

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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const rawPath = req.query.path;
  const filePath = Array.isArray(rawPath) ? rawPath[0] : rawPath;
  if (!filePath || typeof filePath !== "string") {
    res.status(400).json({ error: "Missing 'path' query parameter." });
    return;
  }
  // Only ever allow ERPNext's own file namespaces — never an open relay.
  if (!/^\/?(private\/)?files\//.test(filePath)) {
    res.status(400).json({ error: "Invalid file path." });
    return;
  }

  let base: string;
  try {
    base = readErpnextBaseUrl();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }

  const creds = readApiCredentials();
  const headers: Record<string, string> = {};
  if (creds) headers.Authorization = `token ${creds.key}:${creds.secret}`;

  const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const targetUrl = `${base}${normalizedPath}`;

  try {
    const upstream = await fetch(targetUrl, { method: req.method, headers });

    upstream.headers.forEach((value, key) => {
      if (HOP_BY_HOP.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    });
    // Encourage inline viewing (PDF/image preview) rather than forcing a
    // download prompt, regardless of what ERPNext sent.
    if (!res.getHeader("content-disposition")) {
      res.setHeader("Content-Disposition", "inline");
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "File proxy request failed.";
    console.error("[file-proxy] upstream:", targetUrl, message);
    res.status(502).json({ error: "Unable to load the file right now. Please try again." });
  }
}
