import type { AxiosError, AxiosResponse } from "axios";
import erpnext, { apiGet } from "./erpnext";
import {
  displayNameForAuthenticatedUser,
  resolveRoleFromUser,
  type AppRole,
} from "../config/roles";
import { writeAccessToken } from "../utils/accessToken";

export interface LoginResponse {
  message?: string | { message?: string; full_name?: string };
  full_name?: string;
  home_page?: string;
  role?: AppRole;
  email?: string;
  name?: string;
  access_token?: string;
  erpnext_roles?: string[];
  exc?: string;
  exception?: string;
}

export interface AuthUserProfile {
  name: string;
  email: string;
  full_name: string;
  role: AppRole;
  department?: string;
  /** Raw ERPNext User.roles names from the last login fetch. */
  erpnext_roles?: string[];
}

interface ErpNextUserProfile {
  name?: string;
  email?: string;
  full_name?: string;
  department?: string;
  enabled?: 0 | 1;
  roles?: Array<{ role: string }>;
}

/**
 * Authenticate a user against ERPNext without touching the browser cookie jar.
 *
 * Flow:
 * 1. POST /api/auth/login (server-side password check — no Set-Cookie)
 * 2. Validate the response indicates successful login
 * 3. Trust the application role selected by the authenticated server
 * 4. Fall back to client role resolution only for legacy responses without a role
 *
 * NEVER call `/api/method/login` from the browser: Frappe sets `sid` and
 * related cookies, and browsers share cookies across ports on the same host,
 * which invalidates an open ERP Desk session.
 */
export async function loginWithPassword(
  username: string,
  password: string,
  options?: {
    requestedPortal?: string;
    previousPortal?: string | null;
  },
): Promise<AuthUserProfile> {
  const usr = username.trim();
  const pwd = password;

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[Auth] Login attempt for:", usr, {
      requestedPortal: options?.requestedPortal ?? "staff",
      previousPortal: options?.previousPortal ?? null,
    });
  }

  if (!usr || !pwd) {
    throw new Error("Please enter your username and password.");
  }

  let response: AxiosResponse<LoginResponse>;
  try {
    // Same-origin auth endpoint — credentials stay on the server; the
    // browser never receives ERPNext session cookies.
    response = (await erpnext.post(
      "/api/auth/login",
      {
        usr,
        pwd,
        requested_portal: options?.requestedPortal ?? "staff",
        previous_portal: options?.previousPortal ?? undefined,
      },
      {
        _preserveResponse: true,
        withCredentials: false,
      } as Parameters<typeof erpnext.post>[2],
    )) as AxiosResponse<LoginResponse>;
  } catch (err) {
    const axErr = err as AxiosError<LoginResponse>;
    const status = axErr.response?.status;
    const data = axErr.response?.data;

    // eslint-disable-next-line no-console
    console.error("[Auth] Login request failed:", {
      status,
      data,
      message: axErr.message,
    });

    if (status === 401) {
      const excMessage = data?.exception ?? data?.exc ?? "";
      if (
        typeof excMessage === "string" &&
        excMessage.toLowerCase().includes("disabled")
      ) {
        throw new Error(
          "This account has been disabled. Contact your administrator.",
          { cause: err },
        );
      }
      throw new Error(
        "Invalid username or password. Please check your credentials.",
        { cause: err },
      );
    }

    if (status === 404) {
      throw new Error("User not found. Please verify your username or email.", {
        cause: err,
      });
    }

    if (status === 403) {
      throw new Error(
        "Access denied. Your account may not have permission to log in.",
        { cause: err },
      );
    }

    if (!status || status >= 500) {
      // Prefer the serverless function's JSON error (misconfigured ERPNEXT_URL,
      // unreachable ERPNext from Vercel, etc.) over a generic message.
      const serverMsg =
        (typeof (data as { error?: unknown } | undefined)?.error === "string"
          ? (data as { error: string }).error
          : undefined) ||
        (typeof data?.message === "string" ? data.message : undefined);
      throw new Error(
        serverMsg ||
          "ERPNext is temporarily unavailable. Please try again in a few moments.",
        { cause: err },
      );
    }

    throw new Error(
      typeof data?.message === "string"
        ? data.message
        : "Login failed. Please try again.",
      { cause: err },
    );
  }

  const payload = response.data;

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[Auth] ERPNext login response:", {
      status: response.status,
      message: payload?.message,
      full_name: payload?.full_name,
    });
  }

  if (payload?.exc || payload?.exception) {
    const excText = payload.exception ?? payload.exc ?? "";
    // eslint-disable-next-line no-console
    console.error("[Auth] ERPNext exception in login:", excText);

    if (typeof excText === "string") {
      if (excText.toLowerCase().includes("disabled")) {
        throw new Error(
          "This account has been disabled. Contact your administrator.",
        );
      }
      if (excText.toLowerCase().includes("not found")) {
        throw new Error(
          "User not found. Please verify your username or email.",
        );
      }
    }

    throw new Error(
      typeof excText === "string"
        ? excText.replace(/^[^:]+:\s*/, "")
        : "Invalid username or password.",
    );
  }

  const msg = payload?.message;
  if (typeof msg === "string" && msg !== "Logged In" && msg !== "No App") {
    if (msg.toLowerCase().includes("invalid")) {
      throw new Error(
        "Invalid username or password. Please check your credentials.",
      );
    }
    if (msg.toLowerCase().includes("disabled")) {
      throw new Error(
        "This account has been disabled. Contact your administrator.",
      );
    }
  }

  const erpFullName =
    payload?.full_name ||
    (typeof msg === "object" && msg?.full_name ? msg.full_name : undefined) ||
    usr;

  const email = payload?.email || (usr.includes("@") ? usr : `${usr}@erpnext`);

  let erpnextRoles = Array.isArray(payload?.erpnext_roles)
    ? payload.erpnext_roles
    : [];
  if (!payload?.role && erpnextRoles.length === 0) {
    erpnextRoles = await fetchUserRoles(usr);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[Auth] Legacy role fallback for", usr, ":", erpnextRoles);
    }
  }

  const role: AppRole = payload?.role ?? resolveRoleFromUser({
      name: payload?.name || usr,
      email,
      erpnext_roles: erpnextRoles,
    });

  const fullName = displayNameForAuthenticatedUser({
    email,
    name: payload?.name || usr,
    full_name: erpFullName,
    role,
  });

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[Auth] Login successful for:", usr, {
      fullName,
      role,
      serverRole: payload?.role,
    });
  }

  if (payload?.access_token) {
    writeAccessToken(payload.access_token, false);
  }

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[Auth] Resolved BidSphere role:", role, "for user:", usr);
  }

  return {
    name: payload?.name || usr,
    email,
    full_name: fullName,
    role,
    erpnext_roles: erpnextRoles,
  };
}

