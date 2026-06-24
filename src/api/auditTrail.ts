/**
 * Audit Trail API — fetches activity logs from ERPNext.
 *
 * ERPNext stores system activity in two DocTypes:
 *   - "Activity Log"  — user actions, logins, doc changes
 *   - "Version"        — field-level change tracking
 *
 * This service queries "Activity Log" and normalises results into a
 * flat `AuditEntry` shape the UI can render directly.
 */

import { apiGet, buildResourceUrl, buildListConfig, withSilent } from "./erpnext";
import type { Filter } from "./erpnext";

export interface AuditEntry {
  name: string;
  timestamp: string;
  user: string;
  email: string;
  fullName: string;
  role: string;
  module: string;
  doctype: string;
  documentId: string;
  action: string;
  remarks: string;
  previousValue?: string;
  newValue?: string;
}

export interface AuditFilters {
  dateFrom?: string;
  dateTo?: string;
  user?: string;
  module?: string;
  action?: string;
  search?: string;
  doctype?: string;
  page?: number;
  pageSize?: number;
}

const PAGE_SIZE = 50;

const DOCTYPE_TO_MODULE: Record<string, string> = {
  "Request for Quotation": "Sourcing",
  "Supplier Quotation": "Sourcing",
  "Purchase Order": "P2P",
  "Purchase Receipt": "Warehouse",
  "Purchase Invoice": "Finance",
  "Material Request": "P2P",
  "Payment Entry": "Finance",
  "Journal Entry": "Finance",
  User: "Admin",
};

function resolveModule(doctype: string, action: string): string {
  if (/login|logout|session/i.test(action)) return "Auth";
  return DOCTYPE_TO_MODULE[doctype] ?? "System";
}

/**
 * Maps known BidSphere user emails to display names and roles.
 * Falls back to "System" for the ERP admin catch-all account.
 */
const USER_DISPLAY_MAP: Record<string, { name: string; role: string }> = {
  "finance@netlink.com":      { name: "Finance Team",         role: "Finance Manager" },
  "procurement@netlink.com":  { name: "Procurement Manager",  role: "Procurement Manager" },
  "warehouse@netlink.com":    { name: "Warehouse",            role: "Warehouse Manager" },
  "legal@netlink.com":        { name: "Legal Reviewer",       role: "Legal Reviewer" },
  "admin@netlink.com":        { name: "Admin",                role: "Administrator" },
  "administrator":            { name: "System",               role: "System" },
};

function resolveUserDisplay(owner: string, fullName?: string): { displayName: string; email: string; role: string } {
  const email = (owner ?? "").toLowerCase().trim();

  const mapped = USER_DISPLAY_MAP[email];
  if (mapped) return { displayName: mapped.name, email: owner, role: mapped.role };

  for (const [pattern, info] of Object.entries(USER_DISPLAY_MAP)) {
    if (email.includes(pattern)) return { displayName: info.name, email: owner, role: info.role };
  }

  if (fullName && fullName !== owner) {
    const role = inferRoleFromEmail(email);
    return { displayName: fullName, email: owner, role };
  }

  if (/admin/i.test(email)) return { displayName: "System", email: owner, role: "System" };

  return { displayName: owner || "System", email: owner || "—", role: inferRoleFromEmail(email) };
}

function inferRoleFromEmail(email: string): string {
  const e = email.toLowerCase();
  if (e.includes("procurement") || e.includes("purchase")) return "Procurement";
  if (e.includes("finance") || e.includes("account")) return "Finance";
  if (e.includes("warehouse") || e.includes("stock")) return "Warehouse";
  if (e.includes("legal")) return "Legal";
  if (e.includes("admin")) return "Administrator";
  return "User";
}

function normaliseAction(raw: string): string {
  if (!raw) return "—";
  const cleaned = raw
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length > 120) return cleaned.slice(0, 117) + "…";
  return cleaned;
}

