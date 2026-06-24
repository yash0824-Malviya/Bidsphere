import { memo } from "react";
import { Link } from "react-router-dom";

import type { DashboardQuickAction } from "../../config/dashboardRoles";
import { getExecutiveDashboardLayout } from "../../config/dashboardRoles";

interface Props {
  actions?: DashboardQuickAction[];
}

function ActionCenter({
  actions = getExecutiveDashboardLayout("admin").quickActions,
}: Props) {
  if (actions.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {actions.map(({ id, label, to, icon: Icon }) => (
        <Link
          key={id}
          to={to}
          className="group flex items-center gap-2.5 rounded-xl border border-neutral-200/80 bg-white px-3 py-2.5 shadow-sm transition-all hover:border-[#0ea5e9]/40 hover:shadow-md"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#0ea5e9]/10 text-[#0ea5e9] transition-colors group-hover:bg-[#0ea5e9] group-hover:text-white">
            <Icon className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-semibold text-neutral-700 transition-colors group-hover:text-neutral-900">
            {label}
          </span>
        </Link>
      ))}
    </div>
  );
}

export default memo(ActionCenter);
