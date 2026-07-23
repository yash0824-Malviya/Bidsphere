import { defineConfig, loadEnv, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type multiparty from "multiparty";
import react from "@vitejs/plugin-react";

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
            ) => unknown;
            RbacError: new (message: string, status?: number) => Error & {
              status?: number;
            };
          };
          const queryObj: Record<string, string> = {};
          query.forEach((v, k) => {
            queryObj[k] = v;
          });
          try {
            rbac.requireAnyAuth(
              req.headers as Record<string, unknown>,
              undefined,
              queryObj,
            );
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
              apiKey?: string;
              apiSecret?: string;
              cookie?: string;
              method?: "GET" | "HEAD";
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
          const result = await core.fetchErpFile({
            baseUrl: proxyTarget,
            filePath,
            apiKey,
            apiSecret,
            cookie: typeof cookieHeader === "string" ? cookieHeader : undefined,
            method: req.method === "HEAD" ? "HEAD" : "GET",
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

/**
 * Dev parity for production `api/proxy.ts` finance-payables RBAC.
 * Blocks Procurement/Warehouse from creating invoices or payment entries
 * even when Vite proxies `/api` straight to ERPNext.
 */
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
        if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
          next();
          return;
        }
        const apiPath = decodeURIComponent(pathOnly.replace(/^\/api\//, ""));
        const maybePayables =
          apiPath.startsWith("resource/Voucher") ||
          apiPath.startsWith("resource/Purchase Invoice") ||
          apiPath.startsWith("resource/Payment Entry") ||
          apiPath.includes("make_purchase_invoice");
        if (!maybePayables) {
          next();
          return;
        }
        try {
          const rbac = (await server.ssrLoadModule("/api/rbacAuth.ts")) as {
            requireAnyAuth: (
              headers: Record<string, unknown>,
            ) => { typ: string; role?: string };
            enforcePayablesMutationRbac: (
              principal: unknown,
              path: string,
              method: string,
              body?: unknown,
            ) => void;
            RbacError: new (message: string, status?: number) => Error & {
              status?: number;
            };
          };
          const principal = rbac.requireAnyAuth(
            req.headers as Record<string, unknown>,
          );
          rbac.enforcePayablesMutationRbac(principal, apiPath, method, undefined);
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
          res.statusCode = status >= 400 && status < 600 ? status : 403;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
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
      payablesRbacDevMiddleware(),
      legalReviewDevMiddleware(),
      bomDevMiddleware(),
      poShipmentDevMiddleware(),
      stockCheckDevMiddleware(),
      supplierVoucherDevMiddleware(),
      supplierOnboardingDevMiddleware(),
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
            proxy.on("error", (err) => {
              console.log("[proxy error]", err.message);
            });
          },
        },
      },
    },
  };
});
