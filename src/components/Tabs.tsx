import { useSearchParams } from "react-router-dom";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface Props<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (tab: T) => void;
}

/** A horizontal tab strip with an underline indicator. */
export default function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: Props<T>) {
  return (
    <div className="border-b border-neutral-200">
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "border-primary text-primary-700"
                  : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
              }`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === "number" && (
                <span
                  className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-medium ${
                    isActive
                      ? "bg-primary-100 text-primary-700"
                      : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Hook that synchronises the active tab with a `?tab=` query param so
 * refreshes and shared links return the user to the same tab.
 */
export function useTabParam<T extends string>(
  defaultTab: T,
  paramName = "tab"
): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams();
  const current = (params.get(paramName) as T | null) ?? defaultTab;

  function setTab(tab: T) {
    const next = new URLSearchParams(params);
    if (tab === defaultTab) {
      next.delete(paramName);
    } else {
      next.set(paramName, tab);
    }
    setParams(next, { replace: true });
  }

  return [current, setTab];
}
