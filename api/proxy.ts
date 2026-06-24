import type { VercelRequest, VercelResponse } from "@vercel/node";

console.log("[erpnext-proxy] module loaded");

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "content-encoding",
  "content-security-policy",
  "x-frame-options",
]);

function readErpnextBaseUrl(): string {
  const raw =
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL;

  if (!raw?.trim()) {
    throw new Error(
      "Missing ERPNEXT_URL. Set it in Vercel → Project → Settings → Environment Variables."
    );
  }

  return raw.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

function readApiCredentials(): { key: string; secret: string } | null {
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!key || !secret) return null;
  return { key, secret };
}

/**
 * The ERPNext path comes from the `path` query param injected by the
 * vercel.json rewrite (`/api/(.*)` → `/api/proxy?path=$1`).
 */
function apiPathFromQuery(query: VercelRequest["query"]): string {
  const segments = query.path;
  if (Array.isArray(segments)) return segments.map(String).join("/");
  if (typeof segments === "string" && segments.length > 0) return segments;
  return "";
}

/**
 * Re-create the upstream query string from every param EXCEPT `path`
 * (which is the routing param, not part of the real ERPNext request).
 */
function buildSearch(query: VercelRequest["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "path") continue;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else if (value !== undefined) {
      params.append(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}

function buildTargetUrl(query: VercelRequest["query"], apiPath: string): string {
  const base = readErpnextBaseUrl();
  return `${base}/api/${apiPath}${buildSearch(query)}`;
}

function upstreamHeaders(req: VercelRequest): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const contentType = req.headers["content-type"];
  if (typeof contentType === "string") {
    headers["Content-Type"] = contentType;
  } else if (req.method !== "GET" && req.method !== "HEAD") {
    headers["Content-Type"] = "application/json";
  }

  const creds = readApiCredentials();
  if (creds) {
    headers.Authorization = `token ${creds.key}:${creds.secret}`;
  }

  return headers;
}

function serializeBody(req: VercelRequest, method: string): string | undefined {
  if (method === "GET" || method === "HEAD") return undefined;

  if (typeof req.body === "string") return req.body;
  if (req.body !== undefined && req.body !== null) {
    return JSON.stringify(req.body);
  }
  return undefined;
}

function responseHeaders(upstream: Response): Record<string, string> {
  const out: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    out[key] = value;
  });
  return out;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const apiPath = apiPathFromQuery(req.query);

  // ── TEMPORARY DIAGNOSTICS (remove once deployment is confirmed) ──────────
  // Proves the function is invoked and shows the route Vercel funneled in.
  console.log(`[erpnext-proxy] invoked: ${req.method ?? "GET"} /api/${apiPath}`);

  // Health check that does NOT touch ERPNext — confirms routing reaches this
  // function. GET /api/method/ping → {message:"pong"}
  if (apiPath === "method/ping") {
    res.status(200).json({ message: "pong" });
    return;
  }

  let targetUrl: string;
  try {
    if (!apiPath) {
      res.status(400).json({ error: "Missing ERPNext API path." });
      return;
    }
    targetUrl = buildTargetUrl(req.query, apiPath);
    // TEMPORARY: shows the resolved ERPNEXT_URL + full upstream target.
    console.log(`[erpnext-proxy] forwarding to: ${targetUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy misconfigured.";
    console.error("[erpnext-proxy] config:", message);
    res.status(500).json({ error: message });
    return;
  }

  const method = (req.method ?? "GET").toUpperCase();
  const body = serializeBody(req, method);

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders(req),
      body,
    });

    const headers = responseHeaders(upstream);

    // TEMPORARY: the EXACT set of header names forwarded to the browser.
    // `content-encoding` and `content-length` must NOT appear here.
    console.log("[DOWNSTREAM HEADERS]", Object.keys(headers));

    // Apply ONLY the filtered headers. Nothing below re-adds content-encoding;
    // res.json()/res.send() set a fresh, correct content-length themselves.
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }

    // `fetch` has already decompressed the body. For JSON, re-send a parsed
    // object; otherwise forward the (already-decompressed) raw bytes.
    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await upstream.json();
      console.log(
        "[JSON RESPONSE]",
        upstream.status,
        upstream.headers.get("content-encoding")
      );
      res.status(upstream.status).json(data);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    console.log(
      "[BUFFER RESPONSE]",
      upstream.status,
      buffer.length,
      upstream.headers.get("content-encoding")
    );
    res.status(upstream.status).send(buffer);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy request failed.";
    console.error("[erpnext-proxy] upstream:", targetUrl, message);
    res.status(502).json({
      error:
        "Unable to load data at the moment. Please try again in a few seconds.",
    });
  }
}
