import { describe, expect, it, vi } from "vitest";
import { collectClmAlerts, dispatchClmAlerts, type ClmAlertNotificationDeps, type ClmNotificationLog } from "./clmMonitoring";
import type { ClmData, ClmRecord, ClmSla } from "../src/types/clm";

const runtime: ClmData = { schema: 1, approvals: [], versions: [], audit: [], signatures: [], sla: [] };
const contract: ClmRecord = { name: "CON-A", party_type: "Supplier", party_name: "SUP-A", custom_supplier: "SUP-A", custom_contract_status: "Active", custom_renewal_notice_days: 30, custom_clm_data: JSON.stringify(runtime), end_date: "2026-10-31" };
const obligation: ClmRecord = { name: "OBL-A", contract: "CON-A", supplier: "SUP-A", obligation_type: "Supplier", obligation: "Deliver tooling", owne: "owner@example.test", status: "Open", due_date: "2026-09-20", reminder_days_before: 3, escalation_days: 3 };
const byKind = (now: string, row: ClmRecord = obligation) => collectClmAlerts(contract, [row], [], [], now).filter(alert => alert.source_doctype === "Contract Obligation");

describe("read-only Contract monitoring", () => {
  it("starts reminders at the configured boundary and uses the existing owne field", () => {
    expect(byKind("2026-09-16")).toEqual([]);
    expect(byKind("2026-09-17")).toMatchObject([{ kind: "obligation_reminder", owner: "owner@example.test", due_date: "2026-09-20", severity: "info" }]);
    expect(byKind("2026-09-19")[0].id).toBe(byKind("2026-09-17")[0].id);
  });

  it("distinguishes due, overdue and configured escalation without daily duplicate keys", () => {
    expect(byKind("2026-09-20")).toMatchObject([{ kind: "obligation_due", escalation: false }]);
    expect(byKind("2026-09-21")).toMatchObject([{ kind: "obligation_overdue", severity: "warning", escalation: false }]);
    expect(byKind("2026-09-22")[0].id).toBe(byKind("2026-09-21")[0].id);
    expect(byKind("2026-09-23")).toMatchObject([{ kind: "obligation_escalation", severity: "critical", escalation: true }]);
    expect(byKind("2026-09-23")[0].id).not.toBe(byKind("2026-09-21")[0].id);
  });

  it("does not invent reminders or automatic escalation when no interval is configured", () => {
    const row = { ...obligation, reminder_days_before: "", escalation_days: 0 };
    expect(byKind("2026-09-19", row)).toEqual([]);
    expect(byKind("2026-09-30", row)).toMatchObject([{ kind: "obligation_overdue", escalation: false }]);
  });

  it.each(["Completed", "Waived", "Cancelled"])("does not remind a %s obligation", status => {
    expect(byKind("2026-09-24", { ...obligation, status })).toEqual([]);
  });

  it("handles critical obligations and strict leap-day/calendar boundaries", () => {
    expect(byKind("2026-09-20", { ...obligation, is_critical: 1 })[0].severity).toBe("critical");
    const row = { ...obligation, due_date: "2028-02-29", reminder_days_before: 1 };
    expect(byKind("2028-02-28", row)[0].kind).toBe("obligation_reminder");
    expect(byKind("2028-03-01", row)[0].kind).toBe("obligation_overdue");
    expect(() => byKind("2026-09-17", { ...obligation, due_date: "2026-02-30" })).toThrow("valid calendar date");
    expect(() => byKind("2026-09-17", { ...obligation, escalation_days: -1 })).toThrow("non-negative");
  });

  it("rejects an invalid/missing monitoring clock instead of guessing today's date", () => {
    expect(() => collectClmAlerts(contract, [], [], [], "")).toThrow("monitoring date is required");
    expect(() => collectClmAlerts(contract, [], [], [], new Date("invalid"))).toThrow("valid calendar date");
  });

  it("does not act on records belonging to another Contract", () => {
    const alerts = collectClmAlerts(contract, [{ ...obligation, contract: "CON-B" }], [{ name: "M-B", contract: "CON-B", planned_date: "2026-01-01" }], [{ name: "R-B", contract: "CON-B", risk_level: "Critical" }], "2026-09-24");
    expect(alerts).toEqual([]);
  });

  it("flags repeated missed Supplier commitments without creating a Risk or blaming Inteva", () => {
    const rows = [obligation, { ...obligation, name: "OBL-B" }, { ...obligation, name: "OBL-C", obligation_type: "Inteva" }];
    const alerts = collectClmAlerts(contract, rows, [], [], "2026-09-24");
    expect(alerts.filter(alert => alert.kind === "supplier_performance_risk")).toMatchObject([{ supplier_performance_risk: true, related_names: ["OBL-A", "OBL-B"], escalation: true }]);
    expect(collectClmAlerts(contract, [obligation, obligation], [], [], "2026-09-24").some(alert => alert.kind === "supplier_performance_risk")).toBe(false);
    expect(collectClmAlerts(contract, [obligation, { ...obligation, name: "OBL-B", supplier: "SUP-B" }], [], [], "2026-09-24").some(alert => alert.kind === "supplier_performance_risk")).toBe(false);
  });

  it("uses existing renewal notice/auto-renewal data without automatically renewing", () => {
    expect(collectClmAlerts(contract, [], [], [], "2026-09-30")).toEqual([]);
    const auto = { ...contract, custom_auto_renewal: 1 };
    const alerts = collectClmAlerts(auto, [], [], [], "2026-10-01");
    expect(alerts).toMatchObject([{ kind: "renewal_notice", due_date: "2026-10-31" }]);
    expect(alerts[0].message).toContain("Auto renewal is configured");
    expect(auto.custom_contract_status).toBe("Active"); expect(auto.end_date).toBe("2026-10-31");
  });

  it("alerts at/past the end date and requests closure validation for Expired/Terminated records", () => {
    expect(collectClmAlerts(contract, [], [], [], "2026-10-31")).toMatchObject([{ kind: "expiry_due" }]);
    expect(collectClmAlerts(contract, [], [], [], "2026-11-01")).toMatchObject([{ kind: "contract_expired" }]);
    for (const status of ["Expired", "Terminated"]) expect(collectClmAlerts({ ...contract, custom_contract_status: status }, [], [], [], "2026-11-01")).toMatchObject([{ kind: "closure_required" }]);
  });

  it.each(["Draft", "Under Review", "Approved", "Pending Signature", "Executed", "Closed"])("does not start/continue operational reminders in %s", status => {
    expect(collectClmAlerts({ ...contract, custom_contract_status: status }, [obligation], [], [], "2026-09-24")).toEqual([]);
  });

  it("keeps monitoring an active signed contract during its termination review", () => {
    const record = { ...contract, custom_contract_status: "Under Review", custom_esign_status: "Completed", custom_clm_data: JSON.stringify({ ...runtime, termination: { reason: "Business change", requested_by: "procurement@example.test", requested_at: "2026-09-22" } }) };
    expect(collectClmAlerts(record, [obligation], [], [], "2026-09-24")[0].kind).toBe("obligation_escalation");
  });

  it("monitors milestone and risk owners using actual schema fields", () => {
    const milestones = [{ name: "M-A", contract: "CON-A", milestone_name: "PPAP", planned_date: "2026-09-18", responsible_person: "quality@example.test", priority: "Critical", status: "In Progress" }];
    const risks = [{ name: "R-A", contract: "CON-A", risk_title: "Delivery", risk_level: "High", risk_owner: "risk@example.test", target_resolution: "2026-09-18", risk_status: "Monitoring" }];
    const alerts = collectClmAlerts(contract, [], milestones, risks, "2026-09-19");
    expect(alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "milestone_overdue", owner: "quality@example.test", severity: "critical" }), expect.objectContaining({ kind: "risk_monitoring", owner: "risk@example.test", escalation: true })]));
    milestones[0].status = "Completed"; risks[0].risk_status = "Resolved";
    expect(collectClmAlerts(contract, [], milestones, risks, "2026-09-19")).toEqual([]);
  });

  it("alerts only for the latest breached measurement per metric, retaining all historical evidence", () => {
    const breached: ClmSla = { id: "SLA-1", metric: "OTD", target: 98, actual: 94.5, operator: "gte", status: "Breached", at: "2026-09-16 12:00:00", by: "procurement@example.test", corrective_action: "Expedite" };
    const record = { ...contract, custom_clm_data: JSON.stringify({ ...runtime, sla: [breached] }) };
    expect(collectClmAlerts(record, [], [], [], "2026-09-17")).toMatchObject([{ kind: "sla_breach", escalation: true }]);
    record.custom_clm_data = JSON.stringify({ ...runtime, sla: [{ ...breached, id: "SLA-2", actual: 99, status: "Met", at: "2026-09-17 12:00:00" }, breached] });
    expect(collectClmAlerts(record, [], [], [], "2026-09-17")).toEqual([]);
    expect(JSON.parse(record.custom_clm_data).sla).toHaveLength(2);
  });

  it("reports invalid saved SLA evidence and never mutates any input", () => {
    const source = structuredClone({ contract, obligations: [obligation], milestones: [], risks: [] }); const before = structuredClone(source);
    collectClmAlerts(source.contract, source.obligations, source.milestones, source.risks, "2026-09-24"); expect(source).toEqual(before);
    expect(() => collectClmAlerts({ ...contract, custom_clm_data: JSON.stringify({ ...runtime, sla: [{ metric: "OTD", actual: "94.5", target: 98, operator: "gte" }] }) }, [], [], [], "2026-09-17")).toThrow("SLA data is invalid");
  });
});

