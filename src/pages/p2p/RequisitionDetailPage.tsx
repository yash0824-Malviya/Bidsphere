import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, ClipboardList, Loader2, Send } from "lucide-react";

import {
  getMaterialRequest,
  submitMaterialRequest,
} from "../../api/purchasing";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { Skeleton } from "../../components/Skeleton";
import { formatCurrency, formatDate } from "../../utils/format";

export default function RequisitionDetailPage() {
  const { name = "" } = useParams();
  const queryClient = useQueryClient();

  const { data: mr, isLoading, isError } = useQuery({
    queryKey: ["material-request", name],
    queryFn: () => getMaterialRequest(name),
    enabled: !!name,
  });

  const submitMutation = useMutation({
    mutationFn: () => submitMaterialRequest(name),
    onSuccess: () => {
      toast.success(`${name} submitted`);
      queryClient.invalidateQueries({ queryKey: ["material-request", name] });
      queryClient.invalidateQueries({ queryKey: ["material-requests"] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !mr) {
    return (
      <div>
        <Link
          to="/p2p/requisitions"
          className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <EmptyState
          icon={ClipboardList}
          title="Material request not found"
          description="It may have been deleted, or you may not have access."
        />
      </div>
    );
  }

  const isDraft = (mr.docstatus ?? 0) === 0;
  const computedTotal =
    mr.total ??
    (mr.items ?? []).reduce(
      (sum, item) => sum + (item.amount ?? (item.qty ?? 0) * (item.rate ?? 0)),
      0
    );

  return (
    <div>
      <Link
        to="/p2p/requisitions"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to material requests
      </Link>

      <PageHeader
        title={mr.name}
        description={mr.title ?? mr.remarks ?? "Material Request (Purchase)"}
        actions={
          <>
            <StatusBadge status={mr.status ?? "Draft"} />
            {isDraft && (
              <button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-60"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit for Approval
              </button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <InfoCard
          label="Transaction Date"
          value={formatDate(mr.transaction_date)}
        />
        <InfoCard label="Required By" value={formatDate(mr.schedule_date)} />
        <InfoCard
          label="Requested By"
          value={mr.requested_by ?? mr.owner ?? "—"}
        />
        <InfoCard label="Cost Center" value={mr.cost_center ?? "—"} />
      </div>

      <div className="mt-6 card">
        <div className="border-b border-neutral-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">Items</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2">Item Code</th>
                <th className="px-4 py-2">Item Name</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2">UOM</th>
                <th className="px-4 py-2 text-right">Rate</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {(mr.items ?? []).map((item) => (
                <tr key={item.name}>
                  <td className="px-4 py-2 font-medium text-neutral-900">
                    {item.item_code}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{item.item_name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{item.qty}</td>
                  <td className="px-4 py-2 text-neutral-600">{item.uom ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatCurrency(item.rate)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {formatCurrency(item.amount ?? (item.qty ?? 0) * (item.rate ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-neutral-50">
                <td colSpan={5} className="px-4 py-3 text-right text-sm font-medium">
                  Total
                </td>
                <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                  {formatCurrency(computedTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium text-neutral-900">
        {value}
      </p>
    </div>
  );
}
