/**
 * Access Logs API — fetches authentication and security events from ERPNext.
 *
 * Queries "Activity Log" filtered to auth-related operations (login, logout,
 * password reset, role changes, user enable/disable).
 */

import { apiGet, buildResourceUrl, buildListConfig, withSilent } from "./erpnext";
import type { Filter } from "./erpnext";

export interface AccessLogEntry {
  name: string;
  timestamp: string;
  user: string;
  fullName: string;
  role: string;
  ipAddress: string;
  action: string;
  status: "success" | "failed" | "info";
}

export interface AccessLogFilters {
  dateFrom?: string;
  dateTo?: string;
  user?: string;
  action?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

const PAGE_SIZE = 60;

const AUTH_KEYWORDS = [
  "login", "logout", "session", "password", "reset",
  "role", "enabled", "disabled", "locked", "failed",
];

function isAuthEvent(subject: string, operation?: string): boolean {
  const text = `${subject} ${operation ?? ""}`.toLowerCase();
  return AUTH_KEYWORDS.some((kw) => text.includes(kw));
}

function resolveAction(subject: string, operation?: string): string {
  const text = `${subject} ${operation ?? ""}`.toLowerCase();
  if (text.includes("login") && text.includes("fail")) return "Failed Login";
  if (text.includes("logout")) return "Logout";
  if (text.includes("login")) return "Login";
  if (text.includes("password") && text.includes("reset")) return "Password Reset";
  if (text.includes("role")) return "Role Change";
  if (text.includes("disabled") || text.includes("enabled")) return "User Status Change";
  if (text.includes("locked")) return "Account Locked";
  if (text.includes("session")) return "Session Event";
  return subject.replace(/<[^>]*>/g, "").trim().slice(0, 80) || operation || "—";
}

function resolveStatus(subject: string, operation?: string): "success" | "failed" | "info" {
  const text = `${subject} ${operation ?? ""}`.toLowerCase();
  if (text.includes("fail") || text.includes("locked") || text.includes("disabled")) return "failed";
  if (text.includes("login") || text.includes("enabled") || text.includes("success")) return "success";
  return "info";
}

function resolveRole(user: string): string {
  const lower = user.toLowerCase();
  if (lower === "administrator" || lower.includes("admin")) return "Administrator";
  if (lower.includes("procurement") || lower.includes("purchase")) return "Procurement";
  if (lower.includes("finance") || lower.includes("account")) return "Finance";
  if (lower.includes("warehouse") || lower.includes("stock")) return "Warehouse";
  if (lower.includes("legal")) return "Legal";
  return "User";
}

export async function getAccessLogs(filters: AccessLogFilters = {}): Promise<{
  entries: AccessLogEntry[];
  total: number;
}> {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? PAGE_SIZE;

  const erpFilters: Filter[] = [];

  if (filters.dateFrom) erpFilters.push(["creation", ">=", filters.dateFrom]);
  if (filters.dateTo) erpFilters.push(["creation", "<=", `${filters.dateTo} 23:59:59`]);
  if (filters.user) erpFilters.push(["owner", "like", `%${filters.user}%`]);
  if (filters.search) erpFilters.push(["owner", "like", `%${filters.search}%`]);

  const fields = [
    "name", "creation", "owner", "full_name",
    "subject", "operation", "status",
  ];

  try {
    const raw = await apiGet<Array<{
      name: string;
      creation: string;
      owner: string;
      full_name?: string;
      subject?: string;
      operation?: string;
      status?: string;
    }>>(
      buildResourceUrl("Activity Log"),
      {
        ...buildListConfig({
          fields,
          filters: erpFilters.length > 0 ? erpFilters : undefined,
          order_by: "creation desc",
          limit_page_length: pageSize * 3,
          limit_start: 0,
        }),
        ...withSilent(),
      }
    );

    let entries: AccessLogEntry[] = (raw ?? [])
      .filter((r) => isAuthEvent(r.subject ?? "", r.operation))
      .map((r) => {
        const subject = r.subject ?? "";
        return {
          name: r.name,
          timestamp: r.creation,
          user: r.owner ?? "—",
          fullName: r.full_name || r.owner || "—",
          role: resolveRole(r.owner ?? ""),
          ipAddress: extractIP(subject),
          action: resolveAction(subject, r.operation),
          status: resolveStatus(subject, r.operation),
        };
      });

    if (filters.action && filters.action !== "All") {
      entries = entries.filter((e) =>
        e.action.toLowerCase().includes(filters.action!.toLowerCase())
      );
    }
    if (filters.status && filters.status !== "All") {
      entries = entries.filter((e) => e.status === filters.status);
    }

    const paged = entries.slice(page * pageSize, (page + 1) * pageSize);
    return { entries: paged, total: entries.length };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[AccessLogs] Failed to fetch:", err);
    return { entries: [], total: 0 };
  }
}

function extractIP(subject: string): string {
  const match = subject.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  return match?.[1] ?? "Localhost (127.0.0.1)";
}

export async function getAccessLogUsers(): Promise<string[]> {
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
