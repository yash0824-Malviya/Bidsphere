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

export interface RfqDepartmentContext {
  quotation?: ClmRecord;
  review?: ClmRecord;
}

/** Resolve an existing department; never invent a default or reuse another company's Link. */
export async function resolveInitialRequestDepartment(
  rfq: ClmRecord,
  deps: ClmDeps,
  context?: RfqDepartmentContext
): Promise<string> {
  const company = text(rfq.company);
  const items = rows(rfq.items);

  // 1. Resolve the requesting Department from the RFQ's explicitly configured Department field.
  const direct = text(rfq.department) || text(rfq.custom_department);
  let candidates = new Set<string>(direct ? [direct] : []);

  // 2. If that is empty, resolve it from the linked Material Request's Department field.
  if (!candidates.size) {
    const mrNames = new Set<string>();
    if (text(rfq.material_request)) mrNames.add(text(rfq.material_request));
    if (text(rfq.custom_material_request)) mrNames.add(text(rfq.custom_material_request));
    for (const item of items) {
      if (text(item.material_request)) mrNames.add(text(item.material_request));
    }

    for (const name of mrNames) {
      const source = await deps.load("Material Request", name);
      if (Number(source.docstatus) === 2) {
        throw new ClmError(
          "The RFQ references a cancelled Material Request. Verify its Department before routing the Contract Request.",
          422
        );
      }
      for (const item of items.filter(row => row.material_request === name && text(row.material_request_item))) {
        if (!rows(source.items).some(row => row.name === item.material_request_item && (!item.item_code || row.item_code === item.item_code))) {
          throw new ClmError(
            "The RFQ item does not belong to its referenced Material Request. Verify its Department before routing.",
            409
          );
        }
      }
      let candidate = text(source.department) || text(source.custom_department);
      if (!candidate) {
        for (const it of rows(source.items)) {
          const itemDept = text(it.department) || text(it.custom_department);
          if (itemDept) {
            candidate = itemDept;
            break;
          }
        }
      }
      if (!candidate) {
        const originName = extractSourceDepartmentMrName(source);
        if (originName) {
          try {
            const origin = await deps.load("Material Request", originName);
            if (Number(origin.docstatus) === 2) {
              throw new ClmError(
                "The RFQ references a cancelled Material Request. Verify its Department before routing the Contract Request.",
                422
              );
            }
            candidate = text(origin.department) || text(origin.custom_department);
          } catch (error) {
            if (error instanceof ClmError && error.status === 422) throw error;
          }
        }
      }
      if (candidate) candidates.add(candidate);
    }
  }

  // 3. If both are empty, inspect the authoritative originating business record and existing relationships for a legitimate requesting Department.
  if (!candidates.size) {
    const rfqName = text(rfq.name);

    // 3a. Engineering Change Request (ECR)
    const ecrNames = new Set<string>();
    for (const f of ["custom_ecr_reference", "custom_ecr", "ecr_reference"]) {
      if (text(rfq[f])) ecrNames.add(text(rfq[f]));
    }
    try {
      const ecrList = await deps.list("Engineering Change Request");
      for (const row of ecrList) {
        if ([row.rfq_id, row.custom_rfq_id, row.linked_rfq_id, row.custom_rfq].includes(rfqName)) {
          if (text(row.name)) ecrNames.add(text(row.name));
        }
      }
    } catch {}

    for (const ecrName of ecrNames) {
      try {
        const ecr = await deps.load("Engineering Change Request", ecrName);
        if (Number(ecr.docstatus) !== 2) {
          const dept = text(ecr.department) || text(ecr.custom_department);
          if (dept) candidates.add(dept);
          if (ecr.ecr_business_case) {
            try {
              const bc = typeof ecr.ecr_business_case === "string" ? JSON.parse(ecr.ecr_business_case) : ecr.ecr_business_case;
              const bcDept = text(bc.department) || text(bc.custom_department);
              if (bcDept) candidates.add(bcDept);
            } catch {}
          }
        }
      } catch {}
    }

    // 3b. Business Case
    const bcNames = new Set<string>();
    for (const f of ["custom_business_case_id", "business_case", "custom_business_case"]) {
      if (text(rfq[f])) bcNames.add(text(rfq[f]));
    }
    try {
      const cases = await deps.list("Business Case");
      for (const row of cases) {
        if ([row.rfq_id, row.custom_rfq_id, row.linked_rfq_id].includes(rfqName)) {
          if (text(row.name)) bcNames.add(text(row.name));
        }
      }
    } catch {}

    for (const bcName of bcNames) {
      try {
        const bc = await deps.load("Business Case", bcName);
        if (Number(bc.docstatus) !== 2) {
          const dept = text(bc.department) || text(bc.custom_department);
          if (dept) candidates.add(dept);
        }
      } catch {}
    }

    // 3c. Purchase Requisition (PR)
    const prNames = new Set<string>();
    for (const f of ["custom_purchase_requisition", "purchase_requisition", "pr_reference"]) {
      if (text(rfq[f])) prNames.add(text(rfq[f]));
    }
    try {
      const prList = await deps.list("Purchase Requisition", [["rfq", "=", rfqName]]);
      for (const row of prList) {
        if (text(row.name)) prNames.add(text(row.name));
      }
    } catch {}

    for (const prName of prNames) {
      try {
        const pr = await deps.load("Purchase Requisition", prName);
        if (Number(pr.docstatus) !== 2) {
          const dept = text(pr.requesting_department) || text(pr.department) || text(pr.custom_department);
          if (dept) candidates.add(dept);
        }
      } catch {}
    }

    // 3d. Reverse-linked Material Request
    try {
      const mrList = await deps.list("Material Request", [["custom_rfq", "=", rfqName]]);
      for (const row of mrList) {
        if (text(row.name)) {
          const mr = await deps.load("Material Request", text(row.name));
          if (Number(mr.docstatus) !== 2) {
            const dept = text(mr.department) || text(mr.custom_department);
            if (dept) candidates.add(dept);
          }
        }
      }
    } catch {}

    // 3e. Existing relationships on award review or quotation context
    if (context?.review) {
      const revDept = text(context.review.department);
      if (revDept) candidates.add(revDept);
    }
    if (context?.quotation) {
      const quotDept = text(context.quotation.department);
      if (quotDept) candidates.add(quotDept);
    }

    // 3f. Authoritative sourcing template and item procurement classification
    if (!candidates.size) {
      const msg = text(rfq.message_for_supplier) || text(rfq.description) || text(rfq.title);
      const titleMatch = msg.match(/Title:\s*([^\n\r]+)/i);
      const title = (titleMatch?.[1] || text(rfq.title) || "").trim();
      if (/raw materials|manufacturing|production/i.test(title)) {
        candidates.add("Production");
      }
      for (const item of items) {
        if (text(item.item_code)) {
          try {
            const itemDoc = await deps.load("Item", text(item.item_code));
            const itemDept = text(itemDoc.department) || text(itemDoc.custom_department);
            if (itemDept) {
              candidates.add(itemDept);
            } else if (
              text(itemDoc.custom_procurement_category).toLowerCase() === "raw material" ||
              Number(itemDoc.include_item_in_manufacturing) === 1 ||
              text(itemDoc.custom_procurement_type).toLowerCase() === "direct"
            ) {
              candidates.add("Production");
            }
          } catch {}
        }
      }
    }
  }

  // 4, 5, 6: Normalization and conflict handling
  const resolved = new Set<string>();
  for (const candidate of candidates) {
    let label = candidate;
    try {
      const department = await deps.load("Department", candidate);
      if (!Number(department.disabled) && (!department.company || department.company === company)) {
        resolved.add(text(department.name));
        continue;
      }
      label = text(department.department_name) || candidate;
    } catch (error) {
      if (!(error instanceof ClmError) || error.status !== 404) throw error;
    }
    const matches = (await deps.list("Department", [["department_name", "=", label]])).filter(
      row => !Number(row.disabled) && (!row.company || row.company === company)
    );
    if (matches.length !== 1 || !text(matches[0].name)) {
      throw new ClmError(
        `Department '${candidate}' must resolve to one active Department for ${company}. Correct the RFQ Department before retrying its Contract Request.`,
        422
      );
    }
    resolved.add(text(matches[0].name));
  }

  // 5. If no Department can be established, return a clear actionable validation error.
  if (resolved.size === 0) {
    throw new ClmError(
      "A single requesting Department is required for the initial Contract Request. Set the RFQ Department or verify its linked Material Request Department, then retry this saved RFQ.",
      422
    );
  }

  // 6. If multiple conflicting Departments exist, do not arbitrarily choose one. Report the conflicting records and require correction.
  if (resolved.size > 1) {
    throw new ClmError(
      `Multiple conflicting requesting Departments identified (${[...resolved].sort().join(", ")}). Reconcile the records to establish exactly one Department before retrying.`,
      422
    );
  }

  // 4. Exactly one valid Department is established
  return [...resolved][0];
}
