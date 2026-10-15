import { Link } from "react-router-dom";
import {
  Briefcase,
  DollarSign,
  FileCode,
  FileSpreadsheet,
  FileText,
  Gavel,
  Layers,
  Scale,
  ShoppingCart,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";

export interface OverviewKpiCounts {
  materialRequests?: number | null;
  businessCases?: number | null;
  ecrs?: number | null;
  activeRfqs?: number | null;
  openRfi?: number | null;
  openRfp?: number | null;
  reverseBids?: number | null;
  suppliers?: number | string | null;
  supplierOnboarding?: number | null;
  purchaseOrders?: number | null;
  totalSpend?: string | null;
  pendingApprovals?: number | null;
}

interface Props {
  counts?: OverviewKpiCounts;
  loading?: boolean;
}

export default function ProcurementOverviewKpis({
  counts = {},
  loading = false,
}: Props) {
  const cards = [
    {
      id: "mr-kpi",
      title: "Material Requests",
      value: counts.materialRequests ?? 0,
      subtext: "Plant & warehouse demand",
      icon: FileSpreadsheet,
      iconBg: "bg-[#EEF4FF] text-[#1554D1]",
      route: "/material-requests/procurement",
      showTrend: false,
    },
    {
      id: "bc-kpi",
      title: "Business Cases",
      value: counts.businessCases ?? 0,
      subtext: "Intake & procurement approvals",
      icon: FileText,
      iconBg: "bg-[#EFF6FF] text-[#2563EB]",
      route: "/intake/business-cases",
      showTrend: false,
    },
    {
      id: "ecr-kpi",
      title: "ECR / Engineering",
      value: counts.ecrs ?? 0,
      subtext: "Engineering change requests",
      icon: FileCode,
      iconBg: "bg-[#F5F3FF] text-[#7C3AED]",
      route: "/ecr",
      showTrend: false,
    },
    {
      id: "rfq-kpi",
      title: "Active RFQs",
      value: counts.activeRfqs ?? 0,
      subtext: "Published & under evaluation",
      icon: Layers,
      iconBg: "bg-[#EFF6FF] text-[#2563EB]",
      route: "/sourcing/rfq",
      showTrend: false,
    },
    {
      id: "rfi-kpi",
      title: "Open RFI",
      value: counts.openRfi ?? 0,
      subtext: "Information requests active",
      icon: Briefcase,
      iconBg: "bg-[#FDF2F8] text-[#DB2777]",
      route: "/sourcing/rfi",
      showTrend: false,
    },
    {
      id: "rfp-kpi",
      title: "Open RFP",
      value: counts.openRfp ?? 0,
      subtext: "Proposal solicitations active",
      icon: Scale,
      iconBg: "bg-[#FFF1F2] text-[#E11D48]",
      route: "/sourcing/rfp",
      showTrend: false,
    },
    {
      id: "reverse-bidding-kpi",
      title: "Reverse Bidding",
      value: counts.reverseBids ?? 0,
      subtext: "Live & scheduled auctions",
      icon: Gavel,
      iconBg: "bg-[#FFFBEB] text-[#D97706]",
      route: "/reverse-bidding",
      showTrend: false,
    },
    {
      id: "suppliers-kpi",
      title: "Active Suppliers",
      value: counts.suppliers ?? 0,
      subtext: "Approved master vendors",
      icon: Users,
      iconBg: "bg-[#ECFDF5] text-[#059669]",
      route: "/suppliers",
      showTrend: false,
    },
    {
      id: "onboarding-kpi",
      title: "Supplier Onboarding",
      value: counts.supplierOnboarding ?? 0,
      subtext: "Pending intake verification",
      icon: UserPlus,
      iconBg: "bg-[#F0FDFA] text-[#0D9488]",
      route: "/supplier/onboarding",
      showTrend: false,
    },
    {
      id: "po-kpi",
      title: "Purchase Orders",
      value: counts.purchaseOrders ?? 0,
      subtext: "Approved procurement orders",
      icon: ShoppingCart,
      iconBg: "bg-[#F8FAFC] text-[#475569]",
      route: "/p2p/purchase-orders",
      showTrend: false,
    },
    {
      id: "spend-kpi",
      title: "Total Spend (YTD)",
      value: counts.totalSpend ?? "$0",
      subtext: "Committed spend to date",
      icon: DollarSign,
      iconBg: "bg-[#F0FDF4] text-[#16A34A]",
      route: "/p2p/total-spend",
      showTrend: false,
    },
    {
      id: "approvals-kpi",
      title: "Pending Approvals",
      value: counts.pendingApprovals ?? 0,
      subtext: "Action required by manager",
      icon: UserCheck,
      iconBg: "bg-[#FEF2F2] text-[#DC2626]",
      route: "/sourcing/rfq?status=Evaluation",
      showTrend: false,
    },
  ];

  return (
    <section aria-labelledby="procurement-overview-heading" className="w-full">
      <div className="mb-2.5 flex items-center justify-between">
        <h2
          id="procurement-overview-heading"
          className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]"
        >
          Procurement Overview
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.id}
              to={card.route}
              className="group flex flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white p-3.5 shadow-sm transition-all hover:border-[#1554D1]/40 hover:shadow-md no-underline"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-bold text-[#64748B] uppercase tracking-wider line-clamp-1">
                  {card.title}
                </span>
                <div className={`flex h-7 w-7 items-center justify-center rounded-md ${card.iconBg}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
              </div>

              <div className="mt-2">
                <span className="text-[20px] font-extrabold tracking-tight text-[#12213F]">
                  {loading ? "…" : card.value}
                </span>
                <p className="mt-0.5 text-[11px] text-[#94A3B8] line-clamp-1">
                  {card.subtext}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
