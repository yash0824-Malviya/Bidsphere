import { Link } from "react-router-dom";
import {
  Boxes,
  ChevronRight,
  CreditCard,
  FileSearch,
  HelpCircle,
  Mail,
  MessageSquare,
  Package,
  Receipt,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import PageHeader from "../../components/PageHeader";
import FaqAccordion from "../../components/support/FaqAccordion";

const SUPPORT_EMAIL = "support@netlink.com";

interface WorkflowStep {
  step: number;
  icon: LucideIcon;
  title: string;
  description: string;
  to?: string;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: 1,
    icon: Boxes,
    title: "Inventory",
    description:
      "Review item masters, stock levels, and warehouse availability to identify procurement needs.",
    to: "/inventory",
  },
  {
    step: 2,
    icon: Users,
    title: "Supplier",
    description:
      "Select or onboard suppliers with complete profiles, payment terms, and contact details.",
    to: "/suppliers",
  },
  {
    step: 3,
    icon: FileSearch,
    title: "RFQ",
    description:
      "Create a Request for Quotation, define items and quantities, and invite suppliers to respond.",
    to: "/sourcing/rfq/new",
  },
  {
    step: 4,
    icon: Sparkles,
    title: "AI Analysis",
    description:
      "Compare supplier quotations with Claude-powered analysis — cost, delivery, and recommendation insights.",
    to: "/sourcing/rfq",
  },
  {
    step: 5,
    icon: Package,
    title: "Purchase Order",
    description:
      "Convert the winning quote into a Purchase Order and submit for approval.",
    to: "/p2p/purchase-orders",
  },
  {
    step: 6,
    icon: Truck,
    title: "GRN (Goods Receipt)",
    description:
      "Record goods received against the PO — update inventory and enable invoice matching.",
    to: "/p2p/grn",
  },
  {
    step: 7,
    icon: Receipt,
    title: "Invoice",
    description:
      "Match supplier invoices to PO/GRN, validate amounts, and track outstanding payables.",
    to: "/p2p/invoices",
  },
  {
    step: 8,
    icon: CreditCard,
    title: "Payment",
    description:
      "Release payment against approved invoices with full traceability and receipt generation.",
    to: "/p2p/payments",
  },
];

