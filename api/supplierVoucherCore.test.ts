import { describe, expect, it } from "vitest";
import {
  normalizeSupplierKey,
  voucherBelongsToSupplierIdentity,
} from "./supplierVoucherCore.js";

describe("supplierVoucherCore ownership", () => {
  it("normalizes keys", () => {
    expect(normalizeSupplierKey("  Acme  ")).toBe("acme");
    expect(normalizeSupplierKey(null)).toBe("");
  });

  it("matches Supplier Master ID to voucher.supplier", () => {
    expect(
      voucherBelongsToSupplierIdentity(
        { supplier: "SUP-0001", supplier_name: "Acme Corp" },
        { erpSupplierId: "SUP-0001", displayName: "Acme Corp" },
      ),
    ).toBe(true);
  });

  it("matches display name to voucher.supplier_name", () => {
    expect(
      voucherBelongsToSupplierIdentity(
        { supplier: "SUP-0001", supplier_name: "Acme Corp" },
        { erpSupplierId: "OTHER", displayName: "Acme Corp" },
      ),
    ).toBe(true);
  });

  it("does not cross-compare display name to Supplier ID", () => {
    expect(
      voucherBelongsToSupplierIdentity(
        { supplier: "SUP-0001", supplier_name: "Other Name" },
        { erpSupplierId: "", displayName: "SUP-0001" },
      ),
    ).toBe(false);
  });

  it("denies unrelated suppliers", () => {
    expect(
      voucherBelongsToSupplierIdentity(
        { supplier: "SUP-0001", supplier_name: "Acme Corp" },
        { erpSupplierId: "SUP-9999", displayName: "Other Co" },
      ),
    ).toBe(false);
  });
});
