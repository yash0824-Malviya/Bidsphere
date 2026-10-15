/**
 * Split Material Issue remarks into business-facing text vs audit metadata.
 * Machine tags ([BidSphere:…]) stay in ERP for sync/audit — never render raw JSON
 * in Issue Slip / Receipt UI.
 */

import {
  extractBidSphereJsonTag,
  extractWarehouseMachineTags,
  parseForwardedItemsJsonFromRemarks,
  parseMaterialIssueJsonFromRemarks,
  type MaterialIssueReceiptSidecar,
} from "./warehouseIssueFulfillmentSync";
import type {
  MaterialIssueAcceptanceChecklist,
  MaterialIssueReceipt,
} from "../types/materialIssueReceipt";
import { formatDate, formatDateTime } from "./format";

export type MaterialIssueDisplayAudit = {
  document_version?: string;
  created_by?: string;
  created_at?: string;
  modified_at?: string;
  warehouse_signer?: string;
  warehouse_signed_at?: string;
  department_signer?: string;
  department_signed_at?: string;
  warehouse?: string;
  browser?: string;
  device?: string;
  user_agent?: string;
  request_id?: string;
  issue_type?: string;
  receiver?: string;
  document_hash?: string;
  verification_token?: string;
  warehouse_sha256?: string;
  department_sha256?: string;
  /** Full machine tags + parsed JSON for admin expandable section. */
  json_payload?: string;
};

export type MaterialIssueRemarksDisplay = {
  /** Clean multi-line prose for simple text areas. */
  prose: string;
  /** Bullet lines for Issue Slip (enterprise readable). */
  bullets: string[];
  audit: MaterialIssueDisplayAudit;
  hasAuditPayload: boolean;
};

export interface StructuredWarehouseProcessing {
  hasData: boolean;
  status: string;
  issueNumber: string;
  stockEntry: string;
  warehouse: string;
  receivedBy: string;
  issueType: string;
  issueDate: string;
  departmentAcceptance: string;
  acceptanceDate: string;
  acceptanceChecklist: MaterialIssueAcceptanceChecklist | null;
  humanRemarks: string;
  audit: MaterialIssueDisplayAudit;
}

const MACHINE_LINE_RE =
  /^\[BidSphere:|^\s*[{[]|^\s*"(audit|browser|device|lines|issue_type|receiver|forwarded|document_hash|document_version|verification_token|created_at|modified_at|warehouse_signed_at|warehouse_signer|warehouse_sha256|department_signer|department_sha256|business_snapshot|acceptance_checklist)/i;

function isMachineLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (MACHINE_LINE_RE.test(t)) return true;
  if (t.includes('"sha256"') || t.includes('"verification_token"') || t.includes('"document_hash"')) return true;
  if (/BidSphere:(MaterialIssue|ForwardedItems|MIR|StockDecisions):/.test(t)) return true;
  if (t.startsWith("{") && t.endsWith("}")) return true;
  if (t.startsWith("[") && t.endsWith("]")) return true;
  return false;
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        return Array.isArray(parsed) ? parsed[0] : parsed;
      }
    }
  } catch {
    // Not valid standalone JSON
  }
  return null;
}

/**
 * Safely removes machine JSON blocks from human text.
 */
export function sanitizeHumanRemarks(raw: string | null | undefined): string {
  if (!raw) return "";

  // If the whole raw string is a JSON object or array, extract nested human remarks if present
  const parsed = safeParseJson(raw);
  if (parsed) {
    const innerRemarks = typeof parsed.remarks === "string" ? parsed.remarks : "";
    if (innerRemarks && !safeParseJson(innerRemarks)) {
      return sanitizeHumanRemarks(innerRemarks);
    }
    return "";
  }

  // Strip [BidSphere:Kind:...] tags
  let cleaned = raw
    .replace(/\[BidSphere:[A-Za-z0-9_]+:(\[.*?\]|\{.*?\})\]/gs, "")
    .replace(/\[BidSphere:[^\]]*\]/gs, "");

  // Strip any inline JSON objects like {"document_hash":...}
  cleaned = cleaned.replace(/\{[^{}]*"document_hash"[^{}]*\}/gs, "");
  cleaned = cleaned.replace(/\{[^{}]*"verification_token"[^{}]*\}/gs, "");

  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !isMachineLine(l));

  return lines.join("\n").trim();
}

