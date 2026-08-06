import { describe, it, expect, beforeEach } from "vitest";
import { isDemoMfaEnabled, isMfaRequired } from "../../config/mfaConfig";
import { demoOtpService } from "./demoOtpService";
import { sendOTP, verifyOTP } from "./otpService";
import { useAuthStore, getActiveMfaPending } from "../../store/authStore";
import type { AuthUserProfile } from "../../api/auth";

describe("Demo MFA Verification & Flow", () => {
  beforeEach(() => {
    // Reset Zustand store state before each test
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      mfaPending: null,
      isLoading: false,
      isVerifying: false,
      rememberMe: false,
      sessionProof: null,
      sessionRestoreError: null,
    });
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.clear();
    }
  });

  it("Task 1: Verify isDemoMfaEnabled() evaluates correctly at runtime", () => {
    const demoEnabled = isDemoMfaEnabled();
    const mfaRequired = isMfaRequired();
    expect(typeof demoEnabled).toBe("boolean");
    expect(typeof mfaRequired).toBe("boolean");
    expect(mfaRequired).toBe(demoEnabled);
  });

  it("Task 3 & 4: Demo OTP service sends session and verifies OTP 121212", async () => {
    const testEmail = "buyer@netlink.com";
    const sendResult = await sendOTP(testEmail);

    expect(sendResult.sessionId).toBeDefined();
    expect(sendResult.sessionId).toContain("demo-");
    expect(sendResult.expiresAt).toBeGreaterThan(Date.now());

    // Wrong code should fail
    const wrongResult = await verifyOTP(testEmail, "999999", sendResult.sessionId);
    expect(wrongResult.valid).toBe(false);
    expect(wrongResult.attemptsRemaining).toBe(2);

    // Correct code 121212 should succeed
    const validResult = await verifyOTP(testEmail, "121212", sendResult.sessionId);
    expect(validResult.valid).toBe(true);
  });

  it("Task 2, 3, 5: Login flow sets mfaPending without setting isAuthenticated until OTP verification", () => {
    const mockUser: AuthUserProfile = {
      name: "procurement.user@netlink.com",
      email: "procurement.user@netlink.com",
      full_name: "Procurement User",
      role: "procurement",
    };

    // Simulate login returning MFA requirement
    const mfaPendingState = { user: mockUser, rememberMe: true };
    useAuthStore.setState({
      mfaPending: mfaPendingState,
      user: null,
      isAuthenticated: false,
    });

    const activePending = getActiveMfaPending();
    expect(activePending).toEqual(mfaPendingState);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();

    // After completeMfaLogin, session is finalized
    useAuthStore.getState().completeMfaLogin();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().mfaPending).toBeNull();
  });

  it("Task 4: Handles max attempt lockout correctly for invalid OTPs", async () => {
    const testEmail = "buyer2@netlink.com";
    const sendResult = await demoOtpService.sendOTP(testEmail);

    await demoOtpService.verifyOTP(testEmail, "000000", sendResult.sessionId);
    await demoOtpService.verifyOTP(testEmail, "000000", sendResult.sessionId);
    const lastResult = await demoOtpService.verifyOTP(testEmail, "000000", sendResult.sessionId);

    expect(lastResult.valid).toBe(false);
    expect(lastResult.locked).toBe(true);
    expect(lastResult.attemptsRemaining).toBe(0);
    expect(lastResult.error).toContain("Maximum verification attempts exceeded");
  });
});
