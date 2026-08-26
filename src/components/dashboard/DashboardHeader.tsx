import { memo } from "react";

import type { RoleDashboardConfig } from "../../config/dashboardRoles";

interface Props {
  config: RoleDashboardConfig;
  greetingName: string;
}

function DashboardHeader({ config, greetingName }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-semibold leading-tight text-[#0F2745]">
          Welcome back, {greetingName}
        </p>
        <p className="mt-1 text-[13px] font-normal text-[#64748B]">
          {config.subtitle}
        </p>
      </div>
      <span className="rounded-full border border-primary-100 bg-primary-50 px-3 py-1 text-[11px] font-semibold text-primary-800">
        {config.roleLabel}
      </span>
    </div>
  );
}

export default memo(DashboardHeader);
