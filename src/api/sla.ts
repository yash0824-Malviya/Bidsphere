/**
 * Enterprise SLA engine.
 *
 * All SLA rules are stored in the admin-managed "SLA Configuration" DocType and
 * every running timer in "SLA Timer" (with backend start_time/due_time, so
 * countdowns survive refresh and server restart). Nothing is hardcoded.
 *
 * The engine is intentionally resilient: if the DocTypes have not been
 * provisioned yet (`node scripts/setup-sla-module.mjs`), reads return empty and
 * writes no-op — the rest of the app keeps working.
 */
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  withSilent,
} from "./erpnext";
import { createNotification } from "./notifications";
import type { AppRole } from "../config/roles";
import type { NotificationTargetRole } from "../types/notification";
import { formatERPNextDatetime } from "../utils/erpNextDate";
import {
  unitToMinutes,
  type SlaPriority,
  type SlaTimeUnit,
  type SlaWorkflow,
} from "../config/slaWorkflows";

const CONFIG_DOCTYPE = "SLA Configuration";
const TIMER_DOCTYPE = "SLA Timer";
const AUDIT_DOCTYPE = "SLA Audit Log";

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface SlaConfiguration {
  name: string;
  sla_name: string;
  workflow: SlaWorkflow | string;
  stage?: string;
  role?: string;
  priority?: SlaPriority | string;
  duration: number;
  time_unit: SlaTimeUnit | string;
  reminder_before?: number;
  reminder_unit?: SlaTimeUnit | string;
  escalation_role?: string;
  enabled?: 0 | 1;
}

export type SlaTimerStatus =
  | "Running"
  | "Due Soon"
  | "Breached"
  | "Completed"
  | "Cancelled";

export interface SlaTimer {
  name: string;
  sla_configuration?: string;
  sla_name?: string;
  workflow: string;
  stage?: string;
  reference_doctype: string;
  reference_name: string;
  role?: string;
  priority?: string;
  assigned_to?: string;
  department?: string;
  start_time?: string;
  due_time?: string;
  reminder_at?: string;
  completed_time?: string;
  duration_minutes?: number;
  resolution_minutes?: number;
  sla_status: SlaTimerStatus;
  escalation_role?: string;
  reminder_sent?: 0 | 1;
  breach_notified?: 0 | 1;
  escalated?: 0 | 1;
  modified?: string;
}

export type SlaAuditEventType =
  | "Started"
  | "Reminder Sent"
  | "Breached"
  | "Escalated"
  | "Completed"
  | "Cancelled";

export interface SlaAuditLog {
  name: string;
  sla_timer?: string;
  reference_doctype?: string;
  reference_name?: string;
  workflow?: string;
  stage?: string;
  event: SlaAuditEventType;
  event_time?: string;
  actor?: string;
  details?: string;
}

export type SlaPhase =
  | "on_track"
  | "due_soon"
  | "breached"
  | "completed"
  | "cancelled";

export interface SlaComputed {
  phase: SlaPhase;
  status: SlaTimerStatus;
  dueMs: number | null;
  remainingMs: number;
  overdueMs: number;
  pctElapsed: number;
}

const TIMER_FIELDS = [
  "name",
  "sla_configuration",
  "sla_name",
  "workflow",
  "stage",
  "reference_doctype",
  "reference_name",
  "role",
  "priority",
  "assigned_to",
  "department",
  "start_time",
  "due_time",
  "reminder_at",
  "completed_time",
  "duration_minutes",
  "resolution_minutes",
  "sla_status",
  "escalation_role",
  "reminder_sent",
  "breach_notified",
  "escalated",
  "modified",
];

const CONFIG_FIELDS = [
  "name",
  "sla_name",
  "workflow",
  "stage",
  "role",
  "priority",
  "duration",
  "time_unit",
  "reminder_before",
  "reminder_unit",
  "escalation_role",
  "enabled",
];

/* ── Time helpers ──────────────────────────────────────────────────────── */

/** Parse an ERPNext datetime ("YYYY-MM-DD HH:mm:ss") to epoch ms. */
export function parseSlaTime(value?: string | null): number | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toErp(ms: number): string {
  return formatERPNextDatetime(new Date(ms)) ?? "";
}

/* ── SLA Configuration CRUD ────────────────────────────────────────────── */

