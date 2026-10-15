import { Link } from "react-router-dom";
import {
  CheckCircle2,
  ChevronRight,
  FileCode,
  FileSpreadsheet,
  Layers,
  ShoppingCart,
  Users,
} from "lucide-react";

export interface Pipeline6StageCounts {
  // 1. Intake
  materialRequests?: number;
  businessCases?: number;

  // 2. Engineering
  ecrs?: number;

  // 3. Sourcing
  rfqs?: number;
  rfis?: number;
  rfps?: number;
  reverseBids?: number;

  // 4. Supplier
  supplierResponses?: number;
  onboardings?: number;
  evaluations?: number;

  // 5. Procurement
  purchaseOrders?: number;
  legalReviews?: number;
  financeReviews?: number;
  supplierSelections?: number;

  // 6. Completion
  completed?: number;
}

interface Props {
  counts?: Pipeline6StageCounts;
  loading?: boolean;
}

export default function ProcurementPipelineSection({
  counts = {},
  loading = false,
}: Props) {
  const stages = [
    {
      id: "intake",
      stageNumber: "01",
      name: "INTAKE",
      subtitle: "Demand & Intake",
      mainCount: (counts.materialRequests ?? 0) + (counts.businessCases ?? 0),
      icon: FileSpreadsheet,
      accentColor: "text-[#1554D1] bg-[#EEF4FF] border-[#BFDBFE]",
      badgeBg: "bg-[#EEF4FF] text-[#1554D1]",
      route: "/material-requests/procurement",
      items: [
        { label: "MRs", count: counts.materialRequests ?? 0, route: "/material-requests/procurement" },
        { label: "Business Cases", count: counts.businessCases ?? 0, route: "/intake/business-cases" },
      ],
    },
    {
      id: "engineering",
      stageNumber: "02",
      name: "ENGINEERING",
      subtitle: "Change Requests",
      mainCount: counts.ecrs ?? 0,
      icon: FileCode,
      accentColor: "text-[#7C3AED] bg-[#F5F3FF] border-[#DDD6FE]",
      badgeBg: "bg-[#F5F3FF] text-[#7C3AED]",
      route: "/ecr",
      items: [
        { label: "ECRs", count: counts.ecrs ?? 0, route: "/ecr" },
      ],
    },
    {
      id: "sourcing",
      stageNumber: "03",
      name: "SOURCING",
      subtitle: "Quotes & Bids",
      mainCount:
        (counts.rfqs ?? 0) +
        (counts.rfis ?? 0) +
        (counts.rfps ?? 0) +
        (counts.reverseBids ?? 0),
      icon: Layers,
      accentColor: "text-[#0284C7] bg-[#F0F9FF] border-[#BAE6FD]",
      badgeBg: "bg-[#F0F9FF] text-[#0284C7]",
      route: "/sourcing/rfq",
      items: [
        { label: "RFQs", count: counts.rfqs ?? 0, route: "/sourcing/rfq" },
        { label: "RFI", count: counts.rfis ?? 0, route: "/sourcing/rfi" },
        { label: "RFP", count: counts.rfps ?? 0, route: "/sourcing/rfp" },
        { label: "Reverse Bids", count: counts.reverseBids ?? 0, route: "/reverse-bidding" },
      ],
    },
    {
      id: "supplier",
      stageNumber: "04",
      name: "SUPPLIER",
      subtitle: "Responses & Onboarding",
      mainCount:
        (counts.supplierResponses ?? 0) +
        (counts.onboardings ?? 0) +
        (counts.evaluations ?? 0),
      icon: Users,
      accentColor: "text-[#0D9488] bg-[#F0FDFA] border-[#99F6E4]",
      badgeBg: "bg-[#F0FDFA] text-[#0D9488]",
      route: "/sourcing/rfq?status=Supplier+Response",
      items: [
        { label: "Responses", count: counts.supplierResponses ?? 0, route: "/sourcing/rfq?status=Supplier+Response" },
        { label: "Onboarding", count: counts.onboardings ?? 0, route: "/supplier/onboarding" },
        { label: "Evaluation", count: counts.evaluations ?? 0, route: "/sourcing/rfq?status=Evaluation" },
      ],
    },
    {
      id: "procurement",
      stageNumber: "05",
      name: "PROCUREMENT",
      subtitle: "Award & Ordering",
      mainCount: counts.purchaseOrders ?? 0,
      icon: ShoppingCart,
      accentColor: "text-[#2563EB] bg-[#EFF6FF] border-[#BFDBFE]",
      badgeBg: "bg-[#EFF6FF] text-[#2563EB]",
      route: "/p2p/purchase-orders",
      items: [
        { label: "POs", count: counts.purchaseOrders ?? 0, route: "/p2p/purchase-orders" },
        { label: "Selections", count: counts.supplierSelections ?? 0, route: "/sourcing/rfq?status=Supplier+Selection" },
        { label: "Reviews", count: (counts.legalReviews ?? 0) + (counts.financeReviews ?? 0), route: "/sourcing/rfq" },
      ],
    },
    {
      id: "completion",
      stageNumber: "06",
      name: "COMPLETION",
      subtitle: "Closed & Fulfilled",
      mainCount: counts.completed ?? 0,
      icon: CheckCircle2,
      accentColor: "text-[#059669] bg-[#F0FDF4] border-[#A7F3D0]",
      badgeBg: "bg-[#F0FDF4] text-[#059669]",
      route: "/sourcing/rfq?status=Closed",
      items: [
        { label: "Completed", count: counts.completed ?? 0, route: "/sourcing/rfq?status=Closed" },
      ],
    },
  ];

  return (
    <section aria-labelledby="procurement-pipeline-heading" className="w-full">
      {/* Section Header */}
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2
            id="procurement-pipeline-heading"
            className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]"
          >
            Procurement Pipeline
          </h2>
          <span className="rounded-full bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-bold text-[#2563EB]">
            6-Stage Management Flow
          </span>
        </div>
      </div>

      {/* 6 Stage Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const isLast = idx === stages.length - 1;

          return (
            <div
              key={stage.id}
              className="group relative flex flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white p-4 shadow-sm transition-all hover:border-[#1554D1]/40 hover:shadow-md"
            >
              <div>
                {/* Stage Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-[#94A3B8]">
                      {stage.stageNumber}
                    </span>
                    <span className="text-[12.5px] font-extrabold tracking-wide text-[#12213F]">
                      {stage.name}
                    </span>
                  </div>

                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${stage.accentColor}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                </div>

                {/* Primary Metric */}
                <div className="mt-3">
                  <Link
                    to={stage.route}
                    className="flex items-baseline gap-1.5 no-underline hover:opacity-80 transition-opacity"
                  >
                    <span className="text-[24px] font-extrabold tracking-tight text-[#12213F]">
                      {loading ? "…" : stage.mainCount}
                    </span>
                    <span className="text-[11.5px] font-semibold text-[#64748B]">
                      total
                    </span>
                  </Link>
                </div>

                {/* Supporting Metrics List */}
                <div className="mt-3 space-y-1.5 border-t border-[#F1F5F9] pt-2.5 text-[12px]">
                  {stage.items.map((sub) => (
                    <Link
                      key={sub.label}
                      to={sub.route}
                      className="flex items-center justify-between text-[#475569] hover:text-[#1554D1] no-underline transition-colors"
                    >
                      <span className="text-[11.5px]">{sub.label}</span>
                      <span className="rounded bg-[#F8FAFC] border border-[#E2E8F0] px-1.5 py-0.2 text-[11px] font-bold text-[#12213F]">
                        {loading ? "…" : sub.count}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Action Link Footer */}
              <div className="mt-3 pt-2 border-t border-[#F1F5F9] flex items-center justify-between">
                <Link
                  to={stage.route}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1554D1] hover:underline"
                >
                  <span>Open stage</span>
                  <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>

              {/* Connecting Chevron on Large Screens (except last card) */}
              {!isLast && (
                <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10 h-5 w-5 items-center justify-center rounded-full bg-white border border-[#CBD5E1] text-[#94A3B8] shadow-xs pointer-events-none">
                  <ChevronRight className="h-3 w-3" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
