import { defineConfig, loadEnv, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type multiparty from "multiparty";
import react from "@vitejs/plugin-react";
import {
  isProtectedChildDoctype,
  protectedChildAccessDenial,
  protectedChildAccessMessage,
  protectedChildRequestDoctypeFromMany,
  protectedChildResourceDoctype,
} from "./api/protectedChildGuard.ts";
import {
  canonicalizeProxyApiPath,
  isVersionedErpApiPath,
} from "./api/proxyPathGuard.ts";
import {
  hasFrappeResourceDataWrapper,
  isDirectEcrWorkflowRequest,
  requestDoctypeFromBodyOrQuery,
  requestDoctypesFromBodyOrQuery,
} from "./api/ecrDirectWorkflowGuard.ts";
import { multipartProxyPolicy } from "./api/multipartProxyGuard.ts";
import { assertErpProxySecurityBoundary } from "./api/erpProxySecurityGuard.ts";
import {
  assertSecureEcrUpload,
  isTemporaryQuotationDocname,
  parseSecureUpload,
  supplierOwnsUploadTarget,
} from "./api/secureUploadGuard.ts";
import {
  assertNoGenericFileAccess,
  authorizeFileResourceRequest,
  authorizePersistedFileRead,
} from "./api/fileResourceGuard.ts";
import type { AccessPrincipal } from "./api/rbacAuth.ts";
import {
  assertSafeProxyBody,
  assertSafeProxyQuery,
} from "./api/proxyRequestGuard.ts";
import { buildEngineerEcrReadScope } from "./api/ecrReadScope.ts";

/**
 * Server-side login/logout that never forwards ERPNext `Set-Cookie` to the
 * browser. Prevents the SPA from overwriting the Desk `sid` cookie when both
 * share a host (cookies are port-agnostic).
 */
function authSessionDevMiddleware(): Plugin {
  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
    ssrLoadModule: (url: string) => Promise<Record<string, unknown>>,
  ) => {
    const url = req.url ?? "";
    const pathOnly = url.split("?")[0];

    // Block browser → ERPNext session login/logout through the generic
    // /api proxy. Those responses Set-Cookie sid and collide with Desk.
    if (
      pathOnly === "/api/method/login" ||
      pathOnly === "/api/method/logout"
    ) {
      res.statusCode = 410;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error:
            "Browser session login is disabled. Use /api/auth/login instead.",
        }),
      );
      return;
    }

    const match = /^\/api\/auth\/(login|logout)(?:\?|$)/.exec(url);
    if (!match) {
      next();
      return;
    }
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }

    try {
      const core = await ssrLoadModule("/api/authSession.ts");
      if (match[1] === "logout") {
        const payload = (
          core.logoutLocalOnly as () => { message: string }
        )();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : {};
      const result = await (
        core.authenticateWithPassword as (b: unknown) => Promise<unknown>
      )(body);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    } catch (err) {
      const status =
        (err as { status?: number })?.status &&
        Number.isInteger((err as { status?: number }).status)
          ? (err as { status: number }).status
          : 500;
      const message =
        err instanceof Error ? err.message : "Authentication failed.";
      console.error(`[auth-session-dev] ${match[1]} FAILED:`, message);
      res.statusCode = status >= 400 && status < 600 ? status : 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message, error: message }));
    }
  };

  return {
    name: "auth-session-dev-middleware",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next, (id) => server.ssrLoadModule(id));
      });
    },
  };
}

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
            case "list":
              payload = {
                success: true,
                records: await core.listWorkflowRecords({
                  limit: typeof body.limit === "number" ? body.limit : undefined,
                }),
              };
              break;
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
 * Dev-server parity for `api/bom.ts` / `api/bomCore.ts`.
 * Intercepts `/api/bom/*` BEFORE Vite's `/api` proxy so Excel parsing and
 * RFQ creation run locally with the same privileged API-key path as Vercel.
 */
/**
 * Dev-server parity for `api/po-shipment.ts` / `api/poShipmentCore.ts`.
 * Supplier shipment updates and Warehouse Receive Goods share this SSoT.
 */
/** Strip accidental wrapping quotes from ERP supplier identifiers. */
function stripWrappingQuotes(value: string): string {
  let s = String(value ?? "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Dev-server parity for `api/supplier-voucher.ts` / `api/supplierVoucherCore.ts`.
 * Keeps supplier voucher list + detail ownership rules identical locally.
 */
function supplierVoucherDevMiddleware(): Plugin {
  return {
    name: "supplier-voucher-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const match = /^\/api\/supplier-voucher\/([^/?]+)/.exec(url);
        if (!match || (req.method !== "POST" && req.method !== "OPTIONS")) {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        const action = match[1];
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};

          const rbac = await server.ssrLoadModule("/api/rbacAuth.ts");
          const core = await server.ssrLoadModule("/api/supplierVoucherCore.ts");
          // Supplier JWT only — Finance/Admin tokens cannot create supplier invoices.
          const principal = rbac.requireSupplierAuth(
            req.headers as Record<string, unknown>,
            body as Record<string, unknown>,
          );
          const loggedInSupplier = String(
            principal.supplier || principal.sub || "",
          ).trim();
          const identity = core.resolveIdentity({
            jwtSupplier: loggedInSupplier,
            erpSupplierId: String(body.erp_supplier_id || ""),
            displayName: String(body.display_name || ""),
          });

          let payload: unknown;
          if (action === "list") {
            payload = {
              success: true,
              vouchers: await core.listSupplierVouchers({
                loggedInSupplier,
                identity,
              }),
            };
          } else if (action === "get") {
            const voucherId = String(body.voucher_id || body.id || "").trim();
            payload = {
              success: true,
              voucher: await core.getSupplierVoucher({
                voucherId,
                loggedInSupplier,
                identity,
              }),
            };
          } else if (action === "raise-invoice") {
            const voucherId = String(body.voucher_id || body.id || "").trim();
            const invoice = body.invoice;
            if (!invoice || typeof invoice !== "object") {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  success: false,
                  error: "Invoice payload is required.",
                }),
              );
              return;
            }
            payload = {
              success: true,
              voucher: await core.raiseSupplierInvoice({
                voucherId,
                loggedInSupplier,
                identity,
                invoice: {
                  invoice_number: String(invoice.invoice_number ?? ""),
                  raised_at: String(invoice.raised_at ?? ""),
                  subtotal: Number(invoice.subtotal) || 0,
                  tax_rate: Number(invoice.tax_rate) || 0,
                  tax_amount: Number(invoice.tax_amount) || 0,
                  total: Number(invoice.total) || 0,
                  payment_terms: String(invoice.payment_terms ?? ""),
                  due_date: String(invoice.due_date ?? ""),
                  notes: String(invoice.notes ?? ""),
                },
              }),
            };
          } else {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                error: `Unknown supplier-voucher action: ${action}`,
              }),
            );
            return;
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        } catch (err) {
          const status =
            (err as { status?: number })?.status &&
            Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message =
            err instanceof Error
              ? err.message
              : "Supplier voucher request failed.";
          console.error(
            `[supplier-voucher-dev] action=${action} FAILED:`,
            message,
          );
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: message }));
        }
      });
    },
  };
}

/**
 * Dev-server parity for `api/supplier-rfq-documents.ts`.
 */
function supplierRfqDocumentsDevMiddleware(): Plugin {
  return {
    name: "supplier-rfq-documents-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (
          url !== "/api/supplier-rfq-documents" ||
          (req.method !== "POST" && req.method !== "OPTIONS")
        ) {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};

          const rbac = await server.ssrLoadModule("/api/rbacAuth.ts");
          const core = await server.ssrLoadModule(
            "/api/supplierRfqDocumentsCore.ts",
          );
          const principal = rbac.requireSupplierAuth(
            req.headers as Record<string, unknown>,
            body as Record<string, unknown>,
          );
          const supplierId = String(
            body.erp_supplier_id || principal.supplier || principal.sub || "",
          ).trim();
          const supplierCandidates = core.buildSupplierAccessCandidates({
            explicitSupplierId: body.erp_supplier_id,
            jwtSupplier: principal.supplier,
            jwtSub: principal.sub,
          });
          const rfqName = String(body.rfq_name || body.rfqName || "").trim();
          const itemCode = String(body.item_code || body.itemCode || "").trim();
          const documents = await core.listSupplierRfqDocuments({
            rfqName,
            supplierId,
            supplierCandidates,
            itemCode: itemCode || undefined,
          });
          console.info("[supplier-rfq-documents-dev]", {
            rfqId: rfqName,
            supplierId,
            itemCode: itemCode || null,
            documentCount: documents.length,
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: true,
              documents,
              rfq_id: rfqName,
              document_count: documents.length,
            }),
          );
        } catch (err) {
          const status =
            err && typeof err === "object" && "status" in err
              ? Number((err as { status?: number }).status) || 500
              : 500;
          const message =
            err instanceof Error
              ? err.message
              : "Unable to load RFQ documents.";
          console.error("[supplier-rfq-documents-dev] FAILED:", err);
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: message }));
        }
      });
    },
  };
}

/**
 * Dev-server parity for `api/erp-server-date.ts`.
 * Intercepts GET /api/erp-server-date BEFORE Vite's /api proxy.
 */
function erpServerDateDevMiddleware(): Plugin {
  return {
    name: "erp-server-date-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const pathOnly = (req.url ?? "").split("?")[0] || "";
        if (pathOnly !== "/api/erp-server-date") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message: "Method Not Allowed. Use GET /api/erp-server-date.",
            }),
          );
          return;
        }
        try {
          const core = (await server.ssrLoadModule(
            "/api/erpServerDateCore.ts",
          )) as {
            resolveErpServerDate: (opts: {
              baseUrl: string;
              apiKey: string;
              apiSecret: string;
              defaultTimeZone?: string;
            }) => Promise<{
              today: string;
              time_zone: string;
              source: string;
              utc_today: string;
              http_date: string | null;
              system_settings_time_zone: string | null;
            }>;
            DEFAULT_ERP_TIME_ZONE: string;
          };
          const baseUrl = (
            process.env.ERPNEXT_URL ||
            process.env.VITE_ERPNEXT_URL ||
            process.env.VITE_PROXY_TARGET ||
            ""
          ).replace(/\/$/, "");
          const apiKey =
            process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
          const apiSecret =
            process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";
          const result = await core.resolveErpServerDate({
            baseUrl,
            apiKey,
            apiSecret,
            defaultTimeZone:
              process.env.ERP_TIME_ZONE ||
              process.env.VITE_ERP_TIME_ZONE ||
              core.DEFAULT_ERP_TIME_ZONE,
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: true,
              message: result,
              today: result.today,
              time_zone: result.time_zone,
              utc_today: result.utc_today,
              source: result.source,
              system_settings_time_zone: result.system_settings_time_zone,
              http_date: result.http_date,
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[erp-server-date-dev] FAILED:", message);
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message }));
        }
      });
    },
  };
}

/**
 * Dev-server parity for `api/stock-check.ts` / `api/stockCheckCore.ts`.
 * Intercepts POST /api/stock-check BEFORE Vite's /api proxy.
 */
