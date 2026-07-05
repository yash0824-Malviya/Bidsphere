import { useCallback, useEffect, useRef, useState } from "react";

import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";

import { useNavigate } from "react-router-dom";

import toast from "react-hot-toast";

import {

  ArrowLeft,

  Loader2,

  RefreshCw,

  ShieldCheck,

} from "lucide-react";



import LoginHeroPanel from "../../components/auth/LoginHeroPanel";

import BrandLogo from "../../components/BrandLogo";

import { APP_NAME } from "../../config/branding";

import {

  isDemoMfaEnabled,

  MFA_MAX_ATTEMPTS,

  MFA_OTP_LENGTH,

} from "../../config/mfaConfig";

import { getRoleHome, canAccessPath } from "../../config/roles";

import { sendOTP, verifyOTP } from "../../services/mfa/otpService";

import {

  getActiveMfaPending,

  getMfaRedirectPath,

  useAuthStore,

} from "../../store/authStore";



function formatCountdown(ms: number): string {

  const total = Math.max(0, Math.ceil(ms / 1000));

  const m = Math.floor(total / 60);

  const s = total % 60;

  return `${m}:${s.toString().padStart(2, "0")}`;

}



/** Collect OTP string from controlled state, falling back to live DOM values. */

function readOtpValue(

  digits: string[],

  inputRefs: React.RefObject<(HTMLInputElement | null)[]>

): string {

  const fromState = digits.join("").replace(/\D/g, "");

  if (fromState.length === MFA_OTP_LENGTH) return fromState;



  const fromDom = inputRefs.current

    .map((el) => el?.value ?? "")

    .join("")

    .replace(/\D/g, "");

  return fromDom;

}



