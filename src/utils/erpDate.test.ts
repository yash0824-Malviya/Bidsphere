import { describe, expect, it } from "vitest";
import {
  ERP_NEXT_DATE_FORMAT,
  ERP_NEXT_DATETIME_RE,
  sanitizeErpPayloadDates,
  toERPDate,
  toERPDateTime,
} from "./erpDate";

describe("toERPDate / toERPDateTime", () => {
  it("formats Date as YYYY-MM-DD", () => {
    expect(toERPDate("2026-07-16", "d")).toBe("2026-07-16");
    expect(toERPDate(new Date("2026-07-16T18:18:42.331Z"), "d")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("converts ISO-8601 datetime to MariaDB-safe format", () => {
    const out = toERPDateTime("2026-07-16T18:18:42.331Z", "signed_at");
    expect(out).toMatch(ERP_NEXT_DATETIME_RE);
    expect(out).not.toMatch(/T|Z|\.\d{3}/);
  });

  it("leaves already-safe datetime unchanged", () => {
    expect(toERPDateTime("2026-07-16 18:18:42", "x")).toBe(
      "2026-07-16 18:18:42",
    );
  });
});

describe("sanitizeErpPayloadDates", () => {
  it("sanitizes known signature / acceptance datetime fields", () => {
    const out = sanitizeErpPayloadDates({
      supplier_acceptance_date: "2026-07-16T18:10:18.985Z",
      warehouse_signed_at: "2026-07-16T18:18:42.331Z",
      signed_at: "2026-07-16T18:18:42.331Z",
      esign_signed_on: "2026-07-16T18:18:42.331Z",
      legal_signed_at: "2026-07-16T18:18:42.331Z",
      invoice_signed_at: "2026-07-16T18:18:42.331Z",
      voucher_created_at: "2026-07-16T18:18:42.331Z",
      payment_confirmed_at: "2026-07-16T18:18:42.331Z",
      posting_date: "2026-07-16T00:00:00.000Z",
      note: "keep me",
    });

    for (const key of [
      "supplier_acceptance_date",
      "warehouse_signed_at",
      "signed_at",
      "esign_signed_on",
      "legal_signed_at",
      "invoice_signed_at",
      "voucher_created_at",
      "payment_confirmed_at",
    ] as const) {
      expect(out[key]).toMatch(ERP_NEXT_DATETIME_RE);
    }
    expect(out.posting_date).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}$`));
    expect(out.note).toBe("keep me");
  });

  it("sanitizes nested set_value fieldname maps", () => {
    const out = sanitizeErpPayloadDates({
      doctype: "Purchase Receipt",
      name: "MAT-PRE-0001",
      fieldname: {
        warehouse_signed_at: "2026-07-16T18:18:42.331Z",
        signed: 1,
      },
    });
    expect(out.fieldname.warehouse_signed_at).toMatch(ERP_NEXT_DATETIME_RE);
    expect(out.fieldname.signed).toBe(1);
  });

  it("never rewrites Frappe optimistic-lock stamps (modified/creation)", () => {
    // ERPNext returns fractional seconds; stripping them causes TimestampMismatchError.
    const stamp = "2026-07-16 18:18:42.331567";
    const out = sanitizeErpPayloadDates({
      docstatus: 1,
      modified: stamp,
      creation: stamp,
      warehouse_signed_at: "2026-07-16T18:18:42.331Z",
    });
    expect(out.modified).toBe(stamp);
    expect(out.creation).toBe(stamp);
    expect(out.warehouse_signed_at).toMatch(ERP_NEXT_DATETIME_RE);
    expect(out.docstatus).toBe(1);
  });

  it("does not rewrite Long Text JSON blobs that are not ISO strings", () => {
    const envelope = JSON.stringify({
      signedAt: "2026-07-16T18:18:42.331Z",
    });
    const out = sanitizeErpPayloadDates({
      warehouse_esign_envelope: envelope,
    });
    expect(out.warehouse_esign_envelope).toBe(envelope);
  });
});

describe("ERP_NEXT_DATE_FORMAT constant", () => {
  it("is YYYY-MM-DD", () => {
    expect(ERP_NEXT_DATE_FORMAT).toBe("YYYY-MM-DD");
  });
});
