import { Link } from "react-router-dom";
import {
  ChevronRight,
  CreditCard,
  FileSearch,
  HelpCircle,
  Mail,
  Package,
  Receipt,
  Sparkles,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import PageHeader from "../../components/PageHeader";
import FaqAccordion from "../../components/support/FaqAccordion";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

interface WorkflowStep {
  step: number;
  icon: LucideIcon;
  title: string;
  description: string;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: 1,
    icon: FileSearch,
    title: "RFQ Invitation",
    description:
      "Netlink procurement invites your company to quote on a Request for Quotation. Open RFQs appear on your dashboard and in My RFQs.",
  },
  {
    step: 2,
    icon: Receipt,
    title: "Submit Quotation",
    description:
      "Review RFQ line items, enter your pricing and delivery terms, then submit your Supplier Quotation through the portal.",
  },
  {
    step: 3,
    icon: Sparkles,
    title: "Evaluation",
    description:
      "Netlink compares quotations — including AI-assisted analysis — and selects the best offer for the business need.",
  },
  {
    step: 4,
    icon: Package,
    title: "Purchase Order",
    description:
      "A winning quotation is converted into a Purchase Order. You can view PO details, line items, and delivery expectations in the portal.",
  },
  {
    step: 5,
    icon: Truck,
    title: "Goods Receipt (GRN)",
    description:
      "When goods arrive, Netlink records a Goods Receipt Note against the PO. Track receipt status — Pending, Partial, or Completed.",
  },
  {
    step: 6,
    icon: FileSearch,
    title: "Invoice",
    description:
      "Your invoice is matched to the PO and GRN. Monitor invoice status and outstanding balances in the Finance section.",
  },
  {
    step: 7,
    icon: CreditCard,
    title: "Payment",
    description:
      "Approved invoices are paid according to agreed payment terms. Payment entries appear in your Payments list with full traceability.",
  },
];

const FAQ_ITEMS = [
  {
    question: "How do I submit a quotation?",
    answer: (
      <>
        Go to <strong>My RFQs</strong> or the dashboard, find an open RFQ,
        and click <strong>Submit Quotation</strong>. Complete pricing for each
        line item and submit. Draft quotations can be finalized with{" "}
        <strong>Submit Now</strong> on the Submitted Quotations page.
      </>
    ),
  },
  {
    question: "Why does an RFQ still show as open after I quoted?",
    answer: (
      <>
        The portal marks an RFQ as quoted once a submitted Supplier Quotation
        is linked to it. If your quote is still in <strong>Draft</strong> status,
        use <strong>Submit Now</strong> on the quotations page to post it.
      </>
    ),
  },
  {
    question: "Where can I see my purchase orders?",
    answer: (
      <>
        Navigate to <strong>Orders → Purchase Orders</strong> or use the
        dashboard PO table. Click <strong>View PO</strong> for line items,
        totals, and status.
      </>
    ),
  },
  {
    question: "What do GRN statuses mean?",
    answer: (
      <>
        <strong>Pending</strong> — no goods received yet.{" "}
        <strong>Partial</strong> — some quantity received against the PO.{" "}
        <strong>Completed</strong> — full quantity received. GRNs are created
        by Netlink when goods are logged in the warehouse.
      </>
    ),
  },
  {
    question: "How do I track invoice and payment status?",
    answer: (
      <>
        Use <strong>Finance → Invoices</strong> to see submitted invoices and
        their approval/payment status. <strong>Payments</strong> lists amounts
        released against your invoices with payment mode and date.
      </>
    ),
  },
  {
    question: "Who do I contact for portal issues?",
    answer: (
      <>
        Visit{" "}
        <Link
          to="/supplier/contact-support"
          className="font-medium text-accent-700 hover:underline"
        >
          Contact Support
        </Link>{" "}
        or email the BidSphere support team with a description and
        screenshots of the issue.
      </>
    ),
  },
];

export default function SupplierHelpDeskPage() {
  const { supplierName, isReady } = useSupplierSession();

  if (!isReady) {
    return (
      <SupplierPortalLayout>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      </SupplierPortalLayout>
    );
  }

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <PageHeader
        title="Help"
        description="Workflow guides and answers for using the BidSphere Supplier Portal."
      />

      <div className="space-y-6">
        <div className="card overflow-hidden">
          <div className="border-b border-neutral-100 bg-gradient-to-r from-accent-50/80 to-white px-6 py-4">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-accent-600" />
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Procure-to-Pay Workflow
                </h3>
                <p className="text-xs text-neutral-500">
                  Your journey from RFQ invitation to payment
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="relative space-y-0">
              {WORKFLOW_STEPS.map((step, index) => {
                const Icon = step.icon;
                const isLast = index === WORKFLOW_STEPS.length - 1;
                return (
                  <div key={step.title} className="relative flex gap-4 pb-8">
                    {!isLast && (
                      <div
                        className="absolute left-[19px] top-10 h-[calc(100%-2rem)] w-0.5 bg-gradient-to-b from-accent-200 to-accent-100"
                        aria-hidden
                      />
                    )}
                    <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-600 text-sm font-bold text-white shadow-sm">
                      {step.step}
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon className="h-4 w-4 text-accent-600" />
                        <h4 className="text-sm font-semibold text-neutral-900">
                          {step.title}
                        </h4>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-neutral-600">
                        {step.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-neutral-100 px-6 py-4">
            <h3 className="text-sm font-semibold text-neutral-900">
              Frequently Asked Questions
            </h3>
            <p className="text-xs text-neutral-500">
              Common questions about the supplier portal
            </p>
          </div>
          <FaqAccordion items={FAQ_ITEMS} />
        </div>

        <div className="card p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-accent-600" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Need more help?
                </h3>
              </div>
              <p className="mt-2 text-sm text-neutral-600">
                Contact the BidSphere support team for bugs, access issues, or
                questions not covered above.
              </p>
            </div>
            <Link
              to="/supplier/contact-support"
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
            >
              Contact Support
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </SupplierPortalLayout>
  );
}
