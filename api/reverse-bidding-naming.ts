import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  ensureReverseBiddingChildNaming,
  ReverseBiddingNamingError,
} from "./reverseBiddingNamingCore.js";
import { RbacError, requireInternalAuth, requireRoles } from "./rbacAuth.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      message: "Method Not Allowed. Use POST /api/reverse-bidding-naming.",
    });
    return;
  }

  try {
    const principal = requireInternalAuth(
      req.headers as Record<string, unknown>,
    );
    requireRoles(principal, ["procurement", "procurement_team", "admin"]);

    console.log("[reverse-bidding-naming] auth ok", {
      user: principal.email,
      role: principal.role,
    });

    const result = await ensureReverseBiddingChildNaming();
    res.status(200).json(result);
  } catch (err) {
    const status =
      err instanceof ReverseBiddingNamingError
        ? err.status
        : err instanceof RbacError
          ? err.status
          : 500;
    const message =
      err instanceof Error
        ? err.message
        : "Could not configure Reverse Bidding child naming.";
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
    });
  }
}
