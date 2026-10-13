import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function EventDatePicker({
  id,
  value,
  onChange,
  min,
  max,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value.slice(0, 10)}T00:00:00`) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full justify-start font-normal"
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
        >
          <CalendarDays className="size-4" />
          {date
            ? date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
            : "Select date"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          disabled={(day) =>
            (min ? day < new Date(`${min}T00:00:00`) : false) ||
            (max ? day > new Date(`${max}T00:00:00`) : false)
          }
          onSelect={(selected) => {
            if (!selected) return;
            // Date-only values use local calendar parts, not a UTC conversion.
            onChange(
              `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`,
            );
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
