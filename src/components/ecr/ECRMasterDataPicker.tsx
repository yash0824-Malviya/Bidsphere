import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";

import {
  searchECRMasterOptions,
  type ECRMasterKind,
  type ECRMasterOption,
} from "../../api/ecrMasterData";
import { useDebounce } from "../../hooks/useDebounce";

interface Props {
  kind: ECRMasterKind;
  value: string;
  onChange: (value: string, selected?: ECRMasterOption) => void;
  placeholder: string;
  error?: string;
  valid?: boolean;
  inputClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  /** Keep arbitrary search text local and emit only a selected canonical value. */
  selectionOnly?: boolean;
  inputId?: string;
}

export default function ECRMasterDataPicker({
  kind,
  value,
  onChange,
  placeholder,
  error,
  valid,
  inputClassName,
  compact,
  disabled,
  selectionOnly,
  inputId,
}: Props) {
  const [search, setSearch] = useState(value);
  const [committedDisplay, setCommittedDisplay] = useState(value);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastEmittedValue = useRef(value);
  const debouncedSearch = useDebounce(search, 250);

  useEffect(() => {
    if (value !== lastEmittedValue.current) {
      lastEmittedValue.current = value;
      setSearch(value);
      setCommittedDisplay(value);
    }
  }, [value]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        if (selectionOnly) setSearch(committedDisplay);
      }
    }
    if (!open) return;
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [committedDisplay, open, selectionOnly]);

  useEffect(() => {
    if (!open) return;
    function positionMenu() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(220, rect.width),
        zIndex: 100,
      });
    }
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  const optionsQuery = useQuery({
    queryKey: ["ecr-master-options", kind, debouncedSearch],
    queryFn: () => searchECRMasterOptions(kind, debouncedSearch),
    enabled: open && !disabled,
    staleTime: 30_000,
  });

  function emit(nextValue: string, selected?: ECRMasterOption) {
    lastEmittedValue.current = nextValue;
    onChange(nextValue, selected);
  }

  const listboxId = inputId ? `${inputId}-options` : undefined;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <div className="relative">
        <Search className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 ${compact ? "h-3 w-3" : "h-3.5 w-3.5"}`} />
        <input
          id={inputId}
          type="text"
          value={search}
          onChange={(event) => {
            const nextValue = event.target.value;
            setSearch(nextValue);
            if (!selectionOnly || nextValue === "") {
              if (nextValue === "") setCommittedDisplay("");
              emit(nextValue);
            }
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              if (selectionOnly) setSearch(committedDisplay);
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
          className={`${inputClassName || ""} ${compact ? "pl-7 pr-7" : "pl-8 pr-8"} ${error ? "border-rose-400" : ""}`}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400">
          {optionsQuery.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </div>

      {error ? (
        <span className="mt-1 block text-[11px] font-medium text-rose-600">{error}</span>
      ) : valid && value && (!selectionOnly || search === committedDisplay) ? (
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
          <Check className="h-3 w-3" /> Valid
        </span>
      ) : null}

      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          style={menuStyle}
          className="max-h-64 min-w-[220px] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {optionsQuery.isError ? (
            <p className="px-3 py-4 text-center text-xs text-rose-600">
              Unable to load master data.
            </p>
          ) : !optionsQuery.isFetching && (optionsQuery.data?.length ?? 0) === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-neutral-500">
              No matching records found.
            </p>
          ) : (
            optionsQuery.data?.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  setSearch(option.label);
                  setCommittedDisplay(option.label);
                  emit(option.value, option);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-primary-50"
              >
                <span className="text-xs font-semibold text-neutral-800">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 text-[11px] text-neutral-500">{option.description}</span>
                ) : null}
              </button>
            ))
          )}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
