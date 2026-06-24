import { memo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftRight,
  Boxes,
  ClipboardList,
  PackagePlus,
} from "lucide-react";

const ACTIONS = [
  { label: "Create GRN", to: "/p2p/grn/new", icon: PackagePlus },
  { label: "View Inventory", to: "/inventory", icon: Boxes },
  { label: "Transfer Stock", to: "/inventory", icon: ArrowLeftRight },
  { label: "Stock Adjustment", to: "/inventory", icon: ClipboardList },
] as const;

function WarehouseQuickActions() {
  return (
    <div className="rounded-xl border border-neutral-200/80 bg-white p-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Quick Actions
      </p>
      <div className="flex flex-wrap gap-3">
        {ACTIONS.map(({ label, to, icon: Icon }) => (
          <Link
            key={label}
            to={to}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default memo(WarehouseQuickActions);