describe("optional native Notification Log delivery", () => {
  function dependencies(persisted = new Map<string, ClmNotificationLog>()) {
    const deps: ClmAlertNotificationDeps = {
      recipientsFor: vi.fn(async () => ["owner@example.test", "owner@example.test", "unauthorized@example.test"]),
      canReceive: vi.fn(async user => user === "owner@example.test"),
      putNotificationIfAbsent: vi.fn(async (key, document) => { if (persisted.has(key)) return "existing"; persisted.set(key, document); return "created"; }),
    }; return { deps, persisted };
  }
  it("deduplicates persisted alerts across repeated runs and rechecks recipient authorization", async () => {
    const alerts = byKind("2026-09-21"); const first = dependencies();
    expect(await dispatchClmAlerts([...alerts, ...alerts], first.deps)).toEqual({ created: 1, existing: 0, denied: 1 });
    expect(first.persisted.size).toBe(1);
    const second = dependencies(first.persisted);
    expect(await dispatchClmAlerts(byKind("2026-09-22"), second.deps)).toEqual({ created: 0, existing: 1, denied: 1 });
    expect(second.deps.putNotificationIfAbsent).toHaveBeenCalledTimes(1);
    expect([...first.persisted.values()][0]).toMatchObject({ type: "Alert", for_user: "owner@example.test", document_type: "Contract", document_name: "CON-A", link: "/contracts/CON-A" });
    expect([...first.persisted.values()][0].subject).toContain(alerts[0].id);
  });

  it("notifies once more when the configured escalation threshold is reached", async () => {
    const { deps, persisted } = dependencies(); await dispatchClmAlerts(byKind("2026-09-22"), deps);
    expect(await dispatchClmAlerts(byKind("2026-09-23"), deps)).toEqual({ created: 1, existing: 0, denied: 1 });
    expect(persisted.size).toBe(2);
  });

  it("escapes notification HTML and propagates unconfirmed delivery failures", async () => {
    const alerts = byKind("2026-09-21"); alerts[0].message = '<script>alert("private")</script>&';
    const { deps, persisted } = dependencies(); await dispatchClmAlerts(alerts, deps);
    expect([...persisted.values()][0].email_content).not.toContain("<script>"); expect([...persisted.values()][0].email_content).toContain("&lt;script&gt;");
    deps.putNotificationIfAbsent = vi.fn(async () => { throw new Error("ERP write failed"); });
    await expect(dispatchClmAlerts(alerts, deps)).rejects.toThrow("ERP write failed");
  });
});
