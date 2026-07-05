/**

 * Demo MFA is enabled at build time via vite.config.ts when either:

 *   APP_ENV=demo  OR  DEMO_MFA=true

 *

 * The demo OTP value is injected separately and stripped from production builds.

 */



export function isDemoMfaEnabled(): boolean {

  if (typeof __DEMO_MFA_ENABLED__ !== "undefined" && __DEMO_MFA_ENABLED__) {

    return true;

  }

  return import.meta.env.VITE_DEMO_MFA === "true";

}



/** Production email OTP is not wired yet — skip MFA gate unless demo mode is on. */

export function isMfaRequired(): boolean {

  return isDemoMfaEnabled();

}



export const MFA_OTP_LENGTH = 6;

export const MFA_OTP_TTL_MS = 5 * 60 * 1000;

export const MFA_MAX_ATTEMPTS = 3;

