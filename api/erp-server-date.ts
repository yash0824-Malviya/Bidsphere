import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  DEFAULT_ERP_TIME_ZONE,
  resolveErpServerDate,
} from "./erpServerDateCore.js";

function erpBaseUrl(): string {
  return (
    process.env.ERPNEXT_URL ??
    process.env.VITE_ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    ""
  ).replace(/\/$/, "");
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({
      success: false,
      message: "Method Not Allowed. Use GET /api/erp-server-date.",
    });
    return;
  }

  const baseUrl = erpBaseUrl();
  const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const apiSecret =
    process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

  if (!baseUrl || !apiKey || !apiSecret) {
    res.status(500).json({
      success: false,
      message: "ERPNext credentials not configured for erp-server-date.",
    });
    return;
  }

  try {
    const result = await resolveErpServerDate({
      baseUrl,
      apiKey,
      apiSecret,
      defaultTimeZone:
        process.env.ERP_TIME_ZONE ||
        process.env.VITE_ERP_TIME_ZONE ||
        DEFAULT_ERP_TIME_ZONE,
    });

    // eslint-disable-next-line no-console
    console.log("[erp-server-date]", {
      today: result.today,
      time_zone: result.time_zone,
      utc_today: result.utc_today,
      system_settings_time_zone: result.system_settings_time_zone,
      source: result.source,
    });

    res.status(200).json({
      success: true,
      message: result,
      // Convenience top-level for simple clients
      today: result.today,
      time_zone: result.time_zone,
      utc_today: result.utc_today,
      source: result.source,
      system_settings_time_zone: result.system_settings_time_zone,
      http_date: result.http_date,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[erp-server-date] FAILED:", message);
    res.status(502).json({ success: false, message });
  }
}
