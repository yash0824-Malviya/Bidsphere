import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CreditCard, Receipt, Wallet } from "lucide-react";

import { fetchDashboardData } from "../../api/dashboard";
import FinancialSummary from "../../components/dashboard/FinancialSummary";
import { PageHeader } from "../../components/ui";
import {
  buildFinancialSummary,
  computeExecutiveKpis,
} from "../../utils/dashboardUtils";

export default function BudgetPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-enterprise"],
    queryFn: fetchDashboardData,
    staleTime: 5 * 60_000,
  });

  const kpis = data ? computeExecutiveKpis(data) : null;
  const summary =
    data && kpis ? buildFinancialSummary(kpis, data.counts) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget & Payables"
        description="Monitor spend commitments, outstanding payables, and release supplier payments."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/p2p/payments"
          className="card flex items-center gap-4 p-5 transition-shadow hover:shadow-card-hover"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              Payment Records
            </p>
            <p className="text-xs text-neutral-500">
              View and create supplier payments
            </p>
          </div>
        </Link>
        <Link
          to="/p2p/payments/new"
          className="card flex items-center gap-4 p-5 transition-shadow hover:shadow-card-hover"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success-50 text-success-600">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              Pay Supplier
            </p>
            <p className="text-xs text-neutral-500">
              Record a payment against an invoice
            </p>
          </div>
        </Link>
        <Link
          to="/p2p/invoices"
          className="card flex items-center gap-4 p-5 transition-shadow hover:shadow-card-hover sm:col-span-2"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning-50 text-warning-600">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              Supplier Invoices
            </p>
            <p className="text-xs text-neutral-500">
              Review unpaid invoices before releasing payment
            </p>
          </div>
        </Link>
      </div>

      <FinancialSummary items={summary} loading={isLoading} />
    </div>
  );
}
