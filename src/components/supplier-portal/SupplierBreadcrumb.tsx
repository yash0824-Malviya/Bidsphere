import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export interface SupplierCrumb {
  label: string;
  to?: string;
}

interface Props {
  items: SupplierCrumb[];
}

/** In-content breadcrumb for Supplier Portal pages (not the top header). */
export default function SupplierBreadcrumb({ items }: Props) {
  if (!items.length) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1 text-[13px]">
        {items.map((item, idx) => {
          const last = idx === items.length - 1;
          return (
            <Fragment key={`${item.label}-${idx}`}>
              {idx > 0 ? (
                <li aria-hidden className="px-0.5 text-neutral-300">
                  <ChevronRight className="h-3.5 w-3.5" />
                </li>
              ) : null}
              <li className="min-w-0">
                {last || !item.to ? (
                  <span className="truncate font-medium text-neutral-800">
                    {item.label}
                  </span>
                ) : (
                  <Link
                    to={item.to}
                    className="truncate font-medium text-neutral-500 transition hover:text-primary-700"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
