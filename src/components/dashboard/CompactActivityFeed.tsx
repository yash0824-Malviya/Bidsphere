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

function activityPresentation(item: ActivityFeedItem): {
  label: string;
  icon: LucideIcon;
  tone: string;
} {
  const status = (item.status ?? "").toLowerCase();

  if (item.type === "rfq") {
    if (status === "closed" || status === "awarded") {
      return {
        label: "Supplier Approved",
        icon: CheckCircle2,
        tone: "bg-emerald-50 text-emerald-700",
      };
    }
    if (status === "submitted" || status.includes("quot")) {
      return {
        label: "Quotation Submitted",
        icon: FileText,
        tone: "bg-primary-50 text-primary-700",
      };
    }
    return {
      label: "RFQ Created",
      icon: FileSearch,
      tone: "bg-primary-50 text-primary-700",
    };
  }

  if (item.type === "po") {
    if (status === "completed" || status.includes("receive")) {
      return {
        label: "GRN",
        icon: Package,
        tone: "bg-violet-50 text-violet-700",
      };
    }
    return {
      label: "PO Approved",
      icon: ShoppingCart,
      tone: "bg-primary-50 text-primary-700",
    };
  }

  if (item.type === "payment") {
    return {
      label: "Payment",
      icon: Banknote,
      tone: "bg-emerald-50 text-emerald-700",
    };
  }

  return {
    label: "Invoice",
    icon: Receipt,
    tone: "bg-neutral-100 text-neutral-600",
  };
}

const PANEL_SHELL =
  "rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]";

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
    return <Skeleton className={`min-h-[280px] w-full ${PANEL_SHELL}`} />;
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden ${PANEL_SHELL}`}>
      <div className="px-4 pb-2.5 pt-4">
        <h3 className="text-[14px] font-semibold leading-tight text-[#111827]">
          {title}
        </h3>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-[#64748B]">
          Activity appears as RFQs, quotations, POs, GRNs, invoices, and payments
          progress.
        </p>
      ) : (
        <>
          <ul className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
            {visible.map((item, idx) => {
              const meta = activityPresentation(item);
              const Icon = meta.icon;
              return (
                <li key={item.id} className="relative flex gap-3 pb-3.5 last:pb-0">
                  {idx < visible.length - 1 ? (
                    <span className="absolute left-[13px] top-7 bottom-0 w-px bg-[#E8EDF5]" />
                  ) : null}
                  <span
                    className={`relative z-[1] flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${meta.tone}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <Link to={item.to} className="min-w-0 flex-1 no-underline">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-medium text-[#111827]">
                        {meta.label}
                      </p>
                      <time className="flex-shrink-0 text-[11px] tabular-nums text-[#94A3B8]">
                        {formatDateTime(item.date) || formatDate(item.date)}
                      </time>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[12px] text-[#64748B]">
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
