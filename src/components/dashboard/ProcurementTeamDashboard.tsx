import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileSearch,
  FileText,
  GitBranch,
  PackageCheck,
  RefreshCw,
  ShoppingCart,
  Truck,
} from "lucide-react";

import { getPurchaseOrders, getGrnList } from "../../api/purchasing";
import { getRFQsPaged } from "../../api/sourcing";
import { getSuppliers } from "../../api/supplier";
import { fetchECRList } from "../../api/ecr";
import { fetchBusinessCases } from "../../api/businessIntake";
import { clmViewerKey, getClmList } from "../../api/clm";
import { getAllInvoices, getAllPayments } from "../../api/vouchers";
import {
  getECRCurrentStage,
  isECRActionableForRole,
} from "../../config/ecrQueues";
import { formatECRNumber } from "../../config/ecrRoles";
import { normalizeAppRole } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import type { PurchaseOrder } from "../../types/erpnext";
import { formatCurrency, formatDate } from "../../utils/format";
import StatusBadge from "../StatusBadge";
import { Skeleton } from "../Skeleton";
import PendingClmRequestsCard from "./PendingClmRequestsCard";

const DASHBOARD_STALE_MS = 30_000;

const DASHBOARD_QOPTS = {
  enabled: true,
  retry: 1,
  retryDelay: 1_200,
  staleTime: DASHBOARD_STALE_MS,
  refetchOnWindowFocus: false,
};

