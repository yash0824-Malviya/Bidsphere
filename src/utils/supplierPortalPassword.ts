/**
 * Shared Supplier Portal password policy.
 * Used by Change Password UI and onboarding API — keep in sync.
 */

export const PORTAL_PASSWORD_MIN_LEN = 8;
export const PORTAL_PASSWORD_MAX_LEN = 32;

export const PORTAL_PASSWORD_POLICY_MESSAGE =
  "Password must be 8–32 characters with uppercase, lowercase, a number, and a special character.";

export type PortalPasswordRuleFailure =
  | "length_min"
  | "length_max"
  | "uppercase"
  | "lowercase"
  | "number"
  | "special";

const RULE_MESSAGES: Record<PortalPasswordRuleFailure, string> = {
  length_min: `Password must be at least ${PORTAL_PASSWORD_MIN_LEN} characters.`,
  length_max: `Password must be at most ${PORTAL_PASSWORD_MAX_LEN} characters.`,
  uppercase: "Password must include at least one uppercase letter.",
  lowercase: "Password must include at least one lowercase letter.",
  number: "Password must include at least one number.",
  special: "Password must include at least one special character.",
};

export type PortalPasswordValidation = {
  ok: boolean;
  failures: PortalPasswordRuleFailure[];
  /** Combined message matching implemented rules */
  message: string | null;
};

/**
 * Validate portal password.
 * Special character = any non-alphanumeric character (standard policy wording).
 */
export function validatePortalPassword(password: string): PortalPasswordValidation {
  const failures: PortalPasswordRuleFailure[] = [];
  const value = String(password ?? "");

  if (value.length < PORTAL_PASSWORD_MIN_LEN) failures.push("length_min");
  if (value.length > PORTAL_PASSWORD_MAX_LEN) failures.push("length_max");
  if (!/[A-Z]/.test(value)) failures.push("uppercase");
  if (!/[a-z]/.test(value)) failures.push("lowercase");
  if (!/[0-9]/.test(value)) failures.push("number");
  // Any non-letter/non-digit counts as special (!@#$%^&*-_=+.,? etc.)
  if (!/[^A-Za-z0-9]/.test(value)) failures.push("special");

  if (failures.length === 0) {
    return { ok: true, failures: [], message: null };
  }

  // Prefer the first specific failure; always keep the overall policy message available
  const message =
    failures.length === 1
      ? RULE_MESSAGES[failures[0]!]
      : PORTAL_PASSWORD_POLICY_MESSAGE;

  return { ok: false, failures, message };
}

export function meetsPortalPasswordPolicy(password: string): boolean {
  return validatePortalPassword(password).ok;
}

/** Debug helper — logs which rule(s) failed without logging the password itself. */
export function logPortalPasswordValidation(
  source: string,
  result: PortalPasswordValidation,
  length: number,
): void {
  if (result.ok) return;
  // eslint-disable-next-line no-console
  console.debug(`[${source}] password validation failed`, {
    length,
    min: PORTAL_PASSWORD_MIN_LEN,
    max: PORTAL_PASSWORD_MAX_LEN,
    failures: result.failures,
    message: result.message,
  });
}
