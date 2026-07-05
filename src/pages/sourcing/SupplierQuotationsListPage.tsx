import { useQuery } from "@tanstack/react-query";
import { apiGet, buildListConfig, buildResourceUrl } from "../../api/erpnext";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { formatDate } from "../../utils/format";

interface SupplierQuotationRow {
  name: string;
  supplier?: string;
  supplier_name?: string;
  transaction_date?: string;
  status?: string;
}

export default function SupplierQuotationsListPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["procurement-supplier-quotations"],
    queryFn: () =>
      apiGet<SupplierQuotationRow[]>(
        buildResourceUrl("Supplier Quotation"),
        buildListConfig({
          fields: ["name", "supplier", "supplier_name", "transaction_date", "status"],
          order_by: "modified desc",
          limit_page_length: 100,
        })
      ),
  });

  return (
    <div>
      <PageHeader
        title="Supplier Quotations"
        description="Review supplier responses to RFQs."
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
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                  No supplier quotations found.
                </td>
              </tr>
            ) : (
              data.map((sq) => (
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
      </div>
    </div>
  );
}
