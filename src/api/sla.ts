/**
 * Enterprise SLA engine.
 *
 * Integrates with the three admin-provisioned ERPNext DocTypes — nothing is
 * recreated here:
 *
 *   • "SLA Configuration"      — master rules (durations, reminders, roles).
 *   • "SLA Log"                — one running log per (document, workflow stage).
 *   • "SLA Escalation History" — an entry per breach escalation.
 *
 * All durations/reminders/roles come from SLA Configuration at runtime (nothing
 * hardcoded). The engine is resilient: if the DocTypes are missing or a request
 * fails, reads return empty and writes no-op so the rest of the app keeps
 * working.
 *
 * ── Field-name notes (the live ERPNext schema has a couple of quirks) ─────────
 *   • SLA Configuration stores "Active" in the mis-spelled field `acive`.
 *   • SLA Log uses `reference_document` (not reference_name), `assigned_role`
 *     and `status`. Its Status select only allows Running/Completed/Breached/
 *     Cancelled — there is NO "Warning" value, so the "Warning / Due Soon" phase
 *     is derived client-side from the reminder window and never written back.
 *   • SLA Escalation History stores "Escalated From" in `escalated_form`.
 *
 * To keep every consumer component stable, ERPNext rows are normalised into a
 * single `SlaTimer` shape on read and denormalised on write.
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
import { ERPNEXT_ROLE_MAP, type AppRole } from "../config/roles";
import type { NotificationTargetRole } from "../types/notification";
import { formatERPNextDatetime } from "../utils/erpNextDate";
import { useAuthStore } from "../store/authStore";
import {
  unitToMinutes,
  SLA_WORKFLOW_DEFAULT_ROLE,
  type SlaPriority,
  type SlaTimeUnit,
  type SlaWorkflow,
} from "../config/slaWorkflows";

const CONFIG_DOCTYPE = "SLA Configuration";
const LOG_DOCTYPE = "SLA Log";
const ESCALATION_DOCTYPE = "SLA Escalation History";

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface SlaConfiguration {
  name: string;
  sla_name: string;
  workflow: SlaWorkflow | string;
  stage?: string;
  /** ERPNext Role name (Link → Role) responsible for the stage. */
  role?: string;
  priority?: SlaPriority | string;
  duration: number;
  time_unit: SlaTimeUnit | string;
  reminder_before?: number;
  reminder_unit?: SlaTimeUnit | string;
  /** ERPNext Role name (Link → Role) to escalate to on breach. */
  escalation_role?: string;
  description?: string;
  /**
   * Active flag. The live DocType field is mis-spelled `acive`; we expose it as
   * `enabled` everywhere in the app and translate on read/write.
   */
  enabled?: 0 | 1;
}

export type SlaTimerStatus =
  | "Running"
  | "Due Soon"
  | "Breached"
  | "Completed"
  | "Cancelled";

/**
 * Normalised, in-memory representation of an "SLA Log" row. Field names are
 * kept from the previous engine so all UI consumers keep working; `reminder_at`,
 * `priority`, `escalation_role`, `duration_minutes` and `resolution_minutes` are
 * derived from the linked SLA Configuration / timestamps (not stored on the log).
 */
export interface SlaTimer {
  name: string;
  sla_configuration?: string;
  sla_name?: string;
  workflow: string;
  stage?: string;
  reference_doctype: string;
  reference_name: string;
  /** ERPNext Role name assigned to this stage. */
  role?: string;
  priority?: string;
  assigned_to?: string;
  department?: string;
  start_time?: string;
  due_time?: string;
  reminder_at?: string;
  completed_time?: string;
  completed_by?: string;
  duration_minutes?: number;
  resolution_minutes?: number;
  remaining_minutes?: number;
  sla_status: SlaTimerStatus;
  escalation_role?: string;
  escalated?: 0 | 1;
  modified?: string;
}