const FAQ_ITEMS = [
  {
    question: "How do I create a new RFQ?",
    answer: (
      <>
        Go to{" "}
        <Link to="/sourcing/rfq/new" className="text-primary hover:underline">
          Sourcing → New RFQ
        </Link>
        , add items and quantities, select suppliers, and submit. Suppliers can
        respond via the Supplier Portal or you can enter quotations manually.
      </>
    ),
  },
  {
    question: "How does AI supplier analysis work?",
    answer: (
      <>
        On an RFQ detail page with submitted quotations, open{" "}
        <strong>AI Analysis</strong>. Claude compares supplier pricing,
        delivery terms, and history to recommend the best option. You can
        create a Purchase Order directly from the top-ranked supplier.
      </>
    ),
  },
  {
    question: "What is the difference between GRN and Invoice?",
    answer: (
      <>
        A <strong>Goods Receipt (GRN)</strong> confirms physical receipt of
        materials and updates inventory. A <strong>Purchase Invoice</strong> is
        the supplier&apos;s billing document used for accounts payable and
        payment processing. Typically: PO → GRN → Invoice → Payment.
      </>
    ),
  },
  {
    question: "How do I record a payment?",
    answer: (
      <>
        Navigate to{" "}
        <Link to="/p2p/payments/new" className="text-primary hover:underline">
          Payments → New Payment
        </Link>
        , select the supplier and invoice, enter payment method and reference
        details, then submit. Download a payment receipt PDF from the detail
        page.
      </>
    ),
  },
  {
    question: "Can I ask the AI Assistant about live data?",
    answer: (
      <>
        Yes. Click the floating <strong>🤖 AI Assistant</strong> button
        (bottom-right). It fetches relevant procurement data (stock, POs,
        invoices, suppliers) and answers in natural language with formatted
        tables and insights.
      </>
    ),
  },
  {
    question: "Why can't I edit a submitted document?",
    answer: (
      <>
        Submitted documents are posted to the ledger and become read-only to
        preserve audit integrity. Cancel or amend through the standard
        workflows if your role has permission, or contact support for guidance.
      </>
    ),
  },
  {
    question: "How do I add a new supplier?",
    answer: (
      <>
        Go to{" "}
        <Link to="/suppliers/new" className="text-primary hover:underline">
          Suppliers → Add Supplier
        </Link>
        , complete the profile, and save. Incomplete profiles show a banner
        prompting you to fill missing fields before sourcing.
      </>
    ),
  },
  {
    question: "Who do I contact for technical issues?",
    answer: (
      <>
        Email{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="font-medium text-primary hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>{" "}
        with a description of the issue and screenshots. See the Contact Support
        section below for details.
      </>
    ),
  },
];

export default function HelpDeskPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Help"
        description="Documentation, workflow guides, and support resources for BidSphere."
      />

      {/* Workflow guide */}
      <div className="card overflow-hidden">
        <div className="border-b border-neutral-100 bg-gradient-to-r from-primary-50/80 to-white px-6 py-4">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Procure-to-Pay Workflow Guide
              </h3>
              <p className="text-xs text-neutral-500">
                End-to-end flow from inventory to payment
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
                      className="absolute left-[19px] top-10 h-[calc(100%-2rem)] w-0.5 bg-gradient-to-b from-primary-200 to-primary-100"
                      aria-hidden
                    />
                  )}
                  <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white shadow-sm">
                    {step.step}
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <h4 className="text-sm font-semibold text-neutral-900">
                        {step.title}
                      </h4>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-neutral-600">
                      {step.description}
                    </p>
                    {step.to && (
                      <Link
                        to={step.to}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        Open module
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* FAQs */}
      <div className="card overflow-hidden">
        <div className="border-b border-neutral-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-neutral-900">
            Frequently Asked Questions
          </h3>
          <p className="text-xs text-neutral-500">
            Common questions about BidSphere workflows and features
          </p>
        </div>
        <FaqAccordion items={FAQ_ITEMS} />
      </div>

      {/* AI Assistant */}
      <div className="card overflow-hidden">
        <div className="grid gap-0 md:grid-cols-5">
          <div className="bg-gradient-to-br from-primary-600 to-primary-800 p-6 text-white md:col-span-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-2xl">
              🤖
            </div>
            <h3 className="mt-4 text-lg font-bold">AI Procurement Assistant</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/85">
              Get instant answers about stock, spend, suppliers, POs, and
              invoices — powered by AI and live procurement data.
            </p>
          </div>
          <div className="space-y-4 p-6 md:col-span-3">
            <h4 className="text-sm font-semibold text-neutral-900">
              How to use the AI Assistant
            </h4>
            <ol className="space-y-3 text-sm text-neutral-600">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary">
                  1
                </span>
                Click the floating <strong>🤖</strong> button at the
                bottom-right of any page.
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary">
                  2
                </span>
                Type a question or pick a quick suggestion (e.g. overdue
                invoices, low stock).
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary">
                  3
                </span>
                Review formatted tables, insights, and follow-up suggestions
                in the chat panel.
              </li>
            </ol>
            <div className="rounded-lg border border-primary-100 bg-primary-50/50 px-4 py-3">
              <p className="text-xs font-medium text-primary-800">
                Example questions
              </p>
              <ul className="mt-2 space-y-1 text-xs text-primary-700">
                <li>• Which items are low on stock?</li>
                <li>• Show overdue invoices</li>
                <li>• How much did we spend this month?</li>
                <li>• Best supplier for laptops?</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Contact support */}
      <div className="card p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Support Team
              </h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600">
              Need assistance with BidSphere? Contact our support team and we'll
              help you resolve your issue.
            </p>

            <div className="mt-4 rounded-xl border border-neutral-100 bg-neutral-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Support Email
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=BidSphere%20Support%20Request`}
                className="mt-1 inline-flex items-center gap-2 text-base font-semibold text-primary hover:underline"
              >
                <Mail className="h-4 w-4" />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>

          <div className="card flex-1 border-primary-100 bg-primary-50/30 p-5 md:max-w-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              <MessageSquare className="h-4 w-4 text-primary" />
              When reporting an issue
            </div>
            <ul className="mt-3 space-y-2 text-sm text-neutral-600">
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                Describe what you were trying to do and what happened instead.
              </li>
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                Include the document number (PO, Invoice, RFQ, etc.) if
                applicable.
              </li>
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                Attach screenshots showing the error or unexpected behaviour.
              </li>
              <li className="flex gap-2">
                <span className="text-primary">•</span>
                Note your browser, date/time, and the page URL where the issue
                occurred.
              </li>
            </ul>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=BidSphere%20Support%20Request&body=Issue%20description%3A%0A%0ASteps%20to%20reproduce%3A%0A1.%20%0A2.%20%0A%0ADocument%20number%20(if%20any)%3A%0A%0AScreenshots%3A%20(attached)`}
              className="btn-primary mt-4 w-full justify-center"
            >
              <Mail className="h-4 w-4" />
              Email Support
            </a>
          </div>
        </div>
      </div>

      {/* Quick links footer */}
      <div className="flex flex-wrap gap-3">
        <Link to="/dashboard" className="btn-secondary">
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
