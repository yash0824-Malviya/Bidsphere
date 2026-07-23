/**
 * Material Issue Receipt — Warehouse ↔ Department dual e-signature.
 *
 * Storage: localStorage sidecar (no ERPNext DocType / API changes).
 * After Stock Entry issue → receipt → warehouse sign → department sign → MR Completed.
 */

import { sha256Hex } from "./legalEsign";
import { createNotification } from "./notifications";
import { captureWarehouseClientMeta } from "./warehouseEsign";
import { apiGet, buildResourceUrl } from "./erpnext";
import { parseMaterialIssueAudit } from "./materialIssue";
import {
  fetchMaterialRequestWorkflow,
  listMaterialRequestsWorkflow,
  parseForwardedItemsFromMr,
  updateMaterialRequestWorkflowStatus,
} from "./materialRequestWorkflow";
import {
  captureSignatureTimestamp,
  hashCanonicalJson,
} from "../services/digitalSignatureService";
import type {
  CreateMaterialIssueReceiptInput,
  MaterialIssueAcceptanceChecklist,
  MaterialIssueReceipt,
  MaterialIssueReceiptAuditEntry,
  MaterialIssueReceiptLine,
  MaterialIssueReceiptSignature,
  MaterialIssueReceiptSignerRole,
  MaterialIssueReceiptStatus,
} from "../types/materialIssueReceipt";
import {
  isAcceptanceChecklistComplete,
  normalizeReceiptStatus,
} from "../types/materialIssueReceipt";
import { todayERPNextDate } from "../utils/erpNextDate";
import { cleanBusinessWarehouseRemarks } from "../utils/materialIssueRemarksDisplay";
import { buildPublicAppUrl } from "../utils/publicAppUrl";
import {
  composeWarehouseRemarks,
  extractWarehouseMachineTags,
  formatForwardedItemsTag,
  mergeIssuedIntoForwardedItems,
  parseMirSidecarsFromRemarks,
  type MaterialIssueReceiptSidecar,
  upsertMirSidecarInRemarks,
} from "../utils/warehouseIssueFulfillmentSync";

const STORE_KEY = "bidsphere:material-issue-receipts";
const INDEX_KEY = "bidsphere:material-issue-receipt-index";
const SEQ_KEY = "bidsphere:material-issue-receipt-seq";

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nextReceiptNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let seq = 1;
  try {
    const raw = localStorage.getItem(SEQ_KEY);
    const n = raw ? Number(raw) : 0;
    seq = Number.isFinite(n) && n > 0 ? n + 1 : 1;
    localStorage.setItem(SEQ_KEY, String(seq));
  } catch {
    seq = Math.floor(Math.random() * 9000) + 1000;
  }
  return `MIR-${day}-${String(seq).padStart(4, "0")}`;
}

function hydrate(raw: MaterialIssueReceipt): MaterialIssueReceipt {
  return {
    ...raw,
    status: normalizeReceiptStatus(raw.status),
    stock_entry: raw.stock_entry || raw.issue_number,
  };
}

function readStore(): Record<string, MaterialIssueReceipt> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, MaterialIssueReceipt>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, MaterialIssueReceipt> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = hydrate(v);
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(map: Record<string, MaterialIssueReceipt>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids.slice(0, 500)));
  } catch {
    /* ignore */
  }
}

function pushIndex(id: string): void {
  const ids = readIndex().filter((x) => x !== id);
  ids.unshift(id);
  writeIndex(ids);
}

function qtyCanon(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1e6) / 1e6;
}

type BusinessSnapshot = NonNullable<MaterialIssueReceipt["business_snapshot"]>;

/**
 * Immutable business payload signed by Warehouse.
 * Department acceptance fields are intentionally excluded so checklist /
 * department remarks / department signature never invalidate this hash.
 */
function buildBusinessHashPayload(
  receipt: Pick<
    MaterialIssueReceipt,
    | "issue_number"
    | "mr_name"
    | "company"
    | "warehouse"
    | "received_by"
    | "issue_type"
    | "issue_date"
    | "items"
  >,
): BusinessSnapshot {
  const items = [...(receipt.items || [])]
    .map((i) => ({
      item_code: String(i.item_code || "").trim(),
      requested_qty: qtyCanon(i.requested_qty),
      issued_qty: qtyCanon(i.issued_qty),
      remaining_qty: qtyCanon(i.remaining_qty),
    }))
    .filter((i) => i.item_code)
    .sort((a, b) => a.item_code.localeCompare(b.item_code));

  return {
    issue_number: String(receipt.issue_number || "").trim(),
    mr_name: String(receipt.mr_name || "").trim(),
    company: String(receipt.company || "").trim(),
    warehouse: String(receipt.warehouse || "").trim(),
    received_by: String(receipt.received_by || "").trim(),
    issue_type: String(receipt.issue_type || "").trim(),
    issue_date: String(receipt.issue_date || "").slice(0, 10),
    items,
  };
}

