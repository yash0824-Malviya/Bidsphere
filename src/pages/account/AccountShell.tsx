import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  breadcrumbItems?: { label: string; to?: string }[];
  maxWidthClass?: string;
}

/** Enterprise page chrome for account & profile screens. */
export default function AccountShell({
  title,
  description,
  actions,
  children,
  breadcrumbItems = [
    { label: "Dashboard", to: "/dashboard" },
    { label: "Account", to: "/account/profile" },
    { label: title },
  ],
  maxWidthClass = "max-w-[960px]",
}: Props) {
  return (
    <div className={`mx-auto w-full px-4 py-6 sm:px-6 md:py-8 ${maxWidthClass}`}>
      {/* Breadcrumb */}
      {breadcrumbItems && breadcrumbItems.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-slate-500">
          <Link
            to="/dashboard"
            className="flex items-center gap-1 font-medium text-slate-500 transition hover:text-slate-900"
          >
            <Home className="h-3.5 w-3.5" />
          </Link>
          {breadcrumbItems.map((item, idx) => (
            <div key={item.label + idx} className="flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-slate-400" />
              {item.to && idx < breadcrumbItems.length - 1 ? (
                <Link
                  to={item.to}
                  className="font-medium text-slate-500 transition hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="font-semibold text-slate-800">{item.label}</span>
              )}
            </div>
          ))}
        </nav>
      )}

      {/* Page Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
        ) : null}
      </div>

      {children}
    </div>
  );
}

export function AccountCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

export function FieldGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 ${className}`}
    >
      {children}
    </div>
  );
}

export function FieldItem({
  label,
  value,
  subtext,
}: {
  label: string;
  value: ReactNode;
  subtext?: string;
}) {
  return (
    <div className="flex flex-col justify-start">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <div className="mt-1 text-sm font-semibold text-slate-900">
        {value ?? "—"}
      </div>
      {subtext && <p className="mt-0.5 text-xs text-slate-400">{subtext}</p>}
    </div>
  );
}

export const accountInputClassName =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 shadow-xs transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

export const accountBtnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

export const accountBtnSecondary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20";
