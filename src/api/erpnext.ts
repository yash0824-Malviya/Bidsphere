import axios, { AxiosError } from "axios";
import type {
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import toast from "react-hot-toast";

export const ENV_DEFAULTS = {
  company: (import.meta.env.VITE_COMPANY as string | undefined) ?? "",
};

/** Convenience re-export of the company name used throughout the app. */
export const COMPANY = ENV_DEFAULTS.company.trim() || "Inteva";

const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;
const API_SECRET = import.meta.env.VITE_API_SECRET as string | undefined;

// eslint-disable-next-line no-console
console.log("[Auth] Key:", API_KEY?.slice(0, 8));
// eslint-disable-next-line no-console
console.log("[Auth] Secret:", API_SECRET?.slice(0, 8));

/**
 * Same-origin `/api/*` requests — proxied to ERPNext in every environment:
 *
 * - **Development:** Vite dev server proxy (`vite.config.ts` → `VITE_PROXY_TARGET`)
 * - **Production (Vercel):** Serverless proxy (`api/[...path].ts` → `ERPNEXT_URL`)
 *
 * Token auth and CSRF are sent from the browser via `VITE_API_KEY` /
 * `VITE_API_SECRET` and the `csrf_token` cookie (when present).
 */
export const erpnext = axios.create({
  baseURL: "",
  timeout: 20_000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Authorization: `token ${API_KEY}:${API_SECRET}`,
    "X-Frappe-CSRF-Token": "fetch",
  },
});

/** Alias for modules that prefer the `erpnextClient` naming convention. */
export const erpnextClient = erpnext;

// ── TEMPORARY DIAGNOSTICS (remove after verifying the proxy is used) ────────
// Empty baseURL means every request is same-origin `/api/*` (the Vercel/Vite
// proxy). If this logs anything containing "frappe.cloud", the client is
// bypassing the proxy.
// eslint-disable-next-line no-console
console.log("API BASE URL =", JSON.stringify(erpnext.defaults.baseURL));

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
    // eslint-disable-next-line no-console
    console.log(
      "REQUEST",
      config.method,
      `${config.baseURL ?? ""}${config.url ?? ""}`
    );

    // Login/logout use session auth (usr/pwd in body), NOT token auth.
    // Remove the Authorization header so Frappe authenticates the submitted
    // user's credentials instead of the API key owner.
    const isAuthEndpoint =
      config.url === "/api/method/login" ||
      config.url === "/api/method/logout";
    if (isAuthEndpoint) {
      config.headers.delete("Authorization");
    }

    if (typeof document !== "undefined") {
      const csrf = document.cookie.match(/csrf_token=([^;]+)/)?.[1];
      if (csrf) {
        config.headers.set("X-Frappe-CSRF-Token", decodeURIComponent(csrf));
      }
    }

    const method = config.method?.toLowerCase();
    const isMutation =
      method === "post" ||
      method === "put" ||
      method === "delete" ||
      method === "patch";

    // Dev-only: log mutating requests with full URL + payload so we can
    // reproduce 400s with the exact payload ERPNext actually saw.
    if (import.meta.env.DEV && isMutation && method) {
      let parsed: unknown = config.data;
      if (typeof config.data === "string") {
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
    // TEMPORARY: confirms responses come back through the proxy.
    // eslint-disable-next-line no-console
    console.log("RESPONSE", response.status, response.config.url);

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
    // TEMPORARY: surfaces the raw axios error (status + URL) for proxy checks.
    // eslint-disable-next-line no-console
    console.error(
      "AXIOS ERROR",
      error.response?.status,
      error.config?.url,
      error.message
    );

    const status = error.response?.status;
    const data = error.response?.data;

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

    const silent =
      (error.config as (typeof error.config & SilentRequestConfig) | undefined)
        ?._silent === true;

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
const INFRA_LEAK_PATTERN =
  /erpnext|frappe\.|bench|localhost|127\.0\.0\.1|ngrok|traceback|econn|network error|\bgateway\b|\/api\/|csrf|stack|exception|502|503|504|No module named|ImportError|ModuleNotFoundError|TypeError:|AttributeError:|KeyError:|ValueError:|RuntimeError:|\.py\b|doctype\.|sql|mariadb|pymysql|Traceback \(most recent/i;

function sanitizeUserMessage(message: string): string {
  if (INFRA_LEAK_PATTERN.test(message)) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[sanitizeUserMessage] Suppressed raw error from toast:", message);
      return `Data is temporarily unavailable: ${message}`;
    }
    return "Data is temporarily unavailable. Please refresh the page or try again later.";
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

export default erpnext;
