import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  Eye,
  Factory,
  FilePlus2,
  Layers,
  Loader2,
  Pencil,
  Search,
  Star,
  Trash2,
} from "lucide-react";

import {
  deleteBom,
  listBoms,
  type BomListRow,
} from "../../api/bom";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useAuthStore } from "../../store/authStore";
import { canManageBom } from "../../config/roles";

type ActiveFilter = "all" | "active" | "inactive";
type DefaultFilter = "all" | "default";

function docStatusLabel(docstatus: number): {
  label: string;
  cls: string;
} {
  switch (docstatus) {
    case 1:
      return { label: "Submitted", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case 2:
      return { label: "Cancelled", cls: "bg-red-50 text-red-700 border-red-200" };
    default:
      return { label: "Draft", cls: "bg-neutral-100 text-neutral-600 border-neutral-200" };
  }
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export default function BomManagementPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [defaultFilter, setDefaultFilter] = useState<DefaultFilter>("all");
  const [toDelete, setToDelete] = useState<BomListRow | null>(null);

  const bomsQuery = useQuery({
    queryKey: ["manufacturing-boms"],
    queryFn: () => listBoms({ limit: 1000 }),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteBom(name),
    onSuccess: () => {
      toast.success("BOM deleted");
      queryClient.invalidateQueries({ queryKey: ["manufacturing-boms"] });
      queryClient.invalidateQueries({ queryKey: ["manufacturing-finished-products"] });
      setToDelete(null);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to delete BOM. It may be linked to a Work Order or another BOM.",
      );
    },
  });

  const rows = useMemo(() => {
    const all = bomsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    return all.filter((b) => {
      if (activeFilter === "active" && b.is_active !== 1) return false;
      if (activeFilter === "inactive" && b.is_active === 1) return false;
      if (defaultFilter === "default" && b.is_default !== 1) return false;
      if (
        term &&
        !b.name.toLowerCase().includes(term) &&
        !b.item.toLowerCase().includes(term) &&
        !b.item_name.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [bomsQuery.data, search, activeFilter, defaultFilter]);

  const stats = useMemo(() => {
    const all = bomsQuery.data ?? [];
    return {
      total: all.length,
      active: all.filter((b) => b.is_active === 1).length,
      default: all.filter((b) => b.is_default === 1).length,
      products: new Set(all.map((b) => b.item).filter(Boolean)).size,
    };
  }, [bomsQuery.data]);

  if (!canManageBom(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <Layers className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-base font-bold text-neutral-900">BOM Management</h1>
            <p className="text-xs text-neutral-500">
              Create, version and maintain Bills of Materials from live data.
            </p>
          </div>
        </div>
        <Link
          to="/manufacturing/boms/new"
          className="inline-flex items-center gap-1.5 self-start rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white no-underline shadow-sm hover:bg-primary-700"
        >
          <FilePlus2 className="h-4 w-4" /> Create BOM
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Layers} label="Total BOMs" value={stats.total} tone="neutral" />
        <StatCard icon={CheckCircle2} label="Active" value={stats.active} tone="emerald" />
        <StatCard icon={Star} label="Default" value={stats.default} tone="amber" />
        <StatCard icon={Factory} label="Finished Products" value={stats.products} tone="primary" />
      </section>

      <section className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by BOM, item code or product name…"
              className="h-10 w-full rounded-lg border border-neutral-300 bg-white pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
            className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <select
            value={defaultFilter}
            onChange={(e) => setDefaultFilter(e.target.value as DefaultFilter)}
            className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none"
          >
            <option value="all">Default & non-default</option>
            <option value="default">Default only</option>
          </select>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/90 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">BOM / Version</th>
                <th className="px-4 py-3">Finished Product</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Default</th>
                <th className="px-4 py-3">Modified</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {bomsQuery.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-neutral-400" />
                  </td>
                </tr>
              ) : bomsQuery.isError ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-danger-600">
                    Couldn&apos;t load BOMs. Please try again.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
                    <Layers className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
                    <p className="text-sm font-semibold text-neutral-700">No BOMs found</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {stats.total === 0
                        ? "Create your first Bill of Materials to get started."
                        : "No BOMs match the current search or filters."}
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((b) => {
                  const status = docStatusLabel(b.docstatus);
                  return (
                    <tr
                      key={b.name}
                      className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/manufacturing/boms/${encodeURIComponent(b.name)}`}
                          className="font-semibold text-primary-700 no-underline hover:underline"
                        >
                          {b.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-900">{b.item_name}</div>
                        <div className="text-xs text-neutral-500">{b.item}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                        {b.quantity} {b.uom ?? ""}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {b.is_active === 1 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Active
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">Inactive</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {b.is_default === 1 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                            <Star className="h-3.5 w-3.5 fill-amber-400" /> Default
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-500">
                        {formatDate(b.modified)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            title="View"
                            onClick={() =>
                              navigate(`/manufacturing/boms/${encodeURIComponent(b.name)}`)
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            title="Edit"
                            onClick={() =>
                              navigate(
                                `/manufacturing/boms/${encodeURIComponent(b.name)}/edit`,
                              )
                            }
                          >
                            <Pencil className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            title="Delete"
                            danger
                            onClick={() => setToDelete(b)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) deleteMutation.mutate(toDelete.name);
        }}
        title="Delete BOM"
        description={
          toDelete
            ? `Delete "${toDelete.name}" for ${toDelete.item_name}? Submitted BOMs are cancelled first. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete BOM"
        tone="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Layers;
  label: string;
  value: number;
  tone: "neutral" | "emerald" | "amber" | "primary";
}) {
  const toneCls: Record<string, string> = {
    neutral: "bg-neutral-100 text-neutral-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    primary: "bg-primary-50 text-primary-600",
  };
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneCls[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-xl font-bold leading-none text-neutral-900">{value}</div>
        <div className="mt-1 text-xs text-neutral-500">{label}</div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${
        danger
          ? "border-neutral-200 text-neutral-500 hover:border-danger-300 hover:bg-danger-50 hover:text-danger-600"
          : "border-neutral-200 text-neutral-500 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600"
      }`}
    >
      {children}
    </button>
  );
}