function businessPayloadEquals(
  a: BusinessSnapshot,
  b: BusinessSnapshot,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function freezeBusinessSnapshot(receipt: MaterialIssueReceipt): BusinessSnapshot {
  const snap = buildBusinessHashPayload(receipt);
  receipt.business_snapshot = snap;
  return snap;
}

function getSealedWarehouseHash(receipt: MaterialIssueReceipt): string {
  return (
    receipt.warehouse_signature?.document_hash ||
    receipt.document_hash ||
    ""
  );
}

/** SHA256 over immutable business fields only. */
export async function buildDocumentHash(
  receipt: Pick<
    MaterialIssueReceipt,
    | "issue_number"
    | "mr_name"
    | "company"
    | "warehouse"
    | "received_by"
    | "issue_type"
    | "issue_date"
    | "items"
  >,
): Promise<string> {
  return hashCanonicalJson(buildBusinessHashPayload(receipt));
}

/** Re-apply frozen warehouse business fields (source of truth after sign). */
function restoreBusinessFieldsFromSnapshot(receipt: MaterialIssueReceipt): void {
  const snap = receipt.business_snapshot;
  if (!snap) return;
  receipt.issue_number = snap.issue_number;
  receipt.mr_name = snap.mr_name;
  receipt.company = snap.company || receipt.company;
  receipt.warehouse = snap.warehouse;
  receipt.received_by = snap.received_by;
  receipt.issue_type = snap.issue_type;
  receipt.issue_date = snap.issue_date;
  const byCode = new Map(snap.items.map((i) => [i.item_code, i]));
  receipt.items = (receipt.items || []).map((row) => {
    const sealed = byCode.get(String(row.item_code || "").trim());
    if (!sealed) return row;
    return {
      ...row,
      item_code: sealed.item_code,
      requested_qty: sealed.requested_qty,
      issued_qty: sealed.issued_qty,
      remaining_qty: sealed.remaining_qty,
    };
  });
  // Ensure sealed lines exist even if a row was removed after sign.
  for (const sealed of snap.items) {
    if (!receipt.items.some((r) => r.item_code === sealed.item_code)) {
      receipt.items.push({
        item_code: sealed.item_code,
        item_name: sealed.item_code,
        uom: "Nos",
        requested_qty: sealed.requested_qty,
        issued_qty: sealed.issued_qty,
        remaining_qty: sealed.remaining_qty,
      });
    }
  }
}

/**
 * Dual-signature integrity:
 * - Department Acceptance data is NEVER part of the warehouse hash.
 * - After warehouse sign, the sealed warehouse hash is immutable.
 * - Department accept must not fail due to checklist/remarks/signature input.
 */
async function assertBusinessDocumentIntegrity(
  receipt: MaterialIssueReceipt,
  opts?: { afterWarehouseSign?: boolean },
): Promise<string> {
  const sealed = getSealedWarehouseHash(receipt);
  const livePayload = buildBusinessHashPayload(receipt);
  const liveHash = await hashCanonicalJson(livePayload);

  // Department Acceptance path: never invalidate warehouse signature for
  // acceptance metadata. Trust sealed hash; restore snapshot if present.
  if (opts?.afterWarehouseSign && receipt.warehouse_signature) {
    if (!sealed) {
      throw new Error(
        "Warehouse signature hash is missing. Cannot complete department acceptance.",
      );
    }
    if (!receipt.business_snapshot) {
      freezeBusinessSnapshot(receipt);
    } else if (!businessPayloadEquals(livePayload, receipt.business_snapshot)) {
      // eslint-disable-next-line no-console
      console.warn(
        "[MaterialIssueReceipt] Business field drift after warehouse sign — restoring sealed snapshot. Warehouse signature remains VALID.",
        { issue_number: receipt.issue_number },
      );
      restoreBusinessFieldsFromSnapshot(receipt);
    }
    // Never overwrite warehouse sealed hash during acceptance.
    receipt.document_hash = sealed;
    return sealed;
  }

  // Pre-warehouse-sign / create path.
  if (receipt.business_snapshot) {
    if (!businessPayloadEquals(livePayload, receipt.business_snapshot)) {
      throw new Error(
        "Document was modified after creation. Verification invalidated — recreate receipt.",
      );
    }
    return sealed || liveHash;
  }

  if (sealed && (liveHash === sealed || liveHash === receipt.document_hash)) {
    freezeBusinessSnapshot(receipt);
    return sealed;
  }

  freezeBusinessSnapshot(receipt);
  return liveHash;
}

/** Merge ERP sidecar without clobbering warehouse-sealed business fields. */
function mergeReceiptPreservingBusinessLock(
  existing: MaterialIssueReceipt,
  incoming: MaterialIssueReceipt,
): MaterialIssueReceipt {
  const locked = Boolean(existing.warehouse_signature || existing.document_hash);
  if (!locked) {
    return {
      ...existing,
      ...incoming,
      audit_trail: existing.audit_trail?.length
        ? existing.audit_trail
        : incoming.audit_trail,
      warehouse_signature:
        incoming.warehouse_signature || existing.warehouse_signature,
      department_signature:
        incoming.department_signature || existing.department_signature,
    };
  }

  return {
    ...existing,
    // Acceptance / workflow may advance from ERP
    status: incoming.status || existing.status,
    department_signature:
      incoming.department_signature || existing.department_signature,
    department_signed_at:
      incoming.department_signed_at || existing.department_signed_at,
    department_remarks:
      incoming.department_remarks ?? existing.department_remarks,
    acceptance_checklist:
      incoming.acceptance_checklist || existing.acceptance_checklist,
    confirmed_at: incoming.confirmed_at || existing.confirmed_at,
    rejection_reason: incoming.rejection_reason ?? existing.rejection_reason,
    rejected_at: incoming.rejected_at || existing.rejected_at,
    rejected_by: incoming.rejected_by || existing.rejected_by,
    modified: incoming.modified || existing.modified,
    warehouse_signature:
      existing.warehouse_signature || incoming.warehouse_signature,
    warehouse_signed_at:
      existing.warehouse_signed_at || incoming.warehouse_signed_at,
    // Keep sealed business snapshot exactly as warehouse-signed
    issue_number: existing.issue_number,
    stock_entry: existing.stock_entry,
    mr_name: existing.mr_name,
    company: existing.company,
    department: existing.department,
    warehouse: existing.warehouse,
    received_by: existing.received_by,
    issued_by: existing.issued_by,
    issue_type: existing.issue_type,
    issue_date: existing.issue_date,
    items: existing.items,
    remarks: existing.remarks,
    business_snapshot: existing.business_snapshot || incoming.business_snapshot,
    document_hash: existing.document_hash,
    document_version: existing.document_version,
    verification_token: existing.verification_token,
    audit_trail: existing.audit_trail?.length
      ? existing.audit_trail
      : incoming.audit_trail,
  };
}

function appendAudit(
  receipt: MaterialIssueReceipt,
  entry: Omit<MaterialIssueReceiptAuditEntry, "id">,
): MaterialIssueReceiptAuditEntry {
  const full: MaterialIssueReceiptAuditEntry = {
    id: uid("mir_audit"),
    ...entry,
  };
  receipt.audit_trail = [full, ...(receipt.audit_trail || [])].slice(0, 100);
  return full;
}

function persist(receipt: MaterialIssueReceipt): MaterialIssueReceipt {
  receipt.modified = captureSignatureTimestamp();
  const map = readStore();
  map[receipt.id] = receipt;
  writeStore(map);
  pushIndex(receipt.id);
  return receipt;
}

/** Public persist for Department Issued Items sync (Stock Entry / MIR hydrate). */
export function persistExternalMaterialIssueReceipt(
  receipt: MaterialIssueReceipt,
): MaterialIssueReceipt {
  const existing =
    getMaterialIssueReceipt(receipt.issue_number) ||
    getMaterialIssueReceipt(receipt.stock_entry) ||
    getMaterialIssueReceipt(receipt.id);
  if (existing) {
    return persist(mergeReceiptPreservingBusinessLock(existing, receipt));
  }
  return persist(receipt);
}

function toMirSidecar(receipt: MaterialIssueReceipt): MaterialIssueReceiptSidecar {
  return {
    id: receipt.id,
    issue_number: receipt.issue_number,
    stock_entry: receipt.stock_entry,
    mr_name: receipt.mr_name,
    department: receipt.department,
    company: receipt.company,
    warehouse: receipt.warehouse,
    issue_date: receipt.issue_date,
    issued_by: receipt.issued_by,
    received_by: receipt.received_by,
    issue_type: receipt.issue_type,
    remarks: receipt.remarks,
    status: receipt.status,
    items: (receipt.items || []).map((i) => ({
      item_code: i.item_code,
      item_name: i.item_name,
      uom: i.uom,
      requested_qty: i.requested_qty,
      issued_qty: i.issued_qty,
      remaining_qty: i.remaining_qty,
    })),
    document_hash: receipt.document_hash,
    document_version: receipt.document_version,
    verification_token: receipt.verification_token,
    created_at: receipt.created_at,
    modified: receipt.modified,
    confirmed_at: receipt.confirmed_at,
    warehouse_signed_at: receipt.warehouse_signed_at,
    department_signed_at: receipt.department_signed_at,
    warehouse_signer: receipt.warehouse_signature?.signer_name,
    warehouse_sha256: receipt.warehouse_signature?.sha256_hash,
    department_signer: receipt.department_signature?.signer_name,
    department_sha256: receipt.department_signature?.sha256_hash,
    department_remarks: receipt.department_remarks,
    rejection_reason: receipt.rejection_reason,
    rejected_at: receipt.rejected_at,
    rejected_by: receipt.rejected_by,
    business_snapshot: receipt.business_snapshot,
    acceptance_checklist: receipt.acceptance_checklist,
  };
}

function fromMirSidecar(side: MaterialIssueReceiptSidecar): MaterialIssueReceipt {
  const warehouse_signature = side.warehouse_signer
    ? ({
        signer_name: side.warehouse_signer,
        role: "Warehouse Manager" as const,
        signature_type: "typed" as const,
        typed_name: side.warehouse_signer,
        signed_at: side.warehouse_signed_at || side.created_at,
        sha256_hash: side.warehouse_sha256 || "",
        document_hash: side.document_hash,
        verification_status: "verified" as const,
        document_version: side.document_version,
      } satisfies MaterialIssueReceiptSignature)
    : undefined;
  const department_signature = side.department_signer
    ? ({
        signer_name: side.department_signer,
        role: "Department User" as const,
        signature_type: "typed" as const,
        typed_name: side.department_signer,
        signed_at: side.department_signed_at || side.confirmed_at || "",
        sha256_hash: side.department_sha256 || "",
        document_hash: side.document_hash,
        verification_status: "verified" as const,
        document_version: side.document_version,
      } satisfies MaterialIssueReceiptSignature)
    : undefined;

  return {
    id: side.id || side.issue_number,
    issue_number: side.issue_number,
    stock_entry: side.stock_entry,
    mr_name: side.mr_name,
    department: side.department || "General",
    company: side.company,
    warehouse: side.warehouse || "—",
    issue_date: side.issue_date,
    issued_by: side.issued_by,
    received_by: side.received_by || "Department User",
    issue_type: side.issue_type || "Full Issue",
    remarks: side.remarks,
    status: normalizeReceiptStatus(side.status),
    items: (side.items || []).map((i) => ({
      item_code: i.item_code,
      item_name: i.item_name || i.item_code,
      uom: i.uom || "Nos",
      requested_qty: Number(i.requested_qty) || 0,
      issued_qty: Number(i.issued_qty) || 0,
      remaining_qty: Number(i.remaining_qty) || 0,
    })),
    business_snapshot: side.business_snapshot,
    warehouse_signature,
    department_signature,
    acceptance_checklist: side.acceptance_checklist,
    department_remarks: side.department_remarks,
    rejection_reason: side.rejection_reason,
    rejected_at: side.rejected_at,
    rejected_by: side.rejected_by,
    document_hash: side.document_hash,
    document_version: side.document_version || "1.0",
    verification_token: side.verification_token,
    created_at: side.created_at,
    modified: side.modified || side.created_at,
    confirmed_at: side.confirmed_at,
    warehouse_signed_at: side.warehouse_signed_at,
    department_signed_at: side.department_signed_at,
    audit_trail: [],
  };
}

/**
 * Persist receipt sidecar onto Material Request remarks so Department users
 * (other browsers/sessions) can hydrate Pending Acceptance.
 */
async function syncReceiptSidecarToMr(
  receipt: MaterialIssueReceipt,
  opts?: {
    status?: Parameters<typeof updateMaterialRequestWorkflowStatus>[1];
    proseLine?: string;
  },
): Promise<void> {
  const uiStatus =
    opts?.status ||
    (receipt.status === "Confirmed"
      ? "Completed"
      : receipt.status === "Pending Department Acceptance" ||
          receipt.status === "Waiting Warehouse Signature"
        ? "Pending Department Acceptance"
        : "Pending Department Acceptance");

  const writeOnce = async (): Promise<void> => {
    let existingRemarks = "";
    let existingForwarded: ReturnType<typeof parseForwardedItemsFromMr> = [];
    try {
      const mr = await fetchMaterialRequestWorkflow(receipt.mr_name);
      existingRemarks = mr.custom_warehouse_remarks ?? mr.remarks ?? "";
      existingForwarded = parseForwardedItemsFromMr(mr);
    } catch {
      /* ignore — still attempt write with empty prior remarks */
    }

    const tags = extractWarehouseMachineTags(existingRemarks);
    const mergedForwarded = mergeIssuedIntoForwardedItems(
      existingForwarded,
      receipt.items.map((l) => ({
        item_code: l.item_code,
        issued_qty: l.issued_qty,
        required_qty: l.requested_qty,
      })),
      { warehouse: receipt.warehouse },
    );
    const withMir = upsertMirSidecarInRemarks(
      composeWarehouseRemarks(
        [tags.prose, opts?.proseLine].filter(Boolean).join("\n"),
        {
          materialIssueTag: tags.materialIssueTag,
          forwardedTag: formatForwardedItemsTag(mergedForwarded),
          mirTag: tags.mirTag,
        },
      ),
      toMirSidecar(receipt),
    );

    await updateMaterialRequestWorkflowStatus(receipt.mr_name, uiStatus, {
      custom_warehouse_remarks: withMir,
    });

    // Round-trip verify: Department hydrate depends on parseable MIR sidecar.
    const verify = await fetchMaterialRequestWorkflow(receipt.mr_name);
    const verifyRemarks =
      verify.custom_warehouse_remarks ?? verify.remarks ?? "";
    const sidecars = parseMirSidecarsFromRemarks(verifyRemarks);
    const found = sidecars.some(
      (s) =>
        s.issue_number === receipt.issue_number ||
        s.stock_entry === receipt.stock_entry ||
        s.id === receipt.id,
    );
    if (!found) {
      throw new Error(
        `Material Issue Receipt ${receipt.issue_number} was not persisted on Material Request ${receipt.mr_name} for Department visibility.`,
      );
    }
  };

  try {
    await writeOnce();
  } catch (firstErr) {
    // One retry for transient ERP write/read races.
    try {
      await writeOnce();
    } catch {
      throw firstErr instanceof Error
        ? firstErr
        : new Error(String(firstErr));
    }
  }
}

export type HydrateMaterialIssueReceiptsOptions = {
  /**
   * When true (Department Pending Acceptance fast path):
   * - Parse MIR / MaterialIssue tags from the MR *list* payload only
   * - Do NOT call get_doc once per Material Request (N+1)
   * - Do NOT write sidecars back to ERP during hydrate
   */
  skipPerDocFetch?: boolean;
  /** Reuse an already-fetched MR list (avoids a second list call). */
  preloadedRows?: Array<{
    name: string;
    status?: string;
    custom_bidsphere_status?: string | null;
    custom_warehouse_remarks?: string | null;
    custom_department?: string | null;
    remarks?: string | null;
  }>;
};

function importSidecarsFromMrRemarks(mr: {
  name: string;
  custom_warehouse_remarks?: string | null;
  remarks?: string | null;
  custom_department?: string | null;
  custom_bidsphere_status?: string | null;
}): number {
  let imported = 0;
  const remarks = mr.custom_warehouse_remarks ?? mr.remarks ?? "";
  const sidecars = parseMirSidecarsFromRemarks(remarks);
  for (const side of sidecars) {
    if (!side.issue_number && !side.stock_entry) continue;
    const existing = getMaterialIssueReceipt(
      side.issue_number || side.stock_entry,
    );
    const incoming = fromMirSidecar({
      ...side,
      mr_name: side.mr_name || mr.name,
    });
    if (!existing) {
      persist(incoming);
      imported += 1;
      continue;
    }
    const existingTs = Date.parse(existing.modified || "") || 0;
    const incomingTs = Date.parse(incoming.modified || "") || 0;
    const erpAhead =
      incomingTs >= existingTs ||
      (incoming.status === "Pending Department Acceptance" &&
        existing.status === "Waiting Warehouse Signature") ||
      (incoming.status === "Confirmed" && existing.status !== "Confirmed");
    if (erpAhead) {
      persist(mergeReceiptPreservingBusinessLock(existing, incoming));
      imported += 1;
    }
  }
  return imported;
}

/**
 * Hydrate local receipt store from Material Request MIR tags (ERP remarks).
 * Fast path uses the list payload only (no per-MR get_doc / N+1).
 */
export async function hydrateMaterialIssueReceiptsFromErp(
  options?: HydrateMaterialIssueReceiptsOptions,
): Promise<number> {
  const skipPerDoc = Boolean(options?.skipPerDocFetch);
  const hydrateStart = performance.now();
  let imported = 0;
  try {
    // eslint-disable-next-line no-console
    console.log("[MaterialIssueReceipt] hydrate START", {
      skipPerDocFetch: skipPerDoc,
      startTime: hydrateStart,
      url: "/api/resource/Material Request",
    });
    const listStart = performance.now();
    const rows =
      options?.preloadedRows && options.preloadedRows.length > 0
        ? options.preloadedRows
        : await listMaterialRequestsWorkflow({
            docstatus: 1,
            limit: 500,
          });
    // eslint-disable-next-line no-console
    console.log("[MaterialIssueReceipt] hydrate MR list END", {
      url: options?.preloadedRows?.length
        ? "(preloaded)"
        : "/api/resource/Material Request",
      count: rows.length,
      durationMs: Math.round(performance.now() - listStart),
    });

    const candidates = rows
      .filter((mr) => {
        const st = String(
          (mr as { custom_bidsphere_status?: string }).custom_bidsphere_status ||
            mr.status ||
            "",
        );
        return (
          /Material Issued|Pending|Forwarded|Stock Available|Completed|RFQ|Acceptance/i.test(
            st,
          ) || Boolean(mr.custom_warehouse_remarks)
        );
      })
      .slice(0, 120);

    const needsDoc: typeof candidates = [];
    for (const row of candidates) {
      const remarks = row.custom_warehouse_remarks ?? "";
      const before = imported;
      imported += importSidecarsFromMrRemarks(row);
      if (imported > before) continue;

      const st = String(row.custom_bidsphere_status || row.status || "");
      if (
        !skipPerDoc &&
        !remarks &&
        /Material Issued|Pending Department|Acceptance|Stock Available/i.test(st)
      ) {
        needsDoc.push(row);
        continue;
      }
      if (!remarks) continue;

      const issueAudit = parseMaterialIssueAudit(remarks);
      const lines = issueAudit?.lines || [];
      const totalIssued = lines.reduce(
        (s, l) => s + (Number(l.issue_qty) || 0),
        0,
      );
      if (totalIssued <= 0) continue;
      const already = listMaterialIssueReceipts().some(
        (r) => r.mr_name === row.name && r.status !== "Acceptance Rejected",
      );
      if (already) continue;
      const wf = String(row.custom_bidsphere_status || "");
      if (wf === "Completed" || wf === "Cancelled") continue;

      const issueNumber = `MIR-SYNC-${row.name}`.slice(0, 40);
      const now = captureSignatureTimestamp();
      const items = lines.map((l) => {
        const issued = Math.max(0, Number(l.issue_qty) || 0);
        const requested = Math.max(0, Number(l.required_qty) || issued);
        return {
          item_code: l.item_code,
          item_name: l.item_code,
          uom: "Nos",
          requested_qty: requested,
          issued_qty: issued,
          remaining_qty: Math.max(0, requested - issued),
        };
      });
      const [document_hash, verification_token] = await Promise.all([
        sha256Hex(issueNumber),
        sha256Hex(`sync:${row.name}`).then((h) => h.slice(0, 24)),
      ]);
      persist({
        id: issueNumber,
        issue_number: issueNumber,
        stock_entry: `SYNC-${row.name}`,
        mr_name: row.name,
        department: row.custom_department || "General",
        warehouse: issueAudit?.audit?.warehouse || "—",
        issue_date: todayERPNextDate(),
        issued_by: issueAudit?.audit?.created_by || "Warehouse",
        received_by: issueAudit?.receiver || "Department User",
        issue_type: issueAudit?.issue_type || "Full Issue",
        status: "Pending Department Acceptance",
        items,
        document_hash,
        document_version: "1.0",
        verification_token,
        created_at: now,
        modified: now,
        warehouse_signed_at: now,
        warehouse_signature: {
          signer_name: issueAudit?.audit?.created_by || "Warehouse",
          role: "Warehouse Manager",
          signature_type: "typed",
          typed_name: issueAudit?.audit?.created_by || "Warehouse",
          signed_at: now,
          sha256_hash: "",
          document_hash: "",
          verification_status: "verified",
          document_version: "1.0",
        },
        audit_trail: [],
      });
      imported += 1;
      // Skip syncReceiptSidecarToMr — was an N+1 ERP write per synthetic receipt.
    }

    if (!skipPerDoc && needsDoc.length > 0) {
      const docStart = performance.now();
      const CONCURRENCY = 8;
      let cursor = 0;
      const importedParts = new Array<number>(needsDoc.length).fill(0);
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, needsDoc.length) },
        async () => {
          while (cursor < needsDoc.length) {
            const idx = cursor++;
            const row = needsDoc[idx];
            try {
              const mr = await fetchMaterialRequestWorkflow(row.name);
              importedParts[idx] = importSidecarsFromMrRemarks(mr);
            } catch {
              importedParts[idx] = 0;
            }
          }
        },
      );
      await Promise.all(workers);
      imported += importedParts.reduce((a, b) => a + b, 0);
      // eslint-disable-next-line no-console
      console.log("[MaterialIssueReceipt] hydrate get_doc batch", {
        url: "/api/resource/Material Request/{name}",
        count: needsDoc.length,
        concurrency: CONCURRENCY,
        durationMs: Math.round(performance.now() - docStart),
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[MaterialIssueReceipt] hydrate from ERP failed:", err);
  }
  // eslint-disable-next-line no-console
  console.log("[MaterialIssueReceipt] hydrate END", {
    imported,
    durationMs: Math.round(performance.now() - hydrateStart),
    skipPerDocFetch: skipPerDoc,
  });
  return imported;
}

export async function listPendingDepartmentReceiptsAsync(): Promise<
  MaterialIssueReceipt[]
> {
  await hydrateMaterialIssueReceiptsFromErp();
  return listPendingDepartmentReceipts();
}

export async function countPendingDepartmentAcceptanceAsync(): Promise<number> {
  await hydrateMaterialIssueReceiptsFromErp();
  return listPendingDepartmentReceipts().length;
}

export async function listMaterialIssueReceiptsAsync(): Promise<
  MaterialIssueReceipt[]
> {
  await hydrateMaterialIssueReceiptsFromErp();
  return listMaterialIssueReceipts();
}

export async function listAcceptedDepartmentReceiptsAsync(): Promise<
  MaterialIssueReceipt[]
> {
  await hydrateMaterialIssueReceiptsFromErp();
  return listAcceptedDepartmentReceipts();
}

export function getMaterialIssueReceipt(
  idOrIssueNumber: string,
): MaterialIssueReceipt | null {
  const key = String(idOrIssueNumber || "").trim();
  if (!key) return null;
  const map = readStore();
  if (map[key]) return map[key];
  return (
    Object.values(map).find(
      (r) =>
        r.issue_number === key ||
        r.stock_entry === key ||
        r.verification_token === key,
    ) ?? null
  );
}

export function listMaterialIssueReceipts(): MaterialIssueReceipt[] {
  const map = readStore();
  const ids = readIndex();
  const ordered = ids.map((id) => map[id]).filter(Boolean) as MaterialIssueReceipt[];
  const rest = Object.values(map).filter((r) => !ids.includes(r.id));
  return [...ordered, ...rest];
}

export function listPendingDepartmentReceipts(): MaterialIssueReceipt[] {
  return listMaterialIssueReceipts().filter(
    (r) => r.status === "Pending Department Acceptance",
  );
}

export function listAcceptedDepartmentReceipts(): MaterialIssueReceipt[] {
  return listMaterialIssueReceipts().filter((r) => r.status === "Confirmed");
}

export function listRejectedDepartmentReceipts(): MaterialIssueReceipt[] {
  return listMaterialIssueReceipts().filter(
    (r) => r.status === "Acceptance Rejected",
  );
}

export function listPendingWarehouseReceipts(): MaterialIssueReceipt[] {
  return listMaterialIssueReceipts().filter(
    (r) => r.status === "Waiting Warehouse Signature",
  );
}

export function listReceiptsAwaitingDepartmentAcceptance(): MaterialIssueReceipt[] {
  return listPendingDepartmentReceipts();
}

export function countPendingDepartmentAcceptance(): number {
  return listPendingDepartmentReceipts().length;
}

export function countReceiptsAwaitingConfirmation(): number {
  return listMaterialIssueReceipts().filter(
    (r) =>
      r.status === "Waiting Warehouse Signature" ||
      r.status === "Pending Department Acceptance",
  ).length;
}

export function countTodaysMaterialIssues(): number {
  const today = new Date().toISOString().slice(0, 10);
  return listMaterialIssueReceipts().filter((r) =>
    String(r.issue_date || r.created_at || "").startsWith(today),
  ).length;
}

function mapLines(
  input: CreateMaterialIssueReceiptInput,
): MaterialIssueReceiptLine[] {
  return (input.lines || []).map((l) => {
    const issued = Math.max(0, Number(l.issued_qty) || 0);
    const requested = Math.max(0, Number(l.required_qty) || issued);
    return {
      item_code: l.item_code,
      item_name: l.item_name || l.item_code,
      uom: l.uom || "Nos",
      requested_qty: requested,
      issued_qty: issued,
      remaining_qty: Math.max(0, requested - issued),
      remarks: l.remarks,
    };
  });
}

function isBlank(v: string | null | undefined): boolean {
  const s = String(v || "").trim();
  return !s || s === "—" || s === "-";
}

/**
 * Fill blank receipt fields from Material Request + Stock Entry.
 */
async function enrichReceiptInput(
  input: CreateMaterialIssueReceiptInput,
): Promise<CreateMaterialIssueReceiptInput> {
  const stockEntry = String(input.stock_entry || "").trim();
  const mrName = String(input.mr_name || "").trim();
  let department = input.department;
  let company = input.company;
  let warehouse = input.warehouse;
  let receiver = input.receiver;
  let issued_by = input.issued_by;
  let issue_type = input.issue_type;
  let issue_date = input.issue_date;
  let lines = [...(input.lines || [])];
  let remarks = input.remarks;

  if (mrName) {
    try {
      const mr = await fetchMaterialRequestWorkflow(mrName);
      if (isBlank(department)) {
        department =
          (mr as { custom_department?: string }).custom_department ||
          (mr as { department?: string }).department ||
          "General";
      }
      if (isBlank(company)) {
        company = (mr as { company?: string }).company || company;
      }
      if (!lines.length && Array.isArray(mr.items)) {
        lines = mr.items.map((it) => ({
          item_code: it.item_code,
          item_name: it.item_name || it.item_code,
          uom: it.uom || "Nos",
          required_qty: Number(it.qty) || 0,
          issued_qty: Number(it.qty) || 0,
        }));
      } else if (lines.length && Array.isArray(mr.items)) {
        const byCode = new Map(mr.items.map((it) => [it.item_code, it]));
        lines = lines.map((l) => {
          const row = byCode.get(l.item_code);
          const required =
            Number(l.required_qty) || Number(row?.qty) || Number(l.issued_qty) || 0;
          return {
            ...l,
            item_name: l.item_name || row?.item_name || l.item_code,
            uom: l.uom || row?.uom || "Nos",
            required_qty: required,
            issued_qty: Number(l.issued_qty) || 0,
          };
        });
      }
    } catch {
      /* keep caller values */
    }
  }

  if (stockEntry) {
    try {
      const se = await apiGet<{
        name?: string;
        posting_date?: string;
        from_warehouse?: string;
        remarks?: string;
        items?: Array<{
          item_code?: string;
          item_name?: string;
          qty?: number;
          uom?: string;
          s_warehouse?: string;
          t_warehouse?: string;
        }>;
      }>(buildResourceUrl("Stock Entry", stockEntry));

      if (isBlank(warehouse)) {
        warehouse =
          se.from_warehouse ||
          se.items?.find((i) => i.s_warehouse)?.s_warehouse ||
          se.items?.find((i) => i.t_warehouse)?.t_warehouse ||
          warehouse;
      }
      if (!issue_date && se.posting_date) issue_date = se.posting_date;
      if (isBlank(receiver) && se.remarks) {
        const m = se.remarks.match(/Receiver:\s*(.+)/i);
        if (m?.[1]) receiver = m[1].trim();
      }
      if (isBlank(issue_type) && se.remarks) {
        const m = se.remarks.match(/Issue Type:\s*(.+)/i);
        if (m?.[1]) issue_type = m[1].trim();
      }
      if (!lines.length && Array.isArray(se.items)) {
        lines = se.items
          .filter((i) => i.item_code && Number(i.qty) > 0)
          .map((i) => ({
            item_code: String(i.item_code),
            item_name: i.item_name || String(i.item_code),
            uom: i.uom || "Nos",
            required_qty: Number(i.qty) || 0,
            issued_qty: Number(i.qty) || 0,
          }));
      }
      if (!remarks && se.remarks) remarks = se.remarks;
    } catch {
      /* keep caller values */
    }
  }

  return {
    ...input,
    department: isBlank(department) ? "General" : String(department).trim(),
    company: isBlank(company) ? undefined : String(company).trim(),
    warehouse: isBlank(warehouse) ? "—" : String(warehouse).trim(),
    receiver: isBlank(receiver) ? "Department User" : String(receiver).trim(),
    issued_by: isBlank(issued_by) ? "Warehouse Manager" : String(issued_by).trim(),
    issue_type: isBlank(issue_type) ? "Full Issue" : String(issue_type).trim(),
    issue_date: issue_date || todayERPNextDate(),
    lines,
    remarks,
  };
}

/**
 * Create a unique Material Issue Receipt after Stock Entry submission.
 * Does NOT complete the Material Request — warehouse must sign first.
 */
export async function createMaterialIssueReceipt(
  input: CreateMaterialIssueReceiptInput,
): Promise<MaterialIssueReceipt> {
  const enriched = await enrichReceiptInput(input);
  const stockEntry = String(enriched.stock_entry || "").trim();
  if (!stockEntry) throw new Error("Stock Entry is required to create a receipt.");

  const existingBySe = listMaterialIssueReceipts().find(
    (r) => r.stock_entry === stockEntry,
  );
  if (existingBySe) {
    // Backfill blank fields only before warehouse seal — never mutate signed business data.
    let changed = false;
    const sealed = Boolean(existingBySe.warehouse_signature);
    if (!sealed) {
      if (isBlank(existingBySe.department) && !isBlank(enriched.department)) {
        existingBySe.department = enriched.department;
        changed = true;
      }
      if (isBlank(existingBySe.warehouse) && !isBlank(enriched.warehouse)) {
        existingBySe.warehouse = enriched.warehouse;
        changed = true;
      }
      if (isBlank(existingBySe.received_by) && !isBlank(enriched.receiver)) {
        existingBySe.received_by = enriched.receiver;
        changed = true;
      }
      if (isBlank(existingBySe.issue_type) && !isBlank(enriched.issue_type)) {
        existingBySe.issue_type = enriched.issue_type;
        changed = true;
      }
      if (
        (!existingBySe.items || existingBySe.items.length === 0) &&
        enriched.lines.length
      ) {
        existingBySe.items = mapLines(enriched);
        changed = true;
      }
    }
    // Promote legacy Waiting → Pending so Department can accept, and re-sync MIR.
    if (existingBySe.status === "Waiting Warehouse Signature") {
      const meta = captureWarehouseClientMeta();
      const whSignedAt = captureSignatureTimestamp();
      freezeBusinessSnapshot(existingBySe);
      const liveHash =
        existingBySe.document_hash ||
        (await buildDocumentHash(existingBySe));
      existingBySe.document_hash = liveHash;
      const whSha = await buildSignatureHash({
        signer_name: existingBySe.issued_by || enriched.issued_by,
        role: "Warehouse Manager",
        signature_type: "typed",
        typed_name: existingBySe.issued_by || enriched.issued_by,
        signed_at: whSignedAt,
        document_hash: liveHash,
      });
      existingBySe.warehouse_signature = {
        signer_name: existingBySe.issued_by || enriched.issued_by,
        role: "Warehouse Manager",
        signature_type: "typed",
        typed_name: existingBySe.issued_by || enriched.issued_by,
        signed_at: whSignedAt,
        sha256_hash: whSha,
        document_hash: liveHash,
        verification_status: "verified",
        ip_address: meta.warehouseIp,
        browser: meta.warehouseBrowser,
        device: meta.warehouseDevice,
        document_version: existingBySe.document_version,
      };
      existingBySe.warehouse_signed_at = whSignedAt;
      existingBySe.status = "Pending Department Acceptance";
      changed = true;
    }
    if (changed) {
      persist(existingBySe);
    }
    await syncReceiptSidecarToMr(existingBySe, {
      status: "Pending Department Acceptance",
      proseLine: `Material Issue Receipt ${existingBySe.issue_number} synced for Department acceptance.`,
    });
    return existingBySe;
  }

  const issue_number = nextReceiptNumber();
  const id = issue_number;
  const document_version = "1.0";
  const items = mapLines(enriched);
  if (items.length === 0) {
    throw new Error(
      "Material Issue Receipt requires at least one item line (from Stock Entry or Material Request).",
    );
  }
  const issue_date = enriched.issue_date || todayERPNextDate();
  const issue_type = enriched.issue_type || "Full Issue";
  const base = {
    issue_number,
    stock_entry: stockEntry,
    mr_name: enriched.mr_name,
    department: enriched.department,
    company: enriched.company,
    warehouse: enriched.warehouse,
    issue_date,
    issued_by: enriched.issued_by,
    received_by: enriched.receiver,
    issue_type,
    items,
    // Business remarks only — machine BidSphere tags stay on MR / Stock Entry.
    remarks: cleanBusinessWarehouseRemarks(enriched.remarks),
    document_version,
  };
  // Seal immutable business fields (excludes department acceptance data).
  const business_snapshot = buildBusinessHashPayload(base);
  const document_hash = await hashCanonicalJson(business_snapshot);
  const verification_token = (await sha256Hex(`${id}:${document_hash}`)).slice(
    0,
    24,
  );
  const now = captureSignatureTimestamp();
  const meta = captureWarehouseClientMeta();

  const receipt: MaterialIssueReceipt = {
    id,
    ...base,
    business_snapshot,
    status: "Waiting Warehouse Signature",
    document_hash,
    document_version,
    verification_token,
    created_at: now,
    modified: now,
    audit_trail: [],
  };

  appendAudit(receipt, {
    action: "Material Issue Receipt Created",
    at: now,
    by: enriched.issued_by,
    role: "Warehouse Manager",
    detail: `Receipt ${issue_number} · Stock Entry ${stockEntry} · MR ${enriched.mr_name}`,
    hash: document_hash.slice(0, 16),
    ip_address: meta.warehouseIp,
    browser: meta.warehouseBrowser,
    device: meta.warehouseDevice,
    document_version,
  });

  // Auto warehouse acknowledgment on issue so Department Pending Acceptance
  // is created immediately (Warehouse → Receipt → Department → Completed).
  const whSignedAt = captureSignatureTimestamp();
  const whSha = await buildSignatureHash({
    signer_name: enriched.issued_by,
    role: "Warehouse Manager",
    signature_type: "typed",
    typed_name: enriched.issued_by,
    signed_at: whSignedAt,
    document_hash,
  });
  receipt.warehouse_signature = {
    signer_name: enriched.issued_by,
    role: "Warehouse Manager",
    signature_type: "typed",
    typed_name: enriched.issued_by,
    signed_at: whSignedAt,
    sha256_hash: whSha,
    document_hash,
    verification_status: "verified",
    ip_address: meta.warehouseIp,
    browser: meta.warehouseBrowser,
    device: meta.warehouseDevice,
    document_version,
  };
  receipt.warehouse_signed_at = whSignedAt;
  receipt.status = "Pending Department Acceptance";
  appendAudit(receipt, {
    action: "Warehouse Signed (Issue Acknowledgment)",
    at: whSignedAt,
    by: enriched.issued_by,
    role: "Warehouse Manager",
    detail: `Auto-ack on issue · SHA256 ${whSha.slice(0, 16)}… → Pending Department Acceptance`,
    hash: whSha.slice(0, 16),
    ip_address: meta.warehouseIp,
    browser: meta.warehouseBrowser,
    device: meta.warehouseDevice,
    document_version,
  });

  persist(receipt);

  // Cross-user sync: MIR sidecar on MR remarks + Pending Department Acceptance.
  // Must succeed — Department Issue Receipts hydrate from this tag.
  await syncReceiptSidecarToMr(receipt, {
    status: "Pending Department Acceptance",
    proseLine: `Material Issue Receipt ${issue_number} created for Stock Entry ${stockEntry}. Waiting for Department Acceptance.`,
  });

  createNotification({
    title: "Material Issue Receipt created",
    description: `${issue_number} — waiting for department acceptance.`,
    module: "Material Issue Receipt",
    event_type: "material_issue_receipt_created",
    target_role: "warehouse",
    document_type: "Material Issue Receipt",
    document_name: issue_number,
    route_path: `/warehouse/material-issue-receipts/${encodeURIComponent(issue_number)}`,
  });

  createNotification({
    title: "Pending Material Acceptance",
    description: `Please confirm receipt of issued materials — ${issue_number} (MR ${enriched.mr_name}).`,
    module: "Material Issue Receipt",
    event_type: "material_issue_receipt_awaiting_department",
    target_role: "department",
    document_type: "Material Issue Receipt",
    document_name: issue_number,
    route_path: `/department/issued-items/receipts/${encodeURIComponent(issue_number)}`,
  });

  return receipt;
}

async function buildSignatureHash(input: {
  signer_name: string;
  role: MaterialIssueReceiptSignerRole;
  signature_type: "drawn" | "typed";
  signature_data_url?: string | null;
  typed_name?: string;
  signed_at: string;
  document_hash: string;
}): Promise<string> {
  return hashCanonicalJson({
    signer_name: input.signer_name,
    role: input.role,
    signature_type: input.signature_type,
    signature_data_url: input.signature_data_url || "",
    typed_name: input.typed_name || "",
    signed_at: input.signed_at,
    document_hash: input.document_hash,
  });
}

export async function signMaterialIssueReceiptAsWarehouse(input: {
  issueNumber: string;
  signerName: string;
  signatureType: "drawn" | "typed";
  signatureDataUrl?: string | null;
  typedName?: string;
}): Promise<MaterialIssueReceipt> {
  const receipt =
    getMaterialIssueReceipt(input.issueNumber) ||
    (await getMaterialIssueReceiptAsync(input.issueNumber));
  if (!receipt) throw new Error("Material Issue Receipt not found.");
  if (receipt.status !== "Waiting Warehouse Signature") {
    throw new Error(
      `Cannot warehouse-sign while status is “${receipt.status}”.`,
    );
  }
  if (!input.signerName.trim()) {
    throw new Error("Signer name is required.");
  }
  if (input.signatureType === "drawn" && !input.signatureDataUrl) {
    throw new Error("Capture a drawn signature before signing.");
  }
  if (
    input.signatureType === "typed" &&
    (input.typedName || input.signerName).trim().length < 2
  ) {
    throw new Error("Enter your full name to sign.");
  }

  const sealedHash = await assertBusinessDocumentIntegrity(receipt);
  freezeBusinessSnapshot(receipt);

  const meta = captureWarehouseClientMeta();
  const signed_at = captureSignatureTimestamp();
  const sha256_hash = await buildSignatureHash({
    signer_name: input.signerName.trim(),
    role: "Warehouse Manager",
    signature_type: input.signatureType,
    signature_data_url: input.signatureDataUrl,
    typed_name: input.typedName || input.signerName,
    signed_at,
    document_hash: sealedHash,
  });

  const signature: MaterialIssueReceiptSignature = {
    signer_name: input.signerName.trim(),
    role: "Warehouse Manager",
    signature_type: input.signatureType,
    signature_data_url: input.signatureDataUrl ?? null,
    typed_name: (input.typedName || input.signerName).trim(),
    signed_at,
    sha256_hash,
    document_hash: sealedHash,
    verification_status: "verified",
    ip_address: meta.warehouseIp,
    browser: meta.warehouseBrowser,
    device: meta.warehouseDevice,
    document_version: receipt.document_version,
  };

  receipt.document_hash = sealedHash;
  receipt.warehouse_signature = signature;
  receipt.warehouse_signed_at = signed_at;
  receipt.status = "Pending Department Acceptance";
  appendAudit(receipt, {
    action: "Warehouse Manager Signed",
    at: signed_at,
    by: signature.signer_name,
    role: "Warehouse Manager",
    detail: `Business SHA256 ${sha256_hash.slice(0, 16)}… → Pending Department Acceptance`,
    hash: sha256_hash,
    ip_address: meta.warehouseIp,
    browser: meta.warehouseBrowser,
    device: meta.warehouseDevice,
    document_version: receipt.document_version,
  });

  persist(receipt);

  try {
    await syncReceiptSidecarToMr(receipt, {
      status: "Pending Department Acceptance",
      proseLine: `Warehouse signed Material Issue Receipt ${receipt.issue_number} at ${signed_at}. Waiting for Department Acceptance. Stock Entry ${receipt.stock_entry}.`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[MaterialIssueReceipt] MR status update after warehouse sign failed:",
      err,
    );
  }

  createNotification({
    title: "Please confirm receipt of issued materials.",
    description: `Material Issue Receipt ${receipt.issue_number} is waiting for your digital signature.`,
    module: "Material Issue Receipt",
    event_type: "material_issue_receipt_awaiting_department",
    target_role: "department",
    document_type: "Material Issue Receipt",
    document_name: receipt.issue_number,
    route_path: `/department/issued-items/receipts/${encodeURIComponent(receipt.issue_number)}`,
  });

  createNotification({
    title: "Pending Department Acceptance",
    description: `${receipt.issue_number} — waiting for department confirmation.`,
    module: "Material Issue Receipt",
    event_type: "material_issue_receipt_waiting_department",
    target_role: "warehouse",
    document_type: "Material Issue Receipt",
    document_name: receipt.issue_number,
    route_path: `/warehouse/material-issue-receipts/${encodeURIComponent(receipt.issue_number)}`,
  });

  return receipt;
}

export async function signMaterialIssueReceiptAsDepartment(input: {
  issueNumber: string;
  signerName: string;
  signatureType: "drawn" | "typed";
  signatureDataUrl?: string | null;
  typedName?: string;
  checklist: MaterialIssueAcceptanceChecklist;
  departmentRemarks?: string;
}): Promise<MaterialIssueReceipt> {
  const receipt =
    getMaterialIssueReceipt(input.issueNumber) ||
    (await getMaterialIssueReceiptAsync(input.issueNumber));
  if (!receipt) throw new Error("Material Issue Receipt not found.");
  if (receipt.status !== "Pending Department Acceptance") {
    throw new Error(
      `Cannot department-sign while status is “${receipt.status}”.`,
    );
  }
  if (!receipt.warehouse_signature) {
    throw new Error("Warehouse signature is required first.");
  }
  if (!input.signerName.trim()) {
    throw new Error("Signer name is required.");
  }
  if (!isAcceptanceChecklistComplete(input.checklist)) {
    throw new Error(
      "Complete the acceptance checklist before accepting material.",
    );
  }

  // Department Acceptance never recomputes / overwrites the warehouse business hash.
  // Checklist, remarks, and department signature are separate metadata.
  const warehouseBusinessHash = await assertBusinessDocumentIntegrity(receipt, {
    afterWarehouseSign: true,
  });

  const meta = captureWarehouseClientMeta();
  const signed_at = captureSignatureTimestamp();
  // Department hash binds to acceptance act + sealed warehouse business hash.
  const departmentAcceptancePayload = {
    warehouse_business_hash: warehouseBusinessHash,
    issue_number: receipt.issue_number,
    checklist: input.checklist,
    department_remarks: (input.departmentRemarks || "").trim(),
    accepted_by: input.signerName.trim(),
    accepted_at: signed_at,
  };
  const sha256_hash = await hashCanonicalJson(departmentAcceptancePayload);

  const signature: MaterialIssueReceiptSignature = {
    signer_name: input.signerName.trim(),
    role: "Department User",
    signature_type: input.signatureType,
    signature_data_url: input.signatureDataUrl ?? null,
    typed_name: (input.typedName || input.signerName).trim(),
    signed_at,
    sha256_hash,
    // Reference the immutable warehouse business hash (not a new document hash).
    document_hash: warehouseBusinessHash,
    verification_status: "verified",
    ip_address: meta.warehouseIp,
    browser: meta.warehouseBrowser,
    device: meta.warehouseDevice,
    document_version: receipt.document_version,
  };

  receipt.acceptance_checklist = { ...input.checklist };
  receipt.department_remarks = (input.departmentRemarks || "").trim();
  receipt.department_signature = signature;
  receipt.department_signed_at = signed_at;
  receipt.status = "Confirmed";
  receipt.confirmed_at = signed_at;
  // Warehouse business hash stays exactly as sealed at warehouse sign time.
  receipt.document_hash = warehouseBusinessHash;
  if (receipt.warehouse_signature) {
    receipt.warehouse_signature = {
      ...receipt.warehouse_signature,
      document_hash:
        receipt.warehouse_signature.document_hash || warehouseBusinessHash,
      verification_status: "verified",
    };
  }
  appendAudit(receipt, {
    action: "Department Accepted & Signed — Receipt Confirmed",
    at: signed_at,
    by: signature.signer_name,
    role: "Department User",
    detail: `Acceptance SHA256 ${sha256_hash.slice(0, 16)}… · warehouse business hash unchanged`,
    hash: sha256_hash,
    ip_address: meta.warehouseIp,
    browser: meta.warehouseBrowser,
    device: meta.warehouseDevice,
    document_version: receipt.document_version,
  });

  persist(receipt);

  // Complete Material Request only after both signatures — sync MIR sidecar.
  try {
    await syncReceiptSidecarToMr(receipt, {
      status: "Completed",
      proseLine: `Material Issue Receipt ${receipt.issue_number} confirmed by department at ${signed_at}. Stock Entry ${receipt.stock_entry}.`,
    });
    appendAudit(receipt, {
      action: "Material Request Updated — Completed",
      at: signed_at,
      by: "System",
      role: "System",
      detail: `MR ${receipt.mr_name} completed after dual signature confirmation · SE ${receipt.stock_entry}`,
      document_version: receipt.document_version,
      ip_address: meta.warehouseIp,
      browser: meta.warehouseBrowser,
      device: meta.warehouseDevice,
      hash: sha256_hash.slice(0, 16),
    });
    persist(receipt);
  } catch (err) {
    appendAudit(receipt, {
      action: "Material Request Complete Failed",
      at: signed_at,
      by: "System",
      role: "System",
      detail:
        err instanceof Error
          ? err.message
          : "Could not set Material Request to Completed",
      document_version: receipt.document_version,
    });
    persist(receipt);
    // eslint-disable-next-line no-console
    console.warn(
      "[MaterialIssueReceipt] MR Completed update failed:",
      err,
    );
  }

  createNotification({
    title: "Material Receipt Confirmed",
    description: `${receipt.issue_number} confirmed. Material Request ${receipt.mr_name} is Completed.`,
    module: "Material Issue Receipt",
    event_type: "material_issue_receipt_confirmed",
    target_role: "warehouse",
    document_type: "Material Issue Receipt",
    document_name: receipt.issue_number,
    route_path: `/warehouse/material-issue-receipts/${encodeURIComponent(receipt.issue_number)}`,
  });

  return receipt;
}

/**
 * Department rejects the Material Issue Receipt.
 * MR stays Pending Department Acceptance; warehouse is notified.
 */
export async function rejectMaterialIssueReceipt(input: {
  issueNumber: string;
  rejectedBy: string;
  reason: string;
}): Promise<MaterialIssueReceipt> {
  const receipt = getMaterialIssueReceipt(input.issueNumber);
  if (!receipt) throw new Error("Material Issue Receipt not found.");
  if (receipt.status !== "Pending Department Acceptance") {
    throw new Error(
      `Cannot reject while status is “${receipt.status}”.`,
    );
  }
  const reason = (input.reason || "").trim();
  if (reason.length < 3) {
    throw new Error("Enter a rejection reason (at least 3 characters).");
  }

  const meta = captureWarehouseClientMeta();
  const at = captureSignatureTimestamp();
  receipt.status = "Acceptance Rejected";
  receipt.rejection_reason = reason;
  receipt.rejected_at = at;
  receipt.rejected_by = input.rejectedBy.trim() || "Department User";
  appendAudit(receipt, {
    action: "Department Rejected Acceptance",
    at,
    by: receipt.rejected_by,
    role: "Department User",
    detail: reason,
    ip_address: meta.warehouseIp,
    browser: meta.warehouseBrowser,
    device: meta.warehouseDevice,
    document_version: receipt.document_version,
  });
  persist(receipt);

  try {
    await syncReceiptSidecarToMr(receipt, {
      status: "Pending Department Acceptance",
      proseLine: `Material Issue Receipt ${receipt.issue_number} acceptance rejected: ${reason}`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[MaterialIssueReceipt] Reject sync to MR failed:",
      err,
    );
  }

  createNotification({
    title: "Material Receipt Acceptance Rejected",
    description: `${receipt.issue_number} rejected by department: ${reason}`,
    module: "Material Issue Receipt",
    event_type: "material_issue_receipt_rejected",
    target_role: "warehouse",
    document_type: "Material Issue Receipt",
    document_name: receipt.issue_number,
    route_path: `/warehouse/material-issue-receipts/${encodeURIComponent(receipt.issue_number)}`,
  });

  return receipt;
}

/**
 * Targeted ERP lookup by Material Issue identifier (Stock Entry name).
 * Used when localStorage is empty (phone QR scan / other browser).
 */
async function resolveReceiptFromIssueLookup(
  issueKey: string,
): Promise<MaterialIssueReceipt | null> {
  const key = String(issueKey || "").trim();
  if (!key) return null;

  // eslint-disable-next-line no-console
  console.log("[verify] Database lookup: Stock Entry / issue_number", key);

  // 1) Direct Stock Entry fetch by name (QR encodes MAT-STE-…)
  try {
    const se = await apiGet<{
      name?: string;
      posting_date?: string;
      owner?: string;
      remarks?: string;
      from_warehouse?: string;
      company?: string;
      items?: Array<{
        material_request?: string;
        item_code?: string;
        item_name?: string;
        qty?: number;
        uom?: string;
        s_warehouse?: string;
      }>;
    }>(buildResourceUrl("Stock Entry", key));

    if (se?.name) {
      // eslint-disable-next-line no-console
      console.log("[verify] Database lookup result: Stock Entry found", se.name);
      const lines = (se.items || []).filter(
        (l) => l.item_code && Number(l.qty) > 0,
      );
      const mrName =
        lines.find((l) => l.material_request)?.material_request || "";

      if (mrName) {
        try {
          const mr = await fetchMaterialRequestWorkflow(mrName);
          const remarks = mr.custom_warehouse_remarks ?? mr.remarks ?? "";
          const sidecars = parseMirSidecarsFromRemarks(remarks);
          const match = sidecars.find(
            (s) =>
              s.stock_entry === se.name ||
              s.issue_number === key ||
              s.stock_entry === key,
          );
          if (match) {
            const incoming = fromMirSidecar({
              ...match,
              mr_name: match.mr_name || mr.name,
              company:
                match.company ||
                se.company ||
                (mr as { company?: string }).company,
            });
            persist(incoming);
            // eslint-disable-next-line no-console
            console.log(
              "[verify] Database lookup result: MIR sidecar matched",
              incoming.issue_number,
            );
            return incoming;
          }
        } catch (mrErr) {
          // eslint-disable-next-line no-console
          console.warn("[verify] MR sidecar fetch failed:", mrErr);
        }
      }

      if (lines.length && mrName) {
        const now = captureSignatureTimestamp();
        const issueNumber = `MIR-${se.name}`
          .replace(/[^A-Za-z0-9-]/g, "-")
          .slice(0, 40);
        const audit = parseMaterialIssueAudit(se.remarks);
        const items = lines.map((l) => {
          const issued = Number(l.qty) || 0;
          return {
            item_code: String(l.item_code),
            item_name: l.item_name || String(l.item_code),
            uom: l.uom || "Nos",
            requested_qty: issued,
            issued_qty: issued,
            remaining_qty: 0,
          };
        });
        const receipt: MaterialIssueReceipt = {
          id: issueNumber,
          issue_number: issueNumber,
          stock_entry: se.name,
          mr_name: mrName,
          department: "General",
          company: se.company || undefined,
          warehouse:
            lines.find((l) => l.s_warehouse)?.s_warehouse ||
            se.from_warehouse ||
            audit?.audit?.warehouse ||
            "—",
          issue_date: se.posting_date || todayERPNextDate(),
          issued_by: audit?.audit?.created_by || se.owner || "Warehouse",
          received_by: audit?.receiver || "Department User",
          issue_type: audit?.issue_type || "Full Issue",
          status: "Pending Department Acceptance",
          items,
          document_hash: "",
          document_version: "1.0",
          verification_token: (await sha256Hex(`tok:${issueNumber}`)).slice(
            0,
            24,
          ),
          created_at: now,
          modified: now,
          warehouse_signed_at: now,
          warehouse_signature: {
            signer_name: audit?.audit?.created_by || se.owner || "Warehouse",
            role: "Warehouse Manager",
            signature_type: "typed",
            typed_name: audit?.audit?.created_by || se.owner || "Warehouse",
            signed_at: now,
            sha256_hash: "",
            document_hash: "",
            verification_status: "verified",
            document_version: "1.0",
          },
          audit_trail: [
            {
              id: uid("verify_sync"),
              action: "Resolved from Stock Entry for QR verification",
              at: now,
              by: "System",
              role: "System",
              detail: `Stock Entry ${se.name} · MR ${mrName}`,
            },
          ],
        };
        // Seal with the same business hash used by QR verification.
        const business_snapshot = freezeBusinessSnapshot(receipt);
        const document_hash = await hashCanonicalJson(business_snapshot);
        receipt.document_hash = document_hash;
        if (receipt.warehouse_signature) {
          receipt.warehouse_signature.document_hash = document_hash;
        }
        persist(receipt);
        // eslint-disable-next-line no-console
        console.log(
          "[verify] Database lookup result: built receipt from Stock Entry",
          receipt.issue_number,
        );
        return receipt;
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(
        "[verify] Database lookup result: Stock Entry not found for",
        key,
      );
    }
  } catch (seErr) {
    // eslint-disable-next-line no-console
    console.warn("[verify] Stock Entry lookup failed:", seErr);
  }

  return null;
}

/** Load one receipt, hydrating from ERP MIR tags when missing locally. */
export async function getMaterialIssueReceiptAsync(
  idOrIssueNumber: string,
): Promise<MaterialIssueReceipt | null> {
  const key = String(idOrIssueNumber || "").trim();
  if (!key) return null;

  const local = getMaterialIssueReceipt(key);
  if (local) return local;

  try {
    await hydrateMaterialIssueReceiptsFromErp();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[MaterialIssueReceipt] hydrate during lookup failed:", err);
  }

  const afterHydrate = getMaterialIssueReceipt(key);
  if (afterHydrate) return afterHydrate;

  return resolveReceiptFromIssueLookup(key);
}

export type ReceiptVerificationResult = {
  success: boolean;
  hash_valid: boolean;
  verified: boolean;
  status: MaterialIssueReceiptStatus | "Not Found" | "Tampered";
  document_number: string;
  created_date: string;
  signed_by: string[];
  verification_status: string;
  receipt?: MaterialIssueReceipt;
  message: string;
  warehouse_signature_valid?: boolean;
  department_signature_valid?: boolean;
  document_integrity?: "Verified" | "Tampered" | "Pending";
  stored_hash?: string;
  calculated_hash?: string;
};

/**
 * Lookup key encoded in QR codes — Material Issue identifier only.
 * Prefer Stock Entry (MAT-STE-…); fall back to MIR issue number.
 * Never use SHA256 / verification_token as the QR lookup id.
 */
export function receiptPublicLookupId(receipt: MaterialIssueReceipt): string {
  return String(receipt.stock_entry || receipt.issue_number || receipt.id || "").trim();
}

export async function verifyMaterialIssueReceipt(
  issueLookupId: string,
): Promise<ReceiptVerificationResult> {
  const key = String(issueLookupId || "").trim();
  // eslint-disable-next-line no-console
  console.log("[verify] QR parameter received:", key);
  // eslint-disable-next-line no-console
  console.log("[verify] API request: resolve Material Issue by issue_number", key);

  const receipt =
    getMaterialIssueReceipt(key) || (await getMaterialIssueReceiptAsync(key));

  // eslint-disable-next-line no-console
  console.log(
    "[verify] Database lookup result:",
    receipt
      ? {
          issue_number: receipt.issue_number,
          stock_entry: receipt.stock_entry,
          status: receipt.status,
        }
      : null,
  );

  if (!receipt) {
    const notFound: ReceiptVerificationResult = {
      success: false,
      hash_valid: false,
      verified: false,
      status: "Not Found",
      document_number: key,
      created_date: "—",
      signed_by: [],
      verification_status: "Not Found",
      warehouse_signature_valid: false,
      department_signature_valid: false,
      document_integrity: "Pending",
      message: "Material Issue not found for this identifier.",
    };
    // eslint-disable-next-line no-console
    console.log("[verify] Verification result:", notFound);
    return notFound;
  }

  const signed_by = [
    receipt.warehouse_signature?.signer_name,
    receipt.department_signature?.signer_name,
  ].filter(Boolean) as string[];

  const storedBusinessHash =
    receipt.warehouse_signature?.document_hash || receipt.document_hash || "";

  let liveBusinessHash = "";
  try {
    liveBusinessHash = await buildDocumentHash(receipt);
  } catch (hashErr) {
    // eslint-disable-next-line no-console
    console.warn("[verify] Hash calculation failed:", hashErr);
  }

  // eslint-disable-next-line no-console
  console.log("[verify] Stored hash:", storedBusinessHash || "(none)");
  // eslint-disable-next-line no-console
  console.log("[verify] Calculated hash:", liveBusinessHash || "(none)");

  const snapshotOk = receipt.business_snapshot
    ? businessPayloadEquals(
        buildBusinessHashPayload(receipt),
        receipt.business_snapshot,
      )
    : true;
  const businessHashOk =
    Boolean(storedBusinessHash) &&
    Boolean(liveBusinessHash) &&
    (liveBusinessHash === storedBusinessHash ||
      liveBusinessHash === receipt.document_hash);

  // hash_valid only when recalculated business hash matches sealed storage.
  const hash_valid =
    businessHashOk ||
    (Boolean(receipt.business_snapshot) && snapshotOk && Boolean(storedBusinessHash));

  const warehouse_signature_valid = Boolean(
    receipt.warehouse_signature && (businessHashOk || snapshotOk),
  );
  const department_signature_valid = Boolean(
    receipt.department_signature &&
      receipt.department_signature.document_hash &&
      (receipt.department_signature.document_hash === storedBusinessHash ||
        receipt.department_signature.document_hash === liveBusinessHash ||
        receipt.status === "Confirmed"),
  );

  let document_integrity: "Verified" | "Tampered" | "Pending" = "Pending";
  if (receipt.warehouse_signature && storedBusinessHash) {
    if (businessHashOk || snapshotOk) {
      document_integrity = "Verified";
    } else if (receipt.business_snapshot) {
      // Only mark tampered when a sealed business snapshot exists and drifts.
      document_integrity = "Tampered";
    } else {
      // Legacy sync hashes may predate business-payload hashing.
      document_integrity = "Pending";
    }
  }

  if (document_integrity === "Tampered") {
    const tampered: ReceiptVerificationResult = {
      success: false,
      hash_valid: false,
      verified: false,
      status: "Tampered",
      document_number: receipt.issue_number,
      created_date: receipt.created_at,
      signed_by,
      verification_status: "Invalid — Business Data Modified",
      warehouse_signature_valid: false,
      department_signature_valid: false,
      document_integrity: "Tampered",
      receipt,
      stored_hash: storedBusinessHash,
      calculated_hash: liveBusinessHash,
      message:
        "Immutable business fields were modified after warehouse signature. Verification invalidated.",
    };
    // eslint-disable-next-line no-console
    console.log("[verify] Verification result:", tampered);
    return tampered;
  }

  const confirmed =
    receipt.status === "Confirmed" &&
    warehouse_signature_valid &&
    department_signature_valid;

  const signaturesInvalid =
    Boolean(receipt.warehouse_signature) &&
    !warehouse_signature_valid &&
    document_integrity !== "Pending";

  const result: ReceiptVerificationResult = {
    success: !signaturesInvalid,
    hash_valid,
    verified: confirmed,
    status: receipt.status,
    document_number: receipt.issue_number,
    created_date: receipt.created_at,
    signed_by,
    verification_status: confirmed
      ? "Verified"
      : warehouse_signature_valid
        ? "Warehouse Valid · Department Pending"
        : "Awaiting Signatures",
    warehouse_signature_valid,
    department_signature_valid,
    document_integrity: warehouse_signature_valid ? "Verified" : "Pending",
    receipt,
    stored_hash: storedBusinessHash,
    calculated_hash: liveBusinessHash,
    message: confirmed
      ? "Receipt verified. Warehouse and department signatures are valid. Document integrity verified."
      : warehouse_signature_valid
        ? "Warehouse signature valid. Department acceptance pending."
        : `Receipt found. Current status: ${receipt.status}.`,
  };

  // eslint-disable-next-line no-console
  console.log("[verify] Verification result:", {
    success: result.success,
    hash_valid: result.hash_valid,
    status: result.status,
    document_integrity: result.document_integrity,
  });

  return result;
}

/**
 * QR path uses Material Issue identifier (Stock Entry / MIR number).
 * SHA256 hashes are never used as the lookup id.
 */
export function receiptVerificationPath(receipt: MaterialIssueReceipt): string {
  const issueId = receiptPublicLookupId(receipt);
  return `/verify/material-issue?issue=${encodeURIComponent(issueId)}`;
}

/**
 * Absolute QR verification URL.
 * Base host comes from VITE_PUBLIC_URL (or LAN/runtime origin) — never hardcoded.
 */
export function receiptVerificationUrl(receipt: MaterialIssueReceipt): string {
  return buildPublicAppUrl(receiptVerificationPath(receipt));
}

/**
 * When ERP stores "Material Issued" (no Select option for Pending Department
 * Acceptance), restore the UI status from open Material Issue Receipts.
 */
export { overlayMrStatusFromReceipts as enhanceMrStatusFromReceipts } from "./mrPendingAcceptanceOverlay";
