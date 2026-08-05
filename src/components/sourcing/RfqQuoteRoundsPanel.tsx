/**
 * Quote Rounds timeline — enterprise RFQ versioning panel.
 */

import { memo } from "react";
import { GitBranch, Loader2, Plus } from "lucide-react";

import type { RfqQuoteRound } from "../../api/rfqQuoteRound";
import { formatRfqRoundLabel } from "../../utils/rfqRoundTracking";
import { Skeleton } from "../Skeleton";

const STATUS_TONE: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-700",
  Active: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  Closed: "bg-neutral-100 text-neutral-600",
  Cancelled: "bg-rose-50 text-rose-700",
};

export interface RfqQuoteRoundsPanelProps {
  rounds: RfqQuoteRound[];
  activeRoundName?: string | null;
  loading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  canCreateRound?: boolean;
  createDisabledReason?: string;
  creatingRound?: boolean;
  /** Map of round name → newly added supplier count for that round. */
  newlyAddedByRound?: Record<string, number>;
  onCreateRound?: () => void;
  onSelectRound?: (round: RfqQuoteRound) => void;
}

function RfqQuoteRoundsPanel({
  rounds,
  activeRoundName,
  loading,
  errorMessage,
  onRetry,
  canCreateRound,
  createDisabledReason,
  creatingRound,
  newlyAddedByRound = {},
  onCreateRound,
  onSelectRound,
}: RfqQuoteRoundsPanelProps) {
  if (loading) {
    return (
      <section className="rfq-card overflow-hidden p-4 md:p-5">
        <Skeleton className="mb-3 h-6 w-40" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className="rfq-card overflow-hidden p-4 md:p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FEE2E2] text-[#DC2626]">
            <GitBranch className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="rfq-section-title">Quote Round History</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[#B91C1C]">
              {errorMessage}
            </p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 text-[13px] font-semibold text-[#1F3A6D] underline"
              >
                Retry loading quote rounds
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rfq-card overflow-hidden p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF3FA] text-[#1F3A6D]">
            <GitBranch className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="rfq-section-title">Quote Round History</h2>
            <p className="mt-0.5 text-[12px] text-[#64748B]">
              Round number, reason, newly added suppliers, and status
            </p>
          </div>
        </div>
        {onCreateRound ? (
          <button
            type="button"
            disabled={!canCreateRound || creatingRound}
            title={!canCreateRound ? createDisabledReason : undefined}
            onClick={onCreateRound}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1F3A6D] px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-[#17315D] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {creatingRound ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create New Round
          </button>
        ) : null}
      </div>

      {rounds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] px-4 py-8 text-center text-[13px] text-[#64748B]">
          No quote rounds recorded yet. The initial round is created automatically
          when the RFQ is opened.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-[13px]">
            <thead>
              <tr className="bg-[#F8FAFC] text-[11px] uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-2.5 font-semibold">Round Number</th>
                <th className="px-3 py-2.5 font-semibold">Reason Code</th>
                <th className="px-3 py-2.5 font-semibold">
                  Newly Added Suppliers
                </th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((round) => {
                const isActive = round.name === activeRoundName;
                const isHistorical = !isActive && round.status === "Closed";
                const newlyAdded =
                  newlyAddedByRound[round.name] ??
                  (round.reason_code === "New Supplier Added" ? 0 : null);
                return (
                  <tr
                    key={round.name}
                    className={`border-t border-[#F1F5F9] transition-colors ${
                      isActive ? "bg-[#EEF3FA]/60" : "hover:bg-[#F8FAFC]"
                    } ${onSelectRound ? "cursor-pointer" : ""}`}
                    onClick={() => onSelectRound?.(round)}
                    title={
                      isHistorical
                        ? "Previous round — read-only for audit"
                        : isActive
                          ? "Active round — supplier quotations and award"
                          : undefined
                    }
                  >
                    <td className="px-4 py-3 font-semibold text-[#1E293B]">
                      {formatRfqRoundLabel(round.round_number)}
                    </td>
                    <td className="max-w-[220px] px-3 py-3">
                      <span
                        className="block truncate font-medium text-[#334155]"
                        title={round.reason_code}
                      >
                        {round.reason_code}
                      </span>
                      {round.remarks ? (
                        <span
                          className="mt-0.5 block truncate text-[11px] text-[#64748B]"
                          title={round.remarks}
                        >
                          {round.remarks}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-[#475569]">
                      {newlyAdded == null ? (
                        <span className="text-[#94A3B8]">—</span>
                      ) : (
                        <span className="font-semibold text-[#1E293B]">
                          {newlyAdded}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          STATUS_TONE[round.status] ?? STATUS_TONE.Draft
                        }`}
                      >
                        {round.status}
                      </span>
                      {isHistorical ? (
                        <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-[#94A3B8]">
                          Read-only
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeRoundName ? (
        <p className="mt-3 text-[12px] text-[#64748B]">
          Active round drives supplier invitations, quotations, AI analysis, reverse
          bidding, and award.
        </p>
      ) : null}
    </section>
  );
}

export default memo(RfqQuoteRoundsPanel);
