import { apiPost, withSilent } from "../../api/erpnext";
import type { ExportFormat } from "./types";

/**
 * Best-effort Activity Log entry for every list export.
 * Failures are swallowed so export UX is never blocked.
 */
export async function recordExportActivity(opts: {
  user: string;
  module: string;
  format: ExportFormat;
  filename: string;
  rowCount: number;
}): Promise<void> {
  const when = new Date().toISOString();
  const formatLabel =
    opts.format === "xlsx" ? "Excel (.xlsx)" : opts.format.toUpperCase();

  try {
    await apiPost(
      "/api/method/frappe.client.insert",
      {
        doc: {
          doctype: "Activity Log",
          subject: `Exported ${opts.module} as ${formatLabel}`,
          content: [
            `User: ${opts.user}`,
            `Module: ${opts.module}`,
            `Export Format: ${formatLabel}`,
            `Date & Time: ${when}`,
            `Filename: ${opts.filename}`,
            `Records: ${opts.rowCount}`,
          ].join("\n"),
          operation: "Export",
          status: "Success",
          user: opts.user,
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[Export] Activity Log insert skipped:", err);
    }
  }
}
