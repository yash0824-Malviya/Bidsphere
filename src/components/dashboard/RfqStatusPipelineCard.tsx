import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export interface StageData {
  name: string;
  count: number;
  color: string;
}

export default function RfqStatusPipelineCard({
  stages = [],
}: {
  stages?: StageData[];
}) {
  const total = stages.reduce((acc, curr) => acc + (curr.count || 0), 0);
  const hasData = total > 0 && stages.some((s) => s.count > 0);

  return (
    <div className="flex h-full min-h-[340px] flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
        <div>
          <h3 className="text-[14.5px] font-bold text-[#12213F]">
            RFQ Status Pipeline
          </h3>
          <p className="text-[12px] text-[#64748B]">
            Active procurement workflow stages
          </p>
        </div>
        <span className="rounded-md bg-[#EEF4FF] px-2 py-0.5 text-[12px] font-bold text-[#1554D1]">
          {hasData ? `${total} Total RFQs` : "—"}
        </span>
      </div>

      {hasData ? (
        <div className="my-2 grid grid-cols-1 items-center gap-4 sm:grid-cols-12">
          {/* Donut Chart with Center Total */}
          <div className="relative flex h-[180px] items-center justify-center sm:col-span-6">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  formatter={(val, name) => [`${val} RFQs`, name]}
                  contentStyle={{
                    backgroundColor: "#FFFFFF",
                    border: "1px solid #E2E8F0",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(15, 27, 54, 0.08)",
                  }}
                />
                <Pie
                  data={stages.filter((s) => s.count > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={3}
                  dataKey="count"
                >
                  {stages.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[20px] font-bold leading-none text-[#12213F]">
                {total}
              </span>
              <span className="text-[10px] font-medium text-[#64748B]">
                Total RFQs
              </span>
            </div>
          </div>

          {/* Legend / Stage Bars */}
          <div className="space-y-1.5 sm:col-span-6">
            {stages.map((stage) => {
              const pct = total > 0 ? Math.round((stage.count / total) * 100) : 0;
              return (
                <div key={stage.name} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="w-20 truncate text-[12px] font-medium text-[#475569]">
                    {stage.name}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#F1F5F9]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: stage.color,
                      }}
                    />
                  </div>
                  <span className="w-6 text-right text-[12px] font-bold tabular-nums text-[#12213F]">
                    {stage.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <p className="text-[13px] font-semibold text-[#64748B]">
            No RFQ pipeline data available
          </p>
          <p className="mt-1 text-[11.5px] text-[#94A3B8]">
            RFQs will appear across workflow stages as they are created.
          </p>
        </div>
      )}

      <div className="border-t border-[#F1F5F9] pt-2.5 text-right">
        <span className="text-[11.5px] text-[#64748B]">
          Live ERPNext RFQ workflow data
        </span>
      </div>
    </div>
  );
}
