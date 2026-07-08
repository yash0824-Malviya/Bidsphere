import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Package,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";

import { deleteBom, getBomDetail } from "../../api/bom";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useAuthStore } from "../../store/authStore";
import { canManageBom } from "../../config/roles";

function statusChip(docstatus: number): { label: string; cls: string } {
  switch (docstatus) {
    case 1:
      return { label: "Submitted", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case 2:
      return { label: "Cancelled", cls: "bg-red-50 text-red-700 border-red-200" };
    default:
      return { label: "Draft", cls: "bg-neutral-100 text-neutral-600 border-neutral-200" };
  }
}

export default function BomDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { name: routeName } = useParams();
  const bomName = routeName ? decodeURIComponent(routeName) : "";

  const [confirmDelete, setConfirmDelete] = useState(false);

  const bomQuery = useQuery({
    queryKey: ["manufacturing-bom", bomName],
    queryFn: () => getBomDetail(bomName),
    enabled: !!bomName,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteBom(bomName),
    onSuccess: () => {
      toast.success("BOM deleted");
      queryClient.invalidateQueries({ queryKey: ["manufacturing-boms"] });
      queryClient.invalidateQueries({ queryKey: ["manufacturing-finished-products"] });
      navigate("/manufacturing/boms");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete BOM");
    },
  });

  if (!canManageBom(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (bomQuery.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (bomQuery.isError || !bomQuery.data) {
    return (
      <div className="py-16 text-center text-neutral-500">
        BOM not found.
        <Link to="/manufacturing/boms" className="mt-2 block text-primary-600">
          Back to BOM Management
        </Link>
      </div>
    );
  }

  const bom = bomQuery.data;
  const status = statusChip(bom.docstatus);

  return (
    <div className="space-y-4">
      <Link
        to="/manufacturing/boms"
        className="mb-1 inline-flex items-center gap-1 text-sm text-neutral-500 no-underline hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to BOM Management
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold text-neutral-900">{bom.name}</h1>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}
            >
              {status.label}
            </span>
            {bom.is_active === 1 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Active
              </span>
            )}
            {bom.is_default === 1 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
                <Star className="h-3 w-3 fill-amber-400" /> Default
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            {bom.item_name}{" "}
            <span className="text-neutral-400">({bom.item})</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              navigate(`/manufacturing/boms/${encodeURIComponent(bom.name)}/edit`)
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <Pencil className="h-4 w-4" /> Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-danger-200 bg-white px-3 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      <section className="card grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <Meta label="Finished Product" value={bom.item_name} />
        <Meta label="Output Quantity" value={`${bom.quantity} ${bom.uom ?? ""}`} />
        <Meta label="Components" value={String(bom.items.length)} />
        <Meta label="Status" value={status.label} />
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <Package className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-bold text-neutral-900">Component List</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Item Group</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">UOM</th>
                <th className="px-4 py-3">Warehouse</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {bom.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-500">
                    This BOM has no components.
                  </td>
                </tr>
              ) : (
                bom.items.map((c, idx) => (
                  <tr
                    key={`${c.item_code}-${idx}`}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-3 text-neutral-500">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{c.item_name}</div>
                      <div className="text-xs text-neutral-500">{c.item_code}</div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{c.item_group || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-900">
                      {c.qty}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{c.uom}</td>
                    <td className="px-4 py-3 text-neutral-700">{c.warehouse || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete BOM"
        description={`Delete "${bom.name}"? Submitted BOMs are cancelled first. This cannot be undone.`}
        confirmLabel="Delete BOM"
        tone="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-neutral-900">{value}</div>
    </div>
  );
}
