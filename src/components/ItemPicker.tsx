import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { apiGet } from "../api/erpnext";
import { useDebounce } from "../hooks/useDebounce";

export interface ItemOption {
  name: string;
  item_name?: string;
  description?: string;
  stock_uom?: string;
  standard_rate?: number;
}

interface Props {
  value: string;
  onSelect: (item: ItemOption) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function ItemPicker({
  value,
  onSelect,
  placeholder = "Search items…",
  disabled,
}: Props) {
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounce(search, 250);

  useEffect(() => {
    setSearch(value);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  const { data: items = [], isFetching } = useQuery<ItemOption[]>({
    queryKey: ["item-search", debounced],
    queryFn: () =>
      apiGet<ItemOption[]>("/api/resource/Item", {
        params: {
          filters: debounced
            ? JSON.stringify([
                ["item_name", "like", `%${debounced}%`],
              ])
            : undefined,
          fields: JSON.stringify([
            "name",
            "item_name",
            "description",
            "stock_uom",
            "standard_rate",
          ]),
          limit_page_length: 20,
          order_by: "modified desc",
        },
      }),
    enabled: open,
    staleTime: 30_000,
  });

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-neutral-400">
          <Search className="h-3.5 w-3.5" />
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-md border border-neutral-300 bg-white pl-8 pr-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-neutral-50 disabled:text-neutral-500"
        />
        {isFetching && open && (
          <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-neutral-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {items.length === 0 && !isFetching ? (
            <div className="px-3 py-6 text-center text-xs text-neutral-500">
              No items found
            </div>
          ) : (
            <ul className="py-1">
              {items.map((item) => (
                <li key={item.name}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(item);
                      setSearch(item.name);
                      setOpen(false);
                    }}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-primary-50"
                  >
                    <span className="text-sm font-medium text-neutral-900">
                      {item.name}
                    </span>
                    {item.item_name && item.item_name !== item.name && (
                      <span className="text-xs text-neutral-500">
                        {item.item_name}
                      </span>
                    )}
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
