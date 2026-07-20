/**
 * Server-owned authentication against ERPNext.
 *
 * CRITICAL: Password checks must NEVER run in the browser against
 * `/api/method/login` with credentials included. Frappe's login response
 * sets `sid` / `system_user` / `full_name` / `user_id` / `csrf_token`
 * cookies. Browsers scope cookies by host (not port), so a login on
 * `:8084` overwrites the Desk session on `:8090` for the same IP/host.
 *
 * This module validates credentials with a server-side `fetch` and never
 * forwards `Set-Cookie` to the browser. The SPA continues to use API-key
 * token auth for all subsequent ERPNext calls, plus a signed BidSphere
 * access token for RBAC on custom APIs / the proxy.
 */

import {
  issueInternalAccessToken,
  resolveServerRole,
  type AppRole,
} from "./rbacAuth.js";

export type { AppRole };

export interface ErpAuthConfig {
  baseUrl: string;
  key: string;
  secret: string;
}

export class AuthSessionError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(
    message: string,
    status = 401,
    payload: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AuthSessionError";
    this.status = status;
    this.payload = payload;
  }
}

export function readErpAuthConfig(): ErpAuthConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

  if (!baseUrl) {
    // AuthSessionError so Vercel returns a clear JSON body (not a bare 500).
    throw new AuthSessionError(
      "Auth backend misconfigured: missing ERPNEXT_URL (set it in Vercel → Settings → Environment Variables).",
      500,
    );
  }

  return { baseUrl, key, secret };
}

interface LoginBody {
  usr?: string;
  pwd?: string;
}

function extractSid(setCookie: string[] | null): string | null {
  if (!setCookie?.length) return null;
  for (const raw of setCookie) {
    const match = /(?:^|,)\s*sid=([^;,\s]+)/i.exec(raw);
    if (match?.[1] && match[1] !== "Guest") return match[1];
  }
  // Node fetch may join multiple Set-Cookie into one header in some runtimes
  for (const raw of setCookie) {
    const match = /sid=([^;]+)/i.exec(raw);
    if (match?.[1] && match[1] !== "Guest") return match[1].trim();
  }
  return null;
}

function getSetCookieList(res: Response): string[] {
  const headers = res.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/**
 * Best-effort: destroy the temporary ERPNext session created by the
 * server-side password check so it does not linger. Never touches the
 * browser.
 */
async function discardServerSession(
  baseUrl: string,
  sid: string | null,
): Promise<void> {
  if (!sid) return;
  try {
    await fetch(`${baseUrl}/api/method/logout`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: `sid=${sid}`,
      },
      body: "{}",
    });
  } catch {
    /* ignore — session will expire on its own */
  }
}

/**
 * Validate ERPNext username/password on the server. Returns the same
 * shape the SPA historically expected from `/api/method/login`, without
 * any session cookies for the browser.
 */
export async function authenticateWithPassword(
  body: LoginBody,
): Promise<{
  message: string;
  full_name?: string;
  home_page?: string;
  role: AppRole;
  email: string;
  name: string;
  access_token: string;
}> {
  const usr = typeof body.usr === "string" ? body.usr.trim() : "";
  const pwd = typeof body.pwd === "string" ? body.pwd : "";

  if (!usr || !pwd) {
    throw new AuthSessionError("Please enter your username and password.", 400);
  }

  const { baseUrl } = readErpAuthConfig();

  const loginUrl = `${baseUrl}/api/method/login`;
  let upstream: Response;
  try {
    upstream = await fetch(loginUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      // Never reuse or forward browser cookies.
      body: JSON.stringify({ usr, pwd }),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    console.error("[authSession] ERPNext login fetch failed:", loginUrl, cause);
    throw new AuthSessionError(
      "ERPNext is temporarily unavailable. Please try again in a few moments.",
      502,
      { cause, erpnext_url: baseUrl },
    );
  }

  const setCookies = getSetCookieList(upstream);
  const sid = extractSid(setCookies);

  let data: Record<string, unknown> = {};
  try {
    data = (await upstream.json()) as Record<string, unknown>;
  } catch {
    await discardServerSession(baseUrl, sid);
    throw new AuthSessionError(
      "ERPNext returned an invalid login response.",
      502,
    );
  }

  // Always discard the temporary session created by this password check.
  // The SPA authenticates subsequent API calls with the API key token.
  await discardServerSession(baseUrl, sid);

  if (!upstream.ok) {
    throw new AuthSessionError(
      typeof data.message === "string"
        ? data.message
        : "Invalid username or password. Please check your credentials.",
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 401,
      data,
    );
  }

  if (data.exc || data.exception) {
    const excText = String(data.exception ?? data.exc ?? "");
    throw new AuthSessionError(
      excText.replace(/^[^:]+:\s*/, "") || "Invalid username or password.",
      401,
      data,
    );
  }

  const msg = data.message;
  if (typeof msg === "string" && msg !== "Logged In" && msg !== "No App") {
    if (msg.toLowerCase().includes("invalid")) {
      throw new AuthSessionError(
        "Invalid username or password. Please check your credentials.",
        401,
        data,
      );
    }
    if (msg.toLowerCase().includes("disabled")) {
      throw new AuthSessionError(
        "This account has been disabled. Contact your administrator.",
        403,
        data,
      );
    }
  }

  const fullName =
    (typeof data.full_name === "string" && data.full_name) ||
    (typeof msg === "object" &&
    msg &&
    typeof (msg as { full_name?: string }).full_name === "string"
      ? (msg as { full_name: string }).full_name
      : undefined);

  const { key, secret } = readErpAuthConfig();
  let erpnextRoles: string[] = [];
  try {
    const userUrl =
      `${baseUrl}/api/resource/User/${encodeURIComponent(usr)}` +
      `?fields=${encodeURIComponent(JSON.stringify(["name", "email", "enabled", "roles"]))}`;
    const userRes = await fetch(userUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `token ${key}:${secret}`,
      },
    });
    if (userRes.ok) {
      const userJson = (await userRes.json()) as {
        data?: { enabled?: number; roles?: Array<{ role?: string }> };
      };
      const userData = userJson.data;
      if (userData?.enabled === 0) {
        throw new AuthSessionError(
          "This account has been disabled. Contact your administrator.",
          403,
        );
      }
      erpnextRoles = (userData?.roles ?? [])
        .map((r) => String(r.role || ""))
        .filter(Boolean);
    }
  } catch (err) {
    if (err instanceof AuthSessionError) throw err;
    // Role fetch failure is non-fatal — email map still resolves known users.
  }

  const email = usr.includes("@") ? usr : `${usr}@erpnext`;
  const role = resolveServerRole({
    name: usr,
    email,
    erpnext_roles: erpnextRoles,
  });
  const access_token = issueInternalAccessToken({
    sub: usr,
    email,
    role,
  });

  return {
    message: typeof msg === "string" ? msg : "Logged In",
    full_name: fullName,
    home_page:
      typeof data.home_page === "string" ? data.home_page : undefined,
    role,
    email,
    name: usr,
    access_token,
  };
}

/** No-op logout for the SPA — never calls ERPNext logout (would risk Desk). */
export function logoutLocalOnly(): { message: string } {
  return { message: "Logged Out" };
}
