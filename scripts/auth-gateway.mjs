/**
 * Standalone auth gateway for production nginx deployments.
 *
 * When the SPA is served as static files and `/api/*` is proxied straight to
 * ERPNext, browser login must NOT hit `/api/method/login` (Set-Cookie overwrites
 * Desk `sid` on the same host). Point nginx at this process for `/api/auth/*`
 * only:
 *
 *   location /api/auth/ {
 *     proxy_pass http://127.0.0.1:8091/api/auth/;
 *   }
 *   location /api/ {
 *     proxy_pass http://ERPNEXT;
 *     proxy_set_header Cookie "";
 *     proxy_hide_header Set-Cookie;
 *     proxy_set_header Authorization "token KEY:SECRET";
 *   }
 *
 * Usage:
 *   ERPNEXT_URL=http://80.225.204.210:8090 node scripts/auth-gateway.mjs
 */
import http from "node:http";

const PORT = Number(process.env.AUTH_GATEWAY_PORT || 8091);
const ERPNEXT_URL = (
  process.env.ERPNEXT_URL ||
  process.env.VITE_PROXY_TARGET ||
  ""
)
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

if (!ERPNEXT_URL) {
  console.error("Set ERPNEXT_URL (e.g. http://127.0.0.1:8090)");
  process.exit(1);
}

async function authenticateWithPassword(body) {
  const usr = typeof body.usr === "string" ? body.usr.trim() : "";
  const pwd = typeof body.pwd === "string" ? body.pwd : "";
  if (!usr || !pwd) {
    const err = new Error("Please enter your username and password.");
    err.status = 400;
    throw err;
  }

  const upstream = await fetch(`${ERPNEXT_URL}/api/method/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ usr, pwd }),
  });

  const setCookie =
    typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : upstream.headers.get("set-cookie")
        ? [upstream.headers.get("set-cookie")]
        : [];

  let sid = null;
  for (const raw of setCookie) {
    const m = /sid=([^;]+)/i.exec(raw || "");
    if (m?.[1] && m[1] !== "Guest") {
      sid = m[1].trim();
      break;
    }
  }

  let data = {};
  try {
    data = await upstream.json();
  } catch {
    data = {};
  }

  if (sid) {
    try {
      await fetch(`${ERPNEXT_URL}/api/method/logout`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: `sid=${sid}`,
        },
        body: "{}",
      });
    } catch {
      /* ignore */
    }
  }

  if (!upstream.ok) {
    const err = new Error(
      typeof data.message === "string"
        ? data.message
        : "Invalid username or password. Please check your credentials.",
    );
    err.status =
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 401;
    err.payload = data;
    throw err;
  }

  if (data.exc || data.exception) {
    const excText = String(data.exception ?? data.exc ?? "");
    const err = new Error(
      excText.replace(/^[^:]+:\s*/, "") || "Invalid username or password.",
    );
    err.status = 401;
    err.payload = data;
    throw err;
  }

  const msg = data.message;
  return {
    message: typeof msg === "string" ? msg : "Logged In",
    full_name:
      (typeof data.full_name === "string" && data.full_name) ||
      (typeof msg === "object" && msg?.full_name) ||
      undefined,
    home_page: typeof data.home_page === "string" ? data.home_page : undefined,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  try {
    if (path === "/api/auth/logout" || path === "/auth/logout") {
      res.writeHead(200);
      res.end(JSON.stringify({ message: "Logged Out" }));
      return;
    }

    if (path === "/api/auth/login" || path === "/auth/login") {
      const body = await readBody(req);
      const result = await authenticateWithPassword(body);
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    res.writeHead(status >= 400 && status < 600 ? status : 500);
    res.end(
      JSON.stringify({
        message: err?.message || "Authentication failed.",
        ...(err?.payload || {}),
      }),
    );
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[auth-gateway] listening on :${PORT} → ERPNext ${ERPNEXT_URL} (no Set-Cookie to browser)`,
  );
});
