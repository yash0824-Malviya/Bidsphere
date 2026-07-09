import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import {
  loginWithPassword,
  logoutFromServer,
  validateUserAccount,
  type AuthUserProfile,
} from "../api/auth";
import { isMfaRequired, logMfaEnvDiagnostics } from "../config/mfaConfig";

declare const __DEMO_MFA_ENABLED__: boolean;
import { resolveRoleFromUser } from "../config/roles";
import {
  AUTH_STORAGE_KEY,
  MFA_PENDING_KEY,
  MFA_REDIRECT_KEY,
  SESSION_RESTORE_TIMEOUT_MS,
  authLog,
  authStorage,
  clearAllAuthStorage,
  createSessionProof,
  isSessionProofValid,
  purgeStaleAuthStorage,
  readSessionProof,
  writeSessionProof,
  type SessionProof,
} from "./authStorage";

export type { AuthUserProfile as AuthUser };

export interface MfaPendingState {
  user: AuthUserProfile;
  rememberMe: boolean;
}

function readMfaPending(): MfaPendingState | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MFA_PENDING_KEY);
    return raw ? (JSON.parse(raw) as MfaPendingState) : null;
  } catch {
    return null;
  }
}

function writeMfaPending(pending: MfaPendingState): void {
  sessionStorage.setItem(MFA_PENDING_KEY, JSON.stringify(pending));
}

function clearMfaPendingStorage(): void {
  sessionStorage.removeItem(MFA_PENDING_KEY);
  sessionStorage.removeItem(MFA_REDIRECT_KEY);
}

export function getMfaRedirectPath(): string {
  return sessionStorage.getItem(MFA_REDIRECT_KEY) ?? "/dashboard";
}

export function getActiveMfaPending(): MfaPendingState | null {
  return useAuthStore.getState().mfaPending ?? readMfaPending();
}

export function setMfaRedirectPath(path: string): void {
  sessionStorage.setItem(MFA_REDIRECT_KEY, path);
}

function resolveSessionProof(
  userId: string,
  persistedProof: SessionProof | null,
  rememberMe: boolean
): SessionProof | null {
  const tabProof = readSessionProof();
  if (isSessionProofValid(tabProof, userId)) {
    authLog("token check", { source: "sessionStorage", userId });
    return tabProof;
  }
  if (rememberMe && isSessionProofValid(persistedProof, userId)) {
    authLog("token check", { source: "persisted-remember-me", userId });
    writeSessionProof(persistedProof!);
    return persistedProof;
  }
  authLog("token check", { valid: false, userId });
  return null;
}

function finalizeAuthenticatedUser(
  user: AuthUserProfile,
  rememberMe: boolean
): void {
  const proof = createSessionProof(user.name, rememberMe);
  writeSessionProof(proof);
  authLog("login complete", { user: user.name, rememberMe });

  if (typeof window !== "undefined") {
    localStorage.setItem("inteva-auth-remember", rememberMe ? "true" : "false");
  }
  clearMfaPendingStorage();
  useAuthStore.setState({
    user,
    isAuthenticated: true,
    mfaPending: null,
    rememberMe,
    sessionProof: rememberMe ? proof : null,
    isLoading: false,
    isVerifying: false,
    sessionRestoreError: null,
  });
}

interface AuthState {
  user: AuthUserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isVerifying: boolean;
  hasHydrated: boolean;
  rememberMe: boolean;
  mfaPending: MfaPendingState | null;
  sessionProof: SessionProof | null;
  sessionRestoreError: string | null;
  login: (
    username: string,
    password: string,
    rememberMe: boolean
  ) => Promise<"mfa" | "complete">;
  completeMfaLogin: () => void;
  cancelMfaLogin: () => Promise<void>;
  restoreMfaPending: () => MfaPendingState | null;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearSession: () => void;
  clearSessionRestoreError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isVerifying: false,
      hasHydrated: false,
      rememberMe: false,
      mfaPending: null,
      sessionProof: null,
      sessionRestoreError: null,

      login: async (username, password, rememberMe) => {
        authLog("login start", { username });
        // Always log on VM/production too (authLog is DEV-only).
        // eslint-disable-next-line no-console
        console.log("[MFA:login] Login request sent", { username });
        logMfaEnvDiagnostics("login");
        set({ isLoading: true, sessionRestoreError: null });
        try {
          const user = await loginWithPassword(username, password);

          // eslint-disable-next-line no-console
          console.log("[MFA:login] Login response received (password OK)", {
            user: {
              name: user.name,
              email: user.email,
              full_name: user.full_name,
              role: user.role,
            },
          });

          const mfaRequired = isMfaRequired();
          const demoMFA = isMfaRequired(); // same gate — Demo MFA is the only MFA
          const destination = mfaRequired ? "/verify-otp" : "dashboard (complete)";

          // eslint-disable-next-line no-console
          console.log("[MFA:login] Decision point (authStore.login)", {
            requiresMFA: mfaRequired,
            demoMFA,
            VITE_DEMO_MFA: import.meta.env.VITE_DEMO_MFA,
            DEMO_MFA: (import.meta.env as { DEMO_MFA?: string }).DEMO_MFA,
            __DEMO_MFA_ENABLED__:
              typeof __DEMO_MFA_ENABLED__ !== "undefined"
                ? __DEMO_MFA_ENABLED__
                : "(undefined)",
            MODE: import.meta.env.MODE,
            PROD: import.meta.env.PROD,
            DEV: import.meta.env.DEV,
            destination,
          });

          authLog("mfa gate", {
            mfaRequired,
            VITE_DEMO_MFA: import.meta.env.VITE_DEMO_MFA,
          });

          if (!mfaRequired) {
            // eslint-disable-next-line no-console
            console.warn(
              "[MFA:login] SKIPPING Demo MFA → finalize session → Dashboard",
              "Cause: isMfaRequired() === false (build-time Demo MFA disabled)",
            );
            finalizeAuthenticatedUser(user, rememberMe);
            return "complete";
          }

          const pending: MfaPendingState = { user, rememberMe };
          writeMfaPending(pending);
          set({
            mfaPending: pending,
            user: null,
            isAuthenticated: false,
            isLoading: false,
            isVerifying: false,
            rememberMe: false,
            sessionProof: null,
          });
          // eslint-disable-next-line no-console
          console.log("[MFA:login] REQUIRING Demo MFA → /verify-otp");
          return "mfa";
        } finally {
          set({ isLoading: false });
        }
      },

