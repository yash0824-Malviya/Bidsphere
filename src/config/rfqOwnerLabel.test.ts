import { describe, expect, it } from "vitest";

import { formatRfqOwnerFromDoc, formatRfqOwnerLabel } from "./roles";

describe("formatRfqOwnerLabel", () => {
  it("never surfaces Administrator", () => {
    expect(formatRfqOwnerLabel("Administrator")).toBe("Procurement Team");
    expect(formatRfqOwnerLabel("administrator@example.com")).toBe(
      "Procurement Team",
    );
    expect(formatRfqOwnerLabel("admin@netlink.com")).toBe("Procurement Team");
  });

  it("maps known procurement role mailboxes", () => {
    expect(formatRfqOwnerLabel("procurement@netlink.com")).toBe(
      "Procurement Manager",
    );
    expect(formatRfqOwnerLabel("procurement.team@netlink.com")).toBe(
      "Procurement Team",
    );
  });

  it("humanizes real user identities", () => {
    expect(formatRfqOwnerLabel("jane.doe@acme.com")).toBe("Jane Doe");
  });

  it("prefers the first usable candidate", () => {
    expect(
      formatRfqOwnerLabel(
        "Administrator",
        "procurement@netlink.com",
        "buyer@acme.com",
      ),
    ).toBe("Procurement Manager");
  });

  it("falls back when empty", () => {
    expect(formatRfqOwnerLabel()).toBe("Procurement Team");
    expect(formatRfqOwnerLabel("", null, undefined)).toBe("Procurement Team");
  });
});

describe("formatRfqOwnerFromDoc", () => {
  it("prefers explicit RFQ owner over document owner", () => {
    expect(
      formatRfqOwnerFromDoc({
        custom_rfq_owner: "alex.smith@acme.com",
        owner: "Administrator",
      }),
    ).toBe("Alex Smith");
  });

  it("uses buyer when owner is system", () => {
    expect(
      formatRfqOwnerFromDoc({
        owner: "Administrator",
        buyer: "procurement@netlink.com",
      }),
    ).toBe("Procurement Manager");
  });
});