export interface SlaEscalationEntry {
  name: string;
  sla_log?: string;
  escalated_from?: string;
  escalated_to?: string;
  escalation_time?: string;
  escalation_level?: number;
  reason?: string;
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

/* ── ERPNext field lists ───────────────────────────────────────────────── */

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
  "acive",
  "description",
];

const LOG_FIELDS = [
  "name",
  "sla_configuration",
  "reference_doctype",
  "reference_document",
  "workflow",
  "stage",
  "assigned_role",
  "start_time",
  "due_time",
  "completed_time",
  "completed_by",
  "status",
  "remaining_minutes",
  "escalated",
  "modified",
  "creation",
];

const ESCALATION_FIELDS = [
  "name",
  "sla_log",
  "escalated_form",
  "escalated_to",
  "escalation_time",
  "escalation_level",
  "reason",
];

/** Raw shape of an "SLA Log" row as returned by ERPNext. */
interface RawSlaLog {
  name: string;
  sla_configuration?: string;
  reference_doctype?: string;
  reference_document?: string;
  workflow?: string;
  stage?: string;
  assigned_role?: string;
  start_time?: string;
  due_time?: string;
  completed_time?: string;
  completed_by?: string;
  status?: string;
  remaining_minutes?: number;
  escalated?: 0 | 1;
  modified?: string;
}

interface RawSlaConfig {
  name: string;
  sla_name?: string;
  workflow?: string;
  stage?: string;
  role?: string;
  priority?: string;
  duration?: number;
  time_unit?: string;
  reminder_before?: number;
  reminder_unit?: string;
  escalation_role?: string;
  acive?: 0 | 1;
  description?: string;
}

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

function currentUserEmail(): string {
  try {
    return useAuthStore.getState().user?.email ?? "";
  } catch {
    return "";
  }
}

/* ── SLA Configuration CRUD ────────────────────────────────────────────── */

function normalizeConfig(row: RawSlaConfig): SlaConfiguration {
  return {
    name: row.name,
    sla_name: row.sla_name ?? row.name,
    workflow: row.workflow ?? "",
    stage: row.stage ?? "",
    role: row.role ?? "",
    priority: row.priority ?? "All",
    duration: Number(row.duration ?? 0),
    time_unit: row.time_unit ?? "Hours",
    reminder_before: Number(row.reminder_before ?? 0),
    reminder_unit: row.reminder_unit ?? "Minutes",
    escalation_role: row.escalation_role ?? "",
    description: row.description ?? "",
    enabled: (row.acive ?? 0) === 1 ? 1 : 0,
  };
}

/** Translate the app-facing config shape to the live DocType (enabled → acive). */
function configToErp(input: Partial<SlaConfiguration>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const copy = (k: keyof SlaConfiguration) => {
    if (input[k] !== undefined) out[k] = input[k];
  };
  copy("sla_name");
  copy("workflow");
  copy("stage");
  copy("role");
  copy("priority");
  copy("duration");
  copy("time_unit");
  copy("reminder_before");
  copy("reminder_unit");
  copy("escalation_role");
  copy("description");
  if (input.enabled !== undefined) out.acive = input.enabled ? 1 : 0;
  return out;
}

export async function listSlaConfigurations(): Promise<SlaConfiguration[]> {
  try {
    const rows = await apiGet<RawSlaConfig[]>(
      buildResourceUrl(CONFIG_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: CONFIG_FIELDS,
          order_by: "sla_name asc",
          limit_page_length: 0,
        })
      )
    );
    return (rows ?? []).map(normalizeConfig);
  } catch {
    return [];
  }
}

/** Active configurations only (Step 1 — only Active rules are used). */
export async function listActiveSlaConfigurations(): Promise<SlaConfiguration[]> {
  const all = await listSlaConfigurations();
  return all.filter((c) => (c.enabled ?? 0) === 1);
}

export async function createSlaConfiguration(
  input: Omit<SlaConfiguration, "name">
): Promise<SlaConfiguration> {
  const created = await apiPost<RawSlaConfig>(
    buildResourceUrl(CONFIG_DOCTYPE),
    configToErp(input)
  );
  return normalizeConfig(created);
}

