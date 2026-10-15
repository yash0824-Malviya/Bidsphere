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

import { resolveServerRole, issueInternalAccessToken } from "../api/rbacAuth.ts";

const base = (
  process.env.ERPNEXT_URL ||
  process.env.VITE_ERPNEXT_URL ||
  process.env.VITE_PROXY_TARGET ||
  ""
).replace(/\/+$/, "");
const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";
const auth = `token ${key}:${secret}`;

async function run() {
  const userRes = await fetch(`${base}/api/resource/User/legal@netlink.com`, {
    headers: { Authorization: auth, Accept: "application/json" }
  });
  const userJson = await userRes.json();
  const roles = (userJson.data?.roles || []).map(r => r.role);
  console.log("ERP roles for legal@netlink.com:", roles.filter(r => r.includes("Legal")));

  const role = resolveServerRole({
    name: "legal@netlink.com",
    email: "legal@netlink.com",
    erpnext_roles: roles,
  });
  console.log("Resolved server role:", role);
}

run();
