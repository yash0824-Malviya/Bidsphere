/**
 * AccessDenied — shown when ProtectedRoute denies access to a route.
 *
 * Replaces the blank white screen that previously appeared on RBAC denial.
 * Never exposes role internals or redirect targets.
 */

import { useNavigate } from "react-router-dom";
import { ShieldX } from "lucide-react";

interface Props {
  /** Optional override message (defaults to generic access-denied copy). */
  message?: string;
}

export default function AccessDenied({ message }: Props) {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-neutral-50 px-4">
      <div className="flex max-w-md flex-col items-center gap-6 rounded-2xl border border-neutral-200 bg-white p-10 text-center shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <ShieldX className="h-8 w-8 text-red-500" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-neutral-900">Access Denied</h1>
          <p className="text-sm text-neutral-500">
            {message ??
              "You do not have permission to access this page. Please contact your administrator if you believe this is an error."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
