import { createHash } from "node:crypto";
import { ClmError, canReadClm, parseClmData, pendingClmApprovals, rfqClmFinanceApproved, rfqClmLegalSigned } from "./clmCore.js";
import { clmErpRequest, clmResource, listClmErp } from "./clmErp.js";
import { collectClmAlerts, dispatchClmAlerts, type ClmAlert, type ClmNotificationLog } from "./clmMonitoring.js";
import { resolveServerRole, type AccessPrincipal } from "./rbacAuth.js";
import type { ClmApproval, ClmRecord } from "../src/types/clm.js";
import { clmNow } from "./clmTime.js";
import { rfqClmRequestWorkflowView, rfqClmWorkflowView } from "../src/utils/rfqClmWorkflow.js";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const roleNames: Record<string, string[]> = {
  procurement: ["Procurement Manager", "Purchase Manager"], procurement_team: ["Procurement Team", "Procurement User", "Purchase User"],
  finance: ["Finance Manager", "Accounts Manager", "Accounts Payable"], legal: ["Legal Reviewer", "Legal Manager", "Legal User"],
  engineering: ["Engineering Manager"], quality: ["Quality Manager"], program_manager: ["Program Manager"],
};
export async function clmRoleRecipients(role: string): Promise<string[]> {
  if (!roleNames[role]) return [];
  return [...new Set((await listClmErp("Has Role", [["role", "in", roleNames[role]], ["parenttype", "=", "User"]], ["parent"])).map(row => text(row.parent)).filter(Boolean))];
}
async function internalPrincipal(userName: string): Promise<Extract<AccessPrincipal, { typ: "internal" }> | null> {
  let user: ClmRecord;
  try { user = await clmErpRequest("GET", clmResource("User", userName)); }
  catch (error) {
    // A deleted User can leave a stale assignment. Skip that recipient while
    // preserving real ERP failures so monitoring can retry delivery.
    if (error instanceof ClmError && error.status === 404) return null;
    throw error;
  }
  if (!Number(user.enabled)) return null;
  const role = resolveServerRole({ name: String(user.name), email: text(user.email) || String(user.name), erpnext_roles: Array.isArray(user.roles) ? user.roles.map((row: ClmRecord) => String(row.role)) : [] });
  return role ? { typ: "internal", sub: String(user.name), email: text(user.email) || String(user.name), role, iat: 0, exp: Number.MAX_SAFE_INTEGER } : null;
}
async function supplierRecipients(contract: ClmRecord): Promise<string[]> {
  const rows = await listClmErp("Supplier Onboarding", [["linked_supplier", "=", contract.custom_supplier || contract.party_name], ["status", "=", "Approved"]]);
  return [...new Set(rows.map(row => text(row.portal_user)).filter(Boolean))];
}
/** Native logs are checked before insertion. Concurrent runners can still race. */
export async function putClmNotice(document: Omit<ClmNotificationLog, "name"> | Record<string, unknown>): Promise<"created" | "existing"> {
  const existing = await listClmErp("Notification Log", [["for_user", "=", document.for_user], ["subject", "=", document.subject]], ["name"]);
  if (existing.length) return "existing";
  const payload: Record<string, unknown> = { ...document }; delete payload.name;
  await clmErpRequest("POST", clmResource("Notification Log"), payload);
  return "created";
}
export async function notifyClmAction(doctype: string, record: ClmRecord, event: string, approvals: ClmApproval[]): Promise<void> {
  const parent = record.contract ? await clmErpRequest("GET", clmResource("Contract", String(record.contract))) : undefined;
  const contract = doctype === "Contract" ? record : parent;
  const rfqLinked = !!text((contract || record).custom_rfq);
  const data = parseClmData(rfqLinked ? (contract || record).custom_clm_data : null);
  const workflow = data.rfq_workflow as { phase?: string } | undefined;
  const legacyPhase: Record<string, string> = { Draft: "draft", "Pending Legal": "legal_review", "Under Review": "legal_review", Approved: "signature", "Pending Signature": "signature", "Pending Finance": "finance_review", Executed: "procurement", Active: "procurement", Rejected: "rejected" };
  const phase = workflow?.phase || legacyPhase[String((contract || record).custom_contract_status || "")];
  const legallySigned = !!contract && rfqLinked && rfqClmLegalSigned(contract, data);
  const recipients = new Set<string>();
  let currentApprovals = approvals;
  const allowedRfqRoles = new Set<string>();
  if (rfqLinked) {
    // RFQ contracts have one owner at a time. Stale/parallel approval rows
    // must not send Finance work before Legal approval and its verified signature.
    currentApprovals = approvals.filter(row => row.status === "Pending" && (
      phase === "legal_review" && ["Pending Legal", "Under Review"].includes(String(contract?.custom_contract_status)) && row.role === "legal"
      || phase === "finance_review" && contract?.custom_contract_status === "Pending Finance" && legallySigned && row.role === "finance"
    ));
    currentApprovals.forEach(row => allowedRfqRoles.add(row.role));
    const completion = data.procurement_completion as Record<string, unknown> | undefined;
    const procurementReady = !!contract && rfqClmFinanceApproved(contract, data);
    if (doctype === "Contract Request" || phase === "draft" || phase === "rejected" || phase === "procurement" && procurementReady || phase === "completed" && procurementReady && text(completion?.purchase_order)) allowedRfqRoles.add("procurement_team");
    if (phase === "signature" && contract?.custom_contract_status === "Approved") allowedRfqRoles.add("legal");
    for (const role of allowedRfqRoles) {
      if (!currentApprovals.some(row => row.role === role)) for (const user of await clmRoleRecipients(role)) recipients.add(user);
    }
    if (phase === "signature" && contract?.custom_contract_status === "Pending Signature" && !data.signatures.some(row => row.party === "inteva") && contract.custom_inteva_signatory) {
      allowedRfqRoles.add("legal");
      recipients.add(String(contract.custom_inteva_signatory));
    }
  } else {
    if (doctype === "Contract Request" && record.request_status === "Pending Review") for (const user of await clmRoleRecipients("procurement")) recipients.add(user);
    if (!approvals.length || ["reject", "send_back", "supplier_redline", "supplier_accept", "sign", "record_sla"].includes(event)) {
      for (const role of ["procurement", "procurement_team"]) for (const user of await clmRoleRecipients(role)) recipients.add(user);
    }
    if (record.requester) recipients.add(String(record.requester));
    if (contract?.custom_esign_status === "Pending Inteva" && contract.custom_inteva_signatory) recipients.add(String(contract.custom_inteva_signatory));
  }
  for (const approval of currentApprovals) for (const user of approval.user ? [approval.user] : await clmRoleRecipients(approval.role)) recipients.add(user);
  const id = createHash("sha256").update(JSON.stringify([doctype, record.name, record.modified, event])).digest("hex").slice(0, 20);
  const status = (doctype === "Contract" ? rfqClmWorkflowView(record)?.status : doctype === "Contract Request" ? rfqClmRequestWorkflowView(record)?.status : undefined) || record.custom_contract_status || record.request_status || record.amendment_status || record.renewal_status;
  const subject = `[CLM ${id}] ${doctype} ${record.name}: ${String(status || event)}`;
  for (const recipient of recipients) {
    const principal = await internalPrincipal(recipient);
    const assigned = currentApprovals.some(row => principal?.typ === "internal" && principal.role === row.role && (!row.user || row.user.toLowerCase() === recipient.toLowerCase()));
    if (!principal || !canReadClm(principal, doctype, record, parent)) continue;
    if (rfqLinked ? !allowedRfqRoles.has(principal.role) || currentApprovals.length > 0 && !assigned : approvals.length > 0 && !assigned && !["procurement", "procurement_team"].includes(principal.role)) continue;
    const link = doctype === "Contract" ? `/contracts/${encodeURIComponent(String(record.name))}` : doctype === "Contract Request" ? `/contract-requests/${encodeURIComponent(String(record.name))}` : `/contracts/records/${encodeURIComponent(doctype)}/${encodeURIComponent(String(record.name))}`;
    await putClmNotice({ subject, for_user: recipient, type: "Alert", document_type: doctype, document_name: record.name, email_content: subject.replace(/[<>&]/g, ""), link });
  }
  if (contract && ["negotiate", "begin_signature", "sign", "record_sla", "expire"].includes(event) || contract?.custom_contract_status === "Terminated") {
    for (const recipient of await supplierRecipients(contract!)) {
      const user = await clmErpRequest("GET", clmResource("User", recipient));
      if (!Number(user.enabled)) continue;
      await putClmNotice({ subject, for_user: recipient, type: "Alert", document_type: "Contract", document_name: contract!.name, email_content: subject.replace(/[<>&]/g, ""), link: `/supplier/contracts/${encodeURIComponent(String(contract!.name))}` });
    }
  }
}

