import { createHash } from "node:crypto";
import type { ClmRecord, ClmSla } from "../src/types/clm.js";
import { ClmError, clmStatus, parseClmData } from "./clmCore.js";

export type ClmAlertKind = "obligation_reminder" | "obligation_due" | "obligation_overdue" | "obligation_escalation" | "supplier_performance_risk" | "renewal_notice" | "expiry_due" | "contract_expired" | "milestone_due" | "milestone_overdue" | "risk_monitoring" | "sla_breach" | "closure_required";
export interface ClmAlert {
  id: string;
  kind: ClmAlertKind;
  severity: "info" | "warning" | "critical";
  contract: string;
  source_doctype: "Contract" | "Contract Obligation" | "Contract Milestone" | "Contract Risk";
  source_name: string;
  title: string;
  message: string;
  due_date?: string;
  owner?: string;
  escalation?: boolean;
  supplier_performance_risk?: boolean;
  related_names?: string[];
}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const yes = (value: unknown) => value === true || value === 1 || value === "1";
const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const DAY_MS = 24 * 60 * 60 * 1000;
function calendarDate(value: unknown, label: string): { date: string; day: number } | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (value instanceof Date && !Number.isFinite(value.getTime())) throw new ClmError(`${label} must contain a valid calendar date.`);
  const candidate = value instanceof Date ? value.toISOString().slice(0, 10) : text(value).slice(0, 10);
  const milliseconds = Date.parse(`${candidate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== candidate) throw new ClmError(`${label} must contain a valid calendar date.`);
  return { date: candidate, day: Math.floor(milliseconds / DAY_MS) };
}
function configuredDays(value: unknown, label: string): number {
  if (value === null || value === undefined || value === "") return 0;
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 0) throw new ClmError(`${label} must be a non-negative number of days.`);
  return days;
}
function distinctRelated(rows: ClmRecord[], name: string): ClmRecord[] {
  return [...new Map(rows.filter(row => text(row.contract) === name && text(row.name) && Number(row.docstatus) !== 2).map(row => [text(row.name), row])).values()];
}
const identity = (value: unknown) => text(value).replace(/^(["'])(.*)\1$/, "$2").trim().toLowerCase();

/**
 * Read-only assessment of operational contracts. `now` should be the ERP site's
 * business date/clock; a Date instance is interpreted by its UTC calendar date.
 * Alerts never approve, renew, expire, close, or create a supplier risk record.
 */
export function collectClmAlerts(contract: ClmRecord, obligations: ClmRecord[], milestones: ClmRecord[], risks: ClmRecord[], now: string | Date): ClmAlert[] {
  const name = text(contract.name);
  if (!name) throw new ClmError("Select a saved Contract before monitoring.");
  const today = calendarDate(now, "Monitoring date");
  if (!today) throw new ClmError("A monitoring date is required.");
  const status = clmStatus("Contract", contract);
  if (status === "Closed" || status === "Cancelled" || Number(contract.docstatus) === 2) return [];
  const data = parseClmData(contract.custom_clm_data);
  // Obligations and performance continue during a termination review of an
  // already signed, active contract. Draft authoring does not start operations.
  const operational = ["Active", "Expired", "Terminated"].includes(status) || (status === "Under Review" && !!data.termination && contract.custom_esign_status === "Completed");
  if (!operational) return [];
  const alerts: ClmAlert[] = [];
  const add = (kind: ClmAlertKind, source: ClmAlert["source_doctype"], sourceName: string, occurrence: unknown[], detail: Omit<ClmAlert, "id" | "kind" | "contract" | "source_doctype" | "source_name">) => {
    alerts.push({ id: `clm-${hash([name, kind, source, sourceName, ...occurrence]).slice(0, 48)}`, kind, contract: name, source_doctype: source, source_name: sourceName, ...detail });
  };
  const overdueSupplierObligations: string[] = [];
  const supplier = identity(contract.custom_supplier || contract.party_name);
  for (const obligation of distinctRelated(obligations, name)) {
    if (["Completed", "Waived", "Cancelled"].includes(text(obligation.status))) continue;
    const due = calendarDate(obligation.due_date, `Obligation ${obligation.name} due date`);
    if (!due) continue;
    const reminder = configuredDays(obligation.reminder_days_before, `Obligation ${obligation.name} reminder`);
    const escalation = configuredDays(obligation.escalation_days, `Obligation ${obligation.name} escalation`);
    const daysUntilDue = due.day - today.day;
    if (daysUntilDue > reminder) continue;
    const lateDays = -daysUntilDue;
    const escalated = lateDays > 0 && escalation > 0 && lateDays >= escalation;
    const kind: ClmAlertKind = daysUntilDue > 0 ? "obligation_reminder" : daysUntilDue === 0 ? "obligation_due" : escalated ? "obligation_escalation" : "obligation_overdue";
    const title = text(obligation.obligation) || String(obligation.name);
    add(kind, "Contract Obligation", String(obligation.name), [due.date], {
      title: daysUntilDue > 0 ? `Obligation approaching: ${title}` : daysUntilDue === 0 ? `Obligation due: ${title}` : `Overdue obligation: ${title}`,
      message: daysUntilDue > 0 ? `Due on ${due.date}. Confirm the delivery or completion plan.` : daysUntilDue === 0 ? "Completion is due today. Record completion and supporting evidence." : `${lateDays} day(s) overdue.${escalated ? " The configured escalation interval has been reached; Procurement review is required." : " The owner must review the missed commitment."}`,
      severity: escalated || yes(obligation.is_critical) && daysUntilDue <= 0 ? "critical" : daysUntilDue > 0 ? "info" : "warning",
      due_date: due.date, owner: text(obligation.owne) || undefined, escalation: escalated,
    });
    if (daysUntilDue < 0 && obligation.obligation_type === "Supplier" && supplier && identity(obligation.supplier) === supplier) overdueSupplierObligations.push(String(obligation.name));
  }
  if (overdueSupplierObligations.length > 1) {
    const names = overdueSupplierObligations.sort();
    add("supplier_performance_risk", "Contract", name, [names], { title: "Repeated supplier obligations missed", message: `${names.length} distinct supplier obligations are overdue. Procurement must assess corrective action and supplier performance risk.`, severity: "critical", escalation: true, supplier_performance_risk: true, related_names: names });
  }

  const end = calendarDate(contract.end_date, "Contract end date");
  if (end && !["Expired", "Terminated"].includes(status)) {
    const daysUntilEnd = end.day - today.day;
    const notice = configuredDays(contract.custom_renewal_notice_days, "Renewal notice");
    if (daysUntilEnd <= 0) {
      add(daysUntilEnd === 0 ? "expiry_due" : "contract_expired", "Contract", name, [end.date], { title: daysUntilEnd === 0 ? "Contract end date reached" : "Contract end date passed", message: `The contract period ends on ${end.date}. Verify executed renewals and review expiry; no lifecycle state has been changed automatically.`, severity: "critical", due_date: end.date });
    } else if (notice > 0 && daysUntilEnd <= notice) {
      add("renewal_notice", "Contract", name, [end.date], { title: "Contract renewal review approaching", message: `The contract ends on ${end.date}, within the configured ${notice}-day notice period.${yes(contract.custom_auto_renewal) ? " Auto renewal is configured; verify the agreed terms and required approvals." : " Review business need, performance, commercial terms and renewal approval."}`, severity: "warning", due_date: end.date });
    }
  }
  if (["Expired", "Terminated"].includes(status)) add("closure_required", "Contract", name, [status, text(contract.end_date)], { title: "Contract closure validation required", message: "Review outstanding obligations, purchase orders, invoices, claims, disputes, warranty, settlement and archived documents before closing the contract.", severity: "warning" });

  for (const milestone of distinctRelated(milestones, name)) {
    if (["Completed", "Cancelled"].includes(text(milestone.status))) continue;
    const due = calendarDate(milestone.planned_date, `Milestone ${milestone.name} planned date`);
    if (!due || due.day > today.day) continue;
    const overdue = due.day < today.day;
    add(overdue ? "milestone_overdue" : "milestone_due", "Contract Milestone", String(milestone.name), [due.date], { title: `${overdue ? "Overdue milestone" : "Milestone due"}: ${text(milestone.milestone_name) || milestone.name}`, message: `Planned completion: ${due.date}. Review progress and supporting evidence.`, severity: overdue && milestone.priority === "Critical" ? "critical" : "warning", due_date: due.date, owner: text(milestone.responsible_person) || undefined });
  }
  for (const risk of distinctRelated(risks, name)) {
    if (["Resolved", "Closed"].includes(text(risk.risk_status)) || risk.mitigation_status === "Closed") continue;
    const due = calendarDate(risk.target_resolution, `Risk ${risk.name} target resolution`);
    const overdue = !!due && due.day < today.day;
    if (!["High", "Critical"].includes(text(risk.risk_level)) && !overdue) continue;
    add("risk_monitoring", "Contract Risk", String(risk.name), [text(risk.risk_level), due?.date, overdue ? "overdue" : "open"], { title: `Contract risk requires monitoring: ${text(risk.risk_title) || risk.name}`, message: `${text(risk.risk_level) || "Unrated"} risk.${overdue ? " The mitigation target date has passed." : " Review the mitigation plan and current exposure."}`, severity: risk.risk_level === "Critical" || overdue ? "critical" : "warning", due_date: due?.date, owner: text(risk.risk_owner) || undefined, escalation: overdue });
  }
  // A later reading of the same metric supersedes a historical breach alert;
  // the complete history stays untouched in the Contract runtime evidence.
  const currentMetrics = new Map<string, ClmSla>();
  for (const measurement of data.sla) {
    if (!measurement || !text(measurement.metric) || !["gte", "lte"].includes(measurement.operator) || ![measurement.target, measurement.actual].every(value => typeof value === "number" && Number.isFinite(value))) throw new ClmError("Saved Contract SLA data is invalid. Review its monitoring evidence.", 409);
    const key = text(measurement.metric).toLowerCase();
    const prior = currentMetrics.get(key);
    if (!prior || text(measurement.at) >= text(prior.at)) currentMetrics.set(key, measurement);
  }
  for (const measurement of currentMetrics.values()) {
    const breached = measurement.operator === "gte" ? measurement.actual < measurement.target : measurement.actual > measurement.target;
    if (!breached) continue;
    add("sla_breach", "Contract", name, [measurement.id, measurement.at, measurement.metric, measurement.target, measurement.actual, measurement.operator], { title: `Contract SLA breach: ${measurement.metric}`, message: `Actual ${measurement.actual}; contractual target ${measurement.operator === "gte" ? "at least" : "at most"} ${measurement.target}. Review corrective action and supplier notification.`, severity: "critical", escalation: true });
  }
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") || a.id.localeCompare(b.id));
}

export interface ClmNotificationLog {
  name: string;
  subject: string;
  for_user: string;
  type: "Alert";
  document_type: "Contract";
  document_name: string;
  email_content: string;
  link: string;
}
export interface ClmAlertNotificationDeps {
  recipientsFor(alert: ClmAlert): Promise<string[]>;
  /** Recheck current access; ownership or a matching role name alone is insufficient. */
  canReceive(user: string, alert: ClmAlert): Promise<boolean>;
  /**
   * Persist a native Notification Log under this stable key, or return `existing`.
   * Consult persisted logs so deduplication survives process restarts. Where the
   * ERP adapter offers only query-then-create, simultaneous runners can still
   * race; callers must describe that limit rather than claim atomic delivery.
   */
  putNotificationIfAbsent(key: string, document: ClmNotificationLog): Promise<"created" | "existing">;
}
const html = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Optional delivery adapter: callers authorize monitoring and supply durable native-log storage. */
export async function dispatchClmAlerts(alerts: ClmAlert[], deps: ClmAlertNotificationDeps): Promise<{ created: number; existing: number; denied: number }> {
  const result = { created: 0, existing: 0, denied: 0 };
  const dispatched = new Set<string>();
  for (const alert of alerts) for (const recipient of [...new Set((await deps.recipientsFor(alert)).map(text).filter(Boolean))]) {
    const key = `clm-notice-${hash([alert.id, recipient.toLowerCase()]).slice(0, 48)}`;
    if (dispatched.has(key)) continue;
    dispatched.add(key);
    if (!await deps.canReceive(recipient, alert)) { result.denied++; continue; }
    const document: ClmNotificationLog = { name: key, subject: `[${alert.id}] ${alert.title}`, for_user: recipient, type: "Alert", document_type: "Contract", document_name: alert.contract, email_content: `<p>${html(alert.message)}</p>`, link: `/contracts/${encodeURIComponent(alert.contract)}` };
    const outcome = await deps.putNotificationIfAbsent(key, document);
    if (outcome !== "created" && outcome !== "existing") throw new ClmError("Contract alert delivery could not be confirmed.", 502);
    result[outcome]++;
  }
  return result;
}