function stockCheckDevMiddleware(): Plugin {
  return {
    name: "stock-check-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const pathOnly = url.split("?")[0] || "";
        if (pathOnly !== "/api/stock-check") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message: "Method Not Allowed. Use POST /api/stock-check.",
            }),
          );
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};

          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (
              headers: Record<string, unknown>,
            ) => { email?: string; role: string };
            requireRoles: (
              principal: { role: string },
              roles: string[],
            ) => void;
            RbacError: new (message: string, status?: number) => Error & {
              status: number;
            };
          };
          const core = (await server.ssrLoadModule(
            "/api/stockCheckCore.ts",
          )) as {
            runStockCheck: (input: Record<string, unknown>) => Promise<unknown>;
            StockCheckError: new (
              message: string,
              status?: number,
              code?: string,
            ) => Error & { status: number; code?: string };
          };

          const headers: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            headers[k] = v;
          }
          const principal = rbac.requireInternalAuth(headers);
          rbac.requireRoles(principal, ["warehouse", "admin", "procurement"]);

          const itemsRaw = Array.isArray(body.items) ? body.items : [];
          const items = itemsRaw.map((row: Record<string, unknown>) => ({
            item_code: String(row?.item_code ?? "").trim(),
            requested_qty: Number(row?.requested_qty) || 0,
            mr_warehouse: String(row?.mr_warehouse ?? "").trim() || undefined,
          }));
          const warehouses = (
            Array.isArray(body.warehouses) ? body.warehouses : []
          )
            .map((w: unknown) => String(w ?? "").trim())
            .filter(Boolean);

          const result = await core.runStockCheck({
            mr_number: String(body.mr_number ?? "").trim(),
            company: String(body.company ?? "").trim(),
            mr_company: String(body.mr_company ?? "").trim() || undefined,
            warehouse: String(body.warehouse ?? "").trim(),
            warehouses: warehouses.length ? warehouses : undefined,
            items,
            user:
              String(body.user ?? "").trim() ||
              principal.email ||
              "Warehouse",
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (err) {
          const status =
            err &&
            typeof err === "object" &&
            "status" in err &&
            Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message =
            err instanceof Error
              ? err.message
              : "Unable to fetch stock availability.";
          const code =
            err && typeof err === "object" && "code" in err
              ? (err as { code?: string }).code
              : undefined;
          console.error("[stock-check-dev] FAILED:", message);
          if (err instanceof Error && err.stack) {
            console.error(err.stack);
          }
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message,
              ...(code ? { code } : {}),
            }),
          );
        }
      });
    },
  };
}

function recommendSuppliersDevMiddleware(): Plugin {
  return {
    name: "recommend-suppliers-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const pathOnly = url.split("?")[0] || "";
        if (pathOnly !== "/api/recommend-suppliers") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message: "Method Not Allowed. Use POST /api/recommend-suppliers.",
            }),
          );
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};

          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (
              headers: Record<string, unknown>,
            ) => { email?: string; role: string };
            requireRoles: (
              principal: { role: string },
              roles: string[],
            ) => void;
            canBypassSupplierCategoryFilter?: (role: string) => boolean;
          };
          const core = (await server.ssrLoadModule(
            "/api/recommendSuppliersCore.ts",
          )) as typeof import("./api/recommendSuppliersCore");

          const headers: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(req.headers)) headers[k] = v;
          const principal = rbac.requireInternalAuth(headers);
          rbac.requireRoles(principal, [
            "admin",
            "procurement",
            "procurement_team",
          ]);

          const showAllRequested = body.show_all === true;
          if (
            showAllRequested &&
            core.canBypassSupplierCategoryFilter &&
            !core.canBypassSupplierCategoryFilter(principal.role)
          ) {
            throw new core.RecommendSuppliersError(
              "Only Procurement Manager or Admin may show all suppliers.",
              403,
              "permission",
            );
          }

          const itemGroupsRaw = Array.isArray(body.item_groups)
            ? body.item_groups
            : [];
          const result = await core.runRecommendSuppliers({
            procurement_category: String(body.procurement_category ?? "").trim(),
            commodity: String(body.commodity ?? "").trim(),
            item_groups: itemGroupsRaw
              .map((g: unknown) => String(g ?? "").trim())
              .filter(Boolean),
            search: String(body.search ?? "").trim(),
            show_all: showAllRequested,
            limit: Number(body.limit) || 100,
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (err) {
          const status =
            err &&
            typeof err === "object" &&
            "status" in err &&
            Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message =
            err instanceof Error
              ? err.message
              : "Supplier recommendation failed.";
          console.error("[recommend-suppliers-dev] FAILED:", message);
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          const fieldErrors = err && typeof err === "object" && "fieldErrors" in err
            ? (err as { fieldErrors?: Record<string, string> }).fieldErrors
            : undefined;
          res.end(JSON.stringify({
            success: false,
            message,
            ...(fieldErrors ? { field_errors: fieldErrors } : {}),
          }));
        }
      });
    },
  };
}

function rfqSupplierInviteDevMiddleware(): Plugin {
  return {
    name: "rfq-supplier-invite-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const pathOnly = url.split("?")[0] || "";
        if (pathOnly !== "/api/rfq-supplier-invite") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message: "Method Not Allowed. Use POST /api/rfq-supplier-invite.",
            }),
          );
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};

          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (
              headers: Record<string, unknown>,
            ) => { email?: string; role: string };
            requireRoles: (
              principal: { role: string },
              roles: string[],
            ) => void;
            RbacError: new (message: string, status?: number) => Error & {
              status: number;
            };
          };
          const core = (await server.ssrLoadModule(
            "/api/rfqSupplierInviteCore.ts",
          )) as {
            inviteSuppliersToRfqCore: (input: {
              rfqName: string;
              suppliers: Array<{
                supplier: string;
                supplier_name?: string;
                email_id?: string;
              }>;
            }) => Promise<{ rfq: unknown; invited: unknown[] }>;
            RfqSupplierInviteError: new (
              message: string,
              status?: number,
              code?: string,
            ) => Error & { status: number; code?: string };
          };

          const headers: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            headers[k] = v;
          }
          const principal = rbac.requireInternalAuth(headers);
          rbac.requireRoles(principal, ["procurement", "procurement_team", "admin"]);

          const rfqName = String(body.rfq_name ?? body.rfqName ?? "").trim();
          const suppliersRaw = Array.isArray(body.suppliers) ? body.suppliers : [];
          const suppliers = suppliersRaw
            .map((row: Record<string, unknown>) => ({
              supplier: String(row?.supplier ?? "").trim(),
              supplier_name:
                String(row?.supplier_name ?? row?.supplierName ?? "").trim() ||
                undefined,
              email_id:
                String(row?.email_id ?? row?.emailId ?? "").trim() || undefined,
            }))
            .filter((s: { supplier: string }) => s.supplier);

          const result = await core.inviteSuppliersToRfqCore({
            rfqName,
            suppliers,
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: true,
              rfq: result.rfq,
              invited: result.invited,
            }),
          );
        } catch (err) {
          const status =
            err &&
            typeof err === "object" &&
            "status" in err &&
            Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message =
            err instanceof Error
              ? err.message
              : "Could not invite suppliers to this RFQ.";
          const code =
            err && typeof err === "object" && "code" in err
              ? (err as { code?: string }).code
              : undefined;
          console.error("[rfq-supplier-invite-dev] FAILED:", message);
          if (err instanceof Error && err.stack) {
            console.error(err.stack);
          }
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message,
              ...(code ? { code } : {}),
            }),
          );
        }
      });
    },
  };
}

function rfqQuoteRoundDevMiddleware(): Plugin {
  return {
    name: "rfq-quote-round-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const pathOnly = url.split("?")[0] || "";
        if (pathOnly !== "/api/rfq-quote-round") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        try {
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (
              headers: Record<string, unknown>,
            ) => { email?: string; role: string };
            requireRoles: (
              principal: { role: string },
              roles: string[],
            ) => void;
          };
          const core = (await server.ssrLoadModule(
            "/api/rfqQuoteRoundCore.ts",
          )) as typeof import("./api/rfqQuoteRoundCore");

          const headers: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(req.headers)) headers[k] = v;
          const principal = rbac.requireInternalAuth(headers);
          rbac.requireRoles(principal, ["procurement", "procurement_team", "admin"]);

          const query = new URL(url, "http://local");
          const action =
            query.searchParams.get("action")?.trim() ||
            String(
              (req.method === "POST"
                ? undefined
                : query.searchParams.get("action")) ?? "",
            ).trim();

          if (req.method === "GET") {
            const rfqName = query.searchParams.get("rfq")?.trim() ?? "";
            const roundName = query.searchParams.get("name")?.trim() ?? "";
            if (action === "get" && roundName) {
              const round = await core.getRfqRoundCore(roundName);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: true, round }));
              return;
            }
            if (action === "active" && rfqName) {
              const round = await core.getActiveRfqRoundCore(rfqName);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: true, round }));
              return;
            }
            if (rfqName) {
              const rounds = await core.listRfqRoundsCore(rfqName);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: true, rounds }));
              return;
            }
            throw new core.RfqQuoteRoundError("Missing rfq query parameter.", 400);
          }

          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: false, message: "Method Not Allowed." }));
            return;
          }

          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};
          const postAction = query.searchParams.get("action")?.trim() || action;
          const rfqName = String(body.rfq_name ?? body.rfqName ?? "").trim();
          const createdBy = String(
            body.created_by ?? body.createdBy ?? principal.email ?? "Procurement",
          ).trim();

          if (postAction === "ensure-initial") {
            const result = await core.ensureInitialRfqRoundCore({ rfqName, createdBy });
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true, ...result }));
            return;
          }
          if (postAction === "create-next") {
            const rawSuppliers = body.associate_suppliers ?? body.associateSuppliers;
            const rawInvite =
              body.invite_suppliers ?? body.inviteSuppliers ?? rawSuppliers;
            const mapSuppliers = (rows: unknown) =>
              Array.isArray(rows)
                ? rows
                    .map((row: Record<string, unknown>) => {
                      const supplier = String(row.supplier ?? "").trim();
                      if (!supplier) return null;
                      return {
                        supplier,
                        supplier_name: String(
                          row.supplier_name ?? row.supplierName ?? supplier,
                        ),
                        email_id:
                          String(row.email_id ?? row.emailId ?? "") || undefined,
                      };
                    })
                    .filter((item): item is NonNullable<typeof item> => item !== null)
                : undefined;
            const result = await core.createNextRfqRoundCore({
              rfqName,
              reasonCode: String(body.reason_code ?? body.reasonCode ?? ""),
              remarks: String(body.remarks ?? ""),
              createdBy,
              associateSuppliers: mapSuppliers(rawSuppliers),
              inviteSuppliers: mapSuppliers(rawInvite),
            });
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true, ...result }));
            return;
          }
          if (postAction === "activate") {
            const round = await core.activateRfqRoundCore({
              roundName: String(body.round_name ?? body.roundName ?? "").trim(),
              createdBy,
            });
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true, round }));
            return;
          }

          throw new core.RfqQuoteRoundError(`Unknown action: ${postAction}`, 400);
        } catch (err) {
          const status =
            err && typeof err === "object" && "status" in err
              ? Number((err as { status?: number }).status) || 500
              : 500;
          const message =
            err instanceof Error ? err.message : "RFQ quote round request failed.";
          console.error("[rfq-quote-round-dev]", message);
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message }));
        }
      });
    },
  };
}

function reverseBiddingNamingDevMiddleware(): Plugin {
  return {
    name: "reverse-bidding-naming-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const pathOnly = url.split("?")[0] || "";
        if (pathOnly !== "/api/reverse-bidding-naming") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message: "Method Not Allowed. Use POST /api/reverse-bidding-naming.",
            }),
          );
          return;
        }

        try {
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (
              headers: Record<string, unknown>,
            ) => { email?: string; role: string };
            requireRoles: (
              principal: { role: string },
              roles: string[],
            ) => void;
            RbacError: new (message: string, status?: number) => Error & {
              status: number;
            };
          };
          const core = (await server.ssrLoadModule(
            "/api/reverseBiddingNamingCore.ts",
          )) as {
            ensureReverseBiddingChildNaming: () => Promise<unknown>;
            ReverseBiddingNamingError: new (
              message: string,
              status?: number,
            ) => Error & { status: number };
          };

          const headers: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            headers[k] = v;
          }
          const principal = rbac.requireInternalAuth(headers);
          rbac.requireRoles(principal, ["procurement", "procurement_team", "admin"]);

          const result = await core.ensureReverseBiddingChildNaming();
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (err) {
          const status =
            err &&
            typeof err === "object" &&
            "status" in err &&
            Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message =
            err instanceof Error
              ? err.message
              : "Could not configure Reverse Bidding child naming.";
          console.error("[reverse-bidding-naming-dev] FAILED:", message);
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message }));
        }
      });
    },
  };
}

