import { it, expect } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { generateClmContractPdf } from "../api/clmContractPdf";
import { loadContractPdfContext } from "../api/clmContractPdfData";
import { ClmError } from "../api/clmCore";
import type { ClmRecord } from "../src/types/clm";

it("renders a local unsigned layout proof from saved Contract terms without touching signed ERP evidence", async () => {
  const snapshot = JSON.parse(await readFile("scratch/contract-pdf-before-redesign.json", "utf8"));
  const saved = snapshot.contract as ClmRecord;
  const data = JSON.parse(String(saved.custom_clm_data));
  const proof: ClmRecord = { ...saved, custom_current_version: "2.0 (layout proof)", custom_contract_status: "Draft", custom_final_version_locked: 0,
    custom_clm_data: JSON.stringify({ ...data, version: undefined, versions: [], approvals: [], signatures: [], audit: [], locked_file: undefined, locked_hash: undefined }),
    custom_approved_on: undefined, custom_inteva_signed_date: undefined, custom_supplier_signed_date: undefined, signed_by_company: undefined, signed_on: undefined };
  const context = await loadContractPdfContext(saved, async (doctype, name) => {
    const entry = snapshot.records.find((row: {doctype:string;record:ClmRecord}) => row.doctype === doctype && row.record.name === name);
    if (!entry) throw new ClmError("Optional source absent in read-only snapshot", 404);
    return entry.record;
  });
  const before = JSON.stringify(saved);
  const result = await generateClmContractPdf(proof, context);
  await mkdir("tmp/pdfs/contract-redesign", { recursive: true });
  await writeFile("tmp/pdfs/contract-redesign/CON-2026-00001-layout-proof.pdf", result.bytes);
  expect(JSON.stringify(saved)).toBe(before);
  console.log(JSON.stringify({ mode: "Unsigned local layout proof, not an authoritative or signed contract", pages: result.signature_page, file: "tmp/pdfs/contract-redesign/CON-2026-00001-layout-proof.pdf" }));
}, 30000);
