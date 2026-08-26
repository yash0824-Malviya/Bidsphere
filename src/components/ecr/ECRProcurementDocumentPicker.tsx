import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";

import type { ECRProcurementDocumentOption } from "../../api/ecrProcurementReferences";

interface Props {
  value: string;
  options: ECRProcurementDocumentOption[];
  onChange: (value: string, selected?: ECRProcurementDocumentOption) => void;
  placeholder: string;
  emptyMessage: string;
  loading?: boolean;
  error?: string;
  loadError?: boolean;
  disabled?: boolean;
  inputClassName: string;
  inputId?: string;
}

export default function ECRProcurementDocumentPicker({
  value,
  options,
  onChange,
  placeholder,
  emptyMessage,
  loading,
  error,
  loadError,
  disabled,
  inputClassName,
  inputId,
}: Props) {
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setSearch(value);
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onOutsidePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSearch(value);
      }
    }
    document.addEventListener("mousedown", onOutsidePointerDown);
    return () => document.removeEventListener("mousedown", onOutsidePointerDown);
  }, [open, value]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) =>
      option.name.toLowerCase().includes(query) ||
      String(option.status ?? "").toLowerCase().includes(query)
    );
  }, [options, search]);
  const isVerified = Boolean(value) && !loadError && options.some((option) => option.name === value);
  const listboxId = inputId ? `${inputId}-options` : undefined;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        <input
          id={inputId}
          type="text"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setSearch(value);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          role="combobox"
          autoComplete="off"
          className={`${inputClassName} pl-8 pr-8 ${error ? "border-rose-400" : ""}`}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400">
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </div>

      {error ? (
        <span className="mt-1 block text-[11px] font-medium text-rose-600">{error}</span>
      ) : isVerified ? (
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
          <Check className="h-3 w-3" /> Valid procurement reference
        </span>
      ) : null}

      {open && !disabled ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-[240px] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {loading ? (
            <p className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading references…
            </p>
          ) : loadError ? (
            <p className="px-3 py-4 text-center text-xs text-rose-600">
              Unable to load procurement references.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-neutral-500">
              {emptyMessage}
            </p>
          ) : (
            filtered.map((option) => (
              <button
                key={option.name}
                type="button"
                role="option"
                aria-selected={option.name === value}
                onClick={() => {
                  setSearch(option.name);
                  lastValueRef.current = option.name;
                  onChange(option.name, option);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-primary-50"
              >
                <span className="truncate font-mono text-xs font-semibold text-neutral-800">
                  {option.name}
                </span>
                {option.status ? (
                  <span className="flex-none text-[10px] font-medium text-neutral-500">
                    {option.status}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
