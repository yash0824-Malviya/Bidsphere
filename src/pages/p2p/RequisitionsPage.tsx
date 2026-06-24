import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, ClipboardList, Plus } from "lucide-react";

import { getMaterialRequests } from "../../api/purchasing";
import type { Filter } from "../../api/erpnext";
import type {
  MaterialRequest,
  MaterialRequestStatus,
} from "../../types/erpnext";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import {
  FilterBar,
  FilterField,
  SearchInput,
} from "../../components/ui";
import { useDebounce } from "../../hooks/useDebounce";
import { formatDate } from "../../utils/format";

const STATUS_OPTIONS: Array<"" | MaterialRequestStatus> = [
  "",
  "Draft",
  "Pending",
  "Submitted",
  "Partially Ordered",
  "Ordered",
  "Stopped",
  "Cancelled",
];

export default function RequisitionsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"" | MaterialRequestStatus>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const filters = useMemo<Filter[]>(() => {
    const f: Filter[] = [];
    if (status) f.push(["status", "=", status]);
    if (from) f.push(["transaction_date", ">=", from]);
    if (to) f.push(["transaction_date", "<=", to]);
    if (debouncedSearch) f.push(["name", "like", `%${debouncedSearch}%`]);
    return f;
  }, [status, from, to, debouncedSearch]);

  const {
    data: rows = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["material-requests", filters],
    queryFn: () =>
      getMaterialRequests({
        filters,
        fields: [
          "name",
          "title",
          "transaction_date",
          "schedule_date",
          "status",
          "owner",
          "company",
        ],
        order_by: "modified desc",
        limit_page_length: 100,
      }),
  });

  return (
    <div>
      <PageHeader
        title="Material Requests"
        description="Track all purchase material requests raised across departments."
        actions={
          <Link to="/p2p/requisitions/new" className="btn-primary">
            <Plus className="h-4 w-4" />
            New Material Request
          </Link>
        }
      />

      <FilterBar>
        <FilterField label="Search" className="min-w-[220px] flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="MR number…"
          />
        </FilterField>
        <FilterField label="Status" className="min-w-[160px]">
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as MaterialRequestStatus | "")
            }
            className="select-field"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt || "All statuses"}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="From" className="min-w-[150px]">
          <div className="relative">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input-field pr-9"
            />
            <Calendar className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          </div>
        </FilterField>
        <FilterField label="To" className="min-w-[150px]">
          <div className="relative">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input-field pr-9"
            />
            <Calendar className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          </div>
        </FilterField>
      </FilterBar>

      <div className="table-shell">
        {isLoading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : isError ? (
          <ConnectionError
            title="Could not load material requests"
            error={error}
            onRetry={() => refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No material requests yet"
            description="Get started by creating a new material request."
            action={
              <Link to="/p2p/requisitions/new" className="btn-primary">
                <Plus className="h-4 w-4" /> New Material Request
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>MR Number</th>
                  <th>Title</th>
                  <th>Date</th>
                  <th>Required By</th>
                  <th>Requested By</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((mr: MaterialRequest) => (
                  <tr
                    key={mr.name}
                    onClick={() => navigate(`/p2p/requisitions/${mr.name}`)}
                    className="cursor-pointer"
                  >
                    <td>
                      <span className="table-link">{mr.name}</span>
                    </td>
                    <td className="text-neutral-600">
                      {mr.title ?? "—"}
                    </td>
                    <td className="text-neutral-600">
                      {formatDate(mr.transaction_date)}
                    </td>
                    <td className="text-neutral-600">
                      {formatDate(mr.schedule_date) || "—"}
                    </td>
                    <td className="text-neutral-600">
                      {mr.requested_by ?? mr.owner ?? "—"}
                    </td>
                    <td>
                      <StatusBadge status={mr.status ?? "Draft"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