export async function listSlaConfigurations(): Promise<SlaConfiguration[]> {
  try {
    return await apiGet<SlaConfiguration[]>(
      buildResourceUrl(CONFIG_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: CONFIG_FIELDS,
          order_by: "sla_name asc",
          limit_page_length: 0,
        })
      )
    );
  } catch {
    return [];
  }
}

export async function createSlaConfiguration(
  input: Omit<SlaConfiguration, "name">
): Promise<SlaConfiguration> {
  return apiPost<SlaConfiguration>(buildResourceUrl(CONFIG_DOCTYPE), input);
}

export async function updateSlaConfiguration(
  name: string,
  patch: Partial<SlaConfiguration>
): Promise<SlaConfiguration> {
  return apiPut<SlaConfiguration>(buildResourceUrl(CONFIG_DOCTYPE, name), patch);
}

export async function setSlaConfigurationEnabled(
  name: string,
  enabled: boolean
): Promise<SlaConfiguration> {
  return updateSlaConfiguration(name, { enabled: enabled ? 1 : 0 });
}

export async function deleteSlaConfiguration(name: string): Promise<void> {
  await apiDelete(buildResourceUrl(CONFIG_DOCTYPE, name));
}

export function configDurationMinutes(cfg: SlaConfiguration): number {
  return unitToMinutes(
    cfg.duration ?? 0,
    (cfg.time_unit as SlaTimeUnit) ?? "Hours"
  );
}

export function configReminderMinutes(cfg: SlaConfiguration): number {
  return unitToMinutes(
    cfg.reminder_before ?? 0,
    (cfg.reminder_unit as SlaTimeUnit) ?? "Minutes"
  );
}

/**
 * Choose the best active configuration for a workflow. An exact priority match
 * wins over an "All"-priority rule; a rule that targets a *different* explicit
 * priority is never used. A matching role is a tiebreaker.
 */
export function resolveSlaConfig(
  configs: SlaConfiguration[],
  workflow: string,
  opts?: { priority?: string; role?: string }
): SlaConfiguration | null {
  const active = configs.filter(
    (c) => (c.enabled ?? 1) === 1 && String(c.workflow) === workflow
  );
  if (active.length === 0) return null;

  const priority = opts?.priority?.trim().toLowerCase();
  const role = opts?.role?.trim().toLowerCase();

  const scored = active
    .map((c) => {
      let score = 0;
      const cPriority = (c.priority ?? "All").trim().toLowerCase();
      if (priority && cPriority && cPriority !== "all") {
        if (cPriority === priority) score += 3;
        else score = -100; // explicit mismatch — disqualify
      }
      if (role && c.role && c.role.trim().toLowerCase() === role) score += 1;
      return { c, score };
    })
    .filter((s) => s.score > -100)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.c ?? null;
}

/* ── Audit log ─────────────────────────────────────────────────────────── */

async function logSlaEvent(opts: {
  timer: Pick<
    SlaTimer,
    "name" | "reference_doctype" | "reference_name" | "workflow" | "stage"
  >;
  event: SlaAuditEventType;
  actor?: string;
  details?: string;
}): Promise<void> {
  try {
    await apiPost(buildResourceUrl(AUDIT_DOCTYPE), {
      sla_timer: opts.timer.name,
      reference_doctype: opts.timer.reference_doctype,
      reference_name: opts.timer.reference_name,
      workflow: opts.timer.workflow,
      stage: opts.timer.stage,
      event: opts.event,
      event_time: toErp(Date.now()),
      actor: opts.actor ?? "",
      details: opts.details ?? "",
    });
  } catch {
    /* audit is best-effort */
  }
}

export async function listSlaAuditLog(
  referenceDoctype: string,
  referenceName: string
): Promise<SlaAuditLog[]> {
  try {
    return await apiGet<SlaAuditLog[]>(
      buildResourceUrl(AUDIT_DOCTYPE),
      withSilent(
        buildListConfig({
          filters: [
            ["reference_doctype", "=", referenceDoctype],
            ["reference_name", "=", referenceName],
          ],
          fields: [
            "name",
            "sla_timer",
            "reference_doctype",
            "reference_name",
            "workflow",
            "stage",
            "event",
            "event_time",
            "actor",
            "details",
          ],
          order_by: "event_time desc",
          limit_page_length: 0,
        })
      )
    );
  } catch {
    return [];
  }
}

/* ── Notifications ─────────────────────────────────────────────────────── */

