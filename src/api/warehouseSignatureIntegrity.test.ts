import { describe, expect, it } from "vitest";
import type { PurchaseReceipt } from "../types/erpnext";
import {
  assertSignedGrnMutationAllowed,
  buildGrnDocumentSnapshot,
  hashGrnDocument,
  hasSignedMarkers,
  isSignatureOnlyUpdate,
  SIGNED_GRN_IMMUTABLE_MESSAGE,
} from "./warehouseSignatureIntegrity";

function sampleGrn(overrides: Partial<PurchaseReceipt> = {}): PurchaseReceipt {
  return {
    name: "MAT-PRE-TEST-001",
    supplier: "SUP-001",
    company: "Netlink",
    posting_date: "2026-07-01",
    set_warehouse: "Stores - NL",
    currency: "USD",
    items: [
      {
        item_code: "ITEM-1",
        qty: 10,
        received_qty: 10,
        rejected_qty: 0,
        warehouse: "Stores - NL",
        rate: 5,
        purchase_order: "PO-1",
        purchase_order_item: "POI-1",
      },
    ],
    ...overrides,
  } as PurchaseReceipt;
}

describe("warehouseSignatureIntegrity", () => {
  it("builds a stable document snapshot", () => {
    const snap = buildGrnDocumentSnapshot(sampleGrn());
    expect(snap.name).toBe("MAT-PRE-TEST-001");
    expect((snap.items as unknown[]).length).toBe(1);
  });

  it("hashes the same GRN consistently", async () => {
    const a = await hashGrnDocument(sampleGrn());
    const b = await hashGrnDocument(sampleGrn());
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes hash when qty changes", async () => {
    const base = await hashGrnDocument(sampleGrn());
    const changed = await hashGrnDocument(
      sampleGrn({
        items: [
          {
            item_code: "ITEM-1",
            qty: 11,
            received_qty: 11,
            rejected_qty: 0,
            warehouse: "Stores - NL",
            rate: 5,
            purchase_order: "PO-1",
            purchase_order_item: "POI-1",
          },
        ],
      } as Partial<PurchaseReceipt>),
    );
    expect(changed).not.toBe(base);
  });

  it("allows only e-sign field updates as signature-only", () => {
    expect(isSignatureOnlyUpdate({ warehouse_signature_hash: "abc" })).toBe(
      true,
    );
    expect(isSignatureOnlyUpdate({ items: [] })).toBe(false);
    expect(isSignatureOnlyUpdate({ docstatus: 2 })).toBe(false);
  });

  it("blocks business edits on signed GRNs", () => {
    const signed = sampleGrn({ signed: 1, signed_by: "Alex" });
    expect(hasSignedMarkers(signed)).toBe(true);
    expect(() =>
      assertSignedGrnMutationAllowed(signed, { set_warehouse: "Other" }),
    ).toThrow(SIGNED_GRN_IMMUTABLE_MESSAGE);
    expect(() =>
      assertSignedGrnMutationAllowed(signed, {
        warehouse_signature_hash: "x",
      }),
    ).not.toThrow();
  });
});
