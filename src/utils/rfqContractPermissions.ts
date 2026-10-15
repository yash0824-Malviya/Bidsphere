/** Existing procurement roles only; the general role normalizer has a Manager fallback for unknown values. */
export function canPrepareRfqContract(role?: string | null): boolean {
  return ["procurement", "procurement manager", "purchase manager", "procurement_team", "procurement team", "procurement.team", "purchase user"].includes(role?.trim().toLowerCase() || "");
}