const APP_ROLE_SET = new Set<AppRole>([
  "admin",
  "procurement",
  "finance",
  "finance_executive",
  "warehouse",
  "legal",
  "department",
]);

function toTargetRole(role?: string): NotificationTargetRole {
  const r = (role ?? "").trim().toLowerCase();
  if (APP_ROLE_SET.has(r as AppRole)) return r as AppRole;
  if (r === "supplier") return "supplier";
  return "admin";
}

function slaRouteFor(timer: SlaTimer): string {
  const enc = encodeURIComponent(timer.reference_name);
  switch (timer.reference_doctype) {
    case "Material Request":
      return `/material-requests/${enc}`;
    case "Reverse Bidding":
      return `/sourcing/reverse-bidding/${enc}`;
    default:
      return "/admin/sla-reports";
  }
}

function notifySla(opts: {
  role?: string;
  title: string;
  description: string;
  timer: SlaTimer;
  eventType: string;
}): void {
  try {
    createNotification({
      title: opts.title,
      description: opts.description,
      module: "SLA",
      event_type: opts.eventType,
      target_role: toTargetRole(opts.role),
      document_type: opts.timer.reference_doctype,
      document_name: opts.timer.reference_name,
      route_path: slaRouteFor(opts.timer),
      email_sent: false,
    });
  } catch {
    /* ignore */
  }
}

/* ── Timer reads ───────────────────────────────────────────────────────── */

export async function listTimersForReference(
  referenceDoctype: string,
  referenceName: string
): Promise<SlaTimer[]> {
  try {
    return await apiGet<SlaTimer[]>(
      buildResourceUrl(TIMER_DOCTYPE),
      withSilent(
        buildListConfig({
          filters: [
            ["reference_doctype", "=", referenceDoctype],
            ["reference_name", "=", referenceName],
          ],
          fields: TIMER_FIELDS,
          order_by: "creation desc",
          limit_page_length: 0,
        })
      )
    );
  } catch {
    return [];
  }
}

/** Open (not completed/cancelled) timers for a role — powers dashboards. */
export async function listTimersForRole(role: string): Promise<SlaTimer[]> {
  try {
    return await apiGet<SlaTimer[]>(
      buildResourceUrl(TIMER_DOCTYPE),
      withSilent(
        buildListConfig({
          filters: [
            ["role", "=", role],
            ["sla_status", "in", ["Running", "Due Soon", "Breached"]],
          ],
          fields: TIMER_FIELDS,
          order_by: "due_time asc",
          limit_page_length: 0,
        })
      )
    );
  } catch {
    return [];
  }
}

export async function listAllTimers(): Promise<SlaTimer[]> {
  try {
    return await apiGet<SlaTimer[]>(
      buildResourceUrl(TIMER_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: TIMER_FIELDS,
          order_by: "creation desc",
          limit_page_length: 0,
        })
      )
    );
  } catch {
    return [];
  }
}

/* ── Derivations ───────────────────────────────────────────────────────── */

export function deriveTimerStatus(
  t: SlaTimer,
  now: number = Date.now()
): SlaTimerStatus {
  if (t.sla_status === "Completed" || t.sla_status === "Cancelled") {
    return t.sla_status;
  }
  const due = parseSlaTime(t.due_time);
  if (due == null) return "Running";
  if (now >= due) return "Breached";
  const reminderAt = parseSlaTime(t.reminder_at);
  if (reminderAt != null && now >= reminderAt) return "Due Soon";
  return "Running";
}

export function computeSla(t: SlaTimer, now: number = Date.now()): SlaComputed {
  const status = deriveTimerStatus(t, now);
  const due = parseSlaTime(t.due_time);
  const start = parseSlaTime(t.start_time);
  const rawRemaining = due != null ? due - now : 0;
  const overdueMs = rawRemaining < 0 ? -rawRemaining : 0;
  let pctElapsed = 0;
  if (due != null && start != null && due > start) {
    pctElapsed = Math.min(100, Math.max(0, ((now - start) / (due - start)) * 100));
  }
  const phase: SlaPhase =
    status === "Completed"
      ? "completed"
      : status === "Cancelled"
        ? "cancelled"
        : status === "Breached"
          ? "breached"
          : status === "Due Soon"
            ? "due_soon"
            : "on_track";
  return {
    phase,
    status,
    dueMs: due,
    remainingMs: Math.max(0, rawRemaining),
    overdueMs,
    pctElapsed,
  };
}

