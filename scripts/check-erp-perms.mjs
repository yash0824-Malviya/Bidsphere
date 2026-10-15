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

const base = (
  process.env.ERPNEXT_URL ||
  process.env.VITE_ERPNEXT_URL ||
  process.env.VITE_PROXY_TARGET ||
  ""
).replace(/\/+$/, "");
const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";
const auth = `token ${key}:${secret}`;

async function api(path) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  return await res.json();
}

async function run() {
  console.log("=== Check User legal@netlink.com ===");
  const user = await api(`/api/resource/User/legal@netlink.com`);
  console.log("User roles:", user.data?.roles?.map(r => r.role));

  console.log("\n=== Check Custom DocPerm / DocPerm for Supplier Quotation ===");
  const sqPerms = await api(`/api/resource/Custom DocPerm?filters=${encodeURIComponent(JSON.stringify([["parent", "=", "Supplier Quotation"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("SQ Custom DocPerms:", sqPerms.data);

  const sqStandardPerms = await api(`/api/resource/DocPerm?filters=${encodeURIComponent(JSON.stringify([["parent", "=", "Supplier Quotation"]]))}&fields=${encodeURIComponent(JSON.stringify(["role", "read", "write", "create", "submit"]))}`);
  console.log("SQ Standard DocPerms for Legal:", sqStandardPerms.data?.filter(p => p.role?.toLowerCase().includes("legal")));

  console.log("\n=== Check Custom DocPerm / DocPerm for Legal Document Review ===");
  const ldcPerms = await api(`/api/resource/Custom DocPerm?filters=${encodeURIComponent(JSON.stringify([["parent", "=", "Legal Document Review"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("LDC Custom DocPerms:", ldcPerms.data);

  const ldcStandardPerms = await api(`/api/resource/DocPerm?filters=${encodeURIComponent(JSON.stringify([["parent", "=", "Legal Document Review"]]))}&fields=${encodeURIComponent(JSON.stringify(["role", "read", "write", "create", "submit"]))}`);
  console.log("LDC Standard DocPerms for Legal:", ldcStandardPerms.data?.filter(p => p.role?.toLowerCase().includes("legal")));

  console.log("\n=== Check User Permissions for legal@netlink.com ===");
  const userPerms = await api(`/api/resource/User Permission?filters=${encodeURIComponent(JSON.stringify([["user", "=", "legal@netlink.com"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("User Permissions:", userPerms.data);
}

run();
