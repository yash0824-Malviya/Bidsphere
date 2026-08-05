/**
 * Resolve ERPNext calendar "today" (YYYY-MM-DD) in the site System Settings
 * time zone — the same basis as `frappe.utils.nowdate()`.
 *
 * Used by `/api/erp-server-date` (Vercel + Vite) so GRN posting-date
 * validation does not use raw UTC when the site is Asia/Kolkata (etc.).
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_ERP_TIME_ZONE = "Asia/Kolkata";

export type ErpServerDateResult = {
  today: string;
  time_zone: string;
  source: string;
  utc_today: string;
  http_date: string | null;
  system_settings_time_zone: string | null;
};

function ymdInTimeZone(date: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !d) return null;
    const iso = `${y}-${m}-${d}`;
    return YMD_RE.test(iso) ? iso : null;
  } catch {
    return null;
  }
}

function utcToday(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function erpFetch(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; headers: Headers }> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `token ${apiKey}:${apiSecret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, headers: res.headers };
}

function unwrapMessage(json: unknown): unknown {
  if (json && typeof json === "object" && "message" in json) {
    return (json as { message: unknown }).message;
  }
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: unknown }).data;
  }
  return json;
}

export async function fetchErpSystemTimeZone(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
): Promise<string | null> {
  // Prefer get_value (lighter / more reliably permitted).
  try {
    const q = new URLSearchParams({
      doctype: "System Settings",
      fieldname: "time_zone",
    });
    const res = await erpFetch(
      baseUrl,
      apiKey,
      apiSecret,
      `/api/method/frappe.client.get_value?${q}`,
    );
    if (res.ok) {
      const msg = unwrapMessage(res.json) as { time_zone?: string } | null;
      const tz = msg?.time_zone?.trim();
      if (tz) return tz;
    }
  } catch {
    /* fall through */
  }

  try {
    const res = await erpFetch(
      baseUrl,
      apiKey,
      apiSecret,
      "/api/resource/System Settings/System Settings?fields=" +
        encodeURIComponent('["time_zone"]'),
    );
    if (res.ok) {
      const data = unwrapMessage(res.json) as { time_zone?: string } | null;
      const tz = data?.time_zone?.trim();
      if (tz) return tz;
    }
  } catch {
    /* fall through */
  }

  return null;
}

/**
 * Set ERP System Settings.time_zone (fixes nowdate() when Docker/default is UTC).
 */
export async function setErpSystemTimeZone(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  timeZone: string,
): Promise<void> {
  const res = await erpFetch(
    baseUrl,
    apiKey,
    apiSecret,
    "/api/resource/System Settings/System Settings",
    {
      method: "PUT",
      body: JSON.stringify({ time_zone: timeZone }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Failed to set System Settings.time_zone=${timeZone} (HTTP ${res.status}): ${JSON.stringify(res.json)}`,
    );
  }
}

export async function resolveErpServerDate(opts: {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Override when System Settings is missing/UTC — Netlink default IST. */
  defaultTimeZone?: string;
}): Promise<ErpServerDateResult> {
  const defaultTz = (
    opts.defaultTimeZone ||
    process.env.ERP_TIME_ZONE ||
    process.env.VITE_ERP_TIME_ZONE ||
    DEFAULT_ERP_TIME_ZONE
  ).trim();

  let httpDate: string | null = null;
  let instant = new Date();

  // Lightweight ping for ERP HTTP Date (authoritative server clock).
  try {
    const ping = await erpFetch(
      opts.baseUrl,
      opts.apiKey,
      opts.apiSecret,
      "/api/method/frappe.auth.get_logged_user",
    );
    const header = ping.headers.get("date") ?? ping.headers.get("Date");
    if (header) {
      httpDate = header;
      const parsed = new Date(header);
      if (!Number.isNaN(parsed.getTime())) instant = parsed;
    }
  } catch {
    /* use local clock */
  }

  // Exact nowdate() when Server Scripts are enabled.
  try {
    const res = await erpFetch(
      opts.baseUrl,
      opts.apiKey,
      opts.apiSecret,
      "/api/method/bidsphere_server_date",
    );
    if (res.ok) {
      const msg = unwrapMessage(res.json) as { today?: string; time_zone?: string } | null;
      const today = msg?.today?.trim();
      if (today && YMD_RE.test(today)) {
        const tz =
          (await fetchErpSystemTimeZone(
            opts.baseUrl,
            opts.apiKey,
            opts.apiSecret,
          )) ?? defaultTz;
        return {
          today,
          time_zone: tz,
          source: "bidsphere_server_date (frappe.utils.nowdate)",
          utc_today: utcToday(instant),
          http_date: httpDate,
          system_settings_time_zone: tz,
        };
      }
    }
  } catch {
    /* fall through */
  }

  const settingsTz = await fetchErpSystemTimeZone(
    opts.baseUrl,
    opts.apiKey,
    opts.apiSecret,
  );

  // Prefer System Settings; if missing or UTC while business default is IST,
  // use default for *calendar today* resolution. ERP validate_posting_time
  // still uses System Settings — callers should run setup-erp-timezone.mjs
  // when settingsTz is UTC.
  let effectiveTz = settingsTz || defaultTz;
  if (
    settingsTz &&
    /^(UTC|Etc\/UTC|GMT|Etc\/GMT)$/i.test(settingsTz) &&
    defaultTz &&
    !/^(UTC|Etc\/UTC|GMT|Etc\/GMT)$/i.test(defaultTz)
  ) {
    // Compute business-day today in default TZ; still report settings TZ so
    // ops can see the mismatch. setup script should update Settings.
    effectiveTz = defaultTz;
  }

  const today = ymdInTimeZone(instant, effectiveTz) ?? utcToday(instant);

  return {
    today,
    time_zone: effectiveTz,
    source: settingsTz
      ? `HTTP Date → ${effectiveTz}`
      : `HTTP Date → default ${effectiveTz}`,
    utc_today: utcToday(instant),
    http_date: httpDate,
    system_settings_time_zone: settingsTz,
  };
}