export async function clmAlertsForRecords(records: ClmRecord[]): Promise<ClmAlert[]> {
  if (!records.length) return [];
  const names = records.map(row => row.name);
  const [obligations, milestones, risks] = await Promise.all(["Contract Obligation", "Contract Milestone", "Contract Risk"].map(doctype => listClmErp(doctype, [["contract", "in", names]])));
  return records.flatMap(record => collectClmAlerts(record, obligations, milestones, risks, clmNow()));
}
export async function runClmMonitoring(): Promise<{ contracts: number; alerts: number; created: number; existing: number; denied: number }> {
  const contracts = (await listClmErp("Contract")).filter(record => !!record.custom_clm_data);
  const alerts = await clmAlertsForRecords(contracts);
  const [managers, team] = await Promise.all([clmRoleRecipients("procurement"), clmRoleRecipients("procurement_team")]);
  const result = await dispatchClmAlerts(alerts, {
    recipientsFor: async alert => {
      const contract = contracts.find(row => row.name === alert.contract);
      return [...(contract?.custom_rfq ? team : managers), ...(alert.owner ? [alert.owner] : [])];
    },
    canReceive: async (user, alert) => {
      const principal = await internalPrincipal(user); const contract = contracts.find(row => row.name === alert.contract);
      return !!principal && !!contract && !(contract.custom_rfq && principal.role === "procurement") && canReadClm(principal, "Contract", contract);
    },
    putNotificationIfAbsent: async (_key, document) => putClmNotice(document),
  });
  // Retry native assignment notices after transient delivery failures. The
  // persisted modified revision makes these repeat-safe during normal runs.
  for (const contract of contracts) {
    const data = parseClmData(contract.custom_clm_data);
    const last = data.audit.at(-1);
    if (last) await notifyClmAction("Contract", contract, last.action, pendingClmApprovals(data));
  }
  return { contracts: contracts.length, alerts: alerts.length, ...result };
}
