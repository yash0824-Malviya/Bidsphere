// Demo OTP is hidden from UI.
// Replace with real email OTP service in production.

import {
  MFA_MAX_ATTEMPTS,
  MFA_OTP_TTL_MS,
  isDemoMfaEnabled,
} from "../../config/mfaConfig";
import type { OtpSendResult, OtpService, OtpVerifyResult } from "./types";

declare const __DEMO_MFA_OTP__: string;

const SESSION_KEY = "inteva-demo-otp-session";

interface DemoSession {
  sessionId: string;
  email: string;
  expiresAt: number;
  attempts: number;
}

let inMemorySession: DemoSession | null = null;

function readSession(): DemoSession | null {
  if (typeof sessionStorage === "undefined") return inMemorySession;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as DemoSession) : null;
  } catch {
    return inMemorySession;
  }
}

function writeSession(session: DemoSession): void {
  inMemorySession = session;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* ignore */
    }
  }
}

function clearSession(): void {
  inMemorySession = null;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Build-time demo secret — defaults to 121212 when Demo MFA is enabled. */
function demoOtpValue(): string {
  if (!isDemoMfaEnabled()) return "";
  return typeof __DEMO_MFA_OTP__ !== "undefined" && __DEMO_MFA_OTP__
    ? __DEMO_MFA_OTP__
    : "121212";
}

function newSessionId(): string {
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const demoOtpService: OtpService = {
  async sendOTP(email: string): Promise<OtpSendResult> {
    const sessionId = newSessionId();
    const expiresAt = Date.now() + MFA_OTP_TTL_MS;
    writeSession({
      sessionId,
      email: email.trim().toLowerCase(),
      expiresAt,
      attempts: 0,
    });
    return { sessionId, expiresAt };
  },

  async verifyOTP(
    email: string,
    otp: string,
    sessionId?: string
  ): Promise<OtpVerifyResult> {
    // eslint-disable-next-line no-console
    console.log("[MFA] demoOtpService.verifyOTP", { email, otpLength: otp.length, sessionId });

    const session = readSession();
    const normalizedEmail = email.trim().toLowerCase();

    if (!session || session.email !== normalizedEmail) {
      // eslint-disable-next-line no-console
      console.warn("[MFA] demo session missing or email mismatch", {
        hasSession: !!session,
        sessionEmail: session?.email,
        normalizedEmail,
      });
      return { valid: false, error: "OTP session expired. Please request a new code." };
    }

    // Only enforce sessionId match when the caller supplies one (React state can be stale after HMR)
    if (sessionId && session.sessionId !== sessionId) {
      // eslint-disable-next-line no-console
      console.warn("[MFA] sessionId mismatch — using sessionStorage session", {
        stateSessionId: sessionId,
        storageSessionId: session.sessionId,
      });
    }

    if (Date.now() > session.expiresAt) {
      clearSession();
      return { valid: false, error: "OTP has expired. Please request a new code." };
    }

    if (session.attempts >= MFA_MAX_ATTEMPTS) {
      return {
        valid: false,
        locked: true,
        attemptsRemaining: 0,
        error: "Maximum verification attempts exceeded. Please request a new code.",
      };
    }

    const expected = demoOtpValue();
    const normalizedOtp = otp.replace(/\D/g, "");

    // eslint-disable-next-line no-console
    console.log("[MFA] OTP validation", {
      normalizedOtp,
      expectedLength: expected.length,
      demoEnabled: isDemoMfaEnabled(),
    });

    if (!expected || normalizedOtp !== expected) {
      session.attempts += 1;
      writeSession(session);
      const remaining = MFA_MAX_ATTEMPTS - session.attempts;
      if (remaining <= 0) {
        return {
          valid: false,
          locked: true,
          attemptsRemaining: 0,
          error: "Maximum verification attempts exceeded. Please request a new code.",
        };
      }
      return {
        valid: false,
        attemptsRemaining: remaining,
        error: `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      };
    }

    clearSession();
    // eslint-disable-next-line no-console
    console.log("[MFA] OTP verified successfully");
    return { valid: true };
  },
};
