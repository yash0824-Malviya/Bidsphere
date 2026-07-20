/**
 * TEMPORARY LEGACY MODE
 * Remove after all suppliers migrate to Account Login.
 *
 * When ENABLE_LEGACY_PIN_PROFILE / VITE_ENABLE_LEGACY_PIN_PROFILE is true,
 * Company PIN portal users can access Profile, Documents, and Discussion
 * using the ERPNext Supplier Master (no onboarding draft required).
 */

export function isLegacyPinProfileEnabled(): boolean {
  // TEMPORARY LEGACY MODE — default ON so existing PIN suppliers keep working.
  // Set VITE_ENABLE_LEGACY_PIN_PROFILE=false to restrict Profile/Documents to Account Login only.
  const raw = String(
    import.meta.env.VITE_ENABLE_LEGACY_PIN_PROFILE ??
      import.meta.env.ENABLE_LEGACY_PIN_PROFILE ??
      "true",
  )
    .trim()
    .toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
