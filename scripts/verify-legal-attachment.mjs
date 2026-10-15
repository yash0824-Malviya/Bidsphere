// Read-only service-side integration check against the existing ERP document.
// This is NOT a substitute for a signed-in Legal Manager browser/session test.
// Never mints user tokens, changes ERP records, or prints credentials/content.
import { createServer, loadEnv } from "vite";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";

const env = loadEnv("development", process.cwd(), "");
process.env.ERPNEXT_URL ||= env.ERPNEXT_URL || env.VITE_ERPNEXT_URL || env.VITE_PROXY_TARGET;
process.env.ERP_API_KEY ||= env.ERP_API_KEY || env.VITE_API_KEY;
process.env.ERP_API_SECRET ||= env.ERP_API_SECRET || env.VITE_API_SECRET;
const base = process.env.ERPNEXT_URL?.replace(/\/+$/, "").replace(/\/api$/, "");
if (!base || !process.env.ERP_API_KEY || !process.env.ERP_API_SECRET) throw new Error("ERP configuration missing.");
const headers = { Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`, Accept: "application/json" };
const loadDocument = async (doctype, name) => {
  const response = await fetch(`${base}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error("Document lookup failed."), { status: response.status });
  return (await response.json()).data;
};
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { resolveLegalReviewFile, authorizeLegalFileIfApplicable } = await server.ssrLoadModule("/api/legalAttachmentAccess.ts");
  const { fetchErpFile, resolveExactErpFileRecord } = await server.ssrLoadModule("/api/fileProxyCore.ts");
  const reviewName = "LDC2026-00021";
  const documentKey = process.argv.includes("insurance") ? "insurance" : "terms";
  const requestedPath = documentKey === "insurance"
    ? "/private/files/Robotic_Welding_Cell_Preliminary_Technical_Specification.pdf"
    : "/private/files/Inteva BidSphere Documentation.pdf";
  console.log("[verification-kind] Real ERP metadata/bytes; service-side policy checks, NOT authenticated user-session acceptance.");
  try {
    await resolveExactErpFileRecord(base, requestedPath, headers);
    throw new Error("Expected the unscoped duplicate-path lookup to remain blocked.");
  } catch (error) {
    if (error.status !== 403) throw error;
    console.log("[unscoped-regression-reproduced]", { status: error.status, reason: error.message });
  }
  const principal = (role, email) => ({ typ: "internal", role, email, sub: email, iat: 1, exp: 9999999999 });
  const legal = principal("legal", "legal@netlink.com");
  let selected;
  for (const user of [legal, principal("procurement", "procurement@netlink.com"), principal("department", "unassigned@example.test")]) {
    try {
      const file = await resolveLegalReviewFile({ principal: user, reviewName, documentKey, requestedPath, loadDocument });
      if (user.role === "department") throw new Error("Unexpected department access.");
      selected = file;
      console.log("[policy-allowed]", { role: user.role, fileId: file.name, parent: file.attached_to_name, private: file.is_private });
    } catch (error) {
      if (user.role !== "department" || error.status !== 403) throw error;
      console.log("[policy-denied]", { role: user.role, status: error.status });
    }
  }
  if (!selected) throw new Error("No authorized File resolved.");
  const result = await fetchErpFile({ baseUrl: base, filePath: requestedPath, fileId: selected.name,
    apiKey: process.env.ERP_API_KEY, apiSecret: process.env.ERP_API_SECRET,
    authorizeFile: async file => {
      if (!await authorizeLegalFileIfApplicable({ principal: legal, file, loadDocument })) throw new Error("CLM authorization was not applied.");
    },
  });
  if (!result.ok || result.contentType !== "application/pdf" || result.buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error(`Actual PDF retrieval failed (${result.status}).`);
  }
  // Outside the Vite workspace/public root so this private QA copy is never
  // reachable through the application's static-file server.
  const pages = (await PDFDocument.load(result.buffer)).getPageCount();
  let output;
  if (process.argv.includes("--save-qa-copy")) {
    const directory = await mkdtemp(join(tmpdir(), "bidsphere-clm-access-"));
    output = join(directory, "actual-attachment.pdf");
    await writeFile(output, result.buffer);
  }
  console.log("[actual-pdf-service-response]", { documentKey, fileId: selected.name, status: result.status, contentType: result.contentType, bytes: result.buffer.length, pages, private: selected.is_private, output });
} finally { await server.close(); }
