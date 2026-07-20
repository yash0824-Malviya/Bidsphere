import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getSupplierVoucher,
  listSupplierVouchers,
  raiseSupplierInvoice,
  resolveIdentity,
  SupplierVoucherError,
} from "./supplierVoucherCore.js";
import { RbacError, requireSupplierAuth } from "./rbacAuth.js";

/**
 * POST /api/supplier-voucher/:action
 *
 * actions: list | get | raise-invoice
 * Auth: supplier portal JWT only (Finance/Admin tokens are rejected).
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed." });
    return;
  }

  const action = Array.isArray(req.query.action)
    ? req.query.action[0]
    : req.query.action;
  const body =
    (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};

  try {
    // Supplier portal only — Finance cannot create supplier invoices here.
    const principal = requireSupplierAuth(
      req.headers as Record<string, unknown>,
      body as Record<string, unknown>,
    );
    const loggedInSupplier = String(
      principal.supplier || principal.sub || "",
    ).trim();
    const identity = resolveIdentity({
      jwtSupplier: loggedInSupplier,
      erpSupplierId: String(
        (body as { erp_supplier_id?: string }).erp_supplier_id || "",
      ),
      displayName: String(
        (body as { display_name?: string }).display_name || "",
      ),
    });

    switch (action) {
      case "list": {
        const vouchers = await listSupplierVouchers({
          loggedInSupplier,
          identity,
        });
        res.status(200).json({ success: true, vouchers });
        return;
      }
      case "get": {
        const voucherId = String(
          (body as { voucher_id?: string; id?: string }).voucher_id ||
            (body as { id?: string }).id ||
            "",
        ).trim();
        const voucher = await getSupplierVoucher({
          voucherId,
          loggedInSupplier,
          identity,
        });
        res.status(200).json({ success: true, voucher });
        return;
      }
      case "raise-invoice": {
        const voucherId = String(
          (body as { voucher_id?: string; id?: string }).voucher_id ||
            (body as { id?: string }).id ||
            "",
        ).trim();
        const invoice = (body as { invoice?: Record<string, unknown> }).invoice;
        if (!invoice || typeof invoice !== "object") {
          res.status(400).json({
            success: false,
            error: "Invoice payload is required.",
          });
          return;
        }
        const voucher = await raiseSupplierInvoice({
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
        });
        res.status(200).json({ success: true, voucher });
        return;
      }
      default:
        res.status(404).json({
          success: false,
          error: `Unknown supplier-voucher action: ${action}`,
        });
        return;
    }
  } catch (err) {
    if (err instanceof RbacError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof SupplierVoucherError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    const message =
      err instanceof Error ? err.message : "Supplier voucher request failed.";
    // eslint-disable-next-line no-console
    console.error(`[supplier-voucher] action=${action} FAILED:`, message);
    res.status(500).json({ success: false, error: message });
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
