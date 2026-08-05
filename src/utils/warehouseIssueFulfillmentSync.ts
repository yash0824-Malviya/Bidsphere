/**
 * Warehouse ↔ Department fulfillment sync helpers.
 * Keeps Issued / Remaining / Procurement quantities aligned after Material Issue
 * and persists Material Issue Receipt sidecars on MR remarks for cross-user sync.
 */

type WarehouseTagKind = "ForwardedItems" | "MaterialIssue" | "MIR" | "StockDecisions";

/**
 * Extract a BidSphere machine tag whose payload is nested JSON.
 * Must use balanced brackets — non-greedy regex truncates at the first
 * `]` / `}` inside items[] / audit{}, which breaks Department hydration.
 */
export function extractBidSphereJsonTag(
  remarks: string | null | undefined,
  kind: WarehouseTagKind,
): { fullTag: string; json: string } | null {
  const raw = String(remarks || "");
  const prefix = `[BidSphere:${kind}:`;
  const start = raw.indexOf(prefix);
  if (start < 0) return null;

  const payloadStart = start + prefix.length;
  const open = raw[payloadStart];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = payloadStart; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        if (raw[i + 1] !== "]") return null;
        const json = raw.slice(payloadStart, i + 1);
        const fullTag = raw.slice(start, i + 2);
        return { fullTag, json };
      }
    }
  }
  return null;
}

function stripBidSphereJsonTag(
  remarks: string,
  kind: WarehouseTagKind,
): string {
  const hit = extractBidSphereJsonTag(remarks, kind);
  if (!hit) return remarks;
  return remarks.replace(hit.fullTag, "");
}

export type IssuedLineQty = {
  item_code: string;
  issued_qty: number;
  required_qty?: number;
};

/** Compact receipt persisted on Material Request remarks (no large data-URLs). */
export type MaterialIssueReceiptSidecar = {
  id: string;
  issue_number: string;
  stock_entry: string;
  mr_name: string;
  department: string;
  company?: string;
  warehouse: string;
  issue_date: string;
  issued_by: string;
  received_by: string;
  issue_type: string;
  remarks?: string;
  status: string;
  items: Array<{
    item_code: string;
    item_name: string;
    uom: string;
    requested_qty: number;
    issued_qty: number;
    remaining_qty: number;
  }>;
  document_hash: string;
  document_version: string;
  verification_token: string;
  created_at: string;
  modified: string;
  confirmed_at?: string;
  warehouse_signed_at?: string;
  department_signed_at?: string;
  warehouse_signer?: string;
  warehouse_sha256?: string;
  department_signer?: string;
  department_sha256?: string;
  department_remarks?: string;
  rejection_reason?: string;
  rejected_at?: string;
  rejected_by?: string;
  /** Frozen warehouse business payload for dual-signature integrity. */
  business_snapshot?: {
    issue_number: string;
    mr_name: string;
    company: string;
    warehouse: string;
    received_by: string;
    issue_type: string;
    issue_date: string;
    items: Array<{
      item_code: string;
      requested_qty: number;
      issued_qty: number;
      remaining_qty: number;
    }>;
  };
  acceptance_checklist?: {
    quantity_verified: boolean;
    material_good_condition: boolean;
    packaging_verified: boolean;
    no_visible_damage: boolean;
  };
};

/** Extract machine-readable tags from warehouse remarks so prose updates don't wipe them. */
export function extractWarehouseMachineTags(remarks: string | null | undefined): {
  forwardedTag: string | null;
  materialIssueTag: string | null;
  mirTag: string | null;
  prose: string;
} {
  const raw = String(remarks || "");
  const fwd = extractBidSphereJsonTag(raw, "ForwardedItems");
  const mi = extractBidSphereJsonTag(raw, "MaterialIssue");
  const mir = extractBidSphereJsonTag(raw, "MIR");
  const prose = stripBidSphereJsonTag(
    stripBidSphereJsonTag(
      stripBidSphereJsonTag(
        stripBidSphereJsonTag(raw, "ForwardedItems"),
        "MaterialIssue",
      ),
      "MIR",
    ),
    "StockDecisions",
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    forwardedTag: fwd?.fullTag ?? null,
    materialIssueTag: mi?.fullTag ?? null,
    mirTag: mir?.fullTag ?? null,
    prose,
  };
}

/** Rebuild remarks: human prose + preserved / updated machine tags. */
export function composeWarehouseRemarks(
  prose: string,
  tags: {
    forwardedTag?: string | null;
    materialIssueTag?: string | null;
    mirTag?: string | null;
  },
): string {
  return [
    prose.trim(),
    tags.materialIssueTag,
    tags.forwardedTag,
    tags.mirTag,
  ]
    .filter(Boolean)
    .join("\n");
}

type ForwardedLite = {
  item_code: string;
  item_name?: string;
  uom?: string;
  warehouse?: string;
  requested_qty?: number;
  available_qty?: number;
  shortage_qty?: number;
  issue_qty?: number;
  issued_qty?: number;
  forward_qty?: number;
  status?: string;
};

