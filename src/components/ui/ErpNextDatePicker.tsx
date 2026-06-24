import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CalendarDays } from "lucide-react";

import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import {
  ERP_NEXT_ISO_DATE_RE,
  formatERPNextDate,
  formatUsDisplayDate,
  parseUsDisplayDate,
} from "../../utils/erpNextDate";

dayjs.extend(customParseFormat);

function isDayBefore(a: string, b: string): boolean {
  const dA = dayjs(a, "YYYY-MM-DD", true).startOf("day");
  const dB = dayjs(b, "YYYY-MM-DD", true).startOf("day");
  if (!dA.isValid() || !dB.isValid()) return false;
  return dA.isBefore(dB);
}

const INPUT_CLS =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

const COMPLETE_US_DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

function maskUsDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export interface ErpNextDatePickerHandle {
  /** Commit pending display text and return ISO value (YYYY-MM-DD). */
  flush: () => string | null;
  /** Current US display string (MM/DD/YYYY). */
  getDisplay: () => string;
}

export interface ErpNextDatePickerProps {
  /** ISO value stored for ERPNext (YYYY-MM-DD). */
  value: string;
  onChange: (isoValue: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  error?: string;
  onValidationError?: (message: string) => void;
  /** Show MM/DD/YYYY hint below the field. */
  showFormatHint?: boolean;
}

function normalizeIso(value: string | undefined): string {
  if (!value) return "";
  const iso = formatERPNextDate(value);
  return iso && ERP_NEXT_ISO_DATE_RE.test(iso) ? iso : "";
}

/**
 * US date picker for ERPNext integration.
 * - Displays MM/DD/YYYY (never dd-mm-yyyy)
 * - Emits YYYY-MM-DD for API payloads
 */
const ErpNextDatePicker = forwardRef<
  ErpNextDatePickerHandle,
  ErpNextDatePickerProps
>(function ErpNextDatePicker(
  {
    value,
    onChange,
    min,
    max,
    disabled = false,
    required = false,
    placeholder = "MM/DD/YYYY",
    className,
    error,
    onValidationError,
    showFormatHint = true,
  },
  ref
) {
  const nativeRef = useRef<HTMLInputElement>(null);
  const [display, setDisplay] = useState(() => formatUsDisplayDate(value));
  const isoValue = normalizeIso(value);
  const minIso = min ? normalizeIso(min) : "";
  const maxIso = max ? normalizeIso(max) : "";

  useEffect(() => {
    setDisplay(formatUsDisplayDate(value));
  }, [value]);

  function commitDisplay(nextDisplay: string, silent = false): string | null {
    const trimmed = nextDisplay.trim();
    if (!trimmed) {
      if (required && !silent) onValidationError?.("Date is required.");
      return null;
    }

    const iso = parseUsDisplayDate(trimmed);
    if (!iso) {
      if (!silent) {
        onValidationError?.("Enter a valid date as MM/DD/YYYY.");
        setDisplay(formatUsDisplayDate(value));
      }
      return null;
    }

    if (minIso && isDayBefore(iso, minIso)) {
      if (!silent) {
        onValidationError?.(
          `Date cannot be before ${formatUsDisplayDate(minIso)}.`
        );
        setDisplay(formatUsDisplayDate(value));
      }
      return null;
    }

    if (maxIso && isDayBefore(maxIso, iso)) {
      if (!silent) {
        onValidationError?.(
          `Date cannot be after ${formatUsDisplayDate(maxIso)}.`
        );
        setDisplay(formatUsDisplayDate(value));
      }
      return null;
    }

    onValidationError?.("");
    if (iso !== isoValue) {
      onChange(iso);
    }
    setDisplay(formatUsDisplayDate(iso));
    return iso;
  }

  useImperativeHandle(
    ref,
    () => ({
      flush: () => commitDisplay(display),
      getDisplay: () => display,
    }),
    [display, value, minIso, maxIso, isoValue, onChange, onValidationError, required]
  );

  function handleTextChange(next: string) {
    const masked = maskUsDateInput(next);
    setDisplay(masked);
    if (COMPLETE_US_DATE_RE.test(masked)) {
      commitDisplay(masked);
    }
  }

  function handleNativeChange(nextIso: string) {
    if (!nextIso) return;
    commitDisplay(formatUsDisplayDate(nextIso));
  }

  function openCalendar() {
    if (disabled) return;
    nativeRef.current?.showPicker?.();
  }

  const borderCls = error
    ? "border-danger-300 focus:border-danger-500 focus:ring-danger-500/20"
    : "border-neutral-300 focus:border-primary-500 focus:ring-primary-500/20";

  return (
    <div className={className}>
      <div className="relative flex items-stretch">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={display}
          disabled={disabled}
          required={required}
          aria-label={placeholder}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={() => commitDisplay(display)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDisplay(display);
            }
          }}
          className={`${INPUT_CLS} pr-10 ${borderCls} ${disabled ? "bg-neutral-50 text-neutral-500" : ""}`}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={openCalendar}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-primary-600 disabled:opacity-50"
          aria-label="Open calendar"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        <input
          ref={nativeRef}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={isoValue}
          min={minIso || undefined}
          max={maxIso || undefined}
          onChange={(e) => handleNativeChange(e.target.value)}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
      </div>
      {showFormatHint && (
        <p className="mt-1 text-xs text-neutral-500">Format: MM/DD/YYYY</p>
      )}
    </div>
  );
});

export default ErpNextDatePicker;

/** Read-only US date display for disabled fields. */
export function ErpNextDateDisplay({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`${INPUT_CLS} bg-neutral-50 text-neutral-700 ${className ?? ""}`}
    >
      {formatUsDisplayDate(value) || "—"}
    </div>
  );
}
