import { afterEach, describe, expect, it, vi } from "vitest";
import { parseClmData } from "./clmCore";
import { createClmDependencies } from "./clmErp";
import { encodeRfqClmRestContract } from "./rfqClmRestStatus";
import type { ClmRecord, ClmSignature } from "../src/types/clm";

const mirrors = vi.hoisted(() => ({ sync: vi.fn(async () => ({ synced: true })) }));
vi.mock("./rfqClmRestSync.js", () => ({ syncRfqClmRestContract: mirrors.sync }));

function signingRecord(bothSigned = false): ClmRecord {
  const receipt: ClmSignature = { party: "inteva", by: "legal@example.test", role: "legal", at: "2026-09-28 10:00:00", version: "1.0", file_id: "LEGAL-PDF", file_url: "/private/files/legal-signed.pdf", hash: "a".repeat(64), typed_name: "L. Reviewer", full_legal_name: "Legal Reviewer", signature_method: "typed", signature_adopted: true, signature_comment: "Reviewed and authorized." };
  const supplier: ClmSignature = { party: "supplier", by: "supplier-person", at: "2026-09-28 10:05:00", version: "1.0", file_id: "BOTH-PDF", file_url: "/private/files/both-signed.pdf", hash: "b".repeat(64), typed_name: "Supplier Signer" };
  const data = parseClmData(null);
  data.persistence = "erpnext_rest_v1";
  data.rfq_workflow = { version: 1, phase: bothSigned ? "finance_review" : "signature" };
  data.rfq_context = { rfq_id: "RFQ-1", contract_required: "Yes", contract_status: bothSigned ? "Pending Finance" : "Pending Signature" };
  data.signatures = bothSigned ? [receipt, supplier] : [receipt];
  data.audit = [{ id: "ESIGN-1", action: "e_signed", role: "legal", by: receipt.by, at: receipt.at, previous_status: "Pending Signature", new_status: "Pending Signature", signature_party: "inteva", signature_status: "Signed", signature_file_id: receipt.file_id, signature_hash: receipt.hash, contract_id: "CON-1" }];
  if (bothSigned) data.audit.push({ id: "FINANCE-1", action: "finance_review_started", role: "supplier", by: supplier.by, at: supplier.at, previous_status: "Pending Signature", new_status: "Pending Finance" });
  return {
    name: "CON-1", modified: "2026-09-28 09:00:00.123456", custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1",
    custom_current_version: "1.0", custom_final_version_locked: 1, custom_contract_status: bothSigned ? "Pending Finance" : "Pending Signature",
    custom_esign_status: bothSigned ? "Completed" : "Pending Supplier", custom_inteva_signed_date: "2026-09-28", signed_by_company: "legal@example.test",
    ...(bothSigned ? { custom_supplier_signed_date: "2026-09-28", custom_supplier_signatory_name: "Supplier Signer", custom_executed_contract: supplier.file_url, is_signed: 1, signed_on: supplier.at } : {}),
    custom_clm_data: JSON.stringify(data),
  };
}

function transport(record: ClmRecord, mutate?: (stored: ClmRecord) => void, options: { getFails?: boolean; getRevisionChanged?: boolean } = {}) {
  vi.stubEnv("ERPNEXT_URL", "https://signature-persistence.test"); vi.stubEnv("ERP_API_KEY", "fixture"); vi.stubEnv("ERP_API_SECRET", "fixture");
  const events: string[] = [];
  let stored: ClmRecord;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://signature-persistence.test") throw new Error("Unexpected non-fixture host");
    if (url.pathname === "/api/method/frappe.client.save") {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init.body));
      expect(body.doc.modified).toBe(record.modified);
      stored = { ...body.doc, modified: "2026-09-28 10:05:01.987654" };
      if (stored.signed_on) stored.signed_on = String(stored.signed_on).slice(0, 10);
      const echoed = structuredClone(stored);
      mutate?.(stored); events.push("save");
      return new Response(JSON.stringify({ message: echoed }));
    }
    if (url.pathname === "/api/resource/Contract/CON-1") {
      events.push("readback");
      if (options.getFails) return new Response(JSON.stringify({ message: "ERP unavailable" }), { status: 503 });
      return new Response(JSON.stringify({ data: options.getRevisionChanged ? { ...stored, modified: "newer-revision" } : stored }));
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  mirrors.sync.mockImplementation(async () => { events.push("mirror"); return { synced: true }; });
  return { fetch, events, get: () => structuredClone(stored) };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); mirrors.sync.mockReset(); });

