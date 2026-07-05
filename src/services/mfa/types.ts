export interface OtpSendResult {
  sessionId: string;
  expiresAt: number;
}

export interface OtpVerifyResult {
  valid: boolean;
  error?: string;
  attemptsRemaining?: number;
  locked?: boolean;
}

/** Contract for email OTP — swap implementations without changing the UI. */
export interface OtpService {
  sendOTP(email: string): Promise<OtpSendResult>;
  verifyOTP(
    email: string,
    otp: string,
    sessionId?: string
  ): Promise<OtpVerifyResult>;
}
