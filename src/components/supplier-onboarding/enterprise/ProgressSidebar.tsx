import { Check, Clock, Circle, MessageSquare } from "lucide-react";

import type { SectionProgress } from "./onboardingUi";
import { ONB } from "./onboardingUi";

interface Props {
  overall: number;
  sections: SectionProgress[];
  pendingTasks: string[];
  estimatedMinutes: number;
  unreadMessages?: number;
}

export default function ProgressSidebar({
  overall,
  sections,
  pendingTasks,
  estimatedMinutes,
  unreadMessages = 0,
}: Props) {
  return (
    <aside className="flex h-full flex-col gap-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Profile Completion
        </p>
        <div className="mt-2.5 flex items-end justify-between gap-2">
          <p
            className="text-3xl font-bold tracking-tight tabular-nums"
            style={{ color: ONB.primaryDark }}
          >
            {overall}%
          </p>
          <p className="pb-1 text-xs text-slate-500">Overall</p>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={overall}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Profile completion"
        >
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(100, overall)}%`,
              background: `linear-gradient(90deg, ${ONB.primaryDark}, ${ONB.primary})`,
            }}
          />
        </div>

        <ul className="mt-4 space-y-2">
          {sections.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-2 text-slate-700">
                {s.done ? (
                  <Check className="h-4 w-4 text-emerald-500" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 text-slate-300" aria-hidden />
                )}
                {s.label}
              </span>
              <span
                className={`tabular-nums text-xs font-semibold ${
                  s.done ? "text-emerald-600" : "text-slate-400"
                }`}
              >
                {s.pct}%
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Pending Tasks
        </p>
        {pendingTasks.length === 0 ? (
          <p className="mt-2.5 text-sm text-emerald-700">All set — ready to review.</p>
        ) : (
          <ul className="mt-2.5 space-y-1.5">
            {pendingTasks.slice(0, 5).map((t) => (
              <li
                key={t}
                className="flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-900"
              >
                <span className="mt-0.5 text-amber-500" aria-hidden>
                  ●
                </span>
                {t}
              </li>
            ))}
          </ul>
        )}
        {unreadMessages > 0 ? (
          <p className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600">
            <MessageSquare className="h-3.5 w-3.5" />
            Reply to {unreadMessages} procurement message
            {unreadMessages === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <Clock className="h-3.5 w-3.5" />
          Estimated Completion
        </p>
        <p className="mt-2 text-2xl font-bold text-slate-900">
          {estimatedMinutes}{" "}
          <span className="text-sm font-medium text-slate-500">Minutes</span>
        </p>
      </div>
    </aside>
  );
}
