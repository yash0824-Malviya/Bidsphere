import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CreditCard,
  DollarSign,
  PieChart,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import MonthlySpendTrendCard, { type MonthlyPoint } from "./MonthlySpendTrendCard";
import SpendByCategoryCard, { type CategoryData } from "./SpendByCategoryCard";
import { formatCurrencyCompact } from "../../utils/format";
import type { PurchaseOrder } from "../../types/erpnext";

interface Props {
  totalSpendDisplay?: string | null;
  totalBudget?: number;
  consumedBudget?: number;
  utilizationPct?: number;
  purchaseOrders?: PurchaseOrder[];
  monthlySpendData?: MonthlyPoint[];
  spendByCategoryData?: CategoryData[];
  loading?: boolean;
}

export default function SpendAndFinanceSection({
  totalSpendDisplay,
  totalBudget = 0,
  consumedBudget = 0,
  utilizationPct = 0,
  purchaseOrders = [],
  monthlySpendData = [],
  spendByCategoryData = [],
}: Props) {
  const remainingBudget = Math.max(0, totalBudget - consumedBudget);

  const poMetrics = useMemo(() => {
    const count = purchaseOrders.length;
    let totalPoAmount = 0;
    for (const po of purchaseOrders) {
      totalPoAmount += po.grand_total || po.total || 0;
    }
    const avgVal = count > 0 ? totalPoAmount / count : 0;
    return {
      count,
      totalPoAmount,
      avgValDisplay: count > 0 ? formatCurrencyCompact(avgVal) : "—",
    };
  }, [purchaseOrders]);

  return (
    <section className="w-full space-y-4">
      {/* Finance Overview Header & KPIs */}
      <div className="rounded-[10px] border border-[#E2E8F0] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-[#E2E8F0] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
                Spend & Finance
              </h2>
              <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-bold text-[#059669]">
                {totalSpendDisplay || "YTD Spend"}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-[#64748B]">
              Procurement budget allocations, expenditures, PO valuations and utilization rates
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/budget/dashboard"
              className="text-[12px] font-semibold text-[#1554D1] hover:underline"
            >
              Budget Dashboard
            </Link>
            <span className="text-[#CBD5E1]">|</span>
            <Link
              to="/p2p/total-spend"
              className="text-[12px] font-semibold text-[#1554D1] hover:underline inline-flex items-center gap-0.5"
            >
              <span>Spend Analytics</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* 6 Financial Metric Cards */}
        <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6 text-[12px]">
          <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFCFF] p-3">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-[11px]">Total Spend (YTD)</span>
              <DollarSign className="h-3.5 w-3.5 text-[#1554D1]" />
            </div>
            <p className="mt-1.5 text-[18px] font-bold text-[#12213F]">
              {totalSpendDisplay || "—"}
            </p>
            <span className="text-[10px] text-[#94A3B8]">Approved PO spend</span>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFCFF] p-3">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-[11px]">Allocated Budget</span>
              <Wallet className="h-3.5 w-3.5 text-[#2563EB]" />
            </div>
            <p className="mt-1.5 text-[18px] font-bold text-[#12213F]">
              {totalBudget > 0 ? formatCurrencyCompact(totalBudget) : "—"}
            </p>
            <span className="text-[10px] text-[#94A3B8]">Approved fiscal budget</span>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFCFF] p-3">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-[11px]">Consumed Budget</span>
              <CreditCard className="h-3.5 w-3.5 text-[#D97706]" />
            </div>
            <p className="mt-1.5 text-[18px] font-bold text-[#D97706]">
              {consumedBudget > 0 ? formatCurrencyCompact(consumedBudget) : "—"}
            </p>
            <span className="text-[10px] text-[#94A3B8]">Invoiced & committed</span>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFCFF] p-3">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-[11px]">Remaining Budget</span>
              <TrendingUp className="h-3.5 w-3.5 text-[#059669]" />
            </div>
            <p className="mt-1.5 text-[18px] font-bold text-[#059669]">
              {totalBudget > 0 ? formatCurrencyCompact(remainingBudget) : "—"}
            </p>
            <span className="text-[10px] text-[#94A3B8]">Available headroom</span>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFCFF] p-3">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-[11px]">Budget Utilized %</span>
              <PieChart className="h-3.5 w-3.5 text-[#7C3AED]" />
            </div>
            <p className="mt-1.5 text-[18px] font-bold text-[#12213F]">
              {totalBudget > 0 ? `${Math.round(utilizationPct)}%` : "—"}
            </p>
            <div className="mt-1 h-1.5 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
              <div
                className={`h-full ${utilizationPct > 90 ? "bg-[#DC2626]" : utilizationPct > 75 ? "bg-[#D97706]" : "bg-[#1554D1]"}`}
                style={{ width: `${Math.min(100, Math.max(0, utilizationPct))}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFCFF] p-3">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-[11px]">Avg PO Value</span>
              <ShoppingCart className="h-3.5 w-3.5 text-[#0D9488]" />
            </div>
            <p className="mt-1.5 text-[18px] font-bold text-[#12213F]">
              {poMetrics.avgValDisplay}
            </p>
            <span className="text-[10px] text-[#94A3B8]">Across {poMetrics.count} POs</span>
          </div>
        </div>
      </div>

      {/* Spend Charts Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MonthlySpendTrendCard data={monthlySpendData} />
        <SpendByCategoryCard
          categories={spendByCategoryData}
          totalSpendDisplay={totalSpendDisplay ?? undefined}
        />
      </div>
    </section>
  );
}
