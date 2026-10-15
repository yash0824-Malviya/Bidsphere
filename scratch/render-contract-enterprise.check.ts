import { it, expect } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { generateClmContractPdf } from "../api/clmContractPdf";
import { loadContractPdfContext } from "../api/clmContractPdfData";
import { ClmError } from "../api/clmCore";
import type { ClmRecord } from "../src/types/clm";

it("renders an explicitly unsigned local layout proof while leaving all saved signature evidence unchanged", async () => {
  const snapshot = JSON.parse(await readFile("scratch/contract-pdf-source.json", "utf8"));
  const saved = snapshot.contract as ClmRecord, before = JSON.stringify(snapshot);
  const data = JSON.parse(String(saved.custom_clm_data));
  const proof: ClmRecord = { ...saved, custom_current_version: `${saved.custom_current_version} (unsigned layout proof)`, custom_contract_status: "Draft", custom_final_version_locked: 0,
    custom_clm_data: JSON.stringify({ ...data, version: undefined, versions: [], approvals: [], signatures: [], audit: [], locked_file: undefined, locked_hash: undefined }),
    custom_approved_on: undefined, custom_inteva_signed_date: undefined, custom_supplier_signed_date: undefined, signed_by_company: undefined, signed_on: undefined };
  const context = await loadContractPdfContext(saved, async (doctype, name) => {
    const entry = snapshot.records.find((row: {doctype:string;record:ClmRecord}) => row.doctype === doctype && row.record.name === name);
    if (!entry) throw new ClmError("Optional source absent from read-only snapshot", 404);
    return entry.record;
  });
  const result = await generateClmContractPdf(proof, context);
  await mkdir("output/pdf", { recursive: true });
  await writeFile("output/pdf/CON-2026-00001-enterprise-layout-proof.pdf", result.bytes);
  expect(JSON.stringify(snapshot)).toBe(before);
  console.log(JSON.stringify({ proof: "unsigned local presentation only", pages: result.signature_page, sourceCapturedAt: snapshot.checked_at, originalVersion: saved.custom_current_version, sourceUnchanged: true }));
}, 30000);
