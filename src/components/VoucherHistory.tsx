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
}: {
  history: VoucherHistoryEntry[];
}) {
  if (!history?.length) {
    return (
      <p className="text-sm text-neutral-500">No activity recorded yet.</p>
    );
  }

  return (
    <div>
      {history.map((entry, idx) => {
        const style = ROLE_STYLES[entry.actor_role] ?? ROLE_STYLES.admin;
        const { Icon } = style;
        const isLast = idx === history.length - 1;
        return (
          <div key={entry.id} className="flex gap-3 pb-4 last:pb-0">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${style.bg} ${style.text}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              {!isLast && (
                <div className="min-h-[20px] w-px flex-1 bg-neutral-200" />
              )}
            </div>
            <div className="flex-1 pt-1">
              <p className="text-sm font-medium text-neutral-900">
                {entry.action}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {entry.actor} · {formatDateTime(entry.timestamp)}
              </p>
              {entry.note && (
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
