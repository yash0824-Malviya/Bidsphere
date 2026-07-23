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
} from "./warehouseIssueFulfillmentSync";

export type MaterialIssueDisplayAudit = {
  created_by?: string;
  created_at?: string;
  warehouse?: string;
  browser?: string;
  device?: string;
  user_agent?: string;
  request_id?: string;
  issue_type?: string;
  receiver?: string;
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

const MACHINE_LINE_RE =
  /^\[BidSphere:|^\s*[{[]|^\s*"(audit|browser|device|lines|issue_type|receiver|forwarded)/i;

function isMachineLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (MACHINE_LINE_RE.test(t)) return true;
  if (t.includes('"sha256"') || t.includes('"verification_token"')) return true;
  if (/BidSphere:(MaterialIssue|ForwardedItems|MIR):/.test(t)) return true;
  return false;
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
  const tags = extractWarehouseMachineTags(raw);
  const issue = parseMaterialIssueJsonFromRemarks(raw);
  const forwarded = parseForwardedItemsJsonFromRemarks(raw);
  const auditMeta = (issue?.audit || {}) as Record<string, unknown>;

  const bullets = proseLines(tags.prose);

  // Derive enterprise summary bullets when user prose is thin.
  const issueType = String(issue?.issue_type || "").trim();
  const receiver = String(issue?.receiver || "").trim();
  const lines =
    opts?.items?.length
      ? opts.items
      : (issue?.lines || []).map((l) => ({
          item_code: l.item_code,
          item_name: l.item_code,
          requested_qty: Number(l.required_qty) || 0,
          issued_qty: Number(l.issue_qty) || 0,
          remaining_qty: Number(l.remaining_qty) || 0,
          uom: "Nos",
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
    created_by: String(auditMeta.created_by || "") || undefined,
    created_at: String(auditMeta.issue_time || "") || undefined,
    warehouse: String(auditMeta.warehouse || "") || undefined,
    browser: String(auditMeta.browser || "") || undefined,
    device: String(auditMeta.device || "") || undefined,
    user_agent:
      String(auditMeta.user_agent || auditMeta.userAgent || "") || undefined,
    request_id:
      String(auditMeta.request_id || auditMeta.requestId || "") || undefined,
    issue_type: issueType || undefined,
    receiver: receiver || undefined,
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
        audit.issue_type,
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