      completeMfaLogin: () => {
        const pending = get().mfaPending ?? readMfaPending();
        if (!pending) {
          throw new Error("No pending MFA session.");
        }
        finalizeAuthenticatedUser(pending.user, pending.rememberMe);
      },

      cancelMfaLogin: async () => {
        try {
          await logoutFromServer();
        } finally {
          clearMfaPendingStorage();
          clearAllAuthStorage();
          set({
            user: null,
            isAuthenticated: false,
            mfaPending: null,
            isLoading: false,
            isVerifying: false,
            rememberMe: false,
            sessionProof: null,
          });
        }
      },

      restoreMfaPending: () => {
        const pending = readMfaPending();
        if (pending) {
          set({ mfaPending: pending, isAuthenticated: false, user: null });
        }
        return pending;
      },

      logout: async () => {
        authLog("logout start");
        try {
          await logoutFromServer();
        } finally {
          clearMfaPendingStorage();
          clearAllAuthStorage();
          void useAuthStore.persist.clearStorage();
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            isVerifying: false,
            rememberMe: false,
            mfaPending: null,
            sessionProof: null,
            sessionRestoreError: null,
          });
          authLog("logout complete");
        }
      },

      clearSession: () => {
        clearMfaPendingStorage();
        clearAllAuthStorage();
        void useAuthStore.persist.clearStorage();
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isVerifying: false,
          rememberMe: false,
          mfaPending: null,
          sessionProof: null,
        });
      },

      clearSessionRestoreError: () => {
        set({ sessionRestoreError: null });
      },

      restoreSession: async () => {
        authLog("restoreSession start");
        set({ isVerifying: true, isAuthenticated: false, sessionRestoreError: null });
        try {
          purgeStaleAuthStorage();

          const pending = readMfaPending();
          if (pending) {
            authLog("redirect decision", "mfa-pending → verify-otp");
            set({
              mfaPending: pending,
              isAuthenticated: false,
              user: null,
            });
            return;
          }

          const { user, rememberMe, sessionProof: persistedProof } = get();
          if (!user?.name) {
            authLog("redirect decision", "no-user → login");
            clearAllAuthStorage();
            set({ user: null, isAuthenticated: false, sessionProof: null });
            return;
          }

          const proof = resolveSessionProof(
            user.name,
            persistedProof,
            rememberMe
          );
          if (!proof) {
            authLog("redirect decision", "invalid-or-missing-proof → login");
            try {
              await logoutFromServer();
            } catch {
              /* best-effort */
            }
            clearAllAuthStorage();
            set({
              user: null,
              isAuthenticated: false,
              rememberMe: false,
              mfaPending: null,
              sessionProof: null,
            });
            return;
          }

          authLog("session validation", { user: user.name });
          const result = await validateUserAccount(
            user.name,
            SESSION_RESTORE_TIMEOUT_MS
          );

          if (result === "valid") {
            authLog("redirect decision", "valid-session → dashboard");
            set({
              isAuthenticated: true,
              sessionProof: rememberMe ? proof : null,
              user: {
                ...user,
                role: user.role ?? resolveRoleFromUser(user),
              },
            });
            return;
          }

          authLog("redirect decision", { result, action: "clear → login" });
          try {
            await logoutFromServer();
          } catch {
            /* best-effort */
          }
          clearAllAuthStorage();
          set({
            user: null,
            isAuthenticated: false,
            rememberMe: false,
            mfaPending: null,
            sessionProof: null,
            sessionRestoreError:
              result === "unreachable" ? "Unable to restore session." : null,
          });
        } catch {
          authLog("restoreSession error", "clear → login");
          try {
            await logoutFromServer();
          } catch {
            /* best-effort */
          }
          clearAllAuthStorage();
          set({
            user: null,
            isAuthenticated: false,
            rememberMe: false,
            mfaPending: null,
            sessionProof: null,
            sessionRestoreError: "Unable to restore session.",
          });
        } finally {
          set({ isVerifying: false, hasHydrated: true });
          authLog("restoreSession end", {
            isAuthenticated: get().isAuthenticated,
          });
        }
      },

      checkAuth: async () => {
        await get().restoreSession();
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => authStorage),
      partialize: (state) => ({
        user: state.rememberMe ? state.user : null,
        rememberMe: state.rememberMe,
        sessionProof: state.rememberMe ? state.sessionProof : null,
      }),
      onRehydrateStorage: () => (_state, err) => {
        if (err) {
          authLog("rehydrate error", err);
          clearAllAuthStorage();
        }
        authLog("rehydrate complete");
      },
    }
  )
);

export { handleSessionExpired } from "./sessionExpiry";
