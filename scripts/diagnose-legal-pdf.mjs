/**
 * End-to-end Legal PDF / file-proxy diagnosis against live ERPNext.
 * Usage: node scripts/diagnose-legal-pdf.mjs
 */
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
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

console.log("BASE", base);
console.log("HAS_CREDS", Boolean(key && secret));

async function api(path) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    text: text.slice(0, 500),
    json,
  };
}

async function probeFile(fileUrl) {
  const path = fileUrl.startsWith("http")
    ? new URL(fileUrl).pathname
    : fileUrl.startsWith("/")
      ? fileUrl
      : `/${fileUrl}`;
  const encoded = path
    .split("/")
    .map((s, i) => (i === 0 ? s : encodeURIComponent(s)))
    .join("/");
  const direct = `${base}${encoded}`;
  const r1 = await fetch(direct, {
    headers: {
      Authorization: auth,
      Accept: "application/pdf,application/octet-stream,*/*",
    },
  });
  const b1 = Buffer.from(await r1.arrayBuffer());
  const magic = b1.subarray(0, 4).toString("utf8");
  const preview = b1.subarray(0, 300).toString("utf8").replace(/\s+/g, " ");

  const dl =
    `${base}/api/method/frappe.utils.file_manager.download_file` +
    `?file_url=${encodeURIComponent(path)}`;
  const r2 = await fetch(dl, {
    headers: {
      Authorization: auth,
      Accept: "application/pdf,application/octet-stream,*/*",
    },
  });
  const b2 = Buffer.from(await r2.arrayBuffer());
  const magic2 = b2.subarray(0, 4).toString("utf8");
  const preview2 = b2.subarray(0, 300).toString("utf8").replace(/\s+/g, " ");

  const filters = encodeURIComponent(JSON.stringify([["file_url", "=", path]]));
  const fields = encodeURIComponent(
    JSON.stringify([
      "name",
      "file_name",
      "file_url",
      "is_private",
      "file_size",
      "attached_to_doctype",
      "attached_to_name",
    ]),
  );
  const fileLookup = await api(
    `/api/resource/File?filters=${filters}&fields=${fields}&limit_page_length=5`,
  );

  // Also try basename match if exact path miss
  const basename = path.split("/").pop();
  const filters2 = encodeURIComponent(
    JSON.stringify([["file_name", "=", basename]]),
  );
  const byName = await api(
    `/api/resource/File?filters=${filters2}&fields=${fields}&limit_page_length=5`,
  );

  return {
    path,
    direct: {
      status: r1.status,
      ct: r1.headers.get("content-type"),
      bytes: b1.length,
      magic,
      preview,
    },
    download_file: {
      status: r2.status,
      ct: r2.headers.get("content-type"),
      bytes: b2.length,
      magic: magic2,
      preview: preview2,
    },
    fileDocsByUrl: fileLookup,
    fileDocsByName: byName,
  };
}

const me = await api("/api/method/frappe.auth.get_logged_user");
console.log("\nAUTH", {
  status: me.status,
  user: me.json?.message,
  preview: me.text.slice(0, 200),
});

const doctypes = [
  "Legal Document Review",
  "Legal Document Set",
  "Legal Review",
];
let workingDoctype = null;
for (const dt of doctypes) {
  const r = await api(
    `/api/resource/${encodeURIComponent(dt)}?fields=${encodeURIComponent(JSON.stringify(["name"]))}&limit_page_length=1`,
  );
  const ok = Array.isArray(r.json?.data);
  console.log("DOCTYPE_PROBE", dt, r.status, ok ? "OK" : r.text.slice(0, 160));
  if (ok && !workingDoctype) workingDoctype = dt;
}

if (!workingDoctype) {
  console.error("No Legal doctype found.");
  process.exit(1);
}

const fields = [
  "name",
  "sq_name",
  "rfq_name",
  "supplier",
  "terms_file_url",
  "warranty_file_url",
  "insurance_file_url",
  "review_status",
  "modified",
];
const list = await api(
  `/api/resource/${encodeURIComponent(workingDoctype)}?fields=${encodeURIComponent(JSON.stringify(fields))}&order_by=modified%20desc&limit_page_length=8`,
);
console.log("\nLEGAL_DOCTYPE", workingDoctype, "STATUS", list.status);
console.log("LEGAL_COUNT", list.json?.data?.length ?? 0);

for (const row of list.json?.data ?? []) {
  console.log("\n==== REVIEW", row.name, "status=", row.review_status);
  console.log({
    doctype: workingDoctype,
    document_name: row.name,
    sq: row.sq_name,
    rfq: row.rfq_name,
    supplier: row.supplier,
  });
  for (const key of [
    "terms_file_url",
    "warranty_file_url",
    "insurance_file_url",
  ]) {
    const url = row[key];
    console.log(`\n-- ${key}:`, url || "(empty)");
    if (!url) continue;
    const probe = await probeFile(url);
    console.log(JSON.stringify(probe, null, 2));
  }
}
