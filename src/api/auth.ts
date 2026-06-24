import type { AxiosError, AxiosResponse } from "axios";
import erpnext, { apiGet } from "./erpnext";
import { resolveRoleFromUser, type AppRole } from "../config/roles";

export interface LoginResponse {
  message?: string | { message?: string; full_name?: string };
  full_name?: string;
  home_page?: string;
  exc?: string;
  exception?: string;
}

export interface AuthUserProfile {
  name: string;
  email: string;
  full_name: string;
  role: AppRole;
}

interface ErpNextUserProfile {
  name?: string;
  email?: string;
  full_name?: string;
  enabled?: 0 | 1;
  roles?: Array<{ role: string }>;
}

/**
 * Authenticate a user against ERPNext's login API.
 *
 * Flow:
 * 1. POST /api/method/login with { usr, pwd }
 * 2. Validate the response indicates successful login
 * 3. Fetch the user's ERPNext roles from /api/resource/User
 * 4. Resolve BidSphere AppRole from ERPNext roles
 */
export async function loginWithPassword(
  username: string,
  password: string
): Promise<AuthUserProfile> {
  const usr = username.trim();
  const pwd = password;

  // eslint-disable-next-line no-console
  console.log("[Auth] Login attempt for:", usr);

  if (!usr || !pwd) {
    throw new Error("Please enter your username and password.");
  }

  let response: AxiosResponse<LoginResponse>;
  try {
    response = (await erpnext.post(
      "/api/method/login",
      { usr, pwd },
      { _preserveResponse: true } as Parameters<typeof erpnext.post>[2]
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
      if (typeof excMessage === "string" && excMessage.toLowerCase().includes("disabled")) {
        throw new Error("This account has been disabled. Contact your administrator.");
      }
      throw new Error("Invalid username or password. Please check your credentials.");
    }

    if (status === 404) {
      throw new Error("User not found. Please verify your username or email.");
    }

    if (status === 403) {
      throw new Error("Access denied. Your account may not have permission to log in.");
    }

    if (!status || status >= 500) {
      throw new Error(
        "ERPNext is temporarily unavailable. Please try again in a few moments."
      );
    }

    throw new Error(
      typeof data?.message === "string"
        ? data.message
        : "Login failed. Please try again."
    );
  }

  const payload = response.data;

  // eslint-disable-next-line no-console
  console.log("[Auth] ERPNext login response:", {
    status: response.status,
    message: payload?.message,
    full_name: payload?.full_name,
    hasExc: !!payload?.exc,
    hasException: !!payload?.exception,
  });

  if (payload?.exc || payload?.exception) {
    const excText = payload.exception ?? payload.exc ?? "";
    // eslint-disable-next-line no-console
    console.error("[Auth] ERPNext exception in login:", excText);

    if (typeof excText === "string") {
      if (excText.toLowerCase().includes("disabled")) {
        throw new Error("This account has been disabled. Contact your administrator.");
      }
      if (excText.toLowerCase().includes("not found")) {
        throw new Error("User not found. Please verify your username or email.");
      }
    }

    throw new Error(
      typeof excText === "string"
        ? excText.replace(/^[^:]+:\s*/, "")
        : "Invalid username or password."
    );
  }

  const msg = payload?.message;
  if (
    typeof msg === "string" &&
    msg !== "Logged In" &&
    msg !== "No App"
  ) {
    if (msg.toLowerCase().includes("invalid")) {
      throw new Error("Invalid username or password. Please check your credentials.");
    }
    if (msg.toLowerCase().includes("disabled")) {
      throw new Error("This account has been disabled. Contact your administrator.");
    }
  }

  const fullName =
    payload?.full_name ||
    (typeof msg === "object" && msg?.full_name ? msg.full_name : undefined) ||
    usr;

  // eslint-disable-next-line no-console
  console.log("[Auth] Login successful for:", usr, "fullName:", fullName);

  // Fetch user roles from ERPNext to support dynamic role resolution
  let erpnextRoles: string[] = [];
  try {
    erpnextRoles = await fetchUserRoles(usr);
    // eslint-disable-next-line no-console
    console.log("[Auth] ERPNext roles for", usr, ":", erpnextRoles);
  } catch (roleErr) {
    // eslint-disable-next-line no-console
    console.warn("[Auth] Could not fetch ERPNext roles, using email-based resolution:", roleErr);
  }

  const profile = {
    name: usr,
    email: usr.includes("@") ? usr : `${usr}@erpnext`,
    full_name: fullName,
    erpnext_roles: erpnextRoles,
  };

  const role = resolveRoleFromUser(profile);

  // eslint-disable-next-line no-console
  console.log("[Auth] Resolved BidSphere role:", role, "for user:", usr);

  return {
    name: profile.name,
    email: profile.email,
    full_name: profile.full_name,
    role,
  };
}

/**
 * Fetch ERPNext roles for a user.
 * Uses the User resource endpoint to get the roles child table.
 */
async function fetchUserRoles(username: string): Promise<string[]> {
  try {
    const user = await apiGet<ErpNextUserProfile>(
      `/api/resource/User/${encodeURIComponent(username)}`,
      {
        params: {
          fields: JSON.stringify(["name", "email", "full_name", "enabled", "roles"]),
        },
      }
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

/** End the ERPNext session (best-effort). */
export async function logoutFromServer(): Promise<void> {
  try {
    await erpnext.post(
      "/api/method/logout",
      {},
      { _preserveResponse: true, _silent: true } as Parameters<
        typeof erpnext.post
      >[2]
    );
  } catch {
    /* ignore — local session is cleared regardless */
  }
}

/** Verify a persisted user still exists and is enabled in ERPNext. */
export async function validateUserAccount(username: string): Promise<boolean> {
  try {
    const user = await apiGet<{ enabled?: 0 | 1 }>(
      `/api/resource/User/${encodeURIComponent(username)}`,
      {
        params: { fields: JSON.stringify(["name", "enabled"]) },
        _silent: true,
      } as Parameters<typeof erpnext.get>[1]
    );
    return !!user && user.enabled !== 0;
  } catch {
    return false;
  }
}
