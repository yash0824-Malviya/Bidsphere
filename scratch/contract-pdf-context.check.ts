import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { loadContractPdfContext } from "../api/clmContractPdfData";
import { ClmError } from "../api/clmCore";
import type { ClmRecord } from "../src/types/clm";

it("resolves the latest read-only ERPNext acceptance snapshot without modifying it", async () => {
  const snapshot = JSON.parse(readFileSync("scratch/contract-pdf-source.json", "utf8")) as { contract: ClmRecord; records: Array<{ doctype: string; record: ClmRecord }> };
  const before = JSON.stringify(snapshot);
  const context = await loadContractPdfContext(snapshot.contract, async (doctype, name) => {
    const record = snapshot.records.find(row => row.doctype === doctype && row.record.name === name)?.record;
    if (!record) throw new ClmError("Source unavailable in read-only snapshot", 404);
    return record;
  });
  expect(context).toMatchObject({ company: "Netlink", department: "Production - NSGAI", supplierName: "Atlantic Precision Manufacturing.", awardId: "LDC2026-00027", awardValue: 4500, awardCurrency: "USD", items: [{ item: "Cold Rolled Steel 6", qty: 100, uom: "Kg" }, { item: "Galvanized Steel 10", qty: 80, uom: "Kg" }], documents: [] });
  expect(JSON.stringify(snapshot)).toBe(before);
  writeFileSync("scratch/contract-pdf-context.json", JSON.stringify(context, null, 2));
});
