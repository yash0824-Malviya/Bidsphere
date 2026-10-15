import { it, expect } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { generateClmContractPdf } from "../api/clmContractPdf";
import { loadContractPdfContext } from "../api/clmContractPdfData";
import type { ClmRecord } from "../src/types/clm";
import { ClmError } from "../api/clmCore";

it("renders the latest read-only ERPNext Contract snapshot without changing its locked evidence", async () => {
  const snapshot = JSON.parse(await readFile("scratch/contract-pdf-source.json", "utf8"));
  const contract = snapshot.contract as ClmRecord;
  const records = snapshot.records as Array<{ doctype: string; record: ClmRecord }>;
  const before = JSON.stringify(contract);
  const context = await loadContractPdfContext(contract, async (doctype, name) => {
    const saved = records.find(row => row.doctype === doctype && row.record.name === name);
    if (!saved) throw new ClmError(`Read-only snapshot does not include ${doctype}/${name}`, 404);
    return saved.record;
  });
  const result = await generateClmContractPdf(contract, context);
  await mkdir("output/pdf", { recursive: true });
  await writeFile("output/pdf/CON-2026-00001-procurement-contract.pdf", result.bytes);
  await writeFile("scratch/contract-pdf-render-evidence.json", JSON.stringify({ checked_at: snapshot.checked_at, contract: contract.name, modified: contract.modified, context, signature_page: result.signature_page, source_unchanged: before === JSON.stringify(contract), mode: "local presentation export; existing locked ERPNext file unchanged" }, null, 2));
  expect(before).toBe(JSON.stringify(contract));
});
