import { describe, expect, it, vi } from "vitest";
import { clmSnapshotHash, parseClmData, repairRfqLegalSignatureHandoff, toClmAggregate, type ClmDeps } from "./clmCore";
import type { ClmRecord } from "../src/types/clm";
import type { AccessPrincipal, AppRole } from "./rbacAuth";

function fixture() {
  let record: ClmRecord = { name: "CON-1", modified: "original", custom_rfq: "RFQ-1", custom_current_version: "1.0", custom_contract_status: "Pending Signature", custom_final_version_locked: 1,
    custom_inteva_signatory: "legal@example.test", signed_by_company: "legal@example.test", contract_terms: "Approved original terms", custom_contract_value: 4500, custom_currency: "USD", custom_esign_status: "Pending Supplier" };
  const data = parseClmData(null);
  data.version = "VERSION-1"; data.rfq_workflow = { version: 1, phase: "signature" };
  data.approvals = [{ id: "LEGAL", role: "legal", stage: 0, rule: "Legal", status: "Approved", by: "legal@example.test", at: "2026-09-28 09:00:00" }];
  data.signatures = [{ party: "inteva", role: "legal", by: "legal@example.test", at: "2026-09-28 10:00:00", typed_name: "Saved Legal Signature", version: "1.0", file_id: "SIGNED", file_url: "/private/files/signed.pdf", hash: "b".repeat(64) }];
  data.locked_file = { file_id: "LOCKED", file_url: "/private/files/locked.pdf", hash: "a".repeat(64), version: "1.0" };
  data.locked_hash = clmSnapshotHash("Contract", record);
  data.audit = [{ id: "OLD", action: "e_signed", by: "legal@example.test", at: "2026-09-28 10:00:00", previous_status: "Pending Signature", new_status: "Pending Signature" }];
  record.custom_clm_data = JSON.stringify(data);
  const events: string[] = [];
  const deps: ClmDeps = {
    load: vi.fn(async (type, name) => type === "User" ? { name, enabled: 1, roles: [{ role: "Legal Manager" }] } : structuredClone(record)),
    list: vi.fn(async () => []), create: vi.fn(async () => { throw new Error("No creation allowed"); }),
    save: vi.fn(async (_type, next) => { events.push("save"); record = structuredClone({ ...next, modified: "saved" }); return structuredClone(record); }),
    now: () => "2026-09-29 11:00:00", notify: vi.fn(async () => { events.push("notify"); }),
    sign: vi.fn(async () => { throw new Error("Do not re-sign"); }), lock: vi.fn(async () => { throw new Error("Do not regenerate"); }),
  };
  const verify = vi.fn(async (_record, evidence) => { events.push(evidence.file_id); });
  const repair = () => repairRfqLegalSignatureHandoff("CON-1", String(record.modified), deps, verify);
  const mutate = (change: (record: ClmRecord, data: ReturnType<typeof parseClmData>) => void) => { const current = parseClmData(record.custom_clm_data); change(record, current); record.custom_clm_data = JSON.stringify(current); };
  return { deps, verify, repair, events, mutate, get: () => structuredClone(record) };
}
const user = (role: AppRole): AccessPrincipal => ({ typ: "internal", role, sub: `${role}@example.test`, email: `${role}@example.test`, iat: 1, exp: 9999999999 });