export function parseMirSidecarsFromRemarks(
  remarks: string | null | undefined,
): MaterialIssueReceiptSidecar[] {
  const hit = extractBidSphereJsonTag(remarks, "MIR");
  if (!hit) return [];
  try {
    const parsed = JSON.parse(hit.json) as MaterialIssueReceiptSidecar[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Parse ForwardedItems snapshot from MR remarks (balanced JSON). */
export function parseForwardedItemsJsonFromRemarks(
  remarks: string | null | undefined,
): ForwardedLite[] {
  const hit = extractBidSphereJsonTag(remarks, "ForwardedItems");
  if (!hit) return [];
  try {
    const parsed = JSON.parse(hit.json) as ForwardedLite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Parse MaterialIssue audit payload from remarks (balanced JSON). */
export function parseMaterialIssueJsonFromRemarks(
  remarks: string | null | undefined,
): {
  issue_type?: string;
  receiver?: string;
  audit?: Record<string, unknown>;
  lines?: Array<{
    item_code: string;
    required_qty?: number;
    issue_qty?: number;
    remaining_qty?: number;
  }>;
} | null {
  const hit = extractBidSphereJsonTag(remarks, "MaterialIssue");
  if (!hit) return null;
  try {
    return JSON.parse(hit.json) as {
      issue_type?: string;
      receiver?: string;
      audit?: Record<string, unknown>;
      lines?: Array<{
        item_code: string;
        required_qty?: number;
        issue_qty?: number;
        remaining_qty?: number;
      }>;
    };
  } catch {
    return null;
  }
}

export function formatMirSidecarTag(
  receipts: MaterialIssueReceiptSidecar[],
): string {
  return `[BidSphere:MIR:${JSON.stringify(receipts)}]`;
}

/**
 * Upsert one receipt into the MIR tag array (by issue_number / stock_entry).
 */
export function upsertMirSidecarInRemarks(
  remarks: string | null | undefined,
  sidecar: MaterialIssueReceiptSidecar,
): string {
  const tags = extractWarehouseMachineTags(remarks);
  const existing = parseMirSidecarsFromRemarks(remarks);
  const key = sidecar.issue_number || sidecar.stock_entry;
  const next = [
    sidecar,
    ...existing.filter(
      (r) =>
        r.issue_number !== key &&
        r.stock_entry !== sidecar.stock_entry &&
        r.id !== sidecar.id,
    ),
  ].slice(0, 20);
  return composeWarehouseRemarks(tags.prose, {
    materialIssueTag: tags.materialIssueTag,
    forwardedTag: tags.forwardedTag,
    mirTag: formatMirSidecarTag(next),
  });
}

/**
 * Merge issued quantities into a ForwardedItems snapshot.
 * Issued lines reduce procurement (forward_qty); fully issued → forward_qty = 0.
 */
export function mergeIssuedIntoForwardedItems(
  existing: ForwardedLite[],
  issuedLines: IssuedLineQty[],
  opts?: { warehouse?: string },
): ForwardedLite[] {
  const byCode = new Map(existing.map((d) => [d.item_code, { ...d }]));

  for (const line of issuedLines) {
    const code = String(line.item_code || "").trim();
    if (!code) continue;
    const issued = Math.max(0, Number(line.issued_qty) || 0);
    const prev = byCode.get(code);
    const requested = Math.max(
      0,
      Number(line.required_qty) || Number(prev?.requested_qty) || issued,
    );
    const prevIssued = Math.max(
      0,
      Number(prev?.issued_qty ?? prev?.issue_qty) || 0,
    );
    const nextIssued = Math.min(requested, Math.max(prevIssued, issued));
    const remaining = Math.max(0, requested - nextIssued);
    const prevForward = Math.max(
      0,
      Number(prev?.forward_qty ?? prev?.shortage_qty) || 0,
    );
    const forward = Math.min(prevForward > 0 ? prevForward : remaining, remaining);

    byCode.set(code, {
      item_code: code,
      item_name: prev?.item_name || code,
      uom: prev?.uom || "Nos",
      warehouse: opts?.warehouse || prev?.warehouse || "",
      requested_qty: requested,
      available_qty: prev?.available_qty ?? nextIssued,
      shortage_qty: remaining,
      issue_qty: nextIssued,
      issued_qty: nextIssued,
      forward_qty: forward,
      status:
        nextIssued >= requested && requested > 0
          ? "Issued"
          : nextIssued > 0
            ? "Partially Issued"
            : forward > 0
              ? "Forwarded to Procurement"
              : prev?.status || "Pending Review",
    });
  }

  if (byCode.size === 0) {
    for (const line of issuedLines) {
      const code = String(line.item_code || "").trim();
      if (!code) continue;
      const issued = Math.max(0, Number(line.issued_qty) || 0);
      const requested = Math.max(0, Number(line.required_qty) || issued);
      const remaining = Math.max(0, requested - issued);
      byCode.set(code, {
        item_code: code,
        item_name: code,
        uom: "Nos",
        warehouse: opts?.warehouse || "",
        requested_qty: requested,
        available_qty: issued,
        shortage_qty: remaining,
        issue_qty: issued,
        issued_qty: issued,
        forward_qty: 0,
        status: remaining <= 0 ? "Issued" : "Partially Issued",
      });
    }
  }

  return Array.from(byCode.values());
}

export function formatForwardedItemsTag(items: ForwardedLite[]): string {
  return `[BidSphere:ForwardedItems:${JSON.stringify(items)}]`;
}

/** Issued qty per item_code from Material Issue Receipts in localStorage. */
export function issuedQtyByItemFromReceipts(
  mrName: string,
): Map<string, number> {
  const out = new Map<string, number>();
  const name = String(mrName || "").trim();
  if (!name || typeof localStorage === "undefined") return out;
  try {
    const raw = localStorage.getItem("bidsphere:material-issue-receipts");
    if (!raw) return out;
    const map = JSON.parse(raw) as Record<
      string,
      {
        mr_name?: string;
        status?: string;
        items?: Array<{ item_code?: string; issued_qty?: number }>;
      }
    >;
    for (const r of Object.values(map || {})) {
      if (r.mr_name !== name) continue;
      if (r.status === "Acceptance Rejected") continue;
      for (const it of r.items || []) {
        const code = String(it.item_code || "").trim();
        if (!code) continue;
        const q = Math.max(0, Number(it.issued_qty) || 0);
        out.set(code, Math.max(out.get(code) || 0, q));
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Issued qty from `[BidSphere:MaterialIssue:…]` tag. */
export function issuedQtyByItemFromMaterialIssueTag(
  remarks: string | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  const parsed = parseMaterialIssueJsonFromRemarks(remarks);
  if (!parsed) return out;
  for (const l of parsed.lines || []) {
    const code = String(l.item_code || "").trim();
    if (!code) continue;
    out.set(code, Math.max(out.get(code) || 0, Number(l.issue_qty) || 0));
  }
  return out;
}

/** Issued qty from MIR sidecars on remarks (cross-user). */
export function issuedQtyByItemFromMirRemarks(
  remarks: string | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of parseMirSidecarsFromRemarks(remarks)) {
    if (r.status === "Acceptance Rejected") continue;
    for (const it of r.items || []) {
      const code = String(it.item_code || "").trim();
      if (!code) continue;
      out.set(code, Math.max(out.get(code) || 0, Number(it.issued_qty) || 0));
    }
  }
  return out;
}

/**
 * Resolve department-facing MR status from remarks + ERP base status.
 * Used when localStorage receipts are empty (other browser / user).
 */
export function resolveIssueAcceptanceDisplayStatus(
  baseStatus: string,
  remarks: string | null | undefined,
): string {
  const st = String(baseStatus || "").trim();
  const mirs = parseMirSidecarsFromRemarks(remarks);
  const openMir = mirs.filter(
    (r) =>
      r.status === "Pending Department Acceptance" ||
      r.status === "Waiting Warehouse Signature",
  );
  const confirmedAll =
    mirs.length > 0 && mirs.every((r) => r.status === "Confirmed");

  if (confirmedAll && st === "Completed") return "Completed";
  if (openMir.length > 0) return "Pending Department Acceptance";

  // Derive from ForwardedItems / MaterialIssue when MIR missing (legacy).
  const fwdRows = parseForwardedItemsJsonFromRemarks(remarks);
  let totalRequested = 0;
  let totalIssued = 0;
  let totalForward = 0;
  for (const row of fwdRows) {
    const req = Math.max(0, Number(row.requested_qty) || 0);
    const iss = Math.max(0, Number(row.issued_qty ?? row.issue_qty) || 0);
    const fwd = Math.max(0, Number(row.forward_qty ?? row.shortage_qty) || 0);
    totalRequested += req;
    totalIssued += iss;
    totalForward += fwd;
  }
  const fromIssue = issuedQtyByItemFromMaterialIssueTag(remarks);
  for (const q of fromIssue.values()) totalIssued = Math.max(totalIssued, q);

  if (totalIssued > 0 && totalForward <= 0 && totalRequested > 0) {
    if (
      st === "Forwarded to Procurement" ||
      st === "Material Issued" ||
      st === "Pending Department Acceptance" ||
      st === "Stock Available" ||
      st === "RFQ Created" ||
      !st
    ) {
      return "Pending Department Acceptance";
    }
  }
  if (totalIssued > 0 && totalForward > 0) {
    return "Partially Issued";
  }
  if (
    totalIssued <= 0 &&
    (st === "Forwarded to Procurement" || st === "RFQ Created")
  ) {
    return "Forwarded to Procurement";
  }

  return st;
}
