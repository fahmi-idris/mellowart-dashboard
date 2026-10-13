import { DayPicker, getDefaultClassNames } from "react-day-picker";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";
import { buttonVariants } from "./button";

/** shadcn-style Calendar, composed with the existing Radix Popover date picker. */
export function Calendar({ className, classNames, ...props }: ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays
      className={cn("w-fit p-3", className)}
      classNames={{
        root: cn(defaults.root, "relative"),
        months: "flex flex-col gap-4",
        month: "flex flex-col gap-3",
        month_caption: "flex h-8 items-center justify-center gap-2 px-9",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-3 top-3 flex justify-between",
        button_previous: cn(buttonVariants({ variant: "outline", size: "icon-sm" })),
        button_next: cn(buttonVariants({ variant: "outline", size: "icon-sm" })),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-center text-xs text-muted-foreground",
        week: "mt-1 flex",
        day: "relative size-9 text-center text-sm",
        day_button: cn(buttonVariants({ variant: "ghost" }), "size-9 p-0 font-normal"),
        selected: "[&_button]:bg-primary [&_button]:text-primary-foreground",
        today: "[&_button]:ring-1 [&_button]:ring-primary",
        outside: "text-muted-foreground opacity-50",
        disabled: "opacity-30",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" />
          ) : orientation === "right" ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          ),
      }}
      {...props}
    />
  );
}
