/**
 * Department Issued Items — single data source for:
 *   Pending Acceptance · Accepted Items · Issue Receipts · Dashboard KPIs
 *
 * Syncs Material Issue Receipts from:
 *   1) localStorage cache
 *   2) Material Request MIR / MaterialIssue remark tags (full doc fetch)
 *   3) ERPNext Stock Entry (Material Issue) linked to Material Requests
 *
 * Does not touch RFQ / Procurement / Supplier / PO / Finance.
 */

import { apiGet, buildListConfig, buildResourceUrl } from "./erpnext";
import {
  fetchMaterialRequestWorkflow,
  listMaterialRequestsWorkflow,
  type MaterialRequestWorkflowRecord,
} from "./materialRequestWorkflow";
import { parseMaterialIssueAudit } from "./materialIssue";
import {
  getMaterialIssueReceipt,
  hydrateMaterialIssueReceiptsFromErp,
  listAcceptedDepartmentReceipts,
  listMaterialIssueReceipts,
  persistExternalMaterialIssueReceipt,
} from "./materialIssueReceipt";
import { sha256Hex } from "./legalEsign";
import { todayERPNextDate } from "../utils/erpNextDate";
import { captureSignatureTimestamp } from "../services/digitalSignatureService";
import type { MaterialIssueReceipt } from "../types/materialIssueReceipt";
import { normalizeReceiptStatus } from "../types/materialIssueReceipt";
import { parseMirSidecarsFromRemarks } from "../utils/warehouseIssueFulfillmentSync";

export type DepartmentIssuedFilter = {
  status?: "all" | "pending" | "accepted";
  mrName?: string;
  department?: string;
  dateFrom?: string;
  dateTo?: string;
};

function isPendingStatus(status: string): boolean {
  const s = normalizeReceiptStatus(status);
  return (
    s === "Pending Department Acceptance" ||
    s === "Waiting Warehouse Signature"
  );
}

function isAcceptedStatus(status: string): boolean {
  return normalizeReceiptStatus(status) === "Confirmed";
}

function promoteToPending(receipt: MaterialIssueReceipt): MaterialIssueReceipt {
  if (isAcceptedStatus(receipt.status) || isPendingStatus(receipt.status)) {
    if (
      receipt.status === "Waiting Warehouse Signature" ||
      !receipt.warehouse_signature
    ) {
      const now = captureSignatureTimestamp();
      receipt.status = "Pending Department Acceptance";
      receipt.warehouse_signed_at = receipt.warehouse_signed_at || now;
      receipt.warehouse_signature = receipt.warehouse_signature || {
        signer_name: receipt.issued_by || "Warehouse",
        role: "Warehouse Manager",
        signature_type: "typed",
        typed_name: receipt.issued_by || "Warehouse",
        signed_at: now,
        sha256_hash: "",
        document_hash: receipt.document_hash,
        verification_status: "verified",
        document_version: receipt.document_version,
      };
      persistExternalMaterialIssueReceipt(receipt);
    }
    return receipt;
  }
  return receipt;
}