export default function OtpVerificationPage() {

  const navigate = useNavigate();

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const isVerifying = useAuthStore((s) => s.isVerifying);

  const mfaPending = useAuthStore((s) => s.mfaPending);

  const restoreMfaPending = useAuthStore((s) => s.restoreMfaPending);

  const completeMfaLogin = useAuthStore((s) => s.completeMfaLogin);

  const cancelMfaLogin = useAuthStore((s) => s.cancelMfaLogin);



  const [digits, setDigits] = useState<string[]>(() =>

    Array(MFA_OTP_LENGTH).fill("")

  );

  const [sessionId, setSessionId] = useState<string | null>(null);

  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const [countdownMs, setCountdownMs] = useState(0);

  const [attemptsRemaining, setAttemptsRemaining] = useState(MFA_MAX_ATTEMPTS);

  const [isSending, setIsSending] = useState(false);

  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);

  const [locked, setLocked] = useState(false);

  const [otpSessionReady, setOtpSessionReady] = useState(false);



  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const sendInitRef = useRef(false);



  // Sync pending MFA from sessionStorage into Zustand once on mount

  useEffect(() => {

    if (!mfaPending && getActiveMfaPending()) {

      restoreMfaPending();

    }

  }, [mfaPending, restoreMfaPending]);



  const pending = mfaPending ?? getActiveMfaPending();

  const email = pending?.user.email ?? pending?.user.name ?? "";



  const issueOtp = useCallback(async () => {

    if (!email) return;

    setIsSending(true);

    setFormError(null);

    setLocked(false);

    setOtpSessionReady(false);

    setAttemptsRemaining(MFA_MAX_ATTEMPTS);

    setDigits(Array(MFA_OTP_LENGTH).fill(""));



    try {

      const result = await sendOTP(email);

      setSessionId(result.sessionId);

      setExpiresAt(result.expiresAt);

      setCountdownMs(Math.max(0, result.expiresAt - Date.now()));

      setOtpSessionReady(true);

      // eslint-disable-next-line no-console

      console.log("[MFA] OTP session issued", result);

      toast.success(`Verification code sent to ${email}`);

    } catch (err) {

      const message =

        err instanceof Error ? err.message : "Could not send verification code.";

      setFormError(message);

      toast.error(message);

    } finally {

      setIsSending(false);

      inputRefs.current[0]?.focus();

    }

  }, [email]);



  useEffect(() => {

    if (!isVerifying && isAuthenticated) {

      const user = useAuthStore.getState().user;

      const target = user?.role ? getRoleHome(user.role) : getMfaRedirectPath();

      // eslint-disable-next-line no-console

      console.log("[MFA] Already authenticated — navigating to", target);

      navigate(target, { replace: true });

    }

  }, [isAuthenticated, isVerifying, navigate]);



  useEffect(() => {

    if (isVerifying) return;

    if (!pending) {

      navigate("/login", { replace: true });

      return;

    }

    if (sendInitRef.current) return;

    sendInitRef.current = true;

    void issueOtp();

  }, [pending, isVerifying, navigate, issueOtp]);



  useEffect(() => {

    if (!expiresAt) return;

    const tick = () => {

      const remaining = expiresAt - Date.now();

      setCountdownMs(Math.max(0, remaining));

    };

    tick();

    const id = window.setInterval(tick, 1000);

    return () => window.clearInterval(id);

  }, [expiresAt]);



  const otpValue = digits.join("").replace(/\D/g, "");

  const isExpired = otpSessionReady && expiresAt !== null && countdownMs <= 0;

  const hasFullOtp = otpValue.length === MFA_OTP_LENGTH;



  // Only disable when OTP incomplete, actively verifying, or locked — not on expiry

  // (expiry is handled inside handleVerify with a clear error toast)

  const canSubmit =

    hasFullOtp && !isVerifyingOtp && !locked && !isSending;



  const handleDigitChange = (index: number, value: string) => {

    const char = value.replace(/\D/g, "").slice(-1);

    setFormError(null);

    setDigits((prev) => {

      const next = [...prev];

      next[index] = char;

      return next;

    });

    if (char && index < MFA_OTP_LENGTH - 1) {

      inputRefs.current[index + 1]?.focus();

    }

  };



  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {

    if (e.key === "Backspace" && !digits[index] && index > 0) {

      inputRefs.current[index - 1]?.focus();

    }

    if (e.key === "ArrowLeft" && index > 0) {

      inputRefs.current[index - 1]?.focus();

    }

    if (e.key === "ArrowRight" && index < MFA_OTP_LENGTH - 1) {

      inputRefs.current[index + 1]?.focus();

    }

  };



  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {

    e.preventDefault();

    const pasted = e.clipboardData

      .getData("text")

      .replace(/\D/g, "")

      .slice(0, MFA_OTP_LENGTH);

    if (!pasted) return;

    const next = Array(MFA_OTP_LENGTH).fill("");

    for (let i = 0; i < pasted.length; i += 1) {

      next[i] = pasted[i] ?? "";

    }

    setDigits(next);

    const focusIndex = Math.min(pasted.length, MFA_OTP_LENGTH - 1);

    inputRefs.current[focusIndex]?.focus();

  };



  const handleVerify = async (e?: FormEvent) => {

    e?.preventDefault();



    const code = readOtpValue(digits, inputRefs);



    // eslint-disable-next-line no-console

    console.log("[MFA] Verify button clicked", {

      code,

      codeLength: code.length,

      email,

      sessionId,

      otpSessionReady,

      isExpired,

      locked,

      isSending,

      isVerifyingOtp,

      demoEnabled: isDemoMfaEnabled(),

    });



    if (!email) {

      const msg = "Session expired. Please sign in again.";

      setFormError(msg);

      toast.error(msg);

      navigate("/login", { replace: true });

      return;

    }



    if (code.length !== MFA_OTP_LENGTH) {

      const msg = "Please enter all 6 digits of your verification code.";

      setFormError(msg);

      toast.error(msg);

      return;

    }



    if (locked) {

      const msg = "Too many failed attempts. Please request a new code.";

      setFormError(msg);

      toast.error(msg);

      return;

    }



    if (isExpired) {

      const msg = "OTP has expired. Please click Resend OTP.";

      setFormError(msg);

      toast.error(msg);

      return;

    }



    if (!otpSessionReady && !isDemoMfaEnabled()) {

      const msg = "OTP session is not ready. Please wait or click Resend OTP.";

      setFormError(msg);

      toast.error(msg);

      return;

    }



    if (isVerifyingOtp) return;



    setIsVerifyingOtp(true);

    setFormError(null);



    try {

      const result = await verifyOTP(email, code, sessionId ?? undefined);



      // eslint-disable-next-line no-console

      console.log("[MFA] verifyOTP result", result);



      if (result.attemptsRemaining !== undefined) {

        setAttemptsRemaining(result.attemptsRemaining);

      }



      if (result.locked) {

        setLocked(true);

        const msg = result.error ?? "Too many failed attempts.";

        setFormError(msg);

        toast.error(msg);

        return;

      }



      if (!result.valid) {

        const msg = result.error ?? "Invalid verification code.";

        setFormError(msg);

        toast.error(msg);

        setDigits(Array(MFA_OTP_LENGTH).fill(""));

        inputRefs.current[0]?.focus();

        return;

      }



      completeMfaLogin();
      toast.success("Identity verified — welcome back!");

      const user = useAuthStore.getState().user;
      const saved = getMfaRedirectPath();
      const target =
        user?.role && canAccessPath(user.role, saved)
          ? saved
          : user?.role
            ? getRoleHome(user.role)
            : "/dashboard";

      navigate(target, { replace: true });

    } catch (err) {

      const message =

        err instanceof Error ? err.message : "Verification failed.";

      setFormError(message);

      toast.error(message);

      // eslint-disable-next-line no-console

      console.error("[MFA] Verification error", err);

    } finally {

      setIsVerifyingOtp(false);

    }

  };



  const handleResend = async () => {

    if (isSending) return;

    await issueOtp();

  };



  const handleChangeEmail = async () => {

    try {

      await cancelMfaLogin();

      navigate("/login", { replace: true });

    } catch {

      navigate("/login", { replace: true });

    }

  };



  if (isVerifying || (!pending && !isAuthenticated)) {

    return (

      <div className="flex min-h-screen items-center justify-center bg-white">

        <div className="flex flex-col items-center gap-4 rounded-2xl border border-neutral-200 bg-white px-10 py-8 shadow-sm">

          <Loader2 className="h-8 w-8 animate-spin text-primary" />

          <p className="text-sm font-medium tracking-wide text-neutral-600">

            Preparing verification…

          </p>

        </div>

      </div>

    );

  }



  // Demo OTP logic is enabled only in backend.
  // UI must never reveal demo mode or hardcoded OTP.

  return (

    <div className="flex min-h-screen flex-col lg:flex-row">

      <LoginHeroPanel />



      <aside className="relative flex w-full flex-col justify-center bg-white px-6 py-10 lg:w-[42%] lg:min-h-screen lg:px-12 lg:py-12">

        <div className="relative mx-auto w-full max-w-[420px]">

          <div className="rounded-[28px] border border-neutral-200/70 bg-white p-8 shadow-[0_40px_100px_-32px_rgba(15,23,42,0.16),0_12px_32px_-18px_rgba(15,23,42,0.10)] ring-1 ring-neutral-100/80 sm:p-10">

            <div className="mb-6 text-center lg:text-left">

              <div className="mb-5 flex items-center justify-center gap-3 lg:justify-start">

                <BrandLogo whiteBg size="sm" />

                <div className="text-left leading-tight">

                  <div className="text-sm font-semibold text-neutral-900">

                    {APP_NAME}

                  </div>

                  <div className="text-[11px] font-medium text-neutral-400">

                    Secure Sign-In

                  </div>

                </div>

              </div>



              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary lg:mx-0">

                <ShieldCheck className="h-7 w-7" strokeWidth={1.75} />

              </div>



              <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">

                Verify your identity

              </h2>

              <p className="mt-1.5 text-sm text-neutral-500">

                Enter the 6-digit code sent to{" "}

                <span className="font-medium text-neutral-700">{email}</span>

              </p>

            </div>



            {formError && (

              <div

                role="alert"

                className="mb-5 rounded-xl border border-danger-100 bg-danger-50/90 px-4 py-3 text-sm text-danger-700"

              >

                {formError}

              </div>

            )}



            <form onSubmit={(e) => void handleVerify(e)} className="space-y-6">

              <div>

                <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">

                  <span>

                    {attemptsRemaining} attempt

                    {attemptsRemaining === 1 ? "" : "s"} remaining

                  </span>

                  <span

                    className={

                      isExpired

                        ? "font-medium text-danger-600"

                        : "font-medium text-neutral-600"

                    }

                  >

                    {!otpSessionReady

                      ? "Sending code…"

                      : isExpired

                        ? "Code expired"

                        : `Expires in ${formatCountdown(countdownMs)}`}

                  </span>

                </div>



                <div

                  className="flex justify-center gap-2 sm:gap-2.5"

                  role="group"

                  aria-label="One-time password digits"

                >

                  {digits.map((digit, index) => (

                    <input

                      key={index}

                      ref={(el) => {

                        inputRefs.current[index] = el;

                      }}

                      type="text"

                      inputMode="numeric"

                      autoComplete={index === 0 ? "one-time-code" : "off"}

                      maxLength={1}

                      value={digit}

                      disabled={isVerifyingOtp || isSending || locked}

                      onChange={(e) => handleDigitChange(index, e.target.value)}

                      onKeyDown={(e) => handleKeyDown(index, e)}

                      onPaste={index === 0 ? handlePaste : undefined}

                      className="h-12 w-10 rounded-xl border border-neutral-200 bg-neutral-50/80 text-center text-lg font-semibold text-neutral-900 shadow-sm transition focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 sm:h-14 sm:w-12"

                      aria-label={`Digit ${index + 1}`}

                    />

                  ))}

                </div>

              </div>



              <button

                type="submit"

                disabled={!canSubmit}

                onClick={() => {

                  // eslint-disable-next-line no-console

                  console.log("[MFA] Verify button onClick", { canSubmit, otpValue });

                }}

                className="btn-primary relative w-full justify-center py-2.5 shadow-md shadow-primary/25 disabled:cursor-not-allowed disabled:opacity-60"

              >

                {isVerifyingOtp ? (

                  <>

                    <Loader2 className="h-4 w-4 animate-spin" />

                    Verifying…

                  </>

                ) : (

                  "Verify & Continue"

                )}

              </button>



              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">

                <button

                  type="button"

                  onClick={() => void handleResend()}

                  disabled={isSending || isVerifyingOtp}

                  className="inline-flex items-center justify-center gap-2 text-sm font-medium text-primary hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-50"

                >

                  {isSending ? (

                    <Loader2 className="h-4 w-4 animate-spin" />

                  ) : (

                    <RefreshCw className="h-4 w-4" />

                  )}

                  Resend OTP

                </button>



                <button

                  type="button"

                  onClick={() => void handleChangeEmail()}

                  disabled={isVerifyingOtp}

                  className="inline-flex items-center justify-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-50"

                >

                  <ArrowLeft className="h-4 w-4" />

                  Change Email

                </button>

              </div>

            </form>

          </div>

        </div>

      </aside>

    </div>

  );

}


