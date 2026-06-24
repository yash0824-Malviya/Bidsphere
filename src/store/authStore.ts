import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import {
  loginWithPassword,
  logoutFromServer,
  validateUserAccount,
  type AuthUserProfile,
} from "../api/auth";
import { resolveRoleFromUser } from "../config/roles";

export type { AuthUserProfile as AuthUser };

const REMEMBER_FLAG = "inteva-auth-remember";
const AUTH_STORAGE_KEY = "inteva-auth";

function activeStorage(): Storage {
  if (typeof window === "undefined") return localStorage;
  return localStorage.getItem(REMEMBER_FLAG) === "true"
    ? localStorage
    : sessionStorage;
}

const authStorage: StateStorage = {
  getItem: (name) => activeStorage().getItem(name),
  setItem: (name, value) => activeStorage().setItem(name, value),
  removeItem: (name) => {
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
  },
};

interface AuthState {
  user: AuthUserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isVerifying: boolean;
  rememberMe: boolean;
  login: (
    username: string,
    password: string,
    rememberMe: boolean
  ) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isVerifying: true,
      rememberMe: false,

      login: async (username, password, rememberMe) => {
        set({ isLoading: true });
        try {
          if (typeof window !== "undefined") {
            localStorage.setItem(REMEMBER_FLAG, rememberMe ? "true" : "false");
          }

          const user = await loginWithPassword(username, password);
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            isVerifying: false,
            rememberMe,
          });
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        await logoutFromServer();
        if (typeof window !== "undefined") {
          localStorage.removeItem(REMEMBER_FLAG);
        }
        localStorage.removeItem(AUTH_STORAGE_KEY);
        sessionStorage.removeItem(AUTH_STORAGE_KEY);
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isVerifying: false,
          rememberMe: false,
        });
      },

      checkAuth: async () => {
        const { user, isAuthenticated } = get();
        if (!isAuthenticated || !user?.name) {
          set({ isAuthenticated: false, user: null, isVerifying: false });
          return;
        }

        set({ isVerifying: true });
        const valid = await validateUserAccount(user.name);
        if (!valid) {
          localStorage.removeItem(REMEMBER_FLAG);
          localStorage.removeItem(AUTH_STORAGE_KEY);
          sessionStorage.removeItem(AUTH_STORAGE_KEY);
          set({
            user: null,
            isAuthenticated: false,
            isVerifying: false,
            rememberMe: false,
          });
          return;
        }

        set({
          isAuthenticated: true,
          isVerifying: false,
          user: {
            ...user,
            role: user.role ?? resolveRoleFromUser(user),
          },
          rememberMe:
            typeof window !== "undefined" &&
            localStorage.getItem(REMEMBER_FLAG) === "true",
        });
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => authStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        rememberMe: state.rememberMe,
      }),
    }
  )
);
