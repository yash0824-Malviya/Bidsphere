import { describe, it, expect, beforeEach } from "vitest";
import {
  appendRfqInviteAudit,
  readRfqInviteAudit,
  getPendingInvitationSupplierIds,
  getLatestInviteRound,
} from "./rfqSupplierInviteAudit";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("RFQ Supplier Invitation Workflow & Audit", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("persists complete invitation records with required fields", () => {
    const rfqName = "PUR-RFQ-2026-00084";
    const round = appendRfqInviteAudit(rfqName, [
      {
        supplier: "Eagle Peak Technologies Inc.",
        supplier_name: "Eagle Peak Technologies Inc.",
        invited_by: "procurement.lead@example.com",
        status: "Pending",
      },
      {
        supplier: "Blue Ridge Manufacturing Inc.",
        supplier_name: "Blue Ridge Manufacturing Inc.",
        invited_by: "procurement.lead@example.com",
        status: "Pending",
      },
    ]);

    expect(round).toBe(1);

    const records = readRfqInviteAudit(rfqName);
    expect(records).toHaveLength(2);

    const eaglePeak = records.find(
      (r) => r.supplier === "Eagle Peak Technologies Inc.",
    );
    expect(eaglePeak).toBeDefined();
    expect(eaglePeak?.rfqId).toBe(rfqName);
    expect(eaglePeak?.supplierId).toBe("Eagle Peak Technologies Inc.");
    expect(eaglePeak?.supplier_name).toBe("Eagle Peak Technologies Inc.");
    expect(eaglePeak?.status).toBe("Pending");
    expect(eaglePeak?.invitedBy).toBe("procurement.lead@example.com");
    expect(eaglePeak?.invitationId).toContain(rfqName);
    expect(eaglePeak?.invitationId).toContain("eagle peak");
    expect(eaglePeak?.invitedAt).toBeDefined();
    expect(eaglePeak?.invitation_round).toBe(1);
  });

  it("extracts pending invitation supplier IDs properly", () => {
    const rfqName = "PUR-RFQ-2026-00084";
    appendRfqInviteAudit(rfqName, [
      {
        supplier: "Eagle Peak Technologies Inc.",
        status: "Pending",
      },
      {
        supplier: "Atlantic Precision Manufacturing",
        status: "Quoted",
      },
    ]);

    const pendingIds = getPendingInvitationSupplierIds(rfqName);
    expect(pendingIds.has("eagle peak technologies inc.")).toBe(true);
    expect(pendingIds.has("atlantic precision manufacturing")).toBe(false);
  });

  it("increments invitation round correctly on successive invites", () => {
    const rfqName = "PUR-RFQ-2026-00084";
    const round1 = appendRfqInviteAudit(rfqName, [
      { supplier: "Supplier A", status: "Pending" },
    ]);
    expect(round1).toBe(1);
    expect(getLatestInviteRound(rfqName)).toBe(1);

    const round2 = appendRfqInviteAudit(rfqName, [
      { supplier: "Supplier B", status: "Pending" },
    ]);
    expect(round2).toBe(2);
    expect(getLatestInviteRound(rfqName)).toBe(2);

    const records = readRfqInviteAudit(rfqName);
    expect(records).toHaveLength(2);
    expect(records[0].invitation_round).toBe(1);
    expect(records[1].invitation_round).toBe(2);
  });
});
