/**
 * Presentational helpers for Supplier Onboarding UX.
 * Pure UI — no API or workflow side effects.
 */

import type { OnboardingRecord } from "../../../api/supplierOnboarding";
import type { OnboardingStepDef } from "../../../config/supplierOnboardingForm";

export const ONB = {
  primary: "#1F3A6D",
  primaryDark: "#17315D",
  success: "#22C55E",
  warning: "#F59E0B",
  error: "#EF4444",
  bg: "#F7F9FC",
} as const;

/** Presentational field groups for enterprise card layout (no schema change). */
export function fieldGroupsForStep(
  stepId: string,
  fields: Array<{ name: string }>,
): Array<{ title: string; names: string[] }> {
  const names = fields.map((f) => f.name);
  if (stepId === "company") {
    const companyInfo = [
      "custom_sourcing_type",
      "custom_supplier_category",
      "company_name",
      "website",
      "address_line",
      "country",
      "state",
      "city",
      "postal_code",
    ];
    const registration = ["gst_number", "pan", "business_registration_number"];
    const used = new Set([...companyInfo, ...registration]);
    const groups = [
      {
        title: "Company Information",
        names: names.filter((n) => companyInfo.includes(n)),
      },
      {
        title: "Registration Details",
        names: names.filter((n) => registration.includes(n)),
      },
      {
        title: "Additional Details",
        names: names.filter((n) => !used.has(n)),
      },
    ];
    return groups.filter((g) => g.names.length > 0);
  }
  if (stepId === "contact") {
    return [{ title: "Contact Information", names }];
  }
  if (stepId === "business") {
    return [{ title: "Business Information", names }];
  }
  if (stepId === "bank") {
    return [{ title: "Bank Details", names }];
  }
  if (stepId === "type_details" || stepId === "category_details") {
    return [{ title: "Additional Details", names }];
  }
  return names.length ? [{ title: "Details", names }] : [];
}

export type JourneyKey =
  | "account"
  | "password"
  | "company"
  | "business"
  | "documents"
  | "review"
  | "approval"
  | "portal";

export interface JourneyItem {
  key: JourneyKey;
  label: string;
  state: "done" | "current" | "pending";
}

export function buildSupplierJourney(opts: {
  status?: string | null;
  unlocked?: boolean;
  hasCompany?: boolean;
  hasBusiness?: boolean;
  hasDocs?: boolean;
  submitted?: boolean;
}): JourneyItem[] {
  const status = String(opts.status || "");
  const approved = status === "Approved" || !!opts.unlocked;
  const inReview = ["Submitted", "Under Review"].includes(status);
  const changes = status === "Changes Requested";
  const submitted = opts.submitted || inReview || approved || changes;

  const companyDone = !!opts.hasCompany;
  const businessDone = !!opts.hasBusiness;
  const docsDone = !!opts.hasDocs;

  function stateFor(
    done: boolean,
    currentWhen: boolean,
  ): "done" | "current" | "pending" {
    if (done) return "done";
    if (currentWhen) return "current";
    return "pending";
  }

  return [
    { key: "account", label: "Account Created", state: "done" },
    { key: "password", label: "Password Changed", state: "done" },
    {
      key: "company",
      label: "Company",
      state: stateFor(companyDone, !companyDone && !submitted),
    },
    {
      key: "business",
      label: "Business",
      state: stateFor(
        businessDone,
        companyDone && !businessDone && !submitted,
      ),
    },
    {
      key: "documents",
      label: "Documents",
      state: stateFor(docsDone, businessDone && !docsDone && !submitted),
    },
    {
      key: "review",
      label: "Review",
      state: stateFor(
        submitted,
        docsDone && !submitted,
      ),
    },
    {
      key: "approval",
      label: "Approval",
      state: approved
        ? "done"
        : inReview || changes
          ? "current"
          : "pending",
    },
    {
      key: "portal",
      label: "Portal Activated",
      state: approved ? "done" : "pending",
    },
  ];
}

export interface SectionProgress {
  id: string;
  label: string;
  pct: number;
  done: boolean;
}

