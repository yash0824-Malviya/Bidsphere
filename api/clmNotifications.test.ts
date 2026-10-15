import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clmRoleRecipients, notifyClmAction, putClmNotice, runClmMonitoring } from "./clmNotifications";
import { ClmError, clmSnapshotHash } from "./clmCore";
import type { ClmApproval, ClmRecord } from "../src/types/clm";

const transport = vi.hoisted(() => ({ request: vi.fn(), list: vi.fn() }));
vi.mock("./clmErp.js", () => ({ clmErpRequest: transport.request, listClmErp: transport.list, clmResource: (doctype: string, name?: string) => `resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}` }));
const finance: ClmApproval = { id: "FIN", role: "finance", stage: 0, status: "Pending", rule: "RULE-A" };
const runtime = { schema: 1, approvals: [finance], versions: [], audit: [], signatures: [], sla: [] };
const contract: ClmRecord = { name: "CON-A", modified: "2026-09-17 12:00:00", custom_supplier: "SUP-A", party_name: "SUP-A", party_type: "Supplier", custom_contract_status: "Under Review", custom_contract_title: "Supplier contract", internal_notes: "DO NOT SEND INTERNAL RISK NOTES", custom_approval_comments: "DO NOT SEND PRIVATE FINANCE COMMENTS", custom_clm_data: JSON.stringify(runtime), end_date: "2026-10-31", custom_renewal_notice_days: 30 };
const user = (name: string, roles: string[], enabled = 1) => ({ name, email: name, enabled, roles: roles.map(role => ({ role })) });

function fixture(overrides: { contract?: ClmRecord; users?: ClmRecord[]; onboarding?: ClmRecord[]; obligations?: ClmRecord[]; hasRoleRows?: ClmRecord[] } = {}) {
  const users = overrides.users ?? [
    user("finance@example.test", ["Finance Manager"]), user("mixed@example.test", ["Finance Manager", "Legal Reviewer"]), user("disabled@example.test", ["Finance Manager"], 0),
    user("procurement@example.test", ["Procurement Manager"]), user("team@example.test", ["Purchase User"]), user("revoked@example.test", []),
    user("portal-a@example.test", ["Supplier"]), user("portal-b@example.test", ["Supplier"]), user("portal-c@example.test", ["Supplier"]), user("portal-disabled@example.test", ["Supplier"], 0),
  ];
  const currentContract = structuredClone(overrides.contract ?? contract);
  const onboarding = overrides.onboarding ?? [
    { name: "ON-A", linked_supplier: "SUP-A", status: "Approved", portal_user: "portal-a@example.test" },
    { name: "ON-B", linked_supplier: "SUP-B", status: "Approved", portal_user: "portal-b@example.test" },
    { name: "ON-C", linked_supplier: "SUP-A", status: "Pending Review", portal_user: "portal-c@example.test" },
    { name: "ON-D", linked_supplier: "SUP-A", status: "Approved", portal_user: "portal-disabled@example.test" },
  ];
  const notifications: ClmRecord[] = [];
  function matches(row: ClmRecord, filters: unknown[]) {
    return filters.every(filter => {
      const [key, operator, value] = filter as [string, string, unknown];
      return operator === "=" ? row[key] === value : operator === "in" ? (value as unknown[]).includes(row[key]) : false;
    });
  }
  transport.list.mockImplementation(async (doctype: string, filters: unknown[] = []) => {
    if (doctype === "Has Role") {
      const rows = [...(overrides.hasRoleRows || []), ...users.flatMap(row => (row.roles as Array<{ role: string }>).map(role => ({ parent: row.name, parenttype: "User", role: role.role })))];
      return rows.filter(row => matches(row, filters)).map(row => ({ parent: row.parent }));
    }
    const rows = doctype === "Contract" ? [currentContract] : doctype === "Supplier Onboarding" ? onboarding : doctype === "Notification Log" ? notifications : doctype === "Contract Obligation" ? overrides.obligations ?? [] : [];
    return structuredClone(rows.filter(row => matches(row, filters)));
  });
  transport.request.mockImplementation(async (method: string, path: string, body?: ClmRecord) => {
    const decoded = decodeURIComponent(path);
    if (method === "GET" && decoded.startsWith("resource/User/")) {
      const found = users.find(row => row.name === decoded.slice("resource/User/".length));
      if (!found) throw new ClmError("User missing from fixture", 404); return structuredClone(found);
    }
    if (method === "GET" && decoded === "resource/Contract/CON-A") return structuredClone(currentContract);
    if (method === "POST" && decoded === "resource/Notification Log") { const row = { ...body, name: `LOG-${notifications.length + 1}` }; notifications.push(row); return row; }
    throw new Error(`Unexpected ERP request or business write: ${method} ${decoded}`);
  });
  return { notifications, currentContract, users };
}

