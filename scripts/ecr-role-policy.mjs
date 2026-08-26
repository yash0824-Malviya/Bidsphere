/** Canonical ERP roles that may read ECR records through BidSphere. */
export const ECR_HUMAN_ROLES = Object.freeze([
  "Engineer",
  "Engineering Manager",
  "Operations Manager",
  "Quality Manager",
  "Program Manager",
  "Purchase Manager",
  "Purchase User",
  "Procurement Manager",
  "Procurement Team",
  // Compatibility role retained for existing installations.
  "Procurement User",
  "Finance Manager",
  "System Manager",
]);

export const PROCUREMENT_TEAM_ERP_ROLE = "Procurement Team";

/** Human workflow roles may read ECRs but cannot mutate them directly in ERP. */
export const ECR_READ_ONLY_PERMISSION_FLAGS = Object.freeze({
  read: 1,
  write: 0,
  create: 0,
  delete: 0,
  submit: 0,
  cancel: 0,
  amend: 0,
});
