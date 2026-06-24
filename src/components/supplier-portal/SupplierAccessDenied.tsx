import { ShoppingCart } from "lucide-react";

import EmptyState from "../EmptyState";

interface Props {
  title?: string;
  description?: string;
}

export default function SupplierAccessDenied({
  title = "Access denied",
  description = "This record does not belong to your supplier account.",
}: Props) {
  return (
    <EmptyState icon={ShoppingCart} title={title} description={description} />
  );
}