function proseLines(prose: string): string[] {
  return prose
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•\-*]+/, "").trim())
    .filter((l) => l && !isMachineLine(l));
}

/**
 * Build readable warehouse remarks + structured audit from raw ERP remarks.
 */
export function splitMaterialIssueRemarksForDisplay(
  raw: string | null | undefined,
  opts?: {
    items?: Array<{
      item_code: string;
      item_name?: string;
      requested_qty?: number;
      issued_qty?: number;
      remaining_qty?: number;
      uom?: string;
    }>;
  },
): MaterialIssueRemarksDisplay {
  const sanitizedProse = sanitizeHumanRemarks(raw);
  const tags = extractWarehouseMachineTags(raw);
  const issue = parseMaterialIssueJsonFromRemarks(raw);
  const forwarded = parseForwardedItemsJsonFromRemarks(raw);

  // Check if raw is a standalone JSON sidecar
  const standaloneSidecar = safeParseJson(raw || "") as Partial<MaterialIssueReceiptSidecar> | null;

  // Extract MIR sidecar tag
  let mirSidecar: Partial<MaterialIssueReceiptSidecar> | null = null;
  const mirTag = extractBidSphereJsonTag(raw, "MIR");
  if (mirTag) {
    try {
      mirSidecar = JSON.parse(mirTag.json) as Partial<MaterialIssueReceiptSidecar>;
    } catch {
      // Ignore
    }
  }

  const sidecar = mirSidecar || standaloneSidecar;
  const auditMeta = (issue?.audit || {}) as Record<string, unknown>;

  const bullets = proseLines(sanitizedProse || tags.prose);

  // Derive enterprise summary bullets when user prose is thin.
  const issueType = String(sidecar?.issue_type || issue?.issue_type || "").trim();
  const receiver = String(sidecar?.received_by || issue?.receiver || "").trim();
  const lines =
    opts?.items?.length
      ? opts.items
      : (sidecar?.items || issue?.lines || []).map((l: any) => ({
          item_code: l.item_code,
          item_name: l.item_name || l.item_code,
          requested_qty: Number(l.requested_qty ?? l.required_qty) || 0,
          issued_qty: Number(l.issued_qty ?? l.issue_qty) || 0,
          remaining_qty: Number(l.remaining_qty) || 0,
          uom: l.uom || "Nos",
        }));

  const issuedLines = lines.filter((l) => (Number(l.issued_qty) || 0) > 0);
  const partialLines = issuedLines.filter((l) => {
    const req = Number(l.requested_qty) || 0;
    const iss = Number(l.issued_qty) || 0;
    return req > 0 && iss + 1e-9 < req;
  });
  const totalRemaining = lines.reduce(
    (s, l) => s + Math.max(0, Number(l.remaining_qty) || 0),
    0,
  );
  const forwardQty = forwarded.reduce(
    (s, f) => s + Math.max(0, Number(f.forward_qty ?? f.shortage_qty) || 0),
    0,
  );

  if (bullets.length === 0 && issuedLines.length > 0) {
    if (issueType === "Partial Issue" || partialLines.length > 0) {
      bullets.push("Partial issue completed.");
    } else {
      bullets.push("Material issue completed.");
    }
    bullets.push(
      `${issuedLines.length} item${issuedLines.length === 1 ? "" : "s"} issued successfully.`,
    );
    for (const l of partialLines.slice(0, 5)) {
      const name = l.item_name || l.item_code;
      const uom = l.uom || "Nos";
      const iss = Number(l.issued_qty) || 0;
      const req = Number(l.requested_qty) || 0;
      bullets.push(`${name} partially issued (${iss}/${req} ${uom}).`);
    }
    const rem = totalRemaining > 0 ? totalRemaining : forwardQty;
    if (rem > 0) {
      bullets.push(
        `Remaining ${rem} Nos forwarded to Procurement.`,
      );
    }
  }

  // Prefer business Receiver line once (avoid duplicating if already in prose).
  if (
    receiver &&
    !bullets.some((b) => /^receiver\s*:/i.test(b))
  ) {
    bullets.push(`Receiver: ${receiver}.`);
  }

  // Strip auto Issue Type line from prose if present as raw label only.
  const cleanedBullets = bullets.filter(
    (b) => !/^issue type\s*:/i.test(b) || Boolean(b.replace(/^issue type\s*:/i, "").trim()),
  );

  const payloadParts = [
    tags.materialIssueTag,
    tags.forwardedTag,
    tags.mirTag,
  ].filter(Boolean) as string[];

  const audit: MaterialIssueDisplayAudit = {
    document_version: sidecar?.document_version || undefined,
    created_by: String(sidecar?.issued_by || auditMeta.created_by || "") || undefined,
    created_at: String(sidecar?.created_at || auditMeta.issue_time || "") || undefined,
    modified_at: String(sidecar?.modified || "") || undefined,
    warehouse_signer: String(sidecar?.warehouse_signer || "") || undefined,
    warehouse_signed_at: String(sidecar?.warehouse_signed_at || "") || undefined,
    department_signer: String(sidecar?.department_signer || "") || undefined,
    department_signed_at: String(sidecar?.department_signed_at || "") || undefined,
    warehouse: String(sidecar?.warehouse || auditMeta.warehouse || "") || undefined,
    browser: String(auditMeta.browser || "") || undefined,
    device: String(auditMeta.device || "") || undefined,
    user_agent:
      String(auditMeta.user_agent || auditMeta.userAgent || "") || undefined,
    request_id:
      String(auditMeta.request_id || auditMeta.requestId || "") || undefined,
    issue_type: issueType || undefined,
    receiver: receiver || undefined,
    document_hash: sidecar?.document_hash || undefined,
    verification_token: sidecar?.verification_token || undefined,
    warehouse_sha256: sidecar?.warehouse_sha256 || undefined,
    department_sha256: sidecar?.department_sha256 || undefined,
    json_payload: payloadParts.length ? payloadParts.join("\n") : undefined,
  };

  return {
    prose: cleanedBullets.join("\n"),
    bullets: cleanedBullets,
    audit,
    hasAuditPayload: Boolean(
      audit.json_payload ||
        audit.created_by ||
        audit.browser ||
        audit.device ||
        audit.issue_type ||
        audit.document_hash,
    ),
  };
}