/** Keep the role paired with the signed access token stable across restore. */
export function restoreAuthenticatedUserProfile(
  user: AuthUserProfile,
): AuthUserProfile {
  return {
    ...user,
    role: user.role,
    full_name: displayNameForAuthenticatedUser(user),
  };
}

/**
 * Fetch ERPNext roles for a user.
 * Uses the User resource endpoint to get the roles child table.
 */
export async function fetchUserDepartment(
  username: string,
): Promise<string | undefined> {
  try {
    const user = await apiGet<ErpNextUserProfile>(
      `/api/resource/User/${encodeURIComponent(username)}`,
      {
        params: {
          fields: JSON.stringify(["name", "department"]),
        },
      },
    );

    return user?.department?.trim() || undefined;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[Auth] fetchUserDepartment failed:", err);
    }
    return undefined;
  }
}

async function fetchUserRoles(username: string): Promise<string[]> {
  try {
    const user = await apiGet<ErpNextUserProfile>(
      `/api/resource/User/${encodeURIComponent(username)}`,
      {
        params: {
          fields: JSON.stringify([
            "name",
            "email",
            "full_name",
            "enabled",
            "roles",
          ]),
        },
      },
    );

    if (!user) return [];

    if (user.enabled === 0) {
      throw new Error("User account is disabled");
    }

    return (user.roles ?? []).map((r) => r.role).filter(Boolean);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[Auth] fetchUserRoles failed:", err);
    return [];
  }
}

/**
 * Clear the SPA auth session only.
 *
 * Intentionally does NOT call `/api/method/logout` — that would Set-Cookie /
 * clear `sid` on the shared host and invalidate ERP Desk in the same browser.
 */
export async function logoutFromServer(): Promise<void> {
  try {
    await erpnext.post(
      "/api/auth/logout",
      {},
      {
        _preserveResponse: true,
        _silent: true,
        withCredentials: false,
      } as Parameters<typeof erpnext.post>[2],
    );
  } catch {
    /* ignore — local session is cleared regardless */
  }
}

/** Result of validating a persisted user against ERPNext. */
export type ValidateUserResult = "valid" | "invalid" | "unreachable";

/** Verify a persisted user still exists and is enabled in ERPNext. */
export async function validateUserAccount(
  username: string,
  timeoutMs = 5_000,
): Promise<ValidateUserResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const user = await apiGet<{ enabled?: 0 | 1 }>(
      `/api/resource/User/${encodeURIComponent(username)}`,
      {
        params: { fields: JSON.stringify(["name", "enabled"]) },
        signal: controller.signal,
        _silent: true,
      } as Parameters<typeof erpnext.get>[1],
    );
    return user && user.enabled !== 0 ? "valid" : "invalid";
  } catch (err) {
    if (controller.signal.aborted) return "unreachable";
    const status = (err as { response?: { status?: number } })?.response
      ?.status;
    if (status === 404 || status === 403) return "invalid";
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
