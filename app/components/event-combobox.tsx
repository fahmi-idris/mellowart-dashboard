import { useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import type { EventSummary } from "~/lib/events";
import { cn } from "~/lib/utils";

/** Searchable, keyboard-operable event picker using the app's shadcn primitives. */
export function EventCombobox({
  events,
  value,
  onValueChange,
  disabled = false,
  className,
}: {
  events: EventSummary[];
  value?: string;
  onValueChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = events.find((event) => event.id === value);
  const matches = events.filter((event) =>
    `${event.name} ${event.slug} ${event.location ?? ""}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );

  function select(id: string) {
    onValueChange(id);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSearch("");
          setActiveIndex(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Email template event"
          disabled={disabled || events.length === 0}
          className={cn("min-w-0 justify-between gap-2 font-normal", className)}
        >
          <span className="truncate">{selected?.name ?? "No event found"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-1"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="relative p-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            role="searchbox"
            aria-label="Search events"
            placeholder="Search events…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && matches[activeIndex]) {
                event.preventDefault();
                select(matches[activeIndex].id);
              }
            }}
            className="pl-8"
          />
        </div>
        <div role="listbox" aria-label="Events" className="max-h-64 overflow-y-auto p-1">
          {matches.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">No event found.</p>
          ) : (
            matches.map((event, index) => (
              <button
                key={event.id}
                type="button"
                role="option"
                aria-selected={event.id === value}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  activeIndex === index && "bg-accent",
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(event.id)}
              >
                <Check
                  className={cn(
                    "size-4 shrink-0",
                    event.id === value ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden="true"
                />
                <span className="truncate">{event.name}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