/** Strip all BidSphere machine tags — safe for Issue Slip / PDF remarks. */
export function cleanBusinessWarehouseRemarks(
  raw: string | null | undefined,
): string {
  return splitMaterialIssueRemarksForDisplay(raw).prose;
}

/** True when raw text still contains a BidSphere machine tag. */
export function hasMaterialIssueMachineTags(
  raw: string | null | undefined,
): boolean {
  return Boolean(
    extractBidSphereJsonTag(raw, "MaterialIssue") ||
      extractBidSphereJsonTag(raw, "ForwardedItems") ||
      extractBidSphereJsonTag(raw, "MIR"),
  );
}

/**
 * Parses full structured warehouse processing information from remarks or receipt object.
 * Converts raw JSON or machine data into clean human-readable UI fields.
 */
export function parseStructuredWarehouseProcessing(
  rawRemarks: string | null | undefined,
  receipt?: MaterialIssueReceipt | null,
): StructuredWarehouseProcessing {
  const display = splitMaterialIssueRemarksForDisplay(rawRemarks);
  const audit = display.audit;

  // Look for MIR sidecar in remarks
  let sidecar: Partial<MaterialIssueReceiptSidecar> | null = null;
  const mirTag = extractBidSphereJsonTag(rawRemarks, "MIR");
  if (mirTag) {
    try {
      sidecar = JSON.parse(mirTag.json);
    } catch {
      // Ignore
    }
  }
  if (!sidecar) {
    sidecar = safeParseJson(rawRemarks || "") as Partial<MaterialIssueReceiptSidecar> | null;
  }

  const issueNumber = receipt?.issue_number || sidecar?.issue_number || "";
  const stockEntry = receipt?.stock_entry || sidecar?.stock_entry || "";
  const warehouse = receipt?.warehouse || sidecar?.warehouse || audit.warehouse || "";
  const receivedBy = receipt?.received_by || sidecar?.received_by || audit.receiver || "";
  const issueType = receipt?.issue_type || sidecar?.issue_type || audit.issue_type || "Full Issue";
  const rawIssueDate = receipt?.issue_date || sidecar?.issue_date || audit.created_at;
  const issueDate = rawIssueDate ? formatDate(rawIssueDate) : "—";

  const rawAcceptanceDate =
    receipt?.confirmed_at ||
    receipt?.department_signature?.signed_at ||
    sidecar?.confirmed_at ||
    sidecar?.department_signed_at;
  const acceptanceDate = rawAcceptanceDate ? formatDate(rawAcceptanceDate) : "—";

  const isConfirmed =
    receipt?.status === "Confirmed" ||
    sidecar?.status === "Confirmed" ||
    Boolean(receipt?.department_signature || sidecar?.department_signer || sidecar?.department_signed_at);

  const isRejected =
    receipt?.status === "Acceptance Rejected" ||
    sidecar?.status === "Acceptance Rejected";

  const departmentAcceptance = isConfirmed
    ? "Confirmed"
    : isRejected
      ? "Rejected"
      : "Pending";

  const status = isConfirmed ? "Received" : isRejected ? "Rejected" : "Issued";

  const checklist: MaterialIssueAcceptanceChecklist | null =
    receipt?.acceptance_checklist ||
    (sidecar as any)?.acceptance_checklist ||
    (isConfirmed
      ? {
          quantity_verified: true,
          material_good_condition: true,
          packaging_verified: true,
          no_visible_damage: true,
        }
      : null);

  const humanRemarks = sanitizeHumanRemarks(rawRemarks) || (receipt?.remarks ? sanitizeHumanRemarks(receipt.remarks) : "");

  const hasData = Boolean(
    issueNumber ||
      stockEntry ||
      warehouse ||
      receipt?.warehouse_signature ||
      sidecar?.warehouse_signer ||
      isConfirmed,
  );

  return {
    hasData,
    status,
    issueNumber: issueNumber || "—",
    stockEntry: stockEntry || "—",
    warehouse: warehouse || "—",
    receivedBy: receivedBy || "—",
    issueType: issueType || "—",
    issueDate,
    departmentAcceptance,
    acceptanceDate,
    acceptanceChecklist: checklist,
    humanRemarks: humanRemarks.trim(),
    audit: {
      ...audit,
      document_version: receipt?.document_version || sidecar?.document_version || audit.document_version || "1.0",
      created_at: receipt?.created_at ? formatDateTime(receipt.created_at) : audit.created_at ? formatDateTime(audit.created_at) : undefined,
      modified_at: receipt?.modified ? formatDateTime(receipt.modified) : sidecar?.modified ? formatDateTime(sidecar.modified) : undefined,
      warehouse_signer: receipt?.warehouse_signature?.signer_name || sidecar?.warehouse_signer || audit.warehouse_signer || audit.created_by,
      warehouse_signed_at: receipt?.warehouse_signed_at ? formatDateTime(receipt.warehouse_signed_at) : sidecar?.warehouse_signed_at ? formatDateTime(sidecar.warehouse_signed_at) : undefined,
      department_signer: receipt?.department_signature?.signer_name || sidecar?.department_signer || audit.department_signer,
      department_signed_at: receipt?.department_signed_at ? formatDateTime(receipt.department_signed_at) : sidecar?.department_signed_at ? formatDateTime(sidecar.department_signed_at) : undefined,
      document_hash: receipt?.document_hash || sidecar?.document_hash || audit.document_hash,
      verification_token: receipt?.verification_token || sidecar?.verification_token || audit.verification_token,
      warehouse_sha256: receipt?.warehouse_signature?.sha256_hash || sidecar?.warehouse_sha256 || audit.warehouse_sha256,
      department_sha256: receipt?.department_signature?.sha256_hash || sidecar?.department_sha256 || audit.department_sha256,
    },
  };
}
