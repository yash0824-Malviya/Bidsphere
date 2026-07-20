import { useLocation } from "react-router-dom";
import { SupplierModuleLockedPage } from "./SupplierPortalProfilePage";

export default function SupplierLockedPage() {
  const location = useLocation();
  const title =
    (location.state as { title?: string } | null)?.title || "This module is";
  return <SupplierModuleLockedPage title={title} />;
}
