import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Copy,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  getRFQTemplates,
  createRFQTemplate,
  updateRFQTemplate,
  archiveRFQTemplate,
  cloneRFQTemplate,
  RFQ_TEMPLATE_CATEGORIES,
  type RFQTemplateInput,
} from "../../api/rfqTemplates";
import RFQTemplateFormDialog from "../../components/sourcing/RFQTemplateFormDialog";
import type {
  RFQTemplate,
  RFQTemplateCategory,
} from "../../types/erpnext";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import {
  ConfirmDialog,
  FilterBar,
  FilterField,
  SearchInput,
  SortableTableHeader,
  StatCard,
} from "../../components/ui";
import { useListSort } from "../../hooks/useListSort";
import { useDebounce } from "../../hooks/useDebounce";
import {
  TEMPLATE_DEFAULT_SORT,
  rfqTemplateComparators,
  sortNewestFirst,
} from "../../utils/listSort";
import { formatCurrency, formatDate } from "../../utils/format";
import { useRFQTemplateStore } from "../../store/rfqTemplateStore";

const COMPARATORS = rfqTemplateComparators<RFQTemplate>();

const CATEGORY_OPTIONS: Array<"" | RFQTemplateCategory> = [
  "",
  ...RFQ_TEMPLATE_CATEGORIES,
];

