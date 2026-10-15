import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { applyClmAction, parseClmData, rfqClmFinanceApproved, toClmAggregate, type ClmDeps } from "./clmCore";
import type { AccessPrincipal, AppRole } from "./rbacAuth";
import type { ClmActionName, ClmRecord, ClmSignature } from "../src/types/clm";

const internal = (role: AppRole): AccessPrincipal => ({ typ: "internal", role, email: `${role}@example.test`, sub: `${role}@example.test`, iat: 1, exp: Number.MAX_SAFE_INTEGER });
const team = internal("procurement_team"), manager = internal("procurement"), legal = internal("legal"), finance = internal("finance");
const supplier: AccessPrincipal = { typ: "supplier", supplier: "SUP-1", sub: "supplier-user", iat: 1, exp: Number.MAX_SAFE_INTEGER };
const signatureInput = { full_legal_name: "Legal Reviewer", signature: { method: "typed", value: "Legal Reviewer", adopted: true }, consent: true };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Real action/version state machine; only persistence and PDF storage are fixtures. */
async function fixture() {
  const source = { rfq: "RFQ-1", supplier: "SUP-1", quotation: "SQ-1", award: "AWARD-1", contract_required: true };
  const data = parseClmData(null);
  data.rfq_source = source; data.rfq_workflow = { version: 1, phase: "draft" };
  let record: ClmRecord = {
    name: "CON-1", modified: "1", party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1",
    custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_contract_title: "Awarded supply agreement",
    custom_contract_type: "Supply / Procurement Contract", custom_contract_value: 4500, custom_currency: "USD",
    custom_risk_level: "Low", contract_terms: "Approved award terms", start_date: "2026-09-01", end_date: "2027-09-01",
    custom_inteva_signatory: "legal@example.test", custom_contract_status: "Draft", custom_approval_status: "Pending",
    custom_clm_data: JSON.stringify(data),
  };
  let sequence = 1;
  const files = new Map<string, Uint8Array>();
  const storePdf = (label: string) => {
    const file_id = `PDF-${files.size + 1}`, bytes = Buffer.from(`%PDF fixture ${label}`);
    files.set(file_id, bytes);
    return { file_id, file_url: `/private/files/${file_id}.pdf`, hash: digest(bytes), signature_page: 2 };
  };
  const get = () => structuredClone(record);
  const deps: ClmDeps = {
    load: vi.fn(async (dt, name) => {
      if (dt === "Contract" && name === "CON-1") return get();
      if (dt === "Supplier" && name === "SUP-1") return { name, disabled: 0 };
      if (dt === "User" && name === "legal@example.test") return { name, enabled: 1, roles: [{ role: "Legal Manager" }] };
      if (dt === "Request for Quotation" && name === "RFQ-1") return { name, custom_selected_supplier: "SUP-1", contract_required: "Yes" };
      if (dt === "Supplier Quotation" && name === "SQ-1") return { name, supplier: "SUP-1", request_for_quotation: "RFQ-1", docstatus: 1 };
      throw new Error(`Unexpected document read ${dt}/${name}`);
    }),
    list: vi.fn(async () => []),
    create: vi.fn(async () => { throw new Error("Revising must never create a second Contract"); }),
    save: vi.fn(async (dt, value) => {
      if (dt !== "Contract" || value.name !== record.name || value.modified !== record.modified) throw new Error("Unexpected or concurrent write");
      record = structuredClone({ ...value, modified: String(++sequence) }); return get();
    }),
    now: () => "2026-09-28 10:00:00",
    lock: vi.fn(async contract => storePdf(`locked version ${contract.custom_current_version}`)),
    sign: vi.fn(async (contract, who, payload): Promise<ClmSignature> => ({
      ...storePdf(`signed version ${contract.custom_current_version}`), party: who.typ === "supplier" ? "supplier" : "inteva",
      by: who.typ === "supplier" ? who.sub : who.email || who.sub, at: "2026-09-28 10:00:00", version: String(contract.custom_current_version),
      typed_name: String((payload.signature as ClmRecord | undefined)?.value || payload.typed_name),
      ...(payload.signature ? { full_legal_name: String(payload.full_legal_name), signature_method: "typed", signature_adopted: true } : {}),
    })),
    notify: vi.fn(async () => undefined),
  };
  const act = (action: ClmActionName, who = team, payload: ClmRecord = {}, expected_modified = record.modified) => applyClmAction({
    doctype: "Contract", name: "CON-1", action, payload, expected_modified, comment: "Regenerate approved corporate PDF layout",
  }, who, deps);
  await act("save");
  const approved = async () => { await act("submit_review"); await act("approve", legal); };
  const pendingSignature = async () => { await approved(); await act("begin_signature", legal); };
  return { get, act, approved, pendingSignature, deps, files, put: (value: ClmRecord) => { record = structuredClone(value); } };
}

