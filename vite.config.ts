import { defineConfig, loadEnv, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";

/**
 * Dev-server parity for `api/legal-review.ts` (the Vercel serverless
 * function used in production). `npm run dev` never runs the real Vercel
 * functions — the built-in `/api` proxy below forwards straight to
 * ERPNext — so without this plugin, local development would silently
 * bypass the backend-owned Legal Document Review logic entirely.
 *
 * This plugin intercepts `/api/legal-review/*` BEFORE Vite's `/api` proxy
 * and calls the exact same `api/legalReviewCore.ts` module the Vercel
 * function uses, so behaviour is identical in dev and production.
 */
function legalReviewDevMiddleware(): Plugin {
  return {
    name: "legal-review-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const match = /^\/api\/legal-review\/([^/?]+)/.exec(url);
        if (!match || req.method !== "POST") {
          next();
          return;
        }

        const action = match[1];
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};

          // `server.ssrLoadModule` (not a plain `import()`) so edits to
          // legalReviewCore.ts are picked up on the next request instead of
          // being stuck in Node's ESM module cache for the life of the
          // dev-server process.
          const core = await server.ssrLoadModule("/api/legalReviewCore.ts");
          let payload: unknown;
          switch (action) {
            case "create":
              payload = { success: true, ...(await core.createLegalDocumentReview(body)) };
              break;
            case "approve":
              payload = {
                success: true,
                record: await core.decideLegalDocumentReview({
                  name: body.name,
                  status: "Approved",
                  reviewedBy: body.reviewedBy,
                  comments: body.comments,
                }),
              };
              break;
            case "reject":
              payload = {
                success: true,
                record: await core.decideLegalDocumentReview({
                  name: body.name,
                  status: "Rejected",
                  reviewedBy: body.reviewedBy,
                  comments: body.comments,
                  rejectionReason: body.rejectionReason,
                }),
              };
              break;
            case "update-flags":
              payload = {
                success: true,
                record: await core.updateLegalDocumentFlags(body.name, body.updates ?? {}),
              };
              break;
            case "resubmit":
              payload = {
                success: true,
                record: await core.resubmitLegalReview(body.name, body.resubmittedBy, body.note),
              };
              break;
            case "finance-approve":
              payload = {
                success: true,
                record: await core.decideFinanceReview({
                  name: body.name,
                  status: "Approved",
                  reviewedBy: body.reviewedBy,
                  comments: body.comments,
                }),
              };
              break;
            case "finance-reject":
              payload = {
                success: true,
                record: await core.decideFinanceReview({
                  name: body.name,
                  status: "Rejected",
                  reviewedBy: body.reviewedBy,
                  comments: body.comments,
                  rejectionReason: body.rejectionReason,
                }),
              };
              break;
            case "finance-resubmit":
              payload = {
                success: true,
                record: await core.resubmitFinanceReview(body.name, body.resubmittedBy, body.note),
              };
              break;
            default:
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: `Unknown legal-review action: ${action}` }));
              return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        } catch (err) {
          const status =
            (err as { status?: number })?.status && Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message = err instanceof Error ? err.message : "Legal review request failed.";
          console.error(`[legal-review-dev] action=${action} FAILED:`, message);
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: message }));
        }
      });
    },
  };
}

/**
 * Dev-server parity for `api/file-proxy.ts` (see that file for the "why").
 * Vite's generic `/api` proxy below strips the query string context needed
 * to re-target ERPNext's `/private/files/*` namespace, so intercept this
 * one route explicitly and forward it with the API-key Authorization header
 * attached — mirroring exactly what the production serverless function does.
 */