async function ensureReceiptFromStockEntry(input: {
  stockEntry: string;
  mrName: string;
  department: string;
  warehouse: string;
  issueDate: string;
  issuedBy: string;
  receiver: string;
  issueType: string;
  items: MaterialIssueReceipt["items"];
  mrCompleted?: boolean;
}): Promise<MaterialIssueReceipt | null> {
  const existing =
    getMaterialIssueReceipt(input.stockEntry) ||
    listMaterialIssueReceipts().find(
      (r) =>
        r.stock_entry === input.stockEntry ||
        (r.mr_name === input.mrName &&
          String(r.stock_entry).includes(input.mrName)),
    );

  if (existing) {
    if (isAcceptedStatus(existing.status)) return existing;
    let changed = false;
    if (!existing.items?.length && input.items.length) {
      existing.items = input.items;
      changed = true;
    }
    if (
      !existing.department ||
      existing.department === "—" ||
      existing.department === "-"
    ) {
      existing.department = input.department || existing.department;
      changed = true;
    }
    if (!existing.warehouse || existing.warehouse === "—") {
      existing.warehouse = input.warehouse || existing.warehouse;
      changed = true;
    }
    promoteToPending(existing);
    if (changed) persistExternalMaterialIssueReceipt(existing);
    return existing;
  }

  if (!input.mrName || !input.stockEntry || !input.items.length) return null;

  const now = captureSignatureTimestamp();
  const issueNumber = `MIR-${input.stockEntry}`
    .replace(/[^A-Za-z0-9-]/g, "-")
    .slice(0, 40);
  const document_hash = await sha256Hex(
    `${issueNumber}:${input.stockEntry}:${input.mrName}`,
  );
  const receipt: MaterialIssueReceipt = {
    id: issueNumber,
    issue_number: issueNumber,
    stock_entry: input.stockEntry,
    mr_name: input.mrName,
    department: input.department || "General",
    warehouse: input.warehouse || "—",
    issue_date: input.issueDate || todayERPNextDate(),
    issued_by: input.issuedBy || "Warehouse",
    received_by: input.receiver || "Department User",
    issue_type: input.issueType || "Full Issue",
    status: input.mrCompleted ? "Confirmed" : "Pending Department Acceptance",
    items: input.items,
    document_hash,
    document_version: "1.0",
    verification_token: (await sha256Hex(`tok:${issueNumber}`)).slice(0, 24),
    created_at: now,
    modified: now,
    warehouse_signed_at: now,
    confirmed_at: input.mrCompleted ? now : undefined,
    warehouse_signature: {
      signer_name: input.issuedBy || "Warehouse",
      role: "Warehouse Manager",
      signature_type: "typed",
      typed_name: input.issuedBy || "Warehouse",
      signed_at: now,
      sha256_hash: "",
      document_hash,
      verification_status: "verified",
      document_version: "1.0",
    },
    audit_trail: [
      {
        id: `sync_${Date.now().toString(36)}`,
        action: "Synced from Stock Entry for Department Issued Items",
        at: now,
        by: "System",
        role: "System",
        detail: `Stock Entry ${input.stockEntry} · MR ${input.mrName}`,
      },
    ],
  };
  persistExternalMaterialIssueReceipt(receipt);
  return receipt;
}

