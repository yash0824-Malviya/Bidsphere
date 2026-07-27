/**
 * Enterprise table Actions cell: primary View + secondary More menu.
 * Used across RFQ / RFI / RFP / PO / MR / Supplier lists.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Eye, MoreHorizontal, type LucideIcon } from "lucide-react";

export interface TableRowActionItem {
  id: string;
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface TableRowActionsProps {
  /** Detail route for the primary View button. */
  viewTo?: string;
  /** Alternative to viewTo when navigation is handled manually. */
  onView?: () => void;
  viewTooltip?: string;
  moreTooltip?: string;
  /** Document label used in aria-labels, e.g. RFQ name. */
  label?: string;
  items: TableRowActionItem[];
  className?: string;
}

export default function TableRowActions({
  viewTo,
  onView,
  viewTooltip = "View Details",
  moreTooltip = "More Actions",
  label,
  items,
  className = "",
}: TableRowActionsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const visibleItems = items.filter(Boolean);
  const viewAria = label ? `View details for ${label}` : "View Details";
  const moreAria = label ? `More actions for ${label}` : "More Actions";

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const viewBtnClass = "table-action-btn";

  let viewControl: ReactNode = null;
  if (viewTo) {
    viewControl = (
      <Link
        to={viewTo}
        className={viewBtnClass}
        title={viewTooltip}
        aria-label={viewAria}
        onClick={(e) => e.stopPropagation()}
      >
        <Eye className="table-action-icon" aria-hidden />
      </Link>
    );
  } else if (onView) {
    viewControl = (
      <button
        type="button"
        className={viewBtnClass}
        title={viewTooltip}
        aria-label={viewAria}
        onClick={(e) => {
          e.stopPropagation();
          onView();
        }}
      >
        <Eye className="table-action-icon" aria-hidden />
      </button>
    );
  }

  return (
    <div
      className={`table-row-actions ${className}`.trim()}
      ref={rootRef}
      onClick={(e) => e.stopPropagation()}
    >
      {viewControl}

      {visibleItems.length > 0 ? (
        <div className="relative">
          <button
            type="button"
            className="table-action-btn"
            title={moreTooltip}
            aria-label={moreAria}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen((v) => !v)}
          >
            <MoreHorizontal className="table-action-icon" aria-hidden />
          </button>

          {open ? (
            <div
              id={menuId}
              role="menu"
              aria-label={moreAria}
              className="table-actions-menu"
            >
              {visibleItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.id}>
                    {item.separatorBefore ? (
                      <div className="table-actions-menu-sep" role="separator" />
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      className={`table-actions-menu-item${
                        item.danger ? " is-danger" : ""
                      }`}
                      onClick={() => {
                        if (item.disabled) return;
                        setOpen(false);
                        item.onClick();
                      }}
                    >
                      {Icon ? (
                        <Icon className="table-actions-menu-icon" aria-hidden />
                      ) : null}
                      {item.label}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
