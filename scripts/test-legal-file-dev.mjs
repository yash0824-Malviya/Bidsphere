// Local-only Vite adapter integration test. All ERP data and sessions are
// fixtures on loopback; this never authenticates to or writes real ERP data.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "vite";

const path = "/private/files/contract.pdf";
const review = { name: "LDR-TEST", sq_name: "SQ-TEST", review_status: "Pending", workflow_state: "Pending Review", owner: "Administrator", procurement_manager: "buyer@example.test", terms_file_url: path };
const quotation = { name: "SQ-TEST", owner: "Administrator", supplier: "SUP-TEST" };
const file = { name: "FILE-TEST", file_url: path, is_private: 1, attached_to_doctype: "Supplier Quotation", attached_to_name: "SQ-TEST", attached_to_field: "custom_terms__condition" };
let binaryReads = 0;
const erp = createHttpServer((req, res) => {
  assert.equal(req.method, "GET", "Integration fixtures permit reads only");
  const url = new URL(req.url, "http://localhost");
  const route = decodeURIComponent(url.pathname);
  res.setHeader("Content-Type", "application/json");
  let data;
  if (route === "/api/resource/Legal Document Review/LDR-TEST") data = review;
  else if (route === "/api/resource/Supplier Quotation/SQ-TEST") data = quotation;
  else if (route === "/api/resource/Legal Document Review") data = [{ name: review.name }];
  else if (route === "/api/resource/File/FILE-TEST") data = file;
  else if (route === "/api/resource/File") {
    const filters = JSON.parse(url.searchParams.get("filters"));
    data = filters.some(f => f[2] === "Legal Document Review") ? [] : [file, { ...file, name: "DUPLICATE", attached_to_field: null }];
  } else if (route === path) {
    binaryReads++;
    res.setHeader("Content-Type", "application/pdf");
    res.end("%PDF-dev-fixture");
    return;
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Missing fixture" }));
    return;
  }
  res.end(JSON.stringify({ data }));
});
await new Promise(resolve => erp.listen(0, "127.0.0.1", resolve));
const erpUrl = `http://127.0.0.1:${erp.address().port}`;
for (const name of ["ERPNEXT_URL", "VITE_ERPNEXT_URL", "VITE_PROXY_TARGET"]) process.env[name] = erpUrl;
process.env.ERP_API_KEY = process.env.VITE_API_KEY = "fixture-key";
process.env.ERP_API_SECRET = process.env.VITE_API_SECRET = "fixture-secret";
process.env.BIDSPHERE_SESSION_SECRET = "isolated-dev-clm-fixture-secret";
process.env.APP_ENV = "test";
process.env.DEMO_MFA = process.env.VITE_DEMO_MFA = "false";
let vite;
try {
  vite = await createServer({ server: { host: "127.0.0.1", port: 0, open: false, hmr: false }, logLevel: "error" });
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const { issueInternalAccessToken, issueSupplierAccessToken } = await vite.ssrLoadModule("/api/rbacAuth.ts");
  const cases = [
    { role: "legal", email: "reviewer@example.test", expected: 200 },
    { role: "procurement", email: "buyer@example.test", expected: 200 },
    { role: "department", email: "unassigned@example.test", expected: 403 },
    { role: "supplier", expected: 403 },
    { role: "anonymous", expected: 401 },
  ];
  for (const test of cases) {
    const token = test.role === "anonymous" ? undefined : test.role === "supplier" ? issueSupplierAccessToken({ supplier: "SUP-TEST" }) : issueInternalAccessToken({ sub: test.email, email: test.email, role: test.role });
    const query = new URLSearchParams({ path, legal_review: review.name, document_key: "terms" });
    const before = binaryReads;
    const response = await fetch(`${base}/api/file-proxy?${query}`, { headers: token ? { "X-Bidsphere-Access-Token": token } : {} });
    assert.equal(response.status, test.expected, `${test.role} status`);
    if (test.expected === 200) {
      assert.match(response.headers.get("content-type"), /application\/pdf/);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(await response.text(), "%PDF-dev-fixture");
    } else {
      assert.equal((await response.json()).success, false);
      assert.equal(binaryReads, before, "Denied sessions must not read bytes");
    }
    console.log("[Vite CLM adapter fixture test]", { role: test.role, status: response.status, passed: true });
  }
  for (const [role, action, body, expected] of [
    [null, "request-changes", { comments: "fixture" }, 401],
    ["department", "approve", { comments: "fixture" }, 403],
    ["legal", "update-flags", { updates: { esign_status: "signed" } }, 400],
    ["legal", "approve", { comments: "No reviewed version" }, 422],
  ]) {
    const token = role ? issueInternalAccessToken({ sub: "reviewer@example.test", email: "reviewer@example.test", role }) : undefined;
    const response = await fetch(`${base}/api/legal-review/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "X-Bidsphere-Access-Token": token } : {}) },
      body: JSON.stringify({ name: review.name, ...body }),
    });
    assert.equal(response.status, expected, `Local workflow authentication/gating: ${role} ${action}`);
    console.log("[Vite CLM workflow fixture test]", { role, action, status: response.status, passed: true });
  }
} finally {
  await vite?.close();
  await new Promise(resolve => erp.close(resolve));
}