describe("RFQ Contract PDF revisions", () => {
  it.each([team, manager])("preserves an already-saved legacy Legal signature when $role creates a distinct layout-only version", async who => {
    const m = await fixture();
    await m.pendingSignature();
    // Historical fixture: before the Legal-to-Finance correction, one Legal
    // receipt remained at Pending Signature. Do not loosen today's revision
    // policy by moving a newly signed Finance-stage Contract back to authoring.
    const legacy = m.get(), legacyData = parseClmData(legacy.custom_clm_data);
    const receipt = { ...await m.deps.sign!(legacy, legal, signatureInput), role: "legal" };
    legacyData.signatures.push(receipt);
    legacyData.audit.push({ id: "LEGACY-LEGAL-SIGNED", action: "e_signed", by: receipt.by, at: receipt.at, previous_status: "Pending Signature", new_status: "Pending Signature", role: "legal", version: legacyData.version, signature_party: "inteva", signature_status: "Signed", signature_file_id: receipt.file_id, signature_hash: receipt.hash });
    m.put({ ...legacy, custom_inteva_signed_date: receipt.at.slice(0, 10), signed_by_company: receipt.by, custom_clm_data: JSON.stringify(legacyData) });
    const before = m.get(), prior = parseClmData(before.custom_clm_data), storedFiles = new Map([...m.files].map(([id, bytes]) => [id, digest(bytes)]));
    const saves = vi.mocked(m.deps.save).mock.calls.length;
    const result = await m.act("new_version", who);
    const after = m.get(), revised = parseClmData(after.custom_clm_data);

    expect(result.record).toMatchObject(after);
    expect(after).toMatchObject({ name: "CON-1", custom_current_version: "2.0", custom_contract_status: "Draft", custom_final_version_locked: 0, custom_esign_status: "Not Started", is_signed: 0, signed_by_company: "", signed_on: "", custom_inteva_signed_date: "", custom_supplier_signed_date: "" });
    expect(revised.rfq_workflow).toEqual({ version: 1, phase: "draft" });
    expect(revised.versions).toHaveLength(2);
    expect(revised.versions[0]).toEqual(prior.versions[0]);
    expect(revised.versions[1]).toMatchObject({ number: "2.0", previous: prior.versions[0].id, content: prior.versions[0].content, hash: prior.versions[0].hash });
    expect(revised.version).not.toBe(prior.version);
    expect(revised.approvals).toEqual([]); expect(revised.signatures).toEqual([]);
    expect(revised.locked_file).toBeUndefined(); expect(revised.locked_hash).toBeUndefined();
    expect(revised.review_history).toEqual([{ version: prior.version, approvals: prior.approvals, signatures: prior.signatures, locked_file: prior.locked_file, locked_hash: prior.locked_hash }]);
    expect(revised.audit.slice(0, prior.audit.length)).toEqual(prior.audit);
    expect(revised.audit.at(-1)).toMatchObject({ action: "new_version", previous_status: "Pending Signature", new_status: "Draft", version: revised.version });
    expect(revised.rfq_source).toEqual(prior.rfq_source);
    for (const field of ["custom_rfq", "custom_supplier_quotation", "custom_supplier", "custom_contract_value", "custom_currency", "contract_terms", "start_date", "end_date"]) expect(after[field]).toEqual(before[field]);
    expect(new Map([...m.files].map(([id, bytes]) => [id, digest(bytes)]))).toEqual(storedFiles);
    expect(m.deps.lock).toHaveBeenCalledTimes(1); expect(m.deps.sign).toHaveBeenCalledTimes(1);
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).toHaveBeenCalledTimes(saves + 1);
    expect(rfqClmFinanceApproved(after)).toBe(false);
    expect(toClmAggregate(finance, "Contract", after).actions).toEqual([]);
  });

  it.each(["Draft", "Approved", "Pending Signature"])("allows the existing revision action during %s", async status => {
    const m = await fixture();
    if (status === "Approved") await m.approved();
    if (status === "Pending Signature") await m.pendingSignature();
    expect(toClmAggregate(team, "Contract", m.get()).actions).toContainEqual(expect.objectContaining({ action: "new_version", requires_comment: true }));
    await m.act("new_version");
    expect(m.get().custom_current_version).toBe("2.0");
    expect(parseClmData(m.get().custom_clm_data).rfq_workflow?.phase).toBe("draft");
  });

  it.each([legal, finance, internal("admin"), internal("program_manager"), supplier])("rejects unauthorized revision by $typ/$role", async who => {
    const m = await fixture(); await m.pendingSignature(); const before = m.get();
    expect(toClmAggregate(who, "Contract", before).actions.some(action => action.action === "new_version")).toBe(false);
    await expect(m.act("new_version", who)).rejects.toMatchObject({ status: 403 });
    expect(m.get()).toEqual(before);
  });

  it("rejects a stale revision without archiving, changing data or uploading a PDF", async () => {
    const m = await fixture(); const stale = m.get().modified; await m.pendingSignature(); const before = m.get();
    await expect(m.act("new_version", team, {}, stale)).rejects.toMatchObject({ status: 409 });
    expect(m.get()).toEqual(before); expect(m.deps.lock).toHaveBeenCalledTimes(1);
  });

  it("keeps a required revision explanation and all fresh-review gates", async () => {
    const m = await fixture(); await m.pendingSignature();
    await expect(applyClmAction({ doctype: "Contract", name: "CON-1", action: "new_version", expected_modified: m.get().modified, payload: {} }, team, m.deps)).rejects.toThrow("rationale or comment");
    await m.act("new_version");
    await expect(m.act("begin_signature", legal)).rejects.toMatchObject({ status: 403 });
    await expect(m.act("sign", legal, signatureInput)).rejects.toMatchObject({ status: 403 });
    await expect(m.act("approve", finance)).rejects.toMatchObject({ status: 403 });
    await m.act("submit_review");
    expect(parseClmData(m.get().custom_clm_data).approvals).toEqual([expect.objectContaining({ role: "legal", status: "Pending", stage: 0 })]);
    expect(m.deps.lock).toHaveBeenCalledTimes(1);
    await m.act("approve", legal);
    expect(m.deps.lock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(m.deps.lock!).mock.calls[1][0].custom_current_version).toBe("2.0");
    await m.act("begin_signature", legal);
    await m.act("sign", legal, signatureInput);
    expect(m.get().custom_contract_status).toBe("Pending Finance");
    expect(parseClmData(m.get().custom_clm_data).signatures[0].version).toBe("2.0");
    expect(toClmAggregate(finance, "Contract", m.get()).actions.map(row => row.action)).toEqual(["approve", "reject", "send_back"]);
    // Supplier acceptance/signing now follows the submitted PO; Legal still
    // advances to Finance independently, and a revision does not bypass that gate.
    await expect(m.act("sign", supplier, { typed_name: "Supplier Signatory", consent: true })).rejects.toMatchObject({ status: 403 });
    expect(m.get().custom_contract_status).toBe("Pending Finance");
    expect(parseClmData(m.get().custom_clm_data).rfq_workflow?.phase).toBe("finance_review");
    expect(toClmAggregate(finance, "Contract", m.get()).actions.map(row => row.action)).toEqual(["approve", "reject", "send_back"]);
    await m.act("approve", finance);
    expect(rfqClmFinanceApproved(m.get())).toBe(true);
    expect(parseClmData(m.get().custom_clm_data).rfq_workflow?.phase).toBe("procurement");
  });

  it("does not revise a fully signed version even if its stored status is stale", async () => {
    const m = await fixture(); await m.pendingSignature(); await m.act("sign", legal, signatureInput);
    // Preserve historical supplier-first evidence without granting that obsolete
    // action in the current state machine merely to construct a revision fixture.
    const historical = m.get(), history = parseClmData(historical.custom_clm_data);
    history.signatures.push(await m.deps.sign!(historical, supplier, { typed_name: "Supplier Signatory", consent: true }));
    m.put({ ...historical, custom_clm_data: JSON.stringify(history) });
    const before = m.get();
    await expect(m.act("new_version")).rejects.toMatchObject({ status: 403 });
    expect(m.get()).toEqual(before);
    const stale = parseClmData(before.custom_clm_data); stale.rfq_workflow = { version: 1, phase: "signature" };
    m.put({ ...before, custom_contract_status: "Pending Signature", custom_clm_data: JSON.stringify(stale) });
    await expect(m.act("new_version")).rejects.toMatchObject({ status: 403 });
  });

  it("blocks signing readiness when the saved PDF receipt belongs to another version", async () => {
    const m = await fixture(); await m.pendingSignature();
    const data = parseClmData(m.get().custom_clm_data);
    data.signatures.push({ ...await m.deps.sign!(m.get(), supplier, { typed_name: "Historical Supplier Signatory", consent: true }), version: "0.0" });
    m.put({ ...m.get(), custom_clm_data: JSON.stringify(data) });
    const readiness = toClmAggregate(legal, "Contract", m.get()).signature_workflow;
    expect(readiness).toMatchObject({ can_sign: false, can_review: false, can_request_signatures: false });
    expect(readiness?.document_file_id).toBeUndefined();
    expect(readiness?.blocked_reason).toBeTruthy();
  });

  it.each(["cancelled", "termination", "completed"])("does not reopen a %s Contract through revision", async state => {
    const m = await fixture(); await m.pendingSignature(); const data = parseClmData(m.get().custom_clm_data);
    if (state === "termination") data.termination = { reason: "Existing termination request", requested_by: "procurement_team@example.test", requested_at: "2026-09-28 10:00:00" };
    if (state === "completed") data.procurement_completion = { purchase_order: "PO-1" };
    m.put({ ...m.get(), ...(state === "cancelled" ? { docstatus: 2 } : {}), custom_clm_data: JSON.stringify(data) }); const before = m.get();
    await expect(m.act("new_version")).rejects.toMatchObject({ status: 403 });
    expect(m.get()).toEqual(before);
  });

  it.each(["legal_review", "finance_review", "procurement", "completed", "rejected"] as const)("cannot reset %s through a stale signature status", async phase => {
    const m = await fixture(); await m.pendingSignature();
    const data = parseClmData(m.get().custom_clm_data); data.rfq_workflow = { version: 1, phase };
    m.put({ ...m.get(), custom_clm_data: JSON.stringify(data) }); const before = m.get();
    await expect(m.act("new_version")).rejects.toMatchObject({ status: 403 });
    expect(m.get()).toEqual(before);
  });
});
