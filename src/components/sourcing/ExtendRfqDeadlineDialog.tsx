import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  currentValidTill: string;
  onCancel: () => void;
  onExtendAndInvite: () => void;
  onInviteAnyway: () => void;
  busy?: boolean;
}

export default function ExtendRfqDeadlineDialog({
  open,
  currentValidTill,
  onCancel,
  onExtendAndInvite,
  onInviteAnyway,
  busy = false,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-xl"
      >
        <h3 className="text-[16px] font-semibold text-[#0F172A]">
          RFQ validity expired
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-[#64748B]">
          The RFQ validity has expired
          {currentValidTill ? ` (Valid Till: ${currentValidTill})` : ""}.
          Would you like to extend the RFQ deadline before inviting additional
          suppliers?
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onInviteAnyway}
            disabled={busy}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            Invite Anyway
          </button>
          <button
            type="button"
            onClick={onExtendAndInvite}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Extend &amp; Invite
          </button>
        </div>
      </div>
    </div>
  );
}