function reverseBiddingSubmitDevMiddleware(): Plugin {
  return {
    name: "reverse-bidding-submit-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const pathOnly = url.split("?")[0] || "";
        if (pathOnly !== "/api/reverse-bidding-submit-item-bids") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message:
                "Method Not Allowed. Use POST /api/reverse-bidding-submit-item-bids.",
            }),
          );
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};

          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireSupplierAuth: (
              headers: Record<string, unknown>,
            ) => { sub: string; supplier: string };
            RbacError: new (message: string, status?: number) => Error & {
              status: number;
            };
          };
          const core = (await server.ssrLoadModule(
            "/api/reverseBiddingSubmitCore.ts",
          )) as {
            submitItemBidsCore: (input: {
              auctionName: string;
              supplier: string;
              items: Array<{ item_code: string; rate: number }>;
            }) => Promise<unknown>;
            ReverseBiddingSubmitError: new (
              message: string,
              status?: number,
            ) => Error & { status: number };
          };

          const headers: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            headers[k] = v;
          }
          const principal = rbac.requireSupplierAuth(headers);
          const auctionName = String(
            body.auction_name ?? body.auctionName ?? "",
          ).trim();
          const itemsRaw = Array.isArray(body.items) ? body.items : [];
          const items = itemsRaw
            .map((row: Record<string, unknown>) => ({
              item_code: String(row?.item_code ?? "").trim(),
              rate: Number(row?.rate),
            }))
            .filter((i: { item_code: string; rate: number }) =>
              i.item_code && Number.isFinite(i.rate),
            );
          const supplier = String(
            principal.supplier || principal.sub,
          ).trim();

          const auction = await core.submitItemBidsCore({
            auctionName,
            supplier,
            items,
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: true, auction }));
        } catch (err) {
          const status =
            err &&
            typeof err === "object" &&
            "status" in err &&
            Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message =
            err instanceof Error ? err.message : "Could not submit item bids.";
          console.error("[reverse-bidding-submit-dev] FAILED:", message);
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message }));
        }
      });
    },
  };
}

function poShipmentDevMiddleware(): Plugin {
  return {
    name: "po-shipment-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const match = /^\/api\/po-shipment\/([^/?]+)/.exec(url);
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

          const core = await server.ssrLoadModule("/api/poShipmentCore.ts");
          let payload: unknown;
          switch (action) {
            case "get":
              payload = {
                success: true,
                record: await core.getPoShipment(String(body.po_name ?? "")),
              };
              break;
            case "list":
              payload = {
                success: true,
                records: await core.listPoShipments({
                  poNames: Array.isArray(body.po_names) ? body.po_names : undefined,
                  statuses: Array.isArray(body.statuses) ? body.statuses : undefined,
                  readyForGrn: body.ready_for_grn === true,
                  warehouseVisible: body.warehouse_visible === true,
                  limit: typeof body.limit === "number" ? body.limit : undefined,
                }),
              };
              break;
            case "list-ready":
              payload = {
                success: true,
                records: await core.listReadyForGrnShipments(
                  typeof body.limit === "number" ? body.limit : 200,
                ),
              };
              break;
            case "upsert":
              payload = {
                success: true,
                record: await core.upsertPoShipment(body),
              };
              break;
            default:
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: `Unknown po-shipment action: ${action}` }));
              return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        } catch (err) {
          const status =
            (err as { status?: number })?.status &&
            Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message =
            err instanceof Error ? err.message : "PO shipment request failed.";
          console.error(`[po-shipment-dev] action=${action} FAILED:`, message);
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: message }));
        }
      });
    },
  };
}

function bomDevMiddleware(): Plugin {
  return {
    name: "bom-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const match = /^\/api\/bom\/([^/?]+)/.exec(url);
        if (!match) {
          next();
          return;
        }

        const action = match[1];
        try {
          const core = await server.ssrLoadModule("/api/bomCore.ts");

          if (action === "sample" && (req.method === "GET" || req.method === "POST")) {
            const buf = (core.buildSampleBomWorkbook as () => Buffer)();
            res.statusCode = 200;
            res.setHeader(
              "Content-Type",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );
            res.setHeader(
              "Content-Disposition",
              'attachment; filename="BidSphere_BOM_Sample_Template.xlsx"',
            );
            res.end(buf);
            return;
          }

          if (action === "history" && req.method === "GET") {
            const history = await (core.getBomHistory as (n?: number) => Promise<unknown>)();
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true, history }));
            return;
          }

          if (action === "upload" && req.method === "POST") {
            const multipartyMod = await import("multiparty");
            const Form =
              (multipartyMod as { default?: { Form: new (o?: object) => multiparty.Form } })
                .default?.Form ??
              (multipartyMod as { Form: new (o?: object) => multiparty.Form }).Form;
            const form = new Form({ maxFilesSize: 20 * 1024 * 1024 });
            const parsed = await new Promise<{
              files: Record<string, Array<{ path: string; originalFilename?: string }>>;
            }>((resolve, reject) => {
              form.parse(req, (err: Error | null, _fields: unknown, files: unknown) => {
                if (err) reject(err);
                else resolve({ files: files as never });
              });
            });
            const fileList =
              parsed.files.file ?? parsed.files.bom ?? parsed.files.upload ?? [];
            const file = fileList[0];
            if (!file?.path) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, error: "No file uploaded." }));
              return;
            }
            const fs = await import("node:fs/promises");
            const buffer = await fs.readFile(file.path);
            const fileName =
              file.originalFilename || file.path.split(/[/\\]/).pop() || "bom.xlsx";
            const result = await (
              core.processBomUpload as (b: Buffer, n: string) => Promise<unknown>
            )(buffer, fileName);
            try {
              await fs.unlink(file.path);
            } catch {
              /* ignore */
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
            return;
          }

          if (action === "create-rfq" && req.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString("utf8");
            const body = raw ? JSON.parse(raw) : {};
            const result = await (
              core.createRfqFromBom as (b: unknown) => Promise<unknown>
            )(body);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
            return;
          }

          if (action === "submit-department" && req.method === "POST") {
            const deptCore = await server.ssrLoadModule("/api/departmentBomCore.ts");
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString("utf8");
            const body = raw ? JSON.parse(raw) : {};
            const result = await (
              deptCore.submitDepartmentBom as (b: unknown) => Promise<unknown>
            )(body);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
            return;
          }

          if (action === "temporary-items" && req.method === "GET") {
            const tempCore = await server.ssrLoadModule("/api/temporaryItemStoreCore.ts");
            const items = await (
              tempCore.listTemporaryItems as () => Promise<unknown>
            )();
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true, items }));
            return;
          }

          if (
            (action === "temporary-items-approve" || action === "temporary-items-reject") &&
            req.method === "POST"
          ) {
            const tempCore = await server.ssrLoadModule("/api/temporaryItemStoreCore.ts");
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString("utf8");
            const body = raw ? JSON.parse(raw) : {};
            const name = String(body.name ?? "").trim();
            if (!name) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, error: "Temporary item name is required." }));
              return;
            }
            const item =
              action === "temporary-items-approve"
                ? await (tempCore.approveTemporaryItem as (n: string) => Promise<unknown>)(name)
                : await (
                    tempCore.rejectTemporaryItem as (n: string, r?: string) => Promise<unknown>
                  )(name, typeof body.reason === "string" ? body.reason : undefined);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true, item }));
            return;
          }

          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: `Unknown BOM action: ${action}` }));
        } catch (err) {
          const status =
            (err as { status?: number })?.status &&
            Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message =
            err instanceof Error ? err.message : "BOM request failed.";
          console.error(`[bom-dev] action=${action} FAILED:`, message);
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: message }));
        }
      });
    },
  };
}

/**
 * Dev-server parity for `api/supplier-onboarding.ts`.
 */