describe("saved Legal signature Finance handoff repair", () => {
  it("verifies both immutable files, persists one Finance task and preserves original data/evidence", async () => {
    const f = fixture(), before = f.get(), old = parseClmData(before.custom_clm_data);
    const result = await f.repair(), data = parseClmData(result.record.custom_clm_data);
    expect(result.changed).toBe(true);
    expect(f.events).toEqual(["LOCKED", "SIGNED", "save", "notify"]);
    expect(data.signatures).toEqual(old.signatures); expect(data.locked_file).toEqual(old.locked_file); expect(data.locked_hash).toBe(old.locked_hash); expect(data.versions).toEqual(old.versions);
    for (const key of ["contract_terms", "custom_contract_value", "custom_currency", "custom_current_version", "custom_rfq"]) expect(result.record[key]).toEqual(before[key]);
    expect(data.audit.slice(0, old.audit.length)).toEqual(old.audit);
    expect(data.audit.slice(-2).map(row => row.action)).toEqual(["legal_signature_handoff_reconciled", "finance_review_started"]);
    expect(data.rfq_workflow?.phase).toBe("finance_review");
    expect(data.approvals).toEqual([old.approvals[0], expect.objectContaining({ role: "finance", stage: 1, status: "Pending" })]);
    expect(result.record).toMatchObject({ custom_contract_status: "Pending Finance", custom_esign_status: "Completed", custom_executed_contract: old.signatures[0].file_url });
    expect(data.signatures.some(row => row.party === "supplier")).toBe(false);
    expect(toClmAggregate(user("finance"), "Contract", result.record).actions.map(row => row.action)).toEqual(["approve", "reject", "send_back"]);
    for (const role of ["legal", "procurement", "procurement_team", "admin"] as AppRole[]) expect(toClmAggregate(user(role), "Contract", result.record).actions.some(row => ["approve", "reject", "send_back"].includes(row.action))).toBe(false);
    expect(f.deps.sign).not.toHaveBeenCalled(); expect(f.deps.lock).not.toHaveBeenCalled(); expect(f.deps.create).not.toHaveBeenCalled();
    const again = await f.repair();
    expect(again.changed).toBe(false); expect(again.record).toEqual(result.record); expect(f.deps.save).toHaveBeenCalledTimes(1);
  });
  it.each(["missing legal", "old version", "wrong signer", "wrong role", "unapproved", "changed terms", "wrong phase", "duplicate signature", "preexisting finance"])("refuses %s without persistence", async condition => {
    const f = fixture(); f.mutate((record, data) => {
      if (condition === "missing legal") data.signatures = [];
      if (condition === "old version") data.signatures[0].version = "0.9";
      if (condition === "wrong signer") data.signatures[0].by = "someone@example.test";
      if (condition === "wrong role") data.signatures[0].role = "procurement";
      if (condition === "unapproved") data.approvals[0].status = "Pending";
      if (condition === "changed terms") record.contract_terms = "Changed";
      if (condition === "wrong phase") data.rfq_workflow!.phase = "draft";
      if (condition === "duplicate signature") data.signatures.push({ ...data.signatures[0] });
      if (condition === "preexisting finance") data.approvals.push({ id: "bad", role: "finance", stage: 1, rule: "Finance", status: "Pending" });
    });
    const before = f.get(); await expect(f.repair()).rejects.toMatchObject({ status: 409 });
    expect(f.get()).toEqual(before); expect(f.deps.save).not.toHaveBeenCalled(); expect(f.deps.notify).not.toHaveBeenCalled();
  });
  it("refuses stale revisions before any file read or write", async () => {
    const f = fixture(); await expect(repairRfqLegalSignatureHandoff("CON-1", "stale", f.deps, f.verify)).rejects.toMatchObject({ status: 409 });
    expect(f.verify).not.toHaveBeenCalled(); expect(f.deps.save).not.toHaveBeenCalled();
  });
  it("keeps the old state if signature file verification fails", async () => {
    const f = fixture(), before = f.get(); f.verify.mockRejectedValueOnce(new Error("PDF digest changed"));
    await expect(f.repair()).rejects.toThrow("PDF digest changed"); expect(f.get()).toEqual(before); expect(f.deps.save).not.toHaveBeenCalled(); expect(f.deps.notify).not.toHaveBeenCalled();
  });
  it("does not notify Finance after an ERP persistence failure", async () => {
    const f = fixture(), before = f.get(); vi.mocked(f.deps.save).mockRejectedValueOnce(new Error("ERP save failed"));
    await expect(f.repair()).rejects.toThrow("ERP save failed"); expect(f.get()).toEqual(before); expect(f.deps.notify).not.toHaveBeenCalled();
  });
});
