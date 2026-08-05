import { ClipboardList } from "lucide-react";

import type { WarehouseReviewSummary } from "../../utils/warehouseReviewSummary";

interface Props {
  summary: WarehouseReviewSummary;
  className?: string;
}

export default function WarehouseReviewSummaryCard({
  summary,
  className = "",
}: Props) {
  if (!summary.hasContent) return null;

  const showForwarded =
    summary.items_forwarded.length > 0 ||
    summary.items.some((i) => /forward/i.test(i.warehouse_action));

  const bullets =
    summary.items_forwarded.length > 0
      ? summary.items_forwarded
      : summary.items
          .filter((i) => /forward/i.test(i.warehouse_action))
          .map((i) => ({
            name: i.item_name,
            qty: i.requested_qty,
            uom: i.uom,
          }));

  return (
    <section
      className={`overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] ${className}`.trim()}
    >
      <div className="border-b border-[#F1F5F9] bg-[#F8FAFC] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
            <ClipboardList className="h-4 w-4 text-[#64748B]" />
            Warehouse Decision Summary
          </h3>
          <span className="rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
            Read-only
          </span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 text-[13px] leading-relaxed text-[#475569]">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
              Reviewed By
            </dt>
            <dd className="mt-0.5 font-semibold text-[#0F172A]">
              {summary.reviewer_name}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
              Review Date
            </dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-[#0F172A]">
              {summary.review_date}
            </dd>
          </div>
        </dl>

        {showForwarded && bullets.length > 0 ? (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
              Items Forwarded
            </p>
            <ul className="space-y-1">
              {bullets.map((item) => (
                <li key={`${item.name}-${item.qty}`} className="text-[#334155]">
                  • {item.name} ({item.qty} {item.uom})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {summary.reason ? (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
              Reason
            </p>
            <p className="text-[#334155]">{summary.reason}</p>
          </div>
        ) : null}

        {summary.action ? (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
              Action
            </p>
            <p className="font-semibold text-[#1F3A6D]">
              {summary.action.endsWith(".") ? summary.action : `${summary.action}.`}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
