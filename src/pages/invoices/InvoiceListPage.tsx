import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Eye, Receipt, Search } from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import InvoiceStatusBadge from "../../components/InvoiceStatusBadge";
import PaginationBar from "../../components/PaginationBar";
import PdfActions from "../../components/PdfActions";
import ExportButton from "../../components/export/ExportButton";
import type { ExportColumn } from "../../utils/export";
import { getAllInvoices, getVoucherById } from "../../api/vouchers";
import { usePagination } from "../../hooks/usePagination";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDate } from "../../utils/format";
import { buildVoucherInvoicePdf } from "../../utils/pdf/voucherDocPdf";
import type { InvoiceStatus } from "../../types/voucher";

type StatusFilter = "all" | InvoiceStatus;

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "submitted", label: "Submitted" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "paid", label: "Paid" },
];

/**
 * Supplier invoices raised against Finance vouchers.
 *
 * Finance reviews/approves/rejects/pays from the detail page; Procurement sees
 * the same list and detail in read-only mode (monitoring only). Records are
 * derived from the voucher store so the linkage chain (Voucher → GRN → PO →
 * Supplier) is preserved end to end.
 */
export default function InvoiceListPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const readOnly = role === "procurement";

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const syncVersion = useVoucherSyncStore((s) => s.version);
  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices-all", syncVersion],
    queryFn: () => getAllInvoices(),
    staleTime: 30_000,
  });

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (inv.invoice_number ?? "").toLowerCase().includes(q) ||
        (inv.supplier_name ?? "").toLowerCase().includes(q) ||
        (inv.voucher_id ?? "").toLowerCase().includes(q) ||
        (inv.po_reference ?? "").toLowerCase().includes(q) ||
        (inv.grn_reference ?? "").toLowerCase().includes(q)
      );
    });
  }, [invoices, statusFilter, q]);

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      all: invoices.length,
      submitted: 0,
      approved: 0,
      rejected: 0,
      paid: 0,
    };
    for (const inv of invoices) base[inv.status] += 1;
    return base;
  }, [invoices]);

  // Invoices are a derived view built from Voucher documents (not a raw
  // ERPNext doctype list), so the fetch stays a single bulk query —
  // pagination is applied client-side over the already-filtered rows.
  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: `${statusFilter}|${q}`,
  });
  const totalRecords = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedInvoices = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  );

  const exportColumns = useMemo<ExportColumn<(typeof filtered)[number]>[]>(
    () => [
      { id: "invoice_number", label: "Invoice Number", accessor: (r) => r.invoice_number },
      { id: "supplier_name", label: "Supplier", accessor: (r) => r.supplier_name },
      { id: "voucher_id", label: "Voucher", accessor: (r) => r.voucher_id },
      { id: "po_reference", label: "PO", accessor: (r) => r.po_reference },
      { id: "grn_reference", label: "GRN", accessor: (r) => r.grn_reference },
      {
        id: "raised_at",
        label: "Invoice Date",
        type: "date",
        accessor: (r) => r.raised_at,
      },
      {
        id: "due_date",
        label: "Due Date",
        type: "date",
        accessor: (r) => r.due_date,
      },
      {
        id: "amount",
        label: "Amount",
        type: "currency",
        accessor: (r) => r.amount,
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
        title="Invoices"
        description={
          readOnly
            ? "Supplier-submitted invoices against vouchers — monitoring view (read only)."
            : "Supplier-submitted invoices only. Review, approve, or reject — invoices are created in the Supplier Portal."
        }
        actions={
          <ExportButton
            module="Invoice"
            filenamePrefix="Invoice_List"
            columns={exportColumns}
            rows={filtered}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 sm:max-w-sm sm:flex-1">
          <Search className="h-4 w-4 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by invoice, voucher, supplier, PO or GRN…"
            className="w-full text-sm focus:outline-none"
          />
        </div>

        <div className="inline-flex flex-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-white text-primary-700 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700"
                }`}
              >
                {tab.label}
                <span className="ml-1.5 tabular-nums text-neutral-400">
                  {counts[tab.id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Receipt}
            title="No invoices yet"
            description="When a supplier creates an invoice from a voucher you sent, it will appear here."
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Invoice No</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Voucher / PO / GRN</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">PDF</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {pagedInvoices.map((inv) => (
                  <tr
                    key={inv.voucher_id}
                    onClick={() =>
                      navigate(
                        `/p2p/invoices/${encodeURIComponent(inv.voucher_id)}`
                      )
                    }
                    className="cursor-pointer hover:bg-neutral-50"
                  >
                    <td className="px-4 py-3 font-semibold text-primary-700">
                      {inv.invoice_number}
                    </td>
                    <td className="px-4 py-3 text-neutral-900">
                      {inv.supplier_name}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      <span className="font-medium text-neutral-700">
                        {inv.voucher_id}
                      </span>
                      {inv.po_reference ? ` · ${inv.po_reference}` : ""}
                      {inv.grn_reference ? ` · ${inv.grn_reference}` : ""}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatCurrency(inv.amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                      {formatDate(inv.raised_at)}
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-3">
                      <PdfActions
                        variant="compact"
                        stopPropagation
                        filename={
                          inv.invoice_number.toUpperCase().startsWith("INV")
                            ? `${inv.invoice_number}.pdf`
                            : `INV-${inv.invoice_number}.pdf`
                        }
                        build={async () => {
                          const v = await getVoucherById(inv.voucher_id);
                          if (!v) throw new Error("Voucher not found");
                          return buildVoucherInvoicePdf(v);
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700">
                        <Eye className="h-3.5 w-3.5" />
                        {readOnly ? "View" : "Review"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}
    </div>
  );
}
