/** Run the application read-back and Warehouse query against real ERPNext.
 * All non-GET traffic is blocked: never resets, creates, or resubmits an MR.
 */
import { createServer, loadEnv } from "vite";
import axios from "axios";

const env = loadEnv("development", process.cwd(), "");
const base = (env.ERPNEXT_URL || env.VITE_ERPNEXT_URL || env.VITE_PROXY_TARGET || "").replace(/\/$/, "");
const key = env.ERP_API_KEY || env.VITE_API_KEY;
const secret = env.ERP_API_SECRET || env.VITE_API_SECRET;
if (!base || !key || !secret) throw new Error("ERPNext server credentials are not configured.");
const name = process.argv[2] || "MAT-MR-2026-00102";
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
// Application debug logs may include Axios errors. Do not let an error dump
// transport headers containing this script's server credentials.
const originalConsole = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
for (const method of Object.keys(originalConsole)) console[method] = () => {};
try {
  const { erpnextClient } = await server.ssrLoadModule("/src/api/erpnext.ts");
  erpnextClient.defaults.baseURL = base;
  erpnextClient.defaults.headers.common.Authorization = `token ${key}:${secret}`;
  const adapter = axios.getAdapter(erpnextClient.defaults.adapter);
  const requests = [];
  erpnextClient.defaults.adapter = async (config) => {
    if (config.method?.toUpperCase() !== "GET") {
      throw new Error("Read-only verification refused a mutation.");
    }
    config.headers.set("Authorization", `token ${key}:${secret}`);
    const response = await adapter(config);
    requests.push({ method: "GET", url: config.url, status: response.status });
    return response;
  };
  const workflow = await server.ssrLoadModule("/src/api/materialRequestWorkflow.ts");
  const before = await workflow.fetchMaterialRequestWorkflow(name, { fresh: true, skipItemAttachmentHydration: true });
  if (before.docstatus !== 1 || before.custom_bidsphere_status !== "Under Warehouse Review") {
    throw new Error("The existing MR is not already submitted; a live mutation requires a separate intentional test.");
  }
  // Exercise the idempotent retry path against the actual submitted MR.
  const result = await workflow.submitMaterialRequestWorkflow(name);
  const refreshed = await workflow.fetchMaterialRequestWorkflow(name, { fresh: true, skipItemAttachmentHydration: true });
  const { getPendingMaterialRequests } = await server.ssrLoadModule("/src/services/warehouseService.ts");
  const queue = await getPendingMaterialRequests();
  const row = queue.find(mr => mr.name === name);
  if (!row) throw new Error(`${name} is absent from the actual Warehouse Pending Review service result.`);
  if (JSON.stringify(before.items) !== JSON.stringify(refreshed.items)) throw new Error("MR items changed during verification.");
  originalConsole.log("[MR LIVE VERIFICATION]", JSON.stringify({
    name: refreshed.name, businessStatus: refreshed.custom_bidsphere_status,
    docstatus: refreshed.docstatus, status: refreshed.status,
    workflow_state: refreshed.workflow_state ?? null, modified: refreshed.modified,
    idempotentSubmitVerified: result.custom_bidsphere_status === "Under Warehouse Review",
    subsequentReadVerified: refreshed.custom_bidsphere_status === "Under Warehouse Review",
    warehousePendingReview: row,
    itemRowsUnchanged: true, mutations: 0,
    documentGets: requests.filter(request => request.url.endsWith(encodeURIComponent(name))),
  }, null, 2));
} catch (error) {
  originalConsole.error("[MR LIVE VERIFICATION FAILED]", {
    message: error.message, status: error.response?.status,
    exception: error.response?.data?.exception,
  });
  process.exitCode = 1;
} finally {
  Object.assign(console, originalConsole);
  await server.close();
}
