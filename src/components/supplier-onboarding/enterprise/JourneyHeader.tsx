import { Check, ChevronRight } from "lucide-react";

import type { JourneyItem } from "./onboardingUi";
import { ONB } from "./onboardingUi";

export default function JourneyHeader({ items }: { items: JourneyItem[] }) {
  return (
    <nav
      aria-label="Supplier journey"
      className="overflow-x-auto rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm"
    >
      <ol className="flex min-w-max items-center gap-1">
        {items.map((item, i) => {
          const done = item.state === "done";
          const current = item.state === "current";
          return (
            <li key={item.key} className="flex items-center gap-1">
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  done
                    ? "bg-emerald-50 text-emerald-700"
                    : current
                      ? "text-white shadow-sm"
                      : "bg-slate-100 text-slate-500"
                }`}
                style={current ? { backgroundColor: ONB.primary } : undefined}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                    done
                      ? "bg-emerald-500 text-white"
                      : current
                        ? "bg-white/20 text-white"
                        : "bg-slate-200 text-slate-500"
                  }`}
                  aria-hidden
                >
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {item.label}
              </div>
              {i < items.length - 1 ? (
                <ChevronRight
                  className="mx-0.5 h-3.5 w-3.5 shrink-0 text-slate-300"
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