export async function updateSlaConfiguration(
  name: string,
  patch: Partial<SlaConfiguration>
): Promise<SlaConfiguration> {
  const updated = await apiPut<RawSlaConfig>(
    buildResourceUrl(CONFIG_DOCTYPE, name),
    configToErp(patch)
  );
  return normalizeConfig(updated);
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

/**
 * Live list of enabled ERPNext Role names. Used to populate the Responsible /
 * Escalation Role selects — those DocType fields are Link → Role, so only valid
 * role names may be stored.
 */
export async function listErpRoles(): Promise<string[]> {
  try {
    const rows = await apiGet<Array<{ name: string }>>(
      buildResourceUrl("Role"),
      withSilent(
        buildListConfig({
          fields: ["name"],
          filters: [
            ["disabled", "=", 0],
            ["is_custom", "in", [0, 1]],
          ],
          order_by: "name asc",
          limit_page_length: 0,
        })
      )
    );
    return (rows ?? []).map((r) => r.name).filter(Boolean);
  } catch {
    return [];
  }
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
 * Choose the best active configuration for a workflow. Matching is driven by
 * workflow (and optional stage); an exact priority match wins over an "All"
 * rule, and a rule targeting a *different* explicit priority is never used.
 * Role is only a soft tiebreaker (config roles are ERPNext role names, callers
 * pass app roles), so it never disqualifies a workflow match.
 */
export function resolveSlaConfig(
  configs: SlaConfiguration[],
  workflow: string,
  opts?: { priority?: string; role?: string; stage?: string }
): SlaConfiguration | null {
  const active = configs.filter(
    (c) => (c.enabled ?? 0) === 1 && String(c.workflow) === workflow
  );
  if (active.length === 0) return null;

  const priority = opts?.priority?.trim().toLowerCase();
  const stage = opts?.stage?.trim().toLowerCase();

  const scored = active
    .map((c) => {
      let score = 0;
      const cPriority = (c.priority ?? "All").trim().toLowerCase();
      if (priority && cPriority && cPriority !== "all") {
        if (cPriority === priority) score += 3;
        else score = -100; // explicit mismatch — disqualify
      }
      if (stage && c.stage && c.stage.trim().toLowerCase() === stage) score += 2;
      return { c, score };
    })
    .filter((s) => s.score > -100)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.c ?? null;
}

/* ── Config cache (small TTL, avoids refetching on every read) ─────────── */

let configCache: { at: number; map: Map<string, SlaConfiguration> } | null = null;
const CONFIG_CACHE_MS = 30_000;

async function getConfigMap(): Promise<Map<string, SlaConfiguration>> {
  if (configCache && Date.now() - configCache.at < CONFIG_CACHE_MS) {
    return configCache.map;
  }
  const configs = await listSlaConfigurations();
  const map = new Map(configs.map((c) => [c.name, c]));
  configCache = { at: Date.now(), map };
  return map;
}

/* ── Role mapping (ERPNext Role ↔ app role) ────────────────────────────── */

const APP_ROLE_SET = new Set<AppRole>([
  "admin",
  "procurement",
  "procurement_team",
  "finance",
  "finance_executive",
  "warehouse",
  "legal",
  "department",
  "manufacturing",
]);

/** Resolve an ERPNext role name (or app slug) to a BidSphere AppRole. */
function toAppRole(role?: string): AppRole | null {
  const raw = (role ?? "").trim();
  if (!raw) return null;
  if (ERPNEXT_ROLE_MAP[raw]) return ERPNEXT_ROLE_MAP[raw];
  const lower = raw.toLowerCase();
  if (APP_ROLE_SET.has(lower as AppRole)) return lower as AppRole;
  return null;
}

function toTargetRole(role?: string): NotificationTargetRole {
  const app = toAppRole(role);
  if (app) return app;
  if ((role ?? "").trim().toLowerCase() === "supplier") return "supplier";
  return "admin";
}

/* ── Normalisation ─────────────────────────────────────────────────────── */

function normalizeLog(
  row: RawSlaLog,
  configMap: Map<string, SlaConfiguration>
): SlaTimer {
  const cfg = row.sla_configuration ? configMap.get(row.sla_configuration) : undefined;
  const due = parseSlaTime(row.due_time);
  const start = parseSlaTime(row.start_time);
  const completed = parseSlaTime(row.completed_time);

  const reminderMin = cfg ? configReminderMinutes(cfg) : 0;
  const reminderAt =
    due != null && reminderMin > 0 ? toErp(due - reminderMin * 60_000) : "";

  const durationMin =
    due != null && start != null ? Number(((due - start) / 60_000).toFixed(2)) : undefined;
  const resolutionMin =
    completed != null && start != null
      ? Number(Math.max(0, (completed - start) / 60_000).toFixed(2))
      : undefined;

  const status = ((): SlaTimerStatus => {
    const s = (row.status ?? "Running").trim();
    if (s === "Completed" || s === "Cancelled" || s === "Breached") return s;
    return "Running";
  })();

  return {
    name: row.name,
    sla_configuration: row.sla_configuration,
    sla_name: cfg?.sla_name,
    workflow: row.workflow ?? "",
    stage: row.stage ?? "",
    reference_doctype: row.reference_doctype ?? "",
    reference_name: row.reference_document ?? "",
    role: row.assigned_role ?? cfg?.role ?? "",
    priority: cfg?.priority ?? "",
    assigned_to: row.completed_by ?? "",
    department: "",
    start_time: row.start_time,
    due_time: row.due_time,
    reminder_at: reminderAt,
    completed_time: row.completed_time,
    completed_by: row.completed_by,
    duration_minutes: durationMin,
    resolution_minutes: resolutionMin,
    remaining_minutes: row.remaining_minutes,
    sla_status: status,
    escalation_role: cfg?.escalation_role ?? "",
    escalated: row.escalated ?? 0,
    modified: row.modified,
  };
}

/* ── Escalation history ────────────────────────────────────────────────── */

async function createEscalationHistory(opts: {
  timer: SlaTimer;
  from?: string;
  to?: string;
  level?: number;
  reason?: string;
}): Promise<void> {
  try {
    await apiPost(buildResourceUrl(ESCALATION_DOCTYPE), {
      sla_log: opts.timer.name,
      // NOTE: the live DocType field for "Escalated From" is `escalated_form`.
      escalated_form: opts.from ?? "",
      escalated_to: opts.to ?? "",
      escalation_time: toErp(Date.now()),
      escalation_level: opts.level ?? 1,
      reason: opts.reason ?? "",
    });
  } catch {
    /* escalation history is best-effort */
  }
}

export async function listEscalationHistory(
  logName: string
): Promise<SlaEscalationEntry[]> {
  try {
    const rows = await apiGet<
      Array<Record<string, unknown>>
    >(
      buildResourceUrl(ESCALATION_DOCTYPE),
      withSilent(
        buildListConfig({
          filters: [["sla_log", "=", logName]],
          fields: ESCALATION_FIELDS,
          order_by: "escalation_time desc",
          limit_page_length: 0,
        })
      )
    );
    return (rows ?? []).map((r) => ({
      name: String(r.name),
      sla_log: r.sla_log as string | undefined,
      escalated_from: r.escalated_form as string | undefined,
      escalated_to: r.escalated_to as string | undefined,
      escalation_time: r.escalation_time as string | undefined,
      escalation_level: r.escalation_level as number | undefined,
      reason: r.reason as string | undefined,
    }));
  } catch {
    return [];
  }
}

/* ── Notifications ─────────────────────────────────────────────────────── */

function slaRouteFor(timer: SlaTimer): string {
  const enc = encodeURIComponent(timer.reference_name);
  switch (timer.reference_doctype) {
    case "Material Request":
      return `/material-requests/${enc}`;
    case "Reverse Bidding":
      return `/sourcing/reverse-bidding/${enc}`;
    case "Request for Quotation":
      return `/sourcing/rfq/${enc}`;
    case "Purchase Order":
      return `/p2p/purchase-orders/${enc}`;
    default:
      return "/admin/sla-dashboard";
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

/* ── Log reads ─────────────────────────────────────────────────────────── */

export async function listTimersForReference(
  referenceDoctype: string,
  referenceName: string
): Promise<SlaTimer[]> {
  try {
    const [rows, configMap] = await Promise.all([
      apiGet<RawSlaLog[]>(
        buildResourceUrl(LOG_DOCTYPE),
        withSilent(
          buildListConfig({
            filters: [
              ["reference_doctype", "=", referenceDoctype],
              ["reference_document", "=", referenceName],
            ],
            fields: LOG_FIELDS,
            order_by: "creation desc",
            limit_page_length: 0,
          })
        )
      ),
      getConfigMap(),
    ]);
    return (rows ?? []).map((r) => normalizeLog(r, configMap));
  } catch {
    return [];
  }
}

/** Open (Running/Breached) logs for an app role — powers dashboard widgets. */
export async function listTimersForRole(role: string): Promise<SlaTimer[]> {
  const appRole = toAppRole(role) ?? (role as AppRole);
  const all = await listAllOpenTimers();
  return all
    .filter((t) => {
      const assigned = toAppRole(t.role);
      const effective =
        assigned ??
        SLA_WORKFLOW_DEFAULT_ROLE[t.workflow as SlaWorkflow] ??
        null;
      return effective === appRole;
    })
    .sort((a, b) => (parseSlaTime(a.due_time) ?? 0) - (parseSlaTime(b.due_time) ?? 0));
}

/** All currently open (Running/Breached) logs. */
export async function listAllOpenTimers(): Promise<SlaTimer[]> {
  try {
    const [rows, configMap] = await Promise.all([
      apiGet<RawSlaLog[]>(
        buildResourceUrl(LOG_DOCTYPE),
        withSilent(
          buildListConfig({
            filters: [["status", "in", ["Running", "Breached"]]],
            fields: LOG_FIELDS,
            order_by: "due_time asc",
            limit_page_length: 0,
          })
        )
      ),
      getConfigMap(),
    ]);
    return (rows ?? []).map((r) => normalizeLog(r, configMap));
  } catch {
    return [];
  }
}

export async function listAllTimers(): Promise<SlaTimer[]> {
  try {
    const [rows, configMap] = await Promise.all([
      apiGet<RawSlaLog[]>(
        buildResourceUrl(LOG_DOCTYPE),
        withSilent(
          buildListConfig({
            fields: LOG_FIELDS,
            order_by: "creation desc",
            limit_page_length: 0,
          })
        )
      ),
      getConfigMap(),
    ]);
    return (rows ?? []).map((r) => normalizeLog(r, configMap));
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
  if (due == null) return t.sla_status === "Breached" ? "Breached" : "Running";
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

/* ── Log lifecycle ─────────────────────────────────────────────────────── */

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
  /** Preloaded active configs to avoid a round-trip when ensuring many logs. */
  configs?: SlaConfiguration[];
}

/**
 * Ensure a running SLA Log exists for (document, workflow stage). Idempotent
 * (Step 10 — one workflow stage = one SLA Log): if a running log already exists
 * it is returned; if the stage was already completed/cancelled it is left
 * untouched. Returns null when no active config matches and no explicit due time
 * was supplied.
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
      (t) =>
        String(t.workflow) === String(input.workflow) &&
        (t.stage ?? "") === stage
    );
    const open = sameStage.find(
      (t) => t.sla_status === "Running" || t.sla_status === "Breached"
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
      stage: input.stage,
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

    // `assigned_role` and `sla_configuration` are Link fields — only write valid
    // ERPNext values. The responsible role comes from the config (a real Role).
    const payload: Record<string, unknown> = {
      sla_configuration: cfg?.name ?? "",
      reference_doctype: input.referenceDoctype,
      reference_document: input.referenceName,
      workflow: String(input.workflow),
      stage,
      assigned_role: cfg?.role ?? "",
      start_time: toErp(startMs),
      due_time: toErp(dueMs),
      status: "Running",
      remaining_minutes: Math.round(durationMin),
      escalated: 0,
    };

    const created = await apiPost<RawSlaLog>(
      buildResourceUrl(LOG_DOCTYPE),
      payload
    );
    const configMap = new Map(configs.map((c) => [c.name, c]));
    if (cfg) configMap.set(cfg.name, cfg);
    return normalizeLog(created, configMap);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[SLA] ensureSlaTimer failed:", err);
    return null;
  }
}

async function settleTimer(
  t: SlaTimer,
  status: "Completed" | "Cancelled",
  actor?: string
): Promise<void> {
  const now = Date.now();
  await apiPut(buildResourceUrl(LOG_DOCTYPE, t.name), {
    status,
    completed_time: toErp(now),
    completed_by: actor || currentUserEmail() || undefined,
    remaining_minutes: 0,
  });
}

/**
 * Mark open logs for a reference (optionally a specific workflow/stage) as
 * completed (Step 4). Sets Completed Time, Completed By and Status = Completed.
 */
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
      await settleTimer(t, "Cancelled", opts?.actor);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[SLA] cancelSlaTimer failed:", err);
  }
}

/* ── Background evaluation (countdown / reminders / breach / escalation) ── */

// Reminders and breach notifications have no persistent flag on "SLA Log", so
// we de-duplicate within the browser session to avoid re-notifying every cycle.
const remindedLogs = new Set<string>();
const breachNotifiedLogs = new Set<string>();

/**
 * Evaluate every open log against the clock (Step 3 + 5):
 *   • refresh Remaining Minutes,
 *   • send a reminder when the reminder window opens,
 *   • mark breaches (Status = Breached) and notify,
 *   • create an SLA Escalation History entry + set Escalated = Yes.
 * Safe to call on an interval — only writes when something changes.
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
    const open = await listAllOpenTimers();
    const now = Date.now();
    for (const t of open) {
      evaluated++;
      const due = parseSlaTime(t.due_time);
      if (due == null) continue;

      const remainingMin = Math.round((due - now) / 60_000);
      const reminderAt = parseSlaTime(t.reminder_at);
      const isBreached = now >= due;
      const isDueSoon =
        !isBreached && reminderAt != null && now >= reminderAt;

      if (isBreached) {
        // Persist the breach + refreshed (negative) remaining minutes.
        if (t.sla_status !== "Breached") {
          await apiPut(buildResourceUrl(LOG_DOCTYPE, t.name), {
            status: "Breached",
            remaining_minutes: remainingMin,
          });
        } else {
          await apiPut(buildResourceUrl(LOG_DOCTYPE, t.name), {
            remaining_minutes: remainingMin,
          });
        }

        if (t.sla_status !== "Breached" && !breachNotifiedLogs.has(t.name)) {
          breachNotifiedLogs.add(t.name);
          notifySla({
            role: t.role,
            timer: t,
            eventType: "sla_breached",
            title: `SLA breached · ${t.workflow}`,
            description: `${t.reference_name} exceeded its ${t.workflow} SLA and is now overdue.`,
          });
        }

        // Escalate once (Step 5). Only when a role is configured and not yet done.
        if ((t.escalated ?? 0) !== 1 && t.escalation_role) {
          await createEscalationHistory({
            timer: t,
            from: t.role,
            to: t.escalation_role,
            level: 1,
            reason: `SLA breached for ${t.workflow} — due ${t.due_time}.`,
          });
          await apiPut(buildResourceUrl(LOG_DOCTYPE, t.name), { escalated: 1 });
          notifySla({
            role: t.escalation_role,
            timer: t,
            eventType: "sla_escalated",
            title: `SLA escalation · ${t.workflow}`,
            description: `${t.reference_name} breached SLA and was escalated to ${t.escalation_role}.`,
          });
        }
        breaches++;
      } else {
        // Still running — keep Remaining Minutes fresh (Step 3).
        await apiPut(buildResourceUrl(LOG_DOCTYPE, t.name), {
          remaining_minutes: remainingMin,
        });

        if (isDueSoon && !remindedLogs.has(t.name)) {
          remindedLogs.add(t.name);
          notifySla({
            role: t.role,
            timer: t,
            eventType: "sla_reminder",
            title: `SLA due soon · ${t.workflow}`,
            description: `${t.reference_name} is due in about ${Math.max(0, remainingMin)} minutes.`,
          });
          reminders++;
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[SLA] evaluateSlaTimers failed:", err);
  }
  return { evaluated, reminders, breaches };
}

/* ── Reports & dashboard ───────────────────────────────────────────────── */

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
  todaysBreaches: number;
  upcomingBreaches: number;
  avgResolutionMinutes: number;
  compliancePct: number;
  byWorkflow: SlaReportBreakdownRow[];
  byRole: SlaReportBreakdownRow[];
  byPriority: SlaReportBreakdownRow[];
  byStatus: SlaReportBreakdownRow[];
}

/** True if a timer breached (explicit status, or finished after its due time). */
export function timerBreached(t: SlaTimer): boolean {
  if (deriveTimerStatus(t) === "Breached") return true;
  if (t.sla_status === "Completed") {
    const due = parseSlaTime(t.due_time);
    const done = parseSlaTime(t.completed_time);
    if (due != null && done != null && done > due) return true;
  }
  return false;
}

export function timerOnTime(t: SlaTimer): boolean {
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

function isSameDay(ms: number, ref: number): boolean {
  const a = new Date(ms);
  const b = new Date(ref);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const UPCOMING_WINDOW_MIN = 120;

/** Summarise a set of timers into the dashboard/report shape. */
export function summarizeTimers(timers: SlaTimer[], now: number = Date.now()): SlaReport {
  const running = timers.filter((t) => deriveTimerStatus(t, now) === "Running").length;
  const dueSoon = timers.filter((t) => deriveTimerStatus(t, now) === "Due Soon").length;
  const completed = timers.filter((t) => t.sla_status === "Completed").length;
  const cancelled = timers.filter((t) => t.sla_status === "Cancelled").length;
  const breached = timers.filter(timerBreached).length;
  const completedOnTime = timers.filter(timerOnTime).length;

  const todaysBreaches = timers.filter((t) => {
    if (deriveTimerStatus(t, now) !== "Breached") return false;
    const due = parseSlaTime(t.due_time);
    return due != null && isSameDay(due, now);
  }).length;

  const upcomingBreaches = timers.filter((t) => {
    const st = deriveTimerStatus(t, now);
    if (st !== "Running" && st !== "Due Soon") return false;
    const due = parseSlaTime(t.due_time);
    if (due == null) return false;
    const minsLeft = (due - now) / 60_000;
    return minsLeft > 0 && minsLeft <= UPCOMING_WINDOW_MIN;
  }).length;

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
    todaysBreaches,
    upcomingBreaches,
    avgResolutionMinutes,
    compliancePct,
    byWorkflow: aggregate(timers, (t) => String(t.workflow)),
    byRole: aggregate(timers, (t) => t.role || "—"),
    byPriority: aggregate(timers, (t) => t.priority || "—"),
    byStatus: aggregate(timers, (t) => deriveTimerStatus(t)),
  };
}

export async function fetchSlaReport(): Promise<SlaReport> {
  const timers = await listAllTimers();
  return summarizeTimers(timers);
}
