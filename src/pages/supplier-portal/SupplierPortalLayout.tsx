import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, LogOut, User } from "lucide-react";

import SupplierPortalSidebar, {
  SupplierPortalMobileNav,
} from "./SupplierPortalSidebar";

interface Props {
  supplierName?: string;
  children: ReactNode;
}

export default function SupplierPortalLayout({
  supplierName,
  children,
}: Props) {
  const navigate = useNavigate();

  function handleLogout() {
    sessionStorage.removeItem("supplier_session");
    navigate("/supplier/login", { replace: true });
  }

  return (
    <div className="supplier-portal-layout flex min-h-screen w-full flex-col bg-[#f8fafb] lg:flex-row">
      {supplierName && (
        <div className="hidden shrink-0 lg:block">
          <SupplierPortalSidebar supplierName={supplierName} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 shrink-0 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5 lg:px-6">
            <Link
              to={
                supplierName ? "/supplier/dashboard" : "/supplier/login"
              }
              className="flex min-w-0 items-center gap-2 lg:hidden"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-600 text-white">
                <Building2 className="h-4 w-4" />
              </div>
              <span className="truncate text-sm font-semibold text-neutral-900">
                BidSphere Supplier Portal
              </span>
            </Link>

            {supplierName ? (
              <div className="ml-auto flex items-center gap-2 sm:gap-3">
                <span className="hidden items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700 ring-1 ring-inset ring-accent-200 sm:inline-flex">
                  <User className="h-3 w-3" />
                  <span className="max-w-[140px] truncate">{supplierName}</span>
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn-touch inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            ) : (
              <span className="ml-auto text-xs text-neutral-500">
                Supplier sign in
              </span>
            )}
          </div>
          {supplierName && <SupplierPortalMobileNav />}
        </header>

        <main className="page-container flex-1 px-4 py-4 sm:px-5 sm:py-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl pb-8">{children}</div>
        </main>

        <footer className="shrink-0 border-t border-neutral-200 bg-white px-4 py-3 text-center text-[11px] text-neutral-400">
          © Netlink Software Group · BidSphere Supplier Portal
        </footer>
      </div>
    </div>
  );
}
