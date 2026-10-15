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

async function api(path, options = {}) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, text };
  }
}

async function run() {
  console.log("=== 1. Add 'Legal Reviewer' role to legal@netlink.com in ERPNext ===");
  const userRes = await api(`/api/resource/User/legal@netlink.com`);
  const user = userRes.data?.data;
  if (user) {
    const roles = user.roles || [];
    const hasLegalReviewer = roles.some(r => r.role === "Legal Reviewer");
    console.log("Already has Legal Reviewer?", hasLegalReviewer);
    if (!hasLegalReviewer) {
      roles.push({ doctype: "Has Role", role: "Legal Reviewer" });
      const updateRes = await api(`/api/resource/User/legal@netlink.com`, {
        method: "PUT",
        body: JSON.stringify({ roles }),
      });
      console.log("User update status:", updateRes.status, updateRes.data?.data ? "OK" : updateRes.data || updateRes.text);
    }
  }

  console.log("\n=== 2. Add Custom DocPerm on Legal Document Review for Legal Reviewer ===");
  const ldcPermRes = await api(`/api/resource/Custom DocPerm?filters=${encodeURIComponent(JSON.stringify([["parent", "=", "Legal Document Review"], ["role", "=", "Legal Reviewer"]]))}`);
  if (ldcPermRes.data?.data?.length === 0) {
    const createRes = await api(`/api/resource/Custom DocPerm`, {
      method: "POST",
      body: JSON.stringify({
        doctype: "Custom DocPerm",
        parent: "Legal Document Review",
        parenttype: "DocType",
        parentfield: "permissions",
        role: "Legal Reviewer",
        permlevel: 0,
        read: 1,
        write: 1,
        create: 0,
        delete: 0,
        submit: 0,
        cancel: 0,
        report: 1,
        export: 1,
      }),
    });
    console.log("Create LDC DocPerm status:", createRes.status, createRes.data?.data?.name || createRes.data || createRes.text);
  } else {
    console.log("LDC DocPerm for Legal Reviewer already exists:", ldcPermRes.data?.data);
  }

  console.log("\n=== 3. Add Custom DocPerm on Supplier Quotation for Legal Reviewer ===");
  const sqPermRes = await api(`/api/resource/Custom DocPerm?filters=${encodeURIComponent(JSON.stringify([["parent", "=", "Supplier Quotation"], ["role", "=", "Legal Reviewer"]]))}`);
  if (sqPermRes.data?.data?.length === 0) {
    const createRes = await api(`/api/resource/Custom DocPerm`, {
      method: "POST",
      body: JSON.stringify({
        doctype: "Custom DocPerm",
        parent: "Supplier Quotation",
        parenttype: "DocType",
        parentfield: "permissions",
        role: "Legal Reviewer",
        permlevel: 0,
        read: 1,
        write: 0,
        create: 0,
        delete: 0,
        submit: 0,
        cancel: 0,
        report: 1,
        export: 1,
      }),
    });
    console.log("Create SQ DocPerm status:", createRes.status, createRes.data?.data?.name || createRes.data || createRes.text);
  } else {
    console.log("SQ DocPerm for Legal Reviewer already exists:", sqPermRes.data?.data);
  }
}

run();