function supplierOnboardingDevMiddleware(): Plugin {
  return {
    name: "supplier-onboarding-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const match = /^\/api\/supplier-onboarding\/([^/?]+)/.exec(url);
        if (!match) {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        const action = match[1];
        try {
          const core = await server.ssrLoadModule("/api/supplierOnboardingCore.ts");
          const chunks: Buffer[] = [];
          if (req.method !== "GET") {
            for await (const chunk of req) chunks.push(chunk as Buffer);
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};
          const query = Object.fromEntries(new URL(url, "http://local").searchParams);

          let payload: unknown;
          switch (action) {
            case "list-categories":
              payload = {
                success: true,
                categories: await core.listCategories(
                  (body.supplier_type || query.supplier_type) as string | undefined,
                ),
              };
              break;
            case "stats":
              payload = { success: true, stats: await core.getStats() };
              break;
            case "list":
              payload = {
                success: true,
                records: await core.listOnboardings({
                  status: (body.status || query.status) as string | undefined,
                  supplier_type: (body.supplier_type || query.supplier_type) as
                    | string
                    | undefined,
                  supplier_category: (body.supplier_category ||
                    query.supplier_category) as string | undefined,
                  search: (body.search || query.search) as string | undefined,
                  limit: body.limit ? Number(body.limit) : undefined,
                }),
              };
              break;
            case "get":
              payload = await core.getOnboarding(String(body.name || ""));
              break;
            case "create":
              payload = await core.createOnboarding(body);
              break;
            case "save-draft":
              payload = await core.updateProcurementDraft(body);
              break;
            case "generate-link":
              payload = await core.generateLink(body);
              break;
            case "generate-account":
              payload = await core.generateSupplierAccount(body);
              break;
            case "get-by-token":
              payload = { success: true, ...(await core.getByToken(String(body.token || ""))) };
              break;
            case "supplier-save-draft":
              payload = await core.supplierSaveDraft(body);
              break;
            case "supplier-submit":
              payload = await core.supplierSubmit(body);
              break;
            case "resolve-upload":
              payload = {
                success: true,
                doctype: "Supplier Onboarding",
                docname: body.session_token
                  ? await core.resolveDocnameForSession(String(body.session_token))
                  : await core.resolveDocnameForToken(String(body.token || "")),
              };
              break;
            case "portal-login": {
              const loginResult = await core.portalLogin({
                ...body,
                client: {
                  ...(body.client || {}),
                  user_agent: String(req.headers["user-agent"] || ""),
                  ip: String(
                    (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "") as string,
                  ).split(",")[0]?.trim(),
                },
              });
              // Parity with api/supplier-onboarding.ts — invoice APIs require
              // a supplier JWT. Without this, Create Invoice fails with 401.
              const rbac = await server.ssrLoadModule("/api/rbacAuth.ts");
              const rawSupplier = String(
                loginResult?.linked_supplier ||
                  loginResult?.company_name ||
                  "",
              ).trim();
              const supplier =
                stripWrappingQuotes(rawSupplier) || "supplier";
              const onboarding = String(
                loginResult?.record?.name || "",
              ).trim();
              payload = {
                ...loginResult,
                access_token: rbac.issueSupplierAccessToken({
                  supplier,
                  onboarding: onboarding || undefined,
                }),
              };
              break;
            }
            case "portal-access-token": {
              // Exchange a validated portal session_token for a supplier JWT
              // (heals account sessions created before portal-login issued tokens).
              const rbac = await server.ssrLoadModule("/api/rbacAuth.ts");
              const sessionToken = core.extractPortalSessionToken(
                body,
                req.headers,
              );
              if (!sessionToken) {
                res.statusCode = 401;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    success: false,
                    error:
                      "Not authenticated. Please sign in again to the Supplier Portal.",
                  }),
                );
                return;
              }
              const profile = await core.portalGetProfile(sessionToken);
              const rawSupplier = String(
                profile?.linked_supplier || profile?.company_name || "",
              ).trim();
              const supplier = stripWrappingQuotes(rawSupplier);
              if (!supplier) {
                res.statusCode = 403;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    success: false,
                    error: "Supplier identity missing from portal session.",
                  }),
                );
                return;
              }
              const onboarding = String(profile?.record?.name || "").trim();
              payload = {
                success: true,
                access_token: rbac.issueSupplierAccessToken({
                  supplier,
                  onboarding: onboarding || undefined,
                }),
                supplier,
              };
              break;
            }
            case "portal-forgot-password":
              payload = await core.portalForgotPassword(body);
              break;
            case "portal-reset-password-otp":
              payload = await core.portalResetPasswordWithOtp(body);
              break;
            case "portal-change-password":
              payload = await core.portalChangePassword({
                ...body,
                session_token: core.extractPortalSessionToken(body, req.headers),
              });
              break;
            case "portal-security": {
              const session_token =
                core.extractPortalSessionToken(body, req.headers) || undefined;
              let supplier_name = body.supplier_name
                ? String(body.supplier_name)
                : undefined;
              if (!session_token) {
                const rbac = await server.ssrLoadModule("/api/rbacAuth.ts");
                const principal = rbac.requireSupplierAuth(req.headers, body);
                supplier_name = String(principal.supplier || supplier_name || "");
              }
              payload = await core.portalGetSecurity({ session_token, supplier_name });
              break;
            }
            case "portal-change-pin": {
              const session_token =
                core.extractPortalSessionToken(body, req.headers) || undefined;
              let supplier_name = body.supplier_name
                ? String(body.supplier_name)
                : undefined;
              if (!session_token) {
                const rbac = await server.ssrLoadModule("/api/rbacAuth.ts");
                const principal = rbac.requireSupplierAuth(req.headers, body);
                supplier_name = String(principal.supplier || supplier_name || "");
              }
              payload = await core.portalChangePin({
                ...body,
                session_token,
                supplier_name,
              });
              break;
            }
            case "portal-logout-others":
              payload = await core.portalLogoutOtherSessions({
                session_token: core.extractPortalSessionToken(body, req.headers),
              });
              break;
            case "portal-profile":
              payload = await core.portalGetProfile(
                core.extractPortalSessionToken(body, req.headers),
              );
              break;
            case "portal-save-draft":
              payload = await core.portalSaveDraft({
                ...body,
                session_token: core.extractPortalSessionToken(body, req.headers),
              });
              break;
            case "portal-submit":
              payload = await core.portalSubmit({
                ...body,
                session_token: core.extractPortalSessionToken(body, req.headers),
              });
              break;
            case "portal-comment":
              payload = await core.portalAddComment({
                ...body,
                session_token: core.extractPortalSessionToken(body, req.headers),
              });
              break;
            case "discussion-list":
              payload = await core.listDiscussion({
                ...body,
                session_token:
                  core.extractPortalSessionToken(body, req.headers) || body.session_token,
              });
              break;
            case "discussion-send":
              payload = await core.addDiscussionMessage({
                ...body,
                session_token:
                  core.extractPortalSessionToken(body, req.headers) || body.session_token,
              });
              break;
            case "discussion-mark-read":
              payload = await core.markDiscussionRead({
                ...body,
                session_token:
                  core.extractPortalSessionToken(body, req.headers) || body.session_token,
              });
              break;
            case "discussion-resolve":
              payload = await core.resolveDiscussionMessage(body);
              break;
            // TEMPORARY LEGACY MODE — PIN suppliers without onboarding drafts
            case "legacy-pin-token": {
              const legacy = await server.ssrLoadModule("/api/legacyPinProfileCore.ts");
              if (!legacy.isLegacyPinProfileEnabledServer()) {
                res.statusCode = 403;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    success: false,
                    error: "Legacy PIN profile is disabled.",
                  }),
                );
                return;
              }
              const supplier = String(body.supplier_name || "").trim();
              const pin = String(body.pin || "").trim();
              if (!supplier) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    success: false,
                    error: "supplier_name is required.",
                  }),
                );
                return;
              }
              await core.portalAuthenticatePin({
                supplier_name: supplier,
                pin,
                client: {
                  ...(body.client || {}),
                  user_agent: String(req.headers["user-agent"] || ""),
                  ip: String(
                    (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "") as string,
                  ).split(",")[0]?.trim(),
                },
              });
              const rbac = await server.ssrLoadModule("/api/rbacAuth.ts");
              const cleanSupplier = stripWrappingQuotes(supplier);
              const access_token = rbac.issueSupplierAccessToken({
                supplier: cleanSupplier,
              });
              payload = {
                success: true,
                access_token,
                supplier: cleanSupplier,
              };
              break;
            }
            case "legacy-pin-profile":
            case "legacy-pin-save":
            case "legacy-pin-resolve-upload":
            case "legacy-pin-discussion-list":
            case "legacy-pin-discussion-send":
            case "legacy-pin-discussion-mark-read": {
              const legacy = await server.ssrLoadModule("/api/legacyPinProfileCore.ts");
              if (!legacy.isLegacyPinProfileEnabledServer()) {
                res.statusCode = 403;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    success: false,
                    error: "Legacy PIN profile access is disabled. Use Account Login.",
                  }),
                );
                return;
              }
              if (action === "legacy-pin-profile") {
                payload = await legacy.legacyPinGetProfile(body);
              } else if (action === "legacy-pin-save") {
                payload = await legacy.legacyPinSaveProfile(body);
              } else if (action === "legacy-pin-resolve-upload") {
                payload = await legacy.legacyPinResolveUpload(body);
              } else if (action === "legacy-pin-discussion-list") {
                payload = await legacy.legacyPinListDiscussion(body);
              } else if (action === "legacy-pin-discussion-send") {
                payload = await legacy.legacyPinSendDiscussion(body);
              } else {
                payload = await legacy.legacyPinMarkDiscussionRead(body);
              }
              break;
            }
            case "request-changes":
              payload = await core.requestChanges(body);
              break;
            case "reject":
              payload = await core.rejectOnboarding(body);
              break;
            case "approve-stage":
              payload = await core.approveStage(body);
              break;
            default:
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, error: `Unknown action: ${action}` }));
              return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        } catch (err) {
          const core = await server.ssrLoadModule("/api/supplierOnboardingCore.ts").catch(() => null);
          const friendly =
            core && typeof core.toFriendlyOnboardingError === "function"
              ? core.toFriendlyOnboardingError(err)
              : null;
          const status = friendly?.status
            ? friendly.status
            : (err as { status?: number })?.status &&
                Number.isInteger((err as { status?: number }).status)
              ? (err as { status: number }).status
              : 500;
          const message =
            friendly?.message ||
            (err instanceof Error ? err.message : "Onboarding request failed.");
          console.error(`[supplier-onboarding-dev] action=${action} FAILED:`, message);
          if (err instanceof Error && err.stack) {
            console.error(err.stack);
          } else {
            console.error(err);
          }
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: message }));
        }
      });
    },
  };
}

/**
 * Dev-server parity for `api/file-proxy.ts` — uses `api/fileProxyCore.ts`
 * so HTML login/permission pages are never streamed into PDF viewers.
 */
