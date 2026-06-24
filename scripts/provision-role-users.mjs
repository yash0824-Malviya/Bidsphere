/**
 * Provision BidSphere role users in ERPNext.
 *
 * Usage (from inteva-p2p folder):
 *   node scripts/provision-role-users.mjs
 *
 * Requires env:
 *   ERPNEXT_URL or VITE_ERPNEXT_URL
 *   ERP_API_KEY, ERP_API_SECRET
 *   ROLE_USER_PASSWORD (default: Netlink@2026)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const baseUrl = (
  process.env.ERPNEXT_URL ??
  process.env.VITE_ERPNEXT_URL ??
  process.env.VITE_PROXY_TARGET ??
  ""
).replace(/\/$/, "");

const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
const password = process.env.ROLE_USER_PASSWORD ?? "Netlink@2026";

const USERS = [
  {
    email: "procurement@netlink.com",
    first_name: "Procurement",
    last_name: "Manager",
    roles: ["Purchase Manager", "Purchase User"],
  },
  {
    email: "finance@netlink.com",
    first_name: "Finance",
    last_name: "User",
    roles: ["Accounts Manager", "Accounts User"],
  },
  {
    email: "warehouse@netlink.com",
    first_name: "Warehouse",
    last_name: "Manager",
    roles: ["Stock Manager", "Stock User"],
  },
  {
    email: "admin@netlink.com",
    first_name: "System",
    last_name: "Administrator",
    roles: ["System Manager"],
  },
];

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `token ${apiKey}:${apiSecret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`
    );
  }
  return data;
}

async function userExists(email) {
  try {
    await api("GET", `/api/resource/User/${encodeURIComponent(email)}`);
    return true;
  } catch {
    return false;
  }
}

async function createUser(user) {
  const roleRows = user.roles.map((role) => ({ role }));
  const exists = await userExists(user.email);
  if (exists) {
    console.log(`• ${user.email} already exists — updating password & roles`);
    await api("PUT", `/api/resource/User/${encodeURIComponent(user.email)}`, {
      new_password: password,
      roles: roleRows,
      enabled: 1,
    });
    return;
  }

  console.log(`• Creating ${user.email} (${user.roles.join(", ")})`);
  await api("POST", "/api/resource/User", {
    doctype: "User",
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    send_welcome_email: 0,
    new_password: password,
    roles: roleRows,
    enabled: 1,
  });
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error(
      "Missing ERPNEXT_URL and ERP API credentials in .env"
    );
    process.exit(1);
  }

  console.log(`Provisioning role users on ${baseUrl}`);
  console.log(`Default password: ${password}\n`);

  for (const user of USERS) {
    await createUser(user);
  }

  console.log("\nDone. Login emails:");
  for (const user of USERS) {
    console.log(`  ${user.email}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
