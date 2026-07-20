import { Building2, Check } from "lucide-react";

import { ONB, STEP_ICONS } from "./onboardingUi";

export interface NavStep {
  id: string;
  label: string;
  /** Index into real form steps, or -1 for welcome */
  formIndex: number;
}

interface Props {
  companyName: string;
  statusBadge?: string | null;
  steps: NavStep[];
  activeId: string;
  completedIds: Set<string>;
  onSelect: (id: string, formIndex: number) => void;
}

export default function StepNavSidebar({
  companyName,
  statusBadge,
  steps,
  activeId,
  completedIds,
  onSelect,
}: Props) {
  const initial = (companyName || "S").trim().charAt(0).toUpperCase();

  return (
    <aside className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white shadow-sm"
            style={{
              background: `linear-gradient(135deg, ${ONB.primaryDark}, ${ONB.primary})`,
            }}
            aria-hidden
          >
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {companyName || "Supplier"}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <Building2 className="h-3 w-3 text-slate-400" aria-hidden />
              {statusBadge ? (
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  {statusBadge}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <nav aria-label="Onboarding sections" className="flex-1 overflow-y-auto p-2.5">
        <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Sections
        </p>
        <ul className="space-y-1">
          {steps.map((step) => {
            const active = step.id === activeId;
            const done = completedIds.has(step.id);
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onSelect(step.id, step.formIndex)}
                  aria-current={active ? "step" : undefined}
                  className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                    active
                      ? "text-white shadow-md"
                      : done
                        ? "text-slate-700 hover:bg-emerald-50"
                        : "text-slate-600 hover:bg-slate-50"
                  }`}
                  style={
                    active
                      ? { backgroundColor: ONB.primary }
                      : undefined
                  }
                >
                  <span
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs ${
                      active
                        ? "bg-white/20"
                        : done
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                    }`}
                    aria-hidden
                  >
                    {done && !active ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      STEP_ICONS[step.id] || "•"
                    )}
                  </span>
                  <span className="truncate">{step.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
