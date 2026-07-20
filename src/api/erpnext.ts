import axios, { AxiosError } from "axios";
import type {
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import toast from "react-hot-toast";

import { handleSessionExpired } from "../store/sessionExpiry";
import { readErpProxyAccessToken } from "../utils/accessToken";

import { COMPANY_NAME } from "../config/branding";

export const ENV_DEFAULTS = {
  company: (import.meta.env.VITE_COMPANY as string | undefined) ?? "",
};

/**
 * Company used on every ERPNext write. Prefer `VITE_COMPANY` at build time;
 * fall back to the branded Netlink company — never a stale "Inteva" default
 * (that company has no warehouses on this site, so stock-item MRs fail with
 * "Warehouse is mandatory for stock Item …").
 */
export const COMPANY = ENV_DEFAULTS.company.trim() || COMPANY_NAME;

const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;
const API_SECRET = import.meta.env.VITE_API_SECRET as string | undefined;

/**
 * Same-origin `/api/*` requests — proxied to ERPNext in every environment:
 *
 * - **Development:** Vite dev server proxy (`vite.config.ts` → `VITE_PROXY_TARGET`)
 * - **Production (Vercel):** Serverless proxy (`api/proxy.ts` → `ERPNEXT_URL`)
 *
 * Upstream ERPNext auth: API-key (`Authorization: token key:secret`).
 * SPA principal: `X-Bidsphere-Access-Token` (attached per request from
 * session storage — required for payables mutations / production proxy).
 * `withCredentials` is intentionally false so the browser never sends or
 * stores ERPNext session cookies (`sid`, `csrf_token`, …). Those cookies are
 * host-scoped (not port-scoped); sharing them with ERP Desk on the same host
 * would invalidate Desk after SPA login.
 */
export const erpnext = axios.create({
  baseURL: "",
  timeout: 20_000,
  withCredentials: false,
  headers: {
    "Content-Type": "application/json",
    Authorization: `token ${API_KEY}:${API_SECRET}`,
  },
});

/** Alias for modules that prefer the `erpnextClient` naming convention. */
export const erpnextClient = erpnext;

/**
 * Per-request escape hatch: pass `{ _silent: true }` in the axios config to
 * skip the global error toast (the rejected promise is still propagated).
 *
 * Useful for the connection-status heartbeat ping, which already renders
 * its own banner and shouldn't double-up with toasts.
 */
export interface SilentRequestConfig {
  _silent?: boolean;
  /** Return the raw axios response body (used by login/logout). */
  _preserveResponse?: boolean;
}

/** Merge `_silent: true` so callers handle toasts locally (avoids duplicates). */
export function withSilent(
  config?: AxiosRequestConfig
): AxiosRequestConfig & SilentRequestConfig {
  return { ...config, _silent: true };
}

erpnext.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const method = config.method?.toLowerCase();
    const url = `${config.baseURL ?? ""}${config.url ?? ""}`;

    if (
      url.includes("Custom Field") &&
      method &&
      ["post", "put", "patch", "delete"].includes(method)
    ) {
      // eslint-disable-next-line no-console
      console.error(
        "[BLOCKED] Attempted to create/modify a Custom Field from the frontend.",
        "This causes duplicate-field and deadlock errors.",
        "Custom fields must be created manually in ERPNext, not from the app.",
        { method, url }
      );
      const blocked = new Error(
        "Custom Field creation from frontend is disabled"
      ) as AxiosError & SilentRequestConfig;
      blocked._silent = true;
      return Promise.reject(blocked);
    }

    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.log("REQUEST", config.method, url);

    // Extract and print DocType before query for audit purposes
    let loggedDocType: string | null = null;
    if (url.includes("/api/resource/")) {
      const match = url.match(/\/api\/resource\/([^/?#]+)/);
      if (match && match[1]) {
        loggedDocType = decodeURIComponent(match[1]);
      }
    } else if (
      url.includes("frappe.client.get_list") ||
      url.includes("frappe.client.get") ||
      url.includes("frappe.client.save") ||
      url.includes("frappe.client.submit") ||
      url.includes("frappe.client.cancel")
    ) {
      let bodyData: any = null;
      if (typeof config.data === "string") {
        try {
          bodyData = JSON.parse(config.data);
        } catch {}
      } else if (config.data && typeof config.data === "object") {
        bodyData = config.data;
      }
      loggedDocType =
        bodyData?.doctype ||
        bodyData?.doc?.doctype ||
        config.params?.doctype ||
        null;
    }

    if (loggedDocType) {
      // eslint-disable-next-line no-console
      console.log(`Querying ${loggedDocType}...`);
    }

    // SPA auth endpoints are handled by our server (`/api/auth/*`), not by
    // Frappe session login. Strip token auth — the server validates passwords.
    const urlPath = (config.url ?? "").split("?")[0];
    const isAuthEndpoint =
      urlPath === "/api/auth/login" ||
      urlPath === "/api/auth/logout" ||
      // Legacy paths — blocked by proxy; never send credentials either.
      urlPath === "/api/method/login" ||
      urlPath === "/api/method/logout";
    if (isAuthEndpoint) {
      config.headers.delete("Authorization");
      config.withCredentials = false;
    } else {
      // BidSphere RBAC principal (HMAC from staff login or supplier portal).
      // ERPNext upstream still uses Authorization: token key:secret.
      // Do NOT use sid cookies / withCredentials — Desk session collision.
      // Without this header, payables mutations (Voucher / PI / PE) hit
      // requireAnyAuth → 401 → handleSessionExpired → /login.
      const accessToken = readErpProxyAccessToken();
      if (accessToken) {
        if (typeof config.headers?.set === "function") {
          config.headers.set("X-Bidsphere-Access-Token", accessToken);
        } else if (config.headers) {
          (config.headers as Record<string, unknown>)[
            "X-Bidsphere-Access-Token"
          ] = accessToken;
        }
      }
    }

    // Do NOT read csrf_token from document.cookie. On a shared host that
    // cookie belongs to ERP Desk; attaching it here couples the SPA to Desk
    // and can break Desk CSRF after SPA traffic. API-key auth does not need it.

    // FormData / multipart: the axios instance defaults to application/json.
    // That default (or a bare multipart/form-data without boundary) makes
    // Frappe's upload_file return HTTP 417 — MandatoryError: file_name/file_url.
    // Delete Content-Type so the runtime sets multipart/form-data; boundary=…
    if (typeof FormData !== "undefined" && config.data instanceof FormData) {
      if (typeof config.headers?.delete === "function") {
        config.headers.delete("Content-Type");
        config.headers.delete("content-type");
      } else if (config.headers) {
        delete (config.headers as Record<string, unknown>)["Content-Type"];
        delete (config.headers as Record<string, unknown>)["content-type"];
      }
    }

    const isMutation =
      method === "post" ||
      method === "put" ||
      method === "delete" ||
      method === "patch";

    // Dev-only: log mutating requests with full URL + payload so we can
    // reproduce 400s with the exact payload ERPNext actually saw.
    if (import.meta.env.DEV && isMutation && method) {
      let parsed: unknown = config.data;
      if (typeof FormData !== "undefined" && config.data instanceof FormData) {
        parsed = "(FormData multipart — Content-Type left for boundary)";
      } else if (typeof config.data === "string") {
        try {
          parsed = JSON.parse(config.data);
        } catch {
          /* not JSON — log as-is */
        }
      }
      const fullUrl = `${config.baseURL ?? ""}${config.url ?? ""}`;
      // eslint-disable-next-line no-console
      console.log(
        `[ERPNext → ${method.toUpperCase()}] ${fullUrl}`,
        "\nPayload:",
        parsed ?? "(no body)"
      );
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

erpnext.interceptors.response.use(
  (response: AxiosResponse) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("RESPONSE", response.status, response.config.url);
    }

    const preserve =
      (response.config as SilentRequestConfig | undefined)?._preserveResponse ===
      true;
    if (preserve) {
      return response;
    }

    const payload = response.data;

    // Dev-only: pair every mutating request log with its response body
    // so the success path is just as easy to inspect as the failure path.
    if (
      import.meta.env.DEV &&
      response.config?.method &&
      ["post", "put", "delete"].includes(
        response.config.method.toLowerCase()
      )
    ) {
      const fullUrl = `${response.config.baseURL ?? ""}${
        response.config.url ?? ""
      }`;
      // eslint-disable-next-line no-console
      console.log(
        `[ERPNext ← ${response.config.method.toUpperCase()}] ${fullUrl} → ${
          response.status
        }`,
        "\nResponse:",
        payload ?? "(no body)"
      );
    }

    if (payload && typeof payload === "object") {
      if ("message" in payload && payload.message !== undefined) {
        return payload.message;
      }
      if ("data" in payload && payload.data !== undefined) {
        return payload.data;
      }
    }

    return payload;
  },
  (error: AxiosError<ErpNextErrorPayload>) => {
    const silentFromConfig =
      (error.config as (typeof error.config & SilentRequestConfig) | undefined)
        ?._silent === true;
    const silentFromError =
      (error as AxiosError & SilentRequestConfig)._silent === true;

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error(
        "AXIOS ERROR",
        error.response?.status,
        error.config?.url,
        error.message
      );
    }

    const status = error.response?.status;
    const data = error.response?.data;

    const errPath = (error.config?.url ?? "").split("?")[0];
    const isAuthEndpoint =
      errPath === "/api/auth/login" ||
      errPath === "/api/auth/logout" ||
      errPath === "/api/method/login" ||
      errPath === "/api/method/logout";
    if (status === 401 && !isAuthEndpoint && !silentFromConfig && !silentFromError) {
      handleSessionExpired();
    }

    // Best-effort parse of the outbound payload so the log shows the
    // exact JSON object axios sent (axios serialises body data to a
    // JSON string before the request goes out).
    let requestData: unknown = error.config?.data;
    if (typeof requestData === "string") {
      try {
        requestData = JSON.parse(requestData);
      } catch {
        /* not JSON — keep the raw string */
      }
    }

    // ─── 403 Permission denied ─────────────────────────────────────────
    if (status === 403) {
      const docInfo = extractDocNameFromUrl(error.config?.url);
      const serverDetail = extractErpNextError(data);
      const excLine = data?.exc ? parseExc(data.exc) : null;
      const rawMsg =
        typeof data?.message === "string" && data.message
          ? data.message
          : undefined;

      // eslint-disable-next-line no-console
      console.error("[403 Permission Error]", {
        url: error.config?.url,
        method: error.config?.method,
        doctype: docInfo?.doctype,
        document: docInfo?.name,
        requestData,
        serverMessage: rawMsg,
        serverMessages: serverDetail,
        excLine,
        exc_type: data?.exc_type,
        exc: data?.exc,
        fullResponse: data,
      });

      const parts: string[] = [];
      if (docInfo) {
        parts.push(`Permission denied for ${docInfo.doctype}${docInfo.name ? ` "${docInfo.name}"` : ""}.`);
      }
      if (serverDetail) parts.push(serverDetail);
      else if (excLine) parts.push(excLine);
      else if (rawMsg && rawMsg !== "Insufficient Permission") parts.push(rawMsg);

      const msg = parts.length > 0
        ? parts.join(" ")
        : `Insufficient permissions for ${error.config?.method?.toUpperCase() ?? "request"} ${error.config?.url ?? ""}. Check that the API user has Create/Write/Submit rights on the relevant DocType.`;

      error.message = msg;
      return Promise.reject(error);
    }

    // ─── Full structured log ───────────────────────────────────────────
    // Single console.error grouping every piece of context Frappe spreads
    // across multiple response keys, so you don't need to click through
    // a collapsed object view to see what actually went wrong.
    // eslint-disable-next-line no-console
    console.error("[ERPNext Full Error]", {
      status,
      url: error.config?.url,
      method: error.config?.method,
      requestData,
      responseData: data,
      exc: data?.exc,
      exc_type: data?.exc_type,
      server_messages: data?._server_messages,
      message: data?.message,
    });

    // ─── Message cascade (most informative → least) ────────────────────
    let message = "Request failed";
    // CSRFTokenError on token-auth POSTs surfaces as a generic "Invalid
    // Request" via `_server_messages`; promote it to a clearer label so
    // the toast and console reflect the actual cause.
    if (data?.exc_type === "CSRFTokenError") {
      message =
        "CSRFTokenError: missing or invalid X-Frappe-CSRF-Token header.";
    } else if (data?.exc_type === "DoesNotExistError" || status === 404) {
      const docName = extractDocNameFromUrl(error.config?.url);
      message = docName
        ? `${docName.doctype} "${docName.name}" does not exist in ERPNext.`
        : "The requested document does not exist.";
      // eslint-disable-next-line no-console
      console.warn("[DoesNotExistError]", {
        url: error.config?.url,
        doctype: docName?.doctype,
        document: docName?.name,
      });
      error.message = String(message);
      (error as AxiosError & { _isDocNotFound: boolean })._isDocNotFound = true;
      return Promise.reject(error);
    } else if (data?.exc_type === "LinkValidationError") {
      message =
        friendlyLinkValidationMessage(data) ??
        "A linked record is missing. Please check your selections.";
    } else if (data?.exc_type === "MandatoryError") {
      message =
        friendlyMandatoryErrorMessage(data) ??
        "Please fill in all required fields.";
    } else if (data?.exc_type === "UpdateAfterSubmitError") {
      const serverMsg = extractErpNextError(data) || data.message || error.message;
      const match = String(serverMsg).match(
        /(?:UpdateAfterSubmitError|Not allowed to change|Cannot change)\s+(?:['"`]?([^'"`\n]+)['"`]?|([^\n]+?))\s+after submission/i
      );
      const fieldName = match ? (match[1] || match[2] || "").trim() : "";
      message = fieldName
        ? `UpdateAfterSubmitError: Not allowed to change ${fieldName} after submission`
        : String(serverMsg);
    } else {
      // Combine ALL server messages + the exc exception line so the real
      // ValidationError isn't hidden behind an informational alert.
      const combined = extractErpNextError(data);
      if (combined) {
        message = combined;
      } else if (data?.exception) {
        message = String(data.exception);
      } else if (typeof data?.message === "string" && data.message) {
        message = data.message;
      } else if (error.message) {
        message = error.message;
      }
    }

    // Keep the friendly mapping for connection-level errors (timeout /
    // 502 / 503 / 504 / network) so users see actionable hints instead
    // of "Request failed" when ERPNext is simply offline.
    const friendly = friendlyErrorMessage(error) || message;

    const isSchemaNoise =
      data?.exc_type === "QueryDeadlockError" ||
      /QueryDeadlockError/i.test(message) ||
      /already exists in the/i.test(message) ||
      error.message === "Custom Field creation from frontend is disabled";

    const silent =
      silentFromConfig ||
      silentFromError ||
      isSchemaNoise;

    if (!silent && status !== 403 && typeof window !== "undefined") {
      surfaceErrorToast(friendly);
    }

    // Mutate the AxiosError's message in place rather than wrapping it
    // in a fresh `Error`. This keeps `error.response`, `error.config`,
    // `error.code` accessible to callers that want to inspect the raw
    // axios payload (e.g. the SQ catch block reading
    // `err.response?.data?.exc_type`), while still surfacing the parsed
    // Frappe message via `error.message` for `react-query` and `await`
    // consumers that only read that property.
    error.message = String(message);
    return Promise.reject(error);
  }
);

/**
 * Show at most one toast every 2.5 seconds and dedupe identical messages
 * within a 5-second window. Without this, a dashboard load against an
 * unreachable backend stacks 10+ identical "Network Error" toasts on top
 * of each other and visually obscures the page.
 */
const recentToasts = new Map<string, number>();
let lastToastAt = 0;

/**
 * Guard: never surface infrastructure / backend details to end users.
 * Matches Python tracebacks, Frappe internals, ERPNext module paths,
 * import errors, SQL errors, and low-level connection strings.
 * In dev builds the raw message is ALSO logged to the console, but the
 * toast always shows the sanitized version.
 */
/**
 * Formats user-facing error messages without masking ERPNext validation errors.
 * If an UpdateAfterSubmitError occurs, returns the exact field causing the error.
 */
function sanitizeUserMessage(message: string): string {
  // If this is an UpdateAfterSubmitError or field-change error, extract the exact field
  const updateAfterSubmitMatch = message.match(
    /(?:UpdateAfterSubmitError|Not allowed to change|Cannot change)\s+(?:['"`]?([^'"`\n]+)['"`]?|([^\n]+?))\s+after submission/i
  );
  if (updateAfterSubmitMatch) {
    const fieldName = (updateAfterSubmitMatch[1] || updateAfterSubmitMatch[2] || "").trim();
    return fieldName
      ? `UpdateAfterSubmitError: Not allowed to change ${fieldName} after submission`
      : message;
  }

  return message;
}

function surfaceErrorToast(rawMessage: string) {
  const message = sanitizeUserMessage(rawMessage);
  const now = Date.now();
  const lastForMessage = recentToasts.get(message) ?? 0;

  if (now - lastForMessage < 5_000) return;
  if (now - lastToastAt < 2_500) {
    recentToasts.set(message, now);
    return;
  }

  recentToasts.set(message, now);
  lastToastAt = now;
  toast.error(message, { id: "erpnext-error" });

  if (recentToasts.size > 32) {
    for (const [key, ts] of recentToasts) {
      if (now - ts > 30_000) recentToasts.delete(key);
    }
  }
}

export type FilterOperator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "like"
  | "not like"
  | "in"
  | "not in"
  | "is"
  | "between"
  | "Timespan";

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number>;

/** A single Frappe filter tuple: [field, operator, value] or [parent_doctype, field, operator, value]. */
export type Filter =
  | [string, FilterOperator, FilterValue]
  | [string, string, FilterOperator, FilterValue];

/** Standard list-endpoint query parameters for any Frappe resource. */
export interface ListParams {
  filters?: Filter[] | Record<string, FilterValue>;
  fields?: string[];
  limit_page_length?: number;
  limit_start?: number;
  order_by?: string;
  parent?: string;
  as_dict?: boolean;
}

/**
 * Build an Axios request config from `ListParams`, JSON-stringifying the
 * `filters` and `fields` keys the way Frappe's REST API expects.
 */
export function buildListConfig(params?: ListParams): AxiosRequestConfig {
  if (!params) return {};
  const out: Record<string, string | number | boolean> = {};
  if (params.filters !== undefined)
    out.filters = JSON.stringify(params.filters);
  if (params.fields !== undefined) out.fields = JSON.stringify(params.fields);
  if (params.limit_page_length !== undefined)
    out.limit_page_length = params.limit_page_length;
  if (params.limit_start !== undefined) out.limit_start = params.limit_start;
  if (params.order_by) out.order_by = params.order_by;
  if (params.parent) out.parent = params.parent;
  if (params.as_dict !== undefined) out.as_dict = params.as_dict;
  return { params: out };
}

/**
 * Build a `/api/resource/<Doctype>[/<name>]` URL with proper encoding so
 * doctypes containing spaces (e.g. "Purchase Requisition") work correctly.
 */
export function buildResourceUrl(doctype: string, name?: string): string {
  const base = `/api/resource/${encodeURIComponent(doctype)}`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

export async function apiGet<T = unknown>(
  url: string,
  config?: AxiosRequestConfig
): Promise<T> {
  return erpnext.get(url, config) as unknown as Promise<T>;
}

export async function apiPost<T = unknown>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<T> {
  return erpnext.post(url, data, config) as unknown as Promise<T>;
}

export async function apiPut<T = unknown>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<T> {
  return erpnext.put(url, data, config) as unknown as Promise<T>;
}

export async function apiDelete<T = unknown>(
  url: string,
  config?: AxiosRequestConfig
): Promise<T> {
  return erpnext.delete(url, config) as unknown as Promise<T>;
}

const SERVER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Optional UI hint for a calendar date (`YYYY-MM-DD`).
 *
 * Regression (commit 2893d0e): the HTTP `Date` header was converted with
 * `getUTCFullYear/Month/Date`, which shifts the business day backward for
 * IST (and other UTC+ timezones) — UI/payload could show 2026-07-20 while
 * the resolved "server" day was 2026-07-19.
 *
 * Use local calendar components of that instant (same basis as `todayIso()`),
 * never UTC getters / `toISOString().slice(0, 10)`.
 */
export async function fetchServerDate(): Promise<string | null> {
  try {
    const res = (await erpnext.get("/api/method/frappe.auth.get_logged_user", {
      _preserveResponse: true,
      _silent: true,
      timeout: 5_000,
    } as AxiosRequestConfig & SilentRequestConfig)) as unknown as AxiosResponse;

    const header = res?.headers?.["date"] ?? res?.headers?.["Date"];
    if (typeof header === "string") {
      const parsed = new Date(header);
      if (!Number.isNaN(parsed.getTime())) {
        // Local calendar day — NOT getUTC* (that caused the 20 → 19 GRN regression).
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, "0");
        const d = String(parsed.getDate()).padStart(2, "0");
        const iso = `${y}-${m}-${d}`;
        return SERVER_DATE_RE.test(iso) ? iso : null;
      }
    }
  } catch {
    // Silent — GRN create does not depend on this hint.
  }
  return null;
}

/**
 * The ERPNext server's current epoch (ms, UTC), read from the HTTP `Date`
 * response header of a lightweight request. Used to synchronize time-critical
 * UI (e.g. the reverse-auction countdown) to server time rather than the
 * browser clock, which may be skewed. Returns `null` if unavailable.
 */
export async function fetchServerTimeMs(): Promise<number | null> {
  try {
    const res = (await erpnext.get("/api/method/frappe.auth.get_logged_user", {
      _preserveResponse: true,
      _silent: true,
      timeout: 5_000,
    } as AxiosRequestConfig & SilentRequestConfig)) as unknown as AxiosResponse;
    const header = res?.headers?.["date"] ?? res?.headers?.["Date"];
    if (typeof header === "string") {
      const ms = new Date(header).getTime();
      if (Number.isFinite(ms)) return ms;
    }
  } catch {
    // Silent — callers fall back to the client clock (offset 0).
  }
  return null;
}

/**
 * Returns the count of records in `doctype` that match `filters`, by fetching
 * names from the REST resource endpoint (avoids non-whitelisted method calls).
 */
export async function getCount(
  doctype: string,
  filters?: Filter[] | Record<string, FilterValue>
): Promise<number> {
  try {
    const params: Record<string, string | number> = {
      fields: JSON.stringify(["name"]),
      limit_page_length: 500,
    };
    if (filters !== undefined) {
      if (Array.isArray(filters) && filters.length > 0) {
        params.filters = JSON.stringify(filters);
      } else if (
        !Array.isArray(filters) &&
        Object.keys(filters).length > 0
      ) {
        params.filters = JSON.stringify(filters);
      }
    }
    const data = await apiGet<unknown[]>(buildResourceUrl(doctype), {
      params,
    });
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}


/**
 * Result shape for `fetchPagedList` — matches what every paginated list page
 * needs to render "Showing X–Y of Z records" + page controls without any
 * extra client-side math.
 */
export interface PagedListResult<T> {
  data: T[];
  total_records: number;
  total_pages: number;
  current_page: number;
  page_size: number;
}

/**
 * Exact total record count for `doctype` matching `filters`, via Frappe's own
 * `frappe.client.get_count` whitelisted method — the same call Frappe's List
 * View uses internally. Unlike `getCount` above (which pages through the
 * resource endpoint and caps at 500), this returns the true total regardless
 * of dataset size, which server-side pagination needs to compute total pages.
 */
export async function getExactCount(
  doctype: string,
  filters?: Filter[] | Record<string, FilterValue>,
  orFilters?: Filter[],
): Promise<number> {
  try {
    const params: Record<string, string> = { doctype };
    const hasFilters =
      filters !== undefined &&
      (Array.isArray(filters) ? filters.length > 0 : Object.keys(filters).length > 0);
    if (hasFilters) params.filters = JSON.stringify(filters);
    if (orFilters && orFilters.length > 0) {
      params.or_filters = JSON.stringify(orFilters);
    }

    const result = await apiGet<number | string>(
      "/api/method/frappe.client.get_count",
      { params }
    );
    const n = typeof result === "number" ? result : Number(result);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Generic server-side pagination for any Frappe resource: fetches exactly one
 * page of records (`limit_start`/`limit_page_length`) alongside the exact
 * total count, and returns everything a `PaginationBar` needs to render.
 *
 * This is the standard way every "All <X>" list page in the Procurement
 * System should fetch its rows — never fetch the whole doctype client-side
 * and slice it in JS.
 */
export async function fetchPagedList<T = unknown>(
  doctype: string,
  options: {
    fields: string[];
    filters?: Filter[] | Record<string, FilterValue>;
    order_by?: string;
    page: number;
    pageSize: number;
  }
): Promise<PagedListResult<T>> {
  const { fields, filters, order_by, page, pageSize } = options;
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(1, Math.floor(pageSize) || 10);
  const limit_start = (safePage - 1) * safePageSize;

  const [data, total_records] = await Promise.all([
    apiGet<T[]>(
      buildResourceUrl(doctype),
      buildListConfig({
        fields,
        filters,
        order_by,
        limit_start,
        limit_page_length: safePageSize,
      })
    ),
    getExactCount(doctype, filters),
  ]);

  const total_pages = Math.max(1, Math.ceil(total_records / safePageSize));
  const current_page = Math.min(safePage, total_pages);

  return {
    data: Array.isArray(data) ? data : [],
    total_records,
    total_pages,
    current_page,
    page_size: safePageSize,
  };
}

interface ErpNextErrorPayload {
  message?: string;
  /** ERPNext attaches the full Python traceback as a JSON-encoded list. */
  exc?: string;
  exception?: string;
  exc_type?: string;
  /**
   * `_server_messages` is itself a JSON-encoded list of JSON-encoded strings
   * (each containing `{title, message, indicator, raise_exception}`).
   * Frappe's two layers of stringification are why parsing is fiddly.
   */
  _server_messages?: string;
  _error_message?: string;
}

/**
 * Turn Frappe LinkValidationError payloads into plain-language messages
 * (e.g. "Could not find HSN/SAC: 85247" → user-friendly guidance).
 */
function friendlyLinkValidationMessage(
  data: ErpNextErrorPayload | undefined
): string | null {
  if (!data) return null;

  const parts: string[] = [];
  const combined = extractErpNextError(data);
  if (combined) parts.push(combined);
  if (data.exception) parts.push(stripHtml(String(data.exception)));
  if (typeof data.message === "string" && data.message) {
    parts.push(stripHtml(data.message));
  }

  const raw = parts.join(" | ");
  if (!raw) return null;

  const couldNotFind = raw.match(
    /Could not find\s+([^:]+):\s*([^\s|]+)/i
  );
  if (couldNotFind) {
    const label = couldNotFind[1].trim();
    const value = couldNotFind[2]
      .trim()
      .replace(/['"]/g, "")
      .replace(/[,;:]+$/g, "");
    if (/hsn|sac/i.test(label)) {
      return `HSN Code ${value} does not exist in ERPNext. Please create it first.`;
    }
    return `${label} "${value}" does not exist in ERPNext. Please create it first.`;
  }

  if (/LinkValidationError/i.test(raw)) {
    return raw
      .replace(/frappe\.exceptions\.LinkValidationError:\s*/gi, "")
      .replace(/^[^:]+:\s*/, "")
      .trim();
  }

  return null;
}

/** Map MandatoryError (e.g. missing HSN/SAC on Item) to plain language. */
function friendlyMandatoryErrorMessage(
  data: ErpNextErrorPayload | undefined
): string | null {
  if (!data) return null;

  const combined = extractErpNextError(data);
  const exception = data.exception ? stripHtml(String(data.exception)) : "";
  const raw = [combined, exception, data.message]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" | ");

  if (/HSN|SAC/i.test(raw)) {
    return "ERPNext requires an HSN/SAC Code for this item.";
  }

  if (combined) return stripHtml(combined);
  if (exception) {
    return exception.replace(/frappe\.exceptions\.MandatoryError:\s*/gi, "").trim();
  }

  return null;
}

/**
 * are detected first so the user sees an actionable hint rather than a
 * generic "Network Error" string. For real ERPNext validation failures
 * we drill into `_server_messages` / `exc` / `exception` so the user sees
 * the *actual* server-side complaint instead of a vague "Request failed".
 */
function friendlyErrorMessage(
  error: AxiosError<ErpNextErrorPayload>
): string {
  // Client-facing connection notice — no infrastructure details (no "ERPNext",
  // "bench", URLs, ports, or status codes). Developers still get the technical
  // wording in dev builds to aid debugging.
  const GENERIC_UNAVAILABLE =
    "Unable to load data at the moment. Please check your connection and try again.";
  const devOr = (devMessage: string) =>
    import.meta.env.DEV ? devMessage : GENERIC_UNAVAILABLE;

  // Client-side timeout (axios aborts after the configured `timeout`).
  if (
    error.code === "ECONNABORTED" ||
    (error.message ?? "").toLowerCase().includes("timeout")
  ) {
    return devOr("ERPNext connection timed out. Is localhost:8081 running?");
  }

  // Network is offline / DNS failed / connection refused.
  if (error.code === "ERR_NETWORK" || error.message === "Network Error") {
    return devOr("Could not reach ERPNext. Check that the backend is running.");
  }

  const status = error.response?.status;
  if (status === 504) {
    return devOr("ERPNext server not responding (504). Please start ERPNext.");
  }
  if (status === 502) {
    return devOr("ERPNext server unavailable (502).");
  }
  if (status === 503) {
    return devOr("ERPNext is temporarily unavailable (503).");
  }

  const data = error.response?.data;

  // 1a. CSRFTokenError on token auth means the caller hit a method
  //     endpoint that needs a session (e.g. `frappe.client.insert`).
  //     Use `/api/resource/<Doctype>` for writes, which honors token
  //     auth without CSRF.
  if (data?.exc_type === "CSRFTokenError") {
    return devOr(
      "Authentication error. Check ERP_API_KEY and ERP_API_SECRET in .env."
    );
  }

  if (data?.exc_type === "LinkValidationError") {
    return (
      friendlyLinkValidationMessage(data) ??
      "A linked record is missing. Please check your selections."
    );
  }

  if (data?.exc_type === "MandatoryError") {
    return (
      friendlyMandatoryErrorMessage(data) ??
      "Please fill in all required fields."
    );
  }

  // 1. Combine all server messages + the exc exception line so the real
  //    ValidationError is never hidden behind an informational alert.
  const combined = extractErpNextError(data);
  if (combined) return combined;

  // 3. _error_message / message / exception in plain string form.
  if (data?._error_message) return stripHtml(data._error_message);
  if (typeof data?.message === "string" && data.message) {
    return stripHtml(data.message);
  }
  if (data?.exception) return stripHtml(data.exception);

  // 4. Last resort — surface the raw response body so the developer at
  //    least has *something* to grep for, instead of "Request failed".
  if (data && typeof data === "object") {
    try {
      const blob = JSON.stringify(data).slice(0, 240);
      if (blob && blob !== "{}") return blob;
    } catch {
      /* ignore */
    }
  }

  if (error.message) return error.message;
  return "An unexpected error occurred while contacting ERPNext.";
}

/**
 * `_server_messages` is a JSON string whose elements are themselves JSON
 * strings of `{message, title, indicator}`. Frappe can stack several
 * (an informational alert *and* the real validation error), so we unwrap
 * **all** of them and return each human-readable message. Taking only the
 * first one is what previously hid the real error behind a benign
 * "Item Price added…" alert.
 */
function parseAllServerMessages(raw: string): string[] {
  const out: string[] = [];
  try {
    const outer = JSON.parse(raw);
    if (!Array.isArray(outer)) return out;
    for (const entry of outer) {
      if (typeof entry === "string") {
        try {
          const inner = JSON.parse(entry) as {
            message?: string;
            title?: string;
          };
          const m = inner?.message || inner?.title;
          if (m) out.push(stripHtml(m));
        } catch {
          out.push(stripHtml(entry));
        }
      } else if (entry && typeof entry === "object") {
        const obj = entry as { message?: string; title?: string };
        const m = obj.message || obj.title;
        if (m) out.push(stripHtml(m));
      }
    }
  } catch {
    /* fall through */
  }
  return out;
}

/**
 * Combine everything Frappe tells us about a failure into one message:
 * all `_server_messages` *plus* the real exception line from `exc`,
 * de-duplicated and joined. This guarantees the actual `ValidationError`
 * is shown even when an informational alert is also present.
 */
function extractErpNextError(data: ErpNextErrorPayload | undefined): string | null {
  if (!data) return null;
  const parts: string[] = [];

  if (data._server_messages) {
    for (const m of parseAllServerMessages(data._server_messages)) {
      if (m && !parts.includes(m)) parts.push(m);
    }
  }
  if (data.exc) {
    const excMsg = parseExc(data.exc);
    if (excMsg && !parts.includes(excMsg)) parts.push(excMsg);
  }

  return parts.length ? parts.join(" | ") : null;
}

/**
 * `exc` looks like `["Traceback (...)\\nValidationError: <message>"]`.
 * We pull out the last non-empty traceback line which is almost always
 * the exception class plus its message.
 */
function parseExc(raw: string): string | null {
  try {
    const arr = JSON.parse(raw);
    const trace = Array.isArray(arr) ? arr[0] : raw;
    if (typeof trace !== "string") return null;
    const lines = trace.split("\n").map((s) => s.trim()).filter(Boolean);
    return lines.length > 0 ? stripHtml(lines[lines.length - 1]) : null;
  } catch {
    return null;
  }
}

/**
 * Extract the DocType and document name from a Frappe resource URL.
 * e.g. `/api/resource/Request%20for%20Quotation/PUR-RFQ-2026-00020`
 *   → { doctype: "Request for Quotation", name: "PUR-RFQ-2026-00020" }
 */
function extractDocNameFromUrl(
  url: string | undefined
): { doctype: string; name: string } | null {
  if (!url) return null;
  const match = url.match(/\/api\/resource\/([^/]+)\/([^/?]+)/);
  if (!match) return null;
  return {
    doctype: decodeURIComponent(match[1]),
    name: decodeURIComponent(match[2]),
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

/**
 * Returns `true` when an error originates from a missing ERPNext document
 * (404 or `DoesNotExistError`). Pages can use this to render an empty state
 * instead of showing error banners.
 */
export function isDocNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const axErr = err as AxiosError & { _isDocNotFound?: boolean };
  if (axErr._isDocNotFound) return true;
  const status = axErr.response?.status;
  const excType = (axErr.response?.data as ErpNextErrorPayload | undefined)?.exc_type;
  return status === 404 || excType === "DoesNotExistError";
}

/**
 * Compatibility re-export — some modules historically imported this from
 * `erpnext.ts`. Implementation lives in `utils/permissionError` (no workflow
 * logic). Safe to import from either path.
 */
export { isPermissionDeniedError } from "../utils/permissionError";

export default erpnext;
