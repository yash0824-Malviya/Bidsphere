/**
 * Ensures Reverse Bidding child DocTypes use hash autoname so bid history rows
 * receive unique names when the parent Reverse Bidding document is saved.
 */
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";

const CHILD_DOCTYPES = [
  "Reverse Bidding Supplier",
  "Reverse Bids",
  "Reverse Bid Item",
] as const;

export class ReverseBiddingNamingError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ReverseBiddingNamingError";
    this.status = status;
  }
}

type ErpAdminConfig = { baseUrl: string; key: string; secret: string };

type DocTypeMeta = {
  name?: string;
  autoname?: string;
  naming_rule?: string;
  custom?: number;
};

function readErpAdminConfig(): ErpAdminConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

  if (!baseUrl || !key || !secret) {
    throw new ReverseBiddingNamingError(
      "Reverse Bidding naming backend misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET.",
      500,
    );
  }
  return { baseUrl, key, secret };
}

function extractErpErrorMessage(json: unknown, fallback: string): string {
  const data = (json ?? {}) as {
    exception?: string;
    message?: string | { message?: string };
    _server_messages?: string;
  };
  if (data._server_messages) {
    try {
      const parsed = JSON.parse(data._server_messages) as string[];
      const first = parsed[0] ? JSON.parse(parsed[0]) : null;
      if (first?.message) return String(first.message);
    } catch {
      /* keep */
    }
  }
  if (typeof data.exception === "string" && data.exception.trim()) {
    return data.exception.replace(/^[^:]+:\s*/, "").trim();
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  return fallback;
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown; search?: Record<string, string> },
): Promise<T> {
  const qs = init?.search
    ? `?${new URLSearchParams(init.search).toString()}`
    : "";
  const url = `${cfg.baseUrl}/api/${path}${qs}`;

  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `token ${cfg.key}:${cfg.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body:
      init?.body !== undefined
        ? JSON.stringify(sanitizeErpPayloadDates(init.body))
        : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new ReverseBiddingNamingError(
      extractErpErrorMessage(json, text || `ERPNext request failed (${res.status})`),
      res.status >= 400 && res.status < 600 ? res.status : 502,
    );
  }

  const wrapped = json as { data?: T; message?: T };
  return (
    wrapped?.data !== undefined
      ? wrapped.data
      : wrapped?.message !== undefined
        ? wrapped.message
        : (json as T)
  );
}

async function loadDocTypeMeta(
  cfg: ErpAdminConfig,
  doctype: string,
): Promise<DocTypeMeta> {
  return erpFetch<DocTypeMeta>(
    cfg,
    `resource/DocType/${encodeURIComponent(doctype)}`,
    {
      search: {
        fields: JSON.stringify(["name", "autoname", "naming_rule", "custom"]),
      },
    },
  );
}

async function ensureHashAutoname(
  cfg: ErpAdminConfig,
  doctype: string,
): Promise<{ doctype: string; updated: boolean; autoname: string }> {
  const meta = await loadDocTypeMeta(cfg, doctype);
  const currentAutoname = String(meta.autoname ?? "").trim();
  const currentRule = String(meta.naming_rule ?? "").trim();

  if (currentAutoname === "hash" && currentRule === "Random") {
    return { doctype, updated: false, autoname: "hash" };
  }

  await erpFetch(cfg, `resource/DocType/${encodeURIComponent(doctype)}`, {
    method: "PUT",
    body: {
      autoname: "hash",
      naming_rule: "Random",
    },
  });

  try {
    await erpFetch(cfg, "method/frappe.clear_cache", { method: "POST", body: {} });
  } catch {
    /* optional */
  }

  return { doctype, updated: true, autoname: "hash" };
}

let ensuredOnce = false;

export async function ensureReverseBiddingChildNaming(): Promise<{
  success: true;
  results: Array<{ doctype: string; updated: boolean; autoname: string }>;
}> {
  if (ensuredOnce) {
    return {
      success: true,
      results: CHILD_DOCTYPES.map((doctype) => ({
        doctype,
        updated: false,
        autoname: "hash",
      })),
    };
  }

  const cfg = readErpAdminConfig();
  const results: Array<{ doctype: string; updated: boolean; autoname: string }> =
    [];

  for (const doctype of CHILD_DOCTYPES) {
    results.push(await ensureHashAutoname(cfg, doctype));
  }

  ensuredOnce = true;
  return { success: true, results };
}

/** Test hook — reset in-process cache between runs. */
export function resetReverseBiddingNamingCache(): void {
  ensuredOnce = false;
}