function fileProxyDevMiddleware(
  proxyTarget: string,
  apiKey: string,
  apiSecret: string
): Plugin {
  return {
    name: "file-proxy-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/file-proxy")) {
          next();
          return;
        }
        const query = new URLSearchParams(url.split("?")[1] ?? "");
        const filePath = query.get("path") ?? "";
        if (!/^\/?(private\/)?files\//.test(filePath)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Invalid file path." }));
          return;
        }
        const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
        const target = `${proxyTarget.replace(/\/+$/, "")}${normalized}`;
        try {
          const upstream = await fetch(target, {
            headers:
              apiKey && apiSecret
                ? { Authorization: `token ${apiKey}:${apiSecret}` }
                : {},
          });
          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            if (["content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) return;
            res.setHeader(key, value);
          });
          const buffer = Buffer.from(await upstream.arrayBuffer());
          res.end(buffer);
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget =
    env.VITE_PROXY_TARGET ||
    env.VITE_ERPNEXT_URL ||
    "http://localhost:8081";
  const erpApiKey = env.ERP_API_KEY || env.VITE_API_KEY || "";
  const erpApiSecret = env.ERP_API_SECRET || env.VITE_API_SECRET || "";

  // `api/legalReviewCore.ts` reads credentials from `process.env` (matching
  // how Vercel injects real environment variables in production) — mirror
  // that here so the dev middleware above behaves identically.
  process.env.ERPNEXT_URL = process.env.ERPNEXT_URL || proxyTarget;
  process.env.ERP_API_KEY = process.env.ERP_API_KEY || erpApiKey;
  process.env.ERP_API_SECRET = process.env.ERP_API_SECRET || erpApiSecret;

  const demoMfaEnabled =
    env.APP_ENV === "demo" ||
    env.DEMO_MFA === "true" ||
    env.VITE_DEMO_MFA === "true";

  return {
    plugins: [
      react(),
      legalReviewDevMiddleware(),
      fileProxyDevMiddleware(proxyTarget, erpApiKey, erpApiSecret),
    ],
    define: {
      __DEMO_MFA_ENABLED__: JSON.stringify(demoMfaEnabled),
      __DEMO_MFA_OTP__: JSON.stringify(demoMfaEnabled ? "121212" : ""),
    },
    build: {
      // Route-level lazy loading keeps the entry chunk small; this splits the
      // remaining heavy third-party libs into cacheable vendor chunks so a
      // single page never pulls 3D, charts and PDF code it doesn't use.
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("three") || id.includes("@react-three"))
              return "vendor-three";
            if (id.includes("recharts") || id.includes("d3-"))
              return "vendor-charts";
            if (
              id.includes("jspdf") ||
              id.includes("html2canvas") ||
              id.includes("canvg")
            )
              return "vendor-pdf";
            if (
              id.includes("react-markdown") ||
              id.includes("remark") ||
              id.includes("micromark") ||
              id.includes("mdast") ||
              id.includes("unist") ||
              id.includes("hast") ||
              id.includes("vfile") ||
              id.includes("property-information")
            )
              return "vendor-markdown";
            if (
              id.includes("react-router") ||
              id.includes("react-dom") ||
              id.includes("@tanstack")
            )
              return "vendor-react";
            return "vendor";
          },
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5175,
      strictPort: true,
      allowedHosts: [".ngrok-free.dev", ".ngrok.app", "localhost"],
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          timeout: 30_000,
          proxyTimeout: 30_000,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
              const isLoginEndpoint =
                req.url === "/api/method/login" ||
                req.url === "/api/method/logout";

              if (isLoginEndpoint) {
                // Login/logout must use the submitted user's credentials —
                // NOT the API key. Pass cookies through so Frappe can
                // establish a session for the actual user.
                proxyReq.removeHeader("Authorization");
              } else {
                // All other API calls use token auth.
                if (erpApiKey && erpApiSecret) {
                  proxyReq.setHeader(
                    "Authorization",
                    `token ${erpApiKey}:${erpApiSecret}`
                  );
                }
                proxyReq.removeHeader("cookie");
              }
            });
            proxy.on("error", (err) => {
              console.log("[proxy error]", err.message);
            });
          },
        },
      },
    },
  };
});