async function syncFromStockEntries(
  mrByName: Map<string, MaterialRequestWorkflowRecord>,
): Promise<void> {
  try {
    const stockEntries = await apiGet<
      Array<{
        name: string;
        posting_date?: string;
        owner?: string;
        remarks?: string;
        from_warehouse?: string;
      }>
    >(buildResourceUrl("Stock Entry"), {
      ...buildListConfig({
        fields: [
          "name",
          "posting_date",
          "owner",
          "remarks",
          "from_warehouse",
        ],
        filters: [
          ["purpose", "=", "Material Issue"],
          ["docstatus", "=", 1],
        ],
        limit_page_length: 200,
        order_by: "creation desc",
      }),
    });
    if (!stockEntries?.length) return;

    const seNames = stockEntries.map((s) => s.name);
    const details = await apiGet<
      Array<{
        parent?: string;
        material_request?: string;
        item_code?: string;
        item_name?: string;
        qty?: number;
        uom?: string;
        s_warehouse?: string;
      }>
    >(buildResourceUrl("Stock Entry Detail"), {
      ...buildListConfig({
        fields: [
          "parent",
          "material_request",
          "item_code",
          "item_name",
          "qty",
          "uom",
          "s_warehouse",
        ],
        filters: [["parent", "in", seNames]],
        limit_page_length: 2000,
      }),
    });

    const linesBySe = new Map<string, NonNullable<typeof details>>();
    const mrBySe = new Map<string, string>();
    const whBySe = new Map<string, string>();
    for (const d of details || []) {
      if (!d.parent) continue;
      const arr = linesBySe.get(d.parent) || [];
      arr.push(d);
      linesBySe.set(d.parent, arr);
      if (d.material_request && !mrBySe.has(d.parent)) {
        mrBySe.set(d.parent, d.material_request);
      }
      if (d.s_warehouse && !whBySe.has(d.parent)) {
        whBySe.set(d.parent, d.s_warehouse);
      }
    }

    for (const se of stockEntries) {
      const mrName = mrBySe.get(se.name) || "";
      if (!mrName) continue;
      const mr = mrByName.get(mrName);
      const audit = parseMaterialIssueAudit(se.remarks);
      const lines = (linesBySe.get(se.name) || []).filter(
        (l) => l.item_code && Number(l.qty) > 0,
      );
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
      if (mr?.items?.length) {
        const byCode = new Map(mr.items.map((i) => [i.item_code, i]));
        for (const it of items) {
          const row = byCode.get(it.item_code);
          if (row) {
            it.requested_qty = Number(row.qty) || it.issued_qty;
            it.remaining_qty = Math.max(0, it.requested_qty - it.issued_qty);
            it.item_name = row.item_name || it.item_name;
            it.uom = row.uom || it.uom;
          }
        }
      }

      await ensureReceiptFromStockEntry({
        stockEntry: se.name,
        mrName,
        department:
          mr?.custom_department ||
          (mr as { department?: string } | undefined)?.department ||
          "General",
        warehouse:
          whBySe.get(se.name) ||
          se.from_warehouse ||
          audit?.audit?.warehouse ||
          "—",
        issueDate: se.posting_date || todayERPNextDate(),
        issuedBy: audit?.audit?.created_by || se.owner || "Warehouse",
        receiver: audit?.receiver || "Department User",
        issueType: audit?.issue_type || "Full Issue",
        items,
        mrCompleted:
          String(mr?.custom_bidsphere_status || "").trim() === "Completed",
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[departmentIssuedItems] Stock Entry sync failed (permissions?):",
      err,
    );
  }
}

async function syncFromFullMaterialRequests(
  mrs: MaterialRequestWorkflowRecord[],
): Promise<void> {
  const candidates = mrs
    .filter((mr) => {
      const st = String(mr.custom_bidsphere_status || mr.status || "");
      return (
        /Material Issued|Pending|Forwarded|Stock Available|Completed|RFQ/i.test(
          st,
        ) || Boolean(mr.custom_warehouse_remarks)
      );
    })
    .slice(0, 80);

  for (const row of candidates) {
    try {
      const mr = await fetchMaterialRequestWorkflow(row.name);
      const remarks = mr.custom_warehouse_remarks ?? mr.remarks ?? "";
      const sidecars = parseMirSidecarsFromRemarks(remarks);

      for (const side of sidecars) {
        if (!side.issue_number && !side.stock_entry) continue;
        const existing = getMaterialIssueReceipt(
          side.issue_number || side.stock_entry,
        );
        if (existing && isAcceptedStatus(existing.status)) continue;

        const status = normalizeReceiptStatus(side.status);
        const receipt: MaterialIssueReceipt = {
          id: side.id || side.issue_number,
          issue_number: side.issue_number,
          stock_entry: side.stock_entry,
          mr_name: side.mr_name || mr.name,
          department: side.department || mr.custom_department || "General",
          company:
            side.company ||
            (mr as { company?: string }).company ||
            undefined,
          warehouse: side.warehouse || "—",
          issue_date: side.issue_date || todayERPNextDate(),
          issued_by: side.issued_by || "Warehouse",
          received_by: side.received_by || "Department User",
          issue_type: side.issue_type || "Full Issue",
          status:
            status === "Waiting Warehouse Signature"
              ? "Pending Department Acceptance"
              : status,
          items: (side.items || []).map((i) => ({
            item_code: i.item_code,
            item_name: i.item_name || i.item_code,
            uom: i.uom || "Nos",
            requested_qty: Number(i.requested_qty) || 0,
            issued_qty: Number(i.issued_qty) || 0,
            remaining_qty: Number(i.remaining_qty) || 0,
          })),
          document_hash: side.document_hash || "",
          document_version: side.document_version || "1.0",
          verification_token: side.verification_token || "",
          created_at: side.created_at || captureSignatureTimestamp(),
          modified: side.modified || captureSignatureTimestamp(),
          confirmed_at: side.confirmed_at,
          warehouse_signed_at: side.warehouse_signed_at,
          department_signed_at: side.department_signed_at,
          department_remarks: side.department_remarks,
          acceptance_checklist: side.acceptance_checklist,
          warehouse_signature: side.warehouse_signer
            ? {
                signer_name: side.warehouse_signer,
                role: "Warehouse Manager",
                signature_type: "typed",
                typed_name: side.warehouse_signer,
                signed_at: side.warehouse_signed_at || side.created_at,
                sha256_hash: side.warehouse_sha256 || "",
                document_hash: side.document_hash || "",
                verification_status: "verified",
                document_version: side.document_version || "1.0",
              }
            : undefined,
          department_signature: side.department_signer
            ? {
                signer_name: side.department_signer,
                role: "Department User",
                signature_type: "typed",
                typed_name: side.department_signer,
                signed_at: side.department_signed_at || side.confirmed_at || "",
                sha256_hash: side.department_sha256 || "",
                document_hash: side.document_hash || "",
                verification_status: "verified",
                document_version: side.document_version || "1.0",
              }
            : undefined,
          audit_trail: existing?.audit_trail || [],
        };
        promoteToPending(receipt);
        persistExternalMaterialIssueReceipt(receipt);
      }

      if (sidecars.length === 0) {
        const audit = parseMaterialIssueAudit(remarks);
        const lines = audit?.lines || [];
        if (lines.length === 0) continue;
        if (listMaterialIssueReceipts().some((r) => r.mr_name === mr.name)) {
          continue;
        }
        const items = lines.map((l) => {
          const issued = Number(l.issue_qty) || 0;
          const requested = Number(l.required_qty) || issued;
          return {
            item_code: l.item_code,
            item_name: l.item_code,
            uom: "Nos",
            requested_qty: requested,
            issued_qty: issued,
            remaining_qty: Math.max(0, requested - issued),
          };
        });
        await ensureReceiptFromStockEntry({
          stockEntry: `MRISSUE-${mr.name}`,
          mrName: mr.name,
          department: mr.custom_department || "General",
          warehouse: audit?.audit?.warehouse || "—",
          issueDate: todayERPNextDate(),
          issuedBy: audit?.audit?.created_by || "Warehouse",
          receiver: audit?.receiver || "Department User",
          issueType: audit?.issue_type || "Full Issue",
          items,
          mrCompleted:
            String(mr.custom_bidsphere_status || "").trim() === "Completed",
        });
      }
    } catch {
      /* skip MR */
    }
  }
}

/** Full sync used by Department Issued Items pages + KPIs. */
export async function syncDepartmentIssuedItems(): Promise<{
  total: number;
  pending: number;
  accepted: number;
}> {
  await hydrateMaterialIssueReceiptsFromErp();

  const mrs = await listMaterialRequestsWorkflow({
    docstatus: 1,
    limit: 500,
  });
  const mrByName = new Map(mrs.map((m) => [m.name, m]));

  await syncFromFullMaterialRequests(mrs);
  await syncFromStockEntries(mrByName);

  // Promote any leftover Waiting Warehouse Signature → Pending for department.
  for (const r of listMaterialIssueReceipts()) {
    if (r.status === "Waiting Warehouse Signature") promoteToPending(r);
  }

  const all = listMaterialIssueReceipts();
  return {
    total: all.length,
    pending: all.filter((r) => isPendingStatus(r.status)).length,
    accepted: all.filter((r) => isAcceptedStatus(r.status)).length,
  };
}

function applyFilters(
  rows: MaterialIssueReceipt[],
  filter?: DepartmentIssuedFilter,
): MaterialIssueReceipt[] {
  let out = [...rows];
  const status = filter?.status || "all";
  if (status === "pending") out = out.filter((r) => isPendingStatus(r.status));
  else if (status === "accepted") {
    out = out.filter((r) => isAcceptedStatus(r.status));
  }
  const mr = (filter?.mrName || "").trim().toLowerCase();
  if (mr) out = out.filter((r) => r.mr_name.toLowerCase().includes(mr));
  const dept = (filter?.department || "").trim().toLowerCase();
  if (dept) {
    out = out.filter((r) =>
      String(r.department || "")
        .toLowerCase()
        .includes(dept),
    );
  }
  const from = (filter?.dateFrom || "").trim();
  const to = (filter?.dateTo || "").trim();
  if (from) {
    out = out.filter((r) => String(r.issue_date || "").slice(0, 10) >= from);
  }
  if (to) {
    out = out.filter((r) => String(r.issue_date || "").slice(0, 10) <= to);
  }
  return out.sort((a, b) =>
    String(b.modified || b.created_at || "").localeCompare(
      String(a.modified || a.created_at || ""),
    ),
  );
}

export async function listDepartmentPendingAcceptance(): Promise<
  MaterialIssueReceipt[]
> {
  await syncDepartmentIssuedItems();
  return applyFilters(listMaterialIssueReceipts(), { status: "pending" });
}

export async function listDepartmentAcceptedItems(): Promise<
  MaterialIssueReceipt[]
> {
  await syncDepartmentIssuedItems();
  return applyFilters(listAcceptedDepartmentReceipts(), { status: "accepted" });
}

export async function listDepartmentIssueReceipts(
  filter?: DepartmentIssuedFilter,
): Promise<MaterialIssueReceipt[]> {
  await syncDepartmentIssuedItems();
  return applyFilters(listMaterialIssueReceipts(), filter || { status: "all" });
}

export async function countDepartmentPendingAcceptance(): Promise<number> {
  const rows = await listDepartmentPendingAcceptance();
  return rows.length;
}

export async function countDepartmentAcceptedItems(): Promise<number> {
  const rows = await listDepartmentAcceptedItems();
  return rows.length;
}

export function departmentReceiptStatusLabel(status: string): string {
  const s = normalizeReceiptStatus(status);
  if (
    s === "Pending Department Acceptance" ||
    s === "Waiting Warehouse Signature"
  ) {
    return "Waiting for Department Acceptance";
  }
  if (s === "Confirmed") return "Accepted";
  return s;
}
