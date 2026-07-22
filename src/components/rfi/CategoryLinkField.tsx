import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { RFI_CATEGORIES } from "../../types/rfi";

interface Props {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  required?: boolean;
  /** Override category master (defaults to RFI categories). */
  categories?: readonly string[];
  label?: string;
}

/**
 * Enterprise searchable category select (Link-style).
 * Search + options live in one popup panel — no detached search field.
 */
export default function CategoryLinkField({
  value,
  onChange,
  disabled,
  required,
  categories = RFI_CATEGORIES,
  label = "Category",
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const unique = Array.from(new Set(categories));
    if (!q) return unique;
    return unique.filter((c) => c.toLowerCase().includes(q));
  }, [query, categories]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  const selectOption = (next: string) => {
    onChange(next);
    close();
  };

  // Focus search + highlight current value when the panel opens.
  useEffect(() => {
    if (!open) return;
    const selected = value ? options.findIndex((c) => c === value) : -1;
    setActiveIndex(selected >= 0 ? selected : 0);
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
    // Intentionally only when `open` flips — not on every filter keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep activeIndex in range when filter results shrink.
  useEffect(() => {
    if (!open) return;
    setActiveIndex((i) => {
      if (options.length === 0) return 0;
      return Math.min(i, options.length - 1);
    });
  }, [open, options.length]);

  // Click outside closes the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Esc closes from anywhere while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Scroll active option into view.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!options.length) return;
      setActiveIndex((i) => (i + 1) % options.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!options.length) return;
      setActiveIndex((i) => (i - 1 + options.length) % options.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = options[activeIndex];
      if (pick) selectOption(pick);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-neutral-600">
        {label} {required ? <span className="text-danger-500">*</span> : null}
      </label>

      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        onKeyDown={onTriggerKeyDown}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border border-[#E5E7EB] bg-white px-3 text-left text-[14px] outline-none transition-colors hover:border-neutral-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-neutral-50"
      >
        <span className={value ? "text-neutral-900" : "text-neutral-400"}>
          {value || "Select category…"}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-neutral-400" />
      </button>

      {open && !disabled ? (
        <div
          className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-[10px] border border-[#E5E7EB] bg-white shadow-lg"
          style={{ width: "100%" }}
        >
          {/* Sticky search — top radius only (panel clips); no nested “second input” look */}
          <div className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white">
            <div className="relative px-2 py-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-controls={listId}
                aria-expanded={open}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search categories…"
                className="w-full rounded-none border-0 bg-transparent py-1.5 pl-7 pr-2 text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400"
              />
            </div>
          </div>

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-[300px] overflow-y-auto overscroll-contain scroll-smooth py-1"
          >
            {options.map((c, i) => {
              const selected = c === value;
              const active = i === activeIndex;
              return (
                <li key={c} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-option-index={i}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => selectOption(c)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[14px] transition-colors ${
                      selected
                        ? "bg-primary-50 font-medium text-primary-800"
                        : active
                          ? "bg-neutral-50 text-neutral-900"
                          : "text-neutral-800 hover:bg-neutral-50"
                    }`}
                  >
                    <span className="truncate">{c}</span>
                    {selected ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary-700" />
                    ) : null}
                  </button>
                </li>
              );
            })}
            {options.length === 0 ? (
              <li className="px-3 py-4 text-center text-[13px] text-neutral-500">
                No matching category
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
