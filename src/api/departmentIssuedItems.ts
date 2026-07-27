/**
 * Department Issued Items — single data source for:
 *   Pending Acceptance · Issue Receipts · Dashboard KPIs
 *
 * Performance model:
 *   1) Render from localStorage cache immediately (< 1s)
 *   2) ERP sync runs in the background (deduped, 45s TTL, 5s soft timeout)
 *   3) UI refreshes when sync completes
 *
 * Sync sources:
 *   1) localStorage cache
 *   2) Material Request MIR tags (list query — no N+1 get_doc)
 *   3) ERPNext Stock Entry (Material Issue) — 2 list calls, not per-receipt
 */

import { apiGet, buildListConfig, buildResourceUrl } from "./erpnext";
import {
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

export type DepartmentIssuedFilter = {
  status?: "all" | "pending" | "accepted";
  mrName?: string;
  department?: string;
  dateFrom?: string;
  dateTo?: string;
};

const SYNC_CACHE_TTL_MS = 45_000;
const SYNC_SOFT_TIMEOUT_MS = 5_000;

type PerfEntry = {
  url: string;
  start: number;
  end: number;
  durationMs: number;
  ok: boolean;
  error?: string;
};

let lastSyncAt = 0;
let syncInflight: Promise<{
  total: number;
  pending: number;
  accepted: number;
}> | null = null;
let lastSyncBackground = false;
const syncListeners = new Set<() => void>();

/** Subscribe to background sync completion (for React Query invalidation). */
export function onDepartmentIssuedItemsSynced(cb: () => void): () => void {
  syncListeners.add(cb);
  return () => {
    syncListeners.delete(cb);
  };
}

function notifySynced() {
  for (const cb of syncListeners) {
    try {
      cb();
    } catch {
      /* ignore listener errors */
    }
  }
}

function isSyncCacheFresh(): boolean {
  return lastSyncAt > 0 && Date.now() - lastSyncAt < SYNC_CACHE_TTL_MS;
}

/** True while a background sync is running (for UI banner). */
export function isDepartmentIssuedSyncInProgress(): boolean {
  return Boolean(syncInflight);
}

export function wasDepartmentIssuedSyncTimedOut(): boolean {
  return lastSyncBackground;
}

async function timedApi<T>(
  label: string,
  url: string,
  fn: () => Promise<T>,
  log: PerfEntry[],
): Promise<T> {
  const start = performance.now();
  // eslint-disable-next-line no-console
  console.log(`[DeptIssued Perf] START ${label}`, { url, startTime: start });
  try {
    const result = await fn();
    const end = performance.now();
    const entry: PerfEntry = {
      url: `${label} ${url}`,
      start,
      end,
      durationMs: Math.round(end - start),
      ok: true,
    };
    log.push(entry);
    // eslint-disable-next-line no-console
    console.log(`[DeptIssued Perf] END ${label}`, {
      url,
      endTime: end,
      durationMs: entry.durationMs,
    });
    return result;
  } catch (err) {
    const end = performance.now();
    const entry: PerfEntry = {
      url: `${label} ${url}`,
      start,
      end,
      durationMs: Math.round(end - start),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    log.push(entry);
    // eslint-disable-next-line no-console
    console.error(`[DeptIssued Perf] FAIL ${label}`, {
      url,
      durationMs: entry.durationMs,
      error: entry.error,
    });
    throw err;
  }
}

function logPerfSummary(pageStart: number, log: PerfEntry[], label: string) {
  const totalMs = Math.round(performance.now() - pageStart);
  const slowest = [...log].sort((a, b) => b.durationMs - a.durationMs)[0];
  // eslint-disable-next-line no-console
  console.log(`[DeptIssued Perf] ${label} SUMMARY`, {
    totalPageLoadMs: totalMs,
    apiCount: log.length,
    apiDurations: log.map((e) => ({
      url: e.url,
      durationMs: e.durationMs,
      ok: e.ok,
    })),
    slowestApi: slowest
      ? { url: slowest.url, durationMs: slowest.durationMs }
      : null,
  });
  if (slowest && slowest.durationMs >= 1000) {
    // eslint-disable-next-line no-console
    console.warn(
      `[DeptIssued Perf] SLOWEST API causing delay: ${slowest.url} (${slowest.durationMs}ms)`,
    );
  }
}

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
  perfLog: PerfEntry[],
): Promise<void> {
  try {
    const stockEntries = await timedApi(
      "Stock Entry list",
      "/api/resource/Stock Entry",
      () =>
        apiGet<
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
        }),
      perfLog,
    );
    if (!stockEntries?.length) return;

    const seNames = stockEntries.map((s) => s.name);
    const details = await timedApi(
      "Stock Entry Detail batch",
      "/api/resource/Stock Entry Detail",
      () =>
        apiGet<
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
        }),
      perfLog,
    );

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

    // Parallel receipt upserts — no await-per-receipt ERP calls.
    await Promise.all(
      stockEntries.map(async (se) => {
        const mrName = mrBySe.get(se.name) || "";
        if (!mrName) return;
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
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[departmentIssuedItems] Stock Entry sync failed (permissions?):",
      err,
    );
  }
}