describe("RFQ signature save verifies independent ERP readback before mirroring", () => {
  it.each([false, true])("independently verifies separate supplier acceptance before mirroring (ERP drops receipt: %s)", async dropped => {
    const expected = signingRecord(), data = parseClmData(expected.custom_clm_data), legal = data.signatures[0];
    data.supplier_po_acceptance = { id: "ACCEPT-1", status: "Accepted", contract: "CON-1", purchase_order: "PO-1", supplier: "SUP-1", by: "SUP-1", at: "2026-09-29 12:00:00", version: "1.0", file_id: legal.file_id, file_url: legal.file_url, hash: legal.hash, consent: true };
    data.audit.push({ id: "ACCEPT-AUDIT", action: "supplier_accept", by: "SUP-1", role: "supplier", at: "2026-09-29 12:00:00", previous_status: "Active", new_status: "Active", comment: "" });
    expected.custom_clm_data = JSON.stringify(data);
    const f = transport(expected, dropped ? stored => { const raw = parseClmData(stored.custom_clm_data); delete raw.supplier_po_acceptance; stored.custom_clm_data = JSON.stringify(raw); } : undefined);
    if (dropped) {
      await expect(createClmDependencies().save("Contract", expected)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Contract acceptance") });
      expect(f.events).toEqual(["save", "readback"]); expect(mirrors.sync).not.toHaveBeenCalled();
    } else {
      const saved = await createClmDependencies().save("Contract", expected);
      expect(parseClmData(saved.custom_clm_data).supplier_po_acceptance).toEqual(data.supplier_po_acceptance);
      expect(parseClmData(saved.custom_clm_data).signatures).toEqual([legal]); expect(f.events).toEqual(["save", "readback", "mirror"]);
    }
  });
  it.each([false, true])("returns persisted signature metadata and native dates (both signed: %s)", async bothSigned => {
    const expected = signingRecord(bothSigned), f = transport(expected);
    const result = await createClmDependencies().save("Contract", expected);
    expect(f.events).toEqual(["save", "readback", "mirror"]);
    expect(result).toMatchObject({ name: "CON-1", modified: "2026-09-28 10:05:01.987654", custom_contract_status: expected.custom_contract_status, custom_clm_data: expected.custom_clm_data, signed_by_company: expected.signed_by_company });
    if (bothSigned) expect(result.signed_on).toBe("2026-09-28");
    expect(encodeRfqClmRestContract(result)).toEqual(f.get());
    expect(mirrors.sync).toHaveBeenCalledWith(result, expect.any(Object));
  });

  it.each(["receipt", "audit", "signature_adopted", "full_legal_name", "signature_comment", "signed_by_company", "custom_inteva_signed_date", "custom_esign_status", "custom_executed_contract", "is_signed"])("rejects an echoed success when ERP readback loses %s", async missing => {
    const expected = signingRecord(true), f = transport(expected, stored => {
      if (["receipt", "audit", "signature_adopted", "full_legal_name", "signature_comment"].includes(missing)) {
        const data = parseClmData(stored.custom_clm_data);
        if (missing === "receipt") data.signatures = [];
        else if (missing === "audit") data.audit = [];
        else if (missing === "signature_adopted") delete data.signatures[0].signature_adopted;
        else if (missing === "full_legal_name") delete data.signatures[0].full_legal_name;
        else delete data.signatures[0].signature_comment;
        stored.custom_clm_data = JSON.stringify(data);
      } else delete stored[missing];
    });
    await expect(createClmDependencies().save("Contract", expected)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("saved signature could not be verified") });
    expect(f.events).toEqual(["save", "readback"]); expect(mirrors.sync).not.toHaveBeenCalled();
  });

  it("reports uncertainty honestly when save succeeded but independent GET fails", async () => {
    const expected = signingRecord(), f = transport(expected, undefined, { getFails: true });
    await expect(createClmDependencies().save("Contract", expected)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("save was submitted, but its persistence could not be verified") });
    expect(f.get().custom_clm_data).toBe(expected.custom_clm_data);
    expect(f.events).toEqual(["save", "readback"]); expect(mirrors.sync).not.toHaveBeenCalled();
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not return stale signing success when the Contract changed after saving", async () => {
    const expected = signingRecord(), f = transport(expected, undefined, { getRevisionChanged: true });
    await expect(createClmDependencies().save("Contract", expected)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("changed after its signature save") });
    expect(f.events).toEqual(["save", "readback"]); expect(mirrors.sync).not.toHaveBeenCalled();
  });

  it("keeps unrelated Contract saves on their existing path", async () => {
    const expected = signingRecord(); delete expected.custom_rfq;
    const data = parseClmData(expected.custom_clm_data); delete data.persistence; delete data.rfq_workflow; delete data.rfq_context;
    expected.custom_clm_data = JSON.stringify(data);
    const f = transport(expected);
    await createClmDependencies().save("Contract", expected);
    expect(f.events).toEqual(["save"]); expect(mirrors.sync).not.toHaveBeenCalled();
  });
});