export default function ProcurementTeamDashboard() {
  const user = useAuthStore((s) => s.user);
  const canViewClmRequests = normalizeAppRole(user?.role) === "procurement_team";

  // Pagination for Recent POs
  const [poTablePage, setPoTablePage] = useState(1);
  const [poPageSize, setPoPageSize] = useState(5);

  // 1. Purchase Orders Query (PRIMARY)
  const poQuery = useQuery({
    queryKey: ["procurement-team-pos-main"],
    queryFn: () =>
      getPurchaseOrders({
        fields: [
          "name",
          "supplier",
          "supplier_name",
          "status",
          "transaction_date",
          "schedule_date",
          "grand_total",
          "currency",
          "per_received",
          "per_billed",
          "modified",
          "docstatus",
        ],
        limit_page_length: 100,
        order_by: "modified desc",
      }),
    ...DASHBOARD_QOPTS,
  });

  // 2. GRN List Query
  const grnQuery = useQuery({
    queryKey: ["procurement-team-grns-main"],
    queryFn: () => getGrnList({ limit: 100 }),
    ...DASHBOARD_QOPTS,
  });

  // 3. RFQ List Query
  const rfqQuery = useQuery({
    queryKey: ["procurement-team-rfqs-main"],
    queryFn: () => getRFQsPaged({ page: 1, pageSize: 50, order_by: "modified desc" }),
    ...DASHBOARD_QOPTS,
  });

  // 4. Suppliers Query
  const suppliersQuery = useQuery({
    queryKey: ["procurement-team-suppliers-main"],
    queryFn: () =>
      getSuppliers({
        filters: [["disabled", "=", 0]],
        fields: ["name", "supplier_name", "supplier_group", "country", "creation"],
        limit_page_length: 100,
      }),
    ...DASHBOARD_QOPTS,
  });

  // 5. ECR List Query (Secondary)
  const ecrQuery = useQuery({
    queryKey: ["procurement-team-ecrs-secondary"],
    queryFn: () => fetchECRList({ limit: 100 }),
    ...DASHBOARD_QOPTS,
  });

  // 6. Business Cases Query (Secondary)
  const bcQuery = useQuery({
    queryKey: ["procurement-team-bc-secondary"],
    queryFn: () => fetchBusinessCases(),
    ...DASHBOARD_QOPTS,
  });

  const clmRequestsQuery = useQuery({
    queryKey: ["clm", "list", "Contract Request", "procurement-team-pending", clmViewerKey()],
    queryFn: () => getClmList("Contract Request"),
    ...DASHBOARD_QOPTS,
    enabled: canViewClmRequests,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });

  // 7. Invoices Query
  const invoicesQuery = useQuery({
    queryKey: ["procurement-team-invoices-main"],
    queryFn: () => getAllInvoices(),
    ...DASHBOARD_QOPTS,
  });

  // 8. Payments Query
  const paymentsQuery = useQuery({
    queryKey: ["procurement-team-payments-main"],
    queryFn: () => getAllPayments(),
    ...DASHBOARD_QOPTS,
  });

  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  const isRefreshing =
    poQuery.isFetching ||
    grnQuery.isFetching ||
    rfqQuery.isFetching ||
    suppliersQuery.isFetching ||
    ecrQuery.isFetching ||
    bcQuery.isFetching ||
    invoicesQuery.isFetching ||
    paymentsQuery.isFetching ||
    clmRequestsQuery.isFetching;

  const handleRefresh = () => {
    setLastUpdated(new Date());
    void poQuery.refetch();
    void grnQuery.refetch();
    void rfqQuery.refetch();
    void suppliersQuery.refetch();
    void ecrQuery.refetch();
    void bcQuery.refetch();
    void invoicesQuery.refetch();
    void paymentsQuery.refetch();
    if (canViewClmRequests) void clmRequestsQuery.refetch();
  };

  const purchaseOrders = poQuery.data ?? [];
  const grns = grnQuery.data ?? [];
  const rfqs = rfqQuery.data?.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const ecrs = ecrQuery.data ?? [];
  const businessCases = bcQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];

  // Today ISO string for date comparisons (YYYY-MM-DD)
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const weekEndStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // -------------------------------------------------------------
  // PRIMARY PO CALCULATIONS & KPI METRICS
  // -------------------------------------------------------------
  const poMetrics = useMemo(() => {
    let pendingApprovalCount = 0;
    let activePosCount = 0;
    let pendingDeliveryCount = 0;

    let totalValue = 0;
    let approvedValue = 0;
    let pendingApprovalValue = 0;
    let openValue = 0;
    let receivedValue = 0;

    const statusCounts: Record<string, number> = {
      Draft: 0,
      "On Hold": 0,
      "To Receive and Bill": 0,
      "To Receive": 0,
      "To Bill": 0,
      Completed: 0,
      Closed: 0,
      Cancelled: 0,
    };

    for (const po of purchaseOrders) {
      const status = po.status || "Draft";
      const grandTotal = Number(po.grand_total || 0);
      const perReceived = Math.min(100, Math.max(0, Number(po.per_received || 0)));

      if (status in statusCounts) {
        statusCounts[status]++;
      } else {
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }

      totalValue += grandTotal;

      const isPendingAppr =
        status === "Draft" ||
        status === "On Hold" ||
        (po as any).docstatus === 0;

      const isCancelledOrClosed = status === "Cancelled" || status === "Closed";
      const isCompleted = status === "Completed" || perReceived >= 100;

      if (isPendingAppr) {
        pendingApprovalCount++;
        pendingApprovalValue += grandTotal;
      } else if (!isCancelledOrClosed) {
        approvedValue += grandTotal;
      }

      if (!isCancelledOrClosed && !isCompleted) {
        activePosCount++;
        const unreceivedFraction = (100 - perReceived) / 100;
        openValue += grandTotal * unreceivedFraction;
      }

      receivedValue += grandTotal * (perReceived / 100);

      const isAwaitingDelivery =
        (status === "To Receive and Bill" || status === "To Receive" || status === "To Bill") &&
        perReceived < 100;

      if (isAwaitingDelivery) {
        pendingDeliveryCount++;
      }
    }

    return {
      total: purchaseOrders.length,
      pendingApproval: pendingApprovalCount,
      active: activePosCount,
      pendingDelivery: pendingDeliveryCount,
      totalValue,
      approvedValue,
      pendingApprovalValue,
      openValue,
      receivedValue,
      statusCounts,
    };
  }, [purchaseOrders]);

  // Active RFQs count
  const activeRfqsCount = useMemo(() => {
    return rfqs.filter(
      (r) =>
        r.status === "Active" ||
        r.status === "Published" ||
        r.status === "Draft" ||
        r.status === "In Evaluation",
    ).length;
  }, [rfqs]);

  // ECRs actionable for Procurement Team
  const ecrReviewCount = useMemo(() => {
    return ecrs.filter((e) => isECRActionableForRole("procurement_team", e, user)).length;
  }, [ecrs, user]);

  // Pending Business Cases count
  const pendingBcCount = useMemo(() => {
    return businessCases.filter(
      (bc) =>
        bc.approval_status === "Pending Finance" ||
        bc.approval_status === "Pending Legal" ||
        bc.workflow_status === "Pending Finance Review" ||
        bc.workflow_status === "Pending Legal Review" ||
        bc.workflow_status === "Pending Procurement",
    ).length;
  }, [businessCases]);

  // -------------------------------------------------------------
  // POs REQUIRING ATTENTION
  // -------------------------------------------------------------
  const posRequiringAttention = useMemo(() => {
    const list: Array<{
      po: PurchaseOrder;
      reason: string;
      priority: "high" | "medium" | "low";
      badge: string;
      badgeColor: string;
    }> = [];

    for (const po of purchaseOrders) {
      const status = po.status || "Draft";
      const perReceived = Number(po.per_received || 0);
      const schedDate = po.schedule_date ? String(po.schedule_date).slice(0, 10) : "";

      // 1. Overdue Delivery
      if (
        schedDate &&
        schedDate < todayStr &&
        perReceived < 100 &&
        status !== "Draft" &&
        status !== "Cancelled" &&
        status !== "Closed"
      ) {
        list.push({
          po,
          reason: `Delivery overdue since ${formatDate(schedDate)}`,
          priority: "high",
          badge: "Overdue Delivery",
          badgeColor: "bg-rose-50 text-rose-700 border-rose-200",
        });
        continue;
      }

      // 2. Draft / Pending Approval
      if (status === "Draft" || status === "On Hold" || (po as any).docstatus === 0) {
        list.push({
          po,
          reason: "Pending procurement team review & issuance",
          priority: "medium",
          badge: "Pending Approval",
          badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
        });
        continue;
      }

      // 3. Awaiting GRN
      if ((status === "To Receive" || status === "To Receive and Bill") && perReceived === 0) {
        list.push({
          po,
          reason: "Supplier dispatched / warehouse awaiting physical delivery",
          priority: "medium",
          badge: "Awaiting GRN",
          badgeColor: "bg-sky-50 text-sky-700 border-sky-200",
        });
        continue;
      }

      // 4. Partially Received
      if (perReceived > 0 && perReceived < 100) {
        list.push({
          po,
          reason: `${perReceived}% received — awaiting remaining shipment`,
          priority: "low",
          badge: `Partial (${perReceived}%)`,
          badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
        });
      }
    }

    return list.slice(0, 6);
  }, [purchaseOrders, todayStr]);

  // -------------------------------------------------------------
  // PO DELIVERY & GRN MONITORING AGGREGATES
  // -------------------------------------------------------------
  const deliveryMetrics = useMemo(() => {
    let dueToday = 0;
    let dueThisWeek = 0;
    let overdue = 0;
    let awaitingGrn = 0;
    let partiallyReceived = 0;
    let fullyReceived = 0;

    for (const po of purchaseOrders) {
      const status = po.status || "Draft";
      const perReceived = Number(po.per_received || 0);
      const schedDate = po.schedule_date ? String(po.schedule_date).slice(0, 10) : "";

      if (perReceived >= 100 || status === "Completed") {
        fullyReceived++;
        continue;
      }

      if (perReceived > 0 && perReceived < 100) {
        partiallyReceived++;
      }

      if (status === "To Receive" || status === "To Receive and Bill") {
        awaitingGrn++;
      }

      if (schedDate && status !== "Draft" && status !== "Cancelled" && status !== "Closed") {
        if (schedDate < todayStr) {
          overdue++;
        } else if (schedDate === todayStr) {
          dueToday++;
        } else if (schedDate <= weekEndStr) {
          dueThisWeek++;
        }
      }
    }

    return {
      dueToday,
      dueThisWeek,
      overdue,
      awaitingGrn,
      partiallyReceived,
      fullyReceived,
    };
  }, [purchaseOrders, todayStr, weekEndStr]);

  // Paginated Recent POs Table
  const paginatedRecentPos = useMemo(() => {
    const start = (poTablePage - 1) * poPageSize;
    return purchaseOrders.slice(start, start + poPageSize);
  }, [purchaseOrders, poTablePage, poPageSize]);

  const totalPoPages = Math.max(1, Math.ceil(purchaseOrders.length / poPageSize));

  // Supplier activity aggregations
  const supplierActivity = useMemo(() => {
    const suppliersWithOpenPos = new Set<string>();
    const suppliersWithPendingDelivery = new Set<string>();

    for (const po of purchaseOrders) {
      if (po.supplier) {
        if (!["Completed", "Closed", "Cancelled"].includes(po.status || "")) {
          suppliersWithOpenPos.add(po.supplier);
        }
        if ((po.per_received || 0) < 100 && po.status !== "Cancelled" && po.status !== "Draft") {
          suppliersWithPendingDelivery.add(po.supplier);
        }
      }
    }

    return {
      total: suppliers.length,
      openPoSuppliers: suppliersWithOpenPos.size,
      pendingDeliverySuppliers: suppliersWithPendingDelivery.size,
    };
  }, [suppliers, purchaseOrders]);

  // Unified Chronological Activity Feed
  const recentActivities = useMemo(() => {
    const list: Array<{
      id: string;
      kind: "po" | "grn" | "rfq" | "ecr" | "supplier";
      label: string;
      subject: string;
      detail: string;
      date: string;
      status?: string;
    }> = [];

    for (const po of purchaseOrders.slice(0, 5)) {
      list.push({
        id: `po-${po.name}`,
        kind: "po",
        label: "Purchase Order Event",
        subject: po.name,
        detail: `${po.supplier} · ${formatCurrency(po.grand_total)}`,
        date: po.modified || po.transaction_date || "",
        status: po.status,
      });
    }

    for (const grn of grns.slice(0, 4)) {
      list.push({
        id: `grn-${grn.name}`,
        kind: "grn",
        label: "Goods Receipt Note (GRN)",
        subject: grn.name,
        detail: `${grn.supplier} · ${grn.total_qty || 0} items received`,
        date: grn.creation || grn.posting_date || "",
        status: grn.status,
      });
    }

    for (const rfq of rfqs.slice(0, 4)) {
      list.push({
        id: `rfq-${rfq.name}`,
        kind: "rfq",
        label: "RFQ Sourcing Event",
        subject: rfq.name,
        detail: "Sourcing quotation package in progress",
        date: rfq.modified || "",
        status: rfq.status || "Draft",
      });
    }

    for (const ecr of ecrs.slice(0, 3)) {
      list.push({
        id: `ecr-${ecr.name}`,
        kind: "ecr",
        label: "Engineering Change Request",
        subject: formatECRNumber(ecr),
        detail: ecr.ecr_title,
        date: ecr.modified || ecr.creation || "",
        status: getECRCurrentStage(ecr.select_pxfp, ecr),
      });
    }

    return list
      .filter((a) => a.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }, [purchaseOrders, grns, rfqs, ecrs]);

  // -------------------------------------------------------------
  // PROCUREMENT PIPELINE STAGES (8-Stage Workflow Flow)
  // -------------------------------------------------------------
  const pipelineStages = useMemo(() => {
    // Stage 1: Intake & Engineering
    const openBc = businessCases.filter(
      (bc) => bc.approval_status !== "Approved" && bc.workflow_status !== "Approved",
    ).length;
    const actionableEcrs = ecrs.filter((e) =>
      isECRActionableForRole("procurement_team", e, user),
    ).length;
    const intakeEngineeringCount = openBc + actionableEcrs;

    // Stage 2: Sourcing RFQs (active bidding packages before award)
    const sourcingRfqCount = rfqs.filter(
      (r) =>
        (r.status === "Draft" ||
          r.status === "Active" ||
          r.status === "Published" ||
          r.status === "In Evaluation") &&
        r.status !== "Supplier Selection" &&
        r.status !== "Awarded",
    ).length;

    // Stage 3: Supplier Selection & Award (quotes received, evaluating, or awarded prior to PO)
    const selectionAwardCount = rfqs.filter(
      (r) => r.status === "Supplier Selection" || r.status === "Awarded",
    ).length;

    // Stage 4: Conditional CLM (contract requests awaiting contract creation)
    const clmCount = (clmRequestsQuery.data?.records ?? []).filter(
      (cr) => cr.request_status !== "Completed" && cr.request_status !== "Cancelled",
    ).length;

    // Stage 5: Purchase Orders (active POs released or in flight)
    const activePoCount = purchaseOrders.filter((po) =>
      ["Draft", "To Receive and Bill", "To Receive", "To Bill"].includes(po.status || ""),
    ).length;

    // Stage 6: Goods Receipt (GRN awaiting delivery or inspection)
    const activeGrnCount =
      grns.filter((g) => g.status === "Draft" || g.status === "To Bill").length ||
      poMetrics.pendingDelivery;

    // Stage 7: Invoices (submitted/under review, not yet fully settled)
    const activeInvoiceCount = invoices.filter(
      (i) => i.status !== "paid" && i.status !== "rejected",
    ).length;

    // Stage 8: Payments (settled payment transactions)
    const settledPaymentsCount = payments.filter(
      (p) => p.status === "Completed" || p.status === "Paid",
    ).length;

    return [
      {
        id: "intake",
        title: "Intake & Eng.",
        description: "Open cases & ECRs",
        count: intakeEngineeringCount,
        to: "/ecr?filter=procurement-review",
        loading: bcQuery.isLoading || ecrQuery.isLoading,
        error: bcQuery.isError || ecrQuery.isError,
      },
      {
        id: "rfq",
        title: "Sourcing RFQs",
        description: "Active bidding events",
        count: sourcingRfqCount,
        to: "/sourcing/rfq?status=Active",
        loading: rfqQuery.isLoading,
        error: rfqQuery.isError,
      },
      {
        id: "award",
        title: "Selection & Award",
        description: "Quotes & evaluations",
        count: selectionAwardCount,
        to: "/sourcing/rfq?status=Supplier+Selection",
        loading: rfqQuery.isLoading,
        error: rfqQuery.isError,
      },
      {
        id: "clm",
        title: "Conditional CLM",
        description: "Contract execution",
        count: clmCount,
        to: "/contract-requests",
        loading: clmRequestsQuery.isLoading,
        error: clmRequestsQuery.isError,
      },
      {
        id: "po",
        title: "Purchase Orders",
        description: "Active issued orders",
        count: activePoCount,
        to: "/p2p/purchase-orders",
        loading: poQuery.isLoading,
        error: poQuery.isError,
      },
      {
        id: "grn",
        title: "Goods Receipt",
        description: "Delivery & inspection",
        count: activeGrnCount,
        to: "/p2p/grn?preset=pending",
        loading: grnQuery.isLoading || poQuery.isLoading,
        error: grnQuery.isError,
      },
      {
        id: "invoices",
        title: "Invoices",
        description: "3-way match & review",
        count: activeInvoiceCount,
        to: "/p2p/invoices",
        loading: invoicesQuery.isLoading,
        error: invoicesQuery.isError,
      },
      {
        id: "payments",
        title: "Payments",
        description: "Settled payments",
        count: settledPaymentsCount,
        to: "/p2p/payments",
        loading: paymentsQuery.isLoading,
        error: paymentsQuery.isError,
      },
    ];
  }, [
    businessCases,
    ecrs,
    user,
    rfqs,
    clmRequestsQuery.data?.records,
    purchaseOrders,
    grns,
    poMetrics.pendingDelivery,
    invoices,
    payments,
    bcQuery.isLoading,
    bcQuery.isError,
    ecrQuery.isLoading,
    ecrQuery.isError,
    rfqQuery.isLoading,
    rfqQuery.isError,
    clmRequestsQuery.isLoading,
    clmRequestsQuery.isError,
    poQuery.isLoading,
    poQuery.isError,
    grnQuery.isLoading,
    grnQuery.isError,
    invoicesQuery.isLoading,
    invoicesQuery.isError,
    paymentsQuery.isLoading,
    paymentsQuery.isError,
  ]);

  return (
    <div className="w-full box-border mx-auto max-w-[1440px] px-4 sm:px-6 md:px-8 py-6 space-y-6">
      {/* ================================================================ */}
      {/* 1. DASHBOARD HEADER                                              */}
      {/* ================================================================ */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px] leading-tight">
              Procurement Team Dashboard
            </h1>
            <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2.5 py-0.5 text-xs font-semibold text-primary-700">
              Procurement Team
            </span>
          </div>
          <p className="mt-1 text-[14px] text-slate-500 leading-normal">
            Monitor purchase orders, supplier delivery, sourcing and procurement activities.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
              Last Updated
            </span>
            <span className="text-xs font-semibold tabular-nums text-slate-700">
              {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-primary-600" : "text-slate-500"}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 2. MY PENDING ACTIONS (CLM & Contract Requests)                  */}
      {/* ================================================================ */}
      {canViewClmRequests && (
        <PendingClmRequestsCard
          records={clmRequestsQuery.data?.records ?? []}
          loading={clmRequestsQuery.isLoading}
          error={clmRequestsQuery.error}
          onRetry={handleRefresh}
        />
      )}

      {/* ================================================================ */}
      {/* 3. 6 PRIMARY KPI CARDS (Interactive Module Links)                */}
      {/* ================================================================ */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {/* 1. TOTAL PURCHASE ORDERS */}
        <Link
          to="/p2p/purchase-orders"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              TOTAL PURCHASE ORDERS
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 transition group-hover:bg-primary-100">
              <ShoppingCart className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-slate-900 leading-none">
              {poQuery.isError ? "—" : poQuery.isLoading ? "—" : poMetrics.total}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              {poQuery.isError ? "Error loading POs" : "All purchase orders"}
            </div>
          </div>
        </Link>

        {/* 2. PENDING PO APPROVAL */}
        <Link
          to="/p2p/purchase-orders?preset=pending"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              PENDING PO APPROVAL
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 transition group-hover:bg-amber-100">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-amber-700 leading-none">
              {poQuery.isError ? "—" : poQuery.isLoading ? "—" : poMetrics.pendingApproval}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              {poQuery.isError ? "Error loading" : "Awaiting approval"}
            </div>
          </div>
        </Link>

        {/* 3. ACTIVE PURCHASE ORDERS */}
        <Link
          to="/p2p/purchase-orders?status=To%20Receive%20and%20Bill"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              ACTIVE PURCHASE ORDERS
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition group-hover:bg-emerald-100">
              <PackageCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-emerald-700 leading-none">
              {poQuery.isError ? "—" : poQuery.isLoading ? "—" : poMetrics.active}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              {poQuery.isError ? "Error loading" : "Orders in progress"}
            </div>
          </div>
        </Link>

        {/* 4. PENDING GRN / DELIVERY */}
        <Link
          to="/p2p/grn?preset=pending"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              PENDING GRN / DELIVERY
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
              <Truck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-blue-700 leading-none">
              {poQuery.isError ? "—" : poQuery.isLoading ? "—" : poMetrics.pendingDelivery}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              {poQuery.isError ? "Error loading" : "Awaiting goods receipt"}
            </div>
          </div>
        </Link>

        {/* 5. ACTIVE RFQS */}
        <Link
          to="/sourcing/rfq?status=Active"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              ACTIVE RFQS
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 transition group-hover:bg-sky-100">
              <FileSearch className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-sky-700 leading-none">
              {rfqQuery.isError ? "—" : rfqQuery.isLoading ? "—" : activeRfqsCount}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              {rfqQuery.isError ? "Error loading" : "Sourcing in progress"}
            </div>
          </div>
        </Link>

        {/* 6. APPROVED SUPPLIERS */}
        <Link
          to="/suppliers?status=active"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              APPROVED SUPPLIERS
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 transition group-hover:bg-violet-100">
              <Building2 className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-violet-700 leading-none">
              {suppliersQuery.isError ? "—" : suppliersQuery.isLoading ? "—" : suppliers.length}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              {suppliersQuery.isError ? "Error loading" : "Approved suppliers"}
            </div>
          </div>
        </Link>
      </div>

      {/* ================================================================ */}
      {/* 4. PROCUREMENT PIPELINE (8 Sequential Lifecycle Stages)          */}
      {/* ================================================================ */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary-600" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                PROCUREMENT PIPELINE
              </h2>
              <span className="rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                8 Workflow Stages
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              End-to-end lifecycle progression: intake and engineering changes, sourcing, quotes evaluation & award, conditional CLM, purchase order fulfillment, warehouse receiving, invoice match, and payment.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {pipelineStages.map((stage, idx) => (
            <Link
              key={stage.id}
              to={stage.to}
              className="group relative flex flex-col justify-between rounded-lg border border-slate-200/80 bg-slate-50/50 p-2.5 transition hover:-translate-y-0.5 hover:border-primary-400 hover:bg-white hover:shadow-2xs"
            >
              <div>
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 mb-1">
                  <span>STAGE 0{idx + 1}</span>
                  <ArrowRight className="h-3 w-3 text-primary-600 opacity-0 transition group-hover:opacity-100" />
                </div>
                <span className="text-xs font-bold text-slate-800 group-hover:text-primary-700 transition block truncate">
                  {stage.title}
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">
                  {stage.description}
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-200/60 flex items-baseline justify-between">
                <span className="text-[10px] uppercase font-semibold text-slate-400">Records</span>
                <span className="text-base font-bold tabular-nums text-slate-900 group-hover:text-primary-700 transition">
                  {stage.loading ? "—" : stage.error ? "—" : stage.count}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ================================================================ */}
      {/* 3. PRIMARY SECTION — PURCHASE ORDER CONTROL CENTER               */}
      {/* ================================================================ */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-5">
        {/* Section Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary-600" />
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                PURCHASE ORDER CONTROL CENTER
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Track purchase orders from approval through delivery and GRN.
            </p>
          </div>
          <Link
            to="/p2p/purchase-orders"
            className="text-xs font-semibold text-primary-600 hover:text-primary-700"
          >
            View all purchase orders →
          </Link>
        </div>

        {/* PO Status Summary Chips */}
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
            STATUS BREAKDOWN
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {[
              { label: "Draft", key: "Draft", bg: "bg-slate-50 hover:bg-slate-100 border-slate-200" },
              { label: "On Hold", key: "On Hold", bg: "bg-amber-50/70 hover:bg-amber-100/70 border-amber-200 text-amber-800" },
              { label: "To Receive & Bill", key: "To Receive and Bill", bg: "bg-blue-50/70 hover:bg-blue-100/70 border-blue-200 text-blue-800" },
              { label: "To Receive", key: "To Receive", bg: "bg-sky-50/70 hover:bg-sky-100/70 border-sky-200 text-sky-800" },
              { label: "To Bill", key: "To Bill", bg: "bg-indigo-50/70 hover:bg-indigo-100/70 border-indigo-200 text-indigo-800" },
              { label: "Completed", key: "Completed", bg: "bg-emerald-50/70 hover:bg-emerald-100/70 border-emerald-200 text-emerald-800" },
              { label: "Closed", key: "Closed", bg: "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700" },
              { label: "Cancelled", key: "Cancelled", bg: "bg-rose-50/70 hover:bg-rose-100/70 border-rose-200 text-rose-800" },
            ].map((st) => (
              <Link
                key={st.key}
                to="/p2p/purchase-orders"
                className={`flex flex-col justify-between rounded-lg border p-2.5 transition text-center ${st.bg}`}
              >
                <span className="text-[11px] font-semibold truncate">{st.label}</span>
                <span className="text-lg font-bold tabular-nums mt-1">
                  {poQuery.isLoading ? "—" : poMetrics.statusCounts[st.key] || 0}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* PO Financial Value Summary Grid */}
        <div className="rounded-lg bg-slate-50/70 border border-slate-200/80 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-2.5">
            PO VALUE & FINANCIAL SUMMARY
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="rounded-lg bg-white p-3 border border-slate-200 shadow-2xs">
              <span className="text-[11px] text-slate-500 block font-medium">Total PO Value</span>
              <span className="text-base font-bold text-slate-900 tabular-nums mt-0.5 block">
                {poQuery.isLoading ? "—" : formatCurrency(poMetrics.totalValue)}
              </span>
            </div>
            <div className="rounded-lg bg-white p-3 border border-emerald-100 shadow-2xs">
              <span className="text-[11px] text-emerald-700 block font-medium">Approved PO Value</span>
              <span className="text-base font-bold text-emerald-800 tabular-nums mt-0.5 block">
                {poQuery.isLoading ? "—" : formatCurrency(poMetrics.approvedValue)}
              </span>
            </div>
            <div className="rounded-lg bg-white p-3 border border-amber-100 shadow-2xs">
              <span className="text-[11px] text-amber-700 block font-medium">Pending Approval</span>
              <span className="text-base font-bold text-amber-800 tabular-nums mt-0.5 block">
                {poQuery.isLoading ? "—" : formatCurrency(poMetrics.pendingApprovalValue)}
              </span>
            </div>
            <div className="rounded-lg bg-white p-3 border border-blue-100 shadow-2xs">
              <span className="text-[11px] text-blue-700 block font-medium">Open Order Value</span>
              <span className="text-base font-bold text-blue-800 tabular-nums mt-0.5 block">
                {poQuery.isLoading ? "—" : formatCurrency(poMetrics.openValue)}
              </span>
            </div>
            <div className="rounded-lg bg-white p-3 border border-purple-100 shadow-2xs">
              <span className="text-[11px] text-purple-700 block font-medium">Received Value</span>
              <span className="text-base font-bold text-purple-800 tabular-nums mt-0.5 block">
                {poQuery.isLoading ? "—" : formatCurrency(poMetrics.receivedValue)}
              </span>
            </div>
          </div>
        </div>

        {/* POs Requiring Attention Subsection */}
        {posRequiringAttention.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                PURCHASE ORDERS REQUIRING ATTENTION ({posRequiringAttention.length})
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {posRequiringAttention.map(({ po, reason, badge, badgeColor }) => (
                <div
                  key={po.name}
                  className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-primary-300"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                        className="font-mono text-xs font-bold text-primary-700 hover:underline"
                      >
                        {po.name}
                      </Link>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${badgeColor}`}>
                        {badge}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-900 truncate">
                      {po.supplier}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {reason}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                    <span className="font-bold text-slate-900">
                      {formatCurrency(po.grand_total)}
                    </span>
                    <Link
                      to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                      className="inline-flex items-center gap-1 font-semibold text-primary-600 hover:text-primary-700"
                    >
                      Review <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Purchase Orders Table */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              RECENT PURCHASE ORDERS
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">
              Showing {paginatedRecentPos.length} of {purchaseOrders.length} records
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            {poQuery.isLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded" />
                ))}
              </div>
            ) : purchaseOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <ShoppingCart className="h-8 w-8 text-slate-300 mb-2" />
                <h4 className="text-xs font-bold text-slate-800">No purchase orders found</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Orders created by the team will appear in this control center.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs min-w-[760px]">
                <thead className="bg-slate-50/80 border-b border-slate-200">
                  <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-2.5 pr-3 pl-3">PO #</th>
                    <th className="px-3 py-2.5">Supplier</th>
                    <th className="px-3 py-2.5">PO Date</th>
                    <th className="px-3 py-2.5">Total Amount</th>
                    <th className="px-3 py-2.5">Expected Delivery</th>
                    <th className="px-3 py-2.5">Received %</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="py-2.5 pr-3 pl-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {paginatedRecentPos.map((po) => {
                    const perReceived = Number(po.per_received || 0);
                    return (
                      <tr key={po.name} className="hover:bg-slate-50/80 transition h-11">
                        <td className="py-2.5 pr-3 pl-3 font-mono font-bold text-primary-700">
                          <Link
                            to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                            className="hover:underline"
                          >
                            {po.name}
                          </Link>
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5 font-medium text-slate-900 truncate" title={po.supplier}>
                          {po.supplier}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {formatDate(po.transaction_date)}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-900">
                          {formatCurrency(po.grand_total)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {formatDate(po.schedule_date)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  perReceived >= 100
                                    ? "bg-emerald-500"
                                    : perReceived > 0
                                      ? "bg-blue-500"
                                      : "bg-slate-300"
                                }`}
                                style={{ width: `${perReceived}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] text-slate-600 font-medium">
                              {perReceived}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={po.status || "Draft"} size="sm" />
                        </td>
                        <td className="py-2.5 pr-3 pl-3 text-right">
                          <Link
                            to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-primary-50 hover:text-primary-700 transition"
                          >
                            <Eye className="h-3 w-3" /> View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination Footer */}
          {purchaseOrders.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span>Rows per page:</span>
                <select
                  value={poPageSize}
                  onChange={(e) => {
                    setPoPageSize(Number(e.target.value));
                    setPoTablePage(1);
                  }}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
                <span className="ml-2">
                  Showing {Math.min((poTablePage - 1) * poPageSize + 1, purchaseOrders.length)}–
                  {Math.min(poTablePage * poPageSize, purchaseOrders.length)} of {purchaseOrders.length} POs
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={poTablePage <= 1}
                  onClick={() => setPoTablePage((p) => Math.max(1, p - 1))}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 font-medium text-slate-700">
                  {poTablePage} / {totalPoPages}
                </span>
                <button
                  type="button"
                  disabled={poTablePage >= totalPoPages}
                  onClick={() => setPoTablePage((p) => Math.min(totalPoPages, p + 1))}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* 4. PO DELIVERY & GRN MONITORING SECTION                          */}
      {/* ================================================================ */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                PO DELIVERY & GRN MONITORING
              </h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 uppercase">
                Read Only
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Delivery schedules, fulfillment tracking and warehouse goods receipt notes.
            </p>
          </div>
          <Link
            to="/p2p/grn"
            className="text-xs font-semibold text-primary-600 hover:text-primary-700"
          >
            Open GRN Monitor →
          </Link>
        </div>

        {/* Delivery Metrics Grid */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-lg bg-amber-50/70 border border-amber-200 p-3 text-center">
            <span className="text-[11px] text-amber-800 block font-medium">Due Today</span>
            <span className="text-xl font-bold text-amber-900 tabular-nums mt-0.5 block">
              {deliveryMetrics.dueToday}
            </span>
          </div>
          <div className="rounded-lg bg-blue-50/70 border border-blue-200 p-3 text-center">
            <span className="text-[11px] text-blue-800 block font-medium">Due This Week</span>
            <span className="text-xl font-bold text-blue-900 tabular-nums mt-0.5 block">
              {deliveryMetrics.dueThisWeek}
            </span>
          </div>
          <div className="rounded-lg bg-rose-50/70 border border-rose-200 p-3 text-center">
            <span className="text-[11px] text-rose-800 block font-medium">Overdue Delivery</span>
            <span className="text-xl font-bold text-rose-900 tabular-nums mt-0.5 block">
              {deliveryMetrics.overdue}
            </span>
          </div>
          <div className="rounded-lg bg-sky-50/70 border border-sky-200 p-3 text-center">
            <span className="text-[11px] text-sky-800 block font-medium">Awaiting GRN</span>
            <span className="text-xl font-bold text-sky-900 tabular-nums mt-0.5 block">
              {deliveryMetrics.awaitingGrn}
            </span>
          </div>
          <div className="rounded-lg bg-purple-50/70 border border-purple-200 p-3 text-center">
            <span className="text-[11px] text-purple-800 block font-medium">Partially Received</span>
            <span className="text-xl font-bold text-purple-900 tabular-nums mt-0.5 block">
              {deliveryMetrics.partiallyReceived}
            </span>
          </div>
          <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3 text-center">
            <span className="text-[11px] text-emerald-800 block font-medium">Fully Received</span>
            <span className="text-xl font-bold text-emerald-900 tabular-nums mt-0.5 block">
              {deliveryMetrics.fullyReceived}
            </span>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 5. ACTIVE RFQs & SOURCING (Secondary to PO)                      */}
      {/* ================================================================ */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-sky-600" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                ACTIVE RFQs & SOURCING
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Supplier bidding events, invitations and quotation packages ({rfqs.length} total events).
            </p>
          </div>
          <Link
            to="/sourcing/rfq"
            className="text-xs font-semibold text-primary-600 hover:text-primary-700"
          >
            View all RFQs →
          </Link>
        </div>

        <div className="overflow-x-auto pt-2">
          {rfqQuery.isLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : rfqs.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No active RFQ sourcing events found.
            </div>
          ) : (
            <table className="w-full text-left text-xs min-w-[680px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-2.5 pr-3 pl-1">RFQ #</th>
                  <th className="px-3 py-2.5">Title / Scope</th>
                  <th className="px-3 py-2.5">Modified Date</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="py-2.5 pr-1 pl-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rfqs.slice(0, 4).map((rfq) => (
                  <tr key={rfq.name} className="hover:bg-slate-50/70 transition h-11">
                    <td className="py-2.5 pr-3 pl-1 font-mono font-bold text-primary-700">
                      <Link to={`/sourcing/rfq/${encodeURIComponent(rfq.name)}`} className="hover:underline">
                        {rfq.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-slate-800 font-medium">
                      RFQ Sourcing Package
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {formatDate(rfq.modified)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={rfq.status || "Draft"} size="sm" />
                    </td>
                    <td className="py-2.5 pr-1 pl-3 text-right">
                      <Link
                        to={`/sourcing/rfq/${encodeURIComponent(rfq.name)}`}
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-primary-50 hover:text-primary-700 transition"
                      >
                        <Eye className="h-3 w-3" /> View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* 6. SUPPLIER ACTIVITY & ECR / BUSINESS CASE (2 Columns)           */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Supplier Activity */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  SUPPLIER ACTIVITY
                </h2>
                <p className="text-xs text-slate-500">Approved vendor directory & engagement</p>
              </div>
              <Link
                to="/suppliers"
                className="text-xs font-semibold text-primary-600 hover:text-primary-700"
              >
                Directory →
              </Link>
            </div>

            {/* Badges Grid */}
            <div className="mt-3.5 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-50 p-2.5 text-center border border-slate-100">
                <span className="text-[11px] text-slate-500 block font-medium">Active Vendors</span>
                <span className="text-lg font-bold text-slate-900 tabular-nums">{supplierActivity.total}</span>
              </div>
              <div className="rounded-lg bg-emerald-50/70 p-2.5 text-center border border-emerald-100">
                <span className="text-[11px] text-emerald-700 block font-medium">With Open POs</span>
                <span className="text-lg font-bold text-emerald-800 tabular-nums">{supplierActivity.openPoSuppliers}</span>
              </div>
              <div className="rounded-lg bg-blue-50/70 p-2.5 text-center border border-blue-100">
                <span className="text-[11px] text-blue-700 block font-medium">Pending Delivery</span>
                <span className="text-lg font-bold text-blue-800 tabular-nums">{supplierActivity.pendingDeliverySuppliers}</span>
              </div>
            </div>

            {/* Suppliers Mini List */}
            <div className="mt-4 divide-y divide-slate-100">
              {suppliers.slice(0, 3).map((sup) => (
                <div key={sup.name} className="py-2 flex items-center justify-between text-xs">
                  <div className="min-w-0 pr-2">
                    <p className="font-semibold text-slate-900 truncate">{sup.supplier_name || sup.name}</p>
                    <p className="text-[11px] text-slate-500">{sup.supplier_group || "Direct Supplier"} · {sup.country || "Global"}</p>
                  </div>
                  <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                    Approved
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: ECR & Business Case Overview (Secondary) */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  ECR & BUSINESS INTAKE (SECONDARY)
                </h2>
                <p className="text-xs text-slate-500">Engineering changes & business cases</p>
              </div>
              <Link
                to="/ecr?filter=procurement-review"
                className="text-xs font-semibold text-primary-600 hover:text-primary-700"
              >
                ECR Queue →
              </Link>
            </div>

            {/* Badges Grid */}
            <div className="mt-3.5 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-amber-50/70 p-2.5 text-center border border-amber-100">
                <span className="text-[11px] text-amber-700 block font-medium">ECRs To Review</span>
                <span className="text-lg font-bold text-amber-800 tabular-nums">{ecrReviewCount}</span>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5 text-center border border-slate-100">
                <span className="text-[11px] text-slate-500 block font-medium">Total ECRs</span>
                <span className="text-lg font-bold text-slate-900 tabular-nums">{ecrs.length}</span>
              </div>
              <div className="rounded-lg bg-purple-50/70 p-2.5 text-center border border-purple-100">
                <span className="text-[11px] text-purple-700 block font-medium">Pending Intake</span>
                <span className="text-lg font-bold text-purple-800 tabular-nums">{pendingBcCount}</span>
              </div>
            </div>

            {/* Mini List */}
            <div className="mt-4 divide-y divide-slate-100">
              {ecrs.slice(0, 3).map((ecr) => (
                <div key={ecr.name} className="py-2 flex items-center justify-between text-xs">
                  <div className="min-w-0 pr-2">
                    <p className="font-semibold text-slate-900 truncate">{ecr.ecr_title}</p>
                    <p className="text-[11px] font-mono text-slate-500">{formatECRNumber(ecr)} · {formatDate(ecr.modified)}</p>
                  </div>
                  <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                    {getECRCurrentStage(ecr.select_pxfp, ecr)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 7. RECENT PROCUREMENT ACTIVITY FEED                              */}
      {/* ================================================================ */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="border-b border-slate-100 pb-3 mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              RECENT PROCUREMENT ACTIVITY
            </h2>
            <p className="text-xs text-slate-500">Live operational events across POs, GRNs, RFQs, Suppliers & ECRs</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
          {recentActivities.map((act) => (
            <div
              key={act.id}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 shadow-2xs">
                {act.kind === "po" ? (
                  <ShoppingCart className="h-3.5 w-3.5 text-primary-600" />
                ) : act.kind === "grn" ? (
                  <Truck className="h-3.5 w-3.5 text-blue-600" />
                ) : act.kind === "rfq" ? (
                  <FileSearch className="h-3.5 w-3.5 text-sky-600" />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-amber-600" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 truncate">{act.label}</p>
                <p className="text-[11px] font-mono text-primary-700 truncate">{act.subject}</p>
                <p className="text-[11px] text-slate-500 truncate">{act.detail}</p>
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{formatDate(act.date)}</span>
                  {act.status ? <span className="font-medium text-slate-600">{act.status}</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
