import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { fetchProcurementDashboardKpis, fetchProcurementSecondaryAnalytics } from "../../api/dashboard";
import { dashPerfLog, timedDashApi } from "../../api/dashboardPerf";
import { fetchProcurementAnalytics } from "../../api/procurementAnalytics";
import { fetchECRList } from "../../api/ecr";
import { fetchRfqListKpis } from "../../api/rfqListKpiData";
import { getSuppliers } from "../../api/supplier";
import { getRfiStats } from "../../api/rfi";
import { getRfpStats } from "../../api/rfp";
import { getReverseBiddingStats, listReverseBiddingsPaged } from "../../api/reverseBidding";
import { getOnboardingStats, listOnboardings } from "../../api/supplierOnboarding";
import { fetchBusinessCases } from "../../api/businessIntake";
import { getPurchaseOrders } from "../../api/purchasing";
import { getBudgetDashboard } from "../../api/budgetDashboard";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import { useProcurementBadges } from "../../hooks/useProcurementBadges";
import { getECRCurrentStage, isECRActionableForRole, getECRListActionLabel, getECRListActionRoute } from "../../config/ecrQueues";
import { fetchProcurementQueue, getLinkedRfqName } from "../../api/materialRequestWorkflow";
import { getRFQsPaged } from "../../api/sourcing";
import { isMrOverdue, differenceInCalendarDays } from "../../utils/materialRequestProcurementStatus";
import { normalizeWorkflowStatus } from "../../types/materialRequestWorkflow";
import { formatDate, formatCurrencyCompact } from "../../utils/format";
import {
  computeMonthlyPoSpend,
  buildBucketedCategorySpend,
  PROCUREMENT_SPEND_CATEGORY_COLORS,
} from "../../utils/procurementExecutiveMetrics";

import ProcurementOverviewKpis, { type OverviewKpiCounts } from "./ProcurementOverviewKpis";
import MyActionsSection from "./MyActionsSection";
import ProcurementPipelineSection, { type Pipeline6StageCounts } from "./ProcurementPipelineSection";
import MaterialRequestsSummarySection from "./MaterialRequestsSummarySection";
import BusinessCasesAndEcrSection from "./BusinessCasesAndEcrSection";
import RfqManagementSummarySection from "./RfqManagementSummarySection";
import RfiRfpAndReverseBiddingSection from "./RfiRfpAndReverseBiddingSection";
import SupplierManagementSummarySection from "./SupplierManagementSummarySection";
import SpendAndFinanceSection from "./SpendAndFinanceSection";
import PurchaseOrdersMonitoringSection from "./PurchaseOrdersMonitoringSection";
import RfqStatusPipelineCard, { type StageData } from "./RfqStatusPipelineCard";
import UrgentOverdueTable, { type UrgentItem } from "./UrgentOverdueTable";
import RecentProcurementActivitySection, { type ActivityRow } from "./RecentProcurementActivitySection";

interface Props {
  greetingName?: string;
}

