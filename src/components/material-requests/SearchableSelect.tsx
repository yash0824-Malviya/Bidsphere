import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronDown, Loader2, Search } from "lucide-react";

export interface SearchableOption {
  /** Unique value / key for the option. */
  value: string;
  /** Primary display text. */
  label: string;
  /** Secondary line (e.g. item name). */
  sublabel?: string;
  /** Tertiary line (e.g. description). */
  detail?: string;
  /** When true the option is shown but not selectable. */
  disabled?: boolean;
}

interface Props {
  options: SearchableOption[];
  /** Currently selected value ("" when none). */
  selectedValue: string;
  /**
   * Human label for the current selection — displayed when the field is not
   * being actively searched. Lets callers show a selection even before the
   * option list has loaded (e.g. when hydrating an edit form).
   */
  selectedLabel?: string;
  onSelect: (option: SearchableOption) => void;
  /** Fired when the user clears the text while a value was selected. */
  onClear?: () => void;
  disabled?: boolean;
  loading?: boolean;
  error?: boolean;
  invalid?: boolean;
  placeholder?: string;
  disabledPlaceholder?: string;
  loadingPlaceholder?: string;
  ariaLabel?: string;
  emptyText?: string;
  errorText?: string;
}

const inputCls = (invalid: boolean, disabled: boolean) =>
  [
    "h-10 w-full rounded-lg border bg-white pl-8 pr-9 text-sm shadow-sm transition",
    "focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
    invalid ? "border-danger-400" : "border-neutral-300",
    disabled
      ? "cursor-not-allowed bg-neutral-50 text-neutral-400"
      : "text-neutral-900",
  ].join(" ");

/**
 * Accessible, portal-rendered searchable dropdown. Live data is supplied by the
 * caller via `options` — this component owns only the search text, open state,
 * keyboard navigation and positioning. It renders explicit loading / empty /
 * error states so callers never have to.
 */
export default function SearchableSelect({
  options,
  selectedValue,
  selectedLabel,
  onSelect,
  onClear,
  disabled = false,
  loading = false,
  error = false,
  invalid = false,
  placeholder = "Type to search",
  disabledPlaceholder,
  loadingPlaceholder = "Loading…",
  ariaLabel,
  emptyText = "No results.",
  errorText = "Couldn't load data. Please retry.",
}: Props) {
  const [search, setSearch] = useState(selectedLabel ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reflect external selection changes (select / clear / hydrate) in the input.
  // Keyed on the value only, so it never fights the user mid-typing.
  useEffect(() => {
    setSearch(selectedLabel ?? "");
  }, [selectedValue, selectedLabel]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((opt) =>
      [opt.label, opt.sublabel, opt.detail]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(query)),
    );
  }, [search, options]);

  const highlightedIndex =
    filtered.length > 0 ? Math.min(activeIndex, filtered.length - 1) : 0;

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        anchorRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    const el = dropdownRef.current.querySelector<HTMLElement>(
      `[data-index="${highlightedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open]);

  function handleSearchChange(value: string) {
    setSearch(value);
    setOpen(true);
    setActiveIndex(0);
    if (!value.trim() && selectedValue) onClear?.();
  }

  function handleSelect(option: SearchableOption) {
    if (option.disabled) return;
    onSelect(option);
    setSearch(option.label);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      setOpen(true);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((c) => (c + 1 >= filtered.length ? 0 : c + 1));
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((c) => (c - 1 < 0 ? filtered.length - 1 : c - 1));
      }
      return;
    }
    if (event.key === "Enter") {
      if (!open || filtered.length === 0) return;
      event.preventDefault();
      const opt = filtered[highlightedIndex] ?? filtered[0];
      if (opt) handleSelect(opt);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  }

  const resolvedPlaceholder = disabled
    ? (disabledPlaceholder ?? placeholder)
    : loading
      ? loadingPlaceholder
      : placeholder;

  const dropdown =
    open && dropdownStyle
      ? createPortal(
          <div
            ref={dropdownRef}
            className="z-[1000] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
            style={{
              position: "fixed",
              top: dropdownStyle.top,
              left: dropdownStyle.left,
              width: dropdownStyle.width,
              maxHeight: 300,
            }}
            role="listbox"
            aria-label={ariaLabel}
          >
            <div className="max-h-[300px] overflow-y-auto py-1">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-neutral-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {loadingPlaceholder}
                </div>
              ) : error ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-center text-xs text-danger-600">
                  <AlertTriangle className="h-4 w-4" />
                  {errorText}
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-neutral-500">
                  {emptyText}
                </div>
              ) : (
                <ul>
                  {filtered.map((opt, index) => {
                    const isActive = index === highlightedIndex;
                    const isSelected = opt.value === selectedValue;
                    return (
                      <li key={opt.value}>
                        <button
                          type="button"
                          data-index={index}
                          disabled={opt.disabled}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => handleSelect(opt)}
                          className={[
                            "flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition",
                            opt.disabled
                              ? "cursor-not-allowed opacity-50"
                              : isActive || isSelected
                                ? "bg-primary-50"
                                : "hover:bg-neutral-50",
                          ].join(" ")}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <span className="text-sm font-semibold text-neutral-900">
                            {opt.label}
                          </span>
                          {opt.sublabel && opt.sublabel !== opt.label && (
                            <span className="text-xs text-neutral-500">
                              {opt.sublabel}
                            </span>
                          )}
                          {opt.detail && opt.detail !== opt.sublabel && (
                            <span className="line-clamp-1 text-[11px] text-neutral-400">
                              {opt.detail}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={anchorRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          disabled={disabled}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => !disabled && setOpen(true)}
          onKeyDown={handleKeyDown}
          aria-invalid={invalid}
          aria-expanded={open}
          aria-autocomplete="list"
          className={inputCls(invalid, disabled)}
          placeholder={resolvedPlaceholder}
        />
        {loading ? (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-neutral-400" />
        ) : (
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        )}
      </div>
      {dropdown}
    </div>
  );
}
