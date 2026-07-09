import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  AuthSessionError,
  authenticateWithPassword,
  logoutLocalOnly,
} from "./authSession";

/**
 * POST /api/auth/login  — validate credentials server-side (no Set-Cookie).
 * POST /api/auth/logout — clear SPA session only (never touches ERP Desk).
 *
 * Routed via vercel.json rewrite from `/api/auth/(.*)`.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const action =
    typeof req.query.action === "string"
      ? req.query.action
      : Array.isArray(req.query.action)
        ? String(req.query.action[0])
        : "";

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
      const body =
        typeof req.body === "string"
          ? (JSON.parse(req.body) as { usr?: string; pwd?: string })
          : ((req.body ?? {}) as { usr?: string; pwd?: string });

      const result = await authenticateWithPassword(body);
      // Explicitly ensure no session cookies leak to the browser.
      res.removeHeader("Set-Cookie");
      res.status(200).json(result);
      return;
    }

    res.status(404).json({ error: `Unknown auth action: ${action}` });
  } catch (err) {
    if (err instanceof AuthSessionError) {
      res.removeHeader("Set-Cookie");
      res.status(err.status).json({
        message: err.message,
        ...err.payload,
      });
      return;
    }
    const message = err instanceof Error ? err.message : "Authentication failed.";
    console.error("[auth-login]", message);
    res.status(500).json({ error: message });
  }
}
