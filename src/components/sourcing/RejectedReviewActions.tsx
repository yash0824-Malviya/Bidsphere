import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Eye, Pencil, RotateCcw } from "lucide-react";

import { resubmitFinanceReview } from "../../api/financeReviews";
import { resubmitLegalReview } from "../../api/legalReviews";
import { useAuthStore } from "../../store/authStore";

interface Props {
  rfqName: string;
  reviewType: "legal" | "finance";
  onResubmitted?: () => void;
  compact?: boolean;
}

export default function RejectedReviewActions({
  rfqName,
  reviewType,
  onResubmitted,
  compact,
}: Props) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const resubmittedBy = user?.email ?? user?.name ?? "Procurement Manager";

  const resubmitMutation = useMutation({
    mutationFn: () =>
      reviewType === "legal"
        ? resubmitLegalReview(rfqName, resubmittedBy)
        : resubmitFinanceReview(rfqName, resubmittedBy),
    onSuccess: () => {
      toast.success(
        reviewType === "legal"
          ? "RFQ resubmitted for legal review"
          : "RFQ resubmitted for finance review"
      );
      queryClient.invalidateQueries({ queryKey: ["legal-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["finance-reviews-all"] });
      queryClient.invalidateQueries({ queryKey: ["rfq", rfqName] });
      onResubmitted?.();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to resubmit RFQ");
    },
  });

  const btnClass = compact
    ? "inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
    : "inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50";

  const resubmitClass = compact
    ? "inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
    : "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50";

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <Link to={`/sourcing/rfq/${encodeURIComponent(rfqName)}`} className={btnClass}>
        <Eye className="h-3.5 w-3.5" />
        View RFQ
      </Link>
      <Link
        to={`/sourcing/rfq/${encodeURIComponent(rfqName)}?edit=1`}
        className={btnClass}
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit RFQ
      </Link>
      <button
        type="button"
        onClick={() => resubmitMutation.mutate()}
        disabled={resubmitMutation.isPending}
        className={resubmitClass}
      >
        <RotateCcw
          className={`h-3.5 w-3.5 ${resubmitMutation.isPending ? "animate-spin" : ""}`}
        />
        {resubmitMutation.isPending ? "Resubmitting…" : "Resubmit RFQ"}
      </button>
    </div>
  );
}
