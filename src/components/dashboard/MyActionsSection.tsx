import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Clock,
  FileCheck,
  FileCode,
  FileSpreadsheet,
  FileText,
  Gavel,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

interface Props {
  mrsAwaitingAction?: number;
  businessCasesAwaitingApproval?: number;
  ecrsAwaitingAction?: number;
  rfqsToCreate?: number;
  rfqsPendingPublication?: number;
  supplierResponses?: number;
  quotesAwaitingEvaluation?: number;
  supplierOnboardingAwaitingReview?: number;
  reverseBidsRequiringAction?: number;
  pendingApprovals?: number;
}

export default function MyActionsSection({
  mrsAwaitingAction = 0,
  businessCasesAwaitingApproval = 0,
  ecrsAwaitingAction = 0,
  rfqsPendingPublication = 0,
  supplierResponses = 0,
  quotesAwaitingEvaluation = 0,
  supplierOnboardingAwaitingReview = 0,
  reverseBidsRequiringAction = 0,
  pendingApprovals = 0,
}: Props) {
  const actions = [
    {
      id: "mr-action",
      label: "MRs Awaiting Action",
      desc: "Material requests forwarded to procurement",
      count: mrsAwaitingAction,
      icon: FileSpreadsheet,
      iconBg: "bg-[#EEF4FF] text-[#1554D1]",
      route: "/material-requests/procurement",
      actionText: "Process MRs",
      badgeColor: "bg-[#FEF2F2] text-[#DC2626]",
    },
    {
      id: "bc-action",
      label: "Business Cases",
      desc: "Sourcing intake cases pending review/approval",
      count: businessCasesAwaitingApproval,
      icon: FileText,
      iconBg: "bg-[#EFF6FF] text-[#2563EB]",
      route: "/intake/business-cases",
      actionText: "Review Cases",
      badgeColor: "bg-[#FFFBEB] text-[#D97706]",
    },
    {
      id: "ecr-action",
      label: "ECRs Awaiting RFQ",
      desc: "Approved engineering changes ready for sourcing",
      count: ecrsAwaitingAction,
      icon: FileCode,
      iconBg: "bg-[#F5F3FF] text-[#7C3AED]",
      route: "/ecr",
      actionText: "View ECRs",
      badgeColor: "bg-[#FEF2F2] text-[#DC2626]",
    },
    {
      id: "rfq-drafts",
      label: "RFQs Awaiting Publication",
      desc: "Draft RFQs ready for supplier invitation",
      count: rfqsPendingPublication,
      icon: Clock,
      iconBg: "bg-[#F1F5F9] text-[#475569]",
      route: "/sourcing/rfq?status=Draft",
      actionText: "Publish RFQs",
      badgeColor: "bg-[#FFFBEB] text-[#D97706]",
    },
    {
      id: "supplier-responses",
      label: "Supplier Responses Received",
      desc: "New quotes and proposals submitted by vendors",
      count: supplierResponses,
      icon: FileCheck,
      iconBg: "bg-[#ECFDF5] text-[#059669]",
      route: "/sourcing/rfq?status=Supplier+Response",
      actionText: "View Responses",
      badgeColor: "bg-[#EFF6FF] text-[#2563EB]",
    },
    {
      id: "quotes-eval",
      label: "Quotes Awaiting Evaluation",
      desc: "Completed bids ready for matrix comparison",
      count: quotesAwaitingEvaluation,
      icon: ShieldCheck,
      iconBg: "bg-[#FFFBEB] text-[#D97706]",
      route: "/sourcing/rfq?status=Evaluation",
      actionText: "Evaluate Quotes",
      badgeColor: "bg-[#FEF2F2] text-[#DC2626]",
    },
    {
      id: "onboarding-review",
      label: "Supplier Onboarding Review",
      desc: "Vendor registrations submitted for approval",
      count: supplierOnboardingAwaitingReview,
      icon: UserPlus,
      iconBg: "bg-[#F0FDFA] text-[#0D9488]",
      route: "/supplier/onboarding",
      actionText: "Review Onboarding",
      badgeColor: "bg-[#FFFBEB] text-[#D97706]",
    },
    {
      id: "reverse-bids",
      label: "Reverse Bids Action",
      desc: "Active/scheduled auctions requiring moderation",
      count: reverseBidsRequiringAction,
      icon: Gavel,
      iconBg: "bg-[#FEF2F2] text-[#DC2626]",
      route: "/reverse-bidding",
      actionText: "Manage Auctions",
      badgeColor: "bg-[#FFFBEB] text-[#D97706]",
    },
  ];

  return (
    <section aria-labelledby="requires-attention-heading" className="w-full">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2
            id="requires-attention-heading"
            className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]"
          >
            Requires My Attention
          </h2>
          <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[11px] font-extrabold text-[#DC2626]">
            {mrsAwaitingAction +
              businessCasesAwaitingApproval +
              ecrsAwaitingAction +
              rfqsPendingPublication +
              supplierResponses +
              quotesAwaitingEvaluation +
              supplierOnboardingAwaitingReview +
              reverseBidsRequiringAction +
              pendingApprovals}{" "}
            Action Items
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((act) => {
          const Icon = act.icon;
          return (
            <Link
              key={act.id}
              to={act.route}
              className="group relative flex flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white p-3.5 shadow-sm transition-all hover:border-[#1554D1]/40 hover:shadow-md no-underline"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${act.iconBg}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[12px] font-bold ${act.badgeColor}`}>
                    {act.count}
                  </span>
                </div>
                <h3 className="mt-2.5 text-[13.5px] font-bold text-[#12213F] group-hover:text-[#1554D1] transition-colors">
                  {act.label}
                </h3>
                <p className="mt-0.5 text-[11.5px] text-[#64748B] line-clamp-1">
                  {act.desc}
                </p>
              </div>

              <div className="mt-3 flex items-center gap-1 text-[11.5px] font-semibold text-[#1554D1] pt-2 border-t border-[#F1F5F9]">
                <span>{act.actionText}</span>
                <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
