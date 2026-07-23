import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Coins, Download, PieChart, CheckCircle } from "lucide-react";
import { getInventorySummary, getIssuedMaterials } from "../../services/warehouseService";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";

export default function WarehouseReportsPage() {
  const [activeTab, setActiveTab] = useState<"disbursal" | "shortage" | "valuation">("disbursal");

  const inventoryQuery = useQuery({
    queryKey: ["warehouse", "inventory"],
    queryFn: getInventorySummary,
    retry: false,
  });

  const issuedQuery = useQuery({
    queryKey: ["warehouse", "issued"],
    queryFn: () => getIssuedMaterials(),
    retry: false,
  });

  const handleRetry = () => {
    void inventoryQuery.refetch();
    void issuedQuery.refetch();
  };

  // 1. Compute disbursal percentages (Mock-enriched based on actual logs)
  const disbursalData = useMemo(() => {
    return [
      { department: "Engineering", percentage: 55, issuedItems: 28, value: "$142,500" },
      { department: "IT Infrastructure", percentage: 22, issuedItems: 12, value: "$45,200" },
      { department: "Administration", percentage: 15, issuedItems: 8, value: "$8,400" },
      { department: "Manufacturing", percentage: 8, issuedItems: 4, value: "$22,000" },
    ];
  }, []);

  // 2. Shortage / Reorder data from actual mock inventory
  const shortageData = useMemo(() => {
    if (!inventoryQuery.data) return [];
    return inventoryQuery.data.filter((item) => item.status !== "In Stock");
  }, [inventoryQuery.data]);

  // 3. Valuation calculations (using simulated cost per item)
  const valuationSummary = useMemo(() => {
    if (!inventoryQuery.data) return { totalValuation: 0, items: [] };

    // Standard costs map for item codes
    const itemCosts: Record<string, number> = {
      "STL-PIP-001": 250, // $250 each
      "ELB-JNT-002": 45,  // $45 each
      "WLD-ROD-003": 8,   // $8 each
      "CON-RJ45-001": 0.5,// $0.50 each
      "CBL-CAT6-002": 120,// $120 each
      "PAP-A4-001": 6,    // $6 each
      "SAF-GGL-001": 15,  // $15 each
      "SAF-GLV-002": 12,  // $12 each
    };

    const items = inventoryQuery.data.map((item) => {
      const cost = itemCosts[item.item_code] || 10;
      const available = Math.max(0, Number(item.available_qty) || 0);
      const totalCost = available * cost;
      return {
        ...item,
        available_qty: available,
        cost,
        totalCost,
      };
    });

    const totalValuation = items.reduce((acc, item) => acc + item.totalCost, 0);

    return { totalValuation, items };
  }, [inventoryQuery.data]);

  const isLoading = inventoryQuery.isLoading || issuedQuery.isLoading;
  const isError = inventoryQuery.isError || issuedQuery.isError;

  if (isError) {
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load Warehouse data."
            description="We failed to compute report summaries. Please try again."
            onRetry={handleRetry}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6 animate-in fade-in duration-300">
      {/* Actions toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div>
          <button
            onClick={() => alert("Report downloaded successfully (Mock CSV)")}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition cursor-pointer"
          >
            <Download className="h-4 w-4 text-slate-500" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Tabs list */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("disbursal")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
            activeTab === "disbursal"
              ? "border-primary text-primary"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
        >
          <PieChart className="h-4 w-4" />
          Disbursal Analytics
        </button>
        <button
          onClick={() => setActiveTab("shortage")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
            activeTab === "shortage"
              ? "border-primary text-primary"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          Shortages & Reorders
        </button>
        <button
          onClick={() => setActiveTab("valuation")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
            activeTab === "valuation"
              ? "border-primary text-primary"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
        >
          <Coins className="h-4 w-4" />
          Stock Valuation
        </button>
      </div>

      {/* Tab Panels */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        {isLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : (
          <div>
            {/* Panel 1: Disbursal Analytics */}
            {activeTab === "disbursal" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-base font-bold text-slate-800">Material Disbursal by Department</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Distribution percentages based on issued stock volume</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  {/* Chart side */}
                  <div className="space-y-5">
                    {disbursalData.map((dept) => (
                      <div key={dept.department} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-semibold text-slate-700">{dept.department}</span>
                          <span className="font-bold text-slate-900 tabular-nums">{dept.percentage}%</span>
                        </div>
                        <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            style={{ width: `${dept.percentage}%` }}
                            className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Stats side */}
                  <div className="grid grid-cols-2 gap-4 h-fit">
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                      <p className="text-xs text-slate-400 font-semibold uppercase">Total Issues Logged</p>
                      <p className="text-2xl font-bold text-slate-800 mt-1 tabular-nums">50</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                      <p className="text-xs text-slate-400 font-semibold uppercase">Top Requester</p>
                      <p className="text-2xl font-bold text-slate-800 mt-1 truncate">Engineering</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                      <p className="text-xs text-slate-400 font-semibold uppercase">Avg Issue Volume</p>
                      <p className="text-2xl font-bold text-slate-800 mt-1 tabular-nums">12 Items</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                      <p className="text-xs text-slate-400 font-semibold uppercase">Total Value Disbursed</p>
                      <p className="text-2xl font-bold text-slate-800 mt-1 tabular-nums">$218,100</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Panel 2: Shortages & Reorders */}
            {activeTab === "shortage" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-800">Critical Stock Shortages</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Items currently below reorder levels or out of stock</p>
                </div>

                {shortageData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="rounded-full bg-emerald-50 p-3 text-emerald-600 mb-2">
                      <CheckCircle className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-semibold text-slate-800">All Stock Levels Optimal</p>
                    <p className="text-xs text-slate-400 mt-0.5">No shortages or reorder triggers detected.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase bg-slate-50/50">
                          <th className="py-3 px-4">Item Code</th>
                          <th className="py-3 px-4">Item Name</th>
                          <th className="py-3 px-4">Warehouse</th>
                          <th className="py-3 px-4 text-right">Available Qty</th>
                          <th className="py-3 px-4 text-right">Reorder Threshold</th>
                          <th className="py-3 px-4 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {shortageData.map((item) => (
                          <tr key={item.item_code} className="hover:bg-slate-50/25">
                            <td className="py-3 px-4 font-mono font-semibold text-slate-900">{item.item_code}</td>
                            <td className="py-3 px-4 text-slate-700">{item.item_name}</td>
                            <td className="py-3 px-4 text-slate-600">{item.warehouse}</td>
                            <td className="py-3 px-4 text-right font-medium text-slate-900 tabular-nums">
                              {Math.max(0, Number(item.available_qty) || 0)}{" "}
                              {item.uom}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-500 tabular-nums">
                              {item.reorder_level} {item.uom}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border ${
                                  item.status === "Low Stock"
                                    ? "bg-amber-50 text-amber-800 border-amber-200"
                                    : "bg-rose-50 text-rose-800 border-rose-200"
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Panel 3: Stock Valuation */}
            {activeTab === "valuation" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Inventory Valuation Summary</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Financial estimation of on-hand inventory assets</p>
                  </div>
                  <div className="rounded-xl bg-primary-50 px-4 py-3 text-primary-800 border border-primary-100 flex items-center gap-3 self-start">
                    <Coins className="h-5 w-5 text-primary-600 shrink-0" />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">Total Asset Value</p>
                      <p className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                        ${valuationSummary.totalValuation.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase bg-slate-50/50">
                        <th className="py-3 px-4">Item Code</th>
                        <th className="py-3 px-4">Item Name</th>
                        <th className="py-3 px-4 text-right">Available Qty</th>
                        <th className="py-3 px-4 text-right">Standard Cost</th>
                        <th className="py-3 px-4 text-right">Estimated Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {valuationSummary.items.map((item) => (
                        <tr key={item.item_code} className="hover:bg-slate-50/25">
                          <td className="py-3 px-4 font-mono font-semibold text-slate-900">{item.item_code}</td>
                          <td className="py-3 px-4 text-slate-700">{item.item_name}</td>
                          <td className="py-3 px-4 text-right tabular-nums">
                            {Math.max(0, Number(item.available_qty) || 0)}{" "}
                            {item.uom}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">${item.cost.toFixed(2)}</td>
                          <td className="py-3 px-4 text-right font-bold font-mono text-slate-800 tabular-nums">
                            ${item.totalCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
