import { Mail, MessageSquare } from "lucide-react";

import PageHeader from "../../components/PageHeader";
import { SUPPORT_EMAIL } from "../../utils/supplierPortalUtils";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

const MAILTO_SUBJECT = "BidSphere%20Supplier%20Portal%20Support%20Request";
const MAILTO_BODY =
  "Issue%20description%3A%0A%0ASteps%20to%20reproduce%3A%0A1.%20%0A2.%20%0A%0ADocument%20number%20(if%20any)%3A%0A%0AScreenshots%3A%20(attached)";

export default function SupplierContactSupportPage() {
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
        title="Contact Support"
        description="Reach the BidSphere team for portal issues, access problems, or workflow questions."
      />

      <div className="card p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-accent-600" />
              <h3 className="text-sm font-semibold text-neutral-900">
                Support Email
              </h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600">
              For bugs, login issues, quotation submission errors, or questions
              about purchase orders and payments, email our support team directly.
            </p>

            <div className="mt-4 rounded-xl border border-neutral-100 bg-neutral-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Contact
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=${MAILTO_SUBJECT}`}
                className="mt-1 inline-flex items-center gap-2 text-base font-semibold text-accent-700 hover:underline"
              >
                <Mail className="h-4 w-4" />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>

          <div className="card flex-1 border-accent-100 bg-accent-50/30 p-5 md:max-w-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              <MessageSquare className="h-4 w-4 text-accent-600" />
              When reporting an issue
            </div>
            <ul className="mt-3 space-y-2 text-sm text-neutral-600">
              <li className="flex gap-2">
                <span className="text-accent-600">•</span>
                Describe what you were trying to do and what happened instead.
              </li>
              <li className="flex gap-2">
                <span className="text-accent-600">•</span>
                Include the document number (RFQ, PO, Invoice, etc.) if
                applicable.
              </li>
              <li className="flex gap-2">
                <span className="text-accent-600">•</span>
                Attach screenshots showing the error or unexpected behaviour.
              </li>
              <li className="flex gap-2">
                <span className="text-accent-600">•</span>
                Note your browser, date/time, and the page URL where the issue
                occurred.
              </li>
              <li className="flex gap-2">
                <span className="text-accent-600">•</span>
                Mention your supplier name ({supplierName}) so we can locate
                your records quickly.
              </li>
            </ul>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${MAILTO_SUBJECT}&body=${MAILTO_BODY}`}
              className="btn-primary mt-4 w-full justify-center"
            >
              <Mail className="h-4 w-4" />
              Email Support
            </a>
          </div>
        </div>
      </div>
    </SupplierPortalLayout>
  );
}
