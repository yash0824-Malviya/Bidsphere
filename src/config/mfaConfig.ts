/**
 * Demo MFA is enabled at **build time** via vite.config.ts when any of:
 *   APP_ENV=demo  OR  DEMO_MFA=true  OR  VITE_DEMO_MFA=true
 *
 * Those values must be present when `vite build` / `vite` runs. Runtime
 * PM2/Docker/nginx env vars do NOT flip this flag in an already-built bundle.
 *
 * The demo OTP (`121212`) is injected as `__DEMO_MFA_OTP__` and is empty when
 * Demo MFA is off.
 */

declare const __DEMO_MFA_ENABLED__: boolean;

export function isDemoMfaEnabled(): boolean {
  // Build-time constant from vite.config.ts `define`.
  if (typeof __DEMO_MFA_ENABLED__ !== "undefined" && __DEMO_MFA_ENABLED__) {
    return true;
  }
  // Fallback: Vite only embeds VITE_* into import.meta.env (not bare DEMO_MFA).
  return import.meta.env.VITE_DEMO_MFA === "true";
}

/** Production email OTP is not wired yet — skip MFA gate unless demo mode is on. */
export function isMfaRequired(): boolean {
  return isDemoMfaEnabled();
}

/** Call once after login mount / MFA decision for environment diagnostics. */
export function logMfaEnvDiagnostics(source = "mfaConfig"): void {
  // eslint-disable-next-line no-console
  console.log(`[MFA:${source}] Demo MFA diagnostics`, {
    __DEMO_MFA_ENABLED__:
      typeof __DEMO_MFA_ENABLED__ !== "undefined" ? __DEMO_MFA_ENABLED__ : "(undefined)",
    "import.meta.env.VITE_DEMO_MFA": import.meta.env.VITE_DEMO_MFA,
    // Bare DEMO_MFA is never exposed to the client by Vite — expect undefined.
    "import.meta.env.DEMO_MFA": (import.meta.env as { DEMO_MFA?: string }).DEMO_MFA,
    "import.meta.env.MODE": import.meta.env.MODE,
    "import.meta.env.PROD": import.meta.env.PROD,
    "import.meta.env.DEV": import.meta.env.DEV,
    isDemoMfaEnabled: isDemoMfaEnabled(),
    isMfaRequired: isMfaRequired(),
  });
}

export const MFA_OTP_LENGTH = 6;
export const MFA_OTP_TTL_MS = 5 * 60 * 1000;
export const MFA_MAX_ATTEMPTS = 3;