/* ── Timer lifecycle ───────────────────────────────────────────────────── */

export interface EnsureSlaInput {
  workflow: SlaWorkflow | string;
  stage?: string;
  referenceDoctype: string;
  referenceName: string;
  role?: string;
  priority?: string;
  assignedTo?: string;
  department?: string;
  /** Override start (epoch ms). Defaults to now. */
  startTime?: number;
  /** Explicit due time (epoch ms) — used when the document has its own deadline
   *  (e.g. a reverse auction end). Overrides the config duration. */
  dueTime?: number;
  actor?: string;
  /** Preloaded active configs to avoid a round-trip when ensuring many timers. */
  configs?: SlaConfiguration[];
}

/**
 * Ensure a running timer exists for (document, workflow stage). Idempotent: if a
 * running/due-soon timer already exists it is returned; if the stage was already
 * completed/cancelled it is left untouched. Returns null when no active config
 * matches and no explicit due time was supplied.
 */
export async function ensureSlaTimer(
  input: EnsureSlaInput
): Promise<SlaTimer | null> {
  try {
    const stage = input.stage ?? String(input.workflow);
    const existing = await listTimersForReference(
      input.referenceDoctype,
      input.referenceName
    );
    const sameStage = existing.filter(
      (t) => String(t.workflow) === String(input.workflow) && (t.stage ?? "") === stage
    );
    const open = sameStage.find(
      (t) => t.sla_status === "Running" || t.sla_status === "Due Soon"
    );
    if (open) return open;
    const settled = sameStage.find(
      (t) => t.sla_status === "Completed" || t.sla_status === "Cancelled"
    );
    if (settled) return settled;

    const configs = input.configs ?? (await listSlaConfigurations());
    const cfg = resolveSlaConfig(configs, String(input.workflow), {
      priority: input.priority,
      role: input.role,
    });

    const startMs = input.startTime ?? Date.now();
    let dueMs: number | null = null;
    let durationMin = 0;
    if (input.dueTime != null) {
      dueMs = input.dueTime;
      durationMin = Math.max(0, (dueMs - startMs) / 60_000);
    } else if (cfg) {
      durationMin = configDurationMinutes(cfg);
      if (durationMin > 0) dueMs = startMs + durationMin * 60_000;
    }
    if (dueMs == null) return null; // nothing to track

    const reminderMin = cfg ? configReminderMinutes(cfg) : 0;
    const reminderMs = reminderMin > 0 ? dueMs - reminderMin * 60_000 : null;

    const payload: Partial<SlaTimer> = {
      sla_configuration: cfg?.name ?? "",
      sla_name: cfg?.sla_name ?? String(input.workflow),
      workflow: String(input.workflow),
      stage,
      reference_doctype: input.referenceDoctype,
      reference_name: input.referenceName,
      role: input.role ?? cfg?.role ?? "",
      priority: input.priority ?? "",
      assigned_to: input.assignedTo ?? "",
      department: input.department ?? "",
      start_time: toErp(startMs),
      due_time: toErp(dueMs),
      reminder_at: reminderMs != null ? toErp(reminderMs) : "",
      duration_minutes: Number(durationMin.toFixed(2)),
      sla_status: "Running",
      escalation_role: cfg?.escalation_role ?? "",
      reminder_sent: 0,
      breach_notified: 0,
      escalated: 0,
    };

    const created = await apiPost<SlaTimer>(
      buildResourceUrl(TIMER_DOCTYPE),
      payload
    );
    await logSlaEvent({
      timer: created,
      event: "Started",
      actor: input.actor,
      details: `SLA started for ${input.workflow} (${Math.round(durationMin)} min).`,
    });
    return created;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[SLA] ensureSlaTimer failed:", err);
    return null;
  }
}

async function settleTimer(
  t: SlaTimer,
  status: "Completed" | "Cancelled",
  actor?: string,
  details?: string
): Promise<void> {
  const now = Date.now();
  const startMs = parseSlaTime(t.start_time);
  const resolution =
    startMs != null ? Number(Math.max(0, (now - startMs) / 60_000).toFixed(2)) : undefined;
  await apiPut(buildResourceUrl(TIMER_DOCTYPE, t.name), {
    sla_status: status,
    completed_time: toErp(now),
    resolution_minutes: resolution,
  });
  await logSlaEvent({
    timer: t,
    event: status,
    actor,
    details: details ?? `${status} via workflow transition.`,
  });
}

