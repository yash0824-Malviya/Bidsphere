import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Plus, Search } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import { useClientPagination } from "../../hooks/usePagination";
import NewOnboardingModal from "../../components/supplier-onboarding/NewOnboardingModal";
import {
  getOnboardingStats,
  listOnboardings,
  listSupplierCategories,
} from "../../api/supplierOnboarding";
import { useAuthStore } from "../../store/authStore";
import { queryClient } from "../../queryClient";
import { ONB } from "../../components/supplier-onboarding/enterprise/onboardingUi";
import ExportButton from "../../components/export/ExportButton";
import type { ExportColumn } from "../../utils/export";
import type { OnboardingListRow } from "../../api/supplierOnboarding";

function statusClass(status?: string): string {
  switch (status) {
    case "Approved":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Rejected":
    case "Expired":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "Under Review":
    case "Submitted":
      return "bg-primary-50 text-primary-800 border-primary-200";
    case "Changes Requested":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "Link Generated":
    case "Opened":
    case "In Progress":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

export default function SupplierOnboardingListPage() {
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [supplierType, setSupplierType] = useState("");
  const [category, setCategory] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const statsQuery = useQuery({
    queryKey: ["onboarding-stats"],
    queryFn: getOnboardingStats,
    staleTime: 30_000,
  });

  const categoriesQuery = useQuery({
    queryKey: ["onboarding-categories"],
    queryFn: () => listSupplierCategories(),
    staleTime: 60_000,
  });

  const listQuery = useQuery({
    queryKey: ["onboarding-list", status, supplierType, category, search],
    queryFn: () =>
      listOnboardings({
        status: status || undefined,
        supplier_type: supplierType || undefined,
        supplier_category: category || undefined,
        search: search || undefined,
      }),
    staleTime: 15_000,
  });

  const cards = useMemo(() => {
    const s = statsQuery.data;
    return [
      { label: "Total Requests", value: s?.total ?? "—", accent: ONB.primary },
      { label: "Draft", value: s?.draft ?? "—", accent: "#64748B" },
      { label: "Generated", value: s?.generated ?? "—", accent: "#6366F1" },
      { label: "Submitted", value: s?.submitted ?? "—", accent: "#0098EA" },
      { label: "Pending Review", value: s?.pending_review ?? "—", accent: ONB.warning },
      { label: "Approved", value: s?.approved ?? "—", accent: ONB.success },
      { label: "Rejected", value: s?.rejected ?? "—", accent: ONB.error },
      { label: "Expired", value: s?.expired ?? "—", accent: "#94A3B8" },
    ];
  }, [statsQuery.data]);

  const listRows = listQuery.data ?? [];
  const filterKey = `${status}|${supplierType}|${category}|${search}`;
  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    totalRecords,
    totalPages,
    pageRows,
  } = useClientPagination(listRows, {
    defaultPageSize: 10,
    resetKey: filterKey,
  });

  const exportRows = listRows;
  const exportColumns = useMemo<ExportColumn<OnboardingListRow>[]>(
    () => [
      { id: "name", label: "Onboarding ID", accessor: (r) => r.name },
      { id: "company_name", label: "Company Name", accessor: (r) => r.company_name },
      { id: "contact_person", label: "Contact Person", accessor: (r) => r.contact_person },
      { id: "email", label: "Email", accessor: (r) => r.email },
      {
        id: "supplier_type",
        label: "Supplier Type",
        type: "status",
        accessor: (r) => r.supplier_type,
      },
      {
        id: "supplier_category",
        label: "Category",
        accessor: (r) => r.supplier_category,
      },
      {
        id: "status",
        label: "Status",
        type: "status",
        accessor: (r) => r.status,
      },
      {
        id: "created_by",
        label: "Created By",
        accessor: (r) => r.created_by_user,
      },
      {
        id: "creation",
        label: "Created Date",
        type: "date",
        accessor: (r) => r.creation,
      },
    ],
    [],
  );

  return (
    <div className="space-y-5" style={{ backgroundColor: ONB.bg }}>
      <PageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton
              module="Supplier Onboarding"
              filenamePrefix="Supplier_Onboarding"
              columns={exportColumns}
              rows={exportRows}
            />
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
              style={{ backgroundColor: ONB.primary }}
            >
              <Plus className="h-4 w-4" />
              New Onboarding
            </button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {c.label}
            </p>
            <p
              className="mt-2 text-3xl font-bold tabular-nums tracking-tight"
              style={{ color: c.accent }}
            >
              {c.value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Inbox className="h-4 w-4" style={{ color: ONB.primary }} />
          <h2 className="text-sm font-bold text-slate-900">Onboarding Queue</h2>
        </div>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, email, contact…"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
          >
            <option value="">All statuses</option>
            {[
              "Draft",
              "Link Generated",
              "Opened",
              "In Progress",
              "Submitted",
              "Under Review",
              "Changes Requested",
              "Approved",
              "Rejected",
              "Expired",
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={supplierType}
            onChange={(e) => setSupplierType(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
          >
            <option value="">All types</option>
            <option value="Direct">Direct</option>
            <option value="Indirect">Indirect</option>
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
          >
            <option value="">All categories</option>
            {(categoriesQuery.data ?? []).map((c) => (
              <option key={c.name} value={c.name}>
                {c.category_name}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Onboarding ID</th>
                <th className="px-3 py-3">Company Name</th>
                <th className="px-3 py-3">Contact Person</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Supplier Type</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Msgs</th>
                <th className="px-3 py-3">Created By</th>
                <th className="px-3 py-3">Created Date</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading && (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                    <div className="mx-auto h-8 w-48 animate-pulse rounded-lg bg-slate-100" />
                  </td>
                </tr>
              )}
              {!listQuery.isLoading && listRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                    No onboarding requests yet.
                  </td>
                </tr>
              )}
              {pageRows.map((row) => (
                <tr
                  key={row.name}
                  className="border-t border-slate-100 transition hover:bg-slate-50/80"
                >
                  <td className="px-3 py-3 font-semibold text-slate-800">{row.name}</td>
                  <td className="px-3 py-3 font-medium text-slate-800">{row.company_name}</td>
                  <td className="px-3 py-3 text-slate-600">{row.contact_person}</td>
                  <td className="px-3 py-3 text-slate-600">{row.email}</td>
                  <td className="px-3 py-3 text-slate-600">{row.supplier_type}</td>
                  <td className="px-3 py-3 text-slate-600">{row.supplier_category}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {Number(row.unread_for_procurement || 0) > 0 ? (
                      <span className="inline-flex rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                        {row.unread_for_procurement}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{row.created_by_user || "—"}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {row.creation ? String(row.creation).slice(0, 10) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      to={`/suppliers/onboarding/${encodeURIComponent(row.name)}`}
                      className="inline-flex rounded-lg px-2.5 py-1 text-xs font-bold text-white"
                      style={{ backgroundColor: ONB.primary }}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            recordLabel="onboarding requests"
          />
        </div>
      </div>

      <NewOnboardingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        createdBy={user?.email || user?.full_name || "Procurement"}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ["onboarding-list"] });
          void queryClient.invalidateQueries({ queryKey: ["onboarding-stats"] });
        }}
      />
    </div>
  );
}
