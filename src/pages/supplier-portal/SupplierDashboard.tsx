import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  FileText,
  Inbox,
  Receipt,
  ShoppingCart,
  Truck,
} from "lucide-react";

import {
  countActivePOs,
  getSupplierDashboardData,
} from "../../api/supplierPortal";
import QuickNavCard from "../../components/supplier-portal/QuickNavCard";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import { Skeleton } from "../../components/Skeleton";
import SupplierPortalLayout from "./SupplierPortalLayout";

export default function SupplierDashboard() {
  const { supplierName, isReady, isAuthenticated } = useSupplierSession();

  const dashQuery = useQuery({
    queryKey: ["supplier-portal-dashboard", supplierName],
    queryFn: () => getSupplierDashboardData(supplierName),
    enabled: isAuthenticated,
    retry: 1,
  });

  const data = dashQuery.data;
  const loading = dashQuery.isLoading;

  const rfqs = data?.rfqs ?? [];
  const quotations = data?.quotations ?? [];
  const pos = data?.pos ?? [];
  const grns = data?.grns ?? [];
  const invoices = data?.invoices ?? [];
  const payments = data?.payments ?? [];
  const pendingPaymentsCount = data?.pendingPayments ?? 0;

  const openRfqsCount = useMemo(() => {
    return rfqs.filter((r) => r.status !== "Cancelled").length;
  }, [rfqs]);

  const submittedCount = useMemo(
    () => quotations.filter((sq) => sq.status === "Submitted").length,
    [quotations]
  );

  const activePOsCount = useMemo(() => countActivePOs(pos), [pos]);

  const latestModified = useMemo(
    () => (rows: Array<{ modified?: string }>) =>
      rows.reduce<string | undefined>((best, row) => {
        if (!row.modified) return best;
        if (!best || row.modified > best) return row.modified;
        return best;
      }, undefined),
    []
  );

  if (!isReady || !isAuthenticated) {
    return (
      <SupplierPortalLayout>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
      </SupplierPortalLayout>
    );
  }

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">
          Welcome, {supplierName}
        </h1>
        <p className="text-sm text-neutral-600">
          Track RFQs, orders, goods receipts, invoices, and payments — full
          procure-to-pay visibility in one portal.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open RFQs"
          value={openRfqsCount}
          hint="Awaiting your quotation"
          icon={Inbox}
          tone="warning"
          loading={loading}
        />
        <StatCard
          label="Submitted Quotations"
          value={submittedCount}
          hint="Total quotations sent"
          icon={CheckCircle2}
          tone="success"
          loading={loading}
        />
        <StatCard
          label="Active Purchase Orders"
          value={activePOsCount}
          hint={`${pos.length} total POs`}
          icon={ShoppingCart}
          tone="info"
          loading={loading}
        />
        <StatCard
          label="Pending Payments"
          value={pendingPaymentsCount}
          hint="Invoices with balance"
          icon={CreditCard}
          tone="danger"
          loading={loading}
        />
      </div>

      {/* Quick navigation */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">
          Procurement Overview
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <QuickNavCard
            title="Purchase Orders"
            icon={ShoppingCart}
            to="/supplier/purchase-orders"
            total={pos.length}
            latestDate={latestModified(pos)}
            statusSummary={`${activePOsCount} active · ${pos.length - activePOsCount} completed`}
            loading={loading}
          />
          <QuickNavCard
            title="Goods Receipts"
            icon={Truck}
            to="/supplier/grn"
            total={grns.length}
            latestDate={latestModified(grns)}
            statusSummary={`${grns.filter((g) => g.status === "Completed").length} completed · ${grns.filter((g) => g.status === "Partial").length} partial`}
            loading={loading}
          />
          <QuickNavCard
            title="Invoices"
            icon={Receipt}
            to="/supplier/invoices"
            total={invoices.length}
            latestDate={latestModified(invoices)}
            statusSummary={`${invoices.filter((i) => i.status === "Paid").length} paid · ${pendingPaymentsCount} pending payment`}
            loading={loading}
          />
          <QuickNavCard
            title="Payments"
            icon={CreditCard}
            to="/supplier/payments"
            total={payments.length}
            latestDate={latestModified(payments)}
            statusSummary={`${payments.length} disbursements recorded`}
            loading={loading}
          />
        </div>
      </div>

      {/* Shortcuts */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-neutral-900">
                RFQs &amp; Quotations
              </h3>
            </div>
            <Link
              to="/supplier/rfqs"
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            {openRfqsCount} open RFQ{openRfqsCount === 1 ? "" : "s"} awaiting
            your response. {submittedCount} quotation
            {submittedCount === 1 ? "" : "s"} submitted.
          </p>
          <Link
            to="/supplier/rfqs"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent-700 hover:underline"
          >
            Go to My RFQs
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="card bg-gradient-to-br from-primary-50/80 to-white p-5">
          <h3 className="text-sm font-semibold text-neutral-900">
            Full lifecycle visibility
          </h3>
          <p className="mt-2 text-sm text-neutral-600">
            RFQ → Quotation → Purchase Order → GRN → Invoice → Payment. Monitor
            every stage without contacting procurement.
          </p>
          <Link
            to="/supplier/help-desk"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Open Help
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </SupplierPortalLayout>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  hint?: string;
  icon: typeof Inbox;
  tone: "warning" | "success" | "info" | "danger";
  loading?: boolean;
}

const TONE_BG: Record<StatCardProps["tone"], string> = {
  warning: "bg-warning-50 text-warning-700 ring-warning-200",
  success: "bg-accent-50 text-accent-700 ring-accent-200",
  info: "bg-primary-50 text-primary-700 ring-primary-200",
  danger: "bg-danger-50 text-danger-700 ring-danger-200",
};

const StatCard = memo(function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  loading,
}: StatCardProps) {
  return (
    <div className="card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          {label}
        </p>
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset ${TONE_BG[tone]}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-neutral-900">
        {loading ? (
          <span className="inline-block h-7 w-12 animate-pulse rounded bg-neutral-200/80" />
        ) : (
          value
        )}
      </p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
});
