import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Minimal page chrome for account screens — no settings tabs. */
export default function AccountShell({
  title,
  description,
  actions,
  children,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-[720px]">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight text-neutral-900">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-[13px] leading-5 text-neutral-500">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
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
      className={`rounded-[12px] border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {children}
    </section>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
      {children}
    </div>
  );
}

export function FieldItem({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-[13px] font-medium text-neutral-800">
        {value ?? "—"}
      </p>
    </div>
  );
}

export const accountInputClassName = "input-field";

export const accountBtnPrimary = "btn-primary";

export const accountBtnSecondary = "btn-secondary";
