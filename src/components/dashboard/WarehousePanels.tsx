import { memo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Package, TrendingDown, TrendingUp } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { StockAlertRow } from "../../api/warehouseDashboard";
import { formatDate } from "../../utils/format";

interface GrnRow {
  name: string;
  supplier_name?: string;
  supplier?: string;
  posting_date?: string;
  status?: string;
}

function PanelShell({
  title,
  icon: Icon,
  children,
  to,
}: {
  title: string;
  icon: typeof Package;
  children: React.ReactNode;
  to?: string;
}) {
  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {title}
          </h3>
        </div>
        {to ? (
          <Link to={to} className="text-xs font-medium text-primary hover:underline">
            View all
          </Link>
        ) : null}
      </div>
      <div className="dashboard-panel-body">{children}</div>
    </div>
  );
}

export function RecentGrnsPanel({
  rows,
  loading,
}: {
  rows: GrnRow[];
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="min-h-[160px] rounded-xl" />;

  return (
    <PanelShell title="Recent GRNs" icon={Package} to="/p2p/grn">
      <ul className="divide-y divide-neutral-100">
        {rows.length === 0 ? (
          <li className="py-8 text-center text-sm text-neutral-500">
            No goods receipts recorded yet.
          </li>
        ) : (
          rows.slice(0, 6).map((grn) => (
            <li key={grn.name}>
              <Link
                to={`/p2p/grn/${encodeURIComponent(grn.name)}`}
                className="flex items-center justify-between gap-3 py-3 hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {grn.name}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    {grn.supplier_name ?? grn.supplier ?? "—"}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-neutral-400">
                  {grn.posting_date ? formatDate(grn.posting_date) : "—"}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </PanelShell>
  );
}

export function LowStockAlertsPanel({
  rows,
  loading,
}: {
  rows: StockAlertRow[];
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="min-h-[160px] rounded-xl" />;

  return (
    <PanelShell title="Low Stock Alerts" icon={AlertTriangle} to="/inventory">
      <ul className="divide-y divide-neutral-100">
        {rows.length === 0 ? (
          <li className="py-8 text-center text-sm text-neutral-500">
            No low stock items found.
          </li>
        ) : (
          rows.map((row) => (
            <li
              key={`${row.item_code}::${row.warehouse}`}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {row.item_name}
                </p>
                <p className="truncate text-xs text-neutral-500">
                  {row.item_code} · {row.warehouse}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-amber-800">
                  {row.stock_level} / {row.reorder_level}
                </span>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                  On hand / Reorder
                </p>
              </div>
            </li>
          ))
        )}
      </ul>
    </PanelShell>
  );
}

export function StockRankPanel({
  title,
  rows,
  tone,
  loading,
}: {
  title: string;
  rows: StockAlertRow[];
  tone: "fast" | "slow";
  loading?: boolean;
}) {
  const Icon = tone === "fast" ? TrendingUp : TrendingDown;

  if (loading) return <Skeleton className="min-h-[160px] rounded-xl" />;

  return (
    <PanelShell title={title} icon={Icon} to="/inventory">
      <ul className="divide-y divide-neutral-100">
        {rows.length === 0 ? (
          <li className="py-8 text-center text-sm text-neutral-500">
            No items to display.
          </li>
        ) : (
          rows.map((row) => (
            <li key={row.item_code} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {row.item_name}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-700">
                {row.stock_level} on hand
              </span>
            </li>
          ))
        )}
      </ul>
    </PanelShell>
  );
}

export default memo(RecentGrnsPanel);
