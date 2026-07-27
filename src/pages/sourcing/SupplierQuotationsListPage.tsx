import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, FileText, Link2 } from "lucide-react";
import toast from "react-hot-toast";

import { fetchPagedList } from "../../api/erpnext";
import type { Filter } from "../../api/erpnext";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import StatusBadge from "../../components/StatusBadge";
import ExportButton from "../../components/export/ExportButton";
import { TableRowActions } from "../../components/ui";
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
        <table className="data-table min-w-full">
          <thead>
            <tr>
              <th>Quotation</th>
              <th>Supplier</th>
              <th>Date</th>
              <th>Status</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                  No supplier quotations found.
                </td>
              </tr>
            ) : (
              rows.map((sq) => {
                /* Buyer SQ detail is typically reviewed in RFQ context; keep name for deep-link when available. */
                const detailPath = `/sourcing/rfq?q=${encodeURIComponent(sq.name)}`;
                return (
                  <tr key={sq.name}>
                    <td className="font-semibold text-neutral-900">{sq.name}</td>
                    <td>{sq.supplier_name ?? sq.supplier ?? "—"}</td>
                    <td>{formatDate(sq.transaction_date)}</td>
                    <td>
                      <StatusBadge status={sq.status ?? "Draft"} />
                    </td>
                    <td className="col-actions">
                      <TableRowActions
                        label={sq.name}
                        onView={() =>
                          toast(`Open related RFQ to review ${sq.name}`, {
                            icon: "ℹ️",
                          })
                        }
                        items={[
                          {
                            id: "view",
                            label: "View",
                            icon: Eye,
                            onClick: () =>
                              toast(`Open related RFQ to review ${sq.name}`, {
                                icon: "ℹ️",
                              }),
                          },
                          {
                            id: "pdf",
                            label: "Download PDF",
                            icon: Download,
                            onClick: () =>
                              toast("PDF export is available from the quotation detail", {
                                icon: "ℹ️",
                              }),
                          },
                          {
                            id: "export",
                            label: "Export",
                            icon: FileText,
                            onClick: () =>
                              toast("Use Export on the toolbar", { icon: "ℹ️" }),
                          },
                          {
                            id: "copy",
                            label: "Copy Link",
                            icon: Link2,
                            onClick: () => {
                              void navigator.clipboard
                                .writeText(
                                  `${window.location.origin}${detailPath}`,
                                )
                                .then(() => toast.success("Link copied"))
                                .catch(() =>
                                  toast.error("Could not copy link"),
                                );
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })
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
