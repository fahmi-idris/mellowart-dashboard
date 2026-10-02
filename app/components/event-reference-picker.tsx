import { useId, useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function EventReferencePicker({
  kind,
  label,
  options,
  values,
  onChange,
  disabled,
}: {
  kind: string;
  label: string;
  options: string[];
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const choices = [...new Set([...options, ...values])].filter((name) =>
    name.toLowerCase().includes(search.toLowerCase()),
  );
  const toggle = (name: string) =>
    onChange(values.includes(name) ? values.filter((value) => value !== name) : [...values, name]);
  const create = search.trim();
  return (
    <div className="grid gap-2">
      {values.map((value) => (
        <input key={value} type="hidden" name={kind} value={value} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">
              {values.length ? `${values.length} selected` : `Select or add ${label.toLowerCase()}`}
            </span>
            <ChevronsUpDown className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
          <Input
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder="Search or add…"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (create) {
                  const existing = choices.find(
                    (choice) => choice.toLowerCase() === create.toLowerCase(),
                  );
                  if (existing) toggle(existing);
                  else onChange([...values, create]);
                  setSearch("");
                }
              }
            }}
          />
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            aria-multiselectable
            className="mt-2 max-h-48 overflow-y-auto"
          >
            {choices.map((name) => (
              <button
                type="button"
                key={name}
                role="option"
                aria-selected={values.includes(name)}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent"
                onClick={() => toggle(name)}
              >
                <Check className={`size-4 shrink-0 ${values.includes(name) ? "" : "opacity-0"}`} />
                <span className="break-words">{name}</span>
              </button>
            ))}
            {create && !choices.some((choice) => choice.toLowerCase() === create.toLowerCase()) && (
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  onChange([...values, create]);
                  setSearch("");
                }}
              >
                <Plus className="size-4" />
                Add “{create}”
              </Button>
            )}
            {!choices.length && !create && (
              <p className="p-2 text-muted-foreground">Type to add your first choice.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {!!values.length && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant="secondary" className="max-w-full gap-1">
              <span className="truncate">{value}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${value}`}
                onClick={() => toggle(value)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
