import { describe, expect, it } from "vitest";
import type { RFQItemLine } from "../components/RFQItemLineRow";
import type { EngineeringAttachment } from "./materialRequestItemFiles";
import {
  canDeleteInheritedRfqAttachment,
  canEditInheritedRfqAttachment,
  inheritedLineBadgeLabel,
  isInheritedMrRfqLine,
} from "./rfqItemEditRules";

describe("rfqItemEditRules", () => {
  const baseLine: RFQItemLine = {
    id: "1",
    item_group: "Spares",
    item_code: "OF001",
    item_name: "Engine Oil Filter",
    description: "",
    qty: 4,
    uom: "Nos",
  };

  it("detects inherited MR lines", () => {
    expect(isInheritedMrRfqLine({ ...baseLine, inherited_from_mr: true })).toBe(
      true,
    );
    expect(isInheritedMrRfqLine(baseLine)).toBe(false);
  });

  it("labels warehouse-forwarded lines", () => {
    expect(
      inheritedLineBadgeLabel({
        ...baseLine,
        inherited_from_mr: true,
        warehouse_available_qty: 0,
      }),
    ).toBe("Warehouse Forwarded");
    expect(
      inheritedLineBadgeLabel({
        ...baseLine,
        inherited_from_mr: true,
      }),
    ).toBe("Inherited from Material Request");
  });

  it("protects department attachments on inherited lines", () => {
    const dept: EngineeringAttachment = {
      id: "a1",
      fileName: "drawing.pdf",
      fileUrl: "/files/drawing.pdf",
      fileType: "pdf",
      fileSize: 100,
      uploadedAt: "2026-01-01T00:00:00.000Z",
      source: "department",
    };
    const proc: EngineeringAttachment = { ...dept, id: "a2", source: "procurement" };
    expect(canDeleteInheritedRfqAttachment(dept)).toBe(false);
    expect(canDeleteInheritedRfqAttachment(proc)).toBe(true);
    // Procurement may change visibility on inherited Department files.
    expect(canEditInheritedRfqAttachment(dept)).toBe(true);
    expect(canEditInheritedRfqAttachment(proc)).toBe(true);
  });
});
