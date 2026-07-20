import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchPagedList } from "../../api/erpnext";
import type { Filter } from "../../api/erpnext";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import StatusBadge from "../../components/StatusBadge";
import ExportButton from "../../components/export/ExportButton";
import { usePagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";
import type { ExportColumn } from "../../utils/export";

interface SupplierQuotationRow {
  name: string;
  supplier?: string;
  supplier_name?: string;
  transaction_date?: string;
  status?: string;
}

const SQ_DOCTYPE = "Supplier Quotation";
const SQ_FIELDS = ["name", "supplier", "supplier_name", "transaction_date", "status"];

export default function SupplierQuotationsListPage() {
  const [searchParams] = useSearchParams();
  const preset = (searchParams.get("preset") ?? "").toLowerCase();

  const filters = useMemo<Filter[] | undefined>(() => {
    if (preset === "pending") {
      return [
        ["status", "not in", ["Ordered", "Expired", "Lost", "Cancelled"]],
      ] as Filter[];
    }
    return undefined;
  }, [preset]);

  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: JSON.stringify(filters ?? []),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["procurement-supplier-quotations", filters, page, pageSize],
    queryFn: () =>
      fetchPagedList<SupplierQuotationRow>(SQ_DOCTYPE, {
        fields: SQ_FIELDS,
        filters,
        order_by: "modified desc",
        page,
        pageSize,
      }),
    placeholderData: (prev) => prev,
  });

  const rows = data?.data ?? [];

  const exportColumns = useMemo<ExportColumn<SupplierQuotationRow>[]>(
    () => [
      { id: "name", label: "Quotation", accessor: (r) => r.name },
      {
        id: "supplier",
        label: "Supplier",
        accessor: (r) => r.supplier_name || r.supplier,
      },
      {
        id: "transaction_date",
        label: "Date",
        type: "date",
        accessor: (r) => r.transaction_date,
      },
      {
        id: "status",
        label: "Status",
        type: "status",
        accessor: (r) => r.status,
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Supplier Quotations"
        description="Review supplier responses to RFQs."
        actions={
          <ExportButton
            module="Supplier Quotation"
            filenamePrefix="Supplier_Quotation"
            columns={exportColumns}
            rows={rows}
          />
        }
      />
      <div className="card overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-3 text-left">Quotation</th>
              <th className="px-4 py-3 text-left">Supplier</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                  No supplier quotations found.
                </td>
              </tr>
            ) : (
              rows.map((sq) => (
                <tr key={sq.name} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 font-semibold text-neutral-900">{sq.name}</td>
                  <td className="px-4 py-3">{sq.supplier_name ?? sq.supplier ?? "—"}</td>
                  <td className="px-4 py-3">{formatDate(sq.transaction_date)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={sq.status ?? "Draft"} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {!isLoading && (
          <PaginationBar
            currentPage={data?.current_page ?? page}
            totalPages={data?.total_pages ?? 1}
            totalRecords={data?.total_records ?? 0}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>
    </div>
  );
}
