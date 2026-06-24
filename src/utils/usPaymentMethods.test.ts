import { describe, expect, it } from "vitest";

import {
  emptyDetailsForMethod,
  generatePaymentReference,
  getPaymentReferenceFormatHint,
  normalizePaymentMethod,
  parsePaymentMeta,
  serializePaymentMeta,
  sortPaymentModes,
  validatePaymentMethodDetails,
} from "./usPaymentMethods";

describe("generatePaymentReference", () => {
  it("generates ACH reference with sequence", () => {
    const refs = ["PAY-ACH-20260610-0001", "PAY-ACH-20260610-0003"];
    expect(generatePaymentReference("ACH Transfer", refs, "2026-06-10")).toBe(
      "PAY-ACH-20260610-0004"
    );
  });

  it("generates Check reference prefix", () => {
    expect(generatePaymentReference("Check", [], "2026-06-15")).toBe(
      "PAY-CHK-20260615-0001"
    );
  });

  it("generates Debit Card reference prefix", () => {
    expect(generatePaymentReference("Debit Card", [], "2026-06-15")).toBe(
      "PAY-DC-20260615-0001"
    );
  });
});

describe("validatePaymentMethodDetails", () => {
  it("requires ACH routing and account number", () => {
    const details = emptyDetailsForMethod("ACH Transfer");
    details.bankName = "Chase";
    details.accountHolderName = "Netlink Inc";
    details.routingNumber = "123456789";
    details.accountNumber = "987654321";
    expect(validatePaymentMethodDetails("ACH Transfer", details)).toBeNull();
  });

  it("requires card last 4 digits for Debit Card", () => {
    const details = emptyDetailsForMethod("Debit Card");
    details.cardHolderName = "Jane Doe";
    details.cardType = "Visa";
    details.last4Digits = "4242";
    expect(validatePaymentMethodDetails("Debit Card", details)).toBeNull();
  });
});

describe("getPaymentReferenceFormatHint", () => {
  it("returns ERPNext mode-specific format hint", () => {
    expect(getPaymentReferenceFormatHint("Check")).toBe(
      "PAY-CHK-YYYYMMDD-0001"
    );
    expect(getPaymentReferenceFormatHint("ACH Transfer")).toBe(
      "PAY-ACH-YYYYMMDD-0001"
    );
    expect(getPaymentReferenceFormatHint("Debit Card")).toBe(
      "PAY-DC-YYYYMMDD-0001"
    );
  });
});

describe("normalizePaymentMethod", () => {
  const modes = [
    "ACH Transfer",
    "Wire Transfer",
    "Debit Card",
    "Bank Draft",
    "Check",
  ];

  it("maps legacy Check Payment to Check", () => {
    expect(normalizePaymentMethod("Check Payment", modes)).toBe("Check");
  });

  it("maps legacy Corporate Debit Card to Debit Card", () => {
    expect(normalizePaymentMethod("Corporate Debit Card", modes)).toBe(
      "Debit Card"
    );
  });

  it("maps Cheque to Check", () => {
    expect(normalizePaymentMethod("Cheque", modes)).toBe("Check");
  });

  it("passes through exact ERPNext names", () => {
    expect(normalizePaymentMethod("Debit Card", modes)).toBe("Debit Card");
  });
});

describe("sortPaymentModes", () => {
  it("orders preferred modes first", () => {
    expect(
      sortPaymentModes(["Check", "Wire Transfer", "ACH Transfer", "Debit Card"])
    ).toEqual(["ACH Transfer", "Wire Transfer", "Debit Card", "Check"]);
  });

  it("excludes Cash and Credit Card from US AP workflows", () => {
    expect(
      sortPaymentModes([
        "Cash",
        "Credit Card",
        "ACH Transfer",
        "Wire Transfer",
      ])
    ).toEqual(["ACH Transfer", "Wire Transfer"]);
  });
});

describe("payment meta serialization", () => {
  it("round-trips ERPNext mode name in remarks", () => {
    const meta = {
      v: 1 as const,
      method: "Debit Card",
      details: { last4Digits: "4242" },
    };
    const remarks = serializePaymentMeta(meta);
    const parsed = parsePaymentMeta(remarks, ["Debit Card"]);
    expect(parsed?.method).toBe("Debit Card");
  });
});