describe("native CLM notification scope and durable deduplication", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-17T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  it("looks up only known existing roles and does not invent role mappings", async () => {
    fixture(); expect(await clmRoleRecipients("finance")).toEqual(["finance@example.test", "mixed@example.test", "disabled@example.test"]);
    expect(transport.list).toHaveBeenCalledWith("Has Role", [["role", "in", ["Finance Manager", "Accounts Manager", "Accounts Payable"]], ["parenttype", "=", "User"]], ["parent"]);
    const before = transport.list.mock.calls.length; expect(await clmRoleRecipients("CCB")).toEqual([]); expect(transport.list.mock.calls).toHaveLength(before);
  });

  it("excludes Role Profile parents from recipient lookup", async () => {
    fixture({ hasRoleRows: [{ parent: "Finance Profile", parenttype: "Role Profile", role: "Finance Manager" }] });
    expect(await clmRoleRecipients("finance")).toEqual(["finance@example.test", "mixed@example.test", "disabled@example.test"]);
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("continues Finance delivery after a stale User assignment returns 404", async () => {
    const { notifications } = fixture({ hasRoleRows: [{ parent: "deleted-finance@example.test", parenttype: "User", role: "Finance Manager" }] });
    await notifyClmAction("Contract", contract, "submit_review", [finance]);
    expect(transport.request).toHaveBeenCalledWith("GET", "resource/User/deleted-finance%40example.test");
    expect(notifications.map(row => row.for_user)).toEqual(["finance@example.test"]);
  });

  it("preserves actionable ERP errors instead of treating them as stale users", async () => {
    const { notifications } = fixture();
    transport.request.mockRejectedValueOnce(new ClmError("ERP unavailable", 503));
    await expect(notifyClmAction("Contract", contract, "submit_review", [finance])).rejects.toThrow("ERP unavailable");
    expect(notifications).toEqual([]);
  });

  it("filters recipients by current canonical role, assignment and enabled state", async () => {
    const { notifications } = fixture(); await notifyClmAction("Contract", contract, "submit_review", [finance]);
    expect(notifications.map(row => row.for_user)).toEqual(["finance@example.test"]);
    expect(notifications.some(row => row.for_user === "mixed@example.test" || row.for_user === "disabled@example.test")).toBe(false);
  });

  it("does not send a named Finance assignment to a user whose role was revoked", async () => {
    const { notifications } = fixture(); await notifyClmAction("Contract", contract, "submit_review", [{ ...finance, user: "revoked@example.test" }]);
    expect(notifications).toEqual([]);
  });

  it("sends supplier events only to an enabled portal user on approved onboarding for that supplier", async () => {
    const record = { ...contract, custom_contract_status: "Negotiation" }; const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, "negotiate", []);
    const portal = notifications.filter(row => String(row.for_user).startsWith("portal"));
    expect(portal.map(row => row.for_user)).toEqual(["portal-a@example.test"]);
    expect(transport.list).toHaveBeenCalledWith("Supplier Onboarding", [["linked_supplier", "=", "SUP-A"], ["status", "=", "Approved"]]);
    expect(JSON.stringify(portal)).not.toContain("DO NOT SEND"); expect(portal[0]).toMatchObject({ document_type: "Contract", document_name: "CON-A", type: "Alert" });
  });

  it("does not notify suppliers of internal approval/rejection comments", async () => {
    const { notifications } = fixture(); await notifyClmAction("Contract", contract, "approve", [finance]);
    expect(notifications.every(row => !String(row.for_user).startsWith("portal"))).toBe(true);
    expect(JSON.stringify(notifications)).not.toContain("PRIVATE FINANCE"); expect(JSON.stringify(notifications)).not.toContain("INTERNAL RISK");
  });

  it("delivers the same persisted revision only once across repeated calls", async () => {
    const { notifications } = fixture();
    await notifyClmAction("Contract", contract, "submit_review", [finance]); await notifyClmAction("Contract", structuredClone(contract), "submit_review", [finance]);
    expect(notifications).toHaveLength(1);
    expect(transport.request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
    await notifyClmAction("Contract", { ...contract, modified: "2026-09-17 12:01:00" }, "submit_review", [finance]);
    expect(notifications).toHaveLength(2);
  });

  it("deduplicates native logs per recipient and subject without relying on caller-controlled names", async () => {
    const { notifications } = fixture(); const notice = { name: "request-supplied-name", for_user: "finance@example.test", subject: "[CLM occurrence] Contract alert", type: "Alert" };
    expect(await putClmNotice(notice)).toBe("created"); expect(await putClmNotice(notice)).toBe("existing"); expect(await putClmNotice({ ...notice, for_user: "procurement@example.test" })).toBe("created");
    expect(notifications).toHaveLength(2); expect(transport.request.mock.calls.filter(([method]) => method === "POST").every(([, , body]) => !("name" in body))).toBe(true);
  });

  it("does not report a failed Notification Log write as successful delivery", async () => {
    fixture(); transport.request.mockRejectedValueOnce(new Error("ERP unavailable"));
    await expect(putClmNotice({ for_user: "finance@example.test", subject: "Alert" })).rejects.toThrow("ERP unavailable");
  });

  it("monitoring creates only authorized native notices, leaves business records untouched, and deduplicates a rerun", async () => {
    const active = { ...contract, custom_contract_status: "Active" };
    const obligations = [{ name: "OBL-A", contract: "CON-A", supplier: "SUP-A", obligation_type: "Supplier", obligation: "Deliver parts", owne: "revoked@example.test", status: "Open", due_date: "2026-09-16", reminder_days_before: 3, escalation_days: 2 }];
    const before = structuredClone({ active, obligations }); const f = fixture({ contract: active, obligations });
    const first = await runClmMonitoring(); expect(first).toMatchObject({ contracts: 1, alerts: 1, created: 1, denied: 1 });
    expect(f.notifications.map(row => row.for_user)).toEqual(["procurement@example.test"]);
    expect({ active, obligations }).toEqual(before); expect(f.currentContract).toEqual(active);
    const second = await runClmMonitoring(); expect(second).toMatchObject({ created: 0, existing: 1, denied: 1 });
    expect(transport.request.mock.calls.filter(([method]) => method !== "GET").every(([, path]) => decodeURIComponent(path) === "resource/Notification Log")).toBe(true);
  });

  const legal: ClmApproval = { id: "LEGAL", role: "legal", stage: 0, status: "Pending", rule: "RFQ" };
  const approvedLegal: ClmApproval = { ...legal, status: "Approved", by: "mixed@example.test", at: "2026-09-17 09:00:00" };
  const pendingFinance: ClmApproval = { ...finance, stage: 1 };
  function rfqContract(phase: string, status: string, approvals: ClmApproval[] = [], signed = false): ClmRecord {
    if (phase === "procurement") { signed = true; approvals = [approvedLegal, { ...pendingFinance, status: "Approved", by: "finance@example.test", at: "2026-09-17 11:00:00" }]; }
    const record: ClmRecord = { ...contract, custom_rfq: "RFQ-93", custom_supplier_quotation: "SQ-93", custom_contract_status: status, requester: "procurement@example.test",
      custom_current_version: "1.0", custom_final_version_locked: signed ? 1 : 0,
      custom_esign_status: signed ? "Completed" : "Not Started", custom_inteva_signatory: "mixed@example.test",
      ...(signed ? { custom_executed_contract: "/private/files/legal-signed.pdf" } : {}) };
    record.custom_clm_data = JSON.stringify({ ...runtime, approvals, rfq_context: { award_id: "AWARD-93" }, rfq_source: { contract_required: true, rfq: "RFQ-93" }, rfq_workflow: { version: 1, phase },
      signatures: signed ? [{ party: "inteva", role: "legal", by: "mixed@example.test", at: "2026-09-17 10:00:00", version: "1.0", typed_name: "Legal Reviewer", file_id: "LEGAL-SIGNED", file_url: "/private/files/legal-signed.pdf", hash: "a".repeat(64) }] : [],
      ...(signed ? { locked_hash: clmSnapshotHash("Contract", record) } : {}) });
    return record;
  }

  it.each(["Draft", "Pending Review", "Completed", "Rejected"])("assigns RFQ Contract Request %s only to Team", async request_status => {
    const record = { name: "CR-RFQ", custom_rfq: "RFQ-93", request_status, requester: "procurement@example.test", custom_clm_data: JSON.stringify({ ...runtime, approvals: [] }) };
    const { notifications } = fixture();
    await notifyClmAction("Contract Request", record, "submit", []);
    expect(notifications.map(row => row.for_user)).toEqual(["team@example.test"]);
  });

  it("retains Procurement Manager notices for standalone Contract Request review", async () => {
    const record = { name: "CR-STANDALONE", request_status: "Pending Review", custom_clm_data: JSON.stringify({ ...runtime, approvals: [] }) };
    const { notifications } = fixture(); await notifyClmAction("Contract Request", record, "submit", []);
    expect(notifications.map(row => row.for_user)).toEqual(["procurement@example.test", "team@example.test"]);
  });

  it("announces the persisted Pending Procurement Team request only to Team and deduplicates it", async () => {
    const approval: ClmApproval = { id: "TEAM-94", role: "procurement_team", stage: 0, status: "Pending", rule: "RFQ Award: Procurement Team Processing" };
    const request = { name: "CR-94", modified: "request-94-revision", custom_rfq: "PUR-RFQ-2026-00094", request_status: "Draft", requester: "procurement@example.test", custom_clm_data: JSON.stringify({ ...runtime, approvals: [approval], rfq_source: { rfq: "PUR-RFQ-2026-00094", award: "LDC2026-00025" }, rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" } }) };
    const { notifications } = fixture();
    await notifyClmAction("Contract Request", request, "procurement_team_assigned", [approval]);
    await notifyClmAction("Contract Request", request, "procurement_team_assigned", [approval]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ for_user: "team@example.test", document_type: "Contract Request", document_name: "CR-94", link: "/contract-requests/CR-94", subject: expect.stringContaining("Pending Procurement Team") });
    expect(notifications.some(row => ["procurement@example.test", "mixed@example.test", "finance@example.test"].includes(String(row.for_user)))).toBe(false);
  });

  it("does not announce a completed RFQ handoff from an old Executed label without Finance evidence", async () => {
    const record = { ...contract, custom_rfq: "RFQ-93", custom_contract_status: "Executed", custom_clm_data: JSON.stringify({ ...runtime, approvals: [] }) };
    const { notifications } = fixture({ contract: record }); await notifyClmAction("Contract", record, "approve", []);
    expect(notifications).toEqual([]);
  });

  it.each([["draft", "Draft", "create"], ["draft", "Draft", "send_back"], ["rejected", "Rejected", "reject"], ["procurement", "Executed", "approve"]])(
    "routes RFQ %s notices to Procurement Team without a Manager/requester assignment", async (phase, status, event) => {
      const record = rfqContract(phase, status); const { notifications } = fixture({ contract: record });
      await notifyClmAction("Contract", record, event, []);
      expect(notifications.map(row => row.for_user)).toEqual(["team@example.test"]);
    },
  );

  it.each(["create", "submit_review"])("notifies only Legal for RFQ %s even if stale parallel Finance rows are supplied", async event => {
    const record = rfqContract("legal_review", "Pending Legal", [legal, finance]); const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, event, [legal, finance]);
    expect(notifications.map(row => row.for_user)).toEqual(["mixed@example.test"]);
    expect(notifications[0].subject).toContain("Pending Legal Review");
  });

  it("notifies Legal to start signatures after Legal approval without assigning Finance", async () => {
    const record = rfqContract("signature", "Approved", [{ ...legal, status: "Approved" }]); const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, "approve", []);
    expect(notifications.map(row => row.for_user)).toEqual(["mixed@example.test"]);
  });

  it("notifies only the designated Legal signatory internally after the supplier signs", async () => {
    const record = { ...rfqContract("signature", "Pending Signature", [{ ...legal, status: "Approved" }]), custom_esign_status: "Pending Inteva" };
    const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, "sign", []);
    expect(notifications.filter(row => !String(row.for_user).startsWith("portal")).map(row => row.for_user)).toEqual(["mixed@example.test"]);
  });
  it("notifies the designated Legal signatory when signature requests open even before the supplier signs", async () => {
    const record = { ...rfqContract("signature", "Pending Signature", [{ ...legal, status: "Approved" }]), custom_esign_status: "Pending Supplier" };
    const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, "begin_signature", []);
    expect(notifications.map(row => row.for_user).sort()).toEqual(["mixed@example.test", "portal-a@example.test"]);
  });
  it("does not send Finance work without a persisted Finance transition and a valid Legal receipt", async () => {
    const record = { ...rfqContract("signature", "Pending Signature", [{ ...legal, status: "Approved" }]), custom_esign_status: "Pending Supplier" };
    const data = JSON.parse(String(record.custom_clm_data)); data.signatures = [{ party: "inteva", role: "legal" }]; record.custom_clm_data = JSON.stringify(data);
    const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, "sign", []);
    expect(notifications.map(row => row.for_user)).toEqual(["portal-a@example.test"]);
  });

  it("does not send a Legal signature assignment to a named Procurement Manager", async () => {
    const record = { ...rfqContract("signature", "Pending Signature"), custom_esign_status: "Pending Inteva", custom_inteva_signatory: "procurement@example.test" };
    const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, "sign", []);
    expect(notifications.filter(row => !String(row.for_user).startsWith("portal"))).toEqual([]);
  });

  it("assigns Finance after the verified Legal signature and persisted Pending Finance transition without waiting for a supplier signature", async () => {
    const record = rfqContract("finance_review", "Pending Finance", [approvedLegal, pendingFinance], true);
    const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, "approve", [pendingFinance]);
    expect(notifications.map(row => row.for_user)).toEqual(["finance@example.test"]);
    expect(notifications[0].subject).toContain("Pending Finance Approval");
  });

  it("keeps Finance notices independent of the optional supplier signature", async () => {
    const record = rfqContract("finance_review", "Pending Finance", [approvedLegal, pendingFinance], true);
    const data = JSON.parse(String(record.custom_clm_data));
    data.signatures.push({ ...data.signatures[0], party: "supplier", role: undefined, by: "portal-a@example.test", at: "2026-09-17 10:15:00", file_id: "SUPPLIER-SIGNED", file_url: "/private/files/supplier-signed.pdf", hash: "b".repeat(64) });
    record.custom_executed_contract = "/private/files/supplier-signed.pdf";
    record.custom_clm_data = JSON.stringify(data);
    const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, "approve", [pendingFinance]);
    expect(notifications.map(row => row.for_user)).toEqual(["finance@example.test"]);
  });

  it("does not deliver a Finance task to a named Legal Manager", async () => {
    const assigned = { ...pendingFinance, user: "mixed@example.test" };
    const record = rfqContract("finance_review", "Pending Finance", [approvedLegal, assigned], true);
    const { notifications } = fixture({ contract: record });
    await notifyClmAction("Contract", record, "approve", [assigned]);
    expect(notifications).toEqual([]);
  });

  it.each(["missing-receipt", "old-version", "wrong-signer", "wrong-role", "missing-file", "invalid-hash", "missing-lock", "unapproved-legal", "signature-before-approval"])(
    "does not notify Finance when Legal evidence is invalid: %s", async invalid => {
      const record = rfqContract("finance_review", "Pending Finance", [approvedLegal, pendingFinance], true);
      const data = JSON.parse(String(record.custom_clm_data));
      if (invalid === "missing-receipt") data.signatures = [];
      if (invalid === "old-version") data.signatures[0].version = "0.9";
      if (invalid === "wrong-signer") data.signatures[0].by = "procurement@example.test";
      if (invalid === "wrong-role") data.signatures[0].role = "finance";
      if (invalid === "missing-file") data.signatures[0].file_id = "";
      if (invalid === "invalid-hash") data.signatures[0].hash = "invalid";
      if (invalid === "missing-lock") data.locked_hash = "";
      if (invalid === "unapproved-legal") data.approvals[0].status = "Pending";
      if (invalid === "signature-before-approval") data.signatures[0].at = "2026-09-17 08:59:00";
      record.custom_clm_data = JSON.stringify(data);
      const { notifications } = fixture({ contract: record });
      await notifyClmAction("Contract", record, "approve", [pendingFinance]);
      expect(notifications).toEqual([]);
    },
  );

  it.each([true, false])("announces completion only with the persisted submitted PO receipt (%s)", async hasReceipt => {
    const record = rfqContract("procurement", "Active"); const data = JSON.parse(String(record.custom_clm_data));
    data.rfq_workflow.phase = "completed";
    if (hasReceipt) data.procurement_completion = { purchase_order: "PO-SUBMITTED-93", by: "team@example.test", role: "procurement_team", at: "2026-09-22 12:00:00", rfq: "RFQ-93", award: "AWARD-93", quotation: "SQ-93", supplier: "SUP-A" };
    record.custom_clm_data = JSON.stringify(data);
    const { notifications } = fixture({ contract: record }); await notifyClmAction("Contract", record, "finalize_procurement", []);
    expect(notifications.map(row => row.for_user)).toEqual(hasReceipt ? ["team@example.test"] : []);
    if (hasReceipt) expect(notifications[0].subject).toContain("Completed");
    expect(record.custom_contract_status).toBe("Active");
  });

  it.each([false, "missing-inteva"])("does not notify Finance when RFQ signature evidence is incomplete (%s)", async signed => {
    const record = rfqContract("finance_review", "Pending Finance", [finance], signed === "missing-inteva");
    if (signed) { const data = JSON.parse(String(record.custom_clm_data)); data.signatures = [{ party: "supplier" }]; record.custom_clm_data = JSON.stringify(data); }
    const { notifications } = fixture({ contract: record }); await notifyClmAction("Contract", record, "approve", [finance]);
    expect(notifications).toEqual([]);
  });

  it("uses Procurement Team for operational RFQ contract monitoring without assigning its Manager owner", async () => {
    const record = rfqContract("procurement", "Active");
    const obligations = [{ name: "OBL-A", contract: "CON-A", obligation: "Deliver parts", owne: "procurement@example.test", status: "Open", due_date: "2026-09-16" }];
    const { notifications } = fixture({ contract: record, obligations });
    await runClmMonitoring();
    expect(notifications.map(row => row.for_user)).toEqual(["team@example.test"]);
  });
});
