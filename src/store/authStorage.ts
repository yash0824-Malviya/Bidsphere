/** Auth-related browser storage keys and helpers. */

export const REMEMBER_FLAG = "inteva-auth-remember";
export const AUTH_STORAGE_KEY = "inteva-auth";
export const MFA_PENDING_KEY = "inteva-mfa-pending";
export const MFA_REDIRECT_KEY = "inteva-mfa-redirect";
export const DEMO_OTP_SESSION_KEY = "inteva-demo-otp-session";
export const SESSION_PROOF_KEY = "bidsphere-session-proof";

/** Bump when persisted auth shape changes — invalidates old auto-login blobs. */
export const AUTH_SCHEMA_VERSION = 2;

export const SESSION_RESTORE_TIMEOUT_MS = 5_000;

/** Remember-me sessions last 7 days; tab-only sessions last 12 hours. */
const REMEMBER_ME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TAB_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionProof {
  version: number;
  userId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

function activeStorage(): Storage {
  if (typeof window === "undefined") return localStorage;
  return localStorage.getItem(REMEMBER_FLAG) === "true"
    ? localStorage
    : sessionStorage;
}

/** Read auth payload from whichever storage actually holds it. */
function readAuthPayload(name: string): string | null {
  const remembered = localStorage.getItem(REMEMBER_FLAG) === "true";
  const primary = remembered ? localStorage : sessionStorage;
  const secondary = remembered ? sessionStorage : localStorage;
  return primary.getItem(name) ?? secondary.getItem(name);
}

export const authStorage = {
  getItem: (name: string): string | null => readAuthPayload(name),

  setItem: (name: string, value: string): void => {
    const target = activeStorage();
    target.setItem(name, value);
    (target === localStorage ? sessionStorage : localStorage).removeItem(name);
  },

  removeItem: (name: string): void => {
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
  },
};

export function authLog(step: string, detail?: unknown): void {
  if (!import.meta.env.DEV) return;
  if (detail !== undefined) {
    // eslint-disable-next-line no-console
    console.log(`[Auth:${step}]`, detail);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[Auth:${step}]`);
  }
}

export function createSessionProof(
  userId: string,
  rememberMe: boolean
): SessionProof {
  const now = Date.now();
  return {
    version: AUTH_SCHEMA_VERSION,
    userId,
    issuedAt: now,
    expiresAt: now + (rememberMe ? REMEMBER_ME_TTL_MS : TAB_SESSION_TTL_MS),
    nonce:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(36).slice(2)}`,
  };
}

export function writeSessionProof(proof: SessionProof): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SESSION_PROOF_KEY, JSON.stringify(proof));
}

export function readSessionProof(): SessionProof | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_PROOF_KEY);
    return raw ? (JSON.parse(raw) as SessionProof) : null;
  } catch {
    return null;
  }
}

export function isSessionProofValid(
  proof: SessionProof | null | undefined,
  userId: string
): boolean {
  if (!proof) return false;
  if (proof.version !== AUTH_SCHEMA_VERSION) return false;
  if (proof.userId !== userId) return false;
  if (Date.now() > proof.expiresAt) return false;
  return true;
}

/** Remove corrupted, legacy, or proof-less persisted sessions. */
export function purgeStaleAuthStorage(): void {
  authLog("purgeStaleAuthStorage", "start");

  for (const store of [localStorage, sessionStorage]) {
    const raw = store.getItem(AUTH_STORAGE_KEY);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as {
        state?: {
          isAuthenticated?: boolean;
          user?: { name?: string };
          sessionProof?: SessionProof;
          rememberMe?: boolean;
        };
      };
      const state =
        parsed.state ??
        (parsed as unknown as {
          isAuthenticated?: boolean;
          user?: { name?: string };
          sessionProof?: SessionProof;
          rememberMe?: boolean;
        });
      const legacyAutoLogin =
        state?.isAuthenticated === true && !state?.sessionProof;
      const missingUser = !state?.user?.name;
      const persistedWithoutRemember =
        Boolean(state?.user?.name) && state?.rememberMe !== true;
      const staleProof =
        state?.sessionProof &&
        state?.user?.name &&
        !isSessionProofValid(state.sessionProof, state.user.name);

      if (
        legacyAutoLogin ||
        missingUser ||
        persistedWithoutRemember ||
        staleProof
      ) {
        authLog("purgeStaleAuthStorage", {
          reason: legacyAutoLogin
            ? "legacy-isAuthenticated-without-proof"
            : missingUser
              ? "missing-user"
              : persistedWithoutRemember
                ? "user-without-remember-me"
                : "stale-proof",
        });
        store.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {
      store.removeItem(AUTH_STORAGE_KEY);
    }
  }

  const tabProof = readSessionProof();
  if (tabProof && Date.now() > tabProof.expiresAt) {
    sessionStorage.removeItem(SESSION_PROOF_KEY);
  }

  if (!readAuthPayload(AUTH_STORAGE_KEY)) {
    localStorage.removeItem(REMEMBER_FLAG);
  }

  sessionStorage.removeItem(DEMO_OTP_SESSION_KEY);
}

/** Clear every auth-related key from browser storage. */
export function clearAllAuthStorage(): void {
  authLog("clearAllAuthStorage");
  localStorage.removeItem(REMEMBER_FLAG);
  localStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem(MFA_PENDING_KEY);
  sessionStorage.removeItem(MFA_REDIRECT_KEY);
  sessionStorage.removeItem(DEMO_OTP_SESSION_KEY);
  sessionStorage.removeItem(SESSION_PROOF_KEY);
  // Clear internal BidSphere RBAC tokens only. Supplier Portal JWTs live in a
  // dedicated key so Finance logout does not break an active supplier session.
  try {
    sessionStorage.removeItem("bidsphere-access-token");
    localStorage.removeItem("bidsphere-access-token-remember");
  } catch {
    /* ignore */
  }
}
