import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { cn } from "../../lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 rdp-calendar", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium text-neutral-900",
        nav: "flex items-center gap-1",
        button_previous: cn(
          "absolute left-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white p-0",
          "text-neutral-600 opacity-80 transition hover:bg-neutral-100 hover:opacity-100"
        ),
        button_next: cn(
          "absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white p-0",
          "text-neutral-600 opacity-80 transition hover:bg-neutral-100 hover:opacity-100"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 rounded-md text-[0.8rem] font-normal text-neutral-500 text-center",
        week: "mt-2 flex w-full",
        day: "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day_button: cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-md p-0 font-normal",
          "transition hover:bg-primary-50 hover:text-primary-700",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
        ),
        selected:
          "[&>button]:bg-primary-600 [&>button]:text-white [&>button]:hover:bg-primary-600 [&>button]:hover:text-white",
        today: "[&>button]:font-semibold [&>button]:text-primary-700",
        outside: "[&>button]:text-neutral-400 [&>button]:opacity-50",
        disabled: "[&>button]:text-neutral-300 [&>button]:opacity-50 [&>button]:hover:bg-transparent",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...chevronProps }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
          return (
            <Icon className={cn("h-4 w-4", chevronClassName)} {...chevronProps} />
          );
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
