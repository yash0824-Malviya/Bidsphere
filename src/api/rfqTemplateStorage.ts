/**
 * Persistent RFQ Template store (localStorage).
 * Used as primary database when ERPNext "RFQ Template" DocType is unavailable,
 * and as write-through cache for user-created templates.
 */

import type { RFQTemplate } from "../types/erpnext";
import { APP_NAME } from "../config/branding";
import {
  DEFAULT_REQUIRED_DOCUMENTS,
  DEFAULT_WORKFLOW_RULES,
} from "../types/erpnext";

const STORAGE_KEY = "bidsphere-rfq-templates";
const LOG_TAG = "[RFQTemplateStorage]";

function uid(): string {
  return `TPL-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function logTemplateStorage(op: string, data?: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`${LOG_TAG} ${op}`, data ?? "");
}

export function isLocalTemplateId(name: string): boolean {
  return name.startsWith("TPL-") || name.startsWith("DEMO-TPL-");
}

export function readLocalTemplates(): RFQTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RFQTemplate[];
    logTemplateStorage("READ", { count: parsed.length });
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    logTemplateStorage("READ — parse error");
    return [];
  }
}

function writeLocalTemplates(templates: RFQTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  logTemplateStorage("WRITE", { count: templates.length, key: STORAGE_KEY });
}

export function getLocalTemplate(name: string): RFQTemplate | null {
  return readLocalTemplates().find((t) => t.name === name) ?? null;
}

export function saveLocalTemplate(template: RFQTemplate): RFQTemplate {
  const all = readLocalTemplates();
  const idx = all.findIndex((t) => t.name === template.name);
  const now = new Date().toISOString();
  const saved: RFQTemplate = {
    ...template,
    modified: now,
    creation: template.creation ?? now,
  };
  if (idx >= 0) all[idx] = saved;
  else all.unshift(saved);
  writeLocalTemplates(all);
  logTemplateStorage("SAVE", saved);
  return saved;
}

export function createLocalTemplate(
  data: Omit<RFQTemplate, "name" | "creation" | "modified" | "owner"> & {
    name?: string;
  }
): RFQTemplate {
  const now = new Date().toISOString();
  const template: RFQTemplate = {
    ...data,
    name: data.name ?? uid(),
    usage_count: data.usage_count ?? 0,
    required_documents: data.required_documents ?? { ...DEFAULT_REQUIRED_DOCUMENTS },
    workflow_rules: data.workflow_rules ?? { ...DEFAULT_WORKFLOW_RULES },
    creation: now,
    modified: now,
    owner: APP_NAME,
  };
  return saveLocalTemplate(template);
}

export function deleteLocalTemplate(name: string): boolean {
  const all = readLocalTemplates();
  const filtered = all.filter((t) => t.name !== name);
  if (filtered.length === all.length) return false;
  writeLocalTemplates(filtered);
  logTemplateStorage("DELETE", { name });
  return true;
}

export function incrementLocalTemplateUsage(name: string): void {
  const tpl = getLocalTemplate(name);
  if (!tpl) return;
  saveLocalTemplate({
    ...tpl,
    usage_count: (tpl.usage_count ?? 0) + 1,
    last_used_at: new Date().toISOString(),
  });
}

/** Merge ERPNext + local templates; local wins on same name. */
export function mergeTemplateLists(
  erp: RFQTemplate[],
  local: RFQTemplate[]
): RFQTemplate[] {
  const map = new Map<string, RFQTemplate>();
  for (const t of erp) map.set(t.name, t);
  for (const t of local) map.set(t.name, t);
  return [...map.values()].sort(
    (a, b) => (b.modified ?? "").localeCompare(a.modified ?? "")
  );
}