export async function getAuditTrail(filters: AuditFilters = {}): Promise<{
  entries: AuditEntry[];
  total: number;
}> {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? PAGE_SIZE;

  const erpFilters: Filter[] = [];

  if (filters.dateFrom) {
    erpFilters.push(["creation", ">=", filters.dateFrom]);
  }
  if (filters.dateTo) {
    erpFilters.push(["creation", "<=", `${filters.dateTo} 23:59:59`]);
  }
  if (filters.user) {
    erpFilters.push(["owner", "like", `%${filters.user}%`]);
  }
  if (filters.action) {
    erpFilters.push(["subject", "like", `%${filters.action}%`]);
  }
  if (filters.search) {
    erpFilters.push(["reference_name", "like", `%${filters.search}%`]);
  }
  if (filters.doctype) {
    erpFilters.push(["reference_doctype", "=", filters.doctype]);
  }

  const fields = [
    "name",
    "creation",
    "owner",
    "full_name",
    "reference_doctype",
    "reference_name",
    "subject",
    "content",
    "operation",
  ];

  try {
    const raw = await apiGet<
      Array<{
        name: string;
        creation: string;
        owner: string;
        full_name?: string;
        reference_doctype?: string;
        reference_name?: string;
        subject?: string;
        content?: string;
        operation?: string;
      }>
    >(
      buildResourceUrl("Activity Log"),
      {
        ...buildListConfig({
          fields,
          filters: erpFilters.length > 0 ? erpFilters : undefined,
          order_by: "creation desc",
          limit_page_length: pageSize,
          limit_start: page * pageSize,
        }),
        ...withSilent(),
      }
    );

    const entries: AuditEntry[] = (raw ?? []).map((r) => {
      const doctype = r.reference_doctype ?? "";
      const action = normaliseAction(r.subject ?? r.operation ?? "");
      const resolved = resolveUserDisplay(r.owner ?? "", r.full_name);
      return {
        name: r.name,
        timestamp: r.creation,
        user: resolved.displayName,
        email: resolved.email,
        fullName: resolved.displayName,
        role: resolved.role,
        module: resolveModule(doctype, action),
        doctype,
        documentId: r.reference_name ?? "—",
        action,
        remarks: r.content
          ? r.content.replace(/<[^>]*>/g, "").trim().slice(0, 200)
          : "",
      };
    });

    if (filters.module) {
      const filtered = entries.filter(
        (e) => e.module.toLowerCase() === filters.module!.toLowerCase()
      );
      return { entries: filtered, total: filtered.length };
    }

    return { entries, total: entries.length };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[AuditTrail] Failed to fetch activity logs:", err);
    return { entries: [], total: 0 };
  }
}

const PROCUREMENT_DOCTYPES = [
  "Request for Quotation",
  "Supplier Quotation",
  "Purchase Order",
  "Purchase Receipt",
  "Purchase Invoice",
  "Payment Entry",
  "Material Request",
  "Supplier",
];

export async function getProcurementAuditTrail(filters: AuditFilters = {}): Promise<{
  entries: AuditEntry[];
  total: number;
}> {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? PAGE_SIZE;

  const erpFilters: Filter[] = [];

  if (filters.doctype) {
    erpFilters.push(["reference_doctype", "=", filters.doctype]);
  } else {
    erpFilters.push(["reference_doctype", "in", PROCUREMENT_DOCTYPES]);
  }
  if (filters.dateFrom) erpFilters.push(["creation", ">=", filters.dateFrom]);
  if (filters.dateTo) erpFilters.push(["creation", "<=", `${filters.dateTo} 23:59:59`]);
  if (filters.user) erpFilters.push(["owner", "like", `%${filters.user}%`]);
  if (filters.action) erpFilters.push(["subject", "like", `%${filters.action}%`]);
  if (filters.search) erpFilters.push(["reference_name", "like", `%${filters.search}%`]);

  const fields = [
    "name", "creation", "owner", "full_name",
    "reference_doctype", "reference_name",
    "subject", "content", "operation",
  ];

  try {
    const [activityLogs, versionLogs] = await Promise.all([
      apiGet<Array<{
        name: string; creation: string; owner: string; full_name?: string;
        reference_doctype?: string; reference_name?: string;
        subject?: string; content?: string; operation?: string;
      }>>(
        buildResourceUrl("Activity Log"),
        { ...buildListConfig({ fields, filters: erpFilters, order_by: "creation desc", limit_page_length: pageSize, limit_start: page * pageSize }), ...withSilent() }
      ).catch(() => [] as never[]),

      fetchVersionLogs(filters, pageSize, page),
    ]);

    const activityEntries: AuditEntry[] = (activityLogs ?? []).map((r) => {
      const doctype = r.reference_doctype ?? "";
      const action = normaliseAction(r.subject ?? r.operation ?? "");
      const resolved = resolveUserDisplay(r.owner ?? "", r.full_name);
      return {
        name: r.name,
        timestamp: r.creation,
        user: resolved.displayName,
        email: resolved.email,
        fullName: resolved.displayName,
        role: resolved.role,
        module: resolveModule(doctype, action),
        doctype,
        documentId: r.reference_name ?? "—",
        action,
        remarks: r.content ? r.content.replace(/<[^>]*>/g, "").trim().slice(0, 200) : "",
      };
    });

    const merged = [...activityEntries, ...versionLogs]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, pageSize);

    if (filters.module) {
      const filtered = merged.filter((e) => e.module.toLowerCase() === filters.module!.toLowerCase());
      return { entries: filtered, total: filtered.length };
    }

    return { entries: merged, total: merged.length };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ProcurementAudit] Failed to fetch logs:", err);
    return { entries: [], total: 0 };
  }
}