export default function ProcurementDashboard({ greetingName = "Procurement Manager" }: Props) {
  useEffect(() => {
    dashPerfLog("Procurement Dashboard mounted");
  }, []);

  const badges = useProcurementBadges();

  // 1. KPI & Analytics Queries
  const kpisQuery = useQuery({
    queryKey: ["procurement-dashboard-kpis"],
    queryFn: () =>
      timedDashApi("Dashboard API (KPI snapshot)", () =>
        fetchProcurementDashboardKpis(),
      ),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const rfqKpisQuery = useQuery({
    queryKey: ["rfq-list-kpis-dashboard"],
    queryFn: () => fetchRfqListKpis(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const rfqListQuery = useQuery({
    queryKey: ["procurement-dashboard-rfq-list"],
    queryFn: () => getRFQsPaged({ page: 1, pageSize: 50, order_by: "modified desc" }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const mrQuery = useQuery({
    queryKey: ["mr-procurement-queue", { includeWithRfq: true }],
    queryFn: () => fetchProcurementQueue({ includeWithRfq: true }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const bcQuery = useQuery({
    queryKey: ["procurement-dashboard-business-cases"],
    queryFn: () => fetchBusinessCases(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const ecrQuery = useQuery({
    queryKey: ["ecr-urgent-dashboard-list"],
    queryFn: () => fetchECRList({ limit: 100 }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const rfiStatsQuery = useQuery({
    queryKey: ["rfi-stats-dashboard"],
    queryFn: () => getRfiStats(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const rfpStatsQuery = useQuery({
    queryKey: ["rfp-stats-dashboard"],
    queryFn: () => getRfpStats(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const rbStatsQuery = useQuery({
    queryKey: ["reverse-bidding-stats-dashboard"],
    queryFn: () => getReverseBiddingStats(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const rbListQuery = useQuery({
    queryKey: ["reverse-biddings-dashboard-list"],
    queryFn: () => listReverseBiddingsPaged({ page: 1, pageSize: 10 }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const suppliersQuery = useQuery({
    queryKey: ["procurement-dashboard-suppliers-count"],
    queryFn: async () => {
      const list = await getSuppliers({
        filters: [["disabled", "=", 0]],
        fields: ["name", "disabled"],
        limit_page_length: 500,
      });
      return list.length;
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const onboardingStatsQuery = useQuery({
    queryKey: ["onboarding-stats-dashboard"],
    queryFn: () => getOnboardingStats(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const onboardingListQuery = useQuery({
    queryKey: ["onboarding-list-dashboard"],
    queryFn: () => listOnboardings(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const poQuery = useQuery({
    queryKey: ["procurement-dashboard-pos"],
    queryFn: () => getPurchaseOrders({ limit_page_length: 100 }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const budgetQuery = useQuery({
    queryKey: ["procurement-dashboard-budget"],
    queryFn: () => getBudgetDashboard({ maxBudgets: 8 }),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const analyticsQuery = useQuery({
    queryKey: ["procurement-dashboard-charts"],
    queryFn: () =>
      timedDashApi("Dashboard API (secondary charts)", () =>
        fetchProcurementSecondaryAnalytics(),
      ),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const procAnalyticsQuery = useQuery({
    queryKey: ["procurement-dashboard-analytics-kpis"],
    queryFn: () =>
      timedDashApi("Dashboard API (analytics KPIs)", () =>
        fetchProcurementAnalytics(),
      ),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // 1. Overview KPIs
  const ytdSpendVal = kpisQuery.data?.ytdSpend;
  const totalSpendDisplay =
    ytdSpendVal != null ? formatCurrencyCompact(ytdSpendVal) : null;

  const activeRfqsCount = rfqKpisQuery.data
    ? rfqKpisQuery.data.total - rfqKpisQuery.data.closed
    : kpisQuery.data?.openRfqs ?? null;

  const suppliersCount =
    suppliersQuery.data ?? kpisQuery.data?.activeSuppliers ?? null;

  const openRfiCount = rfiStatsQuery.data
    ? rfiStatsQuery.data.published + rfiStatsQuery.data.underReview
    : null;
  const openRfpCount = rfpStatsQuery.data
    ? rfpStatsQuery.data.published + rfpStatsQuery.data.underReview
    : null;

  const pendingBcApprovals = useMemo(() => {
    return (
      bcQuery.data?.filter((c) => {
        const st = (c.workflow_status || (c as { status?: string }).status || "").toLowerCase();
        return st.includes("pending") || st.includes("review") || st.includes("submitted");
      }).length ?? 0
    );
  }, [bcQuery.data]);

  const overviewCounts: OverviewKpiCounts = {
    materialRequests: mrQuery.data?.length ?? 0,
    businessCases: bcQuery.data?.length ?? 0,
    ecrs: ecrQuery.data?.length ?? 0,
    activeRfqs: activeRfqsCount,
    openRfi: openRfiCount,
    openRfp: openRfpCount,
    reverseBids: rbStatsQuery.data?.live ?? 0,
    suppliers: suppliersCount,
    supplierOnboarding: onboardingStatsQuery.data?.pending_review ?? 0,
    purchaseOrders: poQuery.data?.length ?? 0,
    totalSpend: totalSpendDisplay,
    pendingApprovals: (badges.quotesAwaitingEvaluation || 0) + pendingBcApprovals,
  };

  // 2. My Actions Counts
  const mrsAwaitingAction = useMemo(() => {
    if (!mrQuery.data) return 0;
    return mrQuery.data.filter((m) => {
      const wfStatus = normalizeWorkflowStatus(m.custom_bidsphere_status || m.status);
      const hasRFQ = Boolean(m.custom_linked_rfq) || wfStatus === "RFQ Created";
      return !hasRFQ && wfStatus !== "Completed" && wfStatus !== "Cancelled";
    }).length;
  }, [mrQuery.data]);

  // 3. 6-Stage Management Pipeline Counts
  const pipelineCounts: Pipeline6StageCounts = useMemo(() => {
    const rfqs = rfqListQuery.data?.data || [];
    const evaluationCount =
      badges.quotesAwaitingEvaluation ||
      rfqs.filter((r) => r.status === "Evaluation" || r.status === "Supplier Response").length;
    const supplierSelectionCount = rfqs.filter((r) => r.status === "Supplier Selection").length;
    const legalCount = rfqs.filter((r) => r.status === "Legal Review").length;
    const financeCount = rfqs.filter((r) => r.status === "Finance Review").length;

    return {
      materialRequests: mrQuery.data?.length ?? 0,
      businessCases: bcQuery.data?.length ?? 0,
      ecrs: ecrQuery.data?.length ?? 0,
      rfqs: rfqKpisQuery.data?.total ?? rfqs.length,
      rfis: rfiStatsQuery.data?.total ?? 0,
      rfps: rfpStatsQuery.data?.total ?? 0,
      reverseBids: rbStatsQuery.data?.total ?? rbListQuery.data?.data?.length ?? 0,
      supplierResponses: badges.supplierResponses || 0,
      onboardings: onboardingStatsQuery.data?.total ?? onboardingListQuery.data?.length ?? 0,
      evaluations: evaluationCount,
      purchaseOrders: poQuery.data?.length ?? 0,
      legalReviews: legalCount,
      financeReviews: financeCount,
      supplierSelections: supplierSelectionCount,
      completed: rfqKpisQuery.data?.closed ?? 0,
    };
  }, [
    mrQuery.data,
    bcQuery.data,
    ecrQuery.data,
    rfqKpisQuery.data,
    rfqListQuery.data,
    rfiStatsQuery.data,
    rfpStatsQuery.data,
    rbStatsQuery.data,
    rbListQuery.data,
    badges,
    onboardingStatsQuery.data,
    onboardingListQuery.data,
    poQuery.data,
  ]);

  // 4. Monthly Spend Trend
  const monthlySpendData = useMemo(() => {
    const poSamples = analyticsQuery.data?.poSamples || [];
    if (poSamples.length === 0) return [];
    return computeMonthlyPoSpend(poSamples);
  }, [analyticsQuery.data?.poSamples]);

  // 5. Spend by Category
  const spendByCategoryData = useMemo(() => {
    const items = analyticsQuery.data?.invoiceItems || [];
    if (items.length === 0) return [];
    const bucketed = buildBucketedCategorySpend(items);
    return bucketed.map((b) => ({
      name: b.category,
      value: Math.round(b.pct),
      amount: formatCurrencyCompact(b.spend),
      color:
        PROCUREMENT_SPEND_CATEGORY_COLORS[
          b.category as keyof typeof PROCUREMENT_SPEND_CATEGORY_COLORS
        ] || "#64748B",
    }));
  }, [analyticsQuery.data?.invoiceItems]);

  // 6. RFQ Status Pipeline Stages
  const rfqPipelineStages: StageData[] = useMemo(() => {
    const recentRfqs = analyticsQuery.data?.recentRfqs || [];
    if (recentRfqs.length === 0 && !badges.rfqsPendingPublication) {
      return [];
    }

    const counts: Record<string, number> = {
      Draft: badges.rfqsPendingPublication || 0,
      Published: 0,
      Responses: badges.supplierResponses || 0,
      Evaluation: badges.quotesAwaitingEvaluation || 0,
      Awarded: 0,
      Closed: 0,
    };

    for (const r of recentRfqs) {
      const st = (r.status ?? "").toLowerCase();
      if (st === "draft") counts.Draft += 1;
      else if (st === "published" || st === "open" || st === "submitted") counts.Published += 1;
      else if (st === "responses" || st === "response received") counts.Responses += 1;
      else if (st === "evaluation" || st === "under evaluation") counts.Evaluation += 1;
      else if (st === "awarded" || st === "ordered") counts.Awarded += 1;
      else if (st === "closed") counts.Closed += 1;
    }

    return [
      { name: "Draft", count: counts.Draft, color: "#94A3B8" },
      { name: "Published", count: counts.Published, color: "#1554D1" },
      { name: "Responses", count: counts.Responses, color: "#2563EB" },
      { name: "Evaluation", count: counts.Evaluation, color: "#D97706" },
      { name: "Awarded", count: counts.Awarded, color: "#059669" },
      { name: "Closed", count: counts.Closed, color: "#475569" },
    ].filter((s) => s.count > 0);
  }, [
    analyticsQuery.data?.recentRfqs,
    badges.rfqsPendingPublication,
    badges.supplierResponses,
    badges.quotesAwaitingEvaluation,
  ]);

  // 7. Urgent & Overdue Items (All entities)
  const urgentItems: UrgentItem[] = useMemo(() => {
    const items: UrgentItem[] = [];
    const today = new Date();

    // Material Requests
    if (mrQuery.data && Array.isArray(mrQuery.data)) {
      for (const mr of mrQuery.data) {
        const wfStatus = normalizeWorkflowStatus(mr.custom_bidsphere_status || mr.status);
        const hasRFQ = Boolean(mr.custom_linked_rfq || getLinkedRfqName(mr)) || wfStatus === "RFQ Created";
        if (hasRFQ || wfStatus === "Completed" || wfStatus === "Cancelled") continue;

        const isOverdue = isMrOverdue(mr.schedule_date, wfStatus, hasRFQ, today);
        const priority = (mr.custom_priority as "High" | "Medium" | "Low") || "Medium";
        const daysPast = mr.schedule_date ? differenceInCalendarDays(today, new Date(mr.schedule_date)) : 0;

        if (
          isOverdue ||
          priority === "High" ||
          wfStatus === "Forwarded to Procurement" ||
          wfStatus === "Procurement Required"
        ) {
          const firstItem = mr.items?.[0];
          const title =
            mr.remarks?.trim() ||
            (mr as { custom_remarks?: string }).custom_remarks?.trim() ||
            (firstItem?.item_name
              ? `${firstItem.item_name}${mr.items && mr.items.length > 1 ? ` (+${mr.items.length - 1} items)` : ""}`
              : "Material Request");

          items.push({
            id: mr.name || "mr",
            type: "MR",
            code: mr.name || "MR",
            title,
            status: "Awaiting RFQ Creation",
            statusTone: isOverdue ? "rose" : "amber",
            priority,
            dueDate: mr.schedule_date ? formatDate(mr.schedule_date) : "—",
            overdueText: isOverdue ? `${daysPast} days` : "Action required",
            isOverdue,
            assignedTo: mr.custom_requested_by || mr.owner || mr.custom_department || "Department User",
            actionText: "Create RFQ",
            actionRoute: `/sourcing/rfq/new?mr=${encodeURIComponent(mr.name || "")}`,
          });
        }
      }
    }

    // Business Cases
    if (bcQuery.data && Array.isArray(bcQuery.data)) {
      for (const bc of bcQuery.data) {
        const st = (bc.workflow_status || (bc as { status?: string }).status || "").toLowerCase();
        if (st.includes("pending") || st.includes("review") || st.includes("submitted")) {
          const bcModified = (bc as { modified?: string }).modified;
          items.push({
            id: bc.name || "bc",
            type: "Approval",
            code: bc.name || "BC",
            title: bc.title || "Business Case",
            status: bc.workflow_status || "Pending Approval",
            statusTone: "amber",
            priority: "High",
            dueDate: bcModified ? formatDate(bcModified) : "—",
            overdueText: "Review required",
            isOverdue: false,
            assignedTo: (bc as { owner?: string }).owner || "Finance / Legal",
            actionText: "Review",
            actionRoute: `/intake/business-cases/${encodeURIComponent(bc.name || "")}`,
          });
        }
      }
    }

    // ECRs
    if (ecrQuery.data && Array.isArray(ecrQuery.data)) {
      const awaitingRfq = ecrQuery.data.filter((ecr) => isECRActionableForRole("procurement", ecr));

      for (const ecr of awaitingRfq) {
        const targetDate = ecr.target_implementation_date;
        const daysPast = targetDate ? differenceInCalendarDays(today, new Date(targetDate)) : 0;
        const isOverdue = targetDate ? daysPast > 0 : false;
        const priority = (ecr.priority as "High" | "Medium" | "Low") || "High";

        items.push({
          id: ecr.name || "ecr",
          type: "ECR",
          code: ecr.name || "ECR",
          title: ecr.ecr_title || ecr.chnage_description || "Engineering Change Request",
          status: getECRCurrentStage(ecr.select_pxfp, ecr),
          statusTone: isOverdue ? "rose" : "amber",
          priority,
          dueDate: targetDate ? formatDate(targetDate) : (ecr.modified?.slice(0, 10) || "—"),
          overdueText: isOverdue ? `${daysPast} days` : "Action required",
          isOverdue,
          assignedTo: greetingName || "Procurement Manager",
          actionText: getECRListActionLabel("procurement", ecr) === "Create RFQ" ? "Create RFQ" : "Review",
          actionRoute: getECRListActionRoute("procurement", ecr),
        });
      }
    }

    // RFQs & Quotes
    const rfqs = rfqListQuery.data?.data || analyticsQuery.data?.recentRfqs || [];
    for (const rfq of rfqs) {
      const st = rfq.status || "Draft";
      if (st === "Cancelled" || st === "PO Created" || st === "Closed") continue;

      const deadline = (rfq as { custom_submission_deadline?: string; schedule_date?: string; transaction_date?: string }).custom_submission_deadline || (rfq as { schedule_date?: string }).schedule_date || (rfq as { transaction_date?: string }).transaction_date;
      const daysPast = deadline ? differenceInCalendarDays(today, new Date(deadline)) : 0;
      const isOverdue = deadline ? daysPast > 0 : false;
      const isEvaluation = st === "Evaluation" || st === "Supplier Response" || st === "Supplier Selection";
      const isDraft = st === "Draft" || st === "Supplier Invitation";

      if (isOverdue || isDraft || isEvaluation) {
        items.push({
          id: rfq.name || "rfq",
          type: isEvaluation ? "Quote" : "RFQ",
          code: rfq.name || "RFQ",
          title: (rfq as { title?: string }).title || `RFQ ${rfq.name}`,
          status: isDraft ? "Draft" : isEvaluation ? "Under Evaluation" : st,
          statusTone: isOverdue ? "rose" : isDraft ? "slate" : "blue",
          priority: isOverdue ? "High" : "Medium",
          dueDate: deadline ? formatDate(deadline) : (rfq.modified?.slice(0, 10) || "—"),
          overdueText: isOverdue ? `${daysPast} days` : isDraft ? "Draft" : "Under review",
          isOverdue,
          assignedTo: (rfq as { owner?: string }).owner || greetingName || "Procurement Manager",
          actionText: isEvaluation ? "Evaluate Quotes" : "View RFQ",
          actionRoute: `/sourcing/rfq/${encodeURIComponent(rfq.name || "")}`,
        });
      }
    }

    return items.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      if (a.priority === "High" && b.priority !== "High") return -1;
      if (a.priority !== "High" && b.priority === "High") return 1;
      return 0;
    });
  }, [
    mrQuery.data,
    bcQuery.data,
    ecrQuery.data,
    rfqListQuery.data,
    analyticsQuery.data?.recentRfqs,
    greetingName,
  ]);

  // 8. Recent Procurement Activity Log (derived chronologically)
  const recentActivities: ActivityRow[] = useMemo(() => {
    const list: ActivityRow[] = [];

    // MRs
    for (const mr of (mrQuery.data || []).slice(0, 4)) {
      list.push({
        id: `mr-${mr.name || "mr"}`,
        dateTime: mr.modified ? formatDate(mr.modified) : "Recent",
        type: "MR",
        reference: mr.name || "MR",
        activity: `Material Request updated (${mr.material_request_type || "Purchase"})`,
        user: mr.custom_requested_by || mr.owner || "Warehouse",
        status: normalizeWorkflowStatus(mr.custom_bidsphere_status || mr.status) || "Draft",
        route: `/material-requests/${encodeURIComponent(mr.name || "")}`,
      });
    }

    // Business Cases
    for (const bc of (bcQuery.data || []).slice(0, 3)) {
      const bcMod = (bc as { modified?: string }).modified;
      list.push({
        id: `bc-${bc.name || "bc"}`,
        dateTime: bcMod ? formatDate(bcMod) : "Recent",
        type: "Business Case",
        reference: bc.name || "BC",
        activity: `Business Case: ${bc.title || bc.name || "Case"}`,
        user: (bc as { owner?: string }).owner || "Department Lead",
        status: bc.workflow_status || "Submitted",
        route: `/intake/business-cases/${encodeURIComponent(bc.name || "")}`,
      });
    }

    // ECRs
    for (const ecr of (ecrQuery.data || []).slice(0, 3)) {
      list.push({
        id: `ecr-${ecr.name || "ecr"}`,
        dateTime: ecr.modified ? formatDate(ecr.modified) : "Recent",
        type: "ECR",
        reference: ecr.name || "ECR",
        activity: `Engineering Change Request: ${ecr.ecr_title || ecr.name || "ECR"}`,
        user: ecr.owner || "Engineering",
        status: ecr.select_pxfp || "Active",
        route: `/ecr/${encodeURIComponent(ecr.name || "")}`,
      });
    }

    // RFQs
    for (const rfq of (rfqListQuery.data?.data || []).slice(0, 4)) {
      list.push({
        id: `rfq-${rfq.name || "rfq"}`,
        dateTime: rfq.modified ? formatDate(rfq.modified) : "Recent",
        type: "RFQ",
        reference: rfq.name || "RFQ",
        activity: `RFQ stage: ${rfq.status || "Draft"}`,
        user: rfq.owner || "Procurement Manager",
        status: rfq.status || "Active",
        route: `/sourcing/rfq/${encodeURIComponent(rfq.name || "")}`,
      });
    }

    // Onboardings
    for (const ob of (onboardingListQuery.data || []).slice(0, 3)) {
      list.push({
        id: `ob-${ob.name || "ob"}`,
        dateTime: ob.creation ? formatDate(ob.creation) : "Recent",
        type: "Onboarding",
        reference: ob.name || "Onboarding",
        activity: `Supplier onboarding for ${ob.company_name || ob.name || "Vendor"}`,
        user: ob.created_by_user || "Vendor Admin",
        status: (ob.status as string) || "Pending",
        route: `/supplier/onboarding/${encodeURIComponent(ob.name || "")}`,
      });
    }

    // Reverse Bids
    for (const rb of (rbListQuery.data?.data || []).slice(0, 2)) {
      list.push({
        id: `rb-${rb.name || "rb"}`,
        dateTime: rb.modified ? formatDate(rb.modified) : "Recent",
        type: "Reverse Bid",
        reference: rb.name || "Auction",
        activity: `Reverse auction ${rb.auction_status || "Event"}`,
        user: rb.owner || "Procurement",
        status: rb.auction_status || "Draft",
        route: `/reverse-bidding/${encodeURIComponent(rb.name || "")}`,
      });
    }

    return list.slice(0, 8);
  }, [
    mrQuery.data,
    bcQuery.data,
    ecrQuery.data,
    rfqListQuery.data,
    onboardingListQuery.data,
    rbListQuery.data,
  ]);

  const handleRefreshAll = () => {
    void kpisQuery.refetch();
    void rfqKpisQuery.refetch();
    void rfqListQuery.refetch();
    void mrQuery.refetch();
    void bcQuery.refetch();
    void ecrQuery.refetch();
    void rfiStatsQuery.refetch();
    void rfpStatsQuery.refetch();
    void rbStatsQuery.refetch();
    void rbListQuery.refetch();
    void suppliersQuery.refetch();
    void onboardingStatsQuery.refetch();
    void onboardingListQuery.refetch();
    void poQuery.refetch();
    void budgetQuery.refetch();
    void analyticsQuery.refetch();
    void procAnalyticsQuery.refetch();
  };

  const isAnyFetching =
    kpisQuery.isFetching ||
    rfqKpisQuery.isFetching ||
    rfqListQuery.isFetching ||
    mrQuery.isFetching ||
    bcQuery.isFetching ||
    ecrQuery.isFetching ||
    suppliersQuery.isFetching;

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-6 bg-[#F5F7FA] font-[Inter,-apple-system,BlinkMacSystemFont,sans-serif] pb-12">
      {/* 1. TOP HEADER */}
      <header className="flex flex-col gap-3 rounded-[10px] border border-[#E2E8F0] bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-[#12213F]">
            Procurement Manager Dashboard
          </h1>
          <p className="mt-0.5 text-[13px] text-[#64748B]">
            Monitor procurement intake, sourcing, suppliers, approvals, spend and procurement activities across the organization.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right text-[12px] sm:block">
            <span className="font-semibold text-[#12213F]">{currentDate}</span>
            <p className="text-[11px] text-[#64748B]">Live Control Tower</p>
          </div>

          <button
            type="button"
            onClick={handleRefreshAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#12213F] transition-colors hover:bg-[#F8FAFC]"
            title="Refresh dashboard data"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                isAnyFetching ? "animate-spin text-[#1554D1]" : "text-[#64748B]"
              }`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* 2. EXECUTIVE KPI OVERVIEW (12 Cards) */}
      <ProcurementOverviewKpis
        counts={overviewCounts}
        loading={kpisQuery.isLoading || mrQuery.isLoading || bcQuery.isLoading}
      />

      {/* 3. REQUIRES MY ATTENTION */}
      <MyActionsSection
        mrsAwaitingAction={mrsAwaitingAction}
        businessCasesAwaitingApproval={pendingBcApprovals}
        ecrsAwaitingAction={badges.rfqsToCreate}
        rfqsToCreate={badges.rfqsToCreate}
        rfqsPendingPublication={badges.rfqsPendingPublication}
        supplierResponses={badges.supplierResponses}
        quotesAwaitingEvaluation={badges.quotesAwaitingEvaluation}
        supplierOnboardingAwaitingReview={onboardingStatsQuery.data?.pending_review ?? 0}
        reverseBidsRequiringAction={rbStatsQuery.data?.live ?? 0}
        pendingApprovals={badges.quotesAwaitingEvaluation}
      />

      {/* 4. 6-STAGE PROCUREMENT PIPELINE */}
      <ProcurementPipelineSection
        counts={pipelineCounts}
        loading={mrQuery.isLoading || rfqListQuery.isLoading}
      />

      {/* 5. MATERIAL REQUESTS INTAKE */}
      <MaterialRequestsSummarySection
        mrs={mrQuery.data || []}
        loading={mrQuery.isLoading}
      />

      {/* 6. BUSINESS CASES & ECR (Two-Column) */}
      <BusinessCasesAndEcrSection
        businessCases={bcQuery.data || []}
        ecrs={ecrQuery.data || []}
        loading={bcQuery.isLoading || ecrQuery.isLoading}
      />

      {/* 7. RFQ MANAGEMENT */}
      <RfqManagementSummarySection
        kpis={rfqKpisQuery.data}
        rfqs={rfqListQuery.data?.data || []}
        loading={rfqListQuery.isLoading}
      />

      {/* 8. RFI / RFP & REVERSE BIDDING (Two-Column) */}
      <RfiRfpAndReverseBiddingSection
        rfiStats={rfiStatsQuery.data}
        rfpStats={rfpStatsQuery.data}
        reverseBids={rbListQuery.data?.data || []}
        reverseBiddingStats={rbStatsQuery.data}
        loading={rfiStatsQuery.isLoading || rbStatsQuery.isLoading}
      />

      {/* 9. SUPPLIER MANAGEMENT & ONBOARDING */}
      <SupplierManagementSummarySection
        suppliersCount={suppliersCount}
        onboardingStats={onboardingStatsQuery.data}
        onboardings={onboardingListQuery.data || []}
        loading={suppliersQuery.isLoading || onboardingListQuery.isLoading}
      />

      {/* 10. SPEND & FINANCE */}
      <SpendAndFinanceSection
        totalSpendDisplay={totalSpendDisplay}
        totalBudget={budgetQuery.data?.kpis?.totalBudget ?? 0}
        consumedBudget={budgetQuery.data?.kpis?.consumedBudget ?? 0}
        utilizationPct={budgetQuery.data?.kpis?.utilizationPct ?? 0}
        purchaseOrders={poQuery.data || []}
        monthlySpendData={monthlySpendData}
        spendByCategoryData={spendByCategoryData}
        loading={budgetQuery.isLoading || analyticsQuery.isLoading}
      />

      {/* 11. PURCHASE ORDERS MONITORING (Secondary Read-Only) */}
      <PurchaseOrdersMonitoringSection
        purchaseOrders={poQuery.data || []}
        loading={poQuery.isLoading}
      />

      {/* 12. RFQ STATUS PIPELINE ANALYTICS */}
      <section aria-labelledby="rfq-pipeline-heading" className="w-full">
        <div className="mb-2.5 flex items-center justify-between">
          <h2
            id="rfq-pipeline-heading"
            className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]"
          >
            RFQ Status Analytics
          </h2>
        </div>
        <div className="w-full">
          <RfqStatusPipelineCard stages={rfqPipelineStages} />
        </div>
      </section>

      {/* 12. URGENT & OVERDUE ITEMS */}
      <UrgentOverdueTable
        items={urgentItems}
        isLoading={mrQuery.isLoading && ecrQuery.isLoading && rfqListQuery.isLoading}
        isError={mrQuery.isError && ecrQuery.isError && rfqListQuery.isError}
        onRetry={handleRefreshAll}
      />

      {/* 13. RECENT PROCUREMENT ACTIVITY */}
      <RecentProcurementActivitySection
        activities={recentActivities}
        loading={mrQuery.isLoading || rfqListQuery.isLoading}
      />
    </div>
  );
}
