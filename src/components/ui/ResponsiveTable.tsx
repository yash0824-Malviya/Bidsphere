import type { ReactNode } from "react";

export interface ResponsiveColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Hide on mobile card view (e.g. actions duplicated elsewhere) */
  hideOnMobile?: boolean;
}

interface Props<T> {
  columns: ResponsiveColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  children: ReactNode;
}

export default function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  children,
}: Props<T>) {
  const mobileColumns = columns.filter((c) => !c.hideOnMobile);

  return (
    <>
      <div className="data-card-list">
        {rows.map((row) => {
          const key = rowKey(row);
          return (
            <div
              key={key}
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={`data-card-row ${onRowClick ? "cursor-pointer" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
            >
              {mobileColumns.map((col) => (
                <div key={col.key} className="data-card-field">
                  <span className="data-card-label">{col.header}</span>
                  <span className="data-card-value">{col.render(row)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto md:block">{children}</div>
    </>
  );
}