async function fetchVersionLogs(
  filters: AuditFilters,
  pageSize: number,
  page: number
): Promise<AuditEntry[]> {
  try {
    const vFilters: Filter[] = [];
    if (filters.doctype) {
      vFilters.push(["ref_doctype", "=", filters.doctype]);
    } else {
      vFilters.push(["ref_doctype", "in", PROCUREMENT_DOCTYPES]);
    }
    if (filters.dateFrom) vFilters.push(["creation", ">=", filters.dateFrom]);
    if (filters.dateTo) vFilters.push(["creation", "<=", `${filters.dateTo} 23:59:59`]);
    if (filters.user) vFilters.push(["owner", "like", `%${filters.user}%`]);
    if (filters.search) vFilters.push(["docname", "like", `%${filters.search}%`]);

    const raw = await apiGet<Array<{
      name: string; creation: string; owner: string;
      ref_doctype?: string; docname?: string; data?: string;
    }>>(
      buildResourceUrl("Version"),
      {
        ...buildListConfig({
          fields: ["name", "creation", "owner", "ref_doctype", "docname", "data"],
          filters: vFilters,
          order_by: "creation desc",
          limit_page_length: pageSize,
          limit_start: page * pageSize,
        }),
        ...withSilent(),
      }
    );

    const entries: AuditEntry[] = [];
    for (const v of raw ?? []) {
      const doctype = v.ref_doctype ?? "";
      let changes: Array<{ field: string; old: string; new_val: string }> = [];
      if (v.data) {
        try {
          const parsed = JSON.parse(v.data);
          if (parsed.changed && Array.isArray(parsed.changed)) {
            changes = parsed.changed.map((c: [string, unknown, unknown]) => ({
              field: String(c[0] ?? ""),
              old: String(c[1] ?? ""),
              new_val: String(c[2] ?? ""),
            }));
          }
        } catch { /* malformed JSON — skip */ }
      }

      const resolved = resolveUserDisplay(v.owner ?? "");

      if (changes.length === 0) {
        entries.push({
          name: v.name,
          timestamp: v.creation,
          user: resolved.displayName,
          email: resolved.email,
          fullName: resolved.displayName,
          role: resolved.role,
          module: resolveModule(doctype, "Updated"),
          doctype,
          documentId: v.docname ?? "—",
          action: "Updated",
          remarks: "",
        });
      } else {
        for (const ch of changes.slice(0, 5)) {
          entries.push({
            name: `${v.name}-${ch.field}`,
            timestamp: v.creation,
            user: resolved.displayName,
            email: resolved.email,
            fullName: resolved.displayName,
            role: resolved.role,
            module: resolveModule(doctype, "Field Changed"),
            doctype,
            documentId: v.docname ?? "—",
            action: `${ch.field} changed`,
            remarks: "",
            previousValue: ch.old.slice(0, 100),
            newValue: ch.new_val.slice(0, 100),
          });
        }
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export async function getAuditUsers(): Promise<string[]> {
  try {
    const raw = await apiGet<Array<{ owner: string }>>(
      buildResourceUrl("Activity Log"),
      {
        ...buildListConfig({
          fields: ["distinct owner as owner"],
          limit_page_length: 200,
        }),
        ...withSilent(),
      }
    );
    return [...new Set((raw ?? []).map((r) => r.owner).filter(Boolean))];
  } catch {
    return [];
  }
}
