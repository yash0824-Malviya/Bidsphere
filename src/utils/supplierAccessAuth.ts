/**
 * Supplier Portal JWT resolution for voucher/invoice APIs.
 *
 * Voucher list/detail previously fell back to unauthenticated ERP reads when
 * the supplier JWT was missing, which made the portal look "logged in" while
 * Create Invoice (JWT-required) failed. This module keeps one auth strategy
 * for view + create.
 */

import {
  readSupplierAccessToken,
  writeSupplierAccessToken,
  clearSupplierAccessToken,
} from "./accessToken";
import {
  clearSupplierSession,
  readSupplierSession,
} from "../hooks/useSupplierSession";
import { portalIssueAccessToken } from "../api/supplierOnboarding";

function decodeJwtPayload(bodyB64Url: string): { typ?: string } | null {
  try {
    const padded = bodyB64Url
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(bodyB64Url.length / 4) * 4, "=");
    const json = atob(padded);
    return JSON.parse(json) as { typ?: string };
  } catch {
    return null;
  }
}

/** Peek JWT payload typ without verifying the signature (client-side only). */
export function peekAccessTokenTyp(
  token: string | null | undefined,
): "supplier" | "internal" | null {
  const raw = String(token || "").trim();
  if (!raw) return null;
  const body = raw.split(".")[0];
  if (!body) return null;
  const json = decodeJwtPayload(body);
  if (json?.typ === "supplier" || json?.typ === "internal") return json.typ;
  return null;
}

/** Supplier JWT only — never return an internal Finance/Admin token. */
export function readValidSupplierAccessToken(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  const dedicated = sessionStorage.getItem("bidsphere-supplier-access-token");
  if (dedicated && peekAccessTokenTyp(dedicated) === "supplier") {
    return dedicated;
  }
  const token = readSupplierAccessToken();
  if (token && peekAccessTokenTyp(token) === "supplier") return token;
  return null;
}

export type EnsureSupplierTokenResult =
  | { ok: true; token: string }
  | {
      ok: false;
      reason: "no_session" | "needs_relogin" | "mint_failed";
      message: string;
    };

/**
 * Ensure a supplier JWT exists for the current portal session.
 * - Account sessions: exchange validated session_token for a JWT.
 * - PIN sessions: JWT must already exist from legacy-pin-token at login.
 */
export async function ensureSupplierAccessToken(): Promise<EnsureSupplierTokenResult> {
  const existing = readValidSupplierAccessToken();
  if (existing) return { ok: true, token: existing };

  const session = readSupplierSession();
  if (!session?.loggedIn) {
    return {
      ok: false,
      reason: "no_session",
      message:
        "Not authenticated. Please sign in again to the Supplier Portal.",
    };
  }

  const sessionToken = String(session.sessionToken || "").trim();
  if (sessionToken) {
    try {
      const issued = await portalIssueAccessToken(sessionToken);
      if (!issued.access_token) {
        throw new Error("No access token returned.");
      }
      if (peekAccessTokenTyp(issued.access_token) !== "supplier") {
        throw new Error("Server did not issue a supplier access token.");
      }
      writeSupplierAccessToken(issued.access_token);
      return { ok: true, token: issued.access_token };
    } catch (err) {
      return {
        ok: false,
        reason: "mint_failed",
        message:
          err instanceof Error
            ? err.message
            : "Not authenticated. Please sign in again to the Supplier Portal.",
      };
    }
  }

  // PIN (or legacy) session without a JWT cannot be recovered without re-login.
  return {
    ok: false,
    reason: "needs_relogin",
    message:
      "Not authenticated. Please sign in again to the Supplier Portal, then retry Create Invoice.",
  };
}

/** Force a clean re-login when the portal session cannot produce a supplier JWT. */
export function forceSupplierRelogin(): void {
  clearSupplierAccessToken();
  clearSupplierSession();
}
