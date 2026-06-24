import { useEffect, useMemo, useState } from "react";
import { format, isBefore, startOfDay } from "date-fns";
import { CalendarDays } from "lucide-react";

import {
  formatERPNextDate,
  formatUkDisplayDate,
  parseERPNextDateInput,
} from "../../utils/erpNextDate";
import { cn } from "../../lib/utils";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface CalendarDatePickerProps {
  /** ISO value for API payloads (YYYY-MM-DD). */
  value: string;
  onChange: (isoValue: string) => void;
  min?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  error?: string;
  id?: string;
}

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const parsed = parseERPNextDateInput(iso);
  return parsed?.isValid() ? startOfDay(parsed.toDate()) : undefined;
}

/**
 * Calendar date picker (ShadCN Calendar + Popover).
 * Displays DD/MM/YYYY · stores/emits YYYY-MM-DD.
 */
export default function CalendarDatePicker({
  value,
  onChange,
  min,
  disabled = false,
  required = false,
  placeholder = "DD/MM/YYYY",
  className,
  error,
  id,
}: CalendarDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() =>
    isoToDate(value)
  );

  const today = useMemo(() => startOfDay(new Date()), []);
  const minDate = useMemo(() => {
    if (min) {
      const parsed = isoToDate(min);
      if (parsed) return parsed;
    }
    return today;
  }, [min, today]);

  useEffect(() => {
    setSelectedDate(isoToDate(value));
  }, [value]);

  function handleSelect(date: Date | undefined) {
    if (!date) return;

    const normalized = startOfDay(date);
    const iso = formatERPNextDate(normalized);
    if (!iso) return;

    setSelectedDate(normalized);
    onChange(iso);
    setOpen(false);
  }

  const display = selectedDate
    ? format(selectedDate, "dd/MM/yyyy")
    : formatUkDisplayDate(value);

  const isDateDisabled = (date: Date) =>
    isBefore(startOfDay(date), startOfDay(minDate));

  const borderCls = error
    ? "border-danger-300 focus:border-danger-500 focus:ring-danger-500/20"
    : "border-neutral-300 focus:border-primary-500 focus:ring-primary-500/20";

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-required={required}
            aria-invalid={!!error}
            className={cn(
              "relative flex w-full items-center rounded-lg border bg-white px-3 py-2 text-left text-sm shadow-sm",
              "focus:outline-none focus:ring-1",
              borderCls,
              disabled && "cursor-not-allowed bg-neutral-50 text-neutral-500",
              !display && "text-neutral-400"
            )}
          >
            <span className="flex-1 truncate">{display || placeholder}</span>
            <CalendarDays className="ml-2 h-4 w-4 shrink-0 text-neutral-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="z-[100] w-auto p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            defaultMonth={selectedDate ?? new Date()}
            disabled={isDateDisabled}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  );
}
