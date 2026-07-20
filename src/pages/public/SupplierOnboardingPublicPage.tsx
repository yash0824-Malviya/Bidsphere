import { Navigate } from "react-router-dom";

/**
 * Public token onboarding has been retired.
 * Suppliers complete onboarding inside the Supplier Portal after account generation.
 */
export default function SupplierOnboardingPublicPage() {
  return <Navigate to="/supplier/login" replace />;
}