const LIST_STALE_TIME = 5 * 60_000;

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function RFQTemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "" | RFQTemplateCategory
  >("");
  const debouncedSearch = useDebounce(search, 300);

  const {
    dialogOpen,
    dialogMode,
    activeTemplate,
    archiveTarget,
    openCreate,
    openEdit,
    closeDialog,
    openArchiveConfirm,
    closeArchiveConfirm,
  } = useRFQTemplateStore();

  /* ── Data ─────────────────────────────────────────────────────────────── */

  const {
    data: templates = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<RFQTemplate[]>({
    queryKey: ["rfq-templates"],
    queryFn: () => getRFQTemplates(),
    staleTime: LIST_STALE_TIME,
  });

  /* ── KPI counts ───────────────────────────────────────────────────────── */

  const total = templates.length;
  const active = templates.filter((t) => t.status === "Active").length;
  const archived = templates.filter((t) => t.status === "Archived").length;

  /* ── Client-side filter + search ──────────────────────────────────────── */

  const filtered = useMemo(() => {
    let rows = templates;
    if (categoryFilter) {
      rows = rows.filter((t) => t.category === categoryFilter);
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      rows = rows.filter(
        (t) =>
          t.template_name?.toLowerCase().includes(q) ||
          t.name?.toLowerCase().includes(q) ||
          t.category?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [templates, categoryFilter, debouncedSearch]);

  const normalized = useMemo(
    () =>
      sortNewestFirst(filtered, {
        date: (t) => t.modified,
        name: (t) => t.name,
      }),
    [filtered]
  );

  const { sort, setSort, sortedRows } = useListSort(
    normalized,
    TEMPLATE_DEFAULT_SORT,
    COMPARATORS
  );

  /* ── Mutations ────────────────────────────────────────────────────────── */

  const saveMutation = useMutation({
    mutationFn: (args: { name?: string; data: RFQTemplateInput }) =>
      args.name
        ? updateRFQTemplate(args.name, args.data)
        : createRFQTemplate(args.data),
    onSuccess: (_result, args) => {
      const verb = args.name ? "updated" : "created";
      toast.success(`Template ${verb} successfully`);
      queryClient.invalidateQueries({ queryKey: ["rfq-templates"] });
      closeDialog();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to save template");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (template: RFQTemplate) => archiveRFQTemplate(template.name),
    onSuccess: () => {
      toast.success("Template archived");
      queryClient.invalidateQueries({ queryKey: ["rfq-templates"] });
      closeArchiveConfirm();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to archive template");
    },
  });

  const cloneMutation = useMutation({
    mutationFn: (template: RFQTemplate) =>
      cloneRFQTemplate(template.name),
    onSuccess: (cloned) => {
      toast.success(`Template "${cloned.template_name}" cloned`);
      queryClient.invalidateQueries({ queryKey: ["rfq-templates"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to clone template");
    },
  });

  /* ── Handlers ─────────────────────────────────────────────────────────── */

  function handleSave(data: RFQTemplateInput) {
    if (dialogMode === "edit" && activeTemplate) {
      saveMutation.mutate({ name: activeTemplate.name, data });
    } else {
      saveMutation.mutate({ data });
    }
  }

  function handleArchive() {
    if (archiveTarget) archiveMutation.mutate(archiveTarget);
  }

  function useTemplate(tpl: RFQTemplate) {
    navigate(
      `/sourcing/rfq/new?template=${encodeURIComponent(tpl.name)}`
    );
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  return (
    <div>
      <PageHeader
        title="RFQ Template Library"
        description="Enterprise procurement templates — pre-configure items, suppliers, documents, and workflow rules."
        actions={
          <button type="button" onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" />
            Create Template
          </button>
        }
      />

      {/* KPI Row */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={LayoutTemplate}
          label="Total Templates"
          value={total}
          loading={isLoading}
          tone="primary"
        />
        <StatCard
          icon={CheckCircle2}
          label="Active Templates"
          value={active}
          loading={isLoading}
          tone="accent"
        />
        <StatCard
          icon={Archive}
          label="Archived Templates"
          value={archived}
          loading={isLoading}
          tone="neutral"
        />
      </div>

      {/* Filters */}
      <FilterBar>
        <FilterField label="Search" className="min-w-[220px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search templates…"
          />
        </FilterField>
        <FilterField label="Category" className="min-w-[200px]">
          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as RFQTemplateCategory | "")
            }
            className="select-field"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt || "All categories"}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      {/* Table */}
      <div className="table-shell">
        {isLoading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <LayoutTemplate className="mb-3 h-8 w-8 text-neutral-300" />
            <p className="text-sm font-semibold text-neutral-700">
              No RFQ Templates found
            </p>
            <p className="mt-1 max-w-sm text-xs text-neutral-500">
              Create your first template to streamline procurement.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="btn-primary"
              >
                <Plus className="h-4 w-4" />
                Create Template
              </button>
            </div>
          </div>
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title="No templates found"
            description={
              search || categoryFilter
                ? "No templates match your current filters. Try adjusting your search."
                : "Create your first RFQ template to streamline procurement."
            }
            action={
              !search && !categoryFilter ? (
                <button
                  type="button"
                  onClick={openCreate}
                  className="btn-primary"
                >
                  <Plus className="h-4 w-4" />
                  Create Template
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="data-card-list">
              {sortedRows.map((tpl) => (
                <div
                  key={tpl.name}
                  className="data-card-row cursor-pointer"
                  onClick={() => tpl.status === "Active" && useTemplate(tpl)}
                >
                  <div className="data-card-field">
                    <span className="data-card-label">Template Name</span>
                    <span className="data-card-value font-medium">
                      {tpl.template_name}
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Category</span>
                    <span className="data-card-value">
                      <CategoryBadge category={tpl.category} />
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Estimated Value</span>
                    <span className="data-card-value tabular-nums">
                      {formatCurrency(tpl.estimated_value)}
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Usage Count</span>
                    <span className="data-card-value tabular-nums">
                      {tpl.usage_count ?? 0}
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Last Used</span>
                    <span className="data-card-value">
                      {tpl.last_used_at ? formatDate(tpl.last_used_at) : "—"}
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Status</span>
                    <span className="data-card-value">
                      <StatusBadge status={tpl.status} />
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Modified</span>
                    <span className="data-card-value">
                      {formatDate(tpl.modified)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    {tpl.status === "Active" && (
                      <button
                        type="button"
                        onClick={() => useTemplate(tpl)}
                        className="btn-touch inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
                      >
                        <Play className="h-3 w-3" /> Create RFQ
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(tpl)}
                      className="btn-touch inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => cloneMutation.mutate(tpl)}
                      disabled={cloneMutation.isPending}
                      className="btn-touch inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      <Copy className="h-3 w-3" /> Clone
                    </button>
                    {tpl.status === "Active" && (
                      <button
                        type="button"
                        onClick={() => openArchiveConfirm(tpl)}
                        className="btn-touch inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-danger-600 hover:bg-danger-50"
                      >
                        <Archive className="h-3 w-3" /> Archive
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortableTableHeader
                      label="Template Name"
                      sortKey="name"
                      sort={sort}
                      onSort={setSort}
                    />
                    <SortableTableHeader
                      label="Category"
                      sortKey="category"
                      sort={sort}
                      onSort={setSort}
                    />
                    <SortableTableHeader
                      label="Estimated Value"
                      sortKey="estimated_value"
                      sort={sort}
                      onSort={setSort}
                      className="text-right"
                    />
                    <SortableTableHeader
                      label="Usage Count"
                      sortKey="usage_count"
                      sort={sort}
                      onSort={setSort}
                      className="text-right"
                    />
                    <SortableTableHeader
                      label="Last Used"
                      sortKey="last_used_at"
                      sort={sort}
                      onSort={setSort}
                    />
                    <SortableTableHeader
                      label="Status"
                      sortKey="status"
                      sort={sort}
                      onSort={setSort}
                    />
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((tpl) => (
                    <tr
                      key={tpl.name}
                      className={tpl.status === "Active" ? "cursor-pointer" : ""}
                      onClick={() =>
                        tpl.status === "Active" && useTemplate(tpl)
                      }
                    >
                      <td className="font-medium text-neutral-900">
                        {tpl.template_name}
                      </td>
                      <td>
                        <CategoryBadge category={tpl.category} />
                      </td>
                      <td className="text-right tabular-nums">
                        {formatCurrency(tpl.estimated_value)}
                      </td>
                      <td className="text-right tabular-nums">
                        {tpl.usage_count ?? 0}
                      </td>
                      <td className="whitespace-nowrap text-neutral-600">
                        {tpl.last_used_at ? formatDate(tpl.last_used_at) : "—"}
                      </td>
                      <td>
                        <StatusBadge status={tpl.status} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          template={tpl}
                          onCreateRFQ={() => useTemplate(tpl)}
                          onEdit={() => openEdit(tpl)}
                          onClone={() => cloneMutation.mutate(tpl)}
                          onArchive={() => openArchiveConfirm(tpl)}
                          isCloning={cloneMutation.isPending}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Create / Edit / Duplicate dialog */}
      {dialogOpen && (
        <RFQTemplateFormDialog
          mode={dialogMode}
          template={activeTemplate}
          onClose={closeDialog}
          onSave={handleSave}
          isSaving={saveMutation.isPending}
        />
      )}

      {/* Archive confirmation */}
      <ConfirmDialog
        open={!!archiveTarget}
        onClose={closeArchiveConfirm}
        onConfirm={handleArchive}
        title="Archive Template"
        description={`Are you sure you want to archive "${archiveTarget?.template_name}"? It will no longer appear in active templates.`}
        confirmLabel="Archive"
        tone="warning"
        isLoading={archiveMutation.isPending}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Category badge                                                            */
/* -------------------------------------------------------------------------- */

const CATEGORY_COLORS: Record<string, string> = {
  "Raw Materials": "bg-blue-100 text-blue-700",
  "Manufacturing Components": "bg-violet-100 text-violet-700",
  "Electrical Components": "bg-amber-100 text-amber-700",
  "Packaging Materials": "bg-emerald-100 text-emerald-700",
  "MRO Supplies": "bg-cyan-100 text-cyan-700",
  "Warehouse Consumables": "bg-orange-100 text-orange-700",
  "IT Equipment": "bg-indigo-100 text-indigo-700",
  "Logistics & Transportation": "bg-rose-100 text-rose-700",
};

function CategoryBadge({ category }: { category?: string }) {
  const label = category || "—";
  const classes = CATEGORY_COLORS[label] ?? "bg-neutral-100 text-neutral-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Row actions dropdown                                                      */
/* -------------------------------------------------------------------------- */

function RowActions({
  template,
  onCreateRFQ,
  onEdit,
  onClone,
  onArchive,
  isCloning,
}: {
  template: RFQTemplate;
  onCreateRFQ: () => void;
  onEdit: () => void;
  onClone: () => void;
  onArchive: () => void;
  isCloning?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
        aria-label="Actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 z-40 mt-1 w-48 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
            {template.status === "Active" && (
              <DropdownItem
                icon={Play}
                label="Create RFQ"
                onClick={() => {
                  setOpen(false);
                  onCreateRFQ();
                }}
                className="font-semibold text-primary-700"
              />
            )}
            <DropdownItem
              icon={Pencil}
              label="Edit"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            />
            <DropdownItem
              icon={Copy}
              label="Clone"
              onClick={() => {
                setOpen(false);
                onClone();
              }}
              className={isCloning ? "opacity-50" : ""}
            />
            {template.status === "Active" && (
              <DropdownItem
                icon={Archive}
                label="Archive"
                onClick={() => {
                  setOpen(false);
                  onArchive();
                }}
                className="text-warning-600"
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DropdownItem({
  icon: Icon,
  label,
  onClick,
  className = "",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-neutral-50 ${className}`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      {label}
    </button>
  );
}
