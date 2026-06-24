import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget =
    env.VITE_PROXY_TARGET ||
    env.VITE_ERPNEXT_URL ||
    "http://localhost:8081";
  const erpApiKey = env.ERP_API_KEY || env.VITE_API_KEY || "";
  const erpApiSecret = env.ERP_API_SECRET || env.VITE_API_SECRET || "";

  return {
    plugins: [react()],
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
