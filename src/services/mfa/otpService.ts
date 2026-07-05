// Demo OTP is hidden from UI.
// Replace with real email OTP service in production.

import { isDemoMfaEnabled } from "../../config/mfaConfig";
import { demoOtpService } from "./demoOtpService";
import { productionOtpService } from "./productionOtpService";
import type { OtpSendResult, OtpService, OtpVerifyResult } from "./types";

export type { OtpSendResult, OtpVerifyResult, OtpService };

function resolveService(): OtpService {
  return isDemoMfaEnabled() ? demoOtpService : productionOtpService;
}

/** Send a one-time password to the user's email. */
export async function sendOTP(email: string): Promise<OtpSendResult> {
  return resolveService().sendOTP(email);
}

/** Verify a submitted OTP against the active session. */
export async function verifyOTP(
  email: string,
  otp: string,
  sessionId?: string
): Promise<OtpVerifyResult> {
  // eslint-disable-next-line no-console
  console.log("[MFA] verifyOTP()", {
    email,
    otp,
    sessionId,
    service: isDemoMfaEnabled() ? "demo" : "production",
  });
  return resolveService().verifyOTP(email, otp, sessionId);
}