/**
 * Full ERP sync (deduped). Prefer calling via scheduleBackgroundSync /
 * list* helpers so the page is never blocked on this.
 */
export async function syncDepartmentIssuedItems(): Promise<{
  total: number;
  pending: number;
  accepted: number;
}> {
  if (syncInflight) return syncInflight;
  if (isSyncCacheFresh()) {
    const all = listMaterialIssueReceipts();
    return {
      total: all.length,
      pending: all.filter((r) => isPendingStatus(r.status)).length,
      accepted: all.filter((r) => isAcceptedStatus(r.status)).length,
    };
  }

  const pageStart = performance.now();
  const perfLog: PerfEntry[] = [];

  syncInflight = (async () => {
    try {
      // One MR list, then hydrate (list-only) + Stock Entry batch in parallel.
      const mrs = await timedApi(
        "Material Request list",
        "/api/resource/Material Request",
        () =>
          listMaterialRequestsWorkflow({
            docstatus: 1,
            limit: 500,
          }),
        perfLog,
      );

      const mrByName = new Map(mrs.map((m) => [m.name, m]));
      await Promise.all([
        timedApi(
          "hydrate MIR from ERP",
          "hydrateMaterialIssueReceiptsFromErp",
          () =>
            hydrateMaterialIssueReceiptsFromErp({
              skipPerDocFetch: true,
              preloadedRows: mrs,
            }),
          perfLog,
        ),
        syncFromStockEntries(mrByName, perfLog),
      ]);

      for (const r of listMaterialIssueReceipts()) {
        if (r.status === "Waiting Warehouse Signature") promoteToPending(r);
      }

      lastSyncAt = Date.now();
      lastSyncBackground = false;
      const all = listMaterialIssueReceipts();
      const summary = {
        total: all.length,
        pending: all.filter((r) => isPendingStatus(r.status)).length,
        accepted: all.filter((r) => isAcceptedStatus(r.status)).length,
      };
      logPerfSummary(pageStart, perfLog, "syncDepartmentIssuedItems");
      notifySynced();
      return summary;
    } finally {
      syncInflight = null;
    }
  })();

  return syncInflight;
}

/**
 * Kick off sync without blocking. Soft-timeout at 5s marks UI as
 * "Background sync in progress..." while work continues.
 */
export function scheduleDepartmentIssuedBackgroundSync(): void {
  if (isSyncCacheFresh() || syncInflight) return;
  const started = syncDepartmentIssuedItems();
  void Promise.race([
    started.then(() => "done" as const),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), SYNC_SOFT_TIMEOUT_MS),
    ),
  ]).then((result) => {
    if (result === "timeout") {
      lastSyncBackground = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[DeptIssued Perf] Sync exceeded 5s — showing cached data. Background sync in progress...",
      );
      notifySynced();
    }
  });
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

/** Synchronous local read — never hits ERP. */
export function listDepartmentPendingAcceptanceLocal(): MaterialIssueReceipt[] {
  return applyFilters(listMaterialIssueReceipts(), { status: "pending" });
}

export function listDepartmentAcceptedItemsLocal(): MaterialIssueReceipt[] {
  return applyFilters(listAcceptedDepartmentReceipts(), { status: "accepted" });
}

export function listDepartmentIssueReceiptsLocal(
  filter?: DepartmentIssuedFilter,
): MaterialIssueReceipt[] {
  return applyFilters(listMaterialIssueReceipts(), filter || { status: "all" });
}

/**
 * Cache-first list. Returns local data immediately and schedules background sync.
 * Does NOT await ERP before resolving — page can render in < 1s.
 */
export async function listDepartmentPendingAcceptance(): Promise<
  MaterialIssueReceipt[]
> {
  const pageStart = performance.now();
  const local = listDepartmentPendingAcceptanceLocal();
  scheduleDepartmentIssuedBackgroundSync();
  // eslint-disable-next-line no-console
  console.log("[DeptIssued Perf] listDepartmentPendingAcceptance (cache-first)", {
    localCount: local.length,
    durationMs: Math.round(performance.now() - pageStart),
    syncInProgress: Boolean(syncInflight),
    cacheFresh: isSyncCacheFresh(),
  });
  return local;
}

export async function listDepartmentAcceptedItems(): Promise<
  MaterialIssueReceipt[]
> {
  const local = listDepartmentAcceptedItemsLocal();
  scheduleDepartmentIssuedBackgroundSync();
  return local;
}

export async function listDepartmentIssueReceipts(
  filter?: DepartmentIssuedFilter,
): Promise<MaterialIssueReceipt[]> {
  const local = listDepartmentIssueReceiptsLocal(filter);
  scheduleDepartmentIssuedBackgroundSync();
  return local;
}

export async function countDepartmentPendingAcceptance(): Promise<number> {
  scheduleDepartmentIssuedBackgroundSync();
  return listDepartmentPendingAcceptanceLocal().length;
}

export async function countDepartmentAcceptedItems(): Promise<number> {
  scheduleDepartmentIssuedBackgroundSync();
  return listDepartmentAcceptedItemsLocal().length;
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
