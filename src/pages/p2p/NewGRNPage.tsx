import { Navigate, useSearchParams } from "react-router-dom";

/**
 * Legacy `/p2p/grn/new` entry point.
 * All GRN creation is routed through the Warehouse e-sign wizard so the
 * signed PDF is generated and stored before the GRN is finalized.
 */
export default function NewGRNPage() {
  const [searchParams] = useSearchParams();
  const initialPO = searchParams.get("po") ?? "";
  const to = initialPO
    ? `/warehouse/inventory/create-grn?po=${encodeURIComponent(initialPO)}`
    : "/warehouse/inventory/create-grn";
  return <Navigate to={to} replace />;
}