function filledRatio(
  step: OnboardingStepDef | undefined,
  getValue: (name: string) => unknown,
): number {
  if (!step || step.fields.length === 0) return 0;
  const filled = step.fields.filter((f) => {
    const v = getValue(f.name);
    if (f.kind === "checkbox") return v === 1 || v === true || v === "1";
    return v !== undefined && v !== null && String(v).trim() !== "";
  }).length;
  return Math.round((filled / step.fields.length) * 100);
}

export function computeOnboardingProgress(opts: {
  steps: OnboardingStepDef[];
  record: OnboardingRecord | null;
  getValue: (name: string) => unknown;
}): {
  overall: number;
  sections: SectionProgress[];
  pendingTasks: string[];
  estimatedMinutes: number;
} {
  const { steps, record, getValue } = opts;
  const byId = new Map(steps.map((s) => [s.id, s]));

  const companyPct = filledRatio(byId.get("company"), getValue);
  const contactPct = filledRatio(byId.get("contact"), getValue);
  const businessPct = filledRatio(byId.get("business"), getValue);
  const bankPct = filledRatio(byId.get("bank"), getValue);
  const docCount = record?.documents?.length ?? 0;
  const docsPct = Math.min(100, Math.round((docCount / 6) * 100));
  const reviewDone = ["Submitted", "Under Review", "Approved"].includes(
    String(record?.status || ""),
  );

  const sections: SectionProgress[] = [
    {
      id: "company",
      label: "Company",
      pct: companyPct,
      done: companyPct >= 80,
    },
    {
      id: "contact",
      label: "Contact",
      pct: contactPct,
      done: contactPct >= 80,
    },
    {
      id: "address",
      label: "Address",
      pct: String(getValue("address_line") || "").trim() ? 100 : 0,
      done: !!String(getValue("address_line") || "").trim(),
    },
    {
      id: "bank",
      label: "Bank",
      pct: bankPct,
      done: bankPct >= 60,
    },
    {
      id: "documents",
      label: "Documents",
      pct: docsPct,
      done: docCount >= 3,
    },
    {
      id: "review",
      label: "Review",
      pct: reviewDone ? 100 : 0,
      done: reviewDone,
    },
  ];

  const weights = [companyPct, contactPct, businessPct, bankPct, docsPct];
  const overall = Math.round(
    weights.reduce((a, b) => a + b, 0) / Math.max(1, weights.length),
  );

  const pendingTasks: string[] = [];
  const docs = record?.documents ?? [];
  const hasType = (t: string) =>
    docs.some((d) =>
      String(d.document_type || "")
        .toLowerCase()
        .includes(t.toLowerCase()),
    );
  if (!hasType("GST")) pendingTasks.push("Upload GST Certificate");
  if (!hasType("ISO")) pendingTasks.push("Upload ISO Certificate");
  if (!hasType("PAN")) pendingTasks.push("Upload PAN Card");
  if (bankPct < 60) pendingTasks.push("Complete Bank Details");
  if (!reviewDone && overall >= 70) pendingTasks.push("Submit for Review");

  const remaining = sections.filter((s) => !s.done).length;
  const estimatedMinutes = Math.max(2, remaining * 2);

  return { overall, sections, pendingTasks, estimatedMinutes };
}

export const STEP_ICONS: Record<string, string> = {
  welcome: "👋",
  company: "🏢",
  contact: "👤",
  business: "📊",
  type_details: "🏭",
  category_details: "🏷️",
  bank: "🏦",
  documents: "📄",
  review: "✓",
  submission: "🚀",
};

export function stepDescription(id: string): string {
  switch (id) {
    case "welcome":
      return "Get started with your supplier onboarding journey.";
    case "company":
      return "Provide your legal company identity and registration details.";
    case "contact":
      return "Primary contacts Procurement will use for sourcing and logistics.";
    case "business":
      return "Share scale, commercial terms, and operating profile.";
    case "type_details":
      return "Capacity, plant, or service coverage for your supplier type.";
    case "category_details":
      return "Category-specific attributes required by Procurement.";
    case "bank":
      return "Bank account details for purchase-order payments.";
    case "documents":
      return "Upload compliance and verification documents.";
    case "review":
      return "Confirm all sections before submitting for approval.";
    default:
      return "Complete the fields below to continue.";
  }
}
