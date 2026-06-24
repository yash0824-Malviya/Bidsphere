import { useLayoutEffect, type ReactNode } from "react";

import { useOptionalLayout } from "../contexts/LayoutContext";

interface Props {
  title: string;
  welcome?: string;
  description?: string;
  actions?: ReactNode;
}

export default function PageHeader({
  title,
  welcome,
  description,
  actions,
}: Props) {
  const layout = useOptionalLayout();
  const register = layout?.registerPageHeader;
  const unregister = layout?.unregisterPageHeader;

  // Signal the global header to suppress its duplicate title while this
  // page-level header is mounted (no-op outside the main layout). Depends
  // only on the stable register/unregister callbacks to avoid re-runs.
  useLayoutEffect(() => {
    if (!register || !unregister) return;
    register();
    return () => unregister();
  }, [register, unregister]);

  return (
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <h2 className="page-title">{title}</h2>
        {welcome && (
          <p className="mt-1 text-sm font-medium text-neutral-800 sm:text-base">
            {welcome}
          </p>
        )}
        {description && <p className="page-subtitle">{description}</p>}
      </div>
      {actions && (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
