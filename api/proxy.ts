import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import {
  enforcePayablesMutationRbac,
  RbacError,
  requireAnyAuth,
} from "./rbacAuth.js";

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

  // Convert ISO-8601 date/datetime strings before they reach MariaDB
  // (OperationalError 1292). Applies to every mutating ERP proxy write.
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      return JSON.stringify(sanitizeErpPayloadDates(parsed));
    } catch {
      return req.body;
    }
  }
  if (req.body !== undefined && req.body !== null) {
    return JSON.stringify(sanitizeErpPayloadDates(req.body));
  }
  return undefined;
}

function responseHeaders(upstream: Response): Record<string, string> {
  const out: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    // Never forward ERPNext session cookies to the SPA browser. Cookies are
    // host-scoped (not port-scoped), so a Set-Cookie for `sid` on the app
    // origin would overwrite ERP Desk's session on the same host.
    if (lower === "set-cookie") return;
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

  // Browser session login/logout must never go through this proxy — Frappe
  // would Set-Cookie `sid` and collide with ERP Desk on the same host.
  // Use /api/auth/login and /api/auth/logout instead.
  if (apiPath === "method/login" || apiPath === "method/logout") {
    res.status(410).json({
      error:
        "Browser session login is disabled. Use /api/auth/login instead.",
    });
    return;
  }

  // RBAC: mutating ERP proxy calls require a BidSphere access token.
  // GET/HEAD may proceed without one so pre-login pages (e.g. supplier
  // company picker) still work; custom APIs enforce stricter role checks.
  const method = (req.method ?? "GET").toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (isMutation) {
    try {
      const principal = requireAnyAuth(
        req.headers as Record<string, unknown>,
        typeof req.body === "object" && req.body
          ? (req.body as Record<string, unknown>)
          : undefined,
        req.query as Record<string, unknown>,
      );
      // Finance payables: invoice / payment / voucher mutations are role-gated.
      enforcePayablesMutationRbac(principal, apiPath, method, req.body);
    } catch (err) {
      if (err instanceof RbacError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(401).json({ error: "Not authenticated." });
      return;
    }
  } else {
    // Prefer validating token when present (rejects expired/forged tokens)
    const headerToken =
      (req.headers["x-bidsphere-access-token"] as string | undefined) ||
      (req.headers["X-Bidsphere-Access-Token"] as string | undefined);
    if (headerToken) {
      try {
        requireAnyAuth(req.headers as Record<string, unknown>);
      } catch (err) {
        if (err instanceof RbacError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
      }
    }
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

  const body = serializeBody(req, method);

  if (
    method === "POST" &&
    (apiPath === "resource/Budget" || apiPath.startsWith("resource/Budget/"))
  ) {
    let parsedBody: unknown = req.body;
    if (typeof parsedBody === "string") {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        /* keep raw string */
      }
    }
    console.log("[erpnext-proxy] Budget POST body → ERPNext:", JSON.stringify(parsedBody));
  }

  // Structured resource-list diagnostics (DocType / fields / filters).
  const resourceMatch = /^resource\/([^/?]+)/.exec(apiPath);
  if (resourceMatch && method === "GET") {
    const doctype = decodeURIComponent(resourceMatch[1].replace(/\+/g, " "));
    const q = req.query as Record<string, string | string[] | undefined>;
    const rawFields = q.fields;
    const rawFilters = q.filters;
    let fields: unknown = rawFields;
    let filters: unknown = rawFilters;
    try {
      if (typeof rawFields === "string") fields = JSON.parse(rawFields);
    } catch {
      /* keep raw */
    }
    try {
      if (typeof rawFilters === "string") filters = JSON.parse(rawFilters);
    } catch {
      /* keep raw */
    }
    console.log("[erpnext-proxy] ERP list query", {
      doctype,
      fields,
      filters,
      order_by: q.order_by ?? null,
      path: apiPath,
    });
  }

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
      const errText = JSON.stringify(data);
      if (
        !upstream.ok &&
        /Field not permitted in query/i.test(errText)
      ) {
        console.error("[erpnext-proxy] INVALID FIELD in ERP query", {
          status: upstream.status,
          path: apiPath,
          targetUrl,
          response: data,
        });
      } else if (resourceMatch && method === "GET") {
        const rows = (data as { data?: unknown })?.data;
        console.log("[erpnext-proxy] ERP response", {
          doctype: decodeURIComponent(resourceMatch[1].replace(/\+/g, " ")),
          status: upstream.status,
          count: Array.isArray(rows) ? rows.length : rows ? 1 : 0,
        });
      }
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
