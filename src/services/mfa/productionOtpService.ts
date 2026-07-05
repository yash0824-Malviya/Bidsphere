// Demo OTP is hidden from UI.
// Replace with real email OTP service in production.

import type { OtpSendResult, OtpService, OtpVerifyResult } from "./types";

/**
 * Production email OTP service — wire to ERPNext / SMTP backend when ready.
 * UI calls sendOTP / verifyOTP only; no changes required on the page layer.
 */
export const productionOtpService: OtpService = {
  async sendOTP(email: string): Promise<OtpSendResult> {
    // Demo OTP is hidden from UI.
// Replace with real email OTP service in production.
    // Example: await erpnext.post('/api/method/bidsphere.send_login_otp', { email });
    void email;
    throw new Error(
      "Email OTP service is not configured. Contact your administrator."
    );
  },

  async verifyOTP(
    email: string,
    otp: string,
    sessionId?: string
  ): Promise<OtpVerifyResult> {
    // Demo OTP is hidden from UI.
// Replace with real email OTP service in production.
    // Example: await erpnext.post('/api/method/bidsphere.verify_login_otp', { email, otp, session_id: sessionId });
    void email;
    void otp;
    void sessionId;
    return {
      valid: false,
      error: "Email OTP verification is not configured. Contact your administrator.",
    };
  },
};
