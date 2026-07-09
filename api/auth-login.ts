import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  AuthSessionError,
  authenticateWithPassword,
  logoutLocalOnly,
} from "./authSession.js";

/**
 * POST /api/auth/login  — validate credentials server-side (no Set-Cookie).
 * POST /api/auth/logout — clear SPA session only (never touches ERP Desk).
 *
 * Routed via vercel.json rewrite from `/api/auth/(.*)`.
 *
 * IMPORTANT (Vercel):
 * - Import sibling modules with the `.js` extension (package is `"type":"module"`).
 * - Never call `res.removeHeader(...)` here — on some Vercel Node runtimes it
 *   throws after a successful ERP login and surfaces as a bare HTTP 500.
 *   This handler never sets cookies; stripping is unnecessary.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const action = normalizeAction(req.query.action);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    if (action === "logout") {
      res.status(200).json(logoutLocalOnly());
      return;
    }

    if (action === "login") {
      const body = parseBody(req.body);
      const result = await authenticateWithPassword(body);
      res.status(200).json(result);
      return;
    }

    res.status(404).json({
      error: `Unknown auth action: ${action || "(empty)"}`,
    });
  } catch (err) {
    const isAuthErr =
      err instanceof AuthSessionError ||
      (err instanceof Error && err.name === "AuthSessionError");

    if (isAuthErr) {
      const authErr = err as AuthSessionError;
      const status =
        Number.isInteger(authErr.status) &&
        authErr.status >= 400 &&
        authErr.status < 600
          ? authErr.status
          : 401;
      res.status(status).json({
        message: authErr.message,
        ...(authErr.payload ?? {}),
      });
      return;
    }

    const message =
      err instanceof Error ? err.message : "Authentication failed.";
    console.error("[auth-login] unhandled:", message, err);
    res.status(500).json({ error: message });
  }
}

function normalizeAction(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return String(raw[0] ?? "").trim();
  if (typeof raw === "string") return raw.trim();
  return "";
}

function parseBody(raw: unknown): { usr?: string; pwd?: string } {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object"
        ? (parsed as { usr?: string; pwd?: string })
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") {
    return raw as { usr?: string; pwd?: string };
  }
  return {};
}