function fileProxyDevMiddleware(
  proxyTarget: string,
  apiKey: string,
  apiSecret: string,
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
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message: "Method not allowed.",
              status: 405,
            }),
          );
          return;
        }

        const query = new URLSearchParams(url.split("?")[1] ?? "");
        const filePath = query.get("path") ?? "";

        try {
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireAnyAuth: (
              headers: Record<string, unknown>,
              body?: Record<string, unknown>,
              query?: Record<string, unknown>,
            ) => AccessPrincipal;
            RbacError: new (message: string, status?: number) => Error & {
              status?: number;
            };
          };
          const queryObj: Record<string, string> = {};
          query.forEach((v, k) => {
            queryObj[k] = v;
          });
          let principal: AccessPrincipal;
          let supplierRfqAuthorized = false;
          try {
            principal = rbac.requireAnyAuth(
              req.headers as Record<string, unknown>,
              undefined,
              queryObj,
            );
            if (query.getAll("path").length !== 1) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({
                success: false,
                message: "Exactly one 'path' query parameter is required.",
                status: 400,
              }));
              return;
            }
            if (
              query.getAll("rfq").length > 1 ||
              query.getAll("erp_supplier_id").length > 1
            ) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({
                success: false,
                message: "Duplicate supplier authorization parameters are not allowed.",
                status: 400,
              }));
              return;
            }
            if (principal.typ === "supplier") {
              const rfqName = query.get("rfq")?.trim() || "";
              if (rfqName && filePath) {
                const docsCore = (await server.ssrLoadModule(
                  "/api/supplierRfqDocumentsCore.ts",
                )) as {
                  assertSupplierMayDownloadRfqFile: (input: {
                    rfqName: string;
                    supplierId: string;
                    supplierCandidates?: string[];
                    filePath: string;
                  }) => Promise<void>;
                  buildSupplierAccessCandidates: (input: {
                    explicitSupplierId?: string | null;
                    jwtSupplier?: string | null;
                    jwtSub?: string | null;
                  }) => string[];
                };
                const supplierCandidates = docsCore.buildSupplierAccessCandidates({
                  explicitSupplierId: query.get("erp_supplier_id"),
                  jwtSupplier: principal.supplier,
                  jwtSub: principal.sub,
                });
                try {
                  await docsCore.assertSupplierMayDownloadRfqFile({
                    rfqName,
                    supplierId: supplierCandidates[0] || "",
                    supplierCandidates,
                    filePath,
                  });
                  supplierRfqAuthorized = true;
                } catch (aclErr) {
                  const status =
                    aclErr &&
                    typeof aclErr === "object" &&
                    "status" in aclErr
                      ? Number((aclErr as { status?: number }).status) || 403
                      : 403;
                  res.statusCode =
                    status >= 400 && status < 600 ? status : 403;
                  res.setHeader("Content-Type", "application/json");
                  res.end(
                    JSON.stringify({
                      success: false,
                      message:
                        aclErr instanceof Error
                          ? aclErr.message
                          : "You do not have permission to view this document.",
                      status: res.statusCode,
                    }),
                  );
                  return;
                }
              }
            }
          } catch (authErr) {
            const status =
              authErr && typeof authErr === "object" && "status" in authErr
                ? Number((authErr as { status?: number }).status) || 401
                : 401;
            res.statusCode = status >= 400 && status < 600 ? status : 401;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                message:
                  status === 401
                    ? "Your ERP session has expired."
                    : "You do not have permission to view this document.",
                status: res.statusCode,
              }),
            );
            return;
          }

          const core = (await server.ssrLoadModule(
            "/api/fileProxyCore.ts",
          )) as {
            isValidErpFilePath: (p: string) => boolean;
            fetchErpFile: (opts: {
              baseUrl: string;
              filePath: string;
              fileId?: string;
              apiKey?: string;
              apiSecret?: string;
              cookie?: string;
              method?: "GET" | "HEAD";
              authorizeFile: (file: {
                name: string;
                file_url: string;
                attached_to_doctype?: string;
                attached_to_name?: string;
                attached_to_field?: string;
              }) => Promise<void>;
            }) => Promise<
              | {
                  ok: true;
                  status: number;
                  buffer: Buffer;
                  contentType: string;
                }
              | {
                  ok: false;
                  status: number;
                  body: { success: false; message: string; status: number };
                }
            >;
          };

          if (!core.isValidErpFilePath(filePath)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                message: "Invalid file path.",
                status: 400,
              }),
            );
            return;
          }

          if (!apiKey || !apiSecret) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                success: false,
                message: "Unable to retrieve the file from ERP.",
                status: 500,
                detail: "ERP API credentials are not configured.",
              }),
            );
            return;
          }

          const cookieHeader = req.headers.cookie;
          const base = proxyTarget.replace(/\/+$/, "").replace(/\/api$/, "");
          const loadDocument = async (
            doctype: string,
            name: string,
          ): Promise<Record<string, unknown>> => {
            const response = await fetch(
              `${base}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
              {
                headers: {
                  Authorization: `token ${apiKey}:${apiSecret}`,
                  Accept: "application/json",
                },
              },
            );
            if (!response.ok) {
              const error = new Error(`${doctype} not found.`) as Error & { status?: number };
              error.status = 403;
              throw error;
            }
            const payload = await response.json() as { data?: Record<string, unknown> };
            if (!payload.data) {
              const error = new Error(`${doctype} not found.`) as Error & { status?: number };
              error.status = 403;
              throw error;
            }
            return payload.data;
          };
          const rawFileId = query.get("file_id") || query.get("fileId");
          const fileId = typeof rawFileId === "string" ? rawFileId : undefined;

          const result = await core.fetchErpFile({
            baseUrl: proxyTarget,
            filePath,
            fileId,
            apiKey,
            apiSecret,
            cookie: typeof cookieHeader === "string" ? cookieHeader : undefined,
            method: req.method === "HEAD" ? "HEAD" : "GET",
            authorizeFile: (file) => authorizePersistedFileRead({
              principal,
              file,
              loadDocument,
              supplierContextAuthorized: supplierRfqAuthorized,
            }),
          });

          if (!result.ok) {
            res.statusCode = result.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result.body));
            return;
          }

          res.statusCode = 200;
          res.setHeader(
            "Content-Type",
            result.contentType || "application/octet-stream",
          );
          res.setHeader("Content-Disposition", "inline");
          res.setHeader("Cache-Control", "private, max-age=60");
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          res.end(result.buffer);
        } catch (err) {
          console.error("[file-proxy-dev] failed", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              success: false,
              message: "Unable to retrieve the PDF from ERP.",
              status: 500,
              detail: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}

/** Dev parity for production ERP proxy mutation and ECR RBAC. */
function payablesRbacDevMiddleware(): Plugin {
  return {
    name: "payables-rbac-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const pathOnly = url.split("?")[0] ?? "";
        if (!pathOnly.startsWith("/api/")) {
          next();
          return;
        }
        const method = (req.method ?? "GET").toUpperCase();
        if (method === "OPTIONS") { next(); return; }
        let apiPath: string;
        try {
          apiPath = decodeURIComponent(
            canonicalizeProxyApiPath(pathOnly.replace(/^\/api\//, "")),
          );
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : "Invalid ERPNext API path.",
          }));
          return;
        }
        if (isVersionedErpApiPath(apiPath)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Unsupported ERPNext API namespace." }));
          return;
        }
        const parsedUrl = new URL(url, "http://local");
        const guardedQuery: Record<string, string | string[]> = {};
        for (const key of new Set(parsedUrl.searchParams.keys())) {
          const values = parsedUrl.searchParams.getAll(key);
          guardedQuery[key] = values.length > 1 ? values : values[0] || "";
        }
        try {
          assertSafeProxyQuery({ apiPath, method, query: guardedQuery });
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : "Invalid ERP query parameters.",
          }));
          return;
        }
        const maybePayables =
          apiPath.startsWith("resource/Voucher") ||
          apiPath.startsWith("resource/Purchase Invoice") ||
          apiPath.startsWith("resource/Payment Entry") ||
          apiPath.includes("make_purchase_invoice");
        const maybeEcrResource = apiPath.startsWith("resource/Engineering Change Request");
        const maybeRfqResource =
          apiPath === "resource/Request for Quotation" ||
          apiPath.startsWith("resource/Request for Quotation/");
        const maybePurchaseOrderResource =
          apiPath === "resource/Purchase Order" ||
          apiPath.startsWith("resource/Purchase Order/");
        const maybeProtectedChildResource = Boolean(
          protectedChildResourceDoctype(apiPath),
        );
        const maybeEcrWorkflow = apiPath === "method/frappe.model.workflow.apply_workflow";
        const maybeEcrTransitions = apiPath === "method/frappe.model.workflow.get_transitions";
        const maybeEcrComment = apiPath === "resource/Comment";
        const maybeFileUpload = apiPath === "method/upload_file";
        const maybeFileResource =
          apiPath === "resource/File" || apiPath.startsWith("resource/File/");
        const maybePurchaseRequisition = apiPath.startsWith("resource/Purchase Requisition");
        const maybeGenericDocumentMethod =
          apiPath.startsWith("method/") &&
          ![
            "method/frappe.model.workflow.apply_workflow",
            "method/frappe.model.workflow.get_transitions",
            "method/upload_file",
          ].includes(apiPath);
        const queryDoctype =
          parsedUrl.searchParams.get("doctype") ||
          parsedUrl.searchParams.get("dt") ||
          "";
        const shouldInspectGenericDocumentMethod =
          maybeGenericDocumentMethod &&
          (
            !["GET", "HEAD"].includes(method) ||
            [
              "Engineering Change Request",
              "File",
              "Request for Quotation",
              "Purchase Order",
              "Purchase Requisition",
            ].includes(queryDoctype) ||
            isProtectedChildDoctype(queryDoctype)
          );
        let commentReadDoctype = "";
        let commentReadName = "";
        if (maybeEcrComment && method === "GET") {
          try {
            const filters = JSON.parse(
              parsedUrl.searchParams.get("filters") || "[]",
            ) as unknown[];
            for (const filter of filters) {
              if (!Array.isArray(filter)) continue;
              const field = String(filter.length >= 4 ? filter[1] : filter[0] || "");
              const operator = String(filter.length >= 4 ? filter[2] : filter[1] || "");
              const value = String(filter.length >= 4 ? filter[3] : filter[2] || "");
              if (operator !== "=") continue;
              if (field === "reference_doctype") commentReadDoctype = value;
              if (field === "reference_name") commentReadName = value;
            }
          } catch {
            // The authenticated guard returns a consistent denial below.
          }
        }
        const ecrCommentRead = commentReadDoctype === "Engineering Change Request";
        const prCommentRead = commentReadDoctype === "Purchase Requisition";
        const isTargetProtectedEndpoint =
          maybePayables ||
          maybeEcrResource ||
          maybeProtectedChildResource ||
          maybeEcrWorkflow ||
          maybeEcrTransitions ||
          maybeEcrComment ||
          maybeFileUpload ||
          maybeFileResource ||
          maybePurchaseRequisition ||
          shouldInspectGenericDocumentMethod;

        if (!isTargetProtectedEndpoint) {
          next();
          return;
        }

        if (
          ["GET", "HEAD"].includes(method) &&
          !maybeEcrResource &&
          !maybeProtectedChildResource &&
          !maybeEcrComment &&
          !maybeFileResource &&
          !maybePurchaseRequisition
        ) {
          next();
          return;
        }
        try {
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireAnyAuth: (
              headers: Record<string, unknown>,
            ) => AccessPrincipal;
            enforcePayablesMutationRbac: (
              principal: unknown,
              path: string,
              method: string,
              body?: unknown,
            ) => void;
            requireInternalAuth: (
              headers: Record<string, unknown>,
              body?: Record<string, unknown>,
            ) => { typ: "internal"; sub: string; email: string; role: string };
            requireRoles: (
              principal: unknown,
              roles: string[],
            ) => void;
            enforceEcrMutationRbac: (
              principal: unknown,
              path: string,
              method: string,
              body?: unknown,
              currentStatus?: string,
              currentDocument?: Record<string, unknown> | null,
            ) => void;
            enforcePrMutationRbac: (
              principal: unknown,
              path: string,
              method: string,
              body?: unknown,
              currentStatus?: string,
            ) => void;
            RbacError: new (message: string, status?: number) => Error & {
              status?: number;
            };
          };

          const procurementValidation = (await server.ssrLoadModule(
            "/api/ecrProcurementValidation.ts",
          )) as {
            purchaseRequisitionEcrReferenceForCreate: (
              apiPath: string,
              method: string,
              payload: Record<string, unknown>,
              document: Record<string, unknown>,
            ) => string | null;
            assertEcrLinkedPrUsesTrustedEndpoint: (
              ecrReference: string,
            ) => void;
            assertEcrProcurementRelationships: (
              ecr: Record<string, unknown>,
              loadDocument: (
                doctype: "Request for Quotation" | "Purchase Order",
                name: string,
              ) => Promise<Record<string, unknown>>,
            ) => Promise<void>;
          };
          const rfqTraceGuard = (await server.ssrLoadModule(
            "/api/rfqTraceGuard.ts",
          )) as {
            hasProtectedRfqTraceMutation: (...values: unknown[]) => boolean;
            PROTECTED_RFQ_TRACE_MUTATION_MESSAGE: string;
          };
          const procurementReadScope = (await server.ssrLoadModule(
            "/api/procurementReadScope.ts",
          )) as {
            isReadOnlyGenericDocumentMethod: (path: string) => boolean;
            supplierScopedProcurementFilters: (
              doctype: "Request for Quotation" | "Purchase Order",
              supplier: string,
              filters: unknown,
            ) => unknown[];
            supplierSafeProcurementFields: (
              doctype: "Request for Quotation" | "Purchase Order",
              requested: unknown,
            ) => string[];
            supplierOwnsProcurementDocument: (
              doctype: "Request for Quotation" | "Purchase Order",
              document: Record<string, unknown>,
              supplier: string,
            ) => boolean;
            sanitizeSupplierProcurementDocument: (
              doctype: "Request for Quotation" | "Purchase Order",
              document: Record<string, unknown>,
              supplier: string,
            ) => Record<string, unknown>;
          };

          const contentType = String(req.headers["content-type"] || "");
          const multipartPolicy = multipartProxyPolicy(apiPath, contentType);
          if (multipartPolicy === "reject") {
            throw new rbac.RbacError(
              "Multipart payloads are allowed only for the authenticated file upload endpoint.",
              403,
            );
          }
          if (multipartPolicy === "authenticated-upload") {
            const uploadPrincipal = rbac.requireAnyAuth(
              req.headers as Record<string, unknown>,
            );
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const rawUpload = Buffer.concat(chunks);
            const upload = await parseSecureUpload(
              new Uint8Array(rawUpload),
              contentType,
            );
            assertErpProxySecurityBoundary({
              apiPath,
              method,
              principalRole: uploadPrincipal.typ === "internal"
                ? uploadPrincipal.role
                : undefined,
              requestDoctypes: upload.doctype ? [upload.doctype] : [],
            });

            const base = String(process.env.ERPNEXT_URL || "").replace(/\/+$/, "");
            const key = process.env.ERP_API_KEY || "";
            const secret = process.env.ERP_API_SECRET || "";
            const loadUploadTarget = async () => {
              const response = await fetch(
                `${base}/api/resource/${encodeURIComponent(upload.doctype)}/${encodeURIComponent(upload.docname)}`,
                { headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" } },
              );
              if (!response.ok) {
                throw new rbac.RbacError(`${upload.doctype} not found.`, 403);
              }
              const payload = await response.json() as { data?: Record<string, unknown> };
              if (!payload.data) throw new rbac.RbacError(`${upload.doctype} not found.`, 403);
              return payload.data;
            };

            if (upload.doctype === "Engineering Change Request") {
              if (uploadPrincipal.typ !== "internal") {
                throw new rbac.RbacError(
                  "Forbidden. Internal authentication required for ECR uploads.",
                  403,
                );
              }
              assertSecureEcrUpload(upload);
              const snapshot = await loadUploadTarget();
              rbac.enforceEcrMutationRbac(
                uploadPrincipal,
                `resource/Engineering Change Request/${encodeURIComponent(upload.docname)}`,
                "PUT",
                { [upload.fieldname]: `/private/files/${upload.fileName}` },
                String(snapshot.select_pxfp || ""),
                snapshot,
              );
            } else if (upload.doctype && uploadPrincipal.typ === "supplier") {
              const isolatedTemporaryQuotation =
                upload.doctype === "Supplier Quotation" &&
                isTemporaryQuotationDocname(
                  upload.docname,
                  String(uploadPrincipal.supplier || ""),
                );
              const target = isolatedTemporaryQuotation ? null : await loadUploadTarget();
              if (!supplierOwnsUploadTarget(
                String(uploadPrincipal.supplier || ""),
                upload,
                target,
              )) {
                throw new rbac.RbacError(
                  "Access denied. This upload target is not assigned to your supplier account.",
                  403,
                );
              }
            } else if (upload.doctype) {
              await loadUploadTarget();
            }

            const upstream = await fetch(`${base}/api/method/upload_file`, {
              method: "POST",
              headers: {
                Authorization: `token ${key}:${secret}`,
                Accept: "application/json",
                "Content-Type": contentType,
              },
              body: rawUpload,
            });
            const responseBody = Buffer.from(await upstream.arrayBuffer());
            res.statusCode = upstream.status;
            res.setHeader(
              "Content-Type",
              upstream.headers.get("content-type") || "application/json",
            );
            res.end(responseBody);
            return;
          }

          let rawBody = "";
          let body: Record<string, unknown> = {};
          if (!["GET", "HEAD"].includes(method)) {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            rawBody = Buffer.concat(chunks).toString("utf8");
            if (rawBody) {
              try {
                body = JSON.parse(rawBody) as Record<string, unknown>;
              } catch {
                body = {};
              }
            }
            if (rawBody && body && typeof body === "object" && Object.keys(body).length > 0) {
              (req as IncomingMessage & { __bidsphereRawBody?: string }).__bidsphereRawBody = rawBody;
            }
          }

          assertSafeProxyBody({ apiPath, method, body });

          if (
            maybeEcrResource &&
            !["GET", "HEAD"].includes(method) &&
            hasFrappeResourceDataWrapper(
              body,
              Object.fromEntries(parsedUrl.searchParams.entries()),
            )
          ) {
            throw new rbac.RbacError(
              "Wrapped data payloads are not allowed for Engineering Change Request mutations.",
              403,
            );
          }

          const principal = rbac.requireAnyAuth(req.headers as Record<string, unknown>);
          if (maybeEcrComment && method === "GET" && principal.typ === "supplier") {
            throw new rbac.RbacError(
              "Supplier comment access must use a supplier-scoped portal endpoint.",
              403,
            );
          }
          if (
            maybeEcrComment &&
            method === "GET" &&
            (!commentReadDoctype || !commentReadName)
          ) {
            throw new rbac.RbacError(
              "Comment reads require exact reference_doctype and reference_name filters.",
              403,
            );
          }
          if (maybePayables && !["GET", "HEAD"].includes(method)) {
            rbac.enforcePayablesMutationRbac(principal, apiPath, method, body);
          }

          let doc: Record<string, unknown> = {};
          if (body.doc && typeof body.doc === "object") {
            doc = body.doc as Record<string, unknown>;
          } else if (typeof body.doc === "string") {
            try {
              const parsedDoc = JSON.parse(body.doc) as unknown;
              if (parsedDoc && typeof parsedDoc === "object") {
                doc = parsedDoc as Record<string, unknown>;
              }
            } catch {
              doc = {};
            }
          }
          let transitionDoc: { doctype?: string; name?: string } = {};
          if (parsedUrl.searchParams.has("doc")) {
            try {
              transitionDoc = JSON.parse(
                parsedUrl.searchParams.get("doc") || "{}",
              ) as { doctype?: string; name?: string };
            } catch {
              transitionDoc = {};
            }
          }
          const genericDoctypes = requestDoctypesFromBodyOrQuery(
            body,
            Object.fromEntries(parsedUrl.searchParams.entries()),
          );
          const genericDoctype = requestDoctypeFromBodyOrQuery(
            body,
            Object.fromEntries(parsedUrl.searchParams.entries()),
          ) || String(transitionDoc.doctype || "");
          assertNoGenericFileAccess(apiPath, [genericDoctype, ...genericDoctypes]);
          if (
            !maybeFileResource &&
            !["GET", "HEAD", "OPTIONS"].includes(method)
          ) {
            assertErpProxySecurityBoundary({
              apiPath,
              method,
              principalRole: principal.typ === "internal" ? principal.role : undefined,
              requestDoctypes: [genericDoctype, ...genericDoctypes],
            });
          }
          if (isDirectEcrWorkflowRequest(
            apiPath,
            body,
            Object.fromEntries(parsedUrl.searchParams.entries()),
          )) {
            throw new rbac.RbacError(
              "ECR workflow actions must use the secured /api/ecr-workflow-action endpoint.",
              403,
            );
          }
          const isEcrGenericRequest =
            maybeGenericDocumentMethod &&
            (genericDoctype === "Engineering Change Request" ||
              genericDoctypes.includes("Engineering Change Request"));
          const isRfqGenericRequest =
            maybeGenericDocumentMethod && genericDoctype === "Request for Quotation";
          const isPurchaseOrderGenericRequest =
            maybeGenericDocumentMethod && genericDoctype === "Purchase Order";
          const isReadOnlyGenericDocumentRequest =
            procurementReadScope.isReadOnlyGenericDocumentMethod(apiPath);
          const protectedChildDoctype = protectedChildRequestDoctypeFromMany(
            apiPath,
            [genericDoctype, ...genericDoctypes],
          );
          if (protectedChildDoctype) {
            const denial = protectedChildAccessDenial({
              apiPath,
              requestDoctype: protectedChildDoctype,
              method,
              principalType: principal.typ,
            });
            if (denial) {
              throw new rbac.RbacError(protectedChildAccessMessage(denial), 403);
            }
          }
          const isPrWorkflow =
            maybeEcrWorkflow && genericDoctype === "Purchase Requisition";
          const isPrGenericRequest =
            maybeGenericDocumentMethod && genericDoctype === "Purchase Requisition";
          const isPrTransitions =
            maybeEcrTransitions && genericDoctype === "Purchase Requisition";
          const isPrCommentMutation =
            maybeEcrComment &&
            method !== "GET" &&
            body.reference_doctype === "Purchase Requisition";

          const base = String(process.env.ERPNEXT_URL || "").replace(/\/+$/, "");
          const key = process.env.ERP_API_KEY || "";
          const secret = process.env.ERP_API_SECRET || "";
          const loadErpDocument = async (
            doctype: string,
            documentName: string,
          ): Promise<Record<string, unknown>> => {
            const response = await fetch(
              `${base}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(documentName)}`,
              { headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" } },
            );
            if (!response.ok) {
              const error = new Error(`${doctype} not found.`) as Error & { status?: number };
              error.status = doctype === "Engineering Change Request" ? 403 : 422;
              throw error;
            }
            const payload = (await response.json()) as { data?: Record<string, unknown> };
            if (!payload.data) throw new Error(`${doctype} not found.`);
            return payload.data;
          };

          if (maybeFileResource) {
            await authorizeFileResourceRequest({
              apiPath,
              method,
              principal,
              body,
              query: guardedQuery,
              loadDocument: loadErpDocument,
            });
          }

          if (
            maybePurchaseRequisition ||
            isPrWorkflow ||
            isPrGenericRequest ||
            isPrTransitions ||
            isPrCommentMutation ||
            prCommentRead
          ) {
            const internal = rbac.requireInternalAuth(
              req.headers as Record<string, unknown>,
              body,
            );
            rbac.requireRoles(
              internal,
              ["GET", "HEAD"].includes(method)
                ? [
                    "engineer",
                    "engineering",
                    "operations",
                    "quality",
                    "program_manager",
                    "procurement_team",
                    "procurement",
                  ]
                : ["procurement_team", "procurement"],
            );
            if (!["GET", "HEAD"].includes(method)) {
              const sourceEcrName =
                procurementValidation.purchaseRequisitionEcrReferenceForCreate(
                  apiPath,
                  method,
                  body,
                  doc,
                );
              if (sourceEcrName) {
                procurementValidation.assertEcrLinkedPrUsesTrustedEndpoint(
                  sourceEcrName,
                );
              }

              let currentPrStatus: string | undefined;
              if (isPrWorkflow) {
                const prName = String(doc.name || "").trim();
                if (!prName) {
                  throw new rbac.RbacError("Purchase Requisition is required.", 403);
                }
                const currentPr = await loadErpDocument("Purchase Requisition", prName);
                currentPrStatus = String(currentPr.status || "");
              } else if (["PUT", "PATCH", "DELETE"].includes(method)) {
                const prefix = "resource/Purchase Requisition/";
                const prName = apiPath.startsWith(prefix)
                  ? apiPath.slice(prefix.length).split("/")[0] || ""
                  : "";
                if (!prName) {
                  throw new rbac.RbacError("Purchase Requisition is required.", 403);
                }
                const currentPr = await loadErpDocument("Purchase Requisition", prName);
                currentPrStatus = String(currentPr.status || "");
              }
              rbac.enforcePrMutationRbac(
                internal,
                apiPath,
                method,
                body,
                currentPrStatus,
              );
            }
          }

          const isProcurementRead =
            (["GET", "HEAD"].includes(method) &&
              (maybeRfqResource || maybePurchaseOrderResource)) ||
            (isReadOnlyGenericDocumentRequest &&
              ["Request for Quotation", "Purchase Order"].includes(genericDoctype));
          if (isProcurementRead && principal.typ === "supplier") {
            const doctype =
              maybeRfqResource || genericDoctype === "Request for Quotation"
                ? "Request for Quotation"
                : "Purchase Order";
            const prefix = `resource/${doctype}/`;
            const resourceName = apiPath.startsWith(prefix)
              ? apiPath.slice(prefix.length).split("/")[0] || ""
              : "";
            const genericName = isReadOnlyGenericDocumentRequest
              ? String(body.name || parsedUrl.searchParams.get("name") || "").trim()
              : "";
            const documentName = resourceName || genericName;
            if (documentName) {
              const document = await loadErpDocument(doctype, documentName);
              if (!procurementReadScope.supplierOwnsProcurementDocument(
                doctype,
                document,
                principal.supplier || "",
              )) {
                throw new rbac.RbacError(
                  "Access denied. This procurement document is not assigned to your supplier account.",
                  403,
                );
              }
              const sanitized = procurementReadScope.sanitizeSupplierProcurementDocument(
                doctype,
                document,
                principal.supplier || "",
              );
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              if (method === "HEAD") {
                res.end();
              } else if (resourceName) {
                res.end(JSON.stringify({ data: sanitized }));
              } else {
                res.end(JSON.stringify({ message: sanitized }));
              }
              return;
            } else {
              const filters = procurementReadScope.supplierScopedProcurementFilters(
                doctype,
                principal.supplier || "",
                ["GET", "HEAD"].includes(method)
                  ? parsedUrl.searchParams.get("filters")
                  : body.filters,
              );
              const requestedFields = ["GET", "HEAD"].includes(method)
                ? parsedUrl.searchParams.get("fields") || parsedUrl.searchParams.get("fieldname")
                : body.fields || body.fieldname;
              const safeFields = procurementReadScope.supplierSafeProcurementFields(
                doctype,
                requestedFields,
              );
              if (["GET", "HEAD"].includes(method)) {
                parsedUrl.searchParams.set("filters", JSON.stringify(filters));
                if (apiPath === "method/frappe.client.get_value") {
                  parsedUrl.searchParams.set("fieldname", JSON.stringify(safeFields));
                } else if (apiPath !== "method/frappe.client.get_count") {
                  parsedUrl.searchParams.set("fields", JSON.stringify(safeFields));
                }
                req.url = `${parsedUrl.pathname}${parsedUrl.search}`;
              } else {
                body.filters = filters;
                if (apiPath === "method/frappe.client.get_value") {
                  body.fieldname = safeFields.length === 1 ? safeFields[0] : safeFields;
                } else if (apiPath !== "method/frappe.client.get_count") {
                  body.fields = safeFields;
                }
                rawBody = JSON.stringify(body);
                (req as IncomingMessage & { __bidsphereRawBody?: string }).__bidsphereRawBody = rawBody;
              }
            }
          }

          if (
            (maybeRfqResource && !["GET", "HEAD"].includes(method)) ||
            (isRfqGenericRequest && !isReadOnlyGenericDocumentRequest)
          ) {
            const internal = rbac.requireInternalAuth(
              req.headers as Record<string, unknown>,
              body,
            );
            rbac.requireRoles(internal, ["procurement", "procurement_team", "admin"]);
            const rfqPayload = Object.keys(doc).length > 0 ? doc : body;
            if (rfqTraceGuard.hasProtectedRfqTraceMutation(
              body,
              rfqPayload,
              Object.fromEntries(parsedUrl.searchParams.entries()),
            )) {
              throw new rbac.RbacError(
                rfqTraceGuard.PROTECTED_RFQ_TRACE_MUTATION_MESSAGE,
                403,
              );
            }
          }
          if (
            (maybePurchaseOrderResource && !["GET", "HEAD"].includes(method)) ||
            (isPurchaseOrderGenericRequest && !isReadOnlyGenericDocumentRequest)
          ) {
            const internal = rbac.requireInternalAuth(
              req.headers as Record<string, unknown>,
              body,
            );
            rbac.requireRoles(internal, ["procurement_team", "admin"]);
          }
          let ecrName = "";
          if (maybeEcrResource && apiPath.includes("resource/Engineering Change Request/")) {
            ecrName = apiPath.slice("resource/Engineering Change Request/".length).split("/")[0] || "";
          } else if (maybeEcrWorkflow && doc.doctype === "Engineering Change Request") {
            ecrName = String(doc.name || "");
          } else if (maybeEcrTransitions) {
            if (transitionDoc.doctype === "Engineering Change Request") ecrName = transitionDoc.name || "";
          } else if (maybeEcrComment && body.reference_doctype === "Engineering Change Request") {
            ecrName = String(body.reference_name || "");
          } else if (ecrCommentRead) {
            ecrName = commentReadName;
          }

          const touchesEcr = maybeEcrResource || Boolean(ecrName) || ecrCommentRead || isEcrGenericRequest;
          if (touchesEcr) {
            const internal = rbac.requireInternalAuth(req.headers as Record<string, unknown>, body);
            rbac.requireRoles(internal, ["engineer", "engineering", "operations", "quality", "program_manager", "procurement_team", "procurement"]);
            if (isEcrGenericRequest) {
              throw new rbac.RbacError(
                "Generic ERP document methods are disabled for Engineering Change Requests. Use the secured ECR resource endpoint.",
                403,
              );
            }
            type DevEcrSnapshot = {
              select_pxfp?: string;
              ecr_owner?: string;
              amended_from?: string;
              owner?: string;
            };
            let snapshot: DevEcrSnapshot | null = null;
            let existingEcrDocument: Record<string, unknown> | null = null;
            if (ecrName) {
              existingEcrDocument = await loadErpDocument(
                "Engineering Change Request",
                ecrName,
              );
              snapshot = existingEcrDocument as DevEcrSnapshot;
              if (internal.role === "engineer") {
                const identities = new Set([internal.sub, internal.email].map((value) => value.toLowerCase()));
                if (![snapshot?.ecr_owner, snapshot?.amended_from, snapshot?.owner].filter(Boolean).some((value) => identities.has(String(value).trim().toLowerCase()))) {
                  throw new Error("Access denied. Engineers can access only their own ECRs.");
                }
              }
            }
            if (maybeEcrResource && method === "GET" && !ecrName && internal.role === "engineer") {
              const scope = buildEngineerEcrReadScope(
                parsedUrl.searchParams.get("filters"),
                internal,
              );
              parsedUrl.searchParams.set("filters", scope.filters);
              parsedUrl.searchParams.set("or_filters", scope.orFilters);
              req.url = `${parsedUrl.pathname}${parsedUrl.search}`;
            }
            if (!["GET", "HEAD"].includes(method)) {
              if (maybeEcrResource && method === "POST" && internal.role === "engineer") {
                const owner = (internal.email || internal.sub).trim();
                body.ecr_owner = owner.includes("@") ? owner.toLowerCase() : owner;
                delete body.amended_from;
                rawBody = JSON.stringify(body);
                (req as IncomingMessage & { __bidsphereRawBody?: string }).__bidsphereRawBody = rawBody;
              }
              rbac.enforceEcrMutationRbac(
                internal,
                apiPath,
                method,
                body,
                snapshot?.select_pxfp,
                snapshot,
              );

              const isEcrDocumentWrite =
                maybeEcrResource && ["POST", "PUT", "PATCH"].includes(method);
              if (isEcrDocumentWrite) {
                await procurementValidation.assertEcrProcurementRelationships(
                  existingEcrDocument ? { ...existingEcrDocument, ...body } : body,
                  (doctype, documentName) => loadErpDocument(doctype, documentName),
                );
              }

              const workflowAction = typeof body.action === "string" ? body.action : "";
              if (
                ecrName &&
                maybeEcrWorkflow &&
                ["Submit ECR", "Re-Submit after Revision"].includes(workflowAction)
              ) {
                await procurementValidation.assertEcrProcurementRelationships(
                  existingEcrDocument || await loadErpDocument(
                    "Engineering Change Request",
                    ecrName,
                  ),
                  (doctype, documentName) => loadErpDocument(doctype, documentName),
                );
              }
            }
          } else if (!["GET", "HEAD"].includes(method)) {
            rbac.enforceEcrMutationRbac(principal, apiPath, method, body);
          }
          next();
        } catch (err) {
          const status =
            err && typeof err === "object" && "status" in err
              ? Number((err as { status?: number }).status) || 403
              : 403;
          const message =
            err instanceof Error
              ? err.message
              : "Access denied. You don't have permission to perform this action.";
          const fieldErrors =
            err && typeof err === "object" && "fieldErrors" in err
              ? (err as { fieldErrors?: Record<string, string> }).fieldErrors
              : undefined;
          res.statusCode = status >= 400 && status < 600 ? status : 403;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message, message, ...(fieldErrors ? { field_errors: fieldErrors } : {}) }));
        }
      });
    },
  };
}

/** Dev parity for the scoped Business Need -> Business Case File link endpoint. */
function fileLinkCopyDevMiddleware(): Plugin {
  return {
    name: "file-link-copy-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const pathOnly = (req.url ?? "").split("?")[0];
        if (pathOnly !== "/api/file-link-copy") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message: "Method Not Allowed." }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          let payload: Record<string, unknown>;
          try {
            const parsed = raw ? JSON.parse(raw) as unknown : {};
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("JSON object required.");
            }
            payload = parsed as Record<string, unknown>;
          } catch {
            throw Object.assign(new Error("Invalid JSON body."), {
              status: 400,
              code: "validation",
            });
          }
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (headers: Record<string, unknown>) => unknown;
          };
          const core = (await server.ssrLoadModule("/api/fileLinkCopyCore.ts")) as {
            copyBusinessNeedFileToCaseCore: (input: {
              payload: Record<string, unknown>;
              principal: unknown;
            }) => Promise<{ created?: boolean }>;
          };
          const principal = rbac.requireInternalAuth(req.headers as Record<string, unknown>);
          const result = await core.copyBusinessNeedFileToCaseCore({ payload, principal });
          res.statusCode = result.created ? 201 : 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: result }));
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error
            ? Number((error as { status?: number }).status) || 500
            : 500;
          const message = error instanceof Error
            ? error.message
            : "Unable to link the Business Need attachment to the Business Case.";
          const fieldErrors = error && typeof error === "object" && "fieldErrors" in error
            ? (error as { fieldErrors?: Record<string, string> }).fieldErrors
            : undefined;
          const code = error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code ?? "")
            : "";
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            success: false,
            message,
            ...(code ? { code } : {}),
            ...(fieldErrors ? { field_errors: fieldErrors } : {}),
          }));
        }
      });
    },
  };
}

/** Dev parity for the trusted Engineer/Admin ECR Draft creation endpoint. */
function ecrCreateDevMiddleware(): Plugin {
  return {
    name: "ecr-create-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const pathOnly = (req.url ?? "").split("?")[0];
        if (pathOnly !== "/api/ecr-create") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message: "Method Not Allowed." }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          let payload: Record<string, unknown>;
          try {
            payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
          } catch {
            throw Object.assign(new Error("Invalid JSON body."), { status: 400 });
          }
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (headers: Record<string, unknown>) => unknown;
          };
          const core = (await server.ssrLoadModule("/api/ecrCreateCore.ts")) as {
            createEcrDraftCore: (input: {
              payload: Record<string, unknown>;
              principal: unknown;
            }) => Promise<unknown>;
          };
          const principal = rbac.requireInternalAuth(req.headers as Record<string, unknown>);
          const result = await core.createEcrDraftCore({ payload, principal });
          res.statusCode = 201;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: result }));
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error
            ? Number((error as { status?: number }).status) || 500
            : 500;
          const message = error instanceof Error
            ? error.message
            : "Unable to create the Engineering Change Request.";
          const fieldErrors = error && typeof error === "object" && "fieldErrors" in error
            ? (error as { fieldErrors?: Record<string, string> }).fieldErrors
            : undefined;
          const code = error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code ?? "")
            : "";
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            success: false,
            message,
            ...(code ? { code } : {}),
            ...(fieldErrors ? { field_errors: fieldErrors } : {}),
          }));
        }
      });
    },
  };
}

/** Dev parity for the secured, idempotent ECR → PR server endpoint. */
function createPrFromEcrDevMiddleware(): Plugin {
  return {
    name: "create-pr-from-ecr-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const pathOnly = (req.url ?? "").split("?")[0];
        if (pathOnly !== "/api/create-pr-from-ecr") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message: "Method Not Allowed." }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          const raw = Buffer.concat(chunks).toString("utf8");
          let body: Record<string, unknown>;
          try {
            body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
          } catch {
            throw Object.assign(new Error("Invalid JSON body."), { status: 400 });
          }
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (headers: Record<string, unknown>) => {
              typ: "internal";
              sub: string;
              email: string;
              role: string;
              iat: number;
              exp: number;
            };
            requireRoles: (principal: { role: string }, roles: string[]) => void;
          };
          const core = (await server.ssrLoadModule("/api/createPrFromEcrCore.ts")) as {
            createPrFromEcrCore: (input: {
              ecrName: unknown;
              principal: {
                typ: "internal";
                sub: string;
                email: string;
                role: string;
                iat: number;
                exp: number;
              };
            }) => Promise<{ created?: boolean }>;
          };
          const principal = rbac.requireInternalAuth(req.headers as Record<string, unknown>);
          rbac.requireRoles(principal, ["procurement", "procurement_team", "admin"]);
          const result = await core.createPrFromEcrCore({
            ecrName: body.ecr_name ?? body.ecrName,
            principal,
          });
          res.statusCode = result.created ? 201 : 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: result }));
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error
            ? Number((error as { status?: number }).status) || 500
            : 500;
          const message = error instanceof Error
            ? error.message
            : "Unable to create a Purchase Requisition from this ECR.";
          const fieldErrors = error && typeof error === "object" && "fieldErrors" in error
            ? (error as { fieldErrors?: Record<string, string> }).fieldErrors
            : undefined;
          const prName = error && typeof error === "object" && "prName" in error
            ? String((error as { prName?: string }).prName ?? "")
            : "";
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            success: false,
            message,
            ...(fieldErrors ? { field_errors: fieldErrors } : {}),
            ...(prName ? { pr_name: prName } : {}),
          }));
        }
      });
    },
  };
}

/** Dev parity for the secured, idempotent direct ECR → RFQ endpoint. */
function createRfqFromEcrDevMiddleware(): Plugin {
  return {
    name: "create-rfq-from-ecr-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const pathOnly = (req.url ?? "").split("?")[0];
        if (pathOnly !== "/api/create-rfq-from-ecr") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message: "Method Not Allowed." }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          let body: Record<string, unknown>;
          try {
            const parsed = raw ? JSON.parse(raw) as unknown : {};
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("JSON object required.");
            }
            body = parsed as Record<string, unknown>;
          } catch {
            throw Object.assign(new Error("Invalid JSON body."), { status: 400 });
          }
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (headers: Record<string, unknown>) => {
              typ: "internal";
              sub: string;
              email: string;
              role: string;
              iat: number;
              exp: number;
            };
            requireRoles: (principal: { role: string }, roles: string[]) => void;
          };
          const core = (await server.ssrLoadModule("/api/createRfqFromEcrCore.ts")) as {
            createRfqFromEcrCore: (input: {
              ecrName: unknown;
              principal: {
                typ: "internal";
                sub: string;
                email: string;
                role: string;
                iat: number;
                exp: number;
              };
            }) => Promise<{ created?: boolean }>;
          };
          const principal = rbac.requireInternalAuth(req.headers as Record<string, unknown>);
          if (principal.role !== "procurement") {
            throw Object.assign(
              new Error("Only Procurement Manager can create an RFQ from an ECR."),
              { status: 403 },
            );
          }
          const result = await core.createRfqFromEcrCore({
            ecrName: body.ecr_name ?? body.ecrName,
            principal,
          });
          res.statusCode = result.created ? 201 : 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: result }));
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error
            ? Number((error as { status?: number }).status) || 500
            : 500;
          const message = error instanceof Error
            ? error.message
            : "Unable to create an RFQ from this Engineering Change Request.";
          const code = error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code ?? "")
            : "";
          const fieldErrors = error && typeof error === "object" && "fieldErrors" in error
            ? (error as { fieldErrors?: Record<string, string> }).fieldErrors
            : undefined;
          const rfqName = error && typeof error === "object" && "rfqName" in error
            ? String((error as { rfqName?: string }).rfqName ?? "")
            : "";
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            success: false,
            message,
            ...(code ? { code } : {}),
            ...(fieldErrors ? { field_errors: fieldErrors } : {}),
            ...(rfqName ? { rfq_name: rfqName } : {}),
          }));
        }
      });
    },
  };
}

/** Dev parity for the secured, idempotent PR → RFQ server endpoint. */
function createRfqFromPrDevMiddleware(): Plugin {
  return {
    name: "create-rfq-from-pr-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const pathOnly = (req.url ?? "").split("?")[0];
        if (pathOnly !== "/api/create-rfq-from-pr") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message: "Method Not Allowed." }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (headers: Record<string, unknown>) => { role: string };
            requireRoles: (principal: { role: string }, roles: string[]) => void;
          };
          const core = (await server.ssrLoadModule("/api/createRfqFromPrCore.ts")) as {
            createRfqFromPrCore: (input: {
              prName: string;
              suppliers: string[];
              title?: string;
              scheduleDate?: string;
            }) => Promise<unknown>;
          };
          const principal = rbac.requireInternalAuth(req.headers as Record<string, unknown>);
          rbac.requireRoles(principal, ["procurement", "procurement_team", "admin"]);
          const suppliers = Array.isArray(body.suppliers)
            ? body.suppliers.map((supplier) => String(supplier ?? ""))
            : [];
          const result = await core.createRfqFromPrCore({
            prName: String(body.pr_name ?? body.prName ?? ""),
            suppliers,
            title: String(body.title ?? "") || undefined,
            scheduleDate: String(body.schedule_date ?? body.scheduleDate ?? "") || undefined,
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: result }));
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error
            ? Number((error as { status?: number }).status) || 500
            : 500;
          const message = error instanceof Error
            ? error.message
            : "Unable to create RFQ from Purchase Requisition.";
          const rfqName = error && typeof error === "object" && "rfqName" in error
            ? String((error as { rfqName?: string }).rfqName ?? "")
            : "";
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            success: false,
            message,
            ...(rfqName ? { rfq_name: rfqName } : {}),
          }));
        }
      });
    },
  };
}

/** Dev parity for the trusted ECR workflow + approval-task endpoint. */
function ecrWorkflowActionDevMiddleware(): Plugin {
  return {
    name: "ecr-workflow-action-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const pathOnly = (req.url ?? "").split("?")[0];
        if (pathOnly !== "/api/ecr-workflow-action") {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message: "Method Not Allowed." }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireInternalAuth: (headers: Record<string, unknown>) => {
              typ: "internal";
              sub: string;
              email: string;
              role: string;
              iat: number;
              exp: number;
            };
          };
          const core = (await server.ssrLoadModule("/api/ecrWorkflowCore.ts")) as {
            applyEcrWorkflowActionCore: (input: {
              name: unknown;
              action: unknown;
              comment?: unknown;
              reviewFields?: Record<string, unknown>;
              principal: {
                typ: "internal";
                sub: string;
                email: string;
                role: string;
                iat: number;
                exp: number;
              };
            }) => Promise<unknown>;
          };
          const principal = rbac.requireInternalAuth(req.headers as Record<string, unknown>);
          const ecrIdentifier =
            body.name ?? body.ecr_name ?? body.ecrId ?? body.ecr_number ?? body.id;
          const result = await core.applyEcrWorkflowActionCore({
            name: ecrIdentifier,
            action: body.action,
            comment: body.comment,
            reviewFields:
              body.reviewFields && typeof body.reviewFields === "object" && !Array.isArray(body.reviewFields)
                ? body.reviewFields as Record<string, unknown>
                : {},
            principal,
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: result }));
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error
            ? Number((error as { status?: number }).status) || 500
            : 500;
          const message = error instanceof Error
            ? error.message
            : "Unable to apply the ECR workflow action.";
          res.statusCode = status >= 400 && status < 600 ? status : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, process.cwd(), "");
  // PowerShell `Set-Content -Encoding utf8` writes a UTF-8 BOM that turns the
  // first key into "\uFEFFVITE_…" — normalize so proxy/auth still resolve.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(loaded)) {
    env[key.replace(/^\uFEFF/, "")] = value;
  }
  const proxyTarget = (
    env.VITE_PROXY_TARGET ||
    env.VITE_ERPNEXT_URL ||
    env.ERPNEXT_URL ||
    "http://localhost:8081"
  ).replace(/\/+$/, "");
  const erpApiKey = env.ERP_API_KEY || env.VITE_API_KEY || "";
  const erpApiSecret = env.ERP_API_SECRET || env.VITE_API_SECRET || "";

  console.log(`[vite] ERP proxy target → ${proxyTarget}`);

  // `api/legalReviewCore.ts` reads credentials from `process.env` (matching
  // how Vercel injects real environment variables in production) — mirror
  // that here so the dev middleware above behaves identically.
  process.env.ERPNEXT_URL = process.env.ERPNEXT_URL || proxyTarget;
  process.env.ERP_API_KEY = process.env.ERP_API_KEY || erpApiKey;
  process.env.ERP_API_SECRET = process.env.ERP_API_SECRET || erpApiSecret;
  process.env.BIDSPHERE_SESSION_SECRET =
    process.env.BIDSPHERE_SESSION_SECRET ||
    env.BIDSPHERE_SESSION_SECRET ||
    erpApiSecret ||
    "bidsphere-dev-session-secret";

  const demoMfaEnabled =
    env.APP_ENV === "demo" ||
    env.DEMO_MFA === "true" ||
    env.VITE_DEMO_MFA === "true";

  // Build-time visibility: Demo MFA is compiled into the bundle here.
  // Runtime PM2/Docker env cannot enable it after `vite build`.
  console.log(
    `[vite] mode=${mode} Demo MFA ${demoMfaEnabled ? "ENABLED" : "DISABLED"}`,
    {
      APP_ENV: env.APP_ENV ?? "(unset)",
      DEMO_MFA: env.DEMO_MFA ?? "(unset)",
      VITE_DEMO_MFA: env.VITE_DEMO_MFA ?? "(unset)",
      tip: demoMfaEnabled
        ? "OTP 121212 will be baked into the bundle"
        : "Use `npm run build:demo` or set VITE_DEMO_MFA=true before building",
    },
  );

  return {
    plugins: [
      react(),
      authSessionDevMiddleware(),
      fileLinkCopyDevMiddleware(),
      ecrCreateDevMiddleware(),
      ecrWorkflowActionDevMiddleware(),
      createPrFromEcrDevMiddleware(),
      createRfqFromEcrDevMiddleware(),
      createRfqFromPrDevMiddleware(),
      legalReviewDevMiddleware(),
      bomDevMiddleware(),
      poShipmentDevMiddleware(),
      erpServerDateDevMiddleware(),
      stockCheckDevMiddleware(),
      recommendSuppliersDevMiddleware(),
      rfqSupplierInviteDevMiddleware(),
      rfqQuoteRoundDevMiddleware(),
      reverseBiddingNamingDevMiddleware(),
      reverseBiddingSubmitDevMiddleware(),
      supplierVoucherDevMiddleware(),
      supplierRfqDocumentsDevMiddleware(),
      supplierOnboardingDevMiddleware(),
      // The generic ERP gateway consumes and re-streams mutation bodies, so it
      // must run after every purpose-built local API endpoint.
      payablesRbacDevMiddleware(),
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
              // Token auth only. Never forward the browser's Cookie jar —
              // it may contain Desk's sid from the same host (port-agnostic).
              if (erpApiKey && erpApiSecret) {
                proxyReq.setHeader(
                  "Authorization",
                  `token ${erpApiKey}:${erpApiSecret}`,
                );
              }
              proxyReq.removeHeader("cookie");
              proxyReq.removeHeader("Cookie");

              // RBAC middleware may parse ECR mutation bodies before the
              // proxy. Re-stream that exact JSON payload to ERPNext.
              const rawBody = (req as IncomingMessage & { __bidsphereRawBody?: string }).__bidsphereRawBody;
              if (rawBody !== undefined) {
                proxyReq.setHeader("Content-Type", "application/json");
                proxyReq.setHeader("Content-Length", Buffer.byteLength(rawBody));
                if (rawBody) proxyReq.write(rawBody);
              }

              // Log ERP resource list queries (DocType / fields / filters).
              try {
                const url = new URL(req.url || "", "http://local");
                const match = /^\/api\/resource\/([^/?]+)/.exec(url.pathname);
                if (match && (req.method || "GET").toUpperCase() === "GET") {
                  const doctype = decodeURIComponent(match[1]);
                  let fields: unknown = url.searchParams.get("fields");
                  let filters: unknown = url.searchParams.get("filters");
                  try {
                    if (typeof fields === "string") fields = JSON.parse(fields);
                  } catch {
                    /* keep raw */
                  }
                  try {
                    if (typeof filters === "string")
                      filters = JSON.parse(filters);
                  } catch {
                    /* keep raw */
                  }
                  console.log("[vite-erp-proxy] ERP list query", {
                    doctype,
                    fields,
                    filters,
                    order_by: url.searchParams.get("order_by"),
                  });
                }
              } catch {
                /* ignore parse errors */
              }
            });
            proxy.on("proxyRes", (proxyRes, req) => {
              // Permanent isolation: ERPNext session cookies must never
              // reach the SPA browser (shared host ⇒ shared sid with Desk).
              if (proxyRes.headers["set-cookie"]) {
                delete proxyRes.headers["set-cookie"];
              }
              const status = proxyRes.statusCode ?? 0;
              if (status >= 400 && /\/api\/resource\//.test(req.url || "")) {
                console.error("[vite-erp-proxy] ERP resource error", {
                  status,
                  url: req.url,
                });
              }
            });
            proxy.on("error", (err, _req, res) => {
              console.error("[vite-erp-proxy] upstream unreachable", {
                target: proxyTarget,
                message: err.message,
              });
              const nodeRes = res as {
                headersSent?: boolean;
                writeHead?: (code: number, headers: Record<string, string>) => void;
                end?: (body?: string) => void;
              };
              if (
                nodeRes &&
                typeof nodeRes.writeHead === "function" &&
                !nodeRes.headersSent
              ) {
                nodeRes.writeHead(502, {
                  "Content-Type": "application/json",
                });
                nodeRes.end?.(
                  JSON.stringify({
                    error:
                      "Unable to reach the application server. Please try again in a few seconds.",
                    exc_type: "ProxyUpstreamError",
                  }),
                );
              }
            });
          },
        },
      },
    },
  };
});
