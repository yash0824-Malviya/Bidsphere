import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { issueInternalAccessToken } from "../api/rbacAuth.ts";
import handler from "../api/file-proxy.ts";

function loadEnv() {
  const envPath = resolve(".env");
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

// Test handler directly with Legal Manager principal
async function testProxy() {
  process.env.BIDSPHERE_SESSION_SECRET = "bidsphere-dev-session-secret";
  const token = issueInternalAccessToken({
    sub: "legal@netlink.com",
    email: "legal@netlink.com",
    role: "legal",
  });

  const req = {
    method: "GET",
    headers: {},
    query: {
      path: "/private/files/Bank_Statement_2.pdf",
      access_token: token,
    },
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    json(data) {
      this.body = data;
      console.log("RESPONSE JSON:", this.statusCode, data);
      return this;
    },
    send(buf) {
      console.log("RESPONSE SEND:", this.statusCode, "Length:", buf.length);
      return this;
    },
    end() {
      console.log("RESPONSE END:", this.statusCode);
      return this;
    }
  };

  try {
    await handler(req, res);
  } catch (err) {
    console.error("HANDLER ERROR:", err);
  }
}

testProxy().catch(console.error);
