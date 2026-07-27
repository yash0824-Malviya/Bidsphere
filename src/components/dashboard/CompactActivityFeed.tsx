import { memo, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Banknote,
  CheckCircle2,
  FileSearch,
  FileText,
  Package,
  Receipt,
  ShoppingCart,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import PaginationBar from "../PaginationBar";
import { Skeleton } from "../Skeleton";
import { DEFAULT_PAGE_SIZE, type PageSizeOption } from "../../hooks/usePagination";
import type { ActivityFeedItem } from "../../utils/dashboardUtils";
import { formatDate, formatDateTime } from "../../utils/format";

interface Props {
  items: ActivityFeedItem[];
  loading?: boolean;
  title?: string;
}

/** Enterprise activity color system (presentation only). */
function activityPresentation(item: ActivityFeedItem): {
  label: string;
  icon: LucideIcon;
  tone: string;
  rail: string;
} {
  const status = (item.status ?? "").toLowerCase();

  if (status.includes("reject") || status.includes("cancel")) {
    return {
      label: "Rejected",
      icon: XCircle,
      tone: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100",
      rail: "bg-rose-500",
    };
  }

  if (
    status.includes("approv") ||
    status.includes("legal") ||
    status.includes("finance")
  ) {
    return {
      label: status.includes("approv") ? "Approval" : "Under Approval",
      icon: CheckCircle2,
      tone: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-100",
      rail: "bg-orange-500",
    };
  }

  if (item.type === "rfq") {
    if (status === "submitted" || status.includes("quot")) {
      return {
        label: "Quotation Submitted",
        icon: FileText,
        tone: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100",
        rail: "bg-sky-500",
      };
    }
    return {
      label: "RFQ",
      icon: FileSearch,
      tone: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100",
      rail: "bg-sky-500",
    };
  }

  if (item.type === "po") {
    if (status === "completed" || status.includes("receive")) {
      return {
        label: "GRN",
        icon: Package,
        tone: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-100",
        rail: "bg-violet-500",
      };
    }
    return {
      label: "Purchase Order",
      icon: ShoppingCart,
      tone: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100",
      rail: "bg-emerald-500",
    };
  }

  if (item.type === "payment") {
    return {
      label: "Payment",
      icon: Banknote,
      tone: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100",
      rail: "bg-emerald-500",
    };
  }

  return {
    label: "Invoice",
    icon: Receipt,
    tone: "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-200",
    rail: "bg-neutral-400",
  };
}

const PANEL_SHELL =
  "min-h-[320px] rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]";

function CompactActivityFeed({
  items,
  loading,
  title = "Recent Procurement Activity",
}: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [items.length]);

  const totalRecords = items.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const visible = useMemo(
    () =>
      items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage, pageSize],
  );

  if (loading) {
    return <Skeleton className={`min-h-[250px] w-full ${PANEL_SHELL}`} />;
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden ${PANEL_SHELL}`}>
      <div className="px-5 pb-3 pt-5">
        <h3 className="text-[16px] font-semibold leading-tight text-[#1E293B]">
          {title}
        </h3>
      </div>

      {visible.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-[#64748B]">
          Activity appears as RFQs, quotations, POs, GRNs, invoices, and payments
          progress.
        </p>
      ) : (
        <>
          <ul className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-1">
            {visible.map((item, idx) => {
              const meta = activityPresentation(item);
              const Icon = meta.icon;
              return (
                <li
                  key={item.id}
                  className="relative flex gap-3.5 pb-5 last:pb-1"
                >
                  {idx < visible.length - 1 ? (
                    <span className="absolute left-[15px] top-8 bottom-0 w-px bg-[#E5E7EB]" />
                  ) : null}
                  <span
                    className={`relative z-[1] flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${meta.tone}`}
                  >
                    <span
                      className={`absolute -left-px top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${meta.rail}`}
                      aria-hidden
                    />
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <Link
                    to={item.to}
                    className="min-w-0 flex-1 rounded-xl px-2 py-1 no-underline transition hover:bg-[#F8FAFC]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-semibold text-[#1E293B]">
                        {meta.label}
                      </p>
                      <time className="flex-shrink-0 text-[11px] tabular-nums text-[#94A3B8]">
                        {formatDateTime(item.date) || formatDate(item.date)}
                      </time>
                    </div>
                    <p className="mt-1 truncate font-mono text-[12px] text-[#64748B]">
                      {item.title}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size as PageSizeOption);
              setPage(1);
            }}
            recordLabel="activities"
          />
        </>
      )}
    </div>
  );
}

export default memo(CompactActivityFeed);