/** Mark open timers for a reference (optionally a specific workflow/stage) complete. */
export async function completeSlaTimer(
  referenceDoctype: string,
  referenceName: string,
  opts?: { workflow?: string; stage?: string; actor?: string }
): Promise<void> {
  try {
    const timers = await listTimersForReference(referenceDoctype, referenceName);
    for (const t of timers) {
      if (t.sla_status === "Completed" || t.sla_status === "Cancelled") continue;
      if (opts?.workflow && String(t.workflow) !== String(opts.workflow)) continue;
      if (opts?.stage && (t.stage ?? "") !== opts.stage) continue;
      await settleTimer(t, "Completed", opts?.actor);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[SLA] completeSlaTimer failed:", err);
  }
}

export async function cancelSlaTimer(
  referenceDoctype: string,
  referenceName: string,
  opts?: { workflow?: string; actor?: string }
): Promise<void> {
  try {
    const timers = await listTimersForReference(referenceDoctype, referenceName);
    for (const t of timers) {
      if (t.sla_status === "Completed" || t.sla_status === "Cancelled") continue;
      if (opts?.workflow && String(t.workflow) !== String(opts.workflow)) continue;
      await settleTimer(t, "Cancelled", opts?.actor, "Cancelled via workflow transition.");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[SLA] cancelSlaTimer failed:", err);
  }
}

/* ── Background evaluation (reminders / breach / escalation) ───────────── */

/**
 * Evaluate every open timer against the clock. Sends reminders when the
 * reminder window opens, marks breaches, escalates to the configured role, and
 * writes audit entries. Persists status transitions so timers survive restarts.
 * Safe to call on an interval — only mutates when a threshold is crossed.
 */
export async function evaluateSlaTimers(): Promise<{
  evaluated: number;
  reminders: number;
  breaches: number;
}> {
  let evaluated = 0;
  let reminders = 0;
  let breaches = 0;
  try {
    const timers = await apiGet<SlaTimer[]>(
      buildResourceUrl(TIMER_DOCTYPE),
      withSilent(
        buildListConfig({
          filters: [["sla_status", "in", ["Running", "Due Soon"]]],
          fields: TIMER_FIELDS,
          order_by: "due_time asc",
          limit_page_length: 0,
        })
      )
    );
    const now = Date.now();
    for (const t of timers) {
      evaluated++;
      const status = deriveTimerStatus(t, now);

      if (status === "Breached" && !t.breach_notified) {
        await apiPut(buildResourceUrl(TIMER_DOCTYPE, t.name), {
          sla_status: "Breached",
          breach_notified: 1,
          escalated: t.escalation_role ? 1 : t.escalated ?? 0,
        });
        await logSlaEvent({
          timer: t,
          event: "Breached",
          details: `SLA breached — due ${t.due_time}.`,
        });
        notifySla({
          role: t.role,
          timer: t,
          eventType: "sla_breached",
          title: `SLA breached · ${t.workflow}`,
          description: `${t.reference_name} exceeded its ${t.workflow} SLA and is now overdue.`,
        });
        if (t.escalation_role) {
          await logSlaEvent({
            timer: t,
            event: "Escalated",
            details: `Escalated to ${t.escalation_role}.`,
          });
          notifySla({
            role: t.escalation_role,
            timer: t,
            eventType: "sla_escalated",
            title: `SLA escalation · ${t.workflow}`,
            description: `${t.reference_name} breached SLA and was escalated to ${t.escalation_role}.`,
          });
        }
        breaches++;
      } else if (status === "Due Soon" && !t.reminder_sent) {
        await apiPut(buildResourceUrl(TIMER_DOCTYPE, t.name), {
          sla_status: "Due Soon",
          reminder_sent: 1,
        });
        const remainMin = Math.max(
          0,
          Math.round(((parseSlaTime(t.due_time) ?? now) - now) / 60_000)
        );
        await logSlaEvent({
          timer: t,
          event: "Reminder Sent",
          details: `Reminder — ~${remainMin} min to due.`,
        });
        notifySla({
          role: t.role,
          timer: t,
          eventType: "sla_reminder",
          title: `SLA due soon · ${t.workflow}`,
          description: `${t.reference_name} is due in about ${remainMin} minutes.`,
        });
        reminders++;
      } else if (status === "Due Soon" && t.sla_status === "Running") {
        // Reminder already sent previously — just persist the phase.
        await apiPut(buildResourceUrl(TIMER_DOCTYPE, t.name), {
          sla_status: "Due Soon",
        });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[SLA] evaluateSlaTimers failed:", err);
  }
  return { evaluated, reminders, breaches };
}

/* ── Reports ───────────────────────────────────────────────────────────── */

export interface SlaReportBreakdownRow {
  key: string;
  total: number;
  onTime: number;
  breached: number;
  avgResolutionMinutes: number;
  compliancePct: number;
}

export interface SlaReport {
  total: number;
  running: number;
  dueSoon: number;
  completed: number;
  breached: number;
  cancelled: number;
  completedOnTime: number;
  avgResolutionMinutes: number;
  compliancePct: number;
  byWorkflow: SlaReportBreakdownRow[];
  byDepartment: SlaReportBreakdownRow[];
  byRole: SlaReportBreakdownRow[];
  byUser: SlaReportBreakdownRow[];
}

/** True if a timer breached (explicit status, or finished after its due time). */
function timerBreached(t: SlaTimer): boolean {
  if (deriveTimerStatus(t) === "Breached") return true;
  if (t.sla_status === "Completed") {
    const due = parseSlaTime(t.due_time);
    const done = parseSlaTime(t.completed_time);
    if (due != null && done != null && done > due) return true;
  }
  return false;
}

function timerOnTime(t: SlaTimer): boolean {
  if (t.sla_status !== "Completed") return false;
  return !timerBreached(t);
}

function aggregate(
  timers: SlaTimer[],
  keyFn: (t: SlaTimer) => string
): SlaReportBreakdownRow[] {
  const map = new Map<string, SlaTimer[]>();
  for (const t of timers) {
    const key = keyFn(t) || "—";
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  const rows: SlaReportBreakdownRow[] = [];
  for (const [key, list] of map) {
    const onTime = list.filter(timerOnTime).length;
    const breached = list.filter(timerBreached).length;
    const resolutions = list
      .filter((t) => t.sla_status === "Completed")
      .map((t) => t.resolution_minutes ?? 0)
      .filter((m) => m > 0);
    const avg =
      resolutions.length > 0
        ? resolutions.reduce((a, b) => a + b, 0) / resolutions.length
        : 0;
    const resolved = onTime + breached;
    rows.push({
      key,
      total: list.length,
      onTime,
      breached,
      avgResolutionMinutes: Number(avg.toFixed(1)),
      compliancePct: resolved > 0 ? Number(((onTime / resolved) * 100).toFixed(1)) : 0,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

export async function fetchSlaReport(): Promise<SlaReport> {
  const timers = await listAllTimers();
  const now = Date.now();
  const running = timers.filter((t) => deriveTimerStatus(t, now) === "Running").length;
  const dueSoon = timers.filter((t) => deriveTimerStatus(t, now) === "Due Soon").length;
  const completed = timers.filter((t) => t.sla_status === "Completed").length;
  const cancelled = timers.filter((t) => t.sla_status === "Cancelled").length;
  const breached = timers.filter(timerBreached).length;
  const completedOnTime = timers.filter(timerOnTime).length;

  const resolutions = timers
    .filter((t) => t.sla_status === "Completed")
    .map((t) => t.resolution_minutes ?? 0)
    .filter((m) => m > 0);
  const avgResolutionMinutes =
    resolutions.length > 0
      ? Number((resolutions.reduce((a, b) => a + b, 0) / resolutions.length).toFixed(1))
      : 0;

  const resolved = completedOnTime + breached;
  const compliancePct =
    resolved > 0 ? Number(((completedOnTime / resolved) * 100).toFixed(1)) : 0;

  return {
    total: timers.length,
    running,
    dueSoon,
    completed,
    breached,
    cancelled,
    completedOnTime,
    avgResolutionMinutes,
    compliancePct,
    byWorkflow: aggregate(timers, (t) => String(t.workflow)),
    byDepartment: aggregate(timers, (t) => t.department ?? "—"),
    byRole: aggregate(timers, (t) => t.role ?? "—"),
    byUser: aggregate(timers, (t) => t.assigned_to ?? "—"),
  };
}
