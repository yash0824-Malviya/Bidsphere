import { describe, expect, it } from "vitest";
import { isSupplierNavPathActive } from "./supplierPortalNavigation";

describe("supplier portal active navigation", () => {
  it.each([
    ["/supplier/dashboard", "/supplier/dashboard"],
    ["/supplier/contracts/CON-001", "/supplier/contracts"],
    ["/supplier/rfqs", "/supplier/rfqs"],
    ["/supplier/rfq/RFQ-001", "/supplier/rfqs"],
    ["/supplier/quotations/SQ-001", "/supplier/quotations"],
    ["/supplier/quotation/SQ-001/legal-docs", "/supplier/quotations"],
    ["/supplier/rfis/RFI-001", "/supplier/rfis"],
    ["/supplier/rfps/RFP-001", "/supplier/rfps"],
    ["/supplier/auctions/AUC-001", "/supplier/auctions"],
    ["/supplier/live-auctions", "/supplier/auctions"],
    ["/supplier/purchase-orders", "/supplier/purchase-orders"],
    ["/supplier/po/PO-001", "/supplier/purchase-orders"],
    ["/supplier/orders", "/supplier/purchase-orders"],
    ["/supplier/delivery-schedule", "/supplier/delivery-schedule"],
    ["/supplier/grn/GRN-001", "/supplier/grn"],
    ["/supplier/vouchers/V-001", "/supplier/vouchers"],
    ["/supplier/finance", "/supplier/vouchers"],
    ["/supplier/invoices/INV-001", "/supplier/invoices"],
    ["/supplier/payments/PAY-001", "/supplier/payments"],
  ])("marks %s active for %s", (pathname, to) => {
    expect(isSupplierNavPathActive(pathname, to)).toBe(true);
  });

  it.each([
    ["/supplier/rfq-archive/RFQ-001", "/supplier/rfqs"],
    ["/supplier/rfqs-archive", "/supplier/rfqs"],
    ["/supplier/quotation-template", "/supplier/quotations"],
    ["/supplier/po-archive/PO-001", "/supplier/purchase-orders"],
    ["/supplier/orders-archive", "/supplier/purchase-orders"],
    ["/supplier/live-auctions-history", "/supplier/auctions"],
    ["/supplier/finance-settings", "/supplier/vouchers"],
    ["/supplier/contracts-other", "/supplier/contracts"],
    ["/supplier/rfq/RFQ-001", "/supplier/rfis"],
    ["/supplier/po/PO-001", "/supplier/vouchers"],
    ["/supplier/security", "/supplier/dashboard"],
  ])("does not mark unrelated %s active for %s", (pathname, to) => {
    expect(isSupplierNavPathActive(pathname, to)).toBe(false);
  });

  it("ignores a navigation target's query string when matching its route", () => {
    expect(isSupplierNavPathActive("/supplier/rfq/RFQ-001", "/supplier/rfqs?status=Open")).toBe(true);
    expect(isSupplierNavPathActive("/supplier/profile", "/supplier/profile?tab=documents")).toBe(true);
  });
});
