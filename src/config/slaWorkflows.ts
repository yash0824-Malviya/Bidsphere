/**
 * SLA workflow catalog + time-unit helpers.
 *
 * This file intentionally contains NO durations. Every duration, reminder and
 * escalation value comes from the admin-managed "SLA Configuration" DocType at
 * runtime. Here we only enumerate the supported workflows/stages and the role
 * that is normally responsible for each, so the engine can create the right
 * timer when a document enters a stage.
 */
import type { AppRole } from "./roles";

export const SLA_WORKFLOWS = [
  "Material Request",
  "Warehouse Review",
  "Material Issue",
  "Procurement Review",
  "RFQ Creation",
  "Supplier Response",
  "Reverse Auction",
  "AI Recommendation",
  "Legal Review",
  "Finance Review",
  "Purchase Order",
  "GRN",
  "Invoice",
  "Payment",
] as const;

export type SlaWorkflow = (typeof SLA_WORKFLOWS)[number];

export const SLA_TIME_UNITS = ["Minutes", "Hours", "Days"] as const;
export type SlaTimeUnit = (typeof SLA_TIME_UNITS)[number];

export const SLA_PRIORITIES = ["All", "Low", "Medium", "High", "Urgent"] as const;
export type SlaPriority = (typeof SLA_PRIORITIES)[number];

/** Convert a (duration, unit) pair to minutes — the engine's canonical unit. */
export function unitToMinutes(value: number, unit: SlaTimeUnit): number {
  const v = Number.isFinite(value) ? value : 0;
  switch (unit) {
    case "Minutes":
      return v;
    case "Hours":
      return v * 60;
    case "Days":
      return v * 60 * 24;
    default:
      return v;
  }
}

/**
 * The role normally accountable for each workflow stage. Used as a sensible
 * default when a timer is created; the SLA Configuration `role` overrides it.
 */
export const SLA_WORKFLOW_DEFAULT_ROLE: Record<SlaWorkflow, AppRole> = {
  "Material Request": "department",
  "Warehouse Review": "warehouse",
  "Material Issue": "warehouse",
  "Procurement Review": "procurement",
  "RFQ Creation": "procurement",
  "Supplier Response": "procurement",
  "Reverse Auction": "procurement",
  "AI Recommendation": "procurement",
  "Legal Review": "legal",
  "Finance Review": "finance",
  "Purchase Order": "procurement",
  GRN: "warehouse",
  Invoice: "finance",
  Payment: "finance",
};
