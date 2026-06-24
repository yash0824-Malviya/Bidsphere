import { memo } from "react";

import type { RoleDashboardConfig } from "../../config/dashboardRoles";

interface Props {
  config: RoleDashboardConfig;
  greetingName: string;
}

function DashboardHeader({ config, greetingName }: Props) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="heading-page">{config.title}</h1>
        <p className="page-subtitle">
          Welcome back, {greetingName} · {config.subtitle}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            Role
          </span>
          <span className="rounded-full border border-primary-100 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-800">
            {config.roleLabel}
          </span>
        </div>
      </div>
      <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600 shadow-sm">
        {config.statusLabel}
      </span>
    </div>
  );
}

export default memo(DashboardHeader);
