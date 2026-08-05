import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import PageHeader from "../../components/PageHeader";
import {
  approveTemporaryItem,
  getTemporaryItems,
  rejectTemporaryItem,
  type TemporaryItemRecord,
} from "../../api/uploadedBom";
import { useAuthStore } from "../../store/authStore";

export default function TemporaryItemStorePage() {
  const role = useAuthStore((s) => s.user?.role);
  const canReview = role === "manufacturing" || role === "admin";
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("Pending Review");

  const query = useQuery({
    queryKey: ["temporary-items"],
    queryFn: getTemporaryItems,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    if (!statusFilter) return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [query.data, statusFilter]);

  const approveMut = useMutation({
    mutationFn: (name: string) => approveTemporaryItem(name),
    onSuccess: () => {
      toast.success("Item approved — ERP Item Master created.");
      void queryClient.invalidateQueries({ queryKey: ["temporary-items"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not approve item."),
  });

  const rejectMut = useMutation({
    mutationFn: ({ name, reason }: { name: string; reason?: string }) =>
      rejectTemporaryItem(name, reason),
    onSuccess: () => {
      toast.success("Item rejected.");
      void queryClient.invalidateQueries({ queryKey: ["temporary-items"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not reject item."),
  });

  return (
    <div className="space-y-6">
      <PageHeader />
      <div>
        <h1 className="text-xl font-semibold text-[#1E293B]">Temporary Item Store</h1>
        <p className="mt-1 max-w-3xl text-sm text-[#64748B]">
          Items from Department BOM uploads that are not yet in ERP Item Master.
          Master Data reviews each record before procurement can begin.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {["Pending Review", "Approved", "Rejected", ""].map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              statusFilter === s
                ? "bg-[#1F3A6D] text-white"
                : "border border-[#E2E8F0] bg-white text-[#64748B]"
            }`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        {query.isLoading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-[#64748B]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#64748B]">
            No temporary items in this queue.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[960px] w-full text-left text-sm">
              <thead className="bg-[#F8FAFC] text-[10px] uppercase tracking-wider text-[#64748B]">
                <tr>
                  <th className="px-4 py-3">Item Name</th>
                  <th className="px-3 py-3">Proposed Code</th>
                  <th className="px-3 py-3">Group</th>
                  <th className="px-3 py-3">UOM</th>
                  <th className="px-3 py-3">Status</th>
                  {canReview ? <th className="px-4 py-3 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <TempRow
                    key={row.name}
                    row={row}
                    canReview={canReview}
                    onApprove={() => approveMut.mutate(row.name)}
                    onReject={() =>
                      rejectMut.mutate({
                        name: row.name,
                        reason: "Rejected by Master Data review",
                      })
                    }
                    busy={approveMut.isPending || rejectMut.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TempRow({
  row,
  canReview,
  onApprove,
  onReject,
  busy,
}: {
  row: TemporaryItemRecord;
  canReview: boolean;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const tone =
    row.status === "Approved"
      ? "bg-emerald-50 text-emerald-700"
      : row.status === "Rejected"
        ? "bg-rose-50 text-rose-700"
        : "bg-amber-50 text-amber-800";

  return (
    <tr className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]">
      <td className="px-4 py-3">
        <p className="font-semibold text-[#1E293B]">{row.item_name}</p>
        <p className="text-xs text-[#64748B]">{row.description || "—"}</p>
      </td>
      <td className="px-3 py-3 font-mono text-xs">{row.proposed_item_code || "—"}</td>
      <td className="px-3 py-3">{row.item_group || "—"}</td>
      <td className="px-3 py-3">{row.default_uom || "Nos"}</td>
      <td className="px-3 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>
          {row.status}
        </span>
        {row.erp_item ? (
          <p className="mt-0.5 text-xs text-emerald-700">ERP: {row.erp_item}</p>
        ) : null}
      </td>
      {canReview ? (
        <td className="px-4 py-3 text-right">
          {row.status === "Pending Review" ? (
            <div className="inline-flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onApprove}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onReject}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          ) : (
            <span className="text-xs text-[#94A3B8]">—</span>
          )}
        </td>
      ) : null}
    </tr>
  );
}
