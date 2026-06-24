import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { getSuppliers } from "../api/supplier";

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

/**
 * Tag-style multi-select for ERPNext suppliers. Loads up to 200 enabled
 * suppliers once and filters client-side as the user types.
 */
export default function SupplierMultiPicker({
  value,
  onChange,
  placeholder = "Search and select suppliers…",
}: Props) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["all-suppliers"],
    queryFn: () =>
      getSuppliers({
        filters: [["disabled", "=", 0]],
        fields: ["name", "supplier_name", "supplier_group", "country"],
        limit_page_length: 500,
        order_by: "supplier_name asc",
      }),
    staleTime: 60_000,
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  const valueLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of suppliers) map.set(s.name, s.supplier_name ?? s.name);
    return map;
  }, [suppliers]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers
      .filter((s) => !value.includes(s.name))
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          (s.supplier_name ?? "").toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [suppliers, search, value]);

  function add(supplier: string) {
    onChange([...value, supplier]);
    setSearch("");
    inputRef.current?.focus();
  }

  function remove(supplier: string) {
    onChange(value.filter((v) => v !== supplier));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && search === "" && value.length > 0) {
      remove(value[value.length - 1]);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <div
        onClick={() => {
          inputRef.current?.focus();
          setOpen(true);
        }}
        className="flex flex-wrap items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm shadow-sm focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/20"
      >
        {value.map((supplier) => (
          <span
            key={supplier}
            className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
          >
            {valueLookup.get(supplier) ?? supplier}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(supplier);
              }}
              className="text-primary-500 hover:text-primary-700"
              aria-label={`Remove ${supplier}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="flex flex-1 items-center gap-1.5 px-1">
          {value.length === 0 && (
            <Search className="h-3.5 w-3.5 text-neutral-400" />
          )}
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ""}
            className="min-w-[120px] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-neutral-400"
          />
        </div>
      </div>

      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {isLoading ? (
            <div className="px-3 py-4 text-center text-xs text-neutral-500">
              Loading suppliers…
            </div>
          ) : matches.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-neutral-500">
              {search
                ? "No suppliers match your search."
                : "All suppliers selected."}
            </div>
          ) : (
            <ul className="py-1">
              {matches.map((s) => (
                <li key={s.name}>
                  <button
                    type="button"
                    onClick={() => add(s.name)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-primary-50"
                  >
                    <span className="text-sm font-medium text-neutral-900">
                      {s.supplier_name ?? s.name}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {[s.supplier_group, s.country].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
