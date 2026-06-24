import { memo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "../Skeleton";
import type {
  InventoryMovementPoint,
  StockCategoryPoint,
} from "../../api/warehouseDashboard";
import { CATEGORY_COLORS } from "../../utils/dashboardUtils";

interface Props {
  movement: InventoryMovementPoint[];
  categories: StockCategoryPoint[];
  loading?: boolean;
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="dashboard-panel min-h-[320px]">
      <div className="dashboard-panel-header">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </h3>
      </div>
      <div className="dashboard-panel-body min-h-[240px] flex-1 p-4">{children}</div>
    </div>
  );
}

function WarehouseInventoryCharts({ movement, categories, loading }: Props) {
  if (loading) {
    return (
      <div className="dashboard-grid-2">
        <Skeleton className="min-h-[320px] rounded-xl" />
        <Skeleton className="min-h-[320px] rounded-xl" />
      </div>
    );
  }

  const categoryPie = categories.map((c) => ({
    name: c.category,
    value: Math.max(c.qty, 1),
    pct: c.pct,
  }));

  return (
    <div className="dashboard-grid-2">
      <ChartCard title="Inventory Movement Trend">
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={movement} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="inbound" fill="#0ea5e9" name="Inbound" radius={[3, 3, 0, 0]} />
              <Bar dataKey="outbound" fill="#94a3b8" name="Outbound" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Stock Category Distribution">
        <div className="flex h-[220px] items-center gap-4">
          <div className="h-full w-[48%]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryPie}
                  dataKey="value"
                  innerRadius="48%"
                  outerRadius="82%"
                  paddingAngle={2}
                  stroke="white"
                  strokeWidth={2}
                >
                  {categoryPie.map((_, idx) => (
                    <Cell
                      key={idx}
                      fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(_v, _n, item) => [
                    `${(item.payload as { pct: number }).pct.toFixed(1)}%`,
                    (item.payload as { name: string }).name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-0 flex-1 space-y-2">
            {categoryPie.map((c, idx) => (
              <li key={c.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
                  }}
                />
                <span className="truncate text-neutral-700">{c.name}</span>
                <span className="ml-auto font-medium tabular-nums text-neutral-900">
                  {c.pct.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      </ChartCard>
    </div>
  );
}

export default memo(WarehouseInventoryCharts);
