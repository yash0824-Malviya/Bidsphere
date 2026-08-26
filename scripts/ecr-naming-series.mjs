import { maxNewEcrSeriesCounter } from "./ecr-workflow-migration-policy.mjs";

export const ECR_AUTONAME_PATTERN = "ECR-.YYYY.-1.#####";

export function ecrSeriesPrefix(year) {
  const value = String(year ?? "").trim();
  if (!/^\d{4}$/.test(value)) throw new Error(`Invalid ECR naming-series year '${value}'.`);
  return `ECR-${value}-1`;
}

async function runNamingSettingsMethod(api, method, prefix, currentValue) {
  const settings = await api(
    "GET",
    "/api/resource/Document Naming Settings/Document Naming Settings",
  );
  const docs = {
    ...settings,
    doctype: "Document Naming Settings",
    name: "Document Naming Settings",
    prefix,
  };
  if (currentValue !== undefined) docs.current_value = currentValue;
  return api("POST", "/api/method/run_doc_method", {
    method,
    docs: JSON.stringify(docs),
    args: "{}",
  });
}

/**
 * Keep Frappe's atomic series counter at or above all persisted document names.
 * The bounded retry detects concurrent creates instead of silently regressing
 * the counter below a name committed during migration.
 */
export async function ensureEcrNamingSeriesCounter({ api, loadRows, year }) {
  const prefix = ecrSeriesPrefix(year);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const rows = await loadRows();
    const persistedMaximum = maxNewEcrSeriesCounter(rows, year);
    const current = Number(
      await runNamingSettingsMethod(api, "get_current", prefix),
    );
    if (!Number.isSafeInteger(current) || current < 0) {
      throw new Error(`Invalid Frappe naming-series counter '${current}' for ${prefix}.`);
    }
    if (Math.max(current, persistedMaximum) >= 99999) {
      throw new Error(
        `The ${prefix}##### ECR naming band is exhausted. Extend the naming policy before creating another ECR.`,
      );
    }
    if (current < persistedMaximum) {
      await runNamingSettingsMethod(api, "update_series_start", prefix, persistedMaximum);
    }

    const verified = Number(
      await runNamingSettingsMethod(api, "get_current", prefix),
    );
    const freshMaximum = maxNewEcrSeriesCounter(await loadRows(), year);
    if (verified >= freshMaximum && verified >= persistedMaximum) {
      return { prefix, current: verified, floor: freshMaximum };
    }
    if (attempt < 3) continue;
  }
  throw new Error(
    `Could not safely seed the ${prefix}##### ECR naming series because ECRs changed concurrently. Rerun during a maintenance window.`,
  );
}
