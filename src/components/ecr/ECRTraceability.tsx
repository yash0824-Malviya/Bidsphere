import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { EngineeringChangeRequest } from "../../types/erpnext";

export default function ECRTraceability({
  ecr,
}: {
  ecr: EngineeringChangeRequest;
}) {
  const items = [
    {
      label: "PR",
      value: ecr.purchase_requisition,
      to: ecr.purchase_requisition
        ? `/ecr/purchase-requisitions/${encodeURIComponent(ecr.purchase_requisition)}`
        : undefined,
    },
    {
      label: "RFQ",
      value: ecr.rfq,
      to: ecr.rfq ? `/sourcing/rfq/${encodeURIComponent(ecr.rfq)}` : undefined,
    },
    { label: "Quotation", value: ecr.supplier_quotation },
    { label: "Supplier", value: ecr.selected_supplier },
    { label: "PO", value: ecr.purchase_order },
  ].filter((item) => Boolean(item.value));

  if (items.length === 0) {
    return <span className="text-neutral-400 text-xs">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        item.to ? (
          <Link
            key={item.label}
            to={item.to}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-primary-700 hover:border-primary-300 hover:text-primary-800"
          >
            <span>{item.label}: {item.value}</span>
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        ) : (
          <span
            key={item.label}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-medium text-neutral-700"
          >
            {item.label}: {item.value}
          </span>
        )
      ))}
    </div>
  );
}
