import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CircleDot,
  Globe,
  Plus,
  ShoppingCart,
  Users,
} from "lucide-react";

import { getPurchaseOrders } from "../../api/purchasing";
import { getSupplierGroups, getSuppliers } from "../../api/supplier";
import type { Filter } from "../../api/erpnext";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { FilterBar, FilterField, SearchInput, SortableTableHeader } from "../../components/ui";
import { useListSort } from "../../hooks/useListSort";
import { useDebounce } from "../../hooks/useDebounce";
import type { Supplier } from "../../types/erpnext";
import { formatCurrency } from "../../utils/format";

type StatusFilter = "all" | "active" | "inactive";
type SuppliersTab = "directory" | "performance";

export default function SuppliersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: SuppliersTab =
    searchParams.get("tab") === "performance" ? "performance" : "directory";
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filters = useMemo<Filter[]>(() => {
    const f: Filter[] = [];
    if (group) f.push(["supplier_group", "=", group]);
    if (status === "active") f.push(["disabled", "=", 0]);
    if (status === "inactive") f.push(["disabled", "=", 1]);
    if (debouncedSearch)
      f.push(["supplier_name", "like", `%${debouncedSearch}%`]);
    return f;
  }, [group, status, debouncedSearch]);

  const {
    data: suppliers = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["suppliers", filters],
    queryFn: () =>
      getSuppliers({
        filters,
        fields: [
          "name",
          "supplier_name",
          "supplier_group",
          "country",
          "disabled",
          "tax_id",
          "email_id",
        ],
        limit_page_length: 200,
        order_by: "supplier_name asc",
      }),
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["supplier-groups"],
    queryFn: () =>
      getSupplierGroups({
        filters: [["is_group", "=", 0]],
        fields: ["name", "supplier_group_name"],
        limit_page_length: 200,
        order_by: "supplier_group_name asc",
      }),
    staleTime: 5 * 60_000,
  });

  const supplierNames = useMemo(
    () => suppliers.map((s) => s.name),
    [suppliers]
  );

  const { data: poCounts = {} } = useQuery({
    queryKey: ["po-counts-by-supplier", supplierNames],
    enabled: supplierNames.length > 0,
    queryFn: async () => {
      const rows = await getPurchaseOrders({
        filters: [["supplier", "in", supplierNames]],
        fields: ["name", "supplier"],
        limit_page_length: 1000,
      });
      const counts: Record<string, number> = {};
      for (const row of rows) {
        if (!row.supplier) continue;
        counts[row.supplier] = (counts[row.supplier] ?? 0) + 1;
      }
      return counts;
    },
    staleTime: 60_000,
  });

  const { data: poSpend = {} } = useQuery({
    queryKey: ["po-spend-by-supplier", supplierNames],
    enabled: activeTab === "performance" && supplierNames.length > 0,
    queryFn: async () => {
      const rows = await getPurchaseOrders({
        filters: [["supplier", "in", supplierNames]],
        fields: ["name", "supplier", "grand_total", "transaction_date", "creation"],
        order_by: "transaction_date desc, creation desc, name desc",
        limit_page_length: 1000,
      });
      const spend: Record<string, number> = {};
      for (const row of rows) {
        if (!row.supplier) continue;
        spend[row.supplier] = (spend[row.supplier] ?? 0) + (row.grand_total ?? 0);
      }
      return spend;
    },
    staleTime: 60_000,
  });

  type PerformanceRow = {
    name: string;
    supplier_name?: string;
    poCount: number;
    totalSpend: number;
    performanceScore: number;
  };

  const performanceRows = useMemo<PerformanceRow[]>(() => {
    return suppliers
      .map((supplier) => {
        const poCount = poCounts[supplier.name] ?? 0;
        const totalSpend = poSpend[supplier.name] ?? 0;
        // Score based on real PO activity: 0 if no orders, scales with
        // order count and spend volume. Not a hardcoded value.
        const performanceScore = poCount === 0
          ? 0
          : Math.min(100, Math.round(
              Math.min(poCount * 8, 50) + Math.min(totalSpend / 10000, 50)
            ));
        return {
          name: supplier.name,
          supplier_name: supplier.supplier_name,
          poCount,
          totalSpend,
          performanceScore,
        };
      })
      .filter((row) => row.poCount > 0)
      .sort((a, b) => {
        if (b.totalSpend !== a.totalSpend) return b.totalSpend - a.totalSpend;
        if (b.poCount !== a.poCount) return b.poCount - a.poCount;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
  }, [suppliers, poCounts, poSpend]);

  const performanceComparators = useMemo(
    () => ({
      supplier: (
        a: PerformanceRow,
        b: PerformanceRow,
        direction: "asc" | "desc"
      ) => {
        const result = (a.supplier_name ?? a.name).localeCompare(
          b.supplier_name ?? b.name,
          undefined,
          { numeric: true, sensitivity: "base" }
        );
        return direction === "desc" ? -result : result;
      },
      poCount: (
        a: PerformanceRow,
        b: PerformanceRow,
        direction: "asc" | "desc"
      ) => {
        const result = a.poCount - b.poCount;
        return direction === "desc" ? -result : result;
      },
      totalSpend: (
        a: PerformanceRow,
        b: PerformanceRow,
        direction: "asc" | "desc"
      ) => {
        const result = a.totalSpend - b.totalSpend;
        return direction === "desc" ? -result : result;
      },
      performanceScore: (
        a: PerformanceRow,
        b: PerformanceRow,
        direction: "asc" | "desc"
      ) => {
        const result = a.performanceScore - b.performanceScore;
        return direction === "desc" ? -result : result;
      },
    }),
    []
  );

  const {
    sort: performanceSort,
    setSort: setPerformanceSort,
    sortedRows: sortedPerformanceRows,
  } = useListSort(
    performanceRows,
    { key: "totalSpend", direction: "desc" },
    performanceComparators
  );

  function setTab(tab: SuppliersTab) {
    if (tab === "directory") {
      setSearchParams({});
      return;
    }
    setSearchParams({ tab: "performance" });
  }

  return (
    <div>
      <PageHeader
        title={activeTab === "performance" ? "Supplier Performance" : "Suppliers"}
        description={
          activeTab === "performance"
            ? "Rank suppliers by purchase order volume and spend."
            : "Browse, search, and manage all suppliers in the directory."
        }
        actions={
          activeTab === "directory" ? (
            <Link to="/suppliers/new" className="btn-primary">
              <Plus className="h-4 w-4" />
              Add Supplier
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
        <button
          type="button"
          onClick={() => setTab("directory")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "directory"
              ? "bg-white text-neutral-900 shadow-sm"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          Supplier Directory
        </button>
        <button
          type="button"
          onClick={() => setTab("performance")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "performance"
              ? "bg-white text-neutral-900 shadow-sm"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          Supplier Performance
        </button>
      </div>

      {activeTab === "performance" ? (
        isLoading ? (
          <CardGridSkeleton />
        ) : isError ? (
          <ConnectionError
            title="Could not load supplier performance"
            error={error}
            onRetry={() => refetch()}
          />
        ) : sortedPerformanceRows.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No supplier performance data yet"
            description="Performance metrics appear once suppliers have linked purchase orders."
          />
        ) : (
          <section className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                  <tr>
                    <SortableTableHeader
                      label="Supplier"
                      sortKey="supplier"
                      sort={performanceSort}
                      onSort={setPerformanceSort}
                    />
                    <SortableTableHeader
                      label="PO Count"
                      sortKey="poCount"
                      sort={performanceSort}
                      onSort={setPerformanceSort}
                      className="text-right"
                    />
                    <SortableTableHeader
                      label="Total Spend"
                      sortKey="totalSpend"
                      sort={performanceSort}
                      onSort={setPerformanceSort}
                      className="text-right"
                    />
                    <SortableTableHeader
                      label="Performance Score"
                      sortKey="performanceScore"
                      sort={performanceSort}
                      onSort={setPerformanceSort}
                      className="text-right"
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {sortedPerformanceRows.map((row) => (
                    <tr
                      key={row.name}
                      className="cursor-pointer hover:bg-accent-50/40"
                      onClick={() =>
                        navigate(`/suppliers/${encodeURIComponent(row.name)}`)
                      }
                    >
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        {row.supplier_name ?? row.name}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                        {row.poCount}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                        {formatCurrency(row.totalSpend)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-primary-700">
                        {row.performanceScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      ) : (
        <>
      <FilterBar>
        <FilterField label="Search" className="min-w-[220px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Supplier name…"
          />
        </FilterField>
        <FilterField label="Group" className="min-w-[200px]">
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="select-field"
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.supplier_group_name ?? g.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Status" className="min-w-[160px]">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="select-field"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </FilterField>
      </FilterBar>

      {isLoading ? (
        <CardGridSkeleton />
      ) : isError ? (
        <ConnectionError
          title="Could not load suppliers"
          error={error}
          onRetry={() => refetch()}
        />
      ) : suppliers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No suppliers found"
          description="Try adjusting your filters or add a new supplier."
          action={
            <Link to="/suppliers/new" className="btn-primary">
              <Plus className="h-4 w-4" /> Add Supplier
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {suppliers.map((supplier) => (
            <SupplierCard
              key={supplier.name}
              supplier={supplier}
              poCount={poCounts[supplier.name] ?? 0}
              onClick={() =>
                navigate(`/suppliers/${encodeURIComponent(supplier.name)}`)
              }
            />
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function SupplierCard({
  supplier,
  poCount,
  onClick,
}: {
  supplier: Supplier;
  poCount: number;
  onClick: () => void;
}) {
  const isActive = supplier.disabled !== 1;
  return (
    <button
      type="button"
      onClick={onClick}
      className="card group flex flex-col p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-card-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-sm font-semibold text-primary">
          {getInitials(supplier.supplier_name ?? supplier.name)}
        </div>
        <StatusBadge
          status={isActive ? "Active" : "Inactive"}
          tone={isActive ? "success" : "neutral"}
        />
      </div>

      <div className="mt-3 min-w-0">
        <h3 className="truncate text-sm font-semibold text-neutral-900 group-hover:text-primary">
          {supplier.supplier_name ?? supplier.name}
        </h3>
        <p className="truncate text-xs text-neutral-500">{supplier.name}</p>
      </div>

      <div className="mt-3 space-y-1.5 text-xs text-neutral-600">
        <div className="flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-neutral-400" />
          <span className="truncate">
            {supplier.supplier_group ?? "Ungrouped"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5 text-neutral-400" />
          <span className="truncate">{supplier.country ?? "—"}</span>
        </div>
        {supplier.email_id && (
          <div className="flex items-center gap-1.5">
            <CircleDot className="h-3.5 w-3.5 text-neutral-400" />
            <span className="truncate">{supplier.email_id}</span>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-neutral-100 pt-3">
        <div className="flex items-center gap-1.5 text-xs text-neutral-600">
          <ShoppingCart className="h-3.5 w-3.5 text-neutral-400" />
          <span className="font-medium text-neutral-900">{poCount}</span>
          <span>{poCount === 1 ? "purchase order" : "purchase orders"}</span>
        </div>
      </div>
    </button>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="card p-5"
        >
          <div className="flex items-start justify-between">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
