import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  normalizeHeader,
  parseBomExcelBuffer,
  type BomParsedRow,
} from "./bomCore.js";

function makeWorkbookBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "BOM");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("normalizeHeader", () => {
  it("normalizes case, underscores, hyphens, and spaces", () => {
    expect(normalizeHeader("ITEM CODE")).toBe("item code");
    expect(normalizeHeader("Item Code")).toBe("item code");
    expect(normalizeHeader("item_code")).toBe("item code");
    expect(normalizeHeader("Item-Code")).toBe("item code");
    expect(normalizeHeader("  Item   Code  ")).toBe("item code");
  });
});

describe("parseBomExcelBuffer", () => {
  it("parses required columns and falls back to item name when code empty", () => {
    const buf = makeWorkbookBuffer([
      ["Item Code", "Item Name", "Quantity", "UOM"],
      ["SRM005", "Conveyor Maintenance", 10, "Nos"],
      ["", "Internet Provider", 1, "Month"],
    ]);
    const { rows } = parseBomExcelBuffer(buf, "sample.xlsx", new Set());
    expect(rows).toHaveLength(2);
    expect(rows[0].item_code).toBe("SRM005");
    expect(rows[0].qty).toBe(10);
    expect(rows[1].item_name).toBe("Internet Provider");
    expect(rows[1].item_code).toBeTruthy();
  });

  it("accepts alias headers (Part Number / Material Name / Required Qty)", () => {
    const buf = makeWorkbookBuffer([
      ["Part Number", "Material Name", "Required Qty", "Unit Of Measure"],
      ["PN-100", "Steel Bracket", 4, "Nos"],
    ]);
    const { rows } = parseBomExcelBuffer(buf, "aliases.xlsx", new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].item_code).toBe("PN-100");
    expect(rows[0].item_name).toBe("Steel Bracket");
    expect(rows[0].qty).toBe(4);
    expect(rows[0].uom).toBe("Nos");
  });

  it("accepts ItemCode / ItemName camelCase and Item-Code hyphen forms", () => {
    const buf = makeWorkbookBuffer([
      ["ItemCode", "ItemName", "Qty", "Unit"],
      ["X1", "Widget", 2, "Pcs"],
    ]);
    const { rows } = parseBomExcelBuffer(buf, "camel.xlsx", new Set());
    expect(rows[0].item_code).toBe("X1");
    expect(rows[0].item_name).toBe("Widget");
  });

  it("allows Item Name only (no Item Code column)", () => {
    const buf = makeWorkbookBuffer([
      ["Description", "Quantity", "UOM"],
      ["Cleaning Service", 12, "Nos"],
    ]);
    const { rows } = parseBomExcelBuffer(buf, "name-only.xlsx", new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].item_name).toBe("Cleaning Service");
    expect(rows[0].item_code).toBeTruthy();
  });

  it("finds header row below a title row", () => {
    const buf = makeWorkbookBuffer([
      ["Plant BOM Export — Q3"],
      ["ITEM_CODE", "PART NAME", "QTY", "UOM"],
      ["B-01", "Bearing", 8, "Nos"],
    ]);
    const { rows } = parseBomExcelBuffer(buf, "title.xlsx", new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].item_code).toBe("B-01");
    expect(rows[0].item_name).toBe("Bearing");
  });

  it("keeps sample template columns working with separate Description", () => {
    const buf = makeWorkbookBuffer([
      ["Item Code", "Item Name", "Description", "Quantity", "UOM"],
      ["SRM005", "Conveyor Maintenance", "Annual service", 10, "Nos"],
    ]);
    const { rows } = parseBomExcelBuffer(buf, "sample-full.xlsx", new Set());
    expect(rows[0].item_name).toBe("Conveyor Maintenance");
    expect(rows[0].description).toBe("Annual service");
  });

  it("flags invalid qty and empty names", () => {
    const buf = makeWorkbookBuffer([
      ["Item Name", "Quantity", "UOM"],
      ["", 5, "Nos"],
      ["Widget", 0, "Nos"],
      ["Bolt", -2, "Nos"],
    ]);
    const { rows } = parseBomExcelBuffer(buf, "bad.xlsx", new Set());
    expect(rows.every((r: BomParsedRow) => r.status === "invalid")).toBe(true);
  });

  it("detects duplicate rows", () => {
    const buf = makeWorkbookBuffer([
      ["Item Code", "Item Name", "Quantity", "UOM"],
      ["A1", "Alpha", 1, "Nos"],
      ["A1", "Alpha", 2, "Nos"],
    ]);
    const { rows } = parseBomExcelBuffer(buf, "dup.xlsx", new Set());
    expect(rows[0].status).not.toBe("duplicate");
    expect(rows[1].status).toBe("duplicate");
  });

  it("rejects non-excel filenames", () => {
    expect(() =>
      parseBomExcelBuffer(Buffer.from("x"), "notes.csv", new Set()),
    ).toThrow(/Unsupported file/);
  });

  it("reports detected / missing / accepted columns on failure", () => {
    const buf = makeWorkbookBuffer([
      ["Foo", "Bar", "Baz"],
      ["1", "2", "3"],
    ]);
    expect(() => parseBomExcelBuffer(buf, "bad-headers.xlsx", new Set())).toThrow(
      /Detected Columns:[\s\S]*Missing Columns:[\s\S]*Accepted Names:/,
    );
  });
});
