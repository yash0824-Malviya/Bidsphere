import type { AuctionStatus } from "../../types/reverseBidding";

const STYLES: Record<AuctionStatus, string> = {
  Draft: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  Scheduled: "bg-amber-50 text-amber-700 ring-amber-200",
  Live: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Completed: "bg-blue-50 text-blue-700 ring-blue-200",
  Cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
};

export default function AuctionStatusBadge({
  status,
}: {
  status: AuctionStatus;
}) {
  const cls = STYLES[status] ?? STYLES.Draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${cls}`}
    >
      {status === "Live" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      )}
      {status}
    </span>
  );
}
