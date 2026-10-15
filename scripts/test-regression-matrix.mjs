import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

import { issueInternalAccessToken, issueSupplierAccessToken } from "../api/rbacAuth.ts";

async function testMatrix() {
  const targetUrl = "http://localhost:5175/api/file-proxy?path=%2Fprivate%2Ffiles%2FInteva+BidSphere+Documentation.pdf&legal_review=LDC2026-00021&document_key=terms";

  const cases = [
    {
      name: "A. Legal Reviewer (legal@netlink.com)",
      token: issueInternalAccessToken({ sub: "legal@netlink.com", email: "legal@netlink.com", role: "legal" }),
      expectedStatus: 200,
    },
    {
      name: "B. Authorized Procurement Reviewer (procurement@netlink.com - owner/buyer)",
      token: issueInternalAccessToken({ sub: "procurement@netlink.com", email: "procurement@netlink.com", role: "procurement" }),
      expectedStatus: 200,
    },
    {
      name: "C. Unauthorized Department User (dept@netlink.com)",
      token: issueInternalAccessToken({ sub: "dept@netlink.com", email: "dept@netlink.com", role: "department" }),
      expectedStatus: 403,
    },
    {
      name: "D. Supplier / external user (SUPP-001)",
      token: issueSupplierAccessToken({ supplier: "SUPP-001" }),
      expectedStatus: 403,
    },
    {
      name: "E. Administrator (Administrator)",
      token: issueInternalAccessToken({ sub: "Administrator", email: "admin@netlink.com", role: "admin" }),
      expectedStatus: 200,
    },
    {
      name: "F. Anonymous (No token)",
      token: null,
      expectedStatus: 401,
    },
  ];

  console.log("================== REGRESSION TEST MATRIX ==================");
  let passedCount = 0;
  for (const c of cases) {
    const headers = { Accept: "application/pdf,application/json,*/*" };
    if (c.token) headers["X-Bidsphere-Access-Token"] = c.token;

    const res = await fetch(targetUrl, { headers });
    const isPass = res.status === c.expectedStatus;
    if (isPass) passedCount++;
    console.log(`[${isPass ? "PASS" : "FAIL"}] ${c.name} -> HTTP ${res.status} (expected ${c.expectedStatus})`);
  }
  console.log(`\nResult: ${passedCount}/${cases.length} passed.`);
}

testMatrix().catch(console.error);
