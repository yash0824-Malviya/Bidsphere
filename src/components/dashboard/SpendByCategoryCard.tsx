import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export interface CategoryData {
  name: string;
  value: number;
  amount: string;
  color: string;
}

export default function SpendByCategoryCard({
  categories = [],
  totalSpendDisplay,
}: {
  categories?: CategoryData[];
  totalSpendDisplay?: string;
}) {
  const hasData = categories.length > 0 && categories.some((c) => c.value > 0);

  return (
    <div className="flex h-full min-h-[340px] flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
        <div>
          <h3 className="text-[14.5px] font-bold text-[#12213F]">
            Spend by Category (YTD)
          </h3>
          <p className="text-[12px] text-[#64748B]">
            Procurement category distribution
          </p>
        </div>
        <span className="rounded-md bg-[#ECFDF5] px-2 py-0.5 text-[12px] font-bold text-[#059669]">
          {hasData ? (totalSpendDisplay || "YTD Spend") : "—"}
        </span>
      </div>

      {hasData ? (
        <div className="my-2 grid grid-cols-1 items-center gap-4 sm:grid-cols-12">
          {/* Donut Chart */}
          <div className="relative flex h-[180px] items-center justify-center sm:col-span-6">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  formatter={(val, name, props) => [
                    `${val}% (${(props.payload as CategoryData).amount})`,
                    name,
                  ]}
                  contentStyle={{
                    backgroundColor: "#FFFFFF",
                    border: "1px solid #E2E8F0",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(15, 27, 54, 0.08)",
                  }}
                />
                <Pie
                  data={categories.filter((c) => c.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {categories.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[16px] font-bold text-[#12213F]">
                {categories.filter((c) => c.value > 0).length}
              </span>
              <span className="text-[10px] font-medium text-[#64748B]">
                Categories
              </span>
            </div>
          </div>

          {/* Legend */}
          <div className="space-y-1.5 sm:col-span-6">
            {categories.map((cat) => (
              <div key={cat.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="truncate text-[12px] font-medium text-[#475569]">
                    {cat.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-right text-[12px]">
                  <span className="font-semibold text-[#12213F]">{cat.value}%</span>
                  <span className="text-[#94A3B8] text-[11px] tabular-nums">({cat.amount})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <p className="text-[13px] font-semibold text-[#64748B]">
            No category data available
          </p>
          <p className="mt-1 text-[11.5px] text-[#94A3B8]">
            Category breakdown will appear once purchase orders are processed.
          </p>
        </div>
      )}

      <div className="border-t border-[#F1F5F9] pt-2.5 text-right">
        <span className="text-[11.5px] text-[#64748B]">
          Live ERPNext purchase order lines
        </span>
      </div>
    </div>
  );
}
