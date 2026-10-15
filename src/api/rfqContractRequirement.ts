import { apiGet, buildResourceUrl } from "./erpnext";
import type { RFQ } from "../types/erpnext";

export type RfqContractRequired = "Yes" | "No";
/** Creation callers may express the choice as a boolean; ERPNext remains a Select. */
export type RfqContractRequiredInput = RfqContractRequired | boolean;
/** Frontend-only notice: never included in the ERPNext create payload. */
export type RFQCreationResult = RFQ & { contractRequirementWarning?: string };

/** A confirmed RFQ insert must never be retried because its follow-up request failed. */
export function savedRfqFromClmRoutingError(error: unknown): RFQCreationResult | undefined {
  const data = (error as { response?: { data?: { code?: unknown; saved_rfq?: unknown; message?: unknown } } } | null)?.response?.data;
  const saved = data?.saved_rfq;
  if (data?.code !== "RFQ_CLM_REQUEST_NOT_ROUTED" || !saved || typeof saved !== "object" || Array.isArray(saved)) return;
  const record = saved as RFQ;
  if (typeof record.name !== "string" || !record.name.trim()) return;
  return { ...record, contractRequirementWarning: typeof data.message === "string" ? data.message : `RFQ ${record.name} was saved, but its Contract Request could not be routed. Open this RFQ to retry the request.` };
}

/** Normalize creation inputs to the established ERP Select; only omitted legacy inputs default. */
export function contractRequirementForCreate(value: unknown): RfqContractRequired {
  if (value === undefined) return "No";
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === "Yes" || value === "No") return value;
  throw new Error("Contract Requirement must be Yes or No.");
}

/** An MR supplies its own department; manual Yes requests must choose a real master. */
export async function validateRfqContractRequestDepartment(input: {
  contractRequired: RfqContractRequired; inheritedDepartment?: string; selectedDepartment: string; company: string;
}): Promise<string | undefined> {
  if (input.contractRequired !== "Yes" || input.inheritedDepartment?.trim()) return;
  const selected = input.selectedDepartment.trim();
  if (!selected) throw new Error("Select a Department for the Contract Request before creating this RFQ.");
  const department = await apiGet<{ name?: string; company?: string; disabled?: number | string | boolean }>(buildResourceUrl("Department", selected));
  if (department?.name !== selected) throw new Error("Select an existing Department from the lookup.");
  if (department.disabled === true || Number(department.disabled) === 1) throw new Error("Select an active Department for the Contract Request.");
  if (department.company?.trim() && department.company.trim() !== input.company.trim()) throw new Error(`Select a Department belonging to ${input.company}.`);
  return department.name;
}

/** The RFQ already exists: callers must open it instead of retrying creation. */
export class RfqContractPersistenceError extends Error {
  readonly rfqName: string;
  constructor(rfqName: string) {
    super(`RFQ ${rfqName} was created, but its Contract Requirement could not be verified. Open this RFQ and confirm the saved requirement before continuing.`);
    this.name = "RfqContractPersistenceError";
    this.rfqName = rfqName;
  }
}

export async function verifyCreatedRfqContractRequirement(created: RFQ, expected: RfqContractRequired): Promise<RFQCreationResult> {
  if (!created.name) throw new Error("The RFQ service did not return the created document name.");
  try {
    const persisted = await apiGet<RFQ>(buildResourceUrl("Request for Quotation", created.name));
    if (persisted?.name !== created.name || persisted.contract_required !== expected) throw new Error("RFQ Contract Requirement persistence mismatch.");
    const warning = (created as RFQCreationResult).contractRequirementWarning;
    return warning ? { ...persisted, contractRequirementWarning: warning } : persisted;
  } catch (cause) {
    console.error("[RFQ Contract Requirement] Saved RFQ could not be verified", { rfq: created.name, expected, error: cause instanceof Error ? cause.message : String(cause) });
    // The insert succeeded. Keep existing callers' post-create source linkage,
    // target pricing and other follow-up work running even if this read fails.
    return { ...created, contractRequirementWarning: (created as RFQCreationResult).contractRequirementWarning || new RfqContractPersistenceError(created.name).message };
  }
}
