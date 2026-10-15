import { ClmError, type ClmDeps } from "./clmCore.js";
import type { ClmRecord } from "../src/types/clm.js";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): ClmRecord[] => Array.isArray(value) ? value : [];

export function extractSourceDepartmentMrName(mr: ClmRecord): string | undefined {
  const remarks = text(mr.custom_warehouse_remarks) || text(mr.remarks);
  const fromDecision = remarks.match(/Created from warehouse decision on\s+([A-Z0-9/-]+)/i);
  if (fromDecision?.[1]?.trim()) return fromDecision[1].trim();
  const fromReview = remarks.match(/Created from warehouse review of\s+([A-Z0-9/-]+)/i);
  if (fromReview?.[1]?.trim()) return fromReview[1].trim();
  for (const it of rows(mr.items)) {
    const m = text(it.description).match(/\[Shortfall from\s+([^\]]+)\]/i);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

/** Resolve an existing department; never invent a default or reuse another company's Link. */
export async function resolveInitialRequestDepartment(rfq: ClmRecord, deps: ClmDeps): Promise<string> {
  const company = text(rfq.company), direct = text(rfq.department) || text(rfq.custom_department);
  const candidates = new Set<string>(direct ? [direct] : []);
  if (!direct) {
    const items = rows(rfq.items);
    for (const name of new Set(items.map(item => text(item.material_request)).filter(Boolean))) {
      const source = await deps.load("Material Request", name);
      if (Number(source.docstatus) === 2) throw new ClmError("The RFQ references a cancelled Material Request. Verify its Department before routing the Contract Request.", 422);
      for (const item of items.filter(row => row.material_request === name && text(row.material_request_item))) {
        if (!rows(source.items).some(row => row.name === item.material_request_item && (!item.item_code || row.item_code === item.item_code))) throw new ClmError("The RFQ item does not belong to its referenced Material Request. Verify its Department before routing.", 409);
      }
      let candidate = text(source.department) || text(source.custom_department);
      if (!candidate) {
        const originName = extractSourceDepartmentMrName(source);
        if (originName) {
          try {
            const origin = await deps.load("Material Request", originName);
            if (Number(origin.docstatus) === 2) throw new ClmError("The RFQ references a cancelled Material Request. Verify its Department before routing the Contract Request.", 422);
            candidate = text(origin.department) || text(origin.custom_department);
          } catch (error) {
            if (error instanceof ClmError && error.status === 422) throw error;
          }
        }
      }
      if (candidate) candidates.add(candidate);
    }
  }
  const resolved = new Set<string>();
  for (const candidate of candidates) {
    let label = candidate;
    try {
      const department = await deps.load("Department", candidate);
      if (!Number(department.disabled) && (!department.company || department.company === company)) { resolved.add(text(department.name)); continue; }
      // A source MR can use a different company. Carry its department label,
      // then resolve a unique active Department in the RFQ's company.
      label = text(department.department_name);
    } catch (error) { if (!(error instanceof ClmError) || error.status !== 404) throw error; }
    const matches = (await deps.list("Department", [["department_name", "=", label]])).filter(row => !Number(row.disabled) && (!row.company || row.company === company));
    if (matches.length !== 1 || !text(matches[0].name)) throw new ClmError(`Department '${candidate}' must resolve to one active Department for ${company}. Correct the RFQ Department before retrying its Contract Request.`, 422);
    resolved.add(text(matches[0].name));
  }
  if (resolved.size !== 1 || ![...resolved][0]) throw new ClmError("A single requesting Department is required for the initial Contract Request. Set the RFQ Department or verify its linked Material Request Department, then retry this saved RFQ.", 422);
  return [...resolved][0];
}
