import { Briefcase, Building2, Package, User } from "lucide-react";

import type { VoucherActorRole, VoucherHistoryEntry } from "../types/voucher";
import { formatDateTime } from "../utils/format";

const ROLE_STYLES: Record<
  VoucherActorRole,
  { bg: string; text: string; Icon: typeof Briefcase }
> = {
  finance: { bg: "bg-primary-100", text: "text-primary", Icon: Briefcase },
  supplier: { bg: "bg-success-100", text: "text-success-600", Icon: Building2 },
  procurement: { bg: "bg-amber-100", text: "text-amber-600", Icon: Package },
  admin: { bg: "bg-neutral-100", text: "text-neutral-600", Icon: User },
};

/** Vertical timeline of voucher history entries. */
export default function VoucherHistory({
  history,
  limit,
  compact,
}: {
  history: VoucherHistoryEntry[];
  /** When set, only the most recent N events are shown (chronological order). */
  limit?: number;
  compact?: boolean;
}) {
  if (!history?.length) {
    return (
      <p className="text-sm text-neutral-500">No activity recorded yet.</p>
    );
  }

  const visible =
    limit != null && history.length > limit ? history.slice(-limit) : history;
  const iconSize = compact ? "h-6 w-6" : "h-8 w-8";
  const iconInner = compact ? "h-3 w-3" : "h-4 w-4";
  const rowPad = compact ? "pb-2.5" : "pb-4";

  return (
    <div>
      {visible.map((entry, idx) => {
        const style = ROLE_STYLES[entry.actor_role] ?? ROLE_STYLES.admin;
        const { Icon } = style;
        const isLast = idx === visible.length - 1;
        return (
          <div key={entry.id} className={`flex gap-2.5 ${rowPad} last:pb-0`}>
            <div className="flex flex-col items-center">
              <div
                className={`flex ${iconSize} flex-shrink-0 items-center justify-center rounded-full ${style.bg} ${style.text}`}
              >
                <Icon className={iconInner} />
              </div>
              {!isLast && (
                <div className="min-h-[12px] w-px flex-1 bg-neutral-200" />
              )}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className={`font-medium text-neutral-900 ${compact ? "text-xs" : "text-sm"}`}
              >
                {entry.action}
              </p>
              <p className="mt-0.5 text-[10px] text-neutral-400">
                {entry.actor} · {formatDateTime(entry.timestamp)}
              </p>
              {entry.note && !compact && (
                <p className="mt-1.5 rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-600">
                  {entry.note}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
