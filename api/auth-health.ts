import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * GET /api/auth-health — diagnose Vercel → ERPNext connectivity for login.
 * Does not expose secrets. Safe to call from the browser during incidents.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const raw =
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    "";
  const baseUrl = raw.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const hasKey = Boolean(
    process.env.ERP_API_KEY || process.env.VITE_API_KEY,
  );
  const hasSecret = Boolean(
    process.env.ERP_API_SECRET || process.env.VITE_API_SECRET,
  );

  const report: Record<string, unknown> = {
    ok: false,
    erpnext_url_configured: Boolean(baseUrl),
    erpnext_url_host: baseUrl
      ? (() => {
          try {
            return new URL(baseUrl).host;
          } catch {
            return "(invalid URL)";
          }
        })()
      : null,
    api_key_configured: hasKey,
    api_secret_configured: hasSecret,
    ping: null as null | { status: number; ms: number; error?: string },
  };

  if (!baseUrl) {
    res.status(500).json({
      ...report,
      error:
        "Missing ERPNEXT_URL. Set it in Vercel → Settings → Environment Variables.",
    });
    return;
  }

  const t0 = Date.now();
  try {
    const upstream = await fetch(`${baseUrl}/api/method/frappe.ping`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    report.ping = { status: upstream.status, ms: Date.now() - t0 };
    report.ok = upstream.ok;
    res.status(upstream.ok ? 200 : 502).json(report);
  } catch (err) {
    report.ping = {
      status: 0,
      ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
    res.status(502).json({
      ...report,
      error:
        "Vercel cannot reach ERPNEXT_URL. Use a public URL (not localhost).",
    });
  }
}
